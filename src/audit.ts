import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { SERVER_SCHEMA_URL, SERVER_SCHEMA_RE } from './constants.js';

export type AuditStatus = 'pass' | 'fail' | 'warn' | 'na';
export interface AuditCheck { id: string; status: AuditStatus; note: string; weight: number }
export interface AuditGap { id: string; note: string; fix: string }
export interface AuditReport { target: string; score: number; checks: AuditCheck[]; gaps: AuditGap[] }
export interface AuditOptions { fetch?: typeof globalThis.fetch }

interface Endpoint { status: number; contentType: string; text: string; headers?: Record<string, string> }
interface Snapshot {
  agents: Endpoint; server: Endpoint; mcp: Endpoint; home: Endpoint; llms: Endpoint; sitemap: Endpoint;
  wellKnown: Endpoint; openapi: Endpoint; agentsPage: Endpoint;
  // is-agentic-parity signals (URL targets only)
  notFound: Endpoint; homeMarkdown: Endpoint; homeAsAgent: Endpoint;
  // Ora-parity round 2 (URL targets only)
  authMd: Endpoint; apiCatalog: Endpoint; agentCard: Endpoint;
  // External-discovery round 3 (URL targets only)
  aiPlugin: Endpoint; external: ExternalDiscovery;
  honestText: string; hasMcp: boolean; networkFailure: boolean; isUrl: boolean;
}

interface ExternalDiscovery {
  wikidata: boolean; wikidataError: boolean; // a Wikidata item links to this domain via P856 (official website)
  npm: boolean; npmError: boolean; // an npm package matches the product/brand name
  mcpRegistry: boolean; mcpRegistryError: boolean; // an entry in the official MCP registry matches the domain/name
}

const NO_EXTERNAL_DISCOVERY: ExternalDiscovery = {
  wikidata: false, wikidataError: false, npm: false, npmError: false, mcpRegistry: false, mcpRegistryError: false,
};

function ok(status: number): boolean { return status >= 200 && status < 400; }

const SKIPPED = new Set(['.git', 'node_modules', 'dist', 'coverage', '.next', '_reference_geoaeo']);
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

export function scoreAuditChecks(checks: AuditCheck[]): number {
  const relevant = checks.filter(item => item.status !== 'na');
  const total = relevant.reduce((sum, item) => sum + item.weight, 0);
  if (!total) return 0;
  const earned = relevant.reduce((sum, item) => sum + (item.status === 'pass' ? item.weight : item.status === 'warn' ? item.weight / 2 : 0), 0);
  return Math.round((earned / total) * 100);
}

async function walkFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && !SKIPPED.has(entry.name)) files.push(...await walkFiles(path.join(directory, entry.name)));
    else if (entry.isFile()) files.push(path.join(directory, entry.name));
  }
  return files;
}

async function readText(file: string | undefined): Promise<string> {
  if (!file) return '';
  try { return await readFile(file, 'utf8'); } catch { return ''; }
}

function findFile(files: string[], name: string): string | undefined {
  return files.find(file => {
    const normalized = file.replaceAll('\\', '/');
    return path.basename(normalized) === name || normalized.endsWith(`/${name}/route.ts`);
  });
}

