import type { DateString, ID } from "./common";

export type DashboardSummaryPayload = {
  staffId: ID;
  businessDate?: DateString;
};

export type DashboardSummary = {
  totalCustomers: number;
  activeStaff: number;
  pendingApprovals: number;
  businessDate: DateString;
};

export type BusinessBalanceSummary = {
  totalCredits: number;
  totalDebits: number;
  netBookBalance: number;
  remainingBalance: number;
};

export type OperationalBalanceSummaryPayload = {
  fromDate?: DateString;
  toDate?: DateString;
  mode?: "income" | "expense" | "all";
};

export type OperationalBalanceSummary = {
  totalIncome: number;
  totalExpense: number;
  netOperational: number;
};
