import { writeFile } from 'node:fs/promises';
import { defaultConfig } from '../config.js';
import { generate, type GenerateParams, type GeneratedArtifact } from '../generators/index.js';
import { loadAgentifyConfig } from './load-config.js';

export type { GeneratedArtifact } from '../generators/index.js';

export async function generateArtifact(artifact: GeneratedArtifact, directory = process.cwd(), params: GenerateParams = {}): Promise<string> {
  const config = (await loadAgentifyConfig(directory)) ?? defaultConfig();
  return generate(artifact, { ...config, ...params, offer: { ...(config.offer ?? {}), ...(params.offer ?? {}) } });
}

export async function writeGeneratedArtifact(artifact: GeneratedArtifact, options: { directory?: string; output?: string; params?: GenerateParams } = {}): Promise<string> {
  const content = await generateArtifact(artifact, options.directory, options.params);
  if (options.output) await writeFile(options.output, content, 'utf8');
  return content;
}
