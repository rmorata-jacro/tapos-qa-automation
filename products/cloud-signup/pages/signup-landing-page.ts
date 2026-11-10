import type { Locator, Page } from '@playwright/test';
import { contractValue, signupContract } from '../signup-contract';

const { paths, ui } = signupContract;

export class SignupLandingPage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto(contractValue(paths.signupLanding));
  }

  heading(): Locator {
    return this.page.getByRole('heading', { name: contractValue(ui.landingHeading) });
  }

  emailInput(): Locator {
    return this.page.getByLabel(contractValue(ui.emailLabel));
  }

  submitButton(): Locator {
    return this.page.getByRole('button', { name: contractValue(ui.submitSignupButton) });
  }

  async requestSignup(email: string): Promise<void> {
    await this.emailInput().fill(email);
    await this.submitButton().click();
  }

  message(text: RegExp): Locator {
    return this.page.getByText(text);
  }
}
