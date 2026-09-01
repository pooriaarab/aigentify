import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { AuditOptions, AuditReport, Endpoint, Snapshot } from "./audit/types.js";
import { NO_EXTERNAL_DISCOVERY } from "./audit/types.js";
import { ok, parseJson } from "./audit/shared.js";
import { probeExternalDiscovery } from "./audit/external.js";
import { auditGaps, buildChecks } from "./audit/checks.js";
import { scoreAuditChecks } from "./audit/report.js";

export type {
  AuditStatus,
  AuditCheck,
  AuditGap,
  AuditReport,
  AuditOptions,
} from "./audit/types.js";
export { scoreAuditChecks, formatAuditReport } from "./audit/report.js";

const SKIPPED = new Set([".git", "node_modules", "dist", "coverage", ".next", "_reference_geoaeo"]);

async function walkFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && !SKIPPED.has(entry.name))
      files.push(...(await walkFiles(path.join(directory, entry.name))));
    else if (entry.isFile()) files.push(path.join(directory, entry.name));
  }
  return files;
}

async function readText(file: string | undefined): Promise<string> {
  if (!file) return "";
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

function findFile(files: string[], name: string): string | undefined {
  return files.find((file) => {
    const normalized = file.replaceAll("\\", "/");
    return path.basename(normalized) === name || normalized.endsWith(`/${name}/route.ts`);
  });
}

function offerBlock(text: string): string {
  const match = /^#+\s*Offer\b/im.exec(text);
  if (!match || match.index === undefined) return "";
  const rest = text.slice(match.index);
  const nextHeading = /^#+\s+/m.exec(rest.slice(match[0].length));
  return nextHeading?.index === undefined
    ? rest
    : rest.slice(0, match[0].length + nextHeading.index);
}

async function directorySnapshot(directory: string): Promise<Snapshot> {
  const files = await walkFiles(directory);
  const agentsFile = findFile(files, "AGENTS.md");
  const serverFile = findFile(files, "server.json");
  const mcpFile = files.find((file) => /(?:^|\/)\.mcp\.json$/.test(file.replaceAll("\\", "/")));
  const packageFile = findFile(files, "package.json");
  const packageText = await readText(packageFile);
  const hasMcpBin = /"(?:aigentify|[^"\n]*mcp[^"\n]*)"\s*:/i.test(packageText);
  const agentsText = await readText(agentsFile);
  const offerTexts = [
    agentsText,
    ...(await Promise.all(
      files
        .filter((file) => /\.(html?|json|jsonld|md|mdx|tsx|jsx|js|mjs|ts)$/.test(file))
        .map(readText),
    )),
  ];
  const llmsFile = findFile(files, "llms.txt");
  const sitemapFile = findFile(files, "sitemap.xml");
  const offerFiles = files.filter((file) =>
    /\.jsonld$|(?:^|\/)offer[^/]*\.(?:json|html?)$/i.test(file),
  );
  const honestText = [
    offerBlock(agentsText),
    ...(await Promise.all(offerFiles.map(readText))),
  ].join("\n");
  return {
    agents: { status: agentsFile ? 200 : 404, contentType: "text/markdown", text: agentsText },
    server: {
      status: serverFile ? 200 : 404,
      contentType: "application/json",
      text: await readText(serverFile),
    },
    mcp: { status: mcpFile || serverFile || hasMcpBin ? 200 : 404, contentType: "", text: "" },
    home: { status: 200, contentType: "text/plain", text: offerTexts.join("\n") },
    llms: {
      status: llmsFile ? 200 : 404,
      contentType: "text/plain",
      text: await readText(llmsFile),
    },
    sitemap: {
      status: sitemapFile ? 200 : 404,
      contentType: "application/xml",
      text: await readText(sitemapFile),
    },
    // advanced web signals are not meaningful for a repo directory — audited only for URL targets
    wellKnown: { status: 404, contentType: "", text: "" },
    openapi: { status: 404, contentType: "", text: "" },
    agentsPage: { status: 404, contentType: "", text: "" },
    notFound: { status: 404, contentType: "", text: "" },
    homeMarkdown: { status: 404, contentType: "", text: "" },
    homeAsAgent: { status: 404, contentType: "", text: "" },
    authMd: { status: 404, contentType: "", text: "" },
    apiCatalog: { status: 404, contentType: "", text: "" },
    agentCard: { status: 404, contentType: "", text: "" },
    aiPlugin: { status: 404, contentType: "", text: "" },
    external: NO_EXTERNAL_DISCOVERY,
    honestText,
    hasMcp: Boolean(mcpFile || serverFile || hasMcpBin),
    networkFailure: false,
    isUrl: false,
  };
}

async function fetchText(
  fetcher: typeof globalThis.fetch,
  url: string,
  init?: RequestInit,
): Promise<Endpoint> {
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(8000), ...init });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      text: await response.text(),
      headers,
    };
  } catch {
    return { status: 0, contentType: "", text: "", headers: {} };
  }
}

