import type { ID, ISODateTimeString } from "./common";

export type ToolCode =
  | "check_balance"
  | "account_opening"
  | "account_maintenance"
  | "account_reactivation"
  | "account_statement"
  | "credit"
  | "debit"
  | "approval_queue"
  | "permissions"
  | "operational_accounts"
  | "staff_directory"
  | "business_balance"
  | "operational_balance"
  | "teller_balances";

export type EffectivePermission = {
  toolCode: ToolCode;
  allowed: boolean;
  source: "role" | "temp_grant";
};

export type HasPermissionPayload = {
  staffId: ID;
  toolCode: ToolCode;
};

export type TempGrantPayload = {
  staffId: ID;
  toolCode: ToolCode;
  startsAt?: ISODateTimeString;
  endsAt?: ISODateTimeString;
  note?: string;
};

export type TempGrantRecord = TempGrantPayload & {
  id: ID;
  enabled: boolean;
  grantedByStaffId?: ID;
};
