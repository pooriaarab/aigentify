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
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aigentify-schema-'));
    await writeFile(path.join(directory, 'server.json'), JSON.stringify({
      $schema: 'https://static.modelcontextprotocol.io/schemas/2025-07-09/server.json',
      name: 'io.example/server', description: 'Example', repository: {url: 'https://example.com', source: 'github'}, version: '1.0.0', packages: [],
    }));
    const report = await auditTarget(directory);
    expect(check(report, 'server-json').status).toBe('fail');
    expect(check(report, 'server-json').note).toContain('https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json');
  });

  it('warns when an offer uses pressure copy', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aigentify-offer-'));
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
    const orgJsonLd = '{"@context":"https://schema.org","@type":"Organization","name":"Example","contactPoint":{"@type":"ContactPoint","email":"support@example.com","contactType":"customer support"},"address":{"@type":"PostalAddress","addressCountry":"US"}}';
    const homeText = 'Example product helps agents create, schedule, and publish content across every major platform from one API. '.repeat(8);
    const mdAlt = '<link rel="alternate" type="text/markdown" href="/home.md">';
    const html = `<html><head>${mdAlt}<script type="application/ld+json">{"@type":"Offer","price":"0"}</script><script type="application/ld+json">${orgJsonLd}</script></head><body><h1>Example product</h1><p>${homeText}</p></body></html>`;
    const markdown = '# Example product\n\nCreate, schedule, and publish across platforms.';
    const linkHeader = '</llms.txt>; rel="describedby", </openapi.json>; rel="service-desc"';
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const accept = new Headers(init?.headers).get('accept') ?? '';
      if (url === `${base}/agents.md`) return new Response(agents, {status: 200, headers: {'content-type': 'text/markdown'}});
      if (url === `${base}/server.json`) return new Response(server, {status: 200, headers: {'content-type': 'application/json'}});
      if (url === `${base}/.well-known/mcp`) return new Response('', {status: 404});
      if (url === base && /text\/markdown/.test(accept)) return new Response(markdown, {status: 200, headers: {'content-type': 'text/markdown', vary: 'Accept, Accept-Encoding'}});
      if (url === base) return new Response(html, {status: 200, headers: {'content-type': 'text/html', link: linkHeader}});
      if (url === `${base}/llms.txt`) return new Response('# Example product', {status: 200});
      if (url === `${base}/sitemap.xml`) return new Response('<urlset />', {status: 200});
      if (url === `${base}/.well-known/agent.json`) return new Response('{"name":"Example"}', {status: 200, headers: {'content-type': 'application/json'}});
      if (url === `${base}/.well-known/agent-card.json`) return new Response(`{"name":"Example","url":"${base}"}`, {status: 200, headers: {'content-type': 'application/json'}});
      if (url === `${base}/.well-known/api-catalog`) return new Response('{"linkset":[{"anchor":"/api","service-desc":[{"href":"/openapi.json"}]}]}', {status: 200, headers: {'content-type': 'application/linkset+json'}});
      if (url === `${base}/auth.md`) return new Response('# Auth\n\nUse a Bearer API key.', {status: 200, headers: {'content-type': 'text/markdown'}});
      if (url === `${base}/openapi.json`) return new Response('{"openapi":"3.1.0"}', {status: 200, headers: {'content-type': 'application/json', 'ratelimit-limit': '100', 'ratelimit-remaining': '99', 'ratelimit-reset': '60'}});
      if (url === `${base}/agents`) return new Response('<html>agents</html>', {status: 200, headers: {'content-type': 'text/html'}});
      if (url === `${base}/.well-known/ai-plugin.json`) return new Response('{"schema_version":"v1","name_for_model":"example"}', {status: 200, headers: {'content-type': 'application/json'}});
      // External registries (round 3):
      if (url.startsWith('https://www.wikidata.org/w/api.php')) return new Response('{"query":{"searchinfo":{"totalhits":1},"search":[{"title":"Q1"}]}}', {status: 200, headers: {'content-type': 'application/json'}});
      if (url.startsWith('https://registry.npmjs.org/-/v1/search')) return new Response('{"objects":[{"package":{"name":"example-product","links":{"homepage":"https://example.com"}}}]}', {status: 200, headers: {'content-type': 'application/json'}});
      if (url.startsWith('https://registry.modelcontextprotocol.io/v0/servers')) return new Response('{"servers":[{"server":{"name":"io.example/example","websiteUrl":"https://example.com"}}]}', {status: 200, headers: {'content-type': 'application/json'}});
      return new Response('', {status: 404});
    };
    const report = await auditTarget(base, { fetch: fetcher });
    expect(report.score).toBe(100);
    expect(report.gaps).toEqual([]);
    expect(check(report, 'soft-404').status).toBe('pass');
    expect(check(report, 'markdown-negotiation').status).toBe('pass');
    expect(check(report, 'org-schema').status).toBe('pass');
    expect(check(report, 'rate-limit-headers').status).toBe('pass');
    expect(check(report, 'auth-md').status).toBe('pass');
    expect(check(report, 'api-catalog').status).toBe('pass');
    expect(check(report, 'agent-card-a2a').status).toBe('pass');
    expect(check(report, 'link-headers').status).toBe('pass');
    expect(check(report, 'markdown-alt').status).toBe('pass');
    expect(check(report, 'ai-plugin').status).toBe('pass');
    expect(check(report, 'wikidata').status).toBe('pass');
    expect(check(report, 'npm-package').status).toBe('pass');
    expect(check(report, 'mcp-registry').status).toBe('pass');
  });

  it('detects external discovery gaps when registries have no match', async () => {
    const base = 'https://nolistings.example';
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === base) return new Response('<html><head><title>NoListings</title></head><body><h1>x</h1></body></html>', {status: 200, headers: {'content-type': 'text/html'}});
      // registries return empty results
      if (url.startsWith('https://www.wikidata.org/w/api.php')) return new Response('{"query":{"searchinfo":{"totalhits":0},"search":[]}}', {status: 200});
      if (url.startsWith('https://registry.npmjs.org/-/v1/search')) return new Response('{"objects":[]}', {status: 200});
      if (url.startsWith('https://registry.modelcontextprotocol.io/v0/servers')) return new Response('{"servers":[]}', {status: 200});
      return new Response('', {status: 404});
    };
    const report = await auditTarget(base, { fetch: fetcher });
    expect(check(report, 'wikidata').status).toBe('warn');
    expect(check(report, 'npm-package').status).toBe('warn');
    expect(check(report, 'mcp-registry').status).toBe('warn');
    expect(check(report, 'ai-plugin').status).toBe('warn');
  });

  it('rejects an empty ai-plugin.json as not a usable manifest', async () => {
    const base = 'https://emptyplugin.example';
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === base) return new Response('<html><head><title>EmptyPlugin</title></head><body><h1>x</h1></body></html>', {status: 200, headers: {'content-type': 'text/html'}});
      if (url === `${base}/.well-known/ai-plugin.json`) return new Response('{}', {status: 200, headers: {'content-type': 'application/json'}});
      return new Response('', {status: 404});
    };
    const report = await auditTarget(base, { fetch: fetcher });
    expect(check(report, 'ai-plugin').status).toBe('warn');
  });

  it('treats a registry error as inconclusive rather than a confirmed gap', async () => {
    const base = 'https://ratelimited.example';
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === base) return new Response('<html><head><title>RateLimited</title></head><body><h1>x</h1></body></html>', {status: 200, headers: {'content-type': 'text/html'}});
      // every registry call is rate-limited
      if (url.startsWith('https://www.wikidata.org/w/api.php')) return new Response('', {status: 429});
      if (url.startsWith('https://registry.npmjs.org/-/v1/search')) return new Response('', {status: 429});
      if (url.startsWith('https://registry.modelcontextprotocol.io/v0/servers')) return new Response('', {status: 429});
      return new Response('', {status: 404});
    };
    const report = await auditTarget(base, { fetch: fetcher });
    expect(check(report, 'wikidata').status).toBe('warn');
    expect(check(report, 'wikidata').note).toMatch(/could not be completed/);
    expect(check(report, 'npm-package').note).toMatch(/could not be completed/);
    expect(check(report, 'mcp-registry').note).toMatch(/could not be completed/);
  });

  it('does not false-positive an npm/mcp match on a generic host label', async () => {
    const base = 'https://app.example';
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === base) return new Response('<html><head><title>App</title></head><body><h1>x</h1></body></html>', {status: 200, headers: {'content-type': 'text/html'}});
      // an unrelated package/server that merely contains "app" somewhere in its data
      if (url.startsWith('https://registry.npmjs.org/-/v1/search')) return new Response('{"objects":[{"package":{"name":"unrelated-application-toolkit","links":{"homepage":"https://unrelated.example"}}}]}', {status: 200});
      if (url.startsWith('https://registry.modelcontextprotocol.io/v0/servers')) return new Response('{"servers":[{"server":{"name":"io.unrelated/mapping-tool","websiteUrl":"https://unrelated.example"}}]}', {status: 200});
      if (url.startsWith('https://www.wikidata.org/w/api.php')) return new Response('{"query":{"searchinfo":{"totalhits":0},"search":[]}}', {status: 200});
      return new Response('', {status: 404});
    };
    const report = await auditTarget(base, { fetch: fetcher });
    expect(check(report, 'npm-package').status).toBe('warn');
    expect(check(report, 'mcp-registry').status).toBe('warn');
  });

  it('flags a soft-404 (unknown paths return 200)', async () => {
    const base = 'https://soft.example';
    const fetcher = async (): Promise<Response> =>
      new Response('<html><body>app shell</body></html>', {status: 200, headers: {'content-type': 'text/html'}});
    const report = await auditTarget(base, { fetch: fetcher });
    expect(check(report, 'soft-404').status).toBe('fail');
    expect(report.gaps.some(gap => gap.id === 'soft-404')).toBe(true);
  });

  it('does not pass content-without-js or org-schema off a broken homepage', async () => {
    const base = 'https://broken.example';
    const richErrorPage = `<html><body><h1>Something went wrong</h1><p>${'Sorry, an unexpected error occurred while loading this page. '.repeat(10)}</p><script type="application/ld+json">{"@type":"Organization","contactPoint":{"email":"a@b.com"},"address":{"addressCountry":"US"}}</script></body></html>`;
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === base) return new Response(richErrorPage, {status: 500, headers: {'content-type': 'text/html'}});
      return new Response('', {status: 404});
    };
    const report = await auditTarget(base, { fetch: fetcher });
    expect(check(report, 'content-without-js').status).toBe('warn');
    expect(check(report, 'org-schema').status).toBe('warn');
  });

  it('only passes soft-404 on a real 404/410, not other error statuses', async () => {
    const base = 'https://blocked.example';
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === base) return new Response('<html><body><h1>Home</h1></body></html>', {status: 200, headers: {'content-type': 'text/html'}});
      return new Response('Forbidden', {status: 403});
    };
    const report = await auditTarget(base, { fetch: fetcher });
    expect(check(report, 'soft-404').status).toBe('warn');
  });

  it('does not count an h1 hidden inside a script as server-rendered content', async () => {
    const base = 'https://spa.example';
    const text = 'Loading placeholder text that is not real page content and should not count. '.repeat(8);
    const html = `<html><body><p>${text}</p><script>window.__STATE__ = ${JSON.stringify('<h1>Hydrated title</h1>')}</script></body></html>`;
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === base) return new Response(html, {status: 200, headers: {'content-type': 'text/html'}});
      return new Response('', {status: 404});
    };
    const report = await auditTarget(base, { fetch: fetcher });
    expect(check(report, 'content-without-js').status).toBe('warn');
  });

  it('passes org-schema when any Organization block (not just the first) has contactPoint and address', async () => {
    const base = 'https://multi-schema.example';
    const html = '<html><head>' +
      '<script type="application/ld+json">{"@type":"Organization","name":"Widget Co"}</script>' +
      '<script type="application/ld+json">{"@type":"Organization","contactPoint":{"email":"a@b.com"},"address":{"addressCountry":"US"}}</script>' +
      '</head><body></body></html>';
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === base) return new Response(html, {status: 200, headers: {'content-type': 'text/html'}});
      return new Response('', {status: 404});
    };
    const report = await auditTarget(base, { fetch: fetcher });
    expect(check(report, 'org-schema').status).toBe('pass');
  });

  it('does not pass markdown-negotiation when the negotiated request errors', async () => {
    const base = 'https://markdown-error.example';
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const accept = new Headers(init?.headers).get('accept') ?? '';
      if (url === base && /text\/markdown/.test(accept)) {
        return new Response('Not Found', {status: 404, headers: {'content-type': 'text/markdown', vary: 'Accept'}});
      }
      if (url === base) return new Response('<html><body><h1>Home</h1></body></html>', {status: 200, headers: {'content-type': 'text/html'}});
      return new Response('', {status: 404});
    };
    const report = await auditTarget(base, { fetch: fetcher });
    expect(check(report, 'markdown-negotiation').status).toBe('warn');
  });

  it('does not pass rate-limit-headers from a single header on an unrelated failed endpoint', async () => {
    const base = 'https://ratelimit-partial.example';
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === base) return new Response('<html><body><h1>Home</h1></body></html>', {status: 200, headers: {'content-type': 'text/html'}});
      return new Response('', {status: 404, headers: {'ratelimit-limit': '100'}});
    };
    const report = await auditTarget(base, { fetch: fetcher });
    expect(check(report, 'rate-limit-headers').status).toBe('warn');
  });

  it('does not pass crawler-reachable when the agent User-Agent hits a block page', async () => {
    const base = 'https://waf.example';
    const homeHtml = `<html><body><h1>Home</h1><p>${'Real homepage content for humans and well-behaved crawlers alike. '.repeat(10)}</p></body></html>`;
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const userAgent = new Headers(init?.headers).get('user-agent') ?? '';
      if (url === base && /ora-agent/.test(userAgent)) {
        return new Response('<html><body>Access Denied - are you a robot?</body></html>', {status: 200, headers: {'content-type': 'text/html'}});
      }
      if (url === base) return new Response(homeHtml, {status: 200, headers: {'content-type': 'text/html'}});
      return new Response('', {status: 404});
    };
    const report = await auditTarget(base, { fetch: fetcher });
    expect(check(report, 'crawler-reachable').status).toBe('warn');
  });

  it('does not count h1 and text hidden inside an HTML comment as server-rendered content', async () => {
    const base = 'https://commented-out.example';
    const hiddenText = 'This text is commented out and never rendered by a browser or crawler. '.repeat(8);
    const html = `<html><body><!-- <h1>Hidden title</h1><p>${hiddenText}</p> --></body></html>`;
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === base) return new Response(html, {status: 200, headers: {'content-type': 'text/html'}});
      return new Response('', {status: 404});
    };
    const report = await auditTarget(base, { fetch: fetcher });
    expect(check(report, 'content-without-js').status).toBe('warn');
  });

  it('does not pass org-schema when contactPoint and address are present but null', async () => {
    const base = 'https://null-schema.example';
    const html = '<html><head><script type="application/ld+json">{"@type":"Organization","contactPoint":null,"address":null}</script></head><body></body></html>';
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === base) return new Response(html, {status: 200, headers: {'content-type': 'text/html'}});
      return new Response('', {status: 404});
    };
    const report = await auditTarget(base, { fetch: fetcher });
    expect(check(report, 'org-schema').status).toBe('warn');
  });

  it('does not pass crawler-reachable off an empty 200 when there is no homepage baseline', async () => {
    const base = 'https://no-baseline.example';
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const userAgent = new Headers(init?.headers).get('user-agent') ?? '';
      if (url === base && /ora-agent/.test(userAgent)) return new Response('', {status: 200, headers: {'content-type': 'text/html'}});
      if (url === base) return new Response('', {status: 500});
      return new Response('', {status: 404});
    };
    const report = await auditTarget(base, { fetch: fetcher });
    expect(check(report, 'crawler-reachable').status).toBe('warn');
  });

  it('does not pass rate-limit-headers when RateLimit-Reset is missing', async () => {
    const base = 'https://ratelimit-no-reset.example';
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === base) return new Response('<html><body><h1>Home</h1></body></html>', {status: 200, headers: {'content-type': 'text/html', 'ratelimit-limit': '100', 'ratelimit-remaining': '99'}});
      return new Response('', {status: 404});
    };
    const report = await auditTarget(base, { fetch: fetcher });
    expect(check(report, 'rate-limit-headers').status).toBe('warn');
  });

  it('marks the is-agentic-parity signals na for a directory target', async () => {
    const report = await auditTarget(path.join(fixtures, 'good'));
    for (const id of ['soft-404', 'markdown-negotiation', 'content-without-js', 'org-schema', 'crawler-reachable', 'rate-limit-headers']) {
      expect(check(report, id).status).toBe('na');
    }
    expect(report.score).toBe(100);
  });

  it('warns a table-stakes URL that lacks the world-class signals', async () => {
    const base = 'https://plain.example';
    const server = generate('server-json', { name: 'Plain', description: 'A plain agent product', repository: 'https://github.com/example/plain', npmPackage: 'plain', version: '1.0.0' });
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === `${base}/agents.md`) return new Response('# Plain\n\n## Offer\n\nPrice: USD 0', {status: 200, headers: {'content-type': 'text/markdown'}});
      if (url === `${base}/server.json`) return new Response(server, {status: 200, headers: {'content-type': 'application/json'}});
      if (url === base) return new Response('<script type="application/ld+json">{"@type":"Offer","price":"0"}</script>', {status: 200, headers: {'content-type': 'text/html'}});
      if (url === `${base}/llms.txt`) return new Response('# Plain', {status: 200});
      if (url === `${base}/sitemap.xml`) return new Response('<urlset />', {status: 200});
      return new Response('', {status: 404});
    };
    const report = await auditTarget(base, { fetch: fetcher });
    expect(report.score).toBeLessThan(100);
    expect(report.gaps.map(g => g.id)).toEqual(expect.arrayContaining(['well-known-agent', 'openapi', 'agents-page']));
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
    expect(server.$schema).toBe('https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json');
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
