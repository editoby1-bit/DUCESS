import type { ID } from "./common";

export type RoleCode =
  | "customer_service"
  | "teller"
  | "approving_officer"
  | "admin_officer"
  | "report_officer";

export type StaffSummary = {
  id: ID;
  staffId: string;
  fullName: string;
  roleCode: RoleCode;
  isActive: boolean;
  branchId?: ID | null;
};

export type StaffListFilters = {
  roleCode?: RoleCode;
  isActive?: boolean;
  search?: string;
};
