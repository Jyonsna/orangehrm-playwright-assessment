import { expect, type Locator, type Page, type Response } from '@playwright/test';
import { OrangeHrmControls } from '../components/orangehrm-controls';
import { routes } from '../config';

const COLUMNS = ['', 'Id', 'First (& Middle) Name', 'Last Name', 'Job Title', 'Employment Status'] as const;
type Column = Exclude<(typeof COLUMNS)[number], ''>;

export class PimPage {
  private readonly controls: OrangeHrmControls;

  constructor(private readonly page: Page) {
    this.controls = new OrangeHrmControls(page);
  }

  async open(): Promise<void> {
    await this.page.getByRole('link', { name: 'PIM', exact: true }).click();
    await this.page.waitForURL('**/pim/viewEmployeeList');
  }

  async gotoList(): Promise<void> {
    await this.page.goto(routes.employeeList);
  }

  async openAddEmployee(): Promise<void> {
    await this.open();
    await this.page.getByRole('link', { name: 'Add Employee', exact: true }).click();
    await this.page.waitForURL('**/pim/addEmployee');
  }

  async searchByEmployeeId(employeeId: string): Promise<void> {
    const idField = await this.controls.fieldByText('Employee Id');
    await idField.fill(employeeId);
    const results = this.page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === 'GET' &&
        url.pathname === routes.employeesApi &&
        url.searchParams.get('employeeId') === employeeId
      );
    });
    await this.page.getByRole('button', { name: 'Search', exact: true }).click();
    expect((await results).status(), `Employee ${employeeId}: PIM search status`).toBe(200);
    await expect(this.row(employeeId).or(this.noRecordsMessage()).first()).toBeVisible();
  }

  row(employeeId: string): Locator {
    return this.controls.employeeRow(employeeId);
  }

  cell(employeeId: string, column: Column): Locator {
    return this.row(employeeId).getByRole('cell').nth(COLUMNS.indexOf(column));
  }

  noRecordsMessage(): Locator {
    return this.page.locator('.orangehrm-horizontal-padding').getByText('No Records Found', { exact: true });
  }

  async openForEdit(employeeId: string): Promise<void> {
    // Action buttons are icon-only; the icon class is the only distinguishing attribute.
    await this.row(employeeId).locator('button:has(i.bi-pencil-fill)').click();
    await this.page.waitForURL('**/pim/viewPersonalDetails/empNumber/**');
  }

  async requestDelete(employeeId: string): Promise<void> {
    await this.row(employeeId).locator('button:has(i.bi-trash)').click();
  }

  confirmDeleteButton(): Locator {
    return this.page.getByRole('button', { name: 'Yes, Delete' });
  }

  waitForDeleteResponse(empNumber?: number): Promise<Response> {
    return this.page.waitForResponse((response) => {
      const request = response.request();
      if (request.method() !== 'DELETE' || new URL(request.url()).pathname !== routes.employeesApi)
        return false;
      if (empNumber === undefined) return true;
      try {
        return (
          JSON.stringify((request.postDataJSON() as { ids?: unknown } | null)?.ids) ===
          JSON.stringify([empNumber])
        );
      } catch {
        return false;
      }
    });
  }
}
