#!/usr/bin/env node
import { Command } from 'commander';
import { auditTarget, formatAuditReport } from './audit.js';
import { PKG_NAME, VERSION } from './constants.js';
import { initProject } from './commands/init.js';
import { generateArtifact, type GeneratedArtifact } from './commands/gen.js';
import type { GenerateParams } from './generators/index.js';

const program = new Command();
program.name(PKG_NAME).version(VERSION).description('Audit and generate agent-native product surfaces.');

program.command('audit [target]').description('Audit a local directory or live URL.').option('--json', 'print JSON instead of the report').action(async (target = '.', options: { json?: boolean }) => {
  const report = await auditTarget(target);
  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : `${formatAuditReport(report)}\n`);
});

program.command('init').description('Write starter AGENTS.md and server.json into the current directory.').option('--force', 'overwrite existing files').action(async (options: { force?: boolean }) => {
  const result = await initProject({ directory: process.cwd(), force: options.force });
  process.stdout.write(`created ${result.created.length}, skipped ${result.skipped.length}\n`);
});

program.command('gen <artifact>').description('Generate an agent-native artifact.').option('-o, --out <path>', 'write to a file instead of stdout').option('--name <name>').option('--description <description>').option('--repository <url>').option('--mcp-url <url>').option('--npm-package <name>').option('--price <price>').option('--price-currency <currency>').option('--framework <framework>', 'route framework, such as static or next', 'static').action(async (artifact: string, options: Record<string, string | undefined>) => {
  const offer = options.price === undefined && options.priceCurrency === undefined ? undefined : { price: options.price, priceCurrency: options.priceCurrency };
  const params = Object.fromEntries(Object.entries({ name: options.name, description: options.description, repository: options.repository, mcpUrl: options.mcpUrl, npmPackage: options.npmPackage, framework: options.framework, offer }).filter(([, value]) => value !== undefined));
  const content = await generateArtifact(artifact as GeneratedArtifact, process.cwd(), params as GenerateParams);
  if (options.out) { const { writeFile } = await import('node:fs/promises'); await writeFile(options.out, content, 'utf8'); }
  else process.stdout.write(content);
});

program.command('mcp').description('Run the MCP server over stdio.').action(async () => { const { startMcpServer } = await import('./mcp.js'); await startMcpServer(); });
program.parseAsync().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
