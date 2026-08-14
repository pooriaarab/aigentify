import path from 'node:path';
import { access } from 'node:fs/promises';
import { createJiti } from 'jiti';
import { CONFIG_FILENAME } from '../constants.js';
import { defineConfig, type AgentifyConfig } from '../config.js';

export async function findConfigFile(directory = process.cwd()): Promise<string | undefined> {
  const candidates = [CONFIG_FILENAME, CONFIG_FILENAME.replace(/\.ts$/, '.js'), CONFIG_FILENAME.replace(/\.ts$/, '.mjs')];
  for (const candidate of candidates) {
    const file = path.join(directory, candidate);
    try { await access(file); return file; } catch { /* Try the next supported extension. */ }
  }
  return undefined;
}

export async function loadAgentifyConfig(directory = process.cwd()): Promise<AgentifyConfig | undefined> {
  const file = await findConfigFile(directory);
  if (!file) return undefined;
  const jiti = createJiti(import.meta.url);
  const module = (await jiti.import(file)) as { default?: AgentifyConfig; agentifyConfig?: AgentifyConfig };
  const config = module.agentifyConfig ?? module.default;
  if (!config) throw new Error(`${path.basename(file)} must export a default config or agentifyConfig.`);
  return defineConfig(config);
}
