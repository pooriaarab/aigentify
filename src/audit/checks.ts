import { SERVER_SCHEMA_URL, SERVER_SCHEMA_RE } from '../constants.js';
import type { AuditCheck, AuditGap, AuditStatus, Endpoint, Snapshot } from './types.js';
import { ok, parseJson } from './shared.js';
import { hasBodyContent, hasRateLimitHeaders, looksLikeHomepage, looksMarkdown, orgSchemaStatus } from './signals.js';

const WEIGHTS: Record<string, number> = {
  'agents-md': 15, 'agents-md-public-safe': 10, 'server-json': 15, mcp: 15,
  'offer-jsonld': 15, 'honest-offer': 10, 'llms-txt': 10, sitemap: 10,
  // advanced ("world-class") web signals — na for CLI/dir targets, low weight
  'well-known-agent': 5, openapi: 5, 'agents-page': 5,
  // is-agentic-parity web signals — na for CLI/dir targets, low weight
  'soft-404': 5, 'markdown-negotiation': 5, 'content-without-js': 5,
  'org-schema': 5, 'crawler-reachable': 5, 'rate-limit-headers': 5,
  // Ora-parity round 2 web signals
  'auth-md': 5, 'api-catalog': 5, 'agent-card-a2a': 5, 'link-headers': 5, 'markdown-alt': 5,
  // External-discovery round 3 (queries third-party registries) — na for CLI/dir targets
  'ai-plugin': 5, wikidata: 5, 'npm-package': 5, 'mcp-registry': 5,
};
const FIXES: Record<string, string> = {
  'agents-md': 'Add a public AGENTS.md at the target root or serve /agents.md as text/markdown.',
  'agents-md-public-safe': 'Rewrite AGENTS.md as product guidance. Remove repository paths and contributor instructions.',
  'server-json': `Add server.json and set "$schema" to "${SERVER_SCHEMA_URL}". Include a repository and a remotes or packages entry.`,
  mcp: 'Publish server.json, .mcp.json, or an MCP entry point.',
  'offer-jsonld': 'Publish JSON-LD with @type Offer, or a SoftwareApplication with an offers property.',
  'honest-offer': 'State the real price plainly. Remove scarcity, countdown, and urgency language.',
  'llms-txt': 'Publish /llms.txt with a concise product description.',
  sitemap: 'Publish /sitemap.xml for URL discovery.',
  'well-known-agent': 'Publish /.well-known/agent.json (or agent-card.json) so agents can discover capabilities.',
  openapi: 'Publish /openapi.json so agents have a machine-readable API reference.',
  'agents-page': 'Publish an /agents page with agent-specific onboarding (self-serve key, sandbox, quickstart).',
  'soft-404': 'Return a real HTTP 404 (or 410) for unknown paths — never a 200 with your app shell, which tells agents every path exists.',
  'markdown-negotiation': 'Serve text/markdown on `Accept: text/markdown` and add `Accept` to the Vary header (Vary: Accept, Accept-Encoding) so CDNs key the variants apart.',
  'content-without-js': 'Server-side render the homepage so crawlers without JS see an <h1> and 500+ characters of real text.',
  'org-schema': 'Add Organization JSON-LD with both contactPoint (email/phone + contactType) and address (PostalAddress).',
  'crawler-reachable': 'Let major agent User-Agents (GPTBot, ClaudeBot, ora-agent, ...) reach the homepage. Narrow WAF/bot rules that block them.',
  'rate-limit-headers': 'Return standard RateLimit-Limit/RateLimit-Remaining/RateLimit-Reset headers (plus Retry-After on 429) so agents can self-throttle.',
  'auth-md': 'Publish /auth.md — a markdown guide describing how an agent authenticates (API key or OAuth) and where to get credentials.',
  'api-catalog': 'Publish /.well-known/api-catalog (RFC 9727 linkset) pointing agents at your OpenAPI spec(s) and API docs.',
  'agent-card-a2a': 'Publish /.well-known/agent-card.json (A2A agent card) with at least name and url so A2A clients can discover the agent.',
  'link-headers': 'Return RFC 8288 Link headers on the homepage pointing at llms.txt, openapi.json, and the agent card so agents discover descriptors without parsing HTML.',
  'markdown-alt': 'Add a <link rel="alternate" type="text/markdown"> to the homepage so agents can find the markdown representation.',
  'ai-plugin': 'Publish /.well-known/ai-plugin.json (the plugin manifest) so plugin hosts and agents can auto-discover your API and auth.',
  wikidata: 'Create a Wikidata item for the product with an official-website (P856) statement pointing at your domain, so agents can verify the entity.',
  'npm-package': 'Publish an official SDK/CLI to npm under a discoverable name so agents can install a typed client.',
  'mcp-registry': 'List your MCP server in the official MCP registry (server.json + mcp-publisher) so agents discover it by name.',
};

