import type { LoginWithStaffIdPayload, SessionContext, StaffSession } from "../types/auth";
import type { AccountStatementPayload, AccountSummary, StatementEntry, SubmitCreditPayload, SubmitDebitPayload, SubmitJournalEntriesPayload } from "../types/accounts";
import type { ApprovalListFilters, ApprovalRequestSummary, ApproveRequestPayload, RejectRequestPayload, SubmitApprovalRequestPayload } from "../types/approvals";
import type { RepositoryResult } from "../types/common";
import type { CodComputedSummary, CodPreviewPayload, CodSubmissionRecord, DebtSummary, ResolveCodPayload, SubmitCodPayload, SubmitDebtRepaymentPayload } from "../types/cod";
import type { AccountMaintenancePayload, AccountOpeningPayload, AccountReactivationPayload, CustomerSearchFilters, CustomerSummary } from "../types/customers";
import type { DashboardSummary, DashboardSummaryPayload, BusinessBalanceSummary, OperationalBalanceSummary, OperationalBalanceSummaryPayload } from "../types/dashboard";
import type { EffectivePermission, HasPermissionPayload, TempGrantPayload, TempGrantRecord } from "../types/permissions";
import type { StaffListFilters, StaffSummary } from "../types/staff";

export interface AuthRepository {
  loginWithStaffId(payload: LoginWithStaffIdPayload): Promise<RepositoryResult<StaffSession>>;
  logout(): Promise<RepositoryResult<{ success: true }>>;
  getSession(): Promise<RepositoryResult<StaffSession | null>>;
  getCurrentStaffContext(): Promise<RepositoryResult<SessionContext>>;
}

export interface StaffRepository {
  getCurrentStaff(): Promise<RepositoryResult<StaffSummary | null>>;
  getStaffById(staffId: string): Promise<RepositoryResult<StaffSummary | null>>;
  listStaff(filters?: StaffListFilters): Promise<RepositoryResult<StaffSummary[]>>;
  listActiveStaff(): Promise<RepositoryResult<StaffSummary[]>>;
}

export interface PermissionRepository {
  getEffectivePermissions(staffId: string): Promise<RepositoryResult<EffectivePermission[]>>;
  hasPermission(payload: HasPermissionPayload): Promise<RepositoryResult<boolean>>;
  listTempGrants(staffId: string): Promise<RepositoryResult<TempGrantRecord[]>>;
  createTempGrant(payload: TempGrantPayload): Promise<RepositoryResult<TempGrantRecord>>;
  revokeTempGrant(grantId: string): Promise<RepositoryResult<{ success: true }>>;
}

export interface CustomerRepository {
  listCustomers(filters?: CustomerSearchFilters): Promise<RepositoryResult<CustomerSummary[]>>;
  searchCustomers(query: string): Promise<RepositoryResult<CustomerSummary[]>>;
  getCustomerById(customerId: string): Promise<RepositoryResult<CustomerSummary | null>>;
  getCustomerByAccountNumber(accountNumber: string): Promise<RepositoryResult<CustomerSummary | null>>;
  submitAccountOpening(payload: AccountOpeningPayload): Promise<RepositoryResult<ApprovalRequestSummary>>;
  submitAccountMaintenance(payload: AccountMaintenancePayload): Promise<RepositoryResult<ApprovalRequestSummary>>;
  submitAccountReactivation(payload: AccountReactivationPayload): Promise<RepositoryResult<ApprovalRequestSummary>>;
}

export interface AccountRepository {
  getAccountByNumber(accountNumber: string): Promise<RepositoryResult<AccountSummary | null>>;
  getAccountSummary(accountId: string): Promise<RepositoryResult<AccountSummary | null>>;
  getAccountStatement(payload: AccountStatementPayload): Promise<RepositoryResult<StatementEntry[]>>;
  submitCredit(payload: SubmitCreditPayload): Promise<RepositoryResult<ApprovalRequestSummary>>;
  submitDebit(payload: SubmitDebitPayload): Promise<RepositoryResult<ApprovalRequestSummary>>;
  submitJournalEntries(payload: SubmitJournalEntriesPayload): Promise<RepositoryResult<ApprovalRequestSummary>>;
}

export interface ApprovalRepository {
  listApprovalRequests(filters?: ApprovalListFilters): Promise<RepositoryResult<ApprovalRequestSummary[]>>;
  getApprovalRequestById(requestId: string): Promise<RepositoryResult<ApprovalRequestSummary | null>>;
  submitApprovalRequest(payload: SubmitApprovalRequestPayload): Promise<RepositoryResult<ApprovalRequestSummary>>;
  approveRequest(payload: ApproveRequestPayload): Promise<RepositoryResult<ApprovalRequestSummary>>;
  rejectRequest(payload: RejectRequestPayload): Promise<RepositoryResult<ApprovalRequestSummary>>;
}

export interface CodRepository {
  getCodPreview(payload: CodPreviewPayload): Promise<RepositoryResult<CodComputedSummary>>;
  submitCod(payload: SubmitCodPayload): Promise<RepositoryResult<CodSubmissionRecord>>;
  listCodSubmissions(filters?: Record<string, unknown>): Promise<RepositoryResult<CodSubmissionRecord[]>>;
  getCodSubmissionById(codId: string): Promise<RepositoryResult<CodSubmissionRecord | null>>;
  resolveCod(payload: ResolveCodPayload): Promise<RepositoryResult<CodSubmissionRecord>>;
  listDebts(filters?: Record<string, unknown>): Promise<RepositoryResult<DebtSummary[]>>;
  getDebtById(debtId: string): Promise<RepositoryResult<DebtSummary | null>>;
  submitDebtRepayment(payload: SubmitDebtRepaymentPayload): Promise<RepositoryResult<ApprovalRequestSummary>>;
}

export interface DashboardRepository {
  getDashboardSummary(payload: DashboardSummaryPayload): Promise<RepositoryResult<DashboardSummary>>;
  getBusinessBalanceSummary(payload: DashboardSummaryPayload): Promise<RepositoryResult<BusinessBalanceSummary>>;
  getOperationalBalanceSummary(payload: OperationalBalanceSummaryPayload): Promise<RepositoryResult<OperationalBalanceSummary>>;
}

export interface AppStateRepository {
  loadState<T = unknown>(): T | null;
  saveState<T = unknown>(state: T): void;
  bootstrapState<T = unknown>(seedFactory: () => T): T;
}

export interface DucessDataGateway {
  auth: AuthRepository;
  staff: StaffRepository;
  permissions: PermissionRepository;
  customers: CustomerRepository;
  accounts: AccountRepository;
  approvals: ApprovalRepository;
  cod: CodRepository;
  dashboard: DashboardRepository;
  appState: AppStateRepository;
}
