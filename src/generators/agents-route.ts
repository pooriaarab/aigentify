import type { AgentifyConfig } from '../config.js';

export function generateAgentsRoute(config: AgentifyConfig, framework = 'static'): string {
  if (framework === 'next') {
    return `# Serve /agents.md from a Next route

Copy AGENTS.md to a public directory, or add this force-static route:

\`\`\`ts
import { readFile } from 'node:fs/promises';

export const dynamic = 'force-static';

export async function GET() {
  const body = await readFile('AGENTS.md', 'utf8');
  return new Response(body, { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
}
\`\`\`

Product: ${config.name}
`;
  }
  return `# Serve /agents.md

Copy the generated AGENTS.md file to public/agents.md and serve it as a static text/markdown response.

Product: ${config.name}
`;
}
