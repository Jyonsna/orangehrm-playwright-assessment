import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { EmployeeRecord, EmployeeState } from '../models/employee';

const ROOT = path.resolve(__dirname, '../..');
export const EMPLOYEE_ID_MAX_LENGTH = 10;
export const MAX_PHOTO_BYTES = 1024 * 1024;
const PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif'];
const ID_RANDOM_CHARS = 2;

export function projectPath(relativePath: string): string {
  return path.resolve(ROOT, relativePath);
}

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);

function validateRecord(value: unknown, index: number): EmployeeRecord {
  const record = value as Partial<EmployeeRecord> | null;
  const problems: string[] = [];
  if (!isNonEmptyString(record?.firstName)) problems.push('firstName');
  if (!isNonEmptyString(record?.lastName)) problems.push('lastName');
  if (!isStringList(record?.jobTitlePreferences)) problems.push('jobTitlePreferences');
  if (!isStringList(record?.employmentStatusPreferences)) problems.push('employmentStatusPreferences');
  if (
    !isNonEmptyString(record?.employeeIdPrefix) ||
    record.employeeIdPrefix.length > EMPLOYEE_ID_MAX_LENGTH - ID_RANDOM_CHARS - 4
  ) {
    problems.push(`employeeIdPrefix (1-${EMPLOYEE_ID_MAX_LENGTH - ID_RANDOM_CHARS - 4} characters)`);
  }
  if (!isNonEmptyString(record?.imagePath)) {
    problems.push('imagePath');
  } else {
    const file = projectPath(record.imagePath);
    if (!PHOTO_EXTENSIONS.includes(path.extname(file).toLowerCase())) {
      problems.push('imagePath (jpg/png/gif)');
    } else if (!fs.existsSync(file) || fs.statSync(file).size > MAX_PHOTO_BYTES) {
      problems.push('imagePath (existing file <= 1 MB)');
    }
  }
  if (problems.length > 0) {
    throw new Error(`test-data/employee.json record ${index} is invalid: ${problems.join(', ')}`);
  }
  return record as EmployeeRecord;
}

export function loadEmployeeRecords(): EmployeeRecord[] {
  const records: unknown = JSON.parse(fs.readFileSync(projectPath('test-data/employee.json'), 'utf8'));
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('test-data/employee.json must be a non-empty JSON array');
  }
  return records.map(validateRecord);
}

export function buildEmployee(record: EmployeeRecord): EmployeeState {
  const random = crypto
    .randomInt(36 ** ID_RANDOM_CHARS)
    .toString(36)
    .padStart(ID_RANDOM_CHARS, '0');
  const suffixLength = EMPLOYEE_ID_MAX_LENGTH - record.employeeIdPrefix.length;
  const suffix = `${Date.now().toString(36)}${random}`.slice(-suffixLength);
  return {
    firstName: record.firstName,
    lastName: `${record.lastName}_${suffix.slice(-4)}`,
    employeeId: `${record.employeeIdPrefix}${suffix}`,
    jobTitle: '',
    employmentStatus: '',
    imagePath: projectPath(record.imagePath),
  };
}
