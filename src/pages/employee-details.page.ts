import type { Locator, Page, Response } from '@playwright/test';
import { OrangeHrmControls } from '../components/orangehrm-controls';
import { routes } from '../config';

const isGet = (response: Response, pathSuffix: string) =>
  response.request().method() === 'GET' && new URL(response.url()).pathname.endsWith(pathSuffix);

export class EmployeeDetailsPage {
  readonly controls: OrangeHrmControls;
  readonly firstName: Locator;
  readonly lastName: Locator;
  readonly photoInput: Locator;
  readonly createLoginDetails: Locator;
  readonly headerName: Locator;

  constructor(private readonly page: Page) {
    this.controls = new OrangeHrmControls(page);
    this.firstName = page.getByPlaceholder('First Name');
    this.lastName = page.getByPlaceholder('Last Name');
    this.photoInput = page.locator('input[type="file"]');
    this.createLoginDetails = page.locator('input[type="checkbox"]');
    this.headerName = page.locator('.orangehrm-edit-employee-name');
  }

  employeeId(): Promise<Locator> {
    return this.controls.fieldByText('Employee Id');
  }

  duplicateIdError(): Locator {
    return this.page.getByText('Employee Id already exists', { exact: true });
  }

  waitForIdUniquenessCheck(employeeId: string): Promise<Response> {
    return this.page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === 'GET' &&
        url.pathname === routes.idUniquenessApi &&
        url.searchParams.get('attributeName') === 'employeeId' &&
        url.searchParams.get('value') === employeeId
      );
    });
  }

  async saveNewEmployee(): Promise<Response> {
    const created = this.page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === routes.employeesApi,
    );
    await this.page.getByRole('button', { name: 'Save', exact: true }).click();
    return created;
  }

  async openTab(tab: 'Personal Details' | 'Job'): Promise<void> {
    const loaded = this.page.waitForResponse((response) =>
      isGet(response, tab === 'Job' ? '/job-details' : '/personal-details'),
    );
    await this.page.getByRole('link', { name: tab, exact: true }).click();
    await loaded;
  }

  async reload(): Promise<void> {
    const loaded = this.page.waitForResponse((response) => isGet(response, '/job-details'));
    await this.page.reload();
    await loaded;
  }

  async saveJob(empNumber: number): Promise<Response> {
    const saved = this.page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        new URL(response.url()).pathname === `${routes.employeesApi}/${empNumber}/job-details`,
    );
    await this.page
      .locator('form')
      .filter({ has: this.controls.inputGroup('Job Title') })
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    return saved;
  }
}
