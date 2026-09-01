import type { AigentifyConfig } from "../config.js";

export function generateAuthMd(config: AigentifyConfig): string {
  const packageName = config.npmPackage ?? "<NPM_PACKAGE>";
  const mcp = config.mcpUrl ?? `npx ${packageName}`;
  const apiBase = config.apiBaseUrl;

  const getKey = config.signupUrl
    ? `## Get a key (no human in the loop)

\`\`\`
POST ${config.signupUrl}
Content-Type: application/json

{ "email": "you@example.com" }
\`\`\`

The response returns the API key **once** — store it in a secret store.`
    : `## Get a key

A key is supplied out of band: from the dashboard (${config.repository}) or an
environment variable the operator already set. Never request a key over chat.`;

  return `# ${config.name} — Agent Authentication

${config.name} authenticates agents with an **API key** sent as a Bearer token.
The same key works for the REST API and the MCP server.

${getKey}

## Use the key

\`\`\`
Authorization: Bearer <API_KEY>
\`\`\`
${apiBase ? `\n- REST API base: ${apiBase}` : ""}
- MCP: ${mcp}

Read the key at call time. Never log or echo it.

## Discovery

- Agent guide: /AGENTS.md
- MCP manifest: /.well-known/server.json
- Machine index: /llms.txt

## Errors

| Status | Meaning | What the agent should do |
| --- | --- | --- |
| 401 | Missing or invalid key | Stop and ask for a valid key. Do not retry. |
| 403 | Key lacks permission | Request the needed scope. Do not retry as-is. |
| 429 | Rate limited | Back off, then retry after \`Retry-After\`. |

## Revocation

A revoked key returns 401. Rotate the key from the dashboard and update the
agent's secret store.
`;
}
