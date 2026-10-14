import crypto from 'node:crypto';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { routes } from '../config';
import type { ApiEmployee, ApiJobDetails, UiIdentity, UiJob } from '../models/employee';

const API = routes.employeesApi;

export type ApiResult<T> = { status: number; body: T };
export type PhotoResult = { status: number; contentType: string; size: number; sha256: string };

function schemaError(what: string, body: unknown): Error {
  return new Error(`Unexpected ${what} schema: ${JSON.stringify(body).slice(0, 300)}`);
}

function parseEmployee(value: unknown): ApiEmployee {
  const e = value as Partial<ApiEmployee> | null;
  if (
    typeof e?.empNumber !== 'number' ||
    typeof e.firstName !== 'string' ||
    typeof e.lastName !== 'string' ||
    typeof e.employeeId !== 'string'
  ) {
    throw schemaError('employee', value);
  }
  return e as ApiEmployee;
}

function parseJobDetails(value: unknown): ApiJobDetails {
  const j = value as Partial<ApiJobDetails> | null;
  if (
    typeof j?.empNumber !== 'number' ||
    typeof j.jobTitle !== 'object' ||
    j.jobTitle === null ||
    !('title' in j.jobTitle) ||
    typeof j.empStatus !== 'object' ||
    j.empStatus === null ||
    !('name' in j.empStatus)
  ) {
    throw schemaError('job-details', value);
  }
  return j as ApiJobDetails;
}

function requireSameEmployee<T extends { empNumber: number }>(value: T, empNumber: number): T {
  if (value.empNumber !== empNumber) {
    throw new Error(`API returned empNumber ${value.empNumber} when ${empNumber} was requested`);
  }
  return value;
}

// UI-to-API field mapping, documented in the README.
const toUiIdentity = (e: ApiEmployee): UiIdentity => ({
  firstName: e.firstName,
  lastName: e.lastName,
  employeeId: e.employeeId,
});

const toUiJob = (j: ApiJobDetails): UiJob => ({
  jobTitle: j.jobTitle.title ?? '',
  employmentStatus: j.empStatus.name ?? '',
});

export class OrangeHrmApiClient {
  constructor(private readonly request: APIRequestContext) {}

  private async json(response: APIResponse): Promise<unknown> {
    return response.json().catch(() => null);
  }

  async searchByEmployeeId(employeeId: string): Promise<ApiResult<ApiEmployee[]>> {
    const response = await this.request.get(API, {
      params: { nameOrId: employeeId, limit: 50, includeEmployees: 'currentAndPast' },
      maxRedirects: 0,
    });
    if (!response.ok()) return { status: response.status(), body: [] };
    const body = (await this.json(response)) as { data?: unknown };
    if (!Array.isArray(body?.data)) throw schemaError('employee search', body);
    const exact = body.data.map(parseEmployee).filter((e) => e.employeeId === employeeId);
    return { status: response.status(), body: exact };
  }

  async getEmployee(empNumber: number): Promise<ApiResult<unknown>> {
    const response = await this.request.get(`${API}/${empNumber}`, { maxRedirects: 0 });
    return { status: response.status(), body: await this.json(response) };
  }

  async getEmployeeIdentity(empNumber: number): Promise<ApiResult<UiIdentity | null>> {
    const { status, body } = await this.getEmployee(empNumber);
    if (status !== 200) return { status, body: null };
    const employee = parseEmployee((body as { data?: unknown } | null)?.data);
    return { status, body: toUiIdentity(requireSameEmployee(employee, empNumber)) };
  }

  async getJob(empNumber: number): Promise<ApiResult<UiJob | null>> {
    const response = await this.request.get(`${API}/${empNumber}/job-details`, { maxRedirects: 0 });
    if (!response.ok()) return { status: response.status(), body: null };
    const job = parseJobDetails(((await this.json(response)) as { data?: unknown } | null)?.data);
    return { status: response.status(), body: toUiJob(requireSameEmployee(job, empNumber)) };
  }

  /** Cleanup only: the business delete is always performed through the UI. */
  async deleteEmployee(empNumber: number): Promise<number> {
    const response = await this.request.delete(API, { data: { ids: [empNumber] }, maxRedirects: 0 });
    return response.status();
  }

  async getPhoto(photoPath: string): Promise<PhotoResult> {
    const response = await this.request.get(photoPath, { maxRedirects: 0 });
    const bytes = await response.body();
    return {
      status: response.status(),
      contentType: response.headers()['content-type'] ?? '',
      size: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
  }
}