function parseJson(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

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

function offerBlock(text: string): string {
  const match = /^#+\s*Offer\b/im.exec(text);
  if (!match || match.index === undefined) return '';
  const rest = text.slice(match.index);
  const nextHeading = /^#+\s+/m.exec(rest.slice(match[0].length));
  return nextHeading?.index === undefined ? rest : rest.slice(0, match[0].length + nextHeading.index);
}

async function directorySnapshot(directory: string): Promise<Snapshot> {
  const files = await walkFiles(directory);
  const agentsFile = findFile(files, 'AGENTS.md');
  const serverFile = findFile(files, 'server.json');
  const mcpFile = files.find(file => /(?:^|\/)\.mcp\.json$/.test(file.replaceAll('\\', '/')));
  const packageFile = findFile(files, 'package.json');
  const packageText = await readText(packageFile);
  const hasMcpBin = /"(?:aigentify|[^"\n]*mcp[^"\n]*)"\s*:/i.test(packageText);
  const agentsText = await readText(agentsFile);
  const offerTexts = [agentsText, ...await Promise.all(files.filter(file => /\.(html?|json|jsonld|md|mdx|tsx|jsx|js|mjs|ts)$/.test(file)).map(readText))];
  const llmsFile = findFile(files, 'llms.txt');
  const sitemapFile = findFile(files, 'sitemap.xml');
  const offerFiles = files.filter(file => /\.jsonld$|(?:^|\/)offer[^/]*\.(?:json|html?)$/i.test(file));
  const honestText = [offerBlock(agentsText), ...await Promise.all(offerFiles.map(readText))].join('\n');
  return {
    agents: { status: agentsFile ? 200 : 404, contentType: 'text/markdown', text: agentsText },
    server: { status: serverFile ? 200 : 404, contentType: 'application/json', text: await readText(serverFile) },
    mcp: { status: mcpFile || serverFile || hasMcpBin ? 200 : 404, contentType: '', text: '' },
    home: { status: 200, contentType: 'text/plain', text: offerTexts.join('\n') },
    llms: { status: llmsFile ? 200 : 404, contentType: 'text/plain', text: await readText(llmsFile) },
    sitemap: { status: sitemapFile ? 200 : 404, contentType: 'application/xml', text: await readText(sitemapFile) },
    // advanced web signals are not meaningful for a repo directory — audited only for URL targets
    wellKnown: { status: 404, contentType: '', text: '' }, openapi: { status: 404, contentType: '', text: '' }, agentsPage: { status: 404, contentType: '', text: '' },
    notFound: { status: 404, contentType: '', text: '' }, homeMarkdown: { status: 404, contentType: '', text: '' }, homeAsAgent: { status: 404, contentType: '', text: '' },
    authMd: { status: 404, contentType: '', text: '' }, apiCatalog: { status: 404, contentType: '', text: '' }, agentCard: { status: 404, contentType: '', text: '' },
    aiPlugin: { status: 404, contentType: '', text: '' }, external: NO_EXTERNAL_DISCOVERY,
    honestText, hasMcp: Boolean(mcpFile || serverFile || hasMcpBin), networkFailure: false, isUrl: false,
  };
}

async function fetchText(fetcher: typeof globalThis.fetch, url: string, init?: RequestInit): Promise<Endpoint> {
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(8000), ...init });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
    return { status: response.status, contentType: response.headers.get('content-type') ?? '', text: await response.text(), headers };
  } catch { return { status: 0, contentType: '', text: '', headers: {} }; }
}

/** The product/brand name — from the A2A agent card, else the homepage <title>. */
function productName(agentCard: Endpoint, home: Endpoint): string | null {
  const card = parseJson(agentCard.text);
  if (card && typeof card.name === 'string' && card.name.trim()) return card.name.trim();
  const title = /<title[^>]*>([^<]{2,120})<\/title>/i.exec(home.text)?.[1]?.trim();
  // Drop a trailing " | tagline" / " - tagline" so "Content Rabbit | ..." → "Content Rabbit".
  return title ? title.split(/\s[|–—-]\s/)[0].trim() : null;
}

// Wikimedia and other registries require a descriptive User-Agent with a contact URL.
const EXTERNAL_UA = 'aigentify/0.4 (+https://github.com/pooriaarab/aigentify)';

// Sentinel distinguishing "the registry call failed" (rate-limited, timed out, 5xx) from
// "the registry answered and the product isn't listed" — the two must not be conflated,
// or a transient 429 gets reported as a confirmed "not discoverable" gap.
const REGISTRY_ERROR = Symbol('registry-error');

