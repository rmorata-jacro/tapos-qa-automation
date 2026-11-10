import { evaluateDatabaseTargets, verifyDatabaseResolution } from '../shared/safety/database-guard';
import { verifyHostResolution } from '../shared/safety/dns-guard';
import { proxyEnvironmentReasons, UnsafeEnvironmentError } from '../shared/safety/environment-guard';
import { evaluateIsolatedEnvironment } from '../shared/safety/isolated-environment';
import { requireProvisioningApproval } from '../shared/safety/provisioning-approval';
import { APPROVED_STAGING } from './environments';
import { describeRunPlan } from './run-plan';
import { resolveBaseUrl, selectedSuite } from './suites';

/** Prints the run plan and aborts the whole run before any test if a staging or approval gate is not satisfied. */
export default async function globalSetup(): Promise<void> {
  const suite = selectedSuite();
  console.log(describeRunPlan(suite));
  if (suite === 'framework') return;

  const baseURL = resolveBaseUrl(suite)!;
  const reasons = [...proxyEnvironmentReasons(), ...(await verifyHostResolution(APPROVED_STAGING.hosts))];
  if (reasons.length) throw new UnsafeEnvironmentError(`Staging network check failed: ${reasons.join(' ')}`);

  if (suite === 'B') requireProvisioningApproval();
  if (suite === 'C') {
    const isolation = evaluateIsolatedEnvironment(new URL(baseURL).hostname);
    if (isolation.length) throw new Error(`SUITE C REFUSED: ${isolation.join(' ')}`);
  }
  if (suite === 'B' || suite === 'C') {
    const { targets, reasons: dbReasons } = evaluateDatabaseTargets();
    const dnsReasons = dbReasons.length ? [] : await verifyDatabaseResolution(targets);
    if (dbReasons.length || dnsReasons.length) {
      throw new UnsafeEnvironmentError(`Database target check failed: ${[...dbReasons, ...dnsReasons].join(' ')}`);
    }
  }
}
