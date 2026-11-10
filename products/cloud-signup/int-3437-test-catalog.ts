import type { SafetyLevel } from '../../shared/safety/safety-levels';

export type Suite = 'A-readonly' | 'A-gated' | 'B' | 'C';
export type AutomationStatus =
  | 'MANUAL'
  | 'AUTOMATION CANDIDATE'
  | 'READY FOR AUTOMATION'
  | 'AUTOMATED'
  | 'BLOCKED'
  | 'NOT SUITABLE FOR AUTOMATION';

export type RiskId = 'RR-01' | 'RR-02' | 'RR-03' | 'RR-04' | 'RR-05' | 'RR-06' | 'RR-07' | 'RR-08' | 'RR-09' | 'RR-10';

export interface CatalogEntry {
  id: string;
  title: string;
  suite: Suite;
  level: SafetyLevel;
  status: AutomationStatus;
  /** Every write the test is expected to cause. Empty only for verified read-only tests. */
  expectedWrites: string[];
  risks: RiskId[];
  blockers: string[];
  /** Coverage the automation deliberately does not claim. */
  limits?: string[];
}

const CONTRACT = 'Expected behaviour unconfirmed in signup-contract.ts (INT-3437 ticket and comments not yet reviewed).';
const INBOX = 'TEST inbox adapter not configured (shared/test-data/test-inbox.ts).';
const STATE = 'Safe state-query adapter not configured (workflows/cloud-self-service-signup/state-checks).';
const FIXTURE_ONLY = 'No writes beyond the shared Suite B signup fixture (read-only state queries)';
const SOURCE = 'Implementation source not reviewed; Suite C needs mocked infrastructure or disposable databases in the product repository.';

