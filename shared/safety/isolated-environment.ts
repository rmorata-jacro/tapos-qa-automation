import { evaluateLevel } from './execution-gate';

type Env = Record<string, string | undefined>;

function hosts(value: string | undefined): string[] {
  return (value ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
}

/**
 * Suite C (failure injection, concurrency, rollback) may only target an
 * environment that is explicitly declared isolated and is not a shared
 * staging host.
 */
export function evaluateIsolatedEnvironment(targetHost: string | undefined, env: Env = process.env): string[] {
  const reasons = [...evaluateLevel('destructive', env).reasons];
  if (env.QA_SUITE !== 'C') reasons.push('QA_SUITE must be "C".');
  if (env.QA_ISOLATED_ENVIRONMENT_CONFIRMED !== 'yes') {
    reasons.push('QA_ISOLATED_ENVIRONMENT_CONFIRMED=yes is required.');
  }
  if (!env.QA_SUITE_C_APPROVAL_ID?.trim()) reasons.push('QA_SUITE_C_APPROVAL_ID must reference the separate Suite C approval.');
  const host = targetHost?.toLowerCase();
  if (!host) {
    reasons.push('No target host configured.');
  } else {
    if (!hosts(env.QA_ISOLATED_HOSTS).includes(host)) reasons.push(`Host "${host}" is not listed in QA_ISOLATED_HOSTS.`);
    if (hosts(env.QA_SHARED_STAGING_HOSTS).includes(host)) {
      reasons.push(`Host "${host}" is a shared staging host; Suite C must not run there.`);
    }
  }
  return reasons;
}
