import pkg from '../package.json';

export const PKG_NAME = pkg.name;
export const VERSION = pkg.version;
export const CONFIG_FILENAME = `${PKG_NAME}.config.ts`;
export const SERVER_SCHEMA_URL = 'https://static.modelcontextprotocol.io/schemas/2025-07-09/server.schema.json';
