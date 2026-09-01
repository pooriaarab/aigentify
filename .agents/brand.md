# aigentify Brand

## Identity

The product name is `aigentify` in lowercase.

Describe it as a tool that audits and generates agent-native product surfaces.
Its public interfaces are a TypeScript library, CLI, and MCP server.

## Audiences

Address developers who maintain a product directory or public URL.
Address agents through structured library and MCP results.

Do not imply that aigentify hosts, deploys, or fixes the audited product.

## Product promise

Lead with the audit loop: audit, fix a gap, generate an artifact, and audit again.

Explain that an audit returns a score, individual checks, and actionable gaps.
Explain that generation returns public artifact text.

## Message order

1. State whether the target is a local directory or live URL.
2. Explain the score, checks, and gaps.
3. Name the library, CLI, or MCP interface being used.
4. Name generated artifacts exactly when generation is relevant.
5. State that the product is free when price matters.

## Voice

Use direct, diagnostic language.
Name the failed signal before its fix.
Keep instructions about the product and its use.

State inconclusive external checks as warnings.
Do not turn unavailable registry evidence into a confirmed failure.

## Claims

Support audit claims with `src/audit/checks.ts` and `src/audit/report.ts`.
Support artifact claims with `src/generators/` and its tests.
Support interface claims with `src/index.ts`, `src/cli.ts`, and `src/mcp.ts`.

Do not claim a perfect score guarantees agent compatibility.
Do not claim that every web signal applies to local directories.

The offer is free to use.
State the price as `USD 0`.

## Naming

Write `aigentify`, `TypeScript`, `CLI`, `MCP`, and `JSON` exactly.

Use the commands `audit`, `init`, `gen`, and `mcp`.
Use the MCP tool names `audit` and `gen`.

Use these artifact names exactly:

- `agents-md`
- `server-json`
- `offer`
- `agents-route`
- `auth-md`

## Assets

The repository defines no logo, brand font, or color palette.
Do not invent visual assets or tokens.
