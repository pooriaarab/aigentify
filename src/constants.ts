import pkg from '../package.json';

export const PKG_NAME = pkg.name;
export const VERSION = pkg.version;
export const CONFIG_FILENAME = `${PKG_NAME}.config.ts`;
export const SERVER_SCHEMA_URL = 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json';
// Any dated MCP registry schema is valid; only the bare `.../server.json` (no `.schema`) 404s.
export const SERVER_SCHEMA_RE = /^https:\/\/static\.modelcontextprotocol\.io\/schemas\/\d{4}-\d{2}-\d{2}\/server\.schema\.json$/;
