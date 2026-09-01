import type { Endpoint } from "./types.js";
import { ok } from "./shared.js";

export function looksMarkdown(endpoint: Endpoint): boolean {
  const varyAccept = /(^|,)\s*accept\s*($|,)/i.test(endpoint.headers?.vary ?? "");
  return ok(endpoint.status) && /text\/markdown/i.test(endpoint.contentType) && varyAccept;
}

export function hasBodyContent(html: string): boolean {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const hasH1 = /<h1[\s>]/i.test(stripped);
  const textOnly = stripped
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return hasH1 && textOnly.length >= 500;
}

function collectJsonLdNodes(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(collectJsonLdNodes);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const graph = record["@graph"];
    return Array.isArray(graph) ? graph.flatMap(collectJsonLdNodes) : [record];
  }
  return [];
}

function isMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function isOrganizationNode(node: Record<string, unknown>): boolean {
  const type = node["@type"];
  return type === "Organization" || (Array.isArray(type) && type.includes("Organization"));
}

export function orgSchemaStatus(html: string): "pass" | "warn" {
  const blocks = [
    ...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi),
  ].map((m) => m[1]);
  const nodes = blocks.flatMap((block) => {
    try {
      return collectJsonLdNodes(JSON.parse(block));
    } catch {
      return [];
    }
  });
  const orgNodes = nodes.filter(isOrganizationNode);
  if (!orgNodes.length) return "warn";
  return orgNodes.some(
    (node) => isMeaningfulValue(node.contactPoint) && isMeaningfulValue(node.address),
  )
    ? "pass"
    : "warn";
}

export function looksLikeHomepage(agentResponse: Endpoint, home: Endpoint): boolean {
  if (!ok(agentResponse.status)) return false;
  if (
    /captcha|access denied|are you a (?:human|robot)|checking your browser|request blocked/i.test(
      agentResponse.text,
    )
  )
    return false;
  if (!ok(home.status) || !home.text.trim()) return agentResponse.text.trim().length > 0;
  return agentResponse.text.length >= home.text.length * 0.5;
}

export function hasRateLimitHeaders(endpoints: Endpoint[]): boolean {
  return endpoints.some((endpoint) => {
    if (!ok(endpoint.status)) return false;
    const keys = Object.keys(endpoint.headers ?? {});
    const has = (name: string) =>
      keys.some((key) => new RegExp(`^(x-)?ratelimit-${name}$`, "i").test(key));
    return has("limit") && has("remaining") && has("reset");
  });
}
