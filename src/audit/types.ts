export type AuditStatus = "pass" | "fail" | "warn" | "na";
export interface AuditCheck {
  id: string;
  status: AuditStatus;
  note: string;
  weight: number;
}
export interface AuditGap {
  id: string;
  note: string;
  fix: string;
}
export interface AuditReport {
  target: string;
  score: number;
  checks: AuditCheck[];
  gaps: AuditGap[];
}
export interface AuditOptions {
  fetch?: typeof globalThis.fetch;
}

export interface Endpoint {
  status: number;
  contentType: string;
  text: string;
  headers?: Record<string, string>;
}
export interface Snapshot {
  agents: Endpoint;
  server: Endpoint;
  mcp: Endpoint;
  home: Endpoint;
  llms: Endpoint;
  sitemap: Endpoint;
  wellKnown: Endpoint;
  openapi: Endpoint;
  agentsPage: Endpoint;
  // is-agentic-parity signals (URL targets only)
  notFound: Endpoint;
  homeMarkdown: Endpoint;
  homeAsAgent: Endpoint;
  // Ora-parity round 2 (URL targets only)
  authMd: Endpoint;
  apiCatalog: Endpoint;
  agentCard: Endpoint;
  // External-discovery round 3 (URL targets only)
  aiPlugin: Endpoint;
  external: ExternalDiscovery;
  honestText: string;
  hasMcp: boolean;
  networkFailure: boolean;
  isUrl: boolean;
}

export interface ExternalDiscovery {
  wikidata: boolean;
  wikidataError: boolean; // a Wikidata item links to this domain via P856 (official website)
  npm: boolean;
  npmError: boolean; // an npm package matches the product/brand name
  mcpRegistry: boolean;
  mcpRegistryError: boolean; // an entry in the official MCP registry matches the domain/name
}

export const NO_EXTERNAL_DISCOVERY: ExternalDiscovery = {
  wikidata: false,
  wikidataError: false,
  npm: false,
  npmError: false,
  mcpRegistry: false,
  mcpRegistryError: false,
};
