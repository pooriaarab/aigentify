import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditTarget } from '../src/audit.js';
import { generate } from '../src/generators/index.js';

const fixtures = path.resolve('tests/fixtures');

function check(report: Awaited<ReturnType<typeof auditTarget>>, id: string) {
  const value = report.checks.find(item => item.id === id);
  if (!value) throw new Error(`Missing check ${id}`);
  return value;
}

describe('auditTarget', () => {
  it('scores the good directory fixture as ready', async () => {
    const report = await auditTarget(path.join(fixtures, 'good'));
    expect(report.score).toBe(100);
    expect(report.gaps).toEqual([]);
    expect(check(report, 'agents-md').status).toBe('pass');
    expect(check(report, 'server-json').status).toBe('pass');
  });

  it('reports gaps for the bad directory fixture', async () => {
    const report = await auditTarget(path.join(fixtures, 'bad'));
    expect(report.score).toBeLessThan(100);
    expect(check(report, 'agents-md').status).toBe('fail');
    expect(check(report, 'mcp').status).toBe('fail');
    expect(report.gaps.some(gap => gap.id === 'agents-md' && gap.fix.includes('AGENTS.md'))).toBe(true);
  });

  it('flags a server.json that uses the retired schema URL', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'agentify-schema-'));
    await writeFile(path.join(directory, 'server.json'), JSON.stringify({
      $schema: 'https://static.modelcontextprotocol.io/schemas/2025-07-09/server.json',
      name: 'io.example/server', description: 'Example', repository: {url: 'https://example.com', source: 'github'}, version: '1.0.0', packages: [],
    }));
    const report = await auditTarget(directory);
    expect(check(report, 'server-json').status).toBe('fail');
    expect(check(report, 'server-json').note).toContain('https://static.modelcontextprotocol.io/schemas/2025-07-09/server.schema.json');
  });

  it('warns when an offer uses pressure copy', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'agentify-offer-'));
    await writeFile(path.join(directory, 'AGENTS.md'), '# Product\n\n## Offer\n\nLimited time: act now.');
    await writeFile(path.join(directory, 'offer.jsonld'), '{"@type":"Offer","name":"Access","price":"10"}');
    const report = await auditTarget(directory);
    expect(check(report, 'offer-jsonld').status).toBe('pass');
    expect(check(report, 'honest-offer').status).toBe('warn');
  });

  it('audits a URL with an injected fetch implementation', async () => {
    const base = 'https://example.com';
    const server = generate('server-json', { name: 'Example product', description: 'An example agent product', repository: 'https://github.com/example/product', npmPackage: 'example-product', version: '1.0.0' });
    const agents = '# Example product\n\n## Offer\n\nPrice: USD 0';
    const html = '<html><head><script type="application/ld+json">{"@type":"Offer","price":"0"}</script></head><body></body></html>';
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === `${base}/agents.md`) return new Response(agents, {status: 200, headers: {'content-type': 'text/markdown'}});
      if (url === `${base}/server.json`) return new Response(server, {status: 200, headers: {'content-type': 'application/json'}});
      if (url === `${base}/.well-known/mcp`) return new Response('', {status: 404});
      if (url === base) return new Response(html, {status: 200, headers: {'content-type': 'text/html'}});
      if (url === `${base}/llms.txt`) return new Response('# Example product', {status: 200});
      if (url === `${base}/sitemap.xml`) return new Response('<urlset />', {status: 200});
      return new Response('', {status: 404});
    };
    const report = await auditTarget(base, { fetch: fetcher });
    expect(report.score).toBe(100);
    expect(report.gaps).toEqual([]);
  });
});

describe('generators', () => {
  const params = { name: 'Example product', description: 'A clear product description.', repository: 'https://github.com/example/product', npmPackage: 'example-product', offer: { price: 12, priceCurrency: 'USD' } };

  it('generates an agent instructions document with every required section', () => {
    const output = generate('agents-md', params);
    for (const section of ['Mental model', 'The faces', 'MCP tools', 'The loop', 'Rules', 'Offer']) expect(output).toContain(`## ${section}`);
    expect(output).not.toMatch(/limited time|act now|countdown/i);
  });

  it('generates valid server and offer JSON', () => {
    const server = JSON.parse(generate('server-json', params)) as Record<string, unknown>;
    const offer = JSON.parse(generate('offer', params)) as Record<string, unknown>;
    expect(server.$schema).toBe('https://static.modelcontextprotocol.io/schemas/2025-07-09/server.schema.json');
    expect(server.packages).toBeDefined();
    expect(offer['@type']).toBe('SoftwareApplication');
    expect(JSON.stringify(offer)).toContain('Offer');
  });

  it('generates both static and Next route guidance', () => {
    expect(generate('agents-route', params)).toContain('public/agents.md');
    expect(generate('agents-route', {...params, framework: 'next'})).toContain("dynamic = 'force-static'");
  });
});

it('keeps the reference directory out of package discovery', async () => {
  await expect(readFile(path.join(fixtures, 'good', 'AGENTS.md'), 'utf8')).resolves.toContain('## Offer');
});
