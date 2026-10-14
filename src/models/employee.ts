export type EmployeeRecord = {
  firstName: string;
  lastName: string;
  employeeIdPrefix: string;
  jobTitlePreferences: string[];
  employmentStatusPreferences: string[];
  imagePath: string;
};

export type EmployeeState = {
  firstName: string;
  lastName: string;
  employeeId: string;
  empNumber?: number;
  jobTitle: string;
  employmentStatus: string;
  imagePath: string;
};

export type ApiEmployee = {
  empNumber: number;
  firstName: string;
  lastName: string;
  employeeId: string;
};

export type ApiJobDetails = {
  empNumber: number;
  jobTitle: { id: number | null; title: string | null };
  empStatus: { id: number | null; name: string | null };
};

export type UiIdentity = Pick<EmployeeState, 'firstName' | 'lastName' | 'employeeId'>;
export type UiJob = Pick<EmployeeState, 'jobTitle' | 'employmentStatus'>;
