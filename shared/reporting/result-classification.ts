import { SECURITY_CHALLENGE_ANNOTATION, SECURITY_CHALLENGE_CLASSIFICATION } from './security-challenge';

export type ResultClassification =
  | 'PASS'
  | 'FAIL'
  | typeof SECURITY_CHALLENGE_CLASSIFICATION
  | 'BLOCKED — Expected behaviour unconfirmed'
  | 'BLOCKED — Not permitted'
  | 'BLOCKED — Prerequisite';

export interface ClassifiableResult {
  /** Playwright status of the attempt: passed, failed, timedOut, skipped, interrupted. */
  status: string;
  annotations: { type: string; description?: string }[];
}

/**
 * Maps a raw Playwright result onto the QA report status. A detected security
 * challenge always wins, so a test that failed on a challenge page is never
 * reported as an INT-3437 functional failure. The raw status stays in the
 * report next to the classification.
 */
export function classifyResult(result: ClassifiableResult): ResultClassification {
  if (result.annotations.some((a) => a.type === SECURITY_CHALLENGE_ANNOTATION)) return SECURITY_CHALLENGE_CLASSIFICATION;
  if (result.status === 'passed') return 'PASS';
  if (result.status === 'skipped') {
    const reason = result.annotations.filter((a) => a.type === 'skip').map((a) => a.description ?? '').join(' ');
    if (reason.startsWith('BLOCKED — needs confirmation')) return 'BLOCKED — Expected behaviour unconfirmed';
    if (reason.startsWith('NOT PERMITTED')) return 'BLOCKED — Not permitted';
    return 'BLOCKED — Prerequisite';
  }
  return 'FAIL';
}
