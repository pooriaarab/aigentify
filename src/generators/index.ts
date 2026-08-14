import type { AgentifyConfig } from '../config.js';
import { defaultConfig, defineConfig } from '../config.js';
import { generateAgentsMd } from './agents.js';
import { generateAgentsRoute } from './agents-route.js';
import { generateOffer } from './offer.js';
import { generateServerJson } from './server.js';
export * from './agents.js';
export * from './agents-route.js';
export * from './offer.js';
export * from './server.js';

export type GeneratedArtifact = 'agents-md' | 'server-json' | 'offer' | 'agents-route';
export type GenerateParams = Partial<AgentifyConfig> & { framework?: string };

function configFromParams(params: GenerateParams = {}): AgentifyConfig {
  const base = defaultConfig();
  return defineConfig({ ...base, ...params, offer: { ...(base.offer ?? {}), ...(params.offer ?? {}) } });
}

export function generate(artifact: GeneratedArtifact, params: GenerateParams = {}): string {
  const config = configFromParams(params);
  if (artifact === 'agents-md') return generateAgentsMd(config);
  if (artifact === 'server-json') return generateServerJson(config);
  if (artifact === 'offer') return generateOffer(config);
  if (artifact === 'agents-route') return generateAgentsRoute(config, params.framework);
  throw new Error(`Unknown artifact: ${artifact}`);
}
