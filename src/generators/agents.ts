import type { AigentifyConfig } from '../config.js';

export function generateAgentsMd(config: AigentifyConfig): string {
  const packageName = config.npmPackage ?? '<NPM_PACKAGE>';
  const mcp = config.mcpUrl ?? `npx ${packageName}`;
  const offer = config.offer;
  const offerLine = offer?.price === undefined ? 'Price: <PRICE>' : `Price: ${offer.priceCurrency ?? 'USD'} ${offer.price}`;
  return `# ${config.name}

## Mental model

${config.name} is ${config.description}

Use the product interface for product work. Use the agent interface for repeatable tasks that need structured results.

## The faces

- Product: ${config.repository}
- MCP: ${mcp}
- Package: ${packageName}

## MCP tools

| Tool | Input | Result |
| --- | --- | --- |
| audit | target | An agent-readiness report with a score and gaps. |
| gen | artifact and params | A generated agent-native artifact. |

## The loop

1. Audit the target.
2. Fix the highest-impact gap.
3. Generate or publish the missing artifact.
4. Audit again and keep the report with the release.

## Rules

- Treat the product description and prices as source facts.
- Return structured data when a tool provides it.
- Ask for missing information before making a high-impact change.
- Keep public agent instructions about the product and its use.

## Offer

${offer?.description ?? '<OFFER_DESCRIPTION>'}

${offerLine}
`;
}
