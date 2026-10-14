import type { AigentifyConfig } from '../config.js';

function hostnameFrom(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return undefined;
  }
}

/**
 * Write a discovery-only poppy.json (web browsing, signed out).
 * That is step 1 of Personal Agent Protocol: agents can find the company.
 * Auth, APIs, and a company agent can be added later.
 */
export function generatePoppy(config: AigentifyConfig): string {
  const domain = config.domain
    ?? hostnameFrom(config.apiBaseUrl)
    ?? hostnameFrom(config.signupUrl)
    ?? 'example.com';
  return `${JSON.stringify({
    protocol_version: '0.1',
    organization: { name: config.name, domain },
    web: {},
  }, null, 2)}\n`;
}
