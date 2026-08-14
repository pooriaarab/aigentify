# agentify

agentify audits a product directory or live URL for agent-native readiness. It also creates the public artifacts that agents can use.

## Install

```sh
npm install agentify
```

## Three faces

Use the library in JavaScript or TypeScript:

```ts
import { auditTarget, generate } from 'agentify';

const report = await auditTarget('.');
const instructions = generate('agents-md', {
  name: 'Example product',
  description: 'A product with a clear agent interface.',
  repository: 'https://github.com/example/product',
});
```

Use the CLI:

```sh
npx agentify audit .
npx agentify gen agents-md
npx agentify gen server-json --out server.json
```

Use the MCP server with an MCP client:

```sh
npx agentify-mcp
```

The MCP server exposes `audit` with `{ target }` and `gen` with `{ artifact, params }`.

## Commands

- `agentify audit [target]` checks a directory or URL. The default target is `.`.
- `agentify init` writes starter `AGENTS.md` and `server.json` files. Existing files stay unchanged.
- `agentify gen <artifact>` prints an artifact or writes it with `--out`.
- `agentify mcp` starts the stdio MCP server.

Artifacts are `agents-md`, `server-json`, `offer`, and `agents-route`.

## Configuration

Add an optional `agentify.config.ts`, `agentify.config.js`, or `agentify.config.mjs` file. Export `defineConfig(...)` data as the default export or as `agentifyConfig`.

```ts
import { defineConfig } from 'agentify';

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
