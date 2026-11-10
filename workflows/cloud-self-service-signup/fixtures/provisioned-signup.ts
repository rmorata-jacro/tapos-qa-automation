import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test as guardedTest } from '../../../shared/safety/guarded-test';
import { assertTestUrl } from '../../../shared/safety/environment-guard';
import { applyNetworkPolicy } from '../../../shared/safety/network-policy';
import {
  approvalLedgerDir,
  claimProvisioningApproval,
  requireProvisioningApproval,
} from '../../../shared/safety/provisioning-approval';
import { redactEmail, redactText } from '../../../shared/safety/redaction';
import { resolveTestInbox, uniquePlusAddress, type TestInbox } from '../../../shared/test-data/test-inbox';
import { VERIFICATION_EMAIL_TIMEOUT_MS } from '../../../products/cloud-signup/helpers/pending-signup';
import { SignupDetailsPage } from '../../../products/cloud-signup/pages/signup-details-page';
import { SignupLandingPage } from '../../../products/cloud-signup/pages/signup-landing-page';
import { VerificationPage } from '../../../products/cloud-signup/pages/verification-page';
import {
  ContractUnconfirmedError,
  contractValue,
  signupContract,
  unconfirmedQuestions,
  type ContractValue,
} from '../../../products/cloud-signup/signup-contract';
import {
  resolveSignupStateQueries,
  type SignupRequestStatus,
  type SignupStateQueries,
} from '../state-checks/signup-state-queries';

const { paths, ui, api, email, provisioning, suiteBRegion } = signupContract;

const REQUIRED_CONTRACT: ContractValue<unknown>[] = [
  paths.signupLanding, paths.postSignupRedirect, ui.emailLabel, ui.submitSignupButton, ui.passwordLabel,
  ui.regionLabel, ui.timezoneLabel, ui.detailsFields, ui.completeSignupButton, ui.autoLoginIndicator,
  email.verificationSubject, email.verificationLinkPattern, provisioning.statusTimeoutMs,
  provisioning.sitecodePattern, provisioning.templateSitecode, suiteBRegion,
];

const STATUS_POLL_INTERVAL_MS = 5_000;

export interface ProvisionedSignup {
  approvalId: string;
  sitecode: string;
  email: string;
  startedAt: Date;
  selected: { region: string; timezone: string };
  landingPathname: string;
  autoLoggedIn: boolean;
  statusHistory: SignupRequestStatus[];
  passwordObservedWhilePending: boolean | 'not-observed';
  templateFingerprintBefore: string;
  /**
   * Present only in the worker that performed the signup. A worker restarted
   * after a test failure resumes from the run record without these.
   */
  live?: { verificationLink: URL; password: string; context: BrowserContext; page: Page };
  state: SignupStateQueries;
  inbox: TestInbox;
}

interface RunRecord {
  approvalId: string;
  status: 'started' | 'provisioned' | 'failed';
  email: string;
  sitecode?: string;
  startedAt: string;
  updatedAt: string;
  selected?: { region: string; timezone: string };
  landingPathname?: string;
  autoLoggedIn?: boolean;
  statusHistory?: SignupRequestStatus[];
  passwordObservedWhilePending?: boolean | 'not-observed';
  templateFingerprintBefore?: string;
  error?: string;
}

function runRecordFile(approvalId: string): string {
  return path.join(approvalLedgerDir(), `${approvalId}.run-record.json`);
}

/** Holds only non-secret identifiers so staging data can be followed up manually. It is never used to delete data. */
function writeRunRecord(record: RunRecord): void {
  mkdirSync(approvalLedgerDir(), { recursive: true });
  writeFileSync(runRecordFile(record.approvalId), JSON.stringify({ ...record, updatedAt: new Date().toISOString() }, null, 2));
}

async function pollStatus(
  state: SignupStateQueries,
  address: string,
  timeoutMs: number,
  onStatus: (status: SignupRequestStatus) => Promise<void>,
): Promise<SignupRequestStatus[]> {
  const history: SignupRequestStatus[] = [];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await state.signupRequestStatus(address);
    if (history.at(-1) !== status) history.push(status);
    await onStatus(status);
    if (status === 'completed' || status === 'failed') return history;
    await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_INTERVAL_MS));
  }
  throw new Error(
    `Provisioning did not finish within ${timeoutMs} ms (statuses seen: ${history.join(' → ') || 'none'}). ` +
      'Staging data was left in place for investigation.',
  );
}

