import { BLOCKED_HOST_PATTERNS } from '../../config/blocked-hosts';
import { APPROVED_STAGING_DATABASE_HOSTS } from '../../config/environments';
import { normalizeHost } from './environment-guard';
import { verifyHostResolution, type Resolver } from './dns-guard';

type Env = Record<string, string | undefined>;

export const DATABASE_TARGETS = [
  { system: 'Websales', envVar: 'QA_WEBSALES_DB_URL' },
  { system: 'Membership', envVar: 'QA_MEMBERSHIP_DB_URL' },
  { system: 'POS', envVar: 'QA_POS_DB_URL' },
] as const;

export interface DatabaseTarget {
  system: string;
  host: string;
  port: string;
  database: string;
}

const PRODUCTION_NAME = /(^|[^a-z])(prod|production|live)([^a-z]|$)|internetticketing/i;

export interface DatabasePolicy {
  approvedHosts: readonly string[];
  blockedPatterns: readonly RegExp[];
}

export const stagingDatabasePolicy: DatabasePolicy = {
  approvedHosts: APPROVED_STAGING_DATABASE_HOSTS,
  blockedPatterns: BLOCKED_HOST_PATTERNS,
};

/** Describes a connection by host/port/database only; credentials are never parsed out or echoed. */
export function describeDatabaseTarget(system: string, raw: string): DatabaseTarget {
  const url = new URL(raw);
  return { system, host: normalizeHost(url.hostname), port: url.port, database: url.pathname.replace(/^\//, '') };
}

/** Synchronous checks; pair with verifyDatabaseResolution before connecting. */
export function evaluateDatabaseTargets(env: Env = process.env, policy: DatabasePolicy = stagingDatabasePolicy): {
  targets: DatabaseTarget[];
  reasons: string[];
} {
  const reasons: string[] = [];
  const targets: DatabaseTarget[] = [];
  if (policy.approvedHosts.length === 0) {
    reasons.push('No staging database hosts are approved (config/environments.ts APPROVED_STAGING_DATABASE_HOSTS is empty).');
  }
  for (const { system, envVar } of DATABASE_TARGETS) {
    const raw = env[envVar]?.trim();
    if (!raw) {
      reasons.push(`${envVar} (${system}) is not set.`);
      continue;
    }
    let target: DatabaseTarget;
    try {
      target = describeDatabaseTarget(system, raw);
    } catch {
      reasons.push(`${envVar} (${system}) is not a valid connection URL.`);
      continue;
    }
    targets.push(target);
    const where = `${system} database ${target.host}/${target.database}`;
    if (policy.blockedPatterns.some((p) => p.test(target.host)) || PRODUCTION_NAME.test(target.host) || PRODUCTION_NAME.test(target.database)) {
      reasons.push(`${where} looks like PRODUCTION. Report this instead of continuing.`);
    } else if (target.host === 'localhost' || target.host.endsWith('.localhost') || /^[\d.:]+$/.test(target.host)) {
      reasons.push(`${where} is a localhost/IP substitute (e.g. a tunnel) that hides the real destination.`);
    } else if (!policy.approvedHosts.map(normalizeHost).includes(target.host)) {
      reasons.push(`${where} is not an approved staging database host.`);
    }
  }
  return { targets, reasons };
}

export async function verifyDatabaseResolution(targets: DatabaseTarget[], resolver?: Resolver): Promise<string[]> {
  return verifyHostResolution([...new Set(targets.map((t) => t.host))], resolver);
}

export class UnsafeDatabaseTargetError extends Error {
  constructor(reasons: string[]) {
    super(`DATABASE TARGETS REFUSED: ${reasons.join(' ')}`);
    this.name = 'UnsafeDatabaseTargetError';
  }
}

/** Must be awaited before any Websales, Membership, or POS connection is opened. */
export async function requireStagingDatabases(env: Env = process.env, resolver?: Resolver): Promise<DatabaseTarget[]> {
  const { targets, reasons } = evaluateDatabaseTargets(env);
  if (reasons.length) throw new UnsafeDatabaseTargetError(reasons);
  const dnsReasons = await verifyDatabaseResolution(targets, resolver);
  if (dnsReasons.length) throw new UnsafeDatabaseTargetError(dnsReasons);
  return targets;
}
