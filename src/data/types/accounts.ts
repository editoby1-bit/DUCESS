import type { DateString, ID } from "./common";

export type TxType = "credit" | "debit";

export type AccountSummary = {
  accountId: ID;
  accountNumber: string;
  customerId: ID;
  customerName: string;
  status: string;
  bookBalance: number;
};

export type AccountStatementPayload = {
  accountId: ID;
  fromDate?: DateString;
  toDate?: DateString;
  limit?: number;
};

export type SubmitCreditPayload = {
  accountId: ID;
  amount: number;
  details: string;
  requestedByStaffId: ID;
  businessDate: DateString;
};

export type SubmitDebitPayload = SubmitCreditPayload;

export type JournalEntryInput = {
  accountId: ID;
  txType: TxType;
  amount: number;
  details: string;
};

export type SubmitJournalEntriesPayload = {
  entries: JournalEntryInput[];
  requestedByStaffId: ID;
  businessDate: DateString;
};

export type StatementEntry = {
  id: ID;
  txType: TxType;
  amount: number;
  details: string;
  date: string;
  balanceAfter?: number | null;
};
