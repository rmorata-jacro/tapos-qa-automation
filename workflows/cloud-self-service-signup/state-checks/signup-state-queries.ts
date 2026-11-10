export type SignupRequestStatus = 'pending' | 'provisioning' | 'completed' | 'failed' | 'not-found';

/**
 * Back-end state checks for the signup workflow. Every method returns only a
 * status, count, boolean, or fingerprint; implementations must never select,
 * log, or return credential or token values. Password checks use
 * `password IS NOT NULL` style predicates.
 */
export interface SignupStateQueries {
  signupRequestStatus(email: string): Promise<SignupRequestStatus>;
  signupRequestCount(email: string): Promise<number>;
  storedPasswordIsPresent(email: string): Promise<boolean>;
  sitecodeForSignup(email: string): Promise<string | null>;
  itBookingRecordCount(sitecode: string): Promise<number>;
  websalesRecordCount(sitecode: string): Promise<number>;
  membershipRecordCount(sitecode: string): Promise<number>;
  posDatabaseExists(sitecode: string): Promise<boolean>;
  posRegionSettings(sitecode: string): Promise<{ region: string; timezone: string }>;
  /** Hash of schema and template seed data, computed server-side. */
  schemaFingerprint(sitecode: string): Promise<string>;
}

export function resolveSignupStateQueries(env: Record<string, string | undefined> = process.env): SignupStateQueries {
  const adapter = env.QA_SIGNUP_STATE_ADAPTER;
  throw new Error(
    `TEST DATA PREREQUISITE NOT MET: ${
      adapter ? `state-query adapter "${adapter}" is not implemented` : 'no state-query adapter configured (QA_SIGNUP_STATE_ADAPTER)'
    }. Database access for INT-3437 verification (IT booking, Websales, Membership, POS) has not been agreed yet.`,
  );
}
