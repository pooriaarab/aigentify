import { SERVER_SCHEMA_URL } from '../constants.js';
import type { AigentifyConfig } from '../config.js';

export function generateServerJson(config: AigentifyConfig): string {
  const serverName = config.name.includes('/') ? config.name : `io.github.pooriaarab/${config.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}`;
  const server: Record<string, unknown> = {
    $schema: SERVER_SCHEMA_URL,
    name: serverName,
    description: config.description,
    repository: { url: config.repository, source: 'github' },
    version: config.version ?? '0.1.0',
  };
  if (config.mcpUrl) server.remotes = [{ type: 'streamable-http', url: config.mcpUrl }];
  else server.packages = [{ registryType: 'npm', registryBaseUrl: 'https://registry.npmjs.org', identifier: config.npmPackage ?? 'aigentify', version: config.version ?? '0.1.0', transport: { type: 'stdio' }, runtimeHint: 'npx', packageArguments: [{ type: 'positional', valueHint: 'subcommand', value: 'mcp' }] }];
  return `${JSON.stringify(server, null, 2)}\n`;
}
