/**
 * Every automated test must declare exactly one safety level. The level is
 * derived from the test's real network requests and side effects, never from
 * the fact that it "only looks at a page".
 */
export const SAFETY_LEVELS = [
  'framework',
  'readonly',
  'auth-session',
  'writes-signup',
  'rate-limit',
  'provisioning',
  'destructive',
] as const;

export type SafetyLevel = (typeof SAFETY_LEVELS)[number];

export interface SafetyLevelPolicy {
  description: string;
  /** May run unattended in the nightly pipeline. */
  nightlyAllowed: boolean;
  /** Environment flags that must all equal "1" before the level may run. */
  requiredFlags: string[];
  /** Skipping is acceptable for opt-in levels; hard levels must refuse loudly. */
  onDenied: 'skip' | 'fail';
}

export const SAFETY_POLICIES: Record<SafetyLevel, SafetyLevelPolicy> = {
  framework: {
    description: 'Pure framework self-test. No browser, no network.',
    nightlyAllowed: true,
    requiredFlags: [],
    onDenied: 'fail',
  },
  readonly: {
    description:
      'GET/HEAD/OPTIONS only against the TEST host. Mutating requests to the TEST host are aborted and fail the test.',
    nightlyAllowed: true,
    requiredFlags: [],
    onDenied: 'fail',
  },
  'auth-session': {
    description:
      'Logs in with a dedicated TEST account. Writes session / last-login / audit rows only.',
    nightlyAllowed: false,
    requiredFlags: ['QA_ALLOW_AUTH_SESSION'],
    onDenied: 'skip',
  },
  'writes-signup': {
    description:
      'Submits signup or verification requests: creates pending signup requests and sends verification emails. Never completes signup details or provisioning.',
    nightlyAllowed: false,
    requiredFlags: ['QA_ALLOW_SIGNUP_WRITES'],
    onDenied: 'skip',
  },
  'rate-limit': {
    description:
      'Deliberately exceeds the signup rate limit. Sends several emails and may temporarily block the runner IP for other testers.',
    nightlyAllowed: false,
    requiredFlags: ['QA_ALLOW_SIGNUP_WRITES', 'QA_ALLOW_RATE_LIMIT'],
    onDenied: 'skip',
  },
  provisioning: {
    description:
      'Completes a real signup and provisions exactly one new staging cinema database. Requires explicit recorded approval.',
    nightlyAllowed: false,
    requiredFlags: ['QA_ALLOW_PROVISIONING'],
    onDenied: 'fail',
  },
  destructive: {
    description:
      'Failure injection / concurrency / rollback testing. Isolated environment and separate approval only.',
    nightlyAllowed: false,
    requiredFlags: ['QA_ALLOW_DESTRUCTIVE'],
    onDenied: 'fail',
  },
};

export function isSafetyLevel(value: unknown): value is SafetyLevel {
  return typeof value === 'string' && (SAFETY_LEVELS as readonly string[]).includes(value);
}

export const SAFETY_ANNOTATION = 'safety-level';
