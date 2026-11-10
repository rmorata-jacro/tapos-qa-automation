import { BLOCKED_HOST_PATTERNS } from '../../config/blocked-hosts';

export class UnsafeEnvironmentError extends Error {
  constructor(message: string) {
    super(`UNSAFE ENVIRONMENT — automation stopped. ${message}`);
    this.name = 'UnsafeEnvironmentError';
  }
}

type Env = Record<string, string | undefined>;

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function blockedHostPatterns(env: Env = process.env): RegExp[] {
  const extra = splitList(env.QA_BLOCKED_HOST_PATTERNS).map((pattern) => new RegExp(pattern, 'i'));
  return [...BLOCKED_HOST_PATTERNS, ...extra];
}

export function allowedTestHosts(env: Env = process.env): string[] {
  return splitList(env.QA_ALLOWED_HOSTS);
}

export function isBlockedHost(hostname: string, env: Env = process.env): boolean {
  return blockedHostPatterns(env).some((pattern) => pattern.test(hostname));
}

export function isAllowedTestHost(hostname: string, env: Env = process.env): boolean {
  const host = hostname.toLowerCase();
  return !isBlockedHost(host, env) && allowedTestHosts(env).includes(host);
}

/**
 * Validates a URL that automation is about to target. Only hosts explicitly
 * listed in QA_ALLOWED_HOSTS are accepted, and a blocked (production) pattern
 * always wins over the allowlist.
 */
export function assertTestUrl(rawUrl: string | undefined, label: string, env: Env = process.env): URL {
  if (!rawUrl) {
    throw new UnsafeEnvironmentError(`${label} is not set. Configure it in your local .env (see .env.example).`);
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeEnvironmentError(`${label} is not a valid URL.`);
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new UnsafeEnvironmentError(`${label} must use https.`);
  }
  if (isBlockedHost(url.hostname, env)) {
    throw new UnsafeEnvironmentError(
      `${label} host "${url.hostname}" matches a blocked production pattern. Report this instead of continuing.`,
    );
  }
  if (!allowedTestHosts(env).includes(url.hostname.toLowerCase())) {
    throw new UnsafeEnvironmentError(
      `${label} host "${url.hostname}" is not in QA_ALLOWED_HOSTS. Only approved TEST hosts may be targeted.`,
    );
  }
  return url;
}
