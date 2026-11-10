import type { Page } from '@playwright/test';
import { uniquePlusAddress, type TestInbox } from '../../../shared/test-data/test-inbox';
import { SignupDetailsPage } from '../pages/signup-details-page';
import { SignupLandingPage } from '../pages/signup-landing-page';
import { VerificationPage } from '../pages/verification-page';
import { contractValue, signupContract } from '../signup-contract';

const { email } = signupContract;

export const VERIFICATION_EMAIL_TIMEOUT_MS = 120_000;

export interface VerifiedPendingSignup {
  email: string;
  details: SignupDetailsPage;
}

/**
 * Creates a fresh pending signup for a unique plus-address and opens its
 * verification link, stopping on the details step. Signup is never completed
 * here, so no database is provisioned. Each caller gets its own request.
 */
export async function startVerifiedPendingSignup(
  page: Page,
  inbox: TestInbox,
  baseURL: string,
  purpose: string,
): Promise<VerifiedPendingSignup> {
  const address = uniquePlusAddress(purpose);
  const landing = new SignupLandingPage(page);
  await landing.open();
  await landing.requestSignup(address);

  const link = await inbox.waitForLink(address, {
    subject: contractValue(email.verificationSubject),
    linkPattern: contractValue(email.verificationLinkPattern),
    timeoutMs: VERIFICATION_EMAIL_TIMEOUT_MS,
  });
  await new VerificationPage(page, baseURL).openLink(link);
  return { email: address, details: new SignupDetailsPage(page) };
}