export const INT_3437_CATALOG: Record<string, CatalogEntry> = {
  'TC-A01': {
    id: 'TC-A01', title: 'Signup landing page renders the signup entry form', suite: 'A-readonly', level: 'readonly',
    status: 'BLOCKED', expectedWrites: [], risks: [], blockers: [CONTRACT],
  },
  'TC-A02': {
    id: 'TC-A02', title: 'Invalid email addresses are rejected without creating a signup request', suite: 'A-readonly',
    level: 'readonly', status: 'BLOCKED', expectedWrites: [], risks: ['RR-01'], blockers: [CONTRACT],
    limits: ['If validation is server-side the network guard aborts the POST and the test must be reclassified to A-gated.'],
  },
  'TC-A03': {
    id: 'TC-A03', title: 'Signup is unavailable when the production signup feature gate is off', suite: 'A-readonly',
    level: 'readonly', status: 'BLOCKED', expectedWrites: [], risks: [],
    blockers: [CONTRACT, 'Needs a TEST host configured with the gate OFF (CLOUD_SIGNUP_GATE_OFF_BASE_URL). Production is never used.'],
  },
  'TC-A04': {
    id: 'TC-A04', title: 'Existing user entering their email on signup is directed to login', suite: 'A-gated',
    level: 'writes-signup', status: 'BLOCKED',
    expectedWrites: ['POST signup request for an existing TEST account email', 'Possibly one email to the existing TEST account'],
    risks: ['RR-06'], blockers: [CONTRACT, 'Dedicated existing TEST account (QA_EXISTING_USER_EMAIL).'],
  },
  'TC-A05': {
    id: 'TC-A05', title: 'Malformed and tampered verification tokens are rejected', suite: 'A-readonly', level: 'readonly',
    status: 'BLOCKED', expectedWrites: [], risks: ['RR-03'], blockers: [CONTRACT],
    limits: ['Expired tokens need an aged genuine token and remain manual until a safe expiry mechanism is confirmed.'],
  },
  'TC-A06': {
    id: 'TC-A06', title: 'Verification email reaches a plus-addressed inbox and its link verifies the address',
    suite: 'A-gated', level: 'writes-signup', status: 'BLOCKED',
    expectedWrites: ['One pending signup request', 'One verification email', 'Verification token consumed (email marked verified)'],
    risks: [], blockers: [CONTRACT, INBOX],
  },
  'TC-A07': {
    id: 'TC-A07', title: 'Signup details step enforces the password policy', suite: 'A-gated', level: 'writes-signup',
    status: 'BLOCKED',
    expectedWrites: ['One pending signup request', 'One verification email', 'Verification token consumed'],
    risks: ['RR-09'], blockers: [CONTRACT, INBOX],
    limits: ['The details form is never submitted; the complete-signup request is aborted by the network guard.'],
  },
  'TC-A08': {
    id: 'TC-A08', title: 'Signup options API returns valid regions and timezones', suite: 'A-readonly', level: 'readonly',
    status: 'BLOCKED', expectedWrites: [], risks: ['RR-05'], blockers: [CONTRACT],
  },
  'TC-A09': {
    id: 'TC-A09', title: 'Region and timezone selectors offer the options returned by the API', suite: 'A-gated',
    level: 'writes-signup', status: 'BLOCKED',
    expectedWrites: ['One pending signup request', 'One verification email', 'Verification token consumed'],
    risks: ['RR-05'], blockers: [CONTRACT, INBOX],
    limits: ['UI selection only. Persistence of region/timezone is verified only in TC-B07.'],
  },
  'TC-A10': {
    id: 'TC-A10', title: 'Signup requests beyond the rate limit are rejected', suite: 'A-gated', level: 'rate-limit',
    status: 'BLOCKED',
    expectedWrites: ['Up to (limit + 1) signup requests', 'Up to (limit) verification emails', 'Rate-limit counter for the runner IP/email'],
    risks: ['RR-01'], blockers: [CONTRACT, INBOX],
  },
  'RR-01': {
    id: 'RR-01', title: 'Duplicate signup request for the same pending email is handled once', suite: 'A-gated',
    level: 'writes-signup', status: 'BLOCKED',
    expectedWrites: ['Two signup submissions for one plus-address', 'One or two verification emails (per contract)'],
    risks: ['RR-01'], blockers: [CONTRACT, INBOX],
    limits: ['Without a state-query adapter, "one pending record" is inferred from UI and inbox only.'],
  },
  'TC-R02': {
    id: 'TC-R02', title: 'Existing user can still log in after signup changes', suite: 'A-gated', level: 'auth-session',
    status: 'BLOCKED', expectedWrites: ['Login session', 'Last-login / audit entry for the TEST account'],
    risks: ['RR-06'], blockers: [CONTRACT, 'Dedicated existing TEST account (QA_EXISTING_USER_EMAIL / QA_EXISTING_USER_PASSWORD).'],
  },

  'TC-B01': {
    id: 'TC-B01', title: 'Complete signup verifies, provisions, and auto-logs in the new cinema', suite: 'B',
    level: 'provisioning', status: 'BLOCKED',
    expectedWrites: ['One signup request', 'Verification + alert emails', 'ONE new staging cinema database', 'IT booking, Websales and Membership records', 'New user account'],
    risks: ['RR-07'], blockers: [CONTRACT, INBOX, STATE, 'Explicit Suite B approval.'],
  },
  'TC-B02': {
    id: 'TC-B02', title: 'Completed verification token cannot be reused', suite: 'B', level: 'provisioning',
    status: 'BLOCKED', expectedWrites: ['Token reuse attempt against the shared fixture signup'], risks: ['RR-02'],
    blockers: [CONTRACT, STATE],
  },
  'TC-B03': {
    id: 'TC-B03', title: 'Signup alert email is sent for the new signup', suite: 'B', level: 'provisioning',
    status: 'BLOCKED', expectedWrites: [FIXTURE_ONLY], risks: [], blockers: [CONTRACT, INBOX, 'Alert recipient TEST inbox (QA_SIGNUP_ALERT_INBOX).'],
  },
  'TC-B04': {
    id: 'TC-B04', title: 'User lands on the confirmed post-signup page', suite: 'B', level: 'provisioning',
    status: 'BLOCKED', expectedWrites: [FIXTURE_ONLY], risks: [], blockers: [CONTRACT],
  },
  'TC-B05': {
    id: 'TC-B05', title: 'Signup request is completed and its stored password is cleared', suite: 'B',
    level: 'provisioning', status: 'BLOCKED', expectedWrites: [FIXTURE_ONLY], risks: ['RR-09'], blockers: [STATE],
  },
  'TC-B06': {
    id: 'TC-B06', title: 'Exactly one IT booking, Websales and Membership record exists for the sitecode', suite: 'B',
    level: 'provisioning', status: 'BLOCKED', expectedWrites: [FIXTURE_ONLY], risks: ['RR-08'], blockers: [STATE],
  },
  'TC-B07': {
    id: 'TC-B07', title: 'POS database exists, matches the CLODEM template, and stores the chosen region/timezone',
    suite: 'B', level: 'provisioning', status: 'BLOCKED', expectedWrites: [FIXTURE_ONLY], risks: ['RR-05', 'RR-10'], blockers: [STATE, CONTRACT],
  },
  'TC-R01': {
    id: 'TC-R01', title: 'Existing CLODEM template and site are unchanged by provisioning', suite: 'B',
    level: 'provisioning', status: 'BLOCKED', expectedWrites: [FIXTURE_ONLY], risks: ['RR-04', 'RR-10'], blockers: [STATE, CONTRACT],
  },
  'TC-R03': {
    id: 'TC-R03', title: 'Password is stored only while pending and cleared after completion', suite: 'B',
    level: 'provisioning', status: 'BLOCKED', expectedWrites: [FIXTURE_ONLY], risks: ['RR-09'], blockers: [STATE],
  },
  'RR-04': {
    id: 'RR-04', title: 'New cinema user cannot access another site', suite: 'B', level: 'provisioning',
    status: 'BLOCKED', expectedWrites: ['One failed login attempt for the new user against the CLODEM site'],
    risks: ['RR-04'], blockers: [CONTRACT],
  },

  'HR-01': {
    id: 'HR-01', title: 'Concurrent signup requests for one email produce one signup', suite: 'C', level: 'destructive',
    status: 'AUTOMATION CANDIDATE', expectedWrites: ['Parallel signup requests', 'Verification emails'], risks: ['RR-01'], blockers: [SOURCE],
  },
  'HR-02': {
    id: 'HR-02', title: 'Sitecode collision is resolved without overwriting an existing site', suite: 'C',
    level: 'destructive', status: 'AUTOMATION CANDIDATE', expectedWrites: ['Forced sitecode collision'], risks: ['RR-04'], blockers: [SOURCE],
  },
  'HR-03': {
    id: 'HR-03', title: 'Partial provisioning failure rolls back created resources', suite: 'C', level: 'destructive',
    status: 'AUTOMATION CANDIDATE', expectedWrites: ['Injected provisioning failure'], risks: ['RR-08', 'RR-09'], blockers: [SOURCE],
  },
  'HR-04': {
    id: 'HR-04', title: 'Failed provisioning can be retried to a single consistent result', suite: 'C', level: 'destructive',
    status: 'AUTOMATION CANDIDATE', expectedWrites: ['Injected failure then retry'], risks: ['RR-07', 'RR-08', 'RR-09'], blockers: [SOURCE],
  },
  'HR-05': {
    id: 'HR-05', title: 'No orphan Websales or Membership records remain after failure', suite: 'C', level: 'destructive',
    status: 'AUTOMATION CANDIDATE', expectedWrites: ['Injected failure between system writes'], risks: ['RR-08'], blockers: [SOURCE],
  },
  'HR-06': {
    id: 'HR-06', title: 'Worker interruption is recovered and status polling times out cleanly', suite: 'C',
    level: 'destructive', status: 'AUTOMATION CANDIDATE', expectedWrites: ['Worker stopped mid-provisioning'], risks: ['RR-07'], blockers: [SOURCE],
  },
};

