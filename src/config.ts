try {
  process.loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const DEMO_HOST = 'opensource-demo.orangehrmlive.com';

const baseUrl = process.env.BASE_URL || `https://${DEMO_HOST}/`;

// The test creates and deletes employees, so other hosts require an explicit opt-in.
if (new URL(baseUrl).hostname !== DEMO_HOST && process.env.ALLOW_NON_DEMO_HOST !== 'true') {
  throw new Error(`BASE_URL host is not ${DEMO_HOST}; set ALLOW_NON_DEMO_HOST=true to run against it`);
}

export const config = {
  baseUrl,
  username: process.env.ORANGEHRM_USERNAME || 'Admin',
  password: process.env.ORANGEHRM_PASSWORD || 'admin123',
};

export const routes = {
  login: '/web/index.php/auth/login',
  dashboard: '/web/index.php/dashboard/index',
  employeeList: '/web/index.php/pim/viewEmployeeList',
  employeesApi: '/web/index.php/api/v2/pim/employees',
  idUniquenessApi: '/web/index.php/api/v2/core/validation/unique',
  photo: (empNumber: number) => `/web/index.php/pim/viewPhoto/empNumber/${empNumber}`,
};
