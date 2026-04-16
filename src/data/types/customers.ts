import type { ID } from "./common";

export type CustomerStatus = "active" | "inactive" | "dormant" | "pending";

export type CustomerSummary = {
  id: ID;
  customerNumber?: string | null;
  accountNumber: string;
  fullName: string;
  phone?: string | null;
  status: CustomerStatus;
  linkedStaffId?: ID | null;
};

export type CustomerSearchFilters = {
  search?: string;
  status?: CustomerStatus | string;
};

export type AccountOpeningPayload = {
  fullName: string;
  phone?: string;
  address?: string;
  nin?: string;
  bvn?: string;
  photoRef?: string | null;
  openedByStaffId: ID;
};

export type AccountMaintenancePayload = {
  customerId: ID;
  updates: {
    fullName?: string;
    phone?: string;
    address?: string;
    nin?: string;
    bvn?: string;
    photoRef?: string | null;
    status?: CustomerStatus | string;
  };
  requestedByStaffId: ID;
};

export type AccountReactivationPayload = {
  customerId: ID;
  requestedByStaffId: ID;
  note?: string;
};