function check(id: string, status: AuditStatus, note: string): AuditCheck { return { id, status, note, weight: WEIGHTS[id] }; }

function validServer(text: string): { valid: boolean; reason: string } {
  const value = parseJson(text);
  if (!value) return { valid: false, reason: 'server.json is not valid JSON.' };
  if (typeof value.$schema !== 'string' || !SERVER_SCHEMA_RE.test(value.$schema)) return { valid: false, reason: `server.json "$schema" must be a dated MCP registry schema like ${SERVER_SCHEMA_URL} (the bare .../server.json 404s).` };
  const missing = ['name', 'description', 'repository', 'version'].filter(key => !value[key]);
  if (missing.length) return { valid: false, reason: `server.json is missing: ${missing.join(', ')}.` };
  if (!Array.isArray(value.remotes) && !Array.isArray(value.packages)) return { valid: false, reason: 'server.json needs a remotes or packages entry.' };
  return { valid: true, reason: 'server.json has the required MCP registry fields.' };
}

function hasOffer(texts: string[]): boolean {
  return texts.some(text => /"@type"\s*:\s*"Offer"/i.test(text) || /"@type"\s*:\s*"SoftwareApplication"/i.test(text) && /"offers"\s*:/.test(text));
}

function hasUrgency(text: string): boolean {
  return /limited time|act now|hurry|expires|only\s+\d+\s+left|ends in|sign up now|countdown/i.test(text);
}

