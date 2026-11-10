import type { Locator, Page } from '@playwright/test';
import { contractValue, signupContract } from '../signup-contract';

const { ui } = signupContract;

/** Signup details step reached after email verification. */
export class SignupDetailsPage {
  constructor(private readonly page: Page) {}

  passwordInput(): Locator {
    return this.page.getByLabel(contractValue(ui.passwordLabel), { exact: true });
  }

  regionSelect(): Locator {
    return this.page.getByLabel(contractValue(ui.regionLabel));
  }

  timezoneSelect(): Locator {
    return this.page.getByLabel(contractValue(ui.timezoneLabel));
  }

  completeButton(): Locator {
    return this.page.getByRole('button', { name: contractValue(ui.completeSignupButton) });
  }

  /** Option values of a native <select>; a custom combobox needs its own reader. */
  async optionValues(select: Locator): Promise<string[]> {
    return select.locator('option').evaluateAll((options) =>
      options.map((o) => (o as HTMLOptionElement).value).filter((value) => value !== ''),
    );
  }

  async selectRegion(code: string): Promise<void> {
    await this.regionSelect().selectOption(code);
  }

  async fillDetails(password: string): Promise<void> {
    for (const field of contractValue(ui.detailsFields)) {
      await this.page.getByLabel(field.label).fill(field.testValue);
    }
    await this.passwordInput().fill(password);
  }

  message(text: RegExp): Locator {
    return this.page.getByText(text);
  }
}
