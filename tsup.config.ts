import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli.ts", mcp: "src/mcp.ts", index: "src/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
});
