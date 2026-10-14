# aigentify

[![npm version](https://img.shields.io/npm/v/aigentify)](https://www.npmjs.com/package/aigentify)
[![downloads/month](https://img.shields.io/npm/dm/aigentify)](https://www.npmjs.com/package/aigentify)
[![license](https://img.shields.io/npm/l/aigentify)](https://www.npmjs.com/package/aigentify)

[Package and API types](https://www.npmjs.com/package/aigentify) · [Quickstart](#run-your-first-audit) · [Configuration](#configuration)

aigentify is an open-source agent-readiness auditing tool for developers who maintain product directories and public websites.
It returns a score, individual checks, and actionable gaps.
Its TypeScript library, command-line interface (CLI), and Model Context Protocol (MCP) server also generate public artifact text.

## Install

```sh
npm install aigentify
```

Requires Node.js 20 or later. The package has five direct runtime dependencies and includes TypeScript declarations.
Price: USD 0.

## Run your first audit

Run this command from an existing product directory:

```sh
npx aigentify audit .
```

No environment variables, credentials, or `.env` loader are required for a directory audit.
The report starts with `.: <score>/100`, lists check statuses, and ends with `Gaps:`.
A low score is a completed audit, not a command failure.

Generate a public guide with your product facts:

```sh
npx aigentify gen agents-md --name Example --description 'A product API.' --repository https://example.com --price 0 --price-currency USD --out agents.md
```

Success creates `agents.md`. Review its placeholders and product-specific instructions before publishing it.

```js
import { auditTarget, generate } from 'aigentify';

const report = await auditTarget('.');
console.log(report.score, report.gaps);
console.log(generate('offer', {
  name: 'Example',
  description: 'A product API.',
  repository: 'https://example.com',
  offer: { price: 0, priceCurrency: 'USD' },
}));
```

Save this as `audit.mjs` and run `node audit.mjs` to print the score and structured offer.

## How it works

```text
Directory files or URL responses
              |
       Snapshot and checks
              |
       Score + ordered gaps
              |
  Fix product facts -> generate text -> publish -> audit again
```

URL audits fetch discovery endpoints and query external registries. Directory audits inspect files without running the application.

## Why it exists

Developers need to check agent discovery files alongside ordinary website checks.
Lighthouse audits web quality; axe-core checks accessibility.
aigentify focuses on agent-facing manifests, public instructions, offers, and discovery evidence.

## Compare

Scope checked on 2026-10-14. These tools address adjacent auditing needs.

| Scope | aigentify | [Lighthouse](https://developer.chrome.com/docs/lighthouse/overview/) | [axe-core](https://www.deque.com/axe/axe-core/) |
| --- | --- | --- | --- |
| Primary target | Agent readiness | Web page quality | Accessibility |
| Input here | Directory or URL | Web page | HTML-based interface |
| Generated output here | Agent artifact text | Audit report | Accessibility results |

## Coverage

The implementation defines 27 audit checks, six generators, and three external registry probes.
These are source-checked capabilities, not evidence that every target passes them.
No credential-based platform verification was performed for this rewrite.

| Surface or integration | Status | Scope |
| --- | --- | --- |
| AGENTS.md, MCP discovery, server.json | Implemented | Presence, fields, and public-safety heuristics |
| Schema.org offers | Implemented | JSON-LD detection and urgency-language checks |
| llms.txt and sitemap.xml | Implemented | Availability |
| OpenAPI, agent manifests, /agents | Implemented | URL discovery checks |
| Personal Agent Protocol (Poppy) | Implemented | Draft 0.1 validation; discovery-only generator |
| HTTP discovery and crawler responses | Implemented | Markdown, links, status, body, schema, rate-limit headers |
| Authentication guide, API catalog, Agent2Agent card | Implemented | Document shape or availability |
| AI plugin manifest | Implemented | Name, API, and authentication fields |
| Wikidata | Implemented | Official-website lookup |
| npm | Implemented | Package search and name/homepage matching |
| Official MCP Registry | Implemented | Server search and name/host matching |
| Next.js | Template | `agents-route --framework next` prints route instructions |

External checks return warnings when evidence is missing or inconclusive.
URL-only checks return `na` for local directories.

## Common use cases

1. Package maintainers audit a Node.js directory before publishing agent-facing files to npm.
2. Next.js developers generate `/agents.md` route instructions, then audit the deployed URL.
3. MCP server authors generate `server-json` and review its package or remote configuration.
4. API teams inspect OpenAPI discovery, authentication guides, and Agent2Agent cards on a public URL.
5. Product developers check Wikidata, npm, and Official MCP Registry discovery evidence.

## Features

- Directory and URL audits return scores, checks, and ordered gaps.
- Artifact generation returns text without deploying a service.
- JSON output supports scripts through `audit --json`.
- Configuration shares product facts across generated artifacts.

## Runtime surfaces

The library exports `auditTarget`, `formatAuditReport`, `scoreAuditChecks`, `defineConfig`, `defaultConfig`, and generator functions.
Run the library on Node.js; auditing uses filesystem APIs.

| CLI command | Behavior |
| --- | --- |
| `audit [target]` | Defaults to `.`; `--json` emits the report |
| `init` | Creates AGENTS.md, server.json, and auth.md; `--force` permits overwrites |
| `gen <artifact>` | Prints text; `--out` writes a file |
| `mcp` | Starts the stdio server |

The six artifact names are `agents-md`, `server-json`, `offer`, `agents-route`, `auth-md`, and `poppy`.
`agents-route` accepts `--framework static` or `--framework next`.

Start the standalone server with `npx aigentify-mcp`.
Its two tools are `audit` with `{ target }` and `gen` with `{ artifact, params }`.

### Configuration

Create `aigentify.config.ts`, `aigentify.config.js`, or `aigentify.config.mjs` for CLI generation:

```ts
import { defineConfig } from 'aigentify';

export default defineConfig({
  name: 'Example',
  description: 'A product API.',
  repository: 'https://example.com',
  npmPackage: 'example-product',
  offer: { price: 0, priceCurrency: 'USD' },
});
```

Export a default configuration or a named `aigentifyConfig`.
Library and MCP generation accept parameters directly.

## Delivery/behavior limits

Scores use weighted heuristics. A perfect score does not guarantee agent compatibility, search ranking, or discovery.
The crawler check uses one agent User-Agent; it does not test every crawler.
Requests have eight-second timeouts; registry failures can leave discovery evidence inconclusive.
Audits fetch text without executing browser JavaScript.
Generated files contain defaults and templates that require review.
The authentication template describes API-key behavior; it does not implement authentication.
The Poppy generator emits discovery-only data, not authenticated agent or API connections.
`init` preserves existing files unless `--force` is set. It does not deploy them.

## Integration guides

- [Next.js route template](#runtime-surfaces): generate instructions, then publish the route yourself.
- [MCP stdio setup](#runtime-surfaces): connect a client to `aigentify-mcp`.
- [Shared product configuration](#configuration): set names, URLs, and offer facts.

## Status

Version 0.5.0 is a 0.x release. Interfaces and checks can change.
Use the GitHub issue channel listed on the [npm package](https://www.npmjs.com/package/aigentify) for support.
Public case studies are not yet published in this README.

## FAQ

### What does aigentify audit?

aigentify audits a local directory or public URL for agent-readiness signals.
Its report contains a score, checks, and actionable gaps.

### Which integrations are verified?

aigentify implements Wikidata, npm, and Official MCP Registry probes in source.
This rewrite checked the implementation, without a live credential-based verification campaign.

### Does aigentify provide a managed service?

aigentify runs in your Node.js process or stdio MCP server.
You publish and host the generated artifacts yourself.

### How is aigentify different from Lighthouse?

aigentify checks agent-facing discovery and generates artifact text.
[Lighthouse](https://developer.chrome.com/docs/lighthouse/overview/) audits web page quality.

### How is aigentify different from axe-core?

aigentify checks agent readiness and public discovery files.
[axe-core](https://www.deque.com/axe/axe-core/) evaluates accessibility in HTML-based interfaces.

### Does aigentify need API keys?

aigentify uses no API keys for directory audits or its public registry probes.
Generated authentication guides are templates for your product.

### Does a score of 100 guarantee compatibility?

aigentify scores implemented heuristics, not end-to-end compatibility with every agent.
Test your published interfaces with the clients you support.

### Can aigentify fix my website automatically?

aigentify generates text and starter files.
You review product facts, implement missing behavior, and deploy the changes.

## License

MIT.
