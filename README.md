# OrangeHRM Employee Lifecycle — Playwright + TypeScript

End-to-end UI + API test of the employee lifecycle on the [OrangeHRM demo](https://opensource-demo.orangehrmlive.com/):

`login → add employee (data-driven, with photo) → edit Job Title / Employment Status → validate via OrangeHRM API → delete via UI → verify via UI + API → logout / session invalidated`

## Evidence

| Artifact                        | Location                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| HTML report (final passing run) | [`evidence/report/`](evidence/report/) — open with `npx playwright show-report evidence/report` |
| Test run video                  | [`evidence/test-run-video.webm`](evidence/test-run-video.webm) (also embedded in the report)    |

GitHub does not render the HTML report; clone the repo and run `npm run report:evidence` (same as the command above).

## Setup

Prerequisites: Node.js 24 (see `.nvmrc`) and npm.

```bash
npm ci
npm run install:browsers
```

`install:browsers` uses `--with-deps`, which installs system packages on Linux (needs sudo there); on Windows and macOS it only downloads Chromium.

No `.env` file is needed: the public demo URL and the credentials from the assessment brief are the defaults. To override them, copy `.env.example` to `.env`:

| Variable             | Default                                      |
| -------------------- | -------------------------------------------- |
| `BASE_URL`           | `https://opensource-demo.orangehrmlive.com/` |
| `ORANGEHRM_USERNAME` | `Admin`                                      |
| `ORANGEHRM_PASSWORD` | `admin123`                                   |

Because the test creates and deletes employees, a `BASE_URL` on any other host is rejected unless `ALLOW_NON_DEMO_HOST=true` is also set.

## Running

| Command                                                       | Purpose                                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                    | Run the lifecycle test headless (HTML report + video always produced)                                               |
| `npm run test:headed`                                         | Run with a visible browser                                                                                          |
| `npm run report`                                              | Open the latest report from `playwright-report/`                                                                    |
| `npm run report:evidence`                                     | Open the committed report in `evidence/report/`                                                                     |
| `npm run test:evidence`                                       | Run the test, then copy the passing report and video into `evidence/`                                               |
| `npm run evidence`                                            | Copy the latest passing report into `evidence/` (refuses failed runs and reports containing traces or the password) |
| `npm run typecheck` / `npm run lint` / `npm run format:check` | Static checks                                                                                                       |

## Framework structure

```text
src/
  config.ts                         base URL, credentials, routes
  components/orangehrm-controls.ts  shared OrangeHRM controls: labelled fields, custom dropdowns, rows, toasts, logout
  pages/login.page.ts               login form and dashboard landmark
  pages/pim.page.ts                 PIM navigation, Employee Id search, row edit/delete
  pages/employee-details.page.ts    add employee, photo, Personal Details and Job tabs
  api/orangehrm.client.ts           OrangeHRM API client and UI-to-API field mapping
  models/employee.ts                data, state and API types
  utils/test-data.ts                JSON loading, Employee ID and run-suffix generation
tests/
  fixtures/employee.fixture.ts      owns the created employee and idempotent cleanup
  employee-lifecycle.spec.ts        the lifecycle test; one test.step per assignment step
test-data/employee.json             data-driven input (one test per array entry)
test-assets/                        profile picture fixture and default-avatar reference
scripts/copy-evidence.mjs           copies the passing report into evidence/
evidence/                           committed report and video of the final run
.github/workflows/                  CI: lifecycle test and security scan
```

Page objects expose actions and locators; the business assertions stay in the spec, each with a message naming the step and the generated Employee ID.

## What the test verifies

1. **Login** — dashboard URL and `Dashboard` heading.
2. **Add Employee** — names from `test-data/employee.json`; the prefilled Employee Id is replaced by a generated ID (`QA` + base-36 timestamp + 2 random characters, ≤ 10 characters) that OrangeHRM's uniqueness check reports as unused; "Create Login Details" stays off; the photo (JPG, ≤ 1 MB) is previewed, `Successfully Saved` is shown, and the saved photo served by `/pim/viewPhoto/empNumber/{n}` is byte-identical (SHA-256) to the fixture and different from the default avatar. A baseline API check confirms identity and empty job fields.
3. **Edit** — the employee is found by exact Employee ID in PIM (first and last name checked in the row), opened, and the first available Job Title / Employment Status from the data file's preference lists is saved (HTTP 200 and `Successfully Updated`). Values are re-checked after reload, identity fields are re-checked on Personal Details, and job values are checked in the PIM search row.
4. **API validation** — API search resolves the Employee ID to the same `empNumber`; employee and job details from the API (checked to be for that `empNumber`) match the values asserted in the UI.
5. **Delete** — deleted through the UI; the UI-triggered `DELETE /api/v2/pim/employees` request (matched on method, path and a body of exactly `{"ids":[empNumber]}`) returns 200 with the deleted id, `Successfully Deleted` is shown, the UI search returns "No Records Found", the API search returns no match and `GET /employees/{empNumber}` returns `422` with `empNumber` reported as an invalid parameter (OrangeHRM's response for an unknown employee).
6. **Logout** — redirect to `/auth/login`; in the same browser context (cookies not cleared) a protected page redirects to login and the API returns `401 Session expired`. The session cookie captured before logout is then replayed from a separate request context and is also rejected with `401`, proving the server invalidated the old session (OrangeHRM issues a new cookie on logout).

The newly created employee has empty job fields, so step 3 sets them from blank.

## API approach

The test uses the OrangeHRM REST API that the web application itself uses (`/web/index.php/api/v2`), called through Playwright's `page.request`, which shares the logged-in browser session. This validates the same employee the UI created without needing an OAuth client on the shared demo. The API never performs the business create, edit or delete; API `DELETE` is used only by fixture cleanup.

| UI value          | API field                                                                       |
| ----------------- | ------------------------------------------------------------------------------- |
| First Name        | `GET /pim/employees/{empNumber}` → `data.firstName`                             |
| Last Name         | `GET /pim/employees/{empNumber}` → `data.lastName`                              |
| Employee Id       | `GET /pim/employees/{empNumber}` → `data.employeeId`                            |
| Job Title         | `GET /pim/employees/{empNumber}/job-details` → `data.jobTitle.title`            |
| Employment Status | `GET /pim/employees/{empNumber}/job-details` → `data.empStatus.name`            |
| API identity      | `empNumber`, taken from the create response and checked against the details URL |

The UI Employee Id and the API `empNumber` are different identifiers and are never inferred from each other.

## Reliability and cleanup

- Chromium, one worker, no retries, 5-minute test timeout (the shared demo is slow); state-based waits only.
- Every run uses a unique Employee ID and a run suffix on the last name (e.g. `Automation_k7m2`).
- If the test fails after creating the employee, the fixture deletes it: through the API using the current session, or a fresh login if the session was logged out, falling back to the UI. It deletes only the known `empNumber`, refuses to act on ambiguous matches, and treats any non-200 response as a failure rather than as "already deleted". A cleanup failure is reported without hiding the original failure.
- Video is always recorded. Screenshots and traces are kept only for failed local runs; traces are disabled in CI and `npm run evidence` refuses to publish a report containing traces.
- The password is entered without `fill()`, so it never appears in report step titles; the evidence script also checks the report for it.
- A `run-info` attachment in the report records the base URL, generated Employee ID, Node and browser versions.

## Test assets

- `test-assets/profile-picture.jpg` — synthetic 200×200 JPEG (4 KB), generated for this project.
- `test-assets/default-avatar-reference.png` — downloaded from the demo's `/web/images/default-photo.png`, which is also what `/pim/viewPhoto/empNumber/{n}` returns when there is no stored photo (checked against the demo).

## Dependencies

| Package                                                                 | Purpose                                                    |
| ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| `@playwright/test`                                                      | browser automation, test runner, HTML/JUnit reports, video |
| `typescript`, `@types/node`                                             | strict type checking                                       |
| `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-playwright` | linting                                                    |
| `prettier`                                                              | formatting                                                 |

## CI

- `.github/workflows/playwright.yml` — static checks and the lifecycle test on pushes to `main` (one run at a time against the shared demo); uploads the report and results.
- `.github/workflows/security.yml` — gitleaks secret scan (MIT-licensed Docker image) and `npm audit`.
- Both workflows have read-only permissions and actions pinned to commit SHAs.

## Known limitations

- The demo is public and shared: other users can change job titles/statuses (handled by preference lists) and the site resets periodically.
- The demo credentials are public values from the assignment brief, not secrets.
- Public demo seed data may appear in the video and report.
