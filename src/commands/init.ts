import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultConfig } from '../config.js';
import { generate } from '../generators/index.js';

export interface InitOptions { directory: string; force?: boolean }
export interface InitResult { created: string[]; skipped: string[] }

export async function initProject(options: InitOptions): Promise<InitResult> {
  const root = path.resolve(options.directory);
  await mkdir(root, { recursive: true });
  const config = defaultConfig();
  const result: InitResult = { created: [], skipped: [] };
  for (const [name, content] of [['AGENTS.md', generate('agents-md', config)], ['server.json', generate('server-json', config)], ['auth.md', generate('auth-md', config)]] as const) {
    const file = path.join(root, name);
    try {
      await access(file);
      if (!options.force) { result.skipped.push(name); continue; }
    } catch { /* The file does not exist yet. */ }
    await writeFile(file, content, 'utf8');
    result.created.push(name);
  }
  return result;
}
