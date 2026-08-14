# aigentify

## Mental model

aigentify audits whether a product is ready for agents and creates the public files that agents need.

## The faces

- Library: import `auditTarget` and `generate` from `aigentify`.
- CLI: use `aigentify audit`, `aigentify init`, `aigentify gen`, or `aigentify mcp`.
- MCP: connect to `aigentify-mcp` over stdio.

## MCP tools

| Tool | Input | Result |
| --- | --- | --- |
| audit | `{ target }` | A score and a list of agent-readiness gaps. |
| gen | `{ artifact, params }` | Generated artifact text. |

## The loop

1. Audit the product directory or URL.
2. Fix the highest-impact gap.
3. Generate the missing public artifact.
4. Audit again.

## Rules

- Treat product facts as source facts.
- Keep public instructions about the product and its use.
- State prices plainly.
- Use the same artifact names across the library, CLI, and MCP tool.

## Offer

aigentify is free to use.

Price: USD 0
