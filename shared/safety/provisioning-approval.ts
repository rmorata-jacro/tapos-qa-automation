import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { evaluateLevel } from './execution-gate';

type Env = Record<string, string | undefined>;

/**
 * Preconditions an operator must confirm before a provisioning run. Each is
 * an explicit environment declaration because the runner cannot independently
 * prove disk space, worker health, or template approval on shared staging.
 */
export const PROVISIONING_PRECONDITIONS = [
  { flag: 'QA_PRECHECK_STAGING_VERIFIED', meaning: 'Staging environment verified as the approved TEST environment' },
  { flag: 'QA_PRECHECK_DISK_SPACE', meaning: 'Adequate disk space for one new cinema database' },
  { flag: 'QA_PRECHECK_WORKER_RUNNING', meaning: 'Provisioning background worker is running' },
  { flag: 'QA_PRECHECK_CLODEM_TEMPLATE_APPROVED', meaning: 'CLODEM template available and approved' },
  { flag: 'QA_PRECHECK_TEST_INBOX', meaning: 'Test inbox configured and reachable' },
  { flag: 'QA_PRECHECK_REDIRECT_CONFIRMED', meaning: 'Expected post-signup redirect confirmed with product owner' },
] as const;

const APPROVAL_ID = /^[A-Za-z0-9._-]{6,64}$/;

export interface ProvisioningApproval {
  approvalId: string;
  approvedBy: string;
  maxNewDatabases: 1;
}

export class ProvisioningNotApprovedError extends Error {
  constructor(reasons: string[]) {
    super(`PROVISIONING REFUSED (Suite B hard gate): ${reasons.join(' ')}`);
    this.name = 'ProvisioningNotApprovedError';
  }
}

export function evaluateProvisioningApproval(env: Env = process.env): { approval?: ProvisioningApproval; reasons: string[] } {
  const reasons = [...evaluateLevel('provisioning', env).reasons];

  if (env.QA_SUITE !== 'B') reasons.push('QA_SUITE must be "B".');
  if (!env.QA_SUITE_B_APPROVAL_ID || !APPROVAL_ID.test(env.QA_SUITE_B_APPROVAL_ID)) {
    reasons.push('QA_SUITE_B_APPROVAL_ID must reference the recorded approval (6-64 chars, [A-Za-z0-9._-]).');
  }
  if (!env.QA_SUITE_B_APPROVED_BY?.trim()) reasons.push('QA_SUITE_B_APPROVED_BY must name the approver.');
  if (env.QA_SUITE_B_MAX_NEW_DATABASES !== '1') {
    reasons.push('QA_SUITE_B_MAX_NEW_DATABASES must be exactly "1".');
  }
  for (const { flag, meaning } of PROVISIONING_PRECONDITIONS) {
    if (env[flag] !== 'yes') reasons.push(`${flag}=yes is required (${meaning}).`);
  }

  if (reasons.length > 0) return { reasons };
  return {
    reasons,
    approval: {
      approvalId: env.QA_SUITE_B_APPROVAL_ID!,
      approvedBy: env.QA_SUITE_B_APPROVED_BY!.trim(),
      maxNewDatabases: 1,
    },
  };
}

export function requireProvisioningApproval(env: Env = process.env): ProvisioningApproval {
  const { approval, reasons } = evaluateProvisioningApproval(env);
  if (!approval) throw new ProvisioningNotApprovedError(reasons);
  return approval;
}

export function approvalLedgerDir(env: Env = process.env): string {
  return path.resolve(env.QA_STATE_DIR ?? '.qa-state', 'provisioning-approvals');
}

/**
 * Consumes an approval exactly once. The claim file is created with the "wx"
 * flag so a second run, a retry, or a parallel worker using the same approval
 * cannot provision a second database.
 */
export function claimProvisioningApproval(approval: ProvisioningApproval, env: Env = process.env): string {
  const dir = approvalLedgerDir(env);
  mkdirSync(dir, { recursive: true });
  const claimFile = path.join(dir, `${approval.approvalId}.claimed.json`);
  try {
    writeFileSync(
      claimFile,
      JSON.stringify({ approvalId: approval.approvalId, approvedBy: approval.approvedBy, claimedAt: new Date().toISOString() }, null, 2),
      { flag: 'wx' },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new ProvisioningNotApprovedError([
        `Approval "${approval.approvalId}" has already been used to provision a database (${claimFile}). A new approval is required.`,
      ]);
    }
    throw error;
  }
  return claimFile;
}