export const test = guardedTest.extend<{ provisionedSignup: ProvisionedSignup }, { provisionedSignupWorker: ProvisionedSignup }>({
  provisionedSignupWorker: [
    async ({ browser }, use, workerInfo) => {
      const approval = requireProvisioningApproval();
      const baseURL = assertTestUrl(workerInfo.project.use.baseURL, 'CLOUD_SIGNUP_BASE_URL').toString();
      const questions = unconfirmedQuestions(REQUIRED_CONTRACT);
      if (questions.length) throw new ContractUnconfirmedError(questions);
      const state = resolveSignupStateQueries();
      const inbox = resolveTestInbox();

      if (existsSync(runRecordFile(approval.approvalId))) {
        const record = JSON.parse(readFileSync(runRecordFile(approval.approvalId), 'utf8')) as RunRecord;
        if (record.status !== 'provisioned' || !record.sitecode) {
          throw new Error(
            `Approval ${approval.approvalId} already has a ${record.status} run (no sitecode). Not retrying; investigate manually.`,
          );
        }
        await use({
          approvalId: record.approvalId, sitecode: record.sitecode, email: record.email,
          startedAt: new Date(record.startedAt), selected: record.selected!, landingPathname: record.landingPathname!,
          autoLoggedIn: record.autoLoggedIn!, statusHistory: record.statusHistory!,
          passwordObservedWhilePending: record.passwordObservedWhilePending!,
          templateFingerprintBefore: record.templateFingerprintBefore!, state, inbox,
        });
        return;
      }

      const templateFingerprintBefore = await state.schemaFingerprint(contractValue(provisioning.templateSitecode));
      claimProvisioningApproval(approval);

      const address = uniquePlusAddress('int3437b');
      const startedAt = new Date();
      const record: RunRecord = {
        approvalId: approval.approvalId, status: 'started', email: address,
        startedAt: startedAt.toISOString(), updatedAt: startedAt.toISOString(), templateFingerprintBefore,
      };
      writeRunRecord(record);

      const context = await browser.newContext({ baseURL, serviceWorkers: 'block' });
      await applyNetworkPolicy(context, { level: 'provisioning', allowedMutations: [] });
      const page = await context.newPage();
      const password = `Qa!${randomBytes(12).toString('base64url')}9`;

      try {
        const landing = new SignupLandingPage(page);
        await landing.open();
        await landing.requestSignup(address);

        const verificationLink = await inbox.waitForLink(address, {
          subject: contractValue(email.verificationSubject),
          linkPattern: contractValue(email.verificationLinkPattern),
          timeoutMs: VERIFICATION_EMAIL_TIMEOUT_MS,
        });
        await new VerificationPage(page, baseURL).openLink(verificationLink);

        const details = new SignupDetailsPage(page);
        const selected = contractValue(suiteBRegion);
        await details.fillDetails(password);
        await details.selectRegion(selected.region);
        await details.timezoneSelect().selectOption(selected.timezone);
        await details.completeButton().click();

        let passwordObservedWhilePending: boolean | 'not-observed' = 'not-observed';
        const timeoutMs = contractValue(provisioning.statusTimeoutMs);
        const statusHistory = await pollStatus(state, address, timeoutMs, async (status) => {
          if ((status === 'pending' || status === 'provisioning') && passwordObservedWhilePending === 'not-observed') {
            passwordObservedWhilePending = await state.storedPasswordIsPresent(address);
          }
        });
        const sitecode = await state.sitecodeForSignup(address);
        if (statusHistory.at(-1) !== 'completed' || !sitecode) {
          throw new Error(`Provisioning ended as "${statusHistory.at(-1)}" (sitecode ${sitecode ?? 'missing'}).`);
        }

        const autoLoggedIn = await page
          .getByText(contractValue(ui.autoLoginIndicator))
          .waitFor({ state: 'visible', timeout: 60_000 })
          .then(() => true, () => false);

        const result: ProvisionedSignup = {
          approvalId: approval.approvalId, sitecode, email: address, startedAt, selected,
          landingPathname: new URL(page.url()).pathname, autoLoggedIn, statusHistory,
          passwordObservedWhilePending, templateFingerprintBefore, state, inbox,
          live: { verificationLink, password, context, page },
        };
        writeRunRecord({
          ...record, status: 'provisioned', sitecode, selected, landingPathname: result.landingPathname,
          autoLoggedIn, statusHistory, passwordObservedWhilePending,
        });
        console.log(`[Suite B] Provisioned sitecode ${sitecode} for ${redactEmail(address)} (approval ${approval.approvalId}).`);

        await use(result);
      } catch (error) {
        writeRunRecord({ ...record, status: 'failed', error: redactText(String(error)) });
        throw new Error(`Suite B provisioning fixture failed: ${redactText(String(error))}`);
      } finally {
        await context.close();
      }
    },
    { scope: 'worker', timeout: 30 * 60_000 },
  ],

  provisionedSignup: async ({ provisionedSignupWorker }, use) => {
    await use(provisionedSignupWorker);
  },
});

export { expect };