function publicSafe(text: string): boolean {
  return !(/\bsrc\//i.test(text) || /\bapps\//i.test(text) || /\bpackages\//i.test(text) || /\b[\w.-]+\.ts\b/i.test(text) || /npm run build/i.test(text) || /\btsconfig\b/i.test(text) || /\bcontributors?\b/i.test(text) || /^#+\s*layout\b/im.test(text));
}

interface CheckContext {
  snapshot: Snapshot;
  agentsPresent: boolean;
  urlOnly: boolean;
  serverInfo: { valid: boolean; reason: string } | undefined;
  offerFound: boolean;
}

interface CheckSpec {
  id: string;
  status: (ctx: CheckContext) => AuditStatus;
  note: (ctx: CheckContext, status: AuditStatus) => string;
}

function makeContext(snapshot: Snapshot): CheckContext {
  const offerTexts = [snapshot.home.text, snapshot.agents.text];
  return {
    snapshot,
    agentsPresent: snapshot.agents.status === 200 && snapshot.agents.text.trim().length > 0 && /(?:text\/(?:markdown|plain)|application\/markdown)/i.test(snapshot.agents.contentType),
    urlOnly: snapshot.isUrl && !snapshot.networkFailure,
    serverInfo: snapshot.server.status === 200 ? validServer(snapshot.server.text) : undefined,
    offerFound: hasOffer(offerTexts),
  };
}

function webNote(status: AuditStatus, pass: string, other: string): string {
  return status === 'pass' ? pass : status === 'na' ? 'Not audited (no served web surface).' : other;
}

function advancedStatus(ctx: CheckContext, endpoint: Endpoint): AuditStatus {
  return !ctx.snapshot.isUrl || ctx.snapshot.networkFailure ? 'na' : ok(endpoint.status) ? 'pass' : 'warn';
}

function agentsMdStatus(ctx: CheckContext): AuditStatus { return ctx.snapshot.agents.status === 0 ? 'warn' : ctx.agentsPresent ? 'pass' : 'fail'; }
function publicSafeStatus(ctx: CheckContext): AuditStatus { return !ctx.agentsPresent ? (ctx.snapshot.agents.status === 0 ? 'warn' : 'na') : publicSafe(ctx.snapshot.agents.text) ? 'pass' : 'warn'; }
function serverJsonStatus(ctx: CheckContext): AuditStatus { return ctx.snapshot.server.status === 0 ? 'warn' : !ctx.snapshot.hasMcp ? 'na' : ctx.serverInfo?.valid ? 'pass' : 'fail'; }
function mcpStatus(ctx: CheckContext): AuditStatus { return ctx.snapshot.networkFailure ? 'warn' : ctx.snapshot.hasMcp ? 'pass' : 'fail'; }
function offerStatus(ctx: CheckContext): AuditStatus { return ctx.snapshot.home.status === 0 ? 'warn' : ctx.offerFound ? 'pass' : 'fail'; }
function honestStatus(ctx: CheckContext): AuditStatus { return !ctx.offerFound && !ctx.agentsPresent ? (ctx.snapshot.home.status === 0 ? 'warn' : 'na') : hasUrgency(ctx.snapshot.honestText) ? 'warn' : 'pass'; }
function endpointTextStatus(endpoint: { status: number; text: string }): AuditStatus { return endpoint.status === 0 ? 'warn' : endpoint.status >= 200 && endpoint.status < 400 && endpoint.text.trim() ? 'pass' : 'fail'; }

function soft404Status(ctx: CheckContext): AuditStatus {
  if (!ctx.urlOnly) return 'na';
  if (ctx.snapshot.notFound.status === 404 || ctx.snapshot.notFound.status === 410) return 'pass';
  return ok(ctx.snapshot.notFound.status) ? 'fail' : 'warn';
}

function contentStatus(ctx: CheckContext): AuditStatus {
  return !ctx.urlOnly ? 'na' : !ok(ctx.snapshot.home.status) ? 'warn' : hasBodyContent(ctx.snapshot.home.text) ? 'pass' : 'warn';
}

function orgStatus(ctx: CheckContext): AuditStatus {
  return !ctx.urlOnly ? 'na' : !ok(ctx.snapshot.home.status) ? 'warn' : orgSchemaStatus(ctx.snapshot.home.text);
}

function authMdStatus(ctx: CheckContext): AuditStatus {
  if (!ctx.urlOnly) return 'na';
  return ok(ctx.snapshot.authMd.status) && ctx.snapshot.authMd.text.trim().length > 0
    && (/text\/markdown/i.test(ctx.snapshot.authMd.contentType) || ctx.snapshot.authMd.text.trimStart().startsWith('#')) ? 'pass' : 'warn';
}

function apiCatalogStatus(ctx: CheckContext): AuditStatus {
  return !ctx.urlOnly ? 'na'
    : ok(ctx.snapshot.apiCatalog.status) && Array.isArray(parseJson(ctx.snapshot.apiCatalog.text)?.linkset) ? 'pass' : 'warn';
}

function agentCardStatus(ctx: CheckContext): AuditStatus {
  if (!ctx.urlOnly) return 'na';
  if (!ok(ctx.snapshot.agentCard.status)) return 'warn';
  const card = parseJson(ctx.snapshot.agentCard.text);
  return card && typeof card.name === 'string' && card.name.trim().length > 0
    && typeof card.url === 'string' && card.url.trim().length > 0 ? 'pass' : 'warn';
}

function markdownAltStatus(ctx: CheckContext): AuditStatus {
  if (!ctx.urlOnly) return 'na';
  const found = [...ctx.snapshot.home.text.matchAll(/<link\b[^>]*>/gi)].some(([tag]) =>
    /rel=["']?alternate["']?/i.test(tag) && /type=["']?text\/markdown/i.test(tag));
  return found ? 'pass' : 'warn';
}

function isObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null;
}