/** The product/brand name — from the A2A agent card, else the homepage <title>. */
function productName(agentCard: Endpoint, home: Endpoint): string | null {
  const card = parseJson(agentCard.text);
  if (card && typeof card.name === "string" && card.name.trim()) return card.name.trim();
  const title = /<title[^>]*>([^<]{2,120})<\/title>/i.exec(home.text)?.[1]?.trim();
  // Drop a trailing " | tagline" / " - tagline" so "Content Rabbit | ..." → "Content Rabbit".
  return title ? title.split(/\s[|–—-]\s/)[0].trim() : null;
}

async function urlSnapshot(target: string, fetcher: typeof globalThis.fetch): Promise<Snapshot> {
  const base = target.replace(/\/+$/, "");
  // A path no real site serves — used to detect soft-404s (200 + app shell).
  const missingPath = `${base}/aigentify-probe-${"x".repeat(8)}-404`;
  const [
    agents,
    server,
    mcp,
    home,
    llms,
    sitemap,
    wellKnown,
    wellKnownCard,
    openapi,
    agentsPage,
    notFound,
    homeMarkdown,
    homeAsAgent,
    authMd,
    apiCatalog,
    aiPlugin,
  ] = await Promise.all([
    fetchText(fetcher, `${base}/agents.md`),
    fetchText(fetcher, `${base}/server.json`),
    fetchText(fetcher, `${base}/.well-known/mcp`),
    fetchText(fetcher, base),
    fetchText(fetcher, `${base}/llms.txt`),
    fetchText(fetcher, `${base}/sitemap.xml`),
    fetchText(fetcher, `${base}/.well-known/agent.json`),
    fetchText(fetcher, `${base}/.well-known/agent-card.json`),
    fetchText(fetcher, `${base}/openapi.json`),
    fetchText(fetcher, `${base}/agents`),
    fetchText(fetcher, missingPath),
    fetchText(fetcher, base, { headers: { accept: "text/markdown" } }),
    fetchText(fetcher, base, { headers: { "user-agent": "ora-agent" } }),
    fetchText(fetcher, `${base}/auth.md`),
    fetchText(fetcher, `${base}/.well-known/api-catalog`),
    fetchText(fetcher, `${base}/.well-known/ai-plugin.json`),
  ]);
  // agent-card.json is the same URL as the well-known probe above — reuse the response instead of fetching twice.
  const agentCard = wellKnownCard;
  const endpoints = [agents, server, mcp, home, llms, sitemap];
  // either well-known agent manifest counts
  const wk = ok(wellKnown.status) ? wellKnown : wellKnownCard;
  // External-discovery probe — only when the site itself resolved (skip on total network failure).
  const external = endpoints.every((item) => item.status === 0)
    ? NO_EXTERNAL_DISCOVERY
    : await probeExternalDiscovery(fetcher, base, productName(agentCard, home));
  return {
    agents,
    server,
    mcp,
    home,
    llms,
    sitemap,
    wellKnown: wk,
    openapi,
    agentsPage,
    notFound,
    homeMarkdown,
    homeAsAgent,
    authMd,
    apiCatalog,
    agentCard,
    aiPlugin,
    external,
    honestText: [home.text, offerBlock(agents.text)].join("\n"),
    hasMcp:
      (server.status >= 200 && server.status < 400) || (mcp.status >= 200 && mcp.status < 400),
    networkFailure: endpoints.every((item) => item.status === 0),
    isUrl: true,
  };
}

export async function auditTarget(
  target: string,
  options: AuditOptions = {},
): Promise<AuditReport> {
  const targetStat = await stat(target).catch(() => undefined);
  const snapshot = targetStat?.isDirectory()
    ? await directorySnapshot(target)
    : await urlSnapshot(target, options.fetch ?? globalThis.fetch);
  const checks = buildChecks(snapshot);
  const gaps = auditGaps(checks);
  return { target, score: scoreAuditChecks(checks), checks, gaps };
}
