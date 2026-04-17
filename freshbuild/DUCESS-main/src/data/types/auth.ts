import type { EffectivePermission } from "./permissions";
import type { DateString, ID, ISODateTimeString } from "./common";
import type { StaffSummary } from "./staff";

export type LoginWithStaffIdPayload = {
  staffId: string;
  password: string;
};

export type StaffSession = {
  sessionToken?: string;
  expiresAt?: ISODateTimeString;
  staff: StaffSummary;
  permissions: EffectivePermission[];
};

export type SessionContext = {
  businessDate?: DateString;
  activeStaffId: ID;
  session: StaffSession | null;
};
