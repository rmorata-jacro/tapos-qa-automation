import { evaluateIsolatedEnvironment } from '../shared/safety/isolated-environment';
import { requireProvisioningApproval } from '../shared/safety/provisioning-approval';
import { describeRunPlan } from './run-plan';
import { selectedSuite } from './suites';

/** Prints the run plan and aborts the whole run before any test if a hard gate is not satisfied. */
export default function globalSetup(): void {
  const suite = selectedSuite();
  console.log(describeRunPlan(suite));

  if (suite === 'B') requireProvisioningApproval();
  if (suite === 'C') {
    const host = process.env.CLOUD_SIGNUP_BASE_URL ? new URL(process.env.CLOUD_SIGNUP_BASE_URL).hostname : undefined;
    const reasons = evaluateIsolatedEnvironment(host);
    if (reasons.length) throw new Error(`SUITE C REFUSED: ${reasons.join(' ')}`);
  }
}
