import type { ExternalDiscovery } from './types.js';
import { ok } from './shared.js';

interface ProbeResult { found: boolean; errored: boolean }

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

function targetHost(base: string): string {
  try {
    return new URL(base).host.replace(/^www\./, '');
  } catch {
    return base;
  }
}

// A "not found" verdict is only confirmed if every variant was actually checked —
// if some variants errored out, an unchecked one could still have matched.
function probeOutcome(results: unknown[], hit: (d: unknown) => boolean): ProbeResult {
  const found = results.some(hit);
  return { found, errored: !found && results.some((d) => d === REGISTRY_ERROR) };
}

function wikidataHit(d: unknown): boolean {
  if (d === REGISTRY_ERROR) return false;
  const hits = (d as { query?: { searchinfo?: { totalhits?: number } } })?.query?.searchinfo?.totalhits ?? 0;
  return hits > 0;
}

// Wikidata: an item whose official-website (P856) links to this domain. The
// main API's haswbstatement search is more reliable than the WDQS SPARQL
// endpoint (which rate-limits and rejects generic User-Agents). P856 values in
// the wild vary in scheme/www/trailing-slash, so probe the common variants.
async function probeWikidata(fetcher: typeof globalThis.fetch, host: string): Promise<ProbeResult> {
  const wikidataVariants = ['https://', 'http://'].flatMap((scheme) =>
    [host, `www.${host}`].flatMap((h) => ['', '/'].map((slash) => `${scheme}${h}${slash}`)),
  );
  const results = await Promise.all(
    wikidataVariants.map((val) =>
      fetchJson(
        fetcher,
        `https://www.wikidata.org/w/api.php?action=query&list=search&format=json&srsearch=${encodeURIComponent(
          `haswbstatement:P856=${val}`,
        )}`,
      ),
    ),
  );
  return probeOutcome(results, wikidataHit);
}

function npmNameCandidates(pkgName: string): string[] {
  const scope = /^@([^/]+)\//.exec(pkgName)?.[1] ?? '';
  const unscoped = pkgName.replace(/^@[^/]+\//, '');
  return [pkgName, unscoped, scope].filter(Boolean).map(normalize);
}

function npmHomepageMatches(o: { package?: { links?: { homepage?: string } } }, host: string): boolean {
  const homepageHost = safeHost(o.package?.links?.homepage ?? '');
  return homepageHost !== '' && homepageHost === host;
}

function npmPackageMatches(
  o: { package?: { name?: string; links?: { homepage?: string } } },
  wantNorms: string[],
  host: string,
): boolean {
  const pkgName = (o.package?.name ?? '').toLowerCase();
  if (!pkgName) return false;
  const nameMatches = npmNameCandidates(pkgName).some((c) => wantNorms.includes(c));
  return nameMatches || npmHomepageMatches(o, host);
}

// npm: a package whose scope/name exactly matches the product or host label, or
// whose homepage's hostname exactly equals the target host (not a raw substring —
// that would match e.g. an unrelated "example.com.evil.test" homepage or any
// package that happens to contain a generic host label like "app").
async function probeNpm(
  fetcher: typeof globalThis.fetch,
  host: string,
  name: string | null,
  wantNorms: string[],
): Promise<ProbeResult> {
  const npmQuery = name ?? host.split('.')[0];
  const d = await fetchJson(fetcher, `https://registry.npmjs.org/-/v1/search?size=20&text=${encodeURIComponent(npmQuery)}`);
  if (d === REGISTRY_ERROR) return { found: false, errored: true };
  const rawObjects = (d as { objects?: unknown })?.objects;
  const objects = Array.isArray(rawObjects) ? (rawObjects as { package?: { name?: string; links?: { homepage?: string } } }[]) : [];
  return { found: objects.some((o) => npmPackageMatches(o, wantNorms, host)), errored: false };
}

function mcpServerRecord(entry: unknown): Record<string, unknown> {
  return ((entry as { server?: Record<string, unknown> })?.server ?? entry) as Record<string, unknown>;
}

function mcpShortName(server: Record<string, unknown>): string {
  const rawName = String(server?.name ?? '');
  return rawName.includes('/') ? rawName.slice(rawName.lastIndexOf('/') + 1) : rawName;
}

function mcpHostMatches(server: Record<string, unknown>, host: string): boolean {
  const websiteHost = safeHost(String(server?.websiteUrl ?? ''));
  const repoHost = safeHost(String((server?.repository as { url?: string } | undefined)?.url ?? ''));
  return websiteHost === host || repoHost === host;
}

function mcpEntryMatches(entry: unknown, wantNorms: string[], host: string): boolean {
  const server = mcpServerRecord(entry);
  return wantNorms.includes(normalize(mcpShortName(server))) || mcpHostMatches(server, host);
}

function mcpResultHit(d: unknown, wantNorms: string[], host: string): boolean {
  if (d === REGISTRY_ERROR) return false;
  const rawServers = (d as { servers?: unknown })?.servers;
  const servers = Array.isArray(rawServers) ? rawServers : [];
  return servers.some((entry) => mcpEntryMatches(entry, wantNorms, host));
}

// MCP registry: a server entry whose (short) name normalizes to the product/host,
// or whose websiteUrl/repository hostname exactly equals the target host. The
// registry search tokenizes on hyphens, so search by the slug form ("Content
// Rabbit" -> "content-rabbit") as well as the raw host.
async function probeMcpRegistry(
  fetcher: typeof globalThis.fetch,
  host: string,
  name: string | null,
  wantNorms: string[],
): Promise<ProbeResult> {
  const slug = (name ?? host.split('.')[0]).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const results = await Promise.all(
    [slug, host].map((q) => fetchJson(fetcher, `https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(q)}`)),
  );
  // Same rationale as the Wikidata lookup above: a "not found" verdict needs every query checked.
  return probeOutcome(results, (d) => mcpResultHit(d, wantNorms, host));
}

/** Query third-party registries for the product — this is what makes aigentify a superset of Ora. */
export async function probeExternalDiscovery(
  fetcher: typeof globalThis.fetch,
  base: string,
  name: string | null,
): Promise<ExternalDiscovery> {
  const host = targetHost(base);
  const productNorm = name ? normalize(name) : '';
  const hostLabelNorm = normalize(host.split('.')[0]);
  const wantNorms = [productNorm, hostLabelNorm].filter(Boolean);

  const [wikidata, npm, mcpRegistry] = await Promise.all([
    probeWikidata(fetcher, host),
    probeNpm(fetcher, host, name, wantNorms),
    probeMcpRegistry(fetcher, host, name, wantNorms),
  ]);
  return {
    wikidata: wikidata.found, wikidataError: wikidata.errored,
    npm: npm.found, npmError: npm.errored,
    mcpRegistry: mcpRegistry.found, mcpRegistryError: mcpRegistry.errored,
  };
}
