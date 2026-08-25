export interface OfferConfig {
  name?: string;
  description?: string;
  price?: string | number;
  priceCurrency?: string;
}

export interface AigentifyConfig {
  name: string;
  description: string;
  repository: string;
  version?: string;
  mcpUrl?: string;
  npmPackage?: string;
  apiBaseUrl?: string;
  signupUrl?: string;
  offer?: OfferConfig;
}

export function defineConfig(config: AigentifyConfig): AigentifyConfig {
  return { ...config, repository: config.repository.replace(/\/+$/, ''), version: config.version ?? '0.1.0' };
}

export function defaultConfig(): AigentifyConfig {
  return defineConfig({
    name: 'Your product',
    description: 'A product with an agent-native interface.',
    repository: 'https://github.com/your-org/your-product',
    npmPackage: 'your-package',
  });
}
