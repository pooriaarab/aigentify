/**
 * Personal Agent Protocol (Poppy) draft 0.1 document checks.
 * Spec: https://personalagentprotocol.org/docs/spec
 *
 * These rules only look at the JSON file itself. They do not start a
 * session or call the company's OAuth server.
 */

import type { AuditStatus, Endpoint } from './types.js';
import { ok } from './shared.js';

export interface PoppyValidation {
  valid: boolean;
  reason: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isHttpsUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https:\/\//i.test(value);
}

function fail(reason: string): PoppyValidation {
  return { valid: false, reason };
}

function parseObject(text: string): Record<string, unknown> | string {
  try {
    const parsed: unknown = JSON.parse(text);
    return asRecord(parsed) ?? 'poppy.json must be a JSON object.';
  } catch {
    return 'poppy.json is not valid JSON.';
  }
}

function checkVersion(doc: Record<string, unknown>): string | undefined {
  if (typeof doc.protocol_version !== 'string' || !/^\d+\.\d+$/.test(doc.protocol_version)) {
    return 'protocol_version must be a major.minor string such as "0.1".';
  }
  if (doc.protocol_version.split('.')[0] !== '0') {
    return `This auditor supports Poppy major version 0, not ${doc.protocol_version.split('.')[0]}.`;
  }
  return undefined;
}

function checkOrganization(doc: Record<string, unknown>): string | undefined {
  const organization = asRecord(doc.organization);
  if (!organization || typeof organization.name !== 'string' || !organization.name.trim()) {
    return 'organization.name is required.';
  }
  if (typeof organization.domain !== 'string' || !organization.domain.trim()) {
    return 'organization.domain is required.';
  }
  return undefined;
}

function checkAgentProtocols(agent: Record<string, unknown>): string | undefined {
  if (agent.protocols === undefined) return undefined;
  if (!Array.isArray(agent.protocols) || agent.protocols.length === 0) {
    return 'agent.protocols must be a non-empty array when present.';
  }
  const bad = agent.protocols.some((entry) => {
    const protocol = asRecord(entry);
    return !protocol || typeof protocol.type !== 'string' || !protocol.type.trim() || !isHttpsUrl(protocol.endpoint);
  });
  return bad ? 'Each agent protocol needs a type and an HTTPS endpoint.' : undefined;
}

function checkApis(apis: unknown[]): string | undefined {
  if (apis.length === 0) return 'apis must list at least one API when present.';
  const bad = apis.some((entry) => {
    const api = asRecord(entry);
    return !api || typeof api.type !== 'string' || !isHttpsUrl(api.url)
      || typeof api.description !== 'string' || !api.description.trim();
  });
  return bad ? 'Each API needs type, an HTTPS url, and a description.' : undefined;
}

function checkAuth(doc: Record<string, unknown>, agent: Record<string, unknown> | undefined, apis: unknown[] | undefined, web: Record<string, unknown> | undefined): string | undefined {
  const needsAuth = Boolean(agent || apis || web?.browser_session_endpoint);
  if (!needsAuth) return undefined;
  const auth = asRecord(doc.auth);
  return auth && isHttpsUrl(auth.issuer)
    ? undefined
    : 'auth.issuer must be an HTTPS URL when agent, apis, or a browser session endpoint is listed.';
}

function listedSurfaces(doc: Record<string, unknown>): {
  agent: Record<string, unknown> | undefined;
  web: Record<string, unknown> | undefined;
  apis: unknown[] | undefined;
} {
  return {
    agent: asRecord(doc.agent),
    web: asRecord(doc.web),
    apis: Array.isArray(doc.apis) ? doc.apis : undefined,
  };
}

function firstDocumentError(doc: Record<string, unknown>): string | undefined {
  const versionError = checkVersion(doc);
  if (versionError) return versionError;
  const organizationError = checkOrganization(doc);
  if (organizationError) return organizationError;
  const { agent, web, apis } = listedSurfaces(doc);
  if (!agent && !web && !apis) return 'poppy.json must list at least one of agent, apis, or web.';
  return (agent ? checkAgentProtocols(agent) : undefined)
    ?? (apis ? checkApis(apis) : undefined)
    ?? checkAuth(doc, agent, apis, web);
}

export function validatePoppyDocument(text: string): PoppyValidation {
  const parsed = parseObject(text);
  if (typeof parsed === 'string') return fail(parsed);
  const reason = firstDocumentError(parsed);
  return reason ? fail(reason) : { valid: true, reason: 'poppy.json follows Personal Agent Protocol draft 0.1.' };
}

export function isValidPoppyDocument(text: string): boolean {
  return validatePoppyDocument(text).valid;
}

export function poppyStatus(urlOnly: boolean, endpoint: Endpoint): AuditStatus {
  if (!urlOnly) return 'na';
  if (!ok(endpoint.status) || !endpoint.text.trim()) return 'warn';
  return validatePoppyDocument(endpoint.text).valid ? 'pass' : 'warn';
}

export function poppyNote(status: AuditStatus, endpoint: Endpoint): string {
  if (status === 'pass') return 'A valid /.well-known/poppy.json (Personal Agent Protocol) is available.';
  if (status === 'na') return 'Not audited (no served web surface).';
  if (!ok(endpoint.status) || !endpoint.text.trim()) return 'No /.well-known/poppy.json was found.';
  return validatePoppyDocument(endpoint.text).reason;
}