export interface RegressionRisk {
  id: RiskId;
  title: string;
  /** Implementation change/function that introduces the risk. */
  introducedBy: string;
  coveredBy: string[];
}

const SOURCE_UNREVIEWED = 'NOT YET IDENTIFIED — implementation source was not accessible during preparation.';

export const INT_3437_RISKS: RegressionRisk[] = [
  { id: 'RR-01', title: 'Duplicate signup requests', introducedBy: SOURCE_UNREVIEWED, coveredBy: ['RR-01', 'TC-A10', 'HR-01'] },
  { id: 'RR-02', title: 'Reused verification tokens', introducedBy: SOURCE_UNREVIEWED, coveredBy: ['TC-B02'] },
  { id: 'RR-03', title: 'Expired and tampered tokens', introducedBy: SOURCE_UNREVIEWED, coveredBy: ['TC-A05'] },
  { id: 'RR-04', title: 'Cross-site account or database isolation', introducedBy: SOURCE_UNREVIEWED, coveredBy: ['RR-04', 'TC-R01', 'HR-02'] },
  { id: 'RR-05', title: 'Incorrect region or timezone mapping', introducedBy: SOURCE_UNREVIEWED, coveredBy: ['TC-A08', 'TC-A09', 'TC-B07'] },
  { id: 'RR-06', title: 'Existing login workflow regression', introducedBy: SOURCE_UNREVIEWED, coveredBy: ['TC-A04', 'TC-R02'] },
  { id: 'RR-07', title: 'Provisioning status polling and timeout', introducedBy: SOURCE_UNREVIEWED, coveredBy: ['TC-B01', 'HR-04', 'HR-06'] },
  { id: 'RR-08', title: 'Missing or duplicate IT/Websales/Membership records', introducedBy: SOURCE_UNREVIEWED, coveredBy: ['TC-B06', 'HR-03', 'HR-04', 'HR-05'] },
  { id: 'RR-09', title: 'Plaintext password persistence after failures', introducedBy: SOURCE_UNREVIEWED, coveredBy: ['TC-B05', 'TC-R03', 'HR-03', 'HR-04'] },
  { id: 'RR-10', title: 'CLODEM template integrity', introducedBy: SOURCE_UNREVIEWED, coveredBy: ['TC-B07', 'TC-R01'] },
];

export function catalogEntry(id: string): CatalogEntry {
  const entry = INT_3437_CATALOG[id];
  if (!entry) throw new Error(`Unknown INT-3437 test ID "${id}". Add it to int-3437-test-catalog.ts first.`);
  return entry;
}

export function entriesForSuite(suite: Suite): CatalogEntry[] {
  return Object.values(INT_3437_CATALOG).filter((entry) => entry.suite === suite);
}
