#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { auditTarget } from "./audit.js";
import { PKG_NAME, VERSION } from "./constants.js";
import { generate, type GenerateParams, type GeneratedArtifact } from "./generators/index.js";

const artifacts = ["agents-md", "server-json", "offer", "agents-route", "auth-md"] as const;

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: PKG_NAME, version: VERSION });
  server.registerTool(
    "audit",
    {
      description: "Audit a local directory or live URL for agent-native readiness.",
      inputSchema: { target: z.string() },
    },
    async ({ target }) => ({
      content: [{ type: "text", text: JSON.stringify(await auditTarget(target), null, 2) }],
    }),
  );
  server.registerTool(
    "gen",
    {
      description: "Generate an agent-native artifact as text.",
      inputSchema: {
        artifact: z.enum(artifacts),
        params: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async ({ artifact, params }) => ({
      content: [
        {
          type: "text",
          text: generate(artifact as GeneratedArtifact, (params ?? {}) as GenerateParams),
        },
      ],
    }),
  );
  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
}

if (import.meta.url === `file://${process.argv[1]}`)
  startMcpServer().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