async function fetchJson(fetcher: typeof globalThis.fetch, url: string): Promise<unknown> {
  try {
    const res = await fetcher(url, {
      signal: AbortSignal.timeout(8000),
      headers: { accept: 'application/json', 'user-agent': EXTERNAL_UA },
    });
    if (!ok(res.status)) return REGISTRY_ERROR;
    return await res.json();
  } catch {
    return REGISTRY_ERROR;
  }
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Registered host of a URL, www-stripped; '' if unparsable. Used for exact (not substring) host matches. */
function safeHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

/** Query third-party registries for the product — this is what makes aigentify a superset of Ora. */
async function probeExternalDiscovery(
  fetcher: typeof globalThis.fetch,
  base: string,
  name: string | null,
): Promise<ExternalDiscovery> {
  const host = (() => {
    try {
      return new URL(base).host.replace(/^www\./, '');
    } catch {
      return base;
    }
  })();
  const productNorm = name ? normalize(name) : '';
  const hostLabelNorm = normalize(host.split('.')[0]);
  const wantNorms = [productNorm, hostLabelNorm].filter(Boolean);

  // Wikidata: an item whose official-website (P856) links to this domain. The
  // main API's haswbstatement search is more reliable than the WDQS SPARQL
  // endpoint (which rate-limits and rejects generic User-Agents). P856 values in
  // the wild vary in scheme/www/trailing-slash, so probe the common variants.
  const wikidataVariants = ['https://', 'http://'].flatMap((scheme) =>
    [host, `www.${host}`].flatMap((h) => ['', '/'].map((slash) => `${scheme}${h}${slash}`)),
  );
  const wikidataP = Promise.all(
    wikidataVariants.map((val) =>
      fetchJson(
        fetcher,
        `https://www.wikidata.org/w/api.php?action=query&list=search&format=json&srsearch=${encodeURIComponent(
          `haswbstatement:P856=${val}`,
        )}`,
      ),
    ),
  ).then((results) => ({
    found: results.some(
      (d) => d !== REGISTRY_ERROR && ((d as { query?: { searchinfo?: { totalhits?: number } } })?.query?.searchinfo?.totalhits ?? 0) > 0,
    ),
    errored: results.every((d) => d === REGISTRY_ERROR),
  }));

  // npm: a package whose scope/name exactly matches the product or host label, or
  // whose homepage's hostname exactly equals the target host (not a raw substring —
  // that would match e.g. an unrelated "example.com.evil.test" homepage or any
  // package that happens to contain a generic host label like "app").
  const npmQuery = name ?? host.split('.')[0];
  const npmP = fetchJson(fetcher, `https://registry.npmjs.org/-/v1/search?size=20&text=${encodeURIComponent(npmQuery)}`).then((d) => {
    if (d === REGISTRY_ERROR) return { found: false, errored: true };
    const rawObjects = (d as { objects?: unknown })?.objects;
    const objects = Array.isArray(rawObjects) ? (rawObjects as { package?: { name?: string; links?: { homepage?: string } } }[]) : [];
    const found = objects.some((o) => {
      const pkgName = (o.package?.name ?? '').toLowerCase();
      if (!pkgName) return false;
      const scope = /^@([^/]+)\//.exec(pkgName)?.[1] ?? '';
      const unscoped = pkgName.replace(/^@[^/]+\//, '');
      const candidates = [pkgName, unscoped, scope].filter(Boolean).map(normalize);
      const nameMatches = candidates.some((c) => wantNorms.includes(c));
      const homepageHost = safeHost(o.package?.links?.homepage ?? '');
      return nameMatches || (homepageHost !== '' && homepageHost === host);
    });
    return { found, errored: false };
  });

  // MCP registry: a server entry whose (short) name normalizes to the product/host,
  // or whose websiteUrl/repository hostname exactly equals the target host. The
  // registry search tokenizes on hyphens, so search by the slug form ("Content
  // Rabbit" -> "content-rabbit") as well as the raw host.
  const slug = (name ?? host.split('.')[0]).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const mcpP = Promise.all(
    [slug, host].map((q) => fetchJson(fetcher, `https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(q)}`)),
  ).then((results) => ({
    found: results.some((d) => {
      if (d === REGISTRY_ERROR) return false;
      const rawServers = (d as { servers?: unknown })?.servers;
      const servers = Array.isArray(rawServers) ? rawServers : [];
      return servers.some((entry) => {
        const server = ((entry as { server?: Record<string, unknown> })?.server ?? entry) as Record<string, unknown>;
        const rawName = String(server?.name ?? '');
        const shortName = rawName.includes('/') ? rawName.slice(rawName.lastIndexOf('/') + 1) : rawName;
        const websiteHost = safeHost(String(server?.websiteUrl ?? ''));
        const repoHost = safeHost(String((server?.repository as { url?: string } | undefined)?.url ?? ''));
        return wantNorms.includes(normalize(shortName)) || websiteHost === host || repoHost === host;
      });
    }),
    errored: results.every((d) => d === REGISTRY_ERROR),
  }));

  const [wikidata, npm, mcpRegistry] = await Promise.all([wikidataP, npmP, mcpP]);
  return {
    wikidata: wikidata.found, wikidataError: wikidata.errored,
    npm: npm.found, npmError: npm.errored,
    mcpRegistry: mcpRegistry.found, mcpRegistryError: mcpRegistry.errored,
  };
}

async function urlSnapshot(target: string, fetcher: typeof globalThis.fetch): Promise<Snapshot> {
  const base = target.replace(/\/+$/, '');
  // A path no real site serves — used to detect soft-404s (200 + app shell).
  const missingPath = `${base}/aigentify-probe-${'x'.repeat(8)}-404`;
  const [agents, server, mcp, home, llms, sitemap, wellKnown, wellKnownCard, openapi, agentsPage,
    notFound, homeMarkdown, homeAsAgent, authMd, apiCatalog, aiPlugin] = await Promise.all([
    fetchText(fetcher, `${base}/agents.md`), fetchText(fetcher, `${base}/server.json`), fetchText(fetcher, `${base}/.well-known/mcp`),
    fetchText(fetcher, base), fetchText(fetcher, `${base}/llms.txt`), fetchText(fetcher, `${base}/sitemap.xml`),
    fetchText(fetcher, `${base}/.well-known/agent.json`), fetchText(fetcher, `${base}/.well-known/agent-card.json`),
    fetchText(fetcher, `${base}/openapi.json`), fetchText(fetcher, `${base}/agents`),
    fetchText(fetcher, missingPath),
    fetchText(fetcher, base, { headers: { accept: 'text/markdown' } }),
    fetchText(fetcher, base, { headers: { 'user-agent': 'ora-agent' } }),
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
  return { agents, server, mcp, home, llms, sitemap, wellKnown: wk, openapi, agentsPage,
    notFound, homeMarkdown, homeAsAgent, authMd, apiCatalog, agentCard, aiPlugin, external,
    honestText: [home.text, offerBlock(agents.text)].join('\n'), hasMcp: server.status >= 200 && server.status < 400 || mcp.status >= 200 && mcp.status < 400, networkFailure: endpoints.every(item => item.status === 0), isUrl: true };
}

function looksMarkdown(endpoint: Endpoint): boolean {
  const varyAccept = /(^|,)\s*accept\s*($|,)/i.test(endpoint.headers?.vary ?? '');
  return ok(endpoint.status) && /text\/markdown/i.test(endpoint.contentType) && varyAccept;
}

function hasBodyContent(html: string): boolean {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const hasH1 = /<h1[\s>]/i.test(stripped);
  const textOnly = stripped.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return hasH1 && textOnly.length >= 500;
}

function collectJsonLdNodes(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(collectJsonLdNodes);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const graph = record['@graph'];
    return Array.isArray(graph) ? graph.flatMap(collectJsonLdNodes) : [record];
  }
  return [];
}

function isMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function isOrganizationNode(node: Record<string, unknown>): boolean {
  const type = node['@type'];
  return type === 'Organization' || (Array.isArray(type) && type.includes('Organization'));
}

function orgSchemaStatus(html: string): 'pass' | 'warn' {
  const blocks = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  const nodes = blocks.flatMap(block => {
    try { return collectJsonLdNodes(JSON.parse(block)); } catch { return []; }
  });
  const orgNodes = nodes.filter(isOrganizationNode);
  if (!orgNodes.length) return 'warn';
  return orgNodes.some(node => isMeaningfulValue(node.contactPoint) && isMeaningfulValue(node.address)) ? 'pass' : 'warn';
}

function looksLikeHomepage(agentResponse: Endpoint, home: Endpoint): boolean {
  if (!ok(agentResponse.status)) return false;
  if (/captcha|access denied|are you a (?:human|robot)|checking your browser|request blocked/i.test(agentResponse.text)) return false;
  if (!ok(home.status) || !home.text.trim()) return agentResponse.text.trim().length > 0;
  return agentResponse.text.length >= home.text.length * 0.5;
}

function hasRateLimitHeaders(endpoints: Endpoint[]): boolean {
  return endpoints.some(endpoint => {
    if (!ok(endpoint.status)) return false;
    const keys = Object.keys(endpoint.headers ?? {});
    const has = (name: string) => keys.some(key => new RegExp(`^(x-)?ratelimit-${name}$`, 'i').test(key));
    return has('limit') && has('remaining') && has('reset');
  });
}

function buildChecks(snapshot: Snapshot): AuditCheck[] {
  const agentsPresent = snapshot.agents.status === 200 && snapshot.agents.text.trim().length > 0 && /(?:text\/(?:markdown|plain)|application\/markdown)/i.test(snapshot.agents.contentType);
  const agentsStatus: AuditStatus = snapshot.agents.status === 0 ? 'warn' : agentsPresent ? 'pass' : 'fail';
  const publicStatus: AuditStatus = !agentsPresent ? (snapshot.agents.status === 0 ? 'warn' : 'na') : publicSafe(snapshot.agents.text) ? 'pass' : 'warn';
  const serverInfo = snapshot.server.status === 200 ? validServer(snapshot.server.text) : undefined;
  const serverStatus: AuditStatus = snapshot.server.status === 0 ? 'warn' : !snapshot.hasMcp ? 'na' : serverInfo?.valid ? 'pass' : 'fail';
  const mcpStatus: AuditStatus = snapshot.networkFailure ? 'warn' : snapshot.hasMcp ? 'pass' : 'fail';
  const offerTexts = [snapshot.home.text, snapshot.agents.text];
  const offerStatus: AuditStatus = snapshot.home.status === 0 ? 'warn' : hasOffer(offerTexts) ? 'pass' : 'fail';
  const honestStatus: AuditStatus = !hasOffer(offerTexts) && !agentsPresent ? (snapshot.home.status === 0 ? 'warn' : 'na') : hasUrgency(snapshot.honestText) ? 'warn' : 'pass';
  const llmsStatus: AuditStatus = snapshot.llms.status === 0 ? 'warn' : snapshot.llms.status >= 200 && snapshot.llms.status < 400 && snapshot.llms.text.trim() ? 'pass' : 'fail';
  const sitemapStatus: AuditStatus = snapshot.sitemap.status === 0 ? 'warn' : snapshot.sitemap.status >= 200 && snapshot.sitemap.status < 400 && snapshot.sitemap.text.trim() ? 'pass' : 'fail';
  // advanced world-class signals: only meaningful for a served web product (URL target)
  const advanced = (endpoint: Endpoint): AuditStatus => !snapshot.isUrl || snapshot.networkFailure ? 'na' : ok(endpoint.status) ? 'pass' : 'warn';
  const wellKnownStatus = advanced(snapshot.wellKnown);
  const openapiStatus = advanced(snapshot.openapi);
  const agentsPageStatus = advanced(snapshot.agentsPage);
  // is-agentic-parity signals: URL-only. na for directories or total network failure.
  const urlOnly = snapshot.isUrl && !snapshot.networkFailure;
  const soft404Status: AuditStatus = !urlOnly ? 'na'
    : snapshot.notFound.status === 404 || snapshot.notFound.status === 410 ? 'pass'
    : ok(snapshot.notFound.status) ? 'fail'
    : 'warn';
  const markdownStatus: AuditStatus = !urlOnly ? 'na' : looksMarkdown(snapshot.homeMarkdown) ? 'pass' : 'warn';
  const contentStatus: AuditStatus = !urlOnly ? 'na' : !ok(snapshot.home.status) ? 'warn' : hasBodyContent(snapshot.home.text) ? 'pass' : 'warn';
  const orgStatus: AuditStatus = !urlOnly ? 'na' : !ok(snapshot.home.status) ? 'warn' : orgSchemaStatus(snapshot.home.text);
  const crawlerStatus: AuditStatus = !urlOnly ? 'na' : looksLikeHomepage(snapshot.homeAsAgent, snapshot.home) ? 'pass' : 'warn';
  const rateLimitStatus: AuditStatus = !urlOnly ? 'na' : hasRateLimitHeaders([snapshot.openapi, snapshot.server, snapshot.home]) ? 'pass' : 'warn';
  const authMdStatus: AuditStatus = !urlOnly ? 'na'
    : ok(snapshot.authMd.status) && snapshot.authMd.text.trim().length > 0
      && (/text\/markdown/i.test(snapshot.authMd.contentType) || snapshot.authMd.text.trimStart().startsWith('#')) ? 'pass' : 'warn';
  const apiCatalogStatus: AuditStatus = !urlOnly ? 'na'
    : ok(snapshot.apiCatalog.status) && Array.isArray(parseJson(snapshot.apiCatalog.text)?.linkset) ? 'pass' : 'warn';
  const agentCardStatus: AuditStatus = !urlOnly ? 'na' : (() => {
    if (!ok(snapshot.agentCard.status)) return 'warn';
    const card = parseJson(snapshot.agentCard.text);
    return card && typeof card.name === 'string' && card.name.trim().length > 0
      && typeof card.url === 'string' && card.url.trim().length > 0 ? 'pass' : 'warn';
  })();
  const linkHeadersStatus: AuditStatus = !urlOnly ? 'na'
    : /llms\.txt|openapi\.json|agent-card|\.well-known/i.test(snapshot.home.headers?.link ?? '') ? 'pass' : 'warn';
  const markdownAltStatus: AuditStatus = !urlOnly ? 'na'
    : [...snapshot.home.text.matchAll(/<link\b[^>]*>/gi)].some(([tag]) =>
        /rel=["']?alternate["']?/i.test(tag) && /type=["']?text\/markdown/i.test(tag)) ? 'pass' : 'warn';
  // External-discovery round 3 — third-party registry lookups.
  // A manifest must identify itself — an empty `{}` (or any object lacking these) isn't a usable plugin descriptor.
  const aiPluginManifest: Record<string, unknown> = (ok(snapshot.aiPlugin.status) ? parseJson(snapshot.aiPlugin.text) : undefined) ?? {};
  const aiPluginStatus: AuditStatus = !urlOnly ? 'na'
    : ['schema_version', 'name_for_model', 'name_for_human', 'api', 'auth'].some((key) => {
        const value = aiPluginManifest[key];
        return typeof value === 'string' ? value.trim().length > 0 : typeof value === 'object' && value !== null;
      }) ? 'pass' : 'warn';
  const wikidataStatus: AuditStatus = !urlOnly ? 'na' : snapshot.external.wikidata ? 'pass' : 'warn';
  const npmStatus: AuditStatus = !urlOnly ? 'na' : snapshot.external.npm ? 'pass' : 'warn';
  const mcpRegistryStatus: AuditStatus = !urlOnly ? 'na' : snapshot.external.mcpRegistry ? 'pass' : 'warn';
  return [
    check('agents-md', agentsStatus, agentsPresent ? 'AGENTS.md is available.' : snapshot.agents.status === 0 ? 'The AGENTS.md request failed.' : 'AGENTS.md is missing.'),
    check('agents-md-public-safe', publicStatus, publicStatus === 'pass' ? 'AGENTS.md describes the product as a public surface.' : publicStatus === 'na' ? 'No AGENTS.md is available to inspect.' : 'AGENTS.md contains repository-internal guidance.'),
    check('server-json', serverStatus, serverInfo?.valid ? serverInfo.reason : serverInfo?.reason ?? (!snapshot.hasMcp ? 'No MCP surface was detected.' : 'server.json is missing.')),
    check('mcp', mcpStatus, snapshot.networkFailure ? 'The MCP discovery request failed.' : snapshot.hasMcp ? 'An MCP surface is available.' : 'No MCP surface was found.'),
    check('offer-jsonld', offerStatus, offerStatus === 'pass' ? 'Offer JSON-LD is available.' : offerStatus === 'warn' ? 'The offer could not be checked.' : 'No Offer JSON-LD was found.'),
    check('honest-offer', honestStatus, honestStatus === 'pass' ? 'Offer language states the price without pressure.' : honestStatus === 'na' ? 'No offer or Offer block was found.' : 'Offer language contains scarcity, countdown, or urgency copy.'),
    check('llms-txt', llmsStatus, llmsStatus === 'pass' ? 'llms.txt is available.' : llmsStatus === 'warn' ? 'The llms.txt request failed.' : 'llms.txt is missing.'),
    check('sitemap', sitemapStatus, sitemapStatus === 'pass' ? 'sitemap.xml is available.' : sitemapStatus === 'warn' ? 'The sitemap request failed.' : 'sitemap.xml is missing.'),
    check('well-known-agent', wellKnownStatus, wellKnownStatus === 'pass' ? 'A .well-known agent manifest is available.' : wellKnownStatus === 'na' ? 'Not audited (no served web surface).' : 'No /.well-known/agent.json manifest was found.'),
    check('openapi', openapiStatus, openapiStatus === 'pass' ? 'openapi.json is available.' : openapiStatus === 'na' ? 'Not audited (no served web surface).' : 'No /openapi.json was found.'),
    check('agents-page', agentsPageStatus, agentsPageStatus === 'pass' ? 'An /agents page is available.' : agentsPageStatus === 'na' ? 'Not audited (no served web surface).' : 'No /agents onboarding page was found.'),
    check('soft-404', soft404Status, soft404Status === 'pass' ? 'Unknown paths return a real 404.' : soft404Status === 'na' ? 'Not audited (no served web surface).' : soft404Status === 'warn' ? 'The 404 probe was inconclusive (no response, or a non-404/410 error status).' : 'Unknown paths return 200 with the app shell (soft-404).'),
    check('markdown-negotiation', markdownStatus, markdownStatus === 'pass' ? 'The homepage serves text/markdown with Vary: Accept.' : markdownStatus === 'na' ? 'Not audited (no served web surface).' : 'The homepage does not serve markdown on Accept: text/markdown with a Vary: Accept header.'),
    check('content-without-js', contentStatus, contentStatus === 'pass' ? 'The homepage renders an H1 and substantial text without JS.' : contentStatus === 'na' ? 'Not audited (no served web surface).' : 'The homepage lacks an H1 or enough server-rendered text.'),
    check('org-schema', orgStatus, orgStatus === 'pass' ? 'Organization JSON-LD includes contactPoint and address.' : orgStatus === 'na' ? 'Not audited (no served web surface).' : 'Organization JSON-LD is missing or lacks contactPoint/address.'),
    check('crawler-reachable', crawlerStatus, crawlerStatus === 'pass' ? 'The homepage is reachable by an agent User-Agent.' : crawlerStatus === 'na' ? 'Not audited (no served web surface).' : 'An agent User-Agent could not reach the homepage.'),
    check('rate-limit-headers', rateLimitStatus, rateLimitStatus === 'pass' ? 'Standard rate-limit headers are present.' : rateLimitStatus === 'na' ? 'Not audited (no served web surface).' : 'No RateLimit-* headers were found on probed endpoints.'),
    check('auth-md', authMdStatus, authMdStatus === 'pass' ? '/auth.md is available.' : authMdStatus === 'na' ? 'Not audited (no served web surface).' : 'No /auth.md agent-auth guide was found.'),
    check('api-catalog', apiCatalogStatus, apiCatalogStatus === 'pass' ? '/.well-known/api-catalog is available.' : apiCatalogStatus === 'na' ? 'Not audited (no served web surface).' : 'No /.well-known/api-catalog (RFC 9727) was found.'),
    check('agent-card-a2a', agentCardStatus, agentCardStatus === 'pass' ? 'An A2A agent-card.json is available.' : agentCardStatus === 'na' ? 'Not audited (no served web surface).' : 'No valid /.well-known/agent-card.json (A2A) was found.'),
    check('link-headers', linkHeadersStatus, linkHeadersStatus === 'pass' ? 'The homepage returns RFC 8288 Link headers.' : linkHeadersStatus === 'na' ? 'Not audited (no served web surface).' : 'No Link header was found on the homepage.'),
    check('markdown-alt', markdownAltStatus, markdownAltStatus === 'pass' ? 'The homepage advertises a markdown alternate link.' : markdownAltStatus === 'na' ? 'Not audited (no served web surface).' : 'No <link rel="alternate" type="text/markdown"> was found.'),
    check('ai-plugin', aiPluginStatus, aiPluginStatus === 'pass' ? 'A /.well-known/ai-plugin.json manifest is available.' : aiPluginStatus === 'na' ? 'Not audited (no served web surface).' : 'No usable /.well-known/ai-plugin.json manifest was found (missing, empty, or lacking identifying fields).'),
    check('wikidata', wikidataStatus, wikidataStatus === 'pass' ? 'A Wikidata item links to this domain (P856).' : wikidataStatus === 'na' ? 'Not audited (no served web surface).' : snapshot.external.wikidataError ? 'The Wikidata lookup could not be completed (registry error or timeout) — not a confirmed gap.' : 'No Wikidata item links to this domain via official website (P856).'),
    check('npm-package', npmStatus, npmStatus === 'pass' ? 'A matching npm package is published.' : npmStatus === 'na' ? 'Not audited (no served web surface).' : snapshot.external.npmError ? 'The npm registry lookup could not be completed (registry error or timeout) — not a confirmed gap.' : 'No npm package matching the product was found.'),
    check('mcp-registry', mcpRegistryStatus, mcpRegistryStatus === 'pass' ? 'Listed in the official MCP registry.' : mcpRegistryStatus === 'na' ? 'Not audited (no served web surface).' : snapshot.external.mcpRegistryError ? 'The MCP registry lookup could not be completed (registry error or timeout) — not a confirmed gap.' : 'No entry matching this product was found in the official MCP registry.'),
  ];
}

export async function auditTarget(target: string, options: AuditOptions = {}): Promise<AuditReport> {
  const targetStat = await stat(target).catch(() => undefined);
  const snapshot = targetStat?.isDirectory() ? await directorySnapshot(target) : await urlSnapshot(target, options.fetch ?? globalThis.fetch);
  const checks = buildChecks(snapshot);
  const gaps = checks.filter(item => item.status === 'fail' || item.status === 'warn').map(item => ({ id: item.id, note: item.note, fix: FIXES[item.id] }));
  return { target, score: scoreAuditChecks(checks), checks, gaps };
}

export function formatAuditReport(report: AuditReport): string {
  const lines = [`${report.target}: ${report.score}/100`, ''];
  for (const item of report.checks) lines.push(`${item.status.toUpperCase().padEnd(4)}  ${item.id}: ${item.note}`);
  lines.push('', 'Gaps:');
  if (!report.gaps.length) lines.push('None.');
  else report.gaps.forEach((gap, index) => lines.push(`${index + 1}. ${gap.id}: ${gap.fix}`));
  return lines.join('\n');
}
