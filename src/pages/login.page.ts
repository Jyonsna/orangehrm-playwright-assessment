import type { Locator, Page } from '@playwright/test';
import { routes } from '../config';

export class LoginPage {
  readonly username: Locator;
  readonly password: Locator;
  readonly loginButton: Locator;
  readonly dashboardHeading: Locator;

  constructor(private readonly page: Page) {
    this.username = page.getByPlaceholder('Username');
    this.password = page.getByPlaceholder('Password');
    this.loginButton = page.getByRole('button', { name: 'Login' });
    this.dashboardHeading = page.getByRole('heading', { name: 'Dashboard', exact: true });
  }

  async goto(): Promise<void> {
    await this.page.goto(routes.login);
  }

  async login(username: string, password: string): Promise<void> {
    await this.username.fill(username);
    // fill() records its value in report step titles, so the password is set without it.
    await this.password.evaluate((input: HTMLInputElement, value) => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, password);
    await this.loginButton.click();
    await this.page.waitForURL(`**${routes.dashboard}`);
  }
}
