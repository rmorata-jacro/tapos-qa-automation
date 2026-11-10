import type { Locator, Page } from '@playwright/test';
import { isAllowedTestHost } from '../../../shared/safety/environment-guard';
import { navigateSensitive } from '../../../shared/safety/guarded-test';
import { contractValue, signupContract } from '../signup-contract';

const { paths, ui } = signupContract;

export class VerificationPage {
  constructor(private readonly page: Page, private readonly baseURL: string) {}

  /** Opens a link received by email. The URL contains a live token and is never logged. */
  async openLink(link: URL): Promise<void> {
    if (!isAllowedTestHost(link.hostname)) {
      throw new Error(`Verification link points to "${link.hostname}", which is not an approved TEST host. Not opened.`);
    }
    await navigateSensitive(this.page, link, 'verification link');
  }

  /** Opens the verification route with a synthetic (non-genuine) token. */
  async openWithToken(token: string): Promise<void> {
    const build = contractValue(paths.verification);
    await navigateSensitive(this.page, new URL(build(token), this.baseURL), 'verification route with synthetic token');
  }

  invalidTokenMessage(): Locator {
    return this.page.getByText(contractValue(ui.invalidTokenMessage));
  }

  usedTokenMessage(): Locator {
    return this.page.getByText(contractValue(ui.usedTokenMessage));
  }
}
