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
