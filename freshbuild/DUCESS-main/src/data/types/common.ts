export type RepositoryError = {
  code: string;
  message: string;
  details?: unknown;
};

export type RepositorySuccess<T> = {
  ok: true;
  data: T;
};

export type RepositoryFailure = {
  ok: false;
  error: RepositoryError;
};

export type RepositoryResult<T> = RepositorySuccess<T> | RepositoryFailure;

export type DateString = string;
export type ISODateTimeString = string;
export type ID = string;

export type PaginationInput = {
  limit?: number;
  cursor?: string | null;
};

export type SortDirection = "asc" | "desc";

export type AuditMeta = {
  requestedAt?: ISODateTimeString;
  requestedByStaffId?: ID;
  note?: string;
};

export function ok<T>(data: T): RepositoryResult<T> {
  return { ok: true, data };
}

export function err(code: string, message: string, details?: unknown): RepositoryResult<never> {
  return { ok: false, error: { code, message, details } };
}
