export interface OfferConfig {
  name?: string;
  description?: string;
  price?: string | number;
  priceCurrency?: string;
}

export interface AgentifyConfig {
  name: string;
  description: string;
  repository: string;
  version?: string;
  mcpUrl?: string;
  npmPackage?: string;
  offer?: OfferConfig;
}

export function defineConfig(config: AgentifyConfig): AgentifyConfig {
  return { ...config, repository: config.repository.replace(/\/+$/, ''), version: config.version ?? '0.1.0' };
}

export function defaultConfig(): AgentifyConfig {
  return defineConfig({
    name: 'Your product',
    description: 'A product with an agent-native interface.',
    repository: 'https://github.com/your-org/your-product',
    npmPackage: 'your-package',
  });
}
