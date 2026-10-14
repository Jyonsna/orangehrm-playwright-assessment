import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { OrangeHrmApiClient } from '../src/api/orangehrm.client';
import { config, routes } from '../src/config';
import type { EmployeeState } from '../src/models/employee';
import { EmployeeDetailsPage } from '../src/pages/employee-details.page';
import { LoginPage } from '../src/pages/login.page';
import { PimPage } from '../src/pages/pim.page';
import {
  buildEmployee,
  EMPLOYEE_ID_MAX_LENGTH,
  loadEmployeeRecords,
  MAX_PHOTO_BYTES,
  projectPath,
} from '../src/utils/test-data';
import { expect, test } from './fixtures/employee.fixture';

const sha256 = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const DEFAULT_AVATAR_SHA256 = sha256(projectPath('test-assets/default-avatar-reference.png'));
function resolvedEmpNumber(employee: EmployeeState): number {
  if (typeof employee.empNumber !== 'number') {
    throw new Error(`Employee ${employee.employeeId}: empNumber must be resolved before API checks`);
  }
  return employee.empNumber;
}

const atPath = (pathname: string) => (url: URL) => url.pathname === pathname;

for (const [index, record] of loadEmployeeRecords().entries()) {
  test(`Employee lifecycle #${index + 1}: ${record.firstName} ${record.lastName}`, async ({
    page,
    employeeHolder,
    playwright,
    browserName,
  }) => {
    const employee = buildEmployee(record);
    const { employeeId } = employee;
    const login = new LoginPage(page);
    const pim = new PimPage(page);
    const details = new EmployeeDetailsPage(page);
    const controls = details.controls;
    const api = new OrangeHrmApiClient(page.request);

    const requireEmpNumber = () => resolvedEmpNumber(employee);

    await test.info().attach('run-info', {
      contentType: 'application/json',
      body: JSON.stringify(
        {
          baseUrl: config.baseUrl,
          employeeId,
          lastName: employee.lastName,
          node: process.version,
          browser: `${browserName} ${page.context().browser()?.version()}`,
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    });

    await test.step(`1. Login as ${config.username}`, async () => {
      await login.goto();
      await login.login(config.username, config.password);
      await expect(page, 'Login: dashboard URL after authentication').toHaveURL(atPath(routes.dashboard));
      await expect(login.dashboardHeading, 'Login: Dashboard heading is visible').toBeVisible();
    });

    await test.step(`2. Add Employee ${employeeId} (${employee.firstName} ${employee.lastName})`, async () => {
      expect(employeeId.length, `Employee ${employeeId}: generated ID length`).toBeLessThanOrEqual(
        EMPLOYEE_ID_MAX_LENGTH,
      );
      expect(['.jpg', '.jpeg', '.png', '.gif'], `Employee ${employeeId}: photo fixture type`).toContain(
        path.extname(employee.imagePath).toLowerCase(),
      );
      expect(
        fs.statSync(employee.imagePath).size,
        `Employee ${employeeId}: photo fixture size`,
      ).toBeLessThanOrEqual(MAX_PHOTO_BYTES);

      await pim.openAddEmployee();
      await details.firstName.fill(employee.firstName);
      await details.lastName.fill(employee.lastName);

      const idField = await details.employeeId();
      await expect(idField, 'Add Employee: Employee Id is prefilled by OrangeHRM').not.toHaveValue('');
      const uniquenessChecked = details.waitForIdUniquenessCheck(employeeId);
      await idField.clear();
      await idField.fill(employeeId);
      const uniqueness = await uniquenessChecked;
      expect(uniqueness.status(), `Employee ${employeeId}: ID uniqueness check status`).toBe(200);
      expect(
        await uniqueness.json(),
        `Employee ${employeeId}: OrangeHRM reports the ID as unused`,
      ).toMatchObject({
        data: { valid: true },
      });
      await expect(idField, `Employee ${employeeId}: Employee Id field value`).toHaveValue(employeeId);
      await expect(details.duplicateIdError(), `Employee ${employeeId}: no duplicate ID error`).toHaveCount(
        0,
      );
      await expect(
        details.createLoginDetails,
        `Employee ${employeeId}: Create Login Details stays off`,
      ).not.toBeChecked();

      await details.photoInput.setInputFiles(employee.imagePath);
      await expect(
        controls.employeeImage(),
        `Employee ${employeeId}: photo preview after file selection`,
      ).toHaveAttribute('src', /^data:image\/(jpeg|png|gif);base64,/);

      employeeHolder.employee = employee;
      const created = await details.saveNewEmployee();
      expect(created.status(), `Employee ${employeeId}: create API status`).toBe(200);
      await expect(
        controls.toast('Successfully Saved'),
        `Employee ${employeeId}: creation toast`,
      ).toBeVisible();

      const createdBody = (await created.json()) as { data?: { empNumber?: number } };
      employee.empNumber = createdBody.data?.empNumber;
      const empNumber = requireEmpNumber();
      await expect(page, `Employee ${employeeId}: details URL contains empNumber`).toHaveURL(
        new RegExp(`/pim/viewPersonalDetails/empNumber/${empNumber}$`),
      );
      await expect(details.headerName, `Employee ${employeeId}: details header name`).toHaveText(
        `${employee.firstName} ${employee.lastName}`,
      );

      await test.step(`Profile photo is the uploaded image, not the default avatar`, async () => {
        await expect(controls.employeeImage(), `Employee ${employeeId}: saved photo URL`).toHaveAttribute(
          'src',
          routes.photo(empNumber),
        );
        const photo = await api.getPhoto(await controls.photoUrl());
        expect(photo.status, `Employee ${employeeId}: photo endpoint status`).toBe(200);
        expect(photo.contentType, `Employee ${employeeId}: photo content type`).toMatch(/^image\//);
        expect(photo.size, `Employee ${employeeId}: photo is not empty`).toBeGreaterThan(0);
        expect(photo.sha256, `Employee ${employeeId}: photo is not the default avatar`).not.toBe(
          DEFAULT_AVATAR_SHA256,
        );
        expect(photo.sha256, `Employee ${employeeId}: photo bytes match the uploaded fixture`).toBe(
          sha256(employee.imagePath),
        );
      });

      await test.step(`Native API baseline: identity matches, job fields empty`, async () => {
        const identity = await api.getEmployeeIdentity(empNumber);
        expect(identity.status, `Employee ${employeeId}: GET employee status`).toBe(200);
        expect(identity.body, `Employee ${employeeId}: API identity after create`).toEqual({
          firstName: employee.firstName,
          lastName: employee.lastName,
          employeeId,
        });
        const job = await api.getJob(empNumber);
        expect(job.status, `Employee ${employeeId}: GET job-details status`).toBe(200);
        expect(job.body, `Employee ${employeeId}: API job fields empty before edit`).toEqual({
          jobTitle: '',
          employmentStatus: '',
        });
      });
    });

    await test.step(`3. Edit Employee ${employeeId}: Job Title and Employment Status`, async () => {
      await pim.open();
      await pim.searchByEmployeeId(employeeId);
      await expect(pim.row(employeeId), `Employee ${employeeId}: exactly one search result`).toHaveCount(1);
      await expect(
        pim.cell(employeeId, 'First (& Middle) Name'),
        `Employee ${employeeId}: first name in search row`,
      ).toHaveText(employee.firstName);
      await expect(
        pim.cell(employeeId, 'Last Name'),
        `Employee ${employeeId}: last name in search row`,
      ).toHaveText(employee.lastName);

      await pim.openForEdit(employeeId);
      await details.openTab('Job');
      employee.jobTitle = await controls.selectFirstAvailable('Job Title', record.jobTitlePreferences);
      employee.employmentStatus = await controls.selectFirstAvailable(
        'Employment Status',
        record.employmentStatusPreferences,
      );
      test.info().annotations.push({
        type: 'selected job data',
        description: `Job Title "${employee.jobTitle}", Employment Status "${employee.employmentStatus}"`,
      });
      const saved = await details.saveJob(requireEmpNumber());
      expect(saved.status(), `Employee ${employeeId}: job update API status`).toBe(200);
      await expect(
        controls.toast('Successfully Updated'),
        `Employee ${employeeId}: job update toast`,
      ).toBeVisible();

      await test.step(`Job Title "${employee.jobTitle}" and Employment Status "${employee.employmentStatus}" persist after reload`, async () => {
        await details.reload();
        await expect(
          controls.selectedValue('Job Title'),
          `Employee ${employeeId}: Job Title after reload`,
        ).toHaveText(employee.jobTitle);
        await expect(
          controls.selectedValue('Employment Status'),
          `Employee ${employeeId}: Employment Status after reload`,
        ).toHaveText(employee.employmentStatus);
      });

      await test.step('Identity fields unchanged on Personal Details', async () => {
        await details.openTab('Personal Details');
        await expect(details.firstName, `Employee ${employeeId}: First Name unchanged`).toHaveValue(
          employee.firstName,
        );
        await expect(details.lastName, `Employee ${employeeId}: Last Name unchanged`).toHaveValue(
          employee.lastName,
        );
        await expect(await details.employeeId(), `Employee ${employeeId}: Employee Id unchanged`).toHaveValue(
          employeeId,
        );
      });

      await test.step('Job fields shown in PIM search row', async () => {
        await pim.open();
        await pim.searchByEmployeeId(employeeId);
        await expect(
          pim.cell(employeeId, 'Job Title'),
          `Employee ${employeeId}: Job Title in search row`,
        ).toHaveText(employee.jobTitle);
        await expect(
          pim.cell(employeeId, 'Employment Status'),
          `Employee ${employeeId}: Employment Status in search row`,
        ).toHaveText(employee.employmentStatus);
      });
    });

    await test.step(`4. Validate Employee ${employeeId} via OrangeHRM API`, async () => {
      const empNumber = requireEmpNumber();
      const search = await api.searchByEmployeeId(employeeId);
      expect(search.status, `Employee ${employeeId}: API search status`).toBe(200);
      expect(
        search.body.map((e) => e.empNumber),
        `Employee ${employeeId}: API search resolves to the same empNumber`,
      ).toEqual([empNumber]);

      const identity = await api.getEmployeeIdentity(empNumber);
      expect(identity.status, `Employee ${employeeId}: GET employee status`).toBe(200);
      expect(identity.body, `Employee ${employeeId}: API identity matches UI`).toEqual({
        firstName: employee.firstName,
        lastName: employee.lastName,
        employeeId,
      });

      const job = await api.getJob(empNumber);
      expect(job.status, `Employee ${employeeId}: GET job-details status`).toBe(200);
      expect(job.body, `Employee ${employeeId}: API job fields match UI after edit`).toEqual({
        jobTitle: employee.jobTitle,
        employmentStatus: employee.employmentStatus,
      });
    });

    await test.step(`5. Delete Employee ${employeeId} through the UI`, async () => {
      const empNumber = requireEmpNumber();
      await expect(pim.row(employeeId), `Employee ${employeeId}: row present before delete`).toHaveCount(1);
      await pim.requestDelete(employeeId);

      const deleteResponse = pim.waitForDeleteResponse(empNumber);
      await pim.confirmDeleteButton().click();
      const deleted = await deleteResponse;
      expect(deleted.request().postDataJSON(), `Employee ${employeeId}: UI-triggered DELETE body`).toEqual({
        ids: [empNumber],
      });
      expect(deleted.status(), `Employee ${employeeId}: UI-triggered DELETE status`).toBe(200);
      expect(await deleted.json(), `Employee ${employeeId}: UI-triggered DELETE response`).toEqual({
        data: [String(empNumber)],
        meta: [],
        rels: [],
      });
      await expect(
        controls.toast('Successfully Deleted'),
        `Employee ${employeeId}: delete toast`,
      ).toBeVisible();

      await pim.searchByEmployeeId(employeeId);
      await expect(pim.row(employeeId), `Employee ${employeeId}: no rows after delete`).toHaveCount(0);
      await expect(
        pim.noRecordsMessage(),
        `Employee ${employeeId}: "No Records Found" after delete`,
      ).toBeVisible();

      const search = await api.searchByEmployeeId(employeeId);
      expect(search.status, `Employee ${employeeId}: API search status after delete`).toBe(200);
      expect(search.body, `Employee ${employeeId}: API search finds no employee after delete`).toEqual([]);

      const lookup = await api.getEmployee(empNumber);
      expect(lookup.status, `Employee ${employeeId}: GET by empNumber is rejected after delete`).toBe(422);
      expect(
        lookup.body,
        `Employee ${employeeId}: API reports empNumber as invalid after delete`,
      ).toMatchObject({
        error: { data: { invalidParamKeys: ['empNumber'] } },
      });
      employeeHolder.deletionVerified = true;
    });

    await test.step(`6. Logout and verify the session of ${employeeId}'s test run is invalidated`, async () => {
      const sessionBeforeLogout = (await page.context().cookies())
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join('; ');
      await controls.logout();
      await expect(page, `Employee ${employeeId}: logout redirects to login`).toHaveURL(atPath(routes.login));
      await expect(login.loginButton, `Employee ${employeeId}: login form shown after logout`).toBeVisible();

      await page.goto(routes.employeeList);
      await expect(
        page,
        `Employee ${employeeId}: protected route redirects to login in the same context`,
      ).toHaveURL(atPath(routes.login));

      const afterLogout = await page.request.get(routes.employeesApi, {
        params: { limit: 1 },
        maxRedirects: 0,
      });
      expect(afterLogout.status(), `Employee ${employeeId}: same-context API call is unauthorized`).toBe(401);
      expect(
        await afterLogout.json(),
        `Employee ${employeeId}: API reports the session as expired`,
      ).toMatchObject({
        error: { message: 'Session expired' },
      });

      const replay = await playwright.request.newContext({
        baseURL: config.baseUrl,
        extraHTTPHeaders: { cookie: sessionBeforeLogout },
      });
      try {
        const oldSession = await replay.get(routes.employeesApi, { params: { limit: 1 }, maxRedirects: 0 });
        expect(
          oldSession.status(),
          `Employee ${employeeId}: pre-logout session cookie is rejected by the server`,
        ).toBe(401);
      } finally {
        await replay.dispose();
      }
    });
  });
}
