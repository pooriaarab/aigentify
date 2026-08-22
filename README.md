# aigentify

aigentify audits a product directory or live URL for agent-native readiness. It also creates the public artifacts that agents can use.

## Install

```sh
npm install aigentify
```

## Three faces

Use the library in JavaScript or TypeScript:

```ts
import { auditTarget, generate } from 'aigentify';

const report = await auditTarget('.');
const instructions = generate('agents-md', {
  name: 'Example product',
  description: 'A product with a clear agent interface.',
  repository: 'https://github.com/example/product',
});
```

Use the CLI:

```sh
npx aigentify audit .
npx aigentify gen agents-md
npx aigentify gen server-json --out server.json
```

Use the MCP server with an MCP client:

```sh
npx aigentify-mcp
```

The MCP server exposes `audit` with `{ target }` and `gen` with `{ artifact, params }`.

## Commands

- `aigentify audit [target]` checks a directory or URL. The default target is `.`.
- `aigentify init` writes starter `AGENTS.md` and `server.json` files. Existing files stay unchanged.
- `aigentify gen <artifact>` prints an artifact or writes it with `--out`.
- `aigentify mcp` starts the stdio MCP server.

Artifacts are `agents-md`, `server-json`, `offer`, and `agents-route`.

## Checks

`audit` scores these signals. The core signals work for a directory or a URL; the
web signals are only meaningful for a served URL and are marked `na` otherwise.

Core: `agents-md`, `agents-md-public-safe`, `server-json`, `mcp`, `offer-jsonld`,
`honest-offer`, `llms-txt`, `sitemap`.

Web (URL targets): `well-known-agent`, `openapi`, `agents-page`, `soft-404`
(unknown paths must return a real 404, not a 200 app shell), `markdown-negotiation`
(serve `text/markdown` on `Accept: text/markdown` with `Vary: Accept`),
`content-without-js` (an `<h1>` and 500+ characters without JS), `org-schema`
(Organization JSON-LD with `contactPoint` and `address`), `crawler-reachable`
(agent User-Agents can reach the homepage), and `rate-limit-headers` (standard
`RateLimit-*` headers), plus `auth-md`, `api-catalog` (RFC 9727),
`agent-card-a2a` (A2A), `link-headers` (RFC 8288), and `markdown-alt`.

## Configuration

Add an optional `aigentify.config.ts`, `aigentify.config.js`, or `aigentify.config.mjs` file. Export `defineConfig(...)` data as the default export or as `aigentifyConfig`.

```ts
import { defineConfig } from 'aigentify';

export default defineConfig({
  name: 'Example product',
  description: 'A product with a clear agent interface.',
  repository: 'https://github.com/example/product',
  npmPackage: 'example-product',
  offer: { name: 'Access', price: 0, priceCurrency: 'USD' },
});
```

## License

MIT
