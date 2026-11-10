import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { selectedSuite } from '../../config/suites';
import { evaluateLevel } from '../../shared/safety/execution-gate';
import { evaluateIsolatedEnvironment } from '../../shared/safety/isolated-environment';
import {
  claimProvisioningApproval,
  evaluateProvisioningApproval,
  PROVISIONING_PRECONDITIONS,
} from '../../shared/safety/provisioning-approval';

test.describe('execution gate', () => {
  test('read-only tests need no flags; gated levels need their flags', () => {
    expect(evaluateLevel('readonly', {}).permitted).toBe(true);
    expect(evaluateLevel('writes-signup', {}).permitted).toBe(false);
    expect(evaluateLevel('writes-signup', { QA_ALLOW_SIGNUP_WRITES: '1' }).permitted).toBe(true);
    expect(evaluateLevel('rate-limit', { QA_ALLOW_RATE_LIMIT: '1' }).permitted).toBe(false);
  });

  test('nightly context refuses every non-nightly level even when flags are set', () => {
    const env = {
      QA_RUN_CONTEXT: 'nightly', QA_ALLOW_SIGNUP_WRITES: '1', QA_ALLOW_RATE_LIMIT: '1',
      QA_ALLOW_AUTH_SESSION: '1', QA_ALLOW_PROVISIONING: '1', QA_ALLOW_DESTRUCTIVE: '1',
    };
    for (const level of ['auth-session', 'writes-signup', 'rate-limit', 'provisioning', 'destructive'] as const) {
      expect(evaluateLevel(level, env).permitted, level).toBe(false);
    }
    expect(evaluateLevel('readonly', env).permitted).toBe(true);
  });

  test('provisioning and destructive levels are refused in CI', () => {
    expect(evaluateLevel('provisioning', { CI: 'true', QA_ALLOW_PROVISIONING: '1' }).permitted).toBe(false);
  });

  test('nightly runs cannot select gated suites', () => {
    expect(selectedSuite({ QA_RUN_CONTEXT: 'nightly', QA_SUITE: 'A-readonly' })).toBe('A-readonly');
    for (const suite of ['A-gated', 'B', 'C']) {
      expect(() => selectedSuite({ QA_RUN_CONTEXT: 'nightly', QA_SUITE: suite }), suite).toThrow(/not permitted in nightly/);
    }
    expect(selectedSuite({})).toBe('framework');
  });
});

test.describe('Suite B provisioning approval', () => {
  const approvedEnv = (stateDir: string) => ({
    QA_SUITE: 'B',
    QA_ALLOW_PROVISIONING: '1',
    QA_SUITE_B_APPROVAL_ID: 'INT-3437-approval-001',
    QA_SUITE_B_APPROVED_BY: 'QA Lead',
    QA_SUITE_B_MAX_NEW_DATABASES: '1',
    QA_STATE_DIR: stateDir,
    ...Object.fromEntries(PROVISIONING_PRECONDITIONS.map(({ flag }) => [flag, 'yes'])),
  });

  test('is refused by default with every missing requirement listed', () => {
    const { approval, reasons } = evaluateProvisioningApproval({});
    expect(approval).toBeUndefined();
    expect(reasons.join(' ')).toContain('QA_SUITE_B_APPROVAL_ID');
    for (const { flag } of PROVISIONING_PRECONDITIONS) expect(reasons.join(' ')).toContain(flag);
  });

  test('requires exactly one approved database', () => {
    const env = { ...approvedEnv('/tmp/unused'), QA_SUITE_B_MAX_NEW_DATABASES: '2' };
    expect(evaluateProvisioningApproval(env).reasons.join(' ')).toContain('exactly "1"');
  });

  test('stays refused while database targets are not approved, even with every other requirement met', () => {
    const { approval, reasons } = evaluateProvisioningApproval(approvedEnv('/tmp/unused'));
    expect(approval).toBeUndefined();
    expect(reasons.join(' ')).toContain('No staging database hosts are approved');
  });

  test('an approval can be claimed only once', () => {
    const env = approvedEnv(mkdtempSync(path.join(tmpdir(), 'qa-state-')));
    const approval = { approvalId: env.QA_SUITE_B_APPROVAL_ID, approvedBy: env.QA_SUITE_B_APPROVED_BY, maxNewDatabases: 1 as const };
    claimProvisioningApproval(approval, env);
    expect(() => claimProvisioningApproval(approval, env)).toThrow(/already been used/);
  });
});

test.describe('Suite C isolation gate', () => {
  const env = {
    QA_SUITE: 'C', QA_ALLOW_DESTRUCTIVE: '1', QA_ISOLATED_ENVIRONMENT_CONFIRMED: 'yes', QA_SUITE_C_APPROVAL_ID: 'c-approval',
    QA_ISOLATED_HOSTS: 'isolated.qa.example,staging.qa.example', QA_SHARED_STAGING_HOSTS: 'staging.qa.example',
  };

  test('accepts only a declared isolated, non-shared host', () => {
    const hostReasons = (host: string) => evaluateIsolatedEnvironment(host, env).filter((r) => r.includes('Host'));
    expect(hostReasons('isolated.qa.example')).toEqual([]);
    expect(evaluateIsolatedEnvironment('staging.qa.example', env).join(' ')).toContain('shared staging host');
    expect(evaluateIsolatedEnvironment('other.example', env).join(' ')).toContain('not listed in QA_ISOLATED_HOSTS');
  });
});
