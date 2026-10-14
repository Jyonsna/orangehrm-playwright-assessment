import { expect, type Locator, type Page } from '@playwright/test';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// OrangeHRM labels are not associated with their inputs and dropdowns are custom
// components, so fields are located through their `.oxd-input-group` wrapper.
export class OrangeHrmControls {
  constructor(private readonly page: Page) {}

  inputGroup(label: string): Locator {
    return this.page
      .locator('.oxd-input-group')
      .filter({ has: this.page.locator('label', { hasText: new RegExp(`^${escapeRegExp(label)}$`) }) });
  }

  async fieldByText(label: string): Promise<Locator> {
    const group = this.inputGroup(label);
    await expect(group, `Exactly one "${label}" field is expected`).toHaveCount(1);
    return group.locator('input');
  }

  selectedValue(label: string): Locator {
    return this.inputGroup(label).locator('.oxd-select-text-input');
  }

  async selectCustom(label: string, option: string): Promise<void> {
    await this.inputGroup(label).locator('.oxd-select-text').click();
    await this.page.getByRole('listbox').getByRole('option', { name: option, exact: true }).click();
    await expect(this.selectedValue(label), `"${label}" should show the selected option`).toHaveText(option);
  }

  async selectFirstAvailable(label: string, preferences: string[]): Promise<string> {
    await this.inputGroup(label).locator('.oxd-select-text').click();
    const options = this.page.getByRole('listbox').getByRole('option');
    await expect(options.nth(1), `"${label}" options should load`).toBeVisible();
    const available = await options.allInnerTexts();
    const choice = preferences.find((preference) => available.includes(preference));
    if (!choice) {
      throw new Error(
        `None of the preferred "${label}" values [${preferences.join(', ')}] exist. Available: [${available.join(', ')}]`,
      );
    }
    await this.page.getByRole('listbox').getByRole('option', { name: choice, exact: true }).click();
    await expect(this.selectedValue(label), `"${label}" should show "${choice}"`).toHaveText(choice);
    return choice;
  }

  toast(message: string): Locator {
    return this.page.locator('.oxd-toast').getByText(message, { exact: true });
  }

  employeeImage(): Locator {
    return this.page.locator('img.employee-image');
  }

  async photoUrl(): Promise<string> {
    const src = await this.employeeImage().getAttribute('src');
    if (!src) throw new Error('Employee image has no src attribute');
    return src;
  }

  employeeRow(employeeId: string): Locator {
    return this.page
      .getByRole('row')
      .filter({ has: this.page.getByRole('cell', { name: employeeId, exact: true }) });
  }

  async logout(): Promise<void> {
    await this.page.locator('.oxd-userdropdown-tab').click();
    await this.page.getByRole('menuitem', { name: 'Logout' }).click();
  }
}
