window.__DUCESS_CONFIG__ = Object.assign(
  {
    useSupabaseBackend: true,
    storageKey: 'duces_enterprise_ledger_v1',
    supabase: {
      url: 'https://ghhqlxwuvqilusisieom.supabase.co',
      anonKey: 'sb_publishable_8jZ0dBPAzFqJ6xi3CxAkdw_qrzP6p8I',

      staffEmailMode: 'synthetic_suffix',
      syntheticEmailSuffix: '@ducess.local',

      staffTable: 'staff',
      staffProfileSelect: 'id, staff_code, full_name, role_code, is_active, branch_id, auth_user_id, auth_email',

      customersTable: 'customers',
      customersSelect: 'id, customer_number, account_number, old_account_number, full_name, address, nin, bvn, phone, photo_path, status, linked_staff_id, account_type, created_at, is_active',

      customerAccountsTable: 'customer_accounts',
      customerAccountsSelect: 'id, customer_id, account_number, status, account_type, opened_at',

      customerBalancesTable: 'customer_account_balances',
      customerBalancesSelect: 'account_id, book_balance, updated_at',

      customerTransactionsTable: 'customer_transactions',
      customerTransactionsSelect: 'id, customer_id, tx_type, amount, created_at',

      staffCashLedgerTable: 'staff_cash_ledger',
      staffCashLedgerSelect: 'id, staff_id, entry_type, amount, delta, note, approval_request_id, float_date, created_by_staff_id, approved_by_staff_id, created_at',

      auditLogTable: 'audit_log',
      auditLogSelect: 'id, actor_staff_id, action_type, entity_type, entity_id, metadata, created_at',

      approvalPostingRpc: '',

      approvalRequestsTable: 'approval_requests',
      approvalRequestsSelect: 'id, request_type, status, payload, requested_at, requested_by_staff_id, requested_by_name, approved_at, approved_by_staff_id, approved_by_name, decision_note, entity_type, entity_id',

      codSubmissionsTable: 'cod_submissions',
      codSubmissionsSelect: 'id, staff_id, business_date, opening_balance, float_topups, effective_opening_balance, total_credits, total_debits, net_book_balance, remaining_balance, expected_cash, actual_cash, variance, overdraw, note, status, submitted_by_staff_id, submitted_at',

      codResolutionsTable: 'cod_resolutions',
      codResolutionsSelect: 'id, cod_submission_id, final_agreed_amount, adjustment_amount, debt_amount, resolution_note, resolved_by_staff_id, resolved_at',

      debtsTable: 'debts',
      debtsSelect: 'id, staff_id, business_date, source_cod_submission_id, amount, status, note, created_by_staff_id, created_at, updated_at',

      debtRepaymentsTable: 'debt_repayments',
      debtRepaymentsSelect: 'id, debt_id, amount, payment_date, note, requested_by_staff_id, approved_by_staff_id, approval_request_id, status, created_at'
    }
  },
  window.__DUCESS_CONFIG__ || {}
);
