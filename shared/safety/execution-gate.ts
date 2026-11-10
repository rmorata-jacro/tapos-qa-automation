import { SAFETY_POLICIES, type SafetyLevel } from './safety-levels';

type Env = Record<string, string | undefined>;

export interface GateDecision {
  permitted: boolean;
  level: SafetyLevel;
  reasons: string[];
}

export function isNightlyContext(env: Env = process.env): boolean {
  return (env.QA_RUN_CONTEXT ?? '').toLowerCase() === 'nightly';
}

/**
 * Decides whether a safety level may execute in the current process. Flags
 * only ever widen permission for interactive runs; the nightly context always
 * restricts execution to nightly-safe levels regardless of other flags.
 */
export function evaluateLevel(level: SafetyLevel, env: Env = process.env): GateDecision {
  const policy = SAFETY_POLICIES[level];
  const reasons: string[] = [];

  if (isNightlyContext(env) && !policy.nightlyAllowed) {
    reasons.push(`"${level}" tests are excluded from nightly runs (QA_RUN_CONTEXT=nightly).`);
  }
  for (const flag of policy.requiredFlags) {
    if (env[flag] !== '1') reasons.push(`${flag}=1 is required for "${level}" tests.`);
  }
  if ((level === 'provisioning' || level === 'destructive') && env.CI && env.QA_ALLOW_CI_HIGH_RISK !== '1') {
    reasons.push(`"${level}" tests may not run in CI.`);
  }

  return { permitted: reasons.length === 0, level, reasons };
}

export class ExecutionNotPermittedError extends Error {
  constructor(decision: GateDecision) {
    super(`EXECUTION NOT PERMITTED for safety level "${decision.level}": ${decision.reasons.join(' ')}`);
    this.name = 'ExecutionNotPermittedError';
  }
}
