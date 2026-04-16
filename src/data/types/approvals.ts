import type { ID, ISODateTimeString } from "./common";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export type ApprovalRequestSummary = {
  id: ID;
  requestType: string;
  status: ApprovalStatus;
  requestedByStaffId: ID;
  requestedAt: ISODateTimeString;
  entityType?: string;
  entityId?: string;
};

export type ApprovalListFilters = {
  status?: ApprovalStatus;
  requestType?: string;
  requestedByStaffId?: ID;
};

export type SubmitApprovalRequestPayload = {
  requestType: string;
  entityType?: string;
  entityId?: string;
  payload: Record<string, unknown>;
  requestedByStaffId: ID;
};

export type ApproveRequestPayload = {
  requestId: ID;
  approvedByStaffId: ID;
  note?: string;
};

export type RejectRequestPayload = {
  requestId: ID;
  rejectedByStaffId: ID;
  note?: string;
};
