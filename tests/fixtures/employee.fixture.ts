import { test as base, expect, type Browser, type Page } from '@playwright/test';
import { OrangeHrmApiClient } from '../../src/api/orangehrm.client';
import { OrangeHrmControls } from '../../src/components/orangehrm-controls';
import { config } from '../../src/config';
import type { EmployeeState } from '../../src/models/employee';
import { LoginPage } from '../../src/pages/login.page';
import { PimPage } from '../../src/pages/pim.page';

export type EmployeeHolder = {
  employee?: EmployeeState;
  deletionVerified: boolean;
};

const sanitize = (text: string) => (config.password ? text.split(config.password).join('***') : text);

async function deleteThroughUi(page: Page, employee: EmployeeState): Promise<string> {
  const { employeeId, empNumber } = employee;
  const pim = new PimPage(page);
  await pim.gotoList();
  await pim.searchByEmployeeId(employeeId);
  const rows = await pim.row(employeeId).count();
  if (rows === 0) return 'UI search: already absent';
  if (rows > 1) throw new Error(`UI search found ${rows} rows for ${employeeId}; refusing to delete`);

  await pim.requestDelete(employeeId);
  const deleted = pim.waitForDeleteResponse(empNumber);
  await pim.confirmDeleteButton().click();
  const status = (await deleted).status();
  if (status !== 200) throw new Error(`UI delete of ${employeeId} returned ${status}`);
  await expect(new OrangeHrmControls(page).toast('Successfully Deleted')).toBeVisible();

  await pim.searchByEmployeeId(employeeId);
  await expect(pim.row(employeeId), `UI cleanup could not delete ${employeeId}`).toHaveCount(0);
  return 'deleted through UI';
}

async function cleanup(browser: Browser, page: Page, employee: EmployeeState): Promise<string> {
  const { employeeId } = employee;
  let api = new OrangeHrmApiClient(page.request);
  let search = await api.searchByEmployeeId(employeeId);
  const context = search.status === 401 ? await browser.newContext({ baseURL: config.baseUrl }) : undefined;
  try {
    let activePage = page;
    if (context) {
      activePage = await context.newPage();
      const login = new LoginPage(activePage);
      await login.goto();
      await login.login(config.username, config.password);
      api = new OrangeHrmApiClient(context.request);
      search = await api.searchByEmployeeId(employeeId);
    }
    if (search.status !== 200) {
      return `API search returned ${search.status}; ${await deleteThroughUi(activePage, employee)}`;
    }

    const matches = search.body.map((e) => e.empNumber);
    if (matches.length === 0) return 'API search: already absent';
    if (employee.empNumber === undefined && matches.length > 1) {
      throw new Error(
        `API search found ${matches.length} employees with ID ${employeeId}; refusing to delete`,
      );
    }
    const target = employee.empNumber ?? matches[0];
    if (target === undefined || !matches.includes(target)) {
      return `API search: empNumber ${employee.empNumber} already absent`;
    }

    const status = await api.deleteEmployee(target);
    const after = await api.searchByEmployeeId(employeeId);
    if (status === 200 && after.status === 200 && !after.body.some((e) => e.empNumber === target)) {
      return `deleted empNumber ${target} through API`;
    }
    const diagnostic = `API delete ${status}, follow-up search ${after.status} (${after.body.length} matches)`;
    return `${diagnostic}; ${await deleteThroughUi(activePage, { ...employee, empNumber: target })}`;
  } finally {
    await context?.close();
  }
}

export const test = base.extend<{ employeeHolder: EmployeeHolder }>({
  employeeHolder: async ({ browser, page }, use, testInfo) => {
    const holder: EmployeeHolder = { deletionVerified: false };
    await use(holder);

    const { employee } = holder;
    if (!employee || holder.deletionVerified) return;
    try {
      const result = await cleanup(browser, page, employee);
      testInfo.annotations.push({ type: 'cleanup', description: `${employee.employeeId}: ${result}` });
    } catch (error) {
      const message = sanitize(error instanceof Error ? (error.stack ?? error.message) : String(error));
      await testInfo.attach('cleanup-error', { body: message, contentType: 'text/plain' });
      throw new Error(`Cleanup failed for ${employee.employeeId}: ${sanitize(String(error))}`);
    }
  },
});

export { expect };
