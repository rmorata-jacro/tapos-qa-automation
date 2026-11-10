import { entriesForSuite } from '../products/cloud-signup/int-3437-test-catalog';
import { evaluateDatabaseTargets } from '../shared/safety/database-guard';
import { assertStagingUrl } from '../shared/safety/environment-guard';
import { evaluateLevel } from '../shared/safety/execution-gate';
import { evaluateIsolatedEnvironment } from '../shared/safety/isolated-environment';
import { evaluateProvisioningApproval } from '../shared/safety/provisioning-approval';
import { redactEmail } from '../shared/safety/redaction';
import { SAFETY_POLICIES } from '../shared/safety/safety-levels';
import { APPROVED_STAGING, PRODUCTION_URLS } from './environments';
import { loadLocalEnv } from './load-env';
import { selectedSuite, type SuiteSelection } from './suites';

type Env = Record<string, string | undefined>;

const ACCOUNT_VARS = ['QA_TEST_INBOX_ADDRESS', 'QA_EXISTING_USER_EMAIL', 'QA_SIGNUP_ALERT_INBOX'];

function host(raw: string | undefined): string {
  if (!raw) return 'NOT CONFIGURED';
  try {
    return new URL(raw).host;
  } catch {
    return 'INVALID URL';
  }
}

/** Human-readable statement of what a suite run will do, printed before every run. */
export function describeRunPlan(suite: SuiteSelection, env: Env = process.env): string {
  let urlStatus: string;
  try {
    urlStatus = `${assertStagingUrl(env.CLOUD_SIGNUP_BASE_URL, 'CLOUD_SIGNUP_BASE_URL').origin} (approved staging)`;
  } catch (error) {
    urlStatus = `REFUSED — ${(error as Error).message}`;
  }
  const lines = [
    `=== INT-3437 run plan: suite ${suite} ===`,
    `Configured base URL: ${urlStatus}`,
    `Approved staging hosts (code): ${APPROVED_STAGING.hosts.join(', ')}`,
    `Production (always blocked): ${PRODUCTION_URLS.join(', ')}`,
  ];
  if (suite === 'framework') {
    lines.push('Framework self-tests only: no TEST/staging traffic, no writes. Browser checks use a local loopback server.');
    return lines.join('\n');
  }

  lines.push('Test accounts / inboxes:');
  for (const name of ACCOUNT_VARS) lines.push(`  ${name}: ${env[name] ? redactEmail(env[name]!) : 'not set'}`);
  lines.push(`  QA_EXISTING_USER_PASSWORD: ${env.QA_EXISTING_USER_PASSWORD ? 'set (value hidden)' : 'not set'}`);

  const entries = entriesForSuite(suite);
  lines.push('', 'Selected tests (catalog):');
  for (const entry of entries) {
    const decision = evaluateLevel(entry.level, env);
    lines.push(`  ${entry.id} [${entry.level}] ${entry.title}`);
    lines.push(`    permitted now: ${decision.permitted ? 'YES' : `NO — ${decision.reasons.join(' ')}`}`);
    lines.push(`    expected writes: ${entry.expectedWrites.length ? entry.expectedWrites.join('; ') : 'none (read-only)'}`);
    if (entry.blockers.length) lines.push(`    blockers: ${entry.blockers.join(' ')}`);
  }

  const writes = entries.flatMap((e) => e.expectedWrites).join(' ').toLowerCase();
  lines.push(
    '',
    `Emails sent: ${/email/.test(writes) ? 'YES' : 'no'}`,
    `Signup records created: ${/signup request|signup submission/.test(writes) ? 'YES' : 'no'}`,
    `Databases created: ${/database/.test(writes) ? 'YES — exactly one (approval required)' : 'no'}`,
    `Nightly-safe: ${entries.every((e) => SAFETY_POLICIES[e.level].nightlyAllowed) ? 'yes' : 'NO'}`,
  );

  if (suite === 'B' || suite === 'C') {
    const { targets, reasons } = evaluateDatabaseTargets(env);
    lines.push('', 'Database targets (credentials never shown):');
    for (const t of targets) lines.push(`  ${t.system}: ${t.host}${t.port ? `:${t.port}` : ''}/${t.database}`);
    lines.push(`  check: ${reasons.length ? `REFUSED — ${reasons.join(' ')}` : 'approved staging (DNS verified at run time)'}`);
  }
  if (suite === 'B') {
    const { reasons } = evaluateProvisioningApproval(env);
    lines.push('', `Suite B approval gate: ${reasons.length ? `REFUSED — ${reasons.join(' ')}` : 'satisfied'}`);
  }
  if (suite === 'C') {
    const reasons = evaluateIsolatedEnvironment(host(env.CLOUD_SIGNUP_BASE_URL).toLowerCase(), env);
    lines.push('', `Suite C isolation gate: ${reasons.length ? `REFUSED — ${reasons.join(' ')}` : 'satisfied'}`);
  }
  return lines.join('\n');
}

if (require.main === module) {
  loadLocalEnv();
  const env = { ...process.env, QA_SUITE: process.argv[2] ?? process.env.QA_SUITE };
  console.log(describeRunPlan(selectedSuite(env), env));
}
