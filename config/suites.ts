import type { Suite } from '../products/cloud-signup/int-3437-test-catalog';
import { assertStagingUrl } from '../shared/safety/environment-guard';

export type SuiteSelection = 'framework' | Suite;

export const SUITE_SELECTIONS: SuiteSelection[] = ['framework', 'A-readonly', 'A-gated', 'B', 'C'];

export const NIGHTLY_SUITES: SuiteSelection[] = ['framework', 'A-readonly'];

export const SUITE_FILES: Record<SuiteSelection, { testDir: string; testMatch: string }> = {
  framework: { testDir: 'tests/framework', testMatch: '**/*.spec.ts' },
  'A-readonly': { testDir: 'products/cloud-signup/tests', testMatch: 'suite-a-readonly.spec.ts' },
  'A-gated': { testDir: 'products/cloud-signup/tests', testMatch: 'suite-a-gated.spec.ts' },
  B: { testDir: 'workflows/cloud-self-service-signup/tests', testMatch: 'suite-b-provisioning.spec.ts' },
  C: { testDir: 'workflows/cloud-self-service-signup/tests', testMatch: 'suite-c-high-risk.spec.ts' },
};

export function selectedSuite(env: Record<string, string | undefined> = process.env): SuiteSelection {
  const raw = env.QA_SUITE ?? 'framework';
  if (!(SUITE_SELECTIONS as string[]).includes(raw)) {
    throw new Error(`Unknown QA_SUITE "${raw}". Use one of: ${SUITE_SELECTIONS.join(', ')}.`);
  }
  const suite = raw as SuiteSelection;
  if ((env.QA_RUN_CONTEXT ?? '').toLowerCase() === 'nightly' && !NIGHTLY_SUITES.includes(suite)) {
    throw new Error(`QA_SUITE "${suite}" is not permitted in nightly runs. Nightly allows: ${NIGHTLY_SUITES.join(', ')}.`);
  }
  return suite;
}

/** Fails closed: every suite except the framework self-tests needs a valid approved staging base URL. */
export function resolveBaseUrl(suite: SuiteSelection, env: Record<string, string | undefined> = process.env): string | undefined {
  if (suite === 'framework') return undefined;
  return assertStagingUrl(env.CLOUD_SIGNUP_BASE_URL, 'CLOUD_SIGNUP_BASE_URL').origin;
}