function hasPluginName(manifest: Record<string, unknown>): boolean {
  return ['name_for_model', 'name_for_human'].some((key) => {
    const value = manifest[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

// A manifest must identify itself — an empty `{}` (or any object lacking these) isn't a usable plugin descriptor.
function aiPluginStatus(ctx: CheckContext): AuditStatus {
  if (!ctx.urlOnly) return 'na';
  const aiPluginManifest: Record<string, unknown> = (ok(ctx.snapshot.aiPlugin.status) ? parseJson(ctx.snapshot.aiPlugin.text) : undefined) ?? {};
  return hasPluginName(aiPluginManifest) && isObject(aiPluginManifest.api) && isObject(aiPluginManifest.auth) ? 'pass' : 'warn';
}

function registryStatus(ctx: CheckContext, found: boolean): AuditStatus {
  return !ctx.urlOnly ? 'na' : found ? 'pass' : 'warn';
}

function registryNote(status: AuditStatus, pass: string, fallback: string): string {
  if (status === 'pass') return pass;
  if (status === 'na') return 'Not audited (no served web surface).';
  return fallback;
}

const SPECS: CheckSpec[] = [
  {
    id: 'agents-md',
    status: agentsMdStatus,
    note: (ctx) => ctx.agentsPresent ? 'AGENTS.md is available.' : ctx.snapshot.agents.status === 0 ? 'The AGENTS.md request failed.' : 'AGENTS.md is missing.',
  },
  {
    id: 'agents-md-public-safe',
    status: publicSafeStatus,
    note: (_ctx, status) => status === 'pass' ? 'AGENTS.md describes the product as a public surface.' : status === 'na' ? 'No AGENTS.md is available to inspect.' : 'AGENTS.md contains repository-internal guidance.',
  },
  {
    id: 'server-json',
    status: serverJsonStatus,
    note: (ctx) => ctx.serverInfo?.valid ? ctx.serverInfo.reason : ctx.serverInfo?.reason ?? (!ctx.snapshot.hasMcp ? 'No MCP surface was detected.' : 'server.json is missing.'),
  },
  {
    id: 'mcp',
    status: mcpStatus,
    note: (ctx) => ctx.snapshot.networkFailure ? 'The MCP discovery request failed.' : ctx.snapshot.hasMcp ? 'An MCP surface is available.' : 'No MCP surface was found.',
  },
  {
    id: 'offer-jsonld',
    status: offerStatus,
    note: (_ctx, status) => status === 'pass' ? 'Offer JSON-LD is available.' : status === 'warn' ? 'The offer could not be checked.' : 'No Offer JSON-LD was found.',
  },
  {
    id: 'honest-offer',
    status: honestStatus,
    note: (_ctx, status) => status === 'pass' ? 'Offer language states the price without pressure.' : status === 'na' ? 'No offer or Offer block was found.' : 'Offer language contains scarcity, countdown, or urgency copy.',
  },
  {
    id: 'llms-txt',
    status: (ctx) => endpointTextStatus(ctx.snapshot.llms),
    note: (_ctx, status) => status === 'pass' ? 'llms.txt is available.' : status === 'warn' ? 'The llms.txt request failed.' : 'llms.txt is missing.',
  },
  {
    id: 'sitemap',
    status: (ctx) => endpointTextStatus(ctx.snapshot.sitemap),
    note: (_ctx, status) => status === 'pass' ? 'sitemap.xml is available.' : status === 'warn' ? 'The sitemap request failed.' : 'sitemap.xml is missing.',
  },
  {
    id: 'well-known-agent',
    status: (ctx) => advancedStatus(ctx, ctx.snapshot.wellKnown),
    note: (_ctx, status) => webNote(status, 'A .well-known agent manifest is available.', 'No /.well-known/agent.json manifest was found.'),
  },
  {
    id: 'openapi',
    status: (ctx) => advancedStatus(ctx, ctx.snapshot.openapi),
    note: (_ctx, status) => webNote(status, 'openapi.json is available.', 'No /openapi.json was found.'),
  },
  {
    id: 'agents-page',
    status: (ctx) => advancedStatus(ctx, ctx.snapshot.agentsPage),
    note: (_ctx, status) => webNote(status, 'An /agents page is available.', 'No /agents onboarding page was found.'),
  },
  {
    id: 'soft-404',
    status: soft404Status,
    note: (_ctx, status) => status === 'pass' ? 'Unknown paths return a real 404.' : status === 'na' ? 'Not audited (no served web surface).' : status === 'warn' ? 'The 404 probe was inconclusive (no response, or a non-404/410 error status).' : 'Unknown paths return 200 with the app shell (soft-404).',
  },
  {
    id: 'markdown-negotiation',
    status: (ctx) => !ctx.urlOnly ? 'na' : looksMarkdown(ctx.snapshot.homeMarkdown) ? 'pass' : 'warn',
    note: (_ctx, status) => webNote(status, 'The homepage serves text/markdown with Vary: Accept.', 'The homepage does not serve markdown on Accept: text/markdown with a Vary: Accept header.'),
  },
  {
    id: 'content-without-js',
    status: contentStatus,
    note: (_ctx, status) => webNote(status, 'The homepage renders an H1 and substantial text without JS.', 'The homepage lacks an H1 or enough server-rendered text.'),
  },
  {
    id: 'org-schema',
    status: orgStatus,
    note: (_ctx, status) => webNote(status, 'Organization JSON-LD includes contactPoint and address.', 'Organization JSON-LD is missing or lacks contactPoint/address.'),
  },
  {
    id: 'crawler-reachable',
    status: (ctx) => !ctx.urlOnly ? 'na' : looksLikeHomepage(ctx.snapshot.homeAsAgent, ctx.snapshot.home) ? 'pass' : 'warn',
    note: (_ctx, status) => webNote(status, 'The homepage is reachable by an agent User-Agent.', 'An agent User-Agent could not reach the homepage.'),
  },
  {
    id: 'rate-limit-headers',
    status: (ctx) => !ctx.urlOnly ? 'na' : hasRateLimitHeaders([ctx.snapshot.openapi, ctx.snapshot.server, ctx.snapshot.home]) ? 'pass' : 'warn',
    note: (_ctx, status) => webNote(status, 'Standard rate-limit headers are present.', 'No RateLimit-* headers were found on probed endpoints.'),
  },
  {
    id: 'auth-md',
    status: authMdStatus,
    note: (_ctx, status) => webNote(status, '/auth.md is available.', 'No /auth.md agent-auth guide was found.'),
  },
  {
    id: 'api-catalog',
    status: apiCatalogStatus,
    note: (_ctx, status) => webNote(status, '/.well-known/api-catalog is available.', 'No /.well-known/api-catalog (RFC 9727) was found.'),
  },
  {
    id: 'agent-card-a2a',
    status: agentCardStatus,
    note: (_ctx, status) => webNote(status, 'An A2A agent-card.json is available.', 'No valid /.well-known/agent-card.json (A2A) was found.'),
  },
  {
    id: 'link-headers',
    status: (ctx) => !ctx.urlOnly ? 'na'
      : /llms\.txt|openapi\.json|agent-card|\.well-known/i.test(ctx.snapshot.home.headers?.link ?? '') ? 'pass' : 'warn',
    note: (_ctx, status) => webNote(status, 'The homepage returns RFC 8288 Link headers.', 'No Link header was found on the homepage.'),
  },
  {
    id: 'markdown-alt',
    status: markdownAltStatus,
    note: (_ctx, status) => webNote(status, 'The homepage advertises a markdown alternate link.', 'No <link rel="alternate" type="text/markdown"> was found.'),
  },
  {
    id: 'ai-plugin',
    status: aiPluginStatus,
    note: (_ctx, status) => webNote(status, 'A /.well-known/ai-plugin.json manifest is available.', 'No usable /.well-known/ai-plugin.json manifest was found (missing, empty, or lacking identifying fields).'),
  },
  {
    id: 'wikidata',
    status: (ctx) => registryStatus(ctx, ctx.snapshot.external.wikidata),
    note: (ctx, status) => registryNote(status, 'A Wikidata item links to this domain (P856).', ctx.snapshot.external.wikidataError ? 'The Wikidata lookup could not be completed (registry error or timeout) — not a confirmed gap.' : 'No Wikidata item links to this domain via official website (P856).'),
  },
  {
    id: 'npm-package',
    status: (ctx) => registryStatus(ctx, ctx.snapshot.external.npm),
    note: (ctx, status) => registryNote(status, 'A matching npm package is published.', ctx.snapshot.external.npmError ? 'The npm registry lookup could not be completed (registry error or timeout) — not a confirmed gap.' : 'No npm package matching the product was found.'),
  },
  {
    id: 'mcp-registry',
    status: (ctx) => registryStatus(ctx, ctx.snapshot.external.mcpRegistry),
    note: (ctx, status) => registryNote(status, 'Listed in the official MCP registry.', ctx.snapshot.external.mcpRegistryError ? 'The MCP registry lookup could not be completed (registry error or timeout) — not a confirmed gap.' : 'No entry matching this product was found in the official MCP registry.'),
  },
];

export function buildChecks(snapshot: Snapshot): AuditCheck[] {
  const ctx = makeContext(snapshot);
  return SPECS.map((spec) => {
    const status = spec.status(ctx);
    return check(spec.id, status, spec.note(ctx, status));
  });
}

export function auditGaps(checks: AuditCheck[]): AuditGap[] {
  return checks.filter(item => item.status === 'fail' || item.status === 'warn').map(item => ({ id: item.id, note: item.note, fix: FIXES[item.id] }));
}
