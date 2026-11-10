import { isIP } from 'node:net';
import { BLOCKED_HOST_PATTERNS } from '../../config/blocked-hosts';
import { APPROVED_STAGING } from '../../config/environments';

export class UnsafeEnvironmentError extends Error {
  constructor(message: string) {
    super(`UNSAFE ENVIRONMENT — automation stopped. ${message}`);
    this.name = 'UnsafeEnvironmentError';
  }
}

type Env = Record<string, string | undefined>;

export interface HostPolicy {
  allowedHosts: readonly string[];
  blockedPatterns: readonly RegExp[];
  /** Framework self-tests only: lets an allowlisted loopback IP be used over http. */
  allowLoopbackSelfTest?: boolean;
}

export type HostClass = 'allowed' | 'production' | 'local-substitute' | 'unknown';

export function normalizeHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
}

/** The only policy used for staging automation: approved hosts come from code, blocks can be added by env. */
export function stagingHostPolicy(env: Env = process.env): HostPolicy {
  const extra = (env.QA_BLOCKED_HOST_PATTERNS ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => new RegExp(p, 'i'));
  return { allowedHosts: APPROVED_STAGING.hosts, blockedPatterns: [...BLOCKED_HOST_PATTERNS, ...extra] };
}

function isLocalSubstitute(host: string): boolean {
  return host === 'localhost' || host.endsWith('.localhost') || isIP(host) !== 0 || !host.includes('.');
}

export function classifyHost(hostname: string, policy: HostPolicy = stagingHostPolicy()): HostClass {
  const host = normalizeHost(hostname);
  if (policy.blockedPatterns.some((pattern) => pattern.test(host))) return 'production';
  const listed = policy.allowedHosts.map(normalizeHost).includes(host);
  if (isLocalSubstitute(host)) return listed && policy.allowLoopbackSelfTest ? 'allowed' : 'local-substitute';
  return listed ? 'allowed' : 'unknown';
}

export function isAllowedHost(hostname: string, policy: HostPolicy = stagingHostPolicy()): boolean {
  return classifyHost(hostname, policy) === 'allowed';
}

const REJECTION: Record<Exclude<HostClass, 'allowed'>, string> = {
  production: 'is a PRODUCTION (blocked) host. Report this instead of continuing',
  'local-substitute': 'is a localhost/IP substitute that can hide the real destination',
  unknown: 'is not an approved staging host',
};

/** Parses and validates a URL automation is about to target. Fails closed on anything unexpected. */
export function assertStagingUrl(rawUrl: string | undefined, label: string, policy: HostPolicy = stagingHostPolicy()): URL {
  if (!rawUrl?.trim()) {
    throw new UnsafeEnvironmentError(`${label} is not set. Set it to ${APPROVED_STAGING.baseUrl} in your local .env.`);
  }
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new UnsafeEnvironmentError(`${label} is not a valid URL.`);
  }
  const hostClass = classifyHost(url.hostname, policy);
  if (hostClass !== 'allowed') {
    throw new UnsafeEnvironmentError(`${label} host "${normalizeHost(url.hostname)}" ${REJECTION[hostClass]}.`);
  }
  const loopbackSelfTest = policy.allowLoopbackSelfTest && isIP(normalizeHost(url.hostname)) !== 0;
  if (url.protocol !== 'https:' && !(loopbackSelfTest && url.protocol === 'http:')) {
    throw new UnsafeEnvironmentError(`${label} must use https.`);
  }
  if (url.username || url.password) throw new UnsafeEnvironmentError(`${label} must not contain credentials.`);
  if (url.port && !loopbackSelfTest) throw new UnsafeEnvironmentError(`${label} must use the default https port.`);
  return url;
}

const PROXY_VARS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'];

/** Proxies can forward "staging" traffic anywhere, so staging runs refuse them. */
export function proxyEnvironmentReasons(env: Env = process.env): string[] {
  return PROXY_VARS.filter((name) => env[name]?.trim()).map(
    (name) => `${name} is set; proxies can hide the real destination of staging traffic.`,
  );
}

/** Shared by every request path: browser routes, API requests, and redirect targets. */
export function describeRejection(rawUrl: string, policy: HostPolicy = stagingHostPolicy()): string | undefined {
  try {
    assertStagingUrl(rawUrl, 'Request', policy);
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
}
