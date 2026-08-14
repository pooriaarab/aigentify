import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { SERVER_SCHEMA_URL } from './constants.js';

export type AuditStatus = 'pass' | 'fail' | 'warn' | 'na';
export interface AuditCheck { id: string; status: AuditStatus; note: string; weight: number }
export interface AuditGap { id: string; note: string; fix: string }
export interface AuditReport { target: string; score: number; checks: AuditCheck[]; gaps: AuditGap[] }
export interface AuditOptions { fetch?: typeof globalThis.fetch }

interface Endpoint { status: number; contentType: string; text: string }
interface Snapshot {
  agents: Endpoint; server: Endpoint; mcp: Endpoint; home: Endpoint; llms: Endpoint; sitemap: Endpoint;
  honestText: string; hasMcp: boolean; networkFailure: boolean;
}

const SKIPPED = new Set(['.git', 'node_modules', 'dist', 'coverage', '.next', '_reference_geoaeo']);
const WEIGHTS: Record<string, number> = {
  'agents-md': 15, 'agents-md-public-safe': 10, 'server-json': 15, mcp: 15,
  'offer-jsonld': 15, 'honest-offer': 10, 'llms-txt': 10, sitemap: 10,
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
  if (value.$schema !== SERVER_SCHEMA_URL) return { valid: false, reason: `server.json must use the exact schema URL ${SERVER_SCHEMA_URL}.` };
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
    honestText, hasMcp: Boolean(mcpFile || serverFile || hasMcpBin), networkFailure: false,
  };
}

async function fetchText(fetcher: typeof globalThis.fetch, url: string): Promise<Endpoint> {
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(8000) });
    return { status: response.status, contentType: response.headers.get('content-type') ?? '', text: await response.text() };
  } catch { return { status: 0, contentType: '', text: '' }; }
}

async function urlSnapshot(target: string, fetcher: typeof globalThis.fetch): Promise<Snapshot> {
  const base = target.replace(/\/+$/, '');
  const [agents, server, mcp, home, llms, sitemap] = await Promise.all([
    fetchText(fetcher, `${base}/agents.md`), fetchText(fetcher, `${base}/server.json`), fetchText(fetcher, `${base}/.well-known/mcp`),
    fetchText(fetcher, base), fetchText(fetcher, `${base}/llms.txt`), fetchText(fetcher, `${base}/sitemap.xml`),
  ]);
  const endpoints = [agents, server, mcp, home, llms, sitemap];
  return { agents, server, mcp, home, llms, sitemap, honestText: [home.text, offerBlock(agents.text)].join('\n'), hasMcp: server.status >= 200 && server.status < 400 || mcp.status >= 200 && mcp.status < 400, networkFailure: endpoints.every(item => item.status === 0) };
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
  return [
    check('agents-md', agentsStatus, agentsPresent ? 'AGENTS.md is available.' : snapshot.agents.status === 0 ? 'The AGENTS.md request failed.' : 'AGENTS.md is missing.'),
    check('agents-md-public-safe', publicStatus, publicStatus === 'pass' ? 'AGENTS.md describes the product as a public surface.' : publicStatus === 'na' ? 'No AGENTS.md is available to inspect.' : 'AGENTS.md contains repository-internal guidance.'),
    check('server-json', serverStatus, serverInfo?.valid ? serverInfo.reason : serverInfo?.reason ?? (!snapshot.hasMcp ? 'No MCP surface was detected.' : 'server.json is missing.')),
    check('mcp', mcpStatus, snapshot.networkFailure ? 'The MCP discovery request failed.' : snapshot.hasMcp ? 'An MCP surface is available.' : 'No MCP surface was found.'),
    check('offer-jsonld', offerStatus, offerStatus === 'pass' ? 'Offer JSON-LD is available.' : offerStatus === 'warn' ? 'The offer could not be checked.' : 'No Offer JSON-LD was found.'),
    check('honest-offer', honestStatus, honestStatus === 'pass' ? 'Offer language states the price without pressure.' : honestStatus === 'na' ? 'No offer or Offer block was found.' : 'Offer language contains scarcity, countdown, or urgency copy.'),
    check('llms-txt', llmsStatus, llmsStatus === 'pass' ? 'llms.txt is available.' : llmsStatus === 'warn' ? 'The llms.txt request failed.' : 'llms.txt is missing.'),
    check('sitemap', sitemapStatus, sitemapStatus === 'pass' ? 'sitemap.xml is available.' : sitemapStatus === 'warn' ? 'The sitemap request failed.' : 'sitemap.xml is missing.'),
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
