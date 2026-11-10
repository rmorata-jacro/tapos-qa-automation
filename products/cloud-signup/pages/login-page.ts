import type { Locator, Page } from '@playwright/test';
import { contractValue, signupContract } from '../signup-contract';

const { paths, ui } = signupContract;

export class LoginPage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto(contractValue(paths.login));
  }

  async login(username: string, password: string): Promise<void> {
    await this.page.getByLabel(contractValue(ui.loginEmailLabel)).fill(username);
    await this.page.getByLabel(contractValue(ui.loginPasswordLabel), { exact: true }).fill(password);
    await this.page.getByRole('button', { name: contractValue(ui.loginButton) }).click();
  }

  loggedInIndicator(): Locator {
    return this.page.getByText(contractValue(ui.loggedInIndicator));
  }
}
