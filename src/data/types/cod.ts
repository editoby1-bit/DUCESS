import type { DateString, ID } from "./common";

export type CodPreviewPayload = {
  staffId: ID;
  businessDate: DateString;
};

export type CodComputedSummary = {
  openingBalance: number;
  floatTopUps: number;
  effectiveOpeningBalance: number;
  totalCredits: number;
  totalDebits: number;
  netBookBalance: number;
  remainingBalance: number;
  expectedCash: number;
};

export type SubmitCodPayload = {
  staffId: ID;
  businessDate: DateString;
  actualCash: number;
  note?: string;
};

export type CodSubmissionRecord = CodComputedSummary & {
  id: ID;
  staffId: ID;
  businessDate: DateString;
  actualCash: number;
  variance: number;
  overdraw: number;
  status: "submitted" | "flagged" | "resolved";
};

export type ResolveCodPayload = {
  codSubmissionId: ID;
  finalAgreedAmount: number;
  debtAmount?: number;
  resolutionNote?: string;
  resolvedByStaffId: ID;
};

export type DebtSummary = {
  id: ID;
  staffId: ID;
  businessDate: DateString;
  amount: number;
  status: "open" | "part_paid" | "paid" | "waived";
  sourceCodSubmissionId?: ID | null;
};

export type SubmitDebtRepaymentPayload = {
  debtId: ID;
  amount: number;
  requestedByStaffId: ID;
  paymentDate: DateString;
  note?: string;
};
