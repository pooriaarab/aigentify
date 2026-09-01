import type { AigentifyConfig } from "../config.js";
import { defaultConfig, defineConfig } from "../config.js";
import { generateAgentsMd } from "./agents.js";
import { generateAgentsRoute } from "./agents-route.js";
import { generateAuthMd } from "./auth-md.js";
import { generateOffer } from "./offer.js";
import { generateServerJson } from "./server.js";
export * from "./agents.js";
export * from "./agents-route.js";
export * from "./auth-md.js";
export * from "./offer.js";
export * from "./server.js";

export type GeneratedArtifact = "agents-md" | "server-json" | "offer" | "agents-route" | "auth-md";
export type GenerateParams = Partial<AigentifyConfig> & { framework?: string };

function configFromParams(params: GenerateParams = {}): AigentifyConfig {
  const base = defaultConfig();
  return defineConfig({
    ...base,
    ...params,
    offer: { ...(base.offer ?? {}), ...(params.offer ?? {}) },
  });
}

export function generate(artifact: GeneratedArtifact, params: GenerateParams = {}): string {
  const config = configFromParams(params);
  if (artifact === "agents-md") return generateAgentsMd(config);
  if (artifact === "server-json") return generateServerJson(config);
  if (artifact === "offer") return generateOffer(config);
  if (artifact === "agents-route") return generateAgentsRoute(config, params.framework);
  if (artifact === "auth-md") return generateAuthMd(config);
  throw new Error(`Unknown artifact: ${artifact}`);
}
