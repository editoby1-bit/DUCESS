(function (global) {
  console.log("DUCESS GATEWAY LOADED", Date.now());
  const defaultResult = {
    ok(data) { return { ok: true, data }; },
    err(code, message, details) { return { ok: false, error: { code, message, details } }; }
  };

  const ROLE_DEFAULT_TOOLS = {
    customer_service: ['check_balance','account_opening','account_maintenance','account_reactivation','account_statement'],
    teller: ['check_balance','account_statement','credit','debit'],
    approving_officer: ['check_balance','account_opening','account_maintenance','account_reactivation','account_statement','credit','debit','approval_queue','business_balance','operational_balance'],
    admin_officer: ['check_balance','account_opening','account_maintenance','account_reactivation','account_statement','credit','debit','approval_queue','permissions','operational_accounts','staff_directory','business_balance','operational_balance','teller_balances'],
    report_officer: ['check_balance','account_statement','business_balance','operational_balance','teller_balances']
  };

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function mergeConfig(options = {}) {
    const runtimeConfig = global.__DUCESS_CONFIG__ || {};
    return {
      ...runtimeConfig,
      ...options,
      supabase: {
        ...(runtimeConfig.supabase || {}),
        ...(options.supabase || {}),
      }
    };
  }

  function buildDefaultPermissions(roleCode) {
    return (ROLE_DEFAULT_TOOLS[roleCode] || []).map((toolCode) => ({
      toolCode,
      allowed: true,
      source: 'role'
    }));
  }

  function normalizeStaffSummary(rawStaff) {
    if (!rawStaff) return null;
    return {
      id: rawStaff.id,
      staffId: rawStaff.staffId || rawStaff.staff_code || rawStaff.code || '',
      fullName: rawStaff.fullName || rawStaff.full_name || rawStaff.name || '',
      roleCode: rawStaff.roleCode || rawStaff.role_code || rawStaff.role || 'customer_service',
      isActive: typeof rawStaff.isActive === 'boolean' ? rawStaff.isActive : (typeof rawStaff.is_active === 'boolean' ? rawStaff.is_active : rawStaff.active !== false),
      branchId: rawStaff.branchId ?? rawStaff.branch_id ?? null,
    };
  }

  function normalizeStaffSession(sessionToken, expiresAt, rawStaff, permissions) {
    const staff = normalizeStaffSummary(rawStaff);
    if (!staff) return null;
    return {
      sessionToken: sessionToken || undefined,
      expiresAt: expiresAt || undefined,
      staff,
      permissions: Array.isArray(permissions) ? permissions : buildDefaultPermissions(staff.roleCode),
    };
  }


  function normalizeTempGrantRecord(rawGrant) {
    if (!rawGrant) return null;
    return {
      id: rawGrant.id,
      staffId: rawGrant.staffId || rawGrant.staff_id || '',
      toolCode: rawGrant.toolCode || rawGrant.tool_code || '',
      startsAt: rawGrant.startsAt || rawGrant.starts_at || undefined,
      endsAt: rawGrant.endsAt || rawGrant.ends_at || undefined,
      note: rawGrant.note || '',
      enabled: typeof rawGrant.enabled === 'boolean' ? rawGrant.enabled : rawGrant.is_enabled !== false,
      grantedByStaffId: rawGrant.grantedByStaffId || rawGrant.granted_by_staff_id || undefined,
    };
  }


  function normalizeLocalTransaction(rawTx) {
    if (!rawTx) return null;
    return {
      id: rawTx.id,
      type: rawTx.type || rawTx.txType || rawTx.tx_type || 'credit',
      amount: Number(rawTx.amount || 0),
      details: rawTx.details || rawTx.note || '',
      postedBy: rawTx.postedBy || rawTx.posted_by || '',
      postedById: rawTx.postedById || rawTx.posted_by_id || '',
      approvedBy: rawTx.approvedBy || rawTx.approved_by || null,
      counterparty: rawTx.counterparty || rawTx.channel || '',
      date: rawTx.date || rawTx.effective_at || rawTx.created_at || new Date().toISOString(),
      balanceAfter: rawTx.balanceAfter ?? rawTx.balance_after ?? null,
    };
  }

  function normalizeCustomerRecord(rawCustomer) {
    if (!rawCustomer) return null;
    const transactions = Array.isArray(rawCustomer.transactions)
      ? rawCustomer.transactions.map(normalizeLocalTransaction).filter(Boolean)
      : [];
    let balance = Number(rawCustomer.balance ?? rawCustomer.book_balance ?? rawCustomer.bookBalance ?? 0);
    if ((!Number.isFinite(balance) || balance === 0) && transactions.length) {
      balance = transactions.reduce((sum, tx) => sum + (tx.type === 'credit' ? Number(tx.amount || 0) : -Number(tx.amount || 0)), 0);
    }
    return {
      id: rawCustomer.id,
      customerNumber: rawCustomer.customerNumber ?? rawCustomer.customer_number ?? null,
      accountNumber: String(rawCustomer.accountNumber ?? rawCustomer.account_number ?? ''),
      oldAccountNumber: rawCustomer.oldAccountNumber ?? rawCustomer.old_account_number ?? '',
      name: rawCustomer.name || rawCustomer.fullName || rawCustomer.full_name || '',
      address: rawCustomer.address || '',
      nin: rawCustomer.nin || '',
      bvn: rawCustomer.bvn || '',
      phone: rawCustomer.phone || '',
      balance,
      photo: rawCustomer.photo || rawCustomer.photo_path || '',
      active: typeof rawCustomer.active === 'boolean'
        ? rawCustomer.active
        : (typeof rawCustomer.is_active === 'boolean'
          ? rawCustomer.is_active
          : !['inactive', 'dormant', 'closed', 'frozen'].includes(String(rawCustomer.status || '').toLowerCase())),
      createdAt: rawCustomer.createdAt || rawCustomer.created_at || new Date().toISOString(),
      transactions,
      staffId: rawCustomer.staffId || rawCustomer.staff_id || rawCustomer.linkedStaffId || rawCustomer.linked_staff_id || null,
      accountType: rawCustomer.accountType || rawCustomer.account_type || 'customer',
    };
  }

  function customerToSummary(customer) {
    const normalized = normalizeCustomerRecord(customer);
    if (!normalized) return null;
    return {
      id: normalized.id,
      customerNumber: normalized.customerNumber,
      accountNumber: normalized.accountNumber,
      fullName: normalized.name,
      phone: normalized.phone || null,
      status: normalized.active ? 'active' : 'inactive',
      linkedStaffId: normalized.staffId || null,
      oldAccountNumber: normalized.oldAccountNumber,
      address: normalized.address,
      nin: normalized.nin,
      bvn: normalized.bvn,
      balance: normalized.balance,
      photo: normalized.photo,
      active: normalized.active,
      createdAt: normalized.createdAt,
      transactions: normalized.transactions,
      accountType: normalized.accountType,
      name: normalized.name,
    };
  }

  function customerToAccountSummary(customer) {
    const normalized = normalizeCustomerRecord(customer);
    if (!normalized) return null;
    return {
      accountId: normalized.id,
      accountNumber: normalized.accountNumber,
      customerId: normalized.id,
      customerName: normalized.name,
      status: normalized.active ? 'active' : 'inactive',
      bookBalance: Number(normalized.balance || 0),
    };
  }

  function normalizeStatementEntry(rawTx) {
    const tx = normalizeLocalTransaction(rawTx);
    if (!tx) return null;
    return {
      id: tx.id,
      txType: tx.type === 'debit' ? 'debit' : 'credit',
      amount: Number(tx.amount || 0),
      details: tx.details || '',
      date: tx.date,
      balanceAfter: tx.balanceAfter ?? null,
    };
  }

  function normalizeCodSubmissionRecord(row) {
    if (!row) return null;
    return {
      id: String(row.id || ''),
      staffId: row.staffId || row.staff_id || '',
      businessDate: row.businessDate || row.business_date || row.date || '',
      date: row.businessDate || row.business_date || row.date || '',
      openingBalance: Number(row.openingBalance ?? row.opening_balance ?? 0),
      floatTopUps: Number(row.floatTopUps ?? row.float_topups ?? 0),
      effectiveOpeningBalance: Number(row.effectiveOpeningBalance ?? row.effective_opening_balance ?? 0),
      totalCredits: Number(row.totalCredits ?? row.total_credits ?? 0),
      totalDebits: Number(row.totalDebits ?? row.total_debits ?? 0),
      netBookBalance: Number(row.netBookBalance ?? row.net_book_balance ?? 0),
      remainingBalance: Number(row.remainingBalance ?? row.remaining_balance ?? 0),
      expectedCash: Number(row.expectedCash ?? row.expected_cash ?? 0),
      actualCash: Number(row.actualCash ?? row.actual_cash ?? 0),
      variance: Number(row.variance ?? 0),
      overdraw: Number(row.overdraw ?? 0),
      note: row.note || '',
      status: row.status || 'submitted',
      submittedByStaffId: row.submittedByStaffId || row.submitted_by_staff_id || null,
      submittedAt: row.submittedAt || row.submitted_at || undefined,
      resolutionNote: row.resolutionNote || row.resolution_note || '',
      acceptedPosition: Number(row.acceptedPosition ?? row.final_agreed_amount ?? row.finalAgreedAmount ?? row.net_book_balance ?? 0),
      adjustment: Number(row.adjustment ?? row.adjustment_amount ?? 0),
      debtAmount: Number(row.debtAmount ?? row.debt_amount ?? 0),
      resolvedBy: row.resolvedBy || row.resolved_by_name || row.resolved_by_staff_id || null,
      resolvedAt: row.resolvedAt || row.resolved_at || undefined,
      runningFloat: Number(row.runningFloat ?? row.remaining_balance ?? row.remainingBalance ?? 0),
    };
  }

  function normalizeDebtRecord(row) {
    if (!row) return null;
    return {
      id: String(row.id || ''),
      staffId: row.staffId || row.staff_id || '',
      businessDate: row.businessDate || row.business_date || '',
      amount: Number(row.amount || 0),
      status: row.status || 'open',
      sourceCodSubmissionId: row.sourceCodSubmissionId || row.source_cod_submission_id || null,
      note: row.note || '',
      createdAt: row.createdAt || row.created_at || undefined,
      updatedAt: row.updatedAt || row.updated_at || undefined,
    };
  }

  async function getCodPreview(_payload) {
  return {
    ok: true,
    data: {
      openingBalance: 0,
      floatTopUps: 0,
      effectiveOpeningBalance: 0,
      totalCredits: 0,
      totalDebits: 0,
      netBookBalance: 0,
      remainingBalance: 0,
      expectedCash: 0
    }
  };
}

async function submitCod(_payload) {
  return {
    ok: true,
    data: {
      id: null,
      staffId: null,
      businessDate: null,
      openingBalance: 0,
      floatTopUps: 0,
      effectiveOpeningBalance: 0,
      totalCredits: 0,
      totalDebits: 0,
      netBookBalance: 0,
      remainingBalance: 0,
      expectedCash: 0,
      actualCash: 0,
      variance: 0,
      overdraw: 0,
      status: 'submitted'
    }
  };
}

async function listCodSubmissions(_filters) {
  return {
    ok: true,
    data: []
  };
}

async function getCodSubmissionById(_codId) {
  return {
    ok: true,
    data: null
  };
}

async function resolveCod(_payload) {
  return {
    ok: true,
    data: {
      id: null,
      codSubmissionId: null,
      finalAgreedAmount: 0,
      adjustment: 0,
      debtAmount: 0,
      resolutionNote: ''
    }
  };
}

async function listDebts(_filters) {
  return {
    ok: true,
    data: []
  };
}

async function getDebtById(_debtId) {
  return {
    ok: true,
    data: null
  };
}

async function submitDebtRepayment(_payload) {
  return {
    ok: true,
    data: null
  };
}
  
  function createLocalAdapter(options = {}) {
    const config = mergeConfig(options);
    const storageKey = config.storageKey || 'duces_enterprise_ledger_v1';
    const authStorageKey = `${storageKey}__gateway_auth`;

    const appState = {
      loadState() {
        try {
          const raw = global.localStorage.getItem(storageKey);
          return raw ? JSON.parse(raw) : null;
        } catch (error) {
          console.warn('[DUCESS gateway] Failed to load local state.', error);
          return null;
        }
      },
      saveState(state) {
        global.localStorage.setItem(storageKey, JSON.stringify(state));
      },
      bootstrapState(seedFactory) {
        const loaded = appState.loadState();
        return loaded || seedFactory();
      }
    };

    function readAuthSession() {
      try {
        const raw = global.localStorage.getItem(authStorageKey);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    }

    function writeAuthSession(session) {
      if (!session) {
        global.localStorage.removeItem(authStorageKey);
        return;
      }
      global.localStorage.setItem(authStorageKey, JSON.stringify(session));
    }

    function getLocalState() {
      return appState.loadState() || {};
    }

    function getLocalStaffRows() {
      const state = getLocalState();
      return Array.isArray(state.staff) ? state.staff : [];
    }

    function buildLocalSessionFromState(staffId) {
      const state = getLocalState();
      const allStaff = getLocalStaffRows();
      const target = allStaff.find((item) => item.id === staffId)
        || allStaff.find((item) => item.id === state.activeStaffId)
        || allStaff[0]
        || null;
      if (!target) return null;
      const normalized = normalizeStaffSummary(target);
      return normalizeStaffSession(`local-${normalized.id}`, undefined, normalized, buildDefaultPermissions(normalized.roleCode));
    }

    async function notYet(name) {
      return defaultResult.err('NOT_IMPLEMENTED', `${name} is skeleton-only in Phase 3B.3`);
    }

    async function getCurrentStaff() {
      const session = readAuthSession();
      if (session?.staff) return defaultResult.ok(normalizeStaffSummary(session.staff));
      const fallback = buildLocalSessionFromState();
      return defaultResult.ok(fallback?.staff || null);
    }

    async function getStaffById(staffId) {
      const match = getLocalStaffRows().find((item) => item.id === staffId || item.staffId === staffId || item.staff_code === staffId) || null;
      return defaultResult.ok(normalizeStaffSummary(match));
    }

    async function listStaff(filters = {}) {
      const normalizedRows = getLocalStaffRows().map(normalizeStaffSummary).filter(Boolean);
      const filtered = normalizedRows.filter((staff) => {
        if (filters.roleCode && staff.roleCode !== filters.roleCode) return false;
        if (typeof filters.isActive === 'boolean' && staff.isActive !== filters.isActive) return false;
        if (filters.search) {
          const q = String(filters.search).trim().toLowerCase();
          const hay = `${staff.fullName} ${staff.staffId}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      return defaultResult.ok(filtered);
    }

    async function listActiveStaff() {
      const result = await listStaff({ isActive: true });
      return result;
    }

    async function getEffectivePermissions(staffId) {
      const staffResult = await getStaffById(staffId);
      if (!staffResult.ok) return staffResult;
      const staff = staffResult.data;
      if (!staff) return defaultResult.ok([]);

      const state = getLocalState();
      const rolePerms = buildDefaultPermissions(staff.roleCode);
      const tempPerms = (Array.isArray(state.tempGrants) ? state.tempGrants : [])
        .map(normalizeTempGrantRecord)
        .filter(Boolean)
        .filter((grant) => grant.staffId === staff.id && grant.enabled !== false)
        .map((grant) => ({ toolCode: grant.toolCode, allowed: true, source: 'temp_grant' }));

      const merged = new Map();
      rolePerms.forEach((perm) => merged.set(`role:${perm.toolCode}`, perm));
      tempPerms.forEach((perm) => merged.set(`temp_grant:${perm.toolCode}`, perm));
      return defaultResult.ok(Array.from(merged.values()));
    }

    async function hasPermission(payload) {
      const permsResult = await getEffectivePermissions(payload?.staffId);
      if (!permsResult.ok) return permsResult;
      const allowed = permsResult.data.some((perm) => perm.toolCode === payload?.toolCode && perm.allowed !== false);
      return defaultResult.ok(allowed);
    }

    async function listTempGrants(staffId) {
      const grants = (Array.isArray(getLocalState().tempGrants) ? getLocalState().tempGrants : [])
        .map(normalizeTempGrantRecord)
        .filter(Boolean)
        .filter((grant) => !staffId || grant.staffId === staffId);
      return defaultResult.ok(grants);
    }

    async function listCustomers(filters = {}) {
      const rows = (Array.isArray(getLocalState().customers) ? getLocalState().customers : [])
        .map(customerToSummary)
        .filter(Boolean)
        .filter((customer) => {
          if (filters.status && customer.status !== filters.status) return false;
          if (filters.search) {
            const q = String(filters.search).trim().toLowerCase();
            const hay = `${customer.fullName} ${customer.accountNumber} ${customer.phone || ''}`.toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        });
      return defaultResult.ok(rows);
    }

    async function searchCustomers(query) {
      return listCustomers({ search: query || '' });
    }

    async function getCustomerById(customerId) {
      const row = (Array.isArray(getLocalState().customers) ? getLocalState().customers : [])
        .find((item) => item.id === customerId) || null;
      return defaultResult.ok(customerToSummary(row));
    }

    async function getCustomerByAccountNumber(accountNumber) {
      const key = String(accountNumber || '').trim();
      const row = (Array.isArray(getLocalState().customers) ? getLocalState().customers : [])
        .find((item) => String(item.accountNumber || '') === key) || null;
      return defaultResult.ok(customerToSummary(row));
    }

    async function getAccountByNumber(accountNumber) {
      const customerResult = await getCustomerByAccountNumber(accountNumber);
      if (!customerResult.ok) return customerResult;
      return defaultResult.ok(customerResult.data ? customerToAccountSummary(customerResult.data) : null);
    }

    async function getAccountSummary(accountId) {
      const customerResult = await getCustomerById(accountId);
      if (!customerResult.ok) return customerResult;
      return defaultResult.ok(customerResult.data ? customerToAccountSummary(customerResult.data) : null);
    }

    async function getAccountStatement(payload = {}) {
      const customerResult = await getCustomerById(payload.accountId);
      if (!customerResult.ok) return customerResult;
      const customer = customerResult.data;
      const entries = Array.isArray(customer?.transactions) ? customer.transactions.map(normalizeStatementEntry).filter(Boolean) : [];
      const fromDate = payload.fromDate ? new Date(payload.fromDate).getTime() : null;
      const toDate = payload.toDate ? new Date(payload.toDate).getTime() : null;
      let filtered = entries.filter((entry) => {
        const time = new Date(entry.date).getTime();
        if (fromDate && time < fromDate) return false;
        if (toDate && time > toDate + 86399999) return false;
        return true;
      }).sort((a, b) => new Date(b.date) - new Date(a.date));
      if (payload.limit && payload.limit > 0) filtered = filtered.slice(0, payload.limit);
      return defaultResult.ok(filtered);
    }

    function subscribeRealtime(handlers = {}) {
      if (!canUseSupabase() || typeof client.channel !== 'function') {
        return () => {};
      }
      const channelName = `ducess-live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const channel = client.channel(channelName);
      const notify = (kind, payload) => {
        try {
          if (typeof handlers.onEvent === 'function') handlers.onEvent(kind, payload);
          const specific = handlers[kind];
          if (typeof specific === 'function') specific(payload);
        } catch (err) {
          console.warn('[DUCESS realtime] handler failed', err);
        }
      };
      const tables = [
        [approvalRequestsTable, 'approval'],
        [codSubmissionsTable, 'cod'],
        [codResolutionsTable, 'cod'],
        [debtsTable, 'debt'],
        [customerTransactionsTable, 'balance'],
        [customerBalancesTable, 'balance'],
        [customersTable, 'customer'],
        [staffTable, 'staff'],
      ];
      tables.forEach(([table, kind]) => {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => notify(kind, payload));
      });
      channel.subscribe((status) => {
        if (typeof handlers.onStatus === 'function') handlers.onStatus(status);
      });
      return () => {
        try { client.removeChannel(channel); } catch (_) {}
      };
    }

    return {
      auth: {
        async loginWithStaffId(payload) {
          const session = buildLocalSessionFromState(payload?.staffId);
          if (!session) return defaultResult.err('AUTH_NOT_FOUND', 'Staff profile not found in local adapter.');
          writeAuthSession(session);
          return defaultResult.ok(session);
        },
        async logout() {
          writeAuthSession(null);
          return defaultResult.ok({ success: true });
        },
        async getSession() {
          const saved = readAuthSession();
          if (saved?.staff?.id) return defaultResult.ok(saved);
          const fallback = buildLocalSessionFromState();
          return defaultResult.ok(fallback);
        },
        async getCurrentStaffContext() {
          const sessionResult = await this.getSession();
          if (!sessionResult.ok) return sessionResult;
          return defaultResult.ok({
            businessDate: getLocalState().businessDate,
            activeStaffId: sessionResult.data?.staff?.id || '',
            session: sessionResult.data || null,
          });
        },
      },
      staff: {
        getCurrentStaff,
        getStaffById,
        listStaff,
        listActiveStaff,
      },
      permissions: {
        getEffectivePermissions,
        hasPermission,
        listTempGrants,
        createTempGrant: () => notYet('permissions.createTempGrant'),
        revokeTempGrant: () => notYet('permissions.revokeTempGrant'),
      },
      customers: {
        listCustomers,
        searchCustomers,
        getCustomerById,
        getCustomerByAccountNumber,
        submitAccountOpening: () => notYet('customers.submitAccountOpening'),
        submitAccountMaintenance: () => notYet('customers.submitAccountMaintenance'),
        submitAccountReactivation: () => notYet('customers.submitAccountReactivation'),
      },
      accounts: {
        getAccountByNumber,
        getAccountSummary,
        getAccountStatement,
        submitCredit: () => notYet('accounts.submitCredit'),
        submitDebit: () => notYet('accounts.submitDebit'),
        submitJournalEntries: () => notYet('accounts.submitJournalEntries'),
      },
      approvals: {
        listApprovalRequests: () => notYet('approvals.listApprovalRequests'),
        getApprovalRequestById: () => notYet('approvals.getApprovalRequestById'),
        submitApprovalRequest: () => notYet('approvals.submitApprovalRequest'),
        approveRequest: () => notYet('approvals.approveRequest'),
        rejectRequest: () => notYet('approvals.rejectRequest'),
      },
      cod: {
        getCodPreview,
        submitCod,
        listCodSubmissions,
        getCodSubmissionById,
        resolveCod,
        listDebts,
        getDebtById,
        submitDebtRepayment,
      },
      dashboard: {
        getDashboardSummary: () => notYet('dashboard.getDashboardSummary'),
        getBusinessBalanceSummary: () => notYet('dashboard.getBusinessBalanceSummary'),
        getOperationalBalanceSummary: () => notYet('dashboard.getOperationalBalanceSummary'),
      },
      appState,
      __meta: {
        adapter: 'local',
        phase: '3B.3',
        usesLocalBehavior: true,
      },
      __utils: { clone, normalizeStaffSummary, normalizeStaffSession, buildDefaultPermissions, normalizeTempGrantRecord }
    };
  }
  function createSupabaseClient(config) {
    const url = config?.supabase?.url || '';
    const anonKey = config?.supabase?.anonKey || '';
    const supabaseFactory = global.supabase?.createClient;

    if (!supabaseFactory) {
      return { error: defaultResult.err('SUPABASE_LIBRARY_MISSING', 'Supabase client library is not loaded in the frontend.') };
    }
    if (!url || !anonKey) {
      return { error: defaultResult.err('SUPABASE_ENV_MISSING', 'Supabase URL or anon key is missing. Update src/data/runtime/ducess-config.js or window.__DUCESS_CONFIG__.') };
    }

    try {
      const client = supabaseFactory(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        }
      });
      return { client };
    } catch (error) {
      return { error: defaultResult.err('SUPABASE_CLIENT_INIT_FAILED', 'Failed to initialize Supabase client.', error) };
    }
  }


  function createSupabaseAdapter(options = {}) {
    const config = mergeConfig(options);
    const local = createLocalAdapter(options);
    const { client, error } = createSupabaseClient(config);
    const staffTable = config?.supabase?.staffTable || 'staff';
    const staffProfileSelect = config?.supabase?.staffProfileSelect || 'id, staff_code, full_name, role_code, is_active, branch_id, auth_user_id, auth_email';
    const staffRolePermissionsTable = config?.supabase?.staffRolePermissionsTable || 'staff_role_permissions';
    const staffTempGrantsTable = config?.supabase?.staffTempGrantsTable || 'staff_temp_grants';
    const staffEmailMode = config?.supabase?.staffEmailMode || 'synthetic_suffix';
    const syntheticEmailSuffix = config?.supabase?.syntheticEmailSuffix || '@ducess.local';
    const customersTable = config?.supabase?.customersTable || 'customers';
    const customersSelect = config?.supabase?.customersSelect || 'id, customer_number, account_number, old_account_number, full_name, address, nin, bvn, phone, photo_path, status, linked_staff_id, account_type, created_at, is_active';
    const customerTransactionsTable = config?.supabase?.customerTransactionsTable || 'customer_transactions';
    const customerTransactionsSelect = config?.supabase?.customerTransactionsSelect || 'id, customer_id, account_id, tx_type, amount, details, posted_by, posted_by_id, approved_by, counterparty, effective_at, created_at, balance_after';
    const customerBalancesTable = config?.supabase?.customerBalancesTable || 'customer_account_balances';
    const customerBalancesSelect = config?.supabase?.customerBalancesSelect || 'account_id, book_balance, updated_at';
    const customerAccountsTable = config?.supabase?.customerAccountsTable || 'customer_accounts';
    const customerAccountsSelect = config?.supabase?.customerAccountsSelect || 'id, customer_id, account_number, status, account_type, opened_at';
    const approvalRequestsTable = config?.supabase?.approvalRequestsTable || 'approval_requests';
    const approvalRequestsSelect = config?.supabase?.approvalRequestsSelect || 'id, request_type, status, payload, requested_at, requested_by_staff_id, requested_by_name, approved_at, approved_by_staff_id, approved_by_name, decision_note, entity_type, entity_id';
    const staffCashLedgerTable = config?.supabase?.staffCashLedgerTable || 'staff_cash_ledger';
    const staffCashLedgerSelect = config?.supabase?.staffCashLedgerSelect || 'id, staff_id, entry_type, amount, delta, note, approval_request_id, float_date, created_by_staff_id, approved_by_staff_id, created_at';
    const auditLogTable = config?.supabase?.auditLogTable || 'audit_log';
    const auditLogSelect = config?.supabase?.auditLogSelect || 'id, actor_staff_id, action_type, entity_type, entity_id, metadata, created_at';
    const codSubmissionsTable = config?.supabase?.codSubmissionsTable || 'cod_submissions';
    const codSubmissionsSelect = config?.supabase?.codSubmissionsSelect || 'id, staff_id, business_date, opening_balance, float_topups, effective_opening_balance, total_credits, total_debits, net_book_balance, remaining_balance, expected_cash, actual_cash, variance, overdraw, note, status, submitted_by_staff_id, submitted_at';
    const codResolutionsTable = config?.supabase?.codResolutionsTable || 'cod_resolutions';
    const codResolutionsSelect = config?.supabase?.codResolutionsSelect || 'id, cod_submission_id, final_agreed_amount, adjustment_amount, debt_amount, resolution_note, resolved_by_staff_id, resolved_at';
    const debtsTable = config?.supabase?.debtsTable || 'debts';
    const debtsSelect = config?.supabase?.debtsSelect || 'id, staff_id, business_date, source_cod_submission_id, amount, status, note, created_by_staff_id, created_at, updated_at';
    const debtRepaymentsTable = config?.supabase?.debtRepaymentsTable || 'debt_repayments';
    const debtRepaymentsSelect = config?.supabase?.debtRepaymentsSelect || 'id, debt_id, amount, payment_date, note, requested_by_staff_id, approved_by_staff_id, approval_request_id, status, created_at';
    const approvalPostingRpc = config?.supabase?.approvalPostingRpc || '';

    function normalizeApprovalRecord(row) {
      if (!row) return null;
      const payload = row.payload && typeof row.payload === 'object' ? clone(row.payload) : {};
      return {
        id: String(row.id || ''),
        type: row.request_type || row.type || '',
        requestType: row.request_type || row.type || '',
        status: row.status || 'pending',
        payload,
        requestedAt: row.requested_at || row.requestedAt || new Date().toISOString(),
        requestedBy: row.requested_by_staff_id || row.requestedByStaffId || row.requestedBy || '',
        requestedByStaffId: row.requested_by_staff_id || row.requestedByStaffId || row.requestedBy || '',
        requestedByName: row.requested_by_name || row.requestedByName || '',
        approvedAt: row.approved_at || row.approvedAt || null,
        approvedBy: row.approved_by_name || row.approvedByName || '',
        approvedByStaffId: row.approved_by_staff_id || row.approvedByStaffId || '',
        decisionNote: row.decision_note || row.decisionNote || '',
        entityType: row.entity_type || row.entityType || '',
        entityId: row.entity_id || row.entityId || '',
      };
    }
    // PASTE THIS RIGHT HERE
async function listTempGrants(_staffId) {
  return defaultResult.ok([]);
}
function subscribeRealtime() {
  return () => {};
}


    function isoAtMidday(dateValue) {
      const raw = String(dateValue || '').trim();
      if (!raw) return new Date().toISOString();
      return raw.includes('T') ? raw : `${raw}T12:00:00.000Z`;
    }

    function normalizeNumber(value) {
      const num = Number(value || 0);
      return Number.isFinite(num) ? num : 0;
    }

    function mergeApprovalPayload(existingPayload, patch) {
      return {
        ...(existingPayload && typeof existingPayload === 'object' ? clone(existingPayload) : {}),
        ...(patch && typeof patch === 'object' ? clone(patch) : {}),
      };
    }

    function inferApprovalDate(requestRow) {
      return requestRow?.payload?.businessDate || requestRow?.payload?.date || requestRow?.requested_at || new Date().toISOString();
    }

    function resolveRequestEntries(requestRow) {
      const payload = requestRow?.payload || {};
      if (requestRow?.request_type === 'customer_credit_journal' || requestRow?.request_type === 'customer_debit_journal') {
        return Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.entries) ? payload.entries : [];
      }
      return [payload];
    }

    async function fetchApprovalRequestRow(requestId, requiredStatus) {
      let query = client.from(approvalRequestsTable).select(approvalRequestsSelect).eq('id', requestId);
      if (requiredStatus) query = query.eq('status', requiredStatus);
      const { data, error: queryError } = await query.maybeSingle();
      if (queryError) return defaultResult.err('APPROVAL_FETCH_FAILED', 'Could not load approval request from Supabase.', queryError);
      if (!data) return defaultResult.err(requiredStatus === 'pending' ? 'APPROVAL_NOT_PENDING' : 'APPROVAL_NOT_FOUND', requiredStatus === 'pending' ? 'Approval request is no longer pending.' : 'Approval request was not found.');
      return defaultResult.ok(data);
    }

    async function fetchExistingPostedTransactionsByRequest(requestId) {
      if (!requestId) return defaultResult.ok([]);
      const { data, error: queryError } = await client
        .from(customerTransactionsTable)
        .select('id, account_id, customer_id, amount, tx_type, balance_after, approval_request_id')
        .eq('approval_request_id', requestId)
        .order('created_at', { ascending: true });
      if (queryError) return defaultResult.err('POSTED_TX_CHECK_FAILED', 'Could not verify previously posted transactions.', queryError);
      return defaultResult.ok(Array.isArray(data) ? data : []);
    }

    async function fetchExistingStaffCashEntryByRequest(requestId) {
      if (!requestId) return defaultResult.ok(null);
      const { data, error: queryError } = await client
        .from(staffCashLedgerTable)
        .select(staffCashLedgerSelect)
        .eq('approval_request_id', requestId)
        .maybeSingle();
      if (queryError && queryError.code !== 'PGRST116') return defaultResult.err('STAFF_LEDGER_CHECK_FAILED', 'Could not verify previously posted staff cash entry.', queryError);
      return defaultResult.ok(data || null);
    }

    async function upsertAccountBalance(accountId, nextBalance) {
      const { error: upsertError } = await client
        .from(customerBalancesTable)
        .upsert({
          account_id: accountId,
          book_balance: normalizeNumber(nextBalance),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'account_id' });
      if (upsertError) return defaultResult.err('ACCOUNT_BALANCE_UPDATE_FAILED', 'Could not update account balance in Supabase.', upsertError);
      return defaultResult.ok(true);
    }

    async function insertStaffCashLedgerEntry(payload = {}) {
      const existingResult = await fetchExistingStaffCashEntryByRequest(payload.approvalRequestId);
      if (!existingResult.ok) return existingResult;
      if (existingResult.data) return defaultResult.ok(existingResult.data);
      const insertRow = {
        staff_id: payload.staffId || null,
        entry_type: payload.entryType || 'approval_posting',
        amount: normalizeNumber(payload.amount),
        delta: normalizeNumber(payload.delta),
        note: payload.note || '',
        approval_request_id: payload.approvalRequestId || null,
        float_date: payload.floatDate || null,
        created_by_staff_id: payload.createdByStaffId || null,
        approved_by_staff_id: payload.approvedByStaffId || null,
        created_at: new Date().toISOString(),
      };
      const { data, error: insertError } = await client.from(staffCashLedgerTable).insert(insertRow).select(staffCashLedgerSelect).maybeSingle();
      if (insertError) return defaultResult.err('STAFF_LEDGER_INSERT_FAILED', 'Could not write staff cash ledger entry in Supabase.', insertError);
      return defaultResult.ok(data || insertRow);
    }

    async function insertAuditLogEntry(payload = {}) {
      const insertRow = {
        actor_staff_id: payload.actorStaffId || null,
        action_type: payload.actionType || 'approval_posted',
        entity_type: payload.entityType || 'approval_request',
        entity_id: payload.entityId || null,
        metadata: clone(payload.metadata || {}),
        created_at: new Date().toISOString(),
      };
      const { data, error: insertError } = await client.from(auditLogTable).insert(insertRow).select(auditLogSelect).maybeSingle();
      if (insertError) return defaultResult.err('AUDIT_LOG_INSERT_FAILED', 'Could not write audit log entry in Supabase.', insertError);
      return defaultResult.ok(data || insertRow);
    }

    async function postSingleCustomerTransaction(requestRow, entry, txType, approver, options = {}) {
      const approvalRequestId = requestRow?.id;
      const accountLookupId = entry?.accountId || entry?.customerId || requestRow?.entity_id || requestRow?.entityId;
      const accountSummaryResult = await getAccountSummary(accountLookupId);
      if (!accountSummaryResult.ok) return accountSummaryResult;
      const accountSummary = accountSummaryResult.data;
      if (!accountSummary?.accountId) return defaultResult.err('ACCOUNT_NOT_FOUND', 'Could not resolve target account for approved request.');

      if (!options.skipExistingCheck) {
        const existingTxResult = await fetchExistingPostedTransactionsByRequest(approvalRequestId);
        if (!existingTxResult.ok) return existingTxResult;
        if (existingTxResult.data.length) {
        return defaultResult.ok({
          alreadyPosted: true,
          requestId: approvalRequestId,
          accountId: accountSummary.accountId,
          customerId: accountSummary.customerId,
          amount: normalizeNumber(entry?.amount),
          txType,
          balanceAfter: existingTxResult.data[existingTxResult.data.length - 1]?.balance_after ?? accountSummary.bookBalance,
        });
        }
      }

      const currentBalance = normalizeNumber(accountSummary.bookBalance);
      const amount = normalizeNumber(entry?.amount);
      const delta = txType === 'credit' ? amount : -amount;
      const balanceAfter = currentBalance + delta;
      const insertRow = {
        customer_id: entry?.customerId || accountSummary.customerId || null,
        account_id: accountSummary.accountId,
        tx_type: txType,
        amount,
        details: entry?.details || '',
        posted_by: requestRow?.requested_by_name || entry?.requestedByName || '',
        posted_by_id: requestRow?.requested_by_staff_id || entry?.requestedByStaffId || '',
        approved_by: approver?.name || '',
        counterparty: entry?.receivedOrPaidBy || entry?.counterparty || '',
        effective_at: isoAtMidday(entry?.businessDate || entry?.date || inferApprovalDate(requestRow)),
        created_at: new Date().toISOString(),
        balance_after: balanceAfter,
        approval_request_id: approvalRequestId,
        status: 'approved',
      };
      const { data, error: insertError } = await client.from(customerTransactionsTable).insert(insertRow).select(customerTransactionsSelect).maybeSingle();
      if (insertError) return defaultResult.err('CUSTOMER_TX_INSERT_FAILED', 'Could not post approved transaction to Supabase.', insertError);

      const balanceResult = await upsertAccountBalance(accountSummary.accountId, balanceAfter);
      if (!balanceResult.ok) return balanceResult;

      return defaultResult.ok({
        alreadyPosted: false,
        requestId: approvalRequestId,
        accountId: accountSummary.accountId,
        customerId: entry?.customerId || accountSummary.customerId || null,
        amount,
        txType,
        balanceAfter,
        transactionId: data?.id || null,
      });
    }

    async function performDirectPostingForApproval(requestRow, approver, decisionNote) {
  const type = requestRow?.request_type || requestRow?.type || '';
  const payload = requestRow?.payload || {};

  if (type === 'account_opening') {
  const fullName = payload.fullName || payload.name || '';
  const phone = payload.phone || '';

  const existing = await client
    .from(customersTable)
    .select(customersSelect)
    .eq('full_name', fullName)
    .eq('phone', phone)
    .limit(1)
    .maybeSingle();

  if (existing.error) {
    return defaultResult.err(
      'CUSTOMER_LOOKUP_FAILED',
      'Could not verify existing customer before posting approval.',
      existing.error
    );
  }

  if (existing.data) {
    return defaultResult.ok({
      posted: true,
      requestType: type,
      transactions: [],
      cashLedger: null,
      customer: existing.data,
      decisionNote: decisionNote || '',
      alreadyPosted: true
    });
  }

  const generatedAccountNumber =
    payload.generatedAccountNumber ||
    String(Date.now()).slice(-10);

  const customerRow = {
    customer_number: null,
    account_number: generatedAccountNumber,
    old_account_number: payload.oldAccountNumber || payload.old_account_number || '',
    full_name: fullName,
    address: payload.address || '',
    nin: payload.nin || '',
    bvn: payload.bvn || '',
    phone: phone,
    photo_path: payload.photo || payload.photoRef || payload.photo_path || '',
    status: 'active',
    linked_staff_id: requestRow.requested_by_staff_id || null,
    account_type: 'customer',
    created_at: new Date().toISOString(),
    is_active: true
  };

  const inserted = await client
    .from(customersTable)
    .insert([customerRow])
    .select(customersSelect)
    .maybeSingle();

  if (inserted.error) {
    return defaultResult.err(
      'CUSTOMER_CREATE_FAILED',
      'Could not create customer from approved account opening.',
      inserted.error
    );
  }

  return defaultResult.ok({
    posted: true,
    requestType: type,
    transactions: [],
    cashLedger: null,
    customer: inserted.data,
    decisionNote: decisionNote || ''
  });
}


      const postable = ['customer_credit', 'customer_debit', 'customer_credit_journal', 'customer_debit_journal', 'float_topup', 'float_declaration', 'debt_repayment'];
      if (!postable.includes(type)) {
        return defaultResult.ok({ posted: false, requestType: type, transactions: [], cashLedger: null, decisionNote: decisionNote || '' });
      }

      if (type === 'float_declaration') {
        const ledgerResult = await insertStaffCashLedgerEntry({
          approvalRequestId: requestRow.id,
          staffId: payload.staffId || null,
          entryType: 'approved_float',
          amount: normalizeNumber(payload.amount),
          delta: normalizeNumber(payload.amount),
          note: payload.note || `Approved opening float for ${payload.staffName || 'staff'}`,
          floatDate: payload.date || null,
          createdByStaffId: requestRow.requested_by_staff_id || null,
          approvedByStaffId: approver?.staffId || null,
        });
        if (!ledgerResult.ok) return ledgerResult;
        return defaultResult.ok({ posted: true, requestType: type, transactions: [], cashLedger: ledgerResult.data, decisionNote: decisionNote || '' });
      }

      if (type === 'float_topup') {
        const ledgerResult = await insertStaffCashLedgerEntry({
          approvalRequestId: requestRow.id,
          staffId: payload.staffId || null,
          entryType: 'approved_float_topup',
          amount: normalizeNumber(payload.amount),
          delta: normalizeNumber(payload.amount),
          note: payload.note || `Approved float top-up for ${payload.staffName || 'staff'}`,
          floatDate: payload.date || null,
          createdByStaffId: requestRow.requested_by_staff_id || null,
          approvedByStaffId: approver?.staffId || null,
        });
        if (!ledgerResult.ok) return ledgerResult;
        return defaultResult.ok({ posted: true, requestType: type, transactions: [], cashLedger: ledgerResult.data, decisionNote: decisionNote || '' });
      }

      if (type === 'debt_repayment') {
        const debtResult = await getDebtById(payload.debtId || requestRow.entity_id || '');
        if (!debtResult.ok) return debtResult;
        const debt = debtResult.data;
        if (!debt) return defaultResult.err('DEBT_NOT_FOUND', 'Target debt was not found for repayment.');
        const repaymentAmount = Math.max(0, normalizeNumber(payload.amount));
        const repaymentCheck = await client.from(debtRepaymentsTable).select('id').eq('approval_request_id', requestRow.id).limit(1);
        if (repaymentCheck.error) return defaultResult.err('DEBT_REPAYMENT_CHECK_FAILED', 'Could not verify prior debt repayment posting.', repaymentCheck.error);
        if (!(repaymentCheck.data || []).length) {
          const repaymentRow = {
            debt_id: debt.id,
            amount: repaymentAmount,
            payment_date: payload.paymentDate || payload.payment_date || new Date().toISOString().slice(0,10),
            note: payload.note || '',
            requested_by_staff_id: requestRow.requested_by_staff_id || null,
            approved_by_staff_id: approver?.staffId || null,
            approval_request_id: requestRow.id,
            status: 'approved',
            created_at: new Date().toISOString(),
          };
          const ins = await client.from(debtRepaymentsTable).insert(repaymentRow).select(debtRepaymentsSelect).maybeSingle();
          if (ins.error) return defaultResult.err('DEBT_REPAYMENT_INSERT_FAILED', 'Could not post debt repayment in Supabase.', ins.error);
          const remaining = Math.max(0, normalizeNumber(debt.amount) - repaymentAmount);
          const nextStatus = remaining === 0 ? 'paid' : 'part_paid';
          const upd = await client.from(debtsTable).update({ amount: remaining, status: nextStatus, updated_at: new Date().toISOString() }).eq('id', debt.id).select(debtsSelect).maybeSingle();
          if (upd.error) return defaultResult.err('DEBT_UPDATE_FAILED', 'Could not update debt after repayment.', upd.error);
          return defaultResult.ok({ posted: true, requestType: type, transactions: [], cashLedger: null, debt: normalizeDebtRecord(upd.data), repayment: ins.data, decisionNote: decisionNote || '' });
        }
        return defaultResult.ok({ posted: true, requestType: type, transactions: [], cashLedger: null, debt, decisionNote: decisionNote || '', alreadyPosted: true });
      }

      const txType = (type === 'customer_debit' || type === 'customer_debit_journal') ? 'debit' : 'credit';
      const entries = resolveRequestEntries(requestRow);
      const existingTxResult = await fetchExistingPostedTransactionsByRequest(requestRow.id);
      if (!existingTxResult.ok) return existingTxResult;
      if (existingTxResult.data.length >= entries.length && entries.length > 0) {
        return defaultResult.ok({ posted: true, requestType: type, transactions: existingTxResult.data, cashLedger: null, decisionNote: decisionNote || '', alreadyPosted: true });
      }
      if (existingTxResult.data.length > 0 && existingTxResult.data.length < entries.length) {
        return defaultResult.err('PARTIAL_POST_DETECTED', 'A partial backend posting was detected for this approval request. Resolve before retrying.');
      }
      const results = [];
      for (const entry of entries) {
        const postedResult = await postSingleCustomerTransaction(requestRow, entry, txType, approver, { skipExistingCheck: true });
        if (!postedResult.ok) return postedResult;
        results.push(postedResult.data);
      }

      const totalAmount = results.reduce((sum, item) => sum + normalizeNumber(item?.amount), 0);
      const ledgerResult = await insertStaffCashLedgerEntry({
        approvalRequestId: requestRow.id,
        staffId: payload.staffId || payload.requestedByStaffId || requestRow.requested_by_staff_id || null,
        entryType: type,
        amount: totalAmount,
        delta: totalAmount ? -Math.abs(totalAmount) : 0,
        note: payload.note || `${type} posted from approval ${requestRow.id}`,
        floatDate: payload.date || payload.businessDate || null,
        createdByStaffId: requestRow.requested_by_staff_id || null,
        approvedByStaffId: approver?.staffId || null,
      });
      if (!ledgerResult.ok) return ledgerResult;

      return defaultResult.ok({ posted: true, requestType: type, transactions: results, cashLedger: ledgerResult.data, decisionNote: decisionNote || '' });
    }

    async function markApprovalDecision(requestId, status, actor, note, payloadPatch) {
      const currentResult = await getApprovalRequestById(requestId);
      if (!currentResult.ok) return currentResult;
      const current = currentResult.data;
      const patch = {
        status,
        approved_at: new Date().toISOString(),
        approved_by_staff_id: actor?.staffId || '',
        approved_by_name: actor?.name || '',
        decision_note: note || '',
        payload: mergeApprovalPayload(current?.payload, payloadPatch),
      };
      const { data, error: updateError } = await client.from(approvalRequestsTable).update(patch).eq('id', requestId).eq('status', 'pending').select(approvalRequestsSelect).maybeSingle();
      if (updateError) return defaultResult.err(status === 'approved' ? 'APPROVAL_APPROVE_FAILED' : 'APPROVAL_REJECT_FAILED', status === 'approved' ? 'Could not approve request in Supabase.' : 'Could not reject request in Supabase.', updateError);
      if (!data) return defaultResult.err('APPROVAL_NOT_PENDING', 'Approval request is no longer pending.');
      return defaultResult.ok(normalizeApprovalRecord(data));
    }

    async function listApprovalRequests(filters = {}) {
      if (!canUseSupabase()) return local.approvals.listApprovalRequests(filters);
      let query = client.from(approvalRequestsTable).select(approvalRequestsSelect).order('requested_at', { ascending: false });
      if (filters?.status) query = query.eq('status', filters.status);
      if (filters?.requestType) query = query.eq('request_type', filters.requestType);
      if (filters?.requestedByStaffId) query = query.eq('requested_by_staff_id', filters.requestedByStaffId);
      const limit = Number(filters?.limit || 100);
      if (Number.isFinite(limit) && limit > 0) query = query.limit(Math.min(limit, 500));
      const { data, error: queryError } = await query;
      if (queryError) return defaultResult.err('APPROVAL_LIST_FAILED', 'Could not load approval requests from Supabase.', queryError);
      return defaultResult.ok((data || []).map(normalizeApprovalRecord).filter(Boolean));
    }

    async function getApprovalRequestById(requestId) {
      if (!canUseSupabase()) return local.approvals.getApprovalRequestById(requestId);
      const { data, error: queryError } = await client.from(approvalRequestsTable).select(approvalRequestsSelect).eq('id', requestId).maybeSingle();
      if (queryError) return defaultResult.err('APPROVAL_FETCH_FAILED', 'Could not load approval request from Supabase.', queryError);
      return defaultResult.ok(normalizeApprovalRecord(data));
    }

    async function submitApprovalRequest(payload = {}) {
  console.log("submitApprovalRequest HIT", payload);
  // FORCE Supabase (temporary debug override)
  if (!canUseSupabase()) {
    console.warn("⚠️ Falling back to local, but forcing Supabase instead");
  }

  const insertPayload = {
    request_type: payload.requestType || payload.type || '',
    status: 'pending',
    payload: clone(payload.payload || {}),
    requested_by_staff_id: payload.requestedByStaffId || payload.requested_by_staff_id || '',
    requested_by_name: payload.requestedByName || payload.requested_by_name || '',
    requested_at: new Date().toISOString(),
    entity_type: payload.entityType || payload.entity_type || null,
    entity_id: payload.entityId || payload.entity_id || null,
  };

  console.log("APPROVAL INSERT PAYLOAD", insertPayload);
  console.log("APPROVAL TABLE", approvalRequestsTable);

  const { data, error: insertError } = await client
    .from(approvalRequestsTable)
    .insert([insertPayload])
    .select(approvalRequestsSelect)
    .single();

  console.log("APPROVAL INSERT RESULT", { data, insertError });

  if (insertError) return defaultResult.err('APPROVAL_CREATE_FAILED', 'Could not create approval request in Supabase.', insertError);
  return defaultResult.ok(normalizeApprovalRecord(data));
}

    async function approveRequest(payload = {}) {
      if (!canUseSupabase()) return local.approvals.approveRequest(payload);
      const approver = {
        staffId: payload.approvedByStaffId || payload.approved_by_staff_id || '',
        name: payload.approvedByName || payload.approved_by_name || '',
      };
      const decisionNote = payload.note || '';

      if (approvalPostingRpc) {
        const { data, error: rpcError } = await client.rpc(approvalPostingRpc, {
          p_request_id: payload.requestId,
          p_approved_by_staff_id: approver.staffId,
          p_approved_by_name: approver.name,
          p_decision_note: decisionNote,
        });
        if (rpcError) return defaultResult.err('APPROVAL_POST_RPC_FAILED', 'Could not approve and post request through Supabase RPC.', rpcError);
        return defaultResult.ok(normalizeApprovalRecord(data));
      }

      const requestResult = await fetchApprovalRequestRow(payload.requestId, 'pending');
      if (!requestResult.ok) return requestResult;
      const requestRow = requestResult.data;

      const postingResult = await performDirectPostingForApproval(requestRow, approver, decisionNote);
      if (!postingResult.ok) return postingResult;

      const postingMeta = {
        __posting: {
          posted: postingResult.data?.posted !== false,
          postedAt: new Date().toISOString(),
          requestType: requestRow.request_type || '',
          transactions: Array.isArray(postingResult.data?.transactions) ? postingResult.data.transactions : [],
          cashLedger: postingResult.data?.cashLedger || null,
        }
      };

      const approvalResult = await markApprovalDecision(payload.requestId, 'approved', approver, decisionNote, postingMeta);
      if (!approvalResult.ok) return approvalResult;


      const auditResult = await insertAuditLogEntry({
        actorStaffId: approver.staffId,
        actionType: 'approval_posted',
        entityType: 'approval_request',
        entityId: payload.requestId,
        metadata: {
          requestType: requestRow.request_type || '',
          posted: postingResult.data?.posted !== false,
          transactions: postingResult.data?.transactions || [],
          cashLedger: postingResult.data?.cashLedger || null,
          decisionNote,
        }
      });
      if (!auditResult.ok) return auditResult;

      return approvalResult;
    }

    async function rejectRequest(payload = {}) {
      if (!canUseSupabase()) return local.approvals.rejectRequest(payload);
      return markApprovalDecision(payload.requestId, 'rejected', {
        staffId: payload.rejectedByStaffId || payload.rejected_by_staff_id || '',
        name: payload.rejectedByName || payload.rejected_by_name || '',
      }, payload.note || '', null);
    }

    async function submitAccountOpening(payload = {}) {
      console.log("submitAccountOpening HIT", payload);
      return submitApprovalRequest({
        requestType: 'account_opening',
        requestedByStaffId: payload.openedByStaffId || payload.requestedByStaffId || '',
        requestedByName: payload.requestedByName || payload.openedByName || '',
        payload: clone(payload),
      });
    }

    async function submitAccountMaintenance(payload = {}) {
      return submitApprovalRequest({
        requestType: 'account_maintenance',
        requestedByStaffId: payload.requestedByStaffId || '',
        requestedByName: payload.requestedByName || '',
        payload: clone(payload),
      });
    }

    async function submitAccountReactivation(payload = {}) {
      return submitApprovalRequest({
        requestType: 'account_reactivation',
        requestedByStaffId: payload.requestedByStaffId || '',
        requestedByName: payload.requestedByName || '',
        payload: clone(payload),
      });
    }

    async function submitCredit(payload = {}) {
      return submitApprovalRequest({
        requestType: 'customer_credit',
        requestedByStaffId: payload.requestedByStaffId || '',
        requestedByName: payload.requestedByName || '',
        payload: clone(payload),
      });
    }

    async function submitDebit(payload = {}) {
      return submitApprovalRequest({
        requestType: 'customer_debit',
        requestedByStaffId: payload.requestedByStaffId || '',
        requestedByName: payload.requestedByName || '',
        payload: clone(payload),
      });
    }


    async function fetchApprovedCustomerTransactionsForStaffDate(staffId, businessDate) {
      let query = client.from(customerTransactionsTable).select(customerTransactionsSelect).eq('status', 'approved');
      if (staffId) query = query.eq('posted_by_id', staffId);
      if (businessDate) {
        const start = `${businessDate}T00:00:00.000Z`;
        const endDate = new Date(`${businessDate}T00:00:00.000Z`);
        endDate.setUTCDate(endDate.getUTCDate() + 1);
        const end = endDate.toISOString();
        query = query.gte('effective_at', start).lt('effective_at', end);
      }
      const { data, error: queryError } = await query.order('effective_at', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true });
      if (queryError) return defaultResult.err('COD_TX_FETCH_FAILED', 'Could not load approved customer transactions from Supabase.', queryError);
      const rows = (Array.isArray(data) ? data : []).filter((row) => {
        const d = String(row.effective_at || row.created_at || '').slice(0,10);
        return !businessDate || d === businessDate;
      });
      return defaultResult.ok(rows);
    }

    async function fetchApprovedStaffCashEntriesForStaffDate(staffId, businessDate) {
      let query = client.from(staffCashLedgerTable).select(staffCashLedgerSelect);
      if (staffId) query = query.eq('staff_id', staffId);
      if (businessDate) query = query.eq('float_date', businessDate);
      const { data, error: queryError } = await query.order('created_at', { ascending: true });
      if (queryError) return defaultResult.err('COD_LEDGER_FETCH_FAILED', 'Could not load staff cash ledger entries from Supabase.', queryError);
      const rows = (Array.isArray(data) ? data : []).filter((row) => {
        const d = String(row.float_date || row.created_at || '').slice(0,10);
        return !businessDate || d === businessDate;
      });
      return defaultResult.ok(rows);
    }

    function computeCodMetricsFromRows(transactionRows = [], cashRows = []) {
      const totalCredits = transactionRows.filter((row) => String(row.tx_type || row.type || '').toLowerCase() === 'credit').reduce((sum, row) => sum + normalizeNumber(row.amount), 0);
      const totalDebits = transactionRows.filter((row) => String(row.tx_type || row.type || '').toLowerCase() === 'debit').reduce((sum, row) => sum + normalizeNumber(row.amount), 0);
      const openingBalance = cashRows.filter((row) => String(row.entry_type || '').toLowerCase() === 'approved_float').reduce((sum, row) => sum + normalizeNumber(row.amount), 0);
      const floatTopUps = cashRows.filter((row) => String(row.entry_type || '').toLowerCase() === 'approved_float_topup').reduce((sum, row) => sum + normalizeNumber(row.amount), 0);
      const effectiveOpeningBalance = openingBalance + floatTopUps;
      const netBookBalance = totalCredits - totalDebits;
      const remainingBalance = openingBalance + floatTopUps - totalCredits - totalDebits;
      const expectedCash = remainingBalance;
      const overdraw = Math.max(0, -remainingBalance);
      return { openingBalance, floatTopUps, effectiveOpeningBalance, totalCredits, totalDebits, netBookBalance, remainingBalance, expectedCash, overdraw };
    }

    async function getCodPreview(payload = {}) {
      if (!canUseSupabase()) return local.cod.getCodPreview(payload);
      const txResult = await fetchApprovedCustomerTransactionsForStaffDate(payload.staffId, payload.businessDate);
      if (!txResult.ok) return txResult;
      const cashResult = await fetchApprovedStaffCashEntriesForStaffDate(payload.staffId, payload.businessDate);
      if (!cashResult.ok) return cashResult;
      return defaultResult.ok(computeCodMetricsFromRows(txResult.data, cashResult.data));
    }

    async function listCodSubmissions(filters = {}) {
      if (!canUseSupabase()) return local.cod.listCodSubmissions(filters);
      let query = client.from(codSubmissionsTable).select(codSubmissionsSelect).order('submitted_at', { ascending: false });
      if (filters.staffId) query = query.eq('staff_id', filters.staffId);
      if (filters.businessDate || filters.date) query = query.eq('business_date', filters.businessDate || filters.date);
      const limit = Number(filters?.limit || 100);
      if (Number.isFinite(limit) && limit > 0) query = query.limit(Math.min(limit, 500));
      const { data, error: queryError } = await query;
      if (queryError) return defaultResult.err('COD_LIST_FAILED', 'Could not load COD submissions from Supabase.', queryError);
      const baseRows = (data || []).map(normalizeCodSubmissionRecord).filter(Boolean);
      const ids = baseRows.map((row) => row.id).filter(Boolean);
      let resolutionMap = new Map();
      if (ids.length) {
        const { data: resData, error: resErr } = await client.from(codResolutionsTable).select(codResolutionsSelect).in('cod_submission_id', ids);
        if (resErr) return defaultResult.err('COD_RESOLUTION_LIST_FAILED', 'Could not load COD resolutions from Supabase.', resErr);
        resolutionMap = new Map((resData || []).map((row) => [String(row.cod_submission_id), row]));
      }
      return defaultResult.ok(baseRows.map((row) => {
        const res = resolutionMap.get(row.id);
        return res ? Object.assign({}, row, normalizeCodSubmissionRecord(res), { id: row.id, staffId: row.staffId, businessDate: row.businessDate, date: row.date }) : row;
      }));
    }

    async function getCodSubmissionById(codId) {
      if (!canUseSupabase()) return local.cod.getCodSubmissionById(codId);
      const listResult = await listCodSubmissions({});
      if (!listResult.ok) return listResult;
      return defaultResult.ok((listResult.data || []).find((row) => row.id === codId) || null);
    }

    async function submitCod(payload = {}) {
      if (!canUseSupabase()) return local.cod.submitCod(payload);
      const previewResult = await getCodPreview({ staffId: payload.staffId, businessDate: payload.businessDate });
      if (!previewResult.ok) return previewResult;
      const metrics = previewResult.data;
      let existingQuery = client.from(codSubmissionsTable).select(codSubmissionsSelect).eq('staff_id', payload.staffId).eq('business_date', payload.businessDate).maybeSingle();
      const { data: existingData, error: existingError } = await existingQuery;
      if (existingError && existingError.code !== 'PGRST116') return defaultResult.err('COD_EXISTING_CHECK_FAILED', 'Could not verify existing COD submission.', existingError);
      const row = {
        staff_id: payload.staffId || '',
        business_date: payload.businessDate || '',
        opening_balance: normalizeNumber(metrics.openingBalance),
        float_topups: normalizeNumber(metrics.floatTopUps),
        effective_opening_balance: normalizeNumber(metrics.effectiveOpeningBalance),
        total_credits: normalizeNumber(metrics.totalCredits),
        total_debits: normalizeNumber(metrics.totalDebits),
        net_book_balance: normalizeNumber(metrics.netBookBalance),
        remaining_balance: normalizeNumber(metrics.remainingBalance),
        expected_cash: normalizeNumber(metrics.expectedCash),
        actual_cash: normalizeNumber(payload.actualCash),
        variance: normalizeNumber(payload.actualCash) - normalizeNumber(metrics.expectedCash),
        overdraw: normalizeNumber(metrics.overdraw),
        note: payload.note || '',
        status: (normalizeNumber(payload.actualCash) - normalizeNumber(metrics.expectedCash) === 0 && normalizeNumber(metrics.overdraw) === 0) ? 'submitted' : 'flagged',
        submitted_by_staff_id: payload.submittedByStaffId || payload.staffId || '',
        submitted_at: new Date().toISOString(),
      };
      let res;
      if (existingData?.id) {
        res = await client.from(codSubmissionsTable).update(row).eq('id', existingData.id).select(codSubmissionsSelect).single();
      } else {
        res = await client.from(codSubmissionsTable).insert(row).select(codSubmissionsSelect).single();
      }
      if (res.error) return defaultResult.err('COD_SUBMIT_FAILED', 'Could not submit COD record to Supabase.', res.error);
      await insertAuditLogEntry({ actorStaffId: payload.submittedByStaffId || payload.staffId || null, actionType: 'cod_submission', entityType: 'cod_submission', entityId: res.data?.id || null, metadata: clone(row) });
      return defaultResult.ok(normalizeCodSubmissionRecord(res.data));
    }

    async function listDebts(filters = {}) {
      if (!canUseSupabase()) return local.cod.listDebts(filters);
      let query = client.from(debtsTable).select(debtsSelect).order('created_at', { ascending: false });
      if (filters.staffId) query = query.eq('staff_id', filters.staffId);
      if (filters.status) query = query.eq('status', filters.status);
      const { data, error: queryError } = await query;
      if (queryError) return defaultResult.err('DEBT_LIST_FAILED', 'Could not load debts from Supabase.', queryError);
      return defaultResult.ok((data || []).map(normalizeDebtRecord).filter(Boolean));
    }

    async function getDebtById(debtId) {
      if (!canUseSupabase()) return local.cod.getDebtById(debtId);
      const { data, error: queryError } = await client.from(debtsTable).select(debtsSelect).eq('id', debtId).maybeSingle();
      if (queryError) return defaultResult.err('DEBT_FETCH_FAILED', 'Could not load debt from Supabase.', queryError);
      return defaultResult.ok(normalizeDebtRecord(data));
    }

    async function submitDebtRepayment(payload = {}) {
      if (!canUseSupabase()) return local.cod.submitDebtRepayment(payload);
      return submitApprovalRequest({
        requestType: 'debt_repayment',
        requestedByStaffId: payload.requestedByStaffId || '',
        requestedByName: payload.requestedByName || '',
        payload: clone(payload),
        entityType: 'debt',
        entityId: payload.debtId || null,
      });
    }

    async function resolveCod(payload = {}) {
      if (!canUseSupabase()) return local.cod.resolveCod(payload);
      const submissionResult = await getCodSubmissionById(payload.codSubmissionId);
      if (!submissionResult.ok) return submissionResult;
      const cod = submissionResult.data;
      if (!cod) return defaultResult.err('COD_NOT_FOUND', 'COD submission was not found.');
      const finalAgreedAmount = normalizeNumber(payload.finalAgreedAmount);
      const adjustmentAmount = finalAgreedAmount - normalizeNumber(cod.netBookBalance);
      const debtAmount = Math.max(0, normalizeNumber(payload.debtAmount));
      let existingRes = await client.from(codResolutionsTable).select(codResolutionsSelect).eq('cod_submission_id', payload.codSubmissionId).maybeSingle();
      if (existingRes.error && existingRes.error.code != 'PGRST116') return defaultResult.err('COD_RESOLUTION_CHECK_FAILED', 'Could not verify COD resolution.', existingRes.error);
      const resolutionRow = {
        cod_submission_id: payload.codSubmissionId,
        final_agreed_amount: finalAgreedAmount,
        adjustment_amount: adjustmentAmount,
        debt_amount: debtAmount,
        resolution_note: payload.resolutionNote || '',
        resolved_by_staff_id: payload.resolvedByStaffId || '',
        resolved_at: new Date().toISOString(),
      };
      let resolutionResult;
      if (existingRes.data?.id) resolutionResult = await client.from(codResolutionsTable).update(resolutionRow).eq('id', existingRes.data.id).select(codResolutionsSelect).single();
      else resolutionResult = await client.from(codResolutionsTable).insert(resolutionRow).select(codResolutionsSelect).single();
      if (resolutionResult.error) return defaultResult.err('COD_RESOLUTION_FAILED', 'Could not store COD resolution in Supabase.', resolutionResult.error);
      if (adjustmentAmount !== 0) {
        const existingAdj = await fetchExistingPostedTransactionsByRequest(`cod-resolution:${payload.codSubmissionId}`);
      }
      if (adjustmentAmount !== 0) {
        const existingAudit = await client.from(customerTransactionsTable).select('id').eq('approval_request_id', `cod-resolution:${payload.codSubmissionId}`).limit(1);
        if (!existingAudit.error && !(existingAudit.data || []).length) {
          const adjustmentRow = {
            customer_id: null,
            account_id: null,
            tx_type: adjustmentAmount > 0 ? 'credit' : 'debit',
            amount: Math.abs(adjustmentAmount),
            details: `COD adjustment for ${cod.staffId} ${cod.businessDate}`,
            posted_by: 'COD Resolution',
            posted_by_id: payload.resolvedByStaffId || '',
            approved_by: payload.resolvedByStaffId || '',
            counterparty: cod.staffId || '',
            effective_at: isoAtMidday(cod.businessDate),
            created_at: new Date().toISOString(),
            balance_after: null,
            approval_request_id: `cod-resolution:${payload.codSubmissionId}`,
            status: 'approved',
          };
          await client.from(customerTransactionsTable).insert(adjustmentRow);
        }
      }
      if (debtAmount > 0) {
        const existingDebt = await client.from(debtsTable).select(debtsSelect).eq('source_cod_submission_id', payload.codSubmissionId).maybeSingle();
        const debtRow = {
          staff_id: cod.staffId,
          business_date: cod.businessDate,
          source_cod_submission_id: payload.codSubmissionId,
          amount: debtAmount,
          status: debtAmount > 0 ? 'open' : 'paid',
          note: payload.resolutionNote || '',
          created_by_staff_id: payload.resolvedByStaffId || '',
          updated_at: new Date().toISOString(),
        };
        if (existingDebt.data?.id) await client.from(debtsTable).update(debtRow).eq('id', existingDebt.data.id);
        else { debtRow['created_at'] = new Date().toISOString(); await client.from(debtsTable).insert(debtRow); }
      }
      await client.from(codSubmissionsTable).update({ status: 'resolved' }).eq('id', payload.codSubmissionId);
      await insertAuditLogEntry({ actorStaffId: payload.resolvedByStaffId || null, actionType: 'cod_resolution', entityType: 'cod_submission', entityId: payload.codSubmissionId, metadata: { finalAgreedAmount, adjustmentAmount, debtAmount, resolutionNote: payload.resolutionNote || '' } });
      const refreshed = await getCodSubmissionById(payload.codSubmissionId);
      return refreshed.ok ? refreshed : defaultResult.ok(Object.assign({}, cod, normalizeCodSubmissionRecord(resolutionResult.data), { status: 'resolved' }));
    }

    async function submitJournalEntries(payload = {}) {
      const rows = Array.isArray(payload.entries) ? payload.entries : [];
      const inferredType = rows.some((row) => row?.txType === 'debit') ? 'customer_debit_journal' : 'customer_credit_journal';
      return submitApprovalRequest({
        requestType: inferredType,
        requestedByStaffId: payload.requestedByStaffId || '',
        requestedByName: payload.requestedByName || '',
        payload: clone(payload),
      });
    }

    function canUseSupabase() {
      return !!client;
    }

    async function getStaffProfileBySelector(selector) {
      if (!canUseSupabase()) return error;
      let query = client.from(staffTable).select(staffProfileSelect).limit(1);
      Object.entries(selector || {}).forEach(([column, value]) => {
        if (value !== undefined && value !== null && value !== '') query = query.eq(column, value);
      });
      const { data, error: queryError } = await query.maybeSingle();
      if (queryError) return defaultResult.err('STAFF_PROFILE_FETCH_FAILED', 'Could not fetch staff profile from Supabase.', queryError);
      if (!data) return defaultResult.err('STAFF_PROFILE_NOT_FOUND', 'No matching staff profile was found in Supabase.');
      return defaultResult.ok(data);
    }

    async function fetchRolePermissions(roleCode) {
      if (!canUseSupabase() || !roleCode) return defaultResult.ok([]);
      const { data, error: queryError } = await client
        .from(staffRolePermissionsTable)
        .select('tool_code, allowed')
        .eq('role_code', roleCode);
      if (queryError) return defaultResult.err('ROLE_PERMISSIONS_FETCH_FAILED', 'Could not fetch role permissions from Supabase.', queryError);
      const normalized = (Array.isArray(data) ? data : [])
        .filter((item) => item?.tool_code)
        .map((item) => ({ toolCode: item.tool_code, allowed: item.allowed !== false, source: 'role' }));
      return defaultResult.ok(normalized);
    }

    async function fetchTempGrants(staffId) {
      if (!canUseSupabase() || !staffId) return defaultResult.ok([]);
      const { data, error: queryError } = await client
        .from(staffTempGrantsTable)
        .select('id, staff_id, tool_code, starts_at, ends_at, note, enabled, granted_by_staff_id')
        .eq('staff_id', staffId)
        .eq('enabled', true);
      if (queryError) return defaultResult.err('TEMP_GRANTS_FETCH_FAILED', 'Could not fetch temporary grants from Supabase.', queryError);
      const normalized = (Array.isArray(data) ? data : [])
        .map(normalizeTempGrantRecord)
        .filter(Boolean);
      return defaultResult.ok(normalized);
    }


    async function fetchCustomersRows(filters = {}) {
      if (!canUseSupabase()) return defaultResult.err('SUPABASE_UNAVAILABLE', 'Supabase client is not available.');
      let query = client.from(customersTable).select(customersSelect);
      if (filters.customerId) query = query.eq('id', filters.customerId);
      if (filters.accountNumber) query = query.eq('account_number', String(filters.accountNumber).trim());
      if (filters.linkedStaffId) query = query.eq('linked_staff_id', filters.linkedStaffId);
      if (filters.status) query = query.eq('status', filters.status);
      if (filters.search) {
        const escaped = String(filters.search).replace(/,/g, ' ');
        query = query.or(`full_name.ilike.%${escaped}%,account_number.ilike.%${escaped}%,phone.ilike.%${escaped}%`);
      }
      const { data, error: queryError } = await query.order('created_at', { ascending: true });
      if (queryError) return defaultResult.err('CUSTOMERS_FETCH_FAILED', 'Could not fetch customers from Supabase.', queryError);
      return defaultResult.ok(Array.isArray(data) ? data : []);
    }

    async function fetchTransactionsByCustomerIds(customerIds) {
      if (!canUseSupabase()) return defaultResult.err('SUPABASE_UNAVAILABLE', 'Supabase client is not available.');
      const ids = Array.isArray(customerIds) ? customerIds.filter(Boolean) : [];
      if (!ids.length) return defaultResult.ok([]);
      const { data, error: queryError } = await client
        .from(customerTransactionsTable)
        .select(customerTransactionsSelect)
        .in('customer_id', ids)
        .order('effective_at', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true });
      if (queryError) return defaultResult.err('CUSTOMER_TX_FETCH_FAILED', 'Could not fetch customer transactions from Supabase.', queryError);
      return defaultResult.ok(Array.isArray(data) ? data : []);
    }

    async function fetchTransactionsByAccountId(accountId) {
      if (!canUseSupabase()) return defaultResult.err('SUPABASE_UNAVAILABLE', 'Supabase client is not available.');
      if (!accountId) return defaultResult.ok([]);
      let primary = await client
        .from(customerTransactionsTable)
        .select(customerTransactionsSelect)
        .eq('account_id', accountId)
        .order('effective_at', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true });
      if (primary.error) return defaultResult.err('ACCOUNT_TX_FETCH_FAILED', 'Could not fetch account statement from Supabase.', primary.error);
      let rows = Array.isArray(primary.data) ? primary.data : [];
      if (!rows.length) {
        const secondary = await client
          .from(customerTransactionsTable)
          .select(customerTransactionsSelect)
          .eq('customer_id', accountId)
          .order('effective_at', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true });
        if (secondary.error) return defaultResult.err('ACCOUNT_TX_FETCH_FAILED', 'Could not fetch account statement from Supabase.', secondary.error);
        rows = Array.isArray(secondary.data) ? secondary.data : [];
      }
      return defaultResult.ok(rows);
    }

    async function fetchBalancesByAccountIds(accountIds) {
      if (!canUseSupabase()) return defaultResult.err('SUPABASE_UNAVAILABLE', 'Supabase client is not available.');
      const ids = Array.isArray(accountIds) ? accountIds.filter(Boolean) : [];
      if (!ids.length) return defaultResult.ok([]);
      const { data, error: queryError } = await client
        .from(customerBalancesTable)
        .select(customerBalancesSelect)
        .in('account_id', ids);
      if (queryError) return defaultResult.err('ACCOUNT_BALANCE_FETCH_FAILED', 'Could not fetch account balances from Supabase.', queryError);
      return defaultResult.ok(Array.isArray(data) ? data : []);
    }

    async function fetchAccountBySelector(selector = {}) {
      if (!canUseSupabase()) return defaultResult.err('SUPABASE_UNAVAILABLE', 'Supabase client is not available.');
      let query = client.from(customerAccountsTable).select(customerAccountsSelect).limit(1);
      Object.entries(selector).forEach(([column, value]) => {
        if (value !== undefined && value !== null && value !== '') query = query.eq(column, value);
      });
      const { data, error: queryError } = await query.maybeSingle();
      if (queryError) return defaultResult.err('ACCOUNT_FETCH_FAILED', 'Could not fetch account from Supabase.', queryError);
      return defaultResult.ok(data || null);
    }

    async function buildCustomersForUi(rows) {
      const customerRows = Array.isArray(rows) ? rows : [];
      const customerIds = customerRows.map((row) => row.id).filter(Boolean);
      const txResult = await fetchTransactionsByCustomerIds(customerIds);
      if (!txResult.ok) return txResult;
      const txRows = txResult.data;
      const txByCustomer = new Map();
      txRows.forEach((row) => {
        const key = row.customer_id;
        if (!key) return;
        if (!txByCustomer.has(key)) txByCustomer.set(key, []);
        txByCustomer.get(key).push(normalizeLocalTransaction({
          id: row.id,
          type: row.tx_type,
          amount: row.amount,
          details: row.details,
          posted_by: row.posted_by,
          posted_by_id: row.posted_by_id,
          approved_by: row.approved_by,
          counterparty: row.counterparty,
          effective_at: row.effective_at || row.created_at,
          created_at: row.created_at,
          balance_after: row.balance_after,
        }));
      });

      const normalized = customerRows.map((row) => customerToSummary({
        id: row.id,
        customer_number: row.customer_number,
        account_number: row.account_number,
        old_account_number: row.old_account_number,
        full_name: row.full_name,
        address: row.address,
        nin: row.nin,
        bvn: row.bvn,
        phone: row.phone,
        photo_path: row.photo_path,
        status: row.status,
        linked_staff_id: row.linked_staff_id,
        account_type: row.account_type,
        created_at: row.created_at,
        is_active: row.is_active,
        transactions: txByCustomer.get(row.id) || [],
      })).filter(Boolean);

      normalized.forEach((customer) => {
        let running = 0;
        (customer.transactions || []).sort((a, b) => new Date(a.date) - new Date(b.date)).forEach((tx) => {
          running += tx.type === 'credit' ? Number(tx.amount || 0) : -Number(tx.amount || 0);
          tx.balanceAfter = tx.balanceAfter ?? running;
        });
        customer.balance = Number(customer.transactions?.length ? running : customer.balance || 0);
      });
      return defaultResult.ok(normalized);
    }

    async function getCurrentStaff() {
      if (!canUseSupabase()) return local.staff.getCurrentStaff();
      const { data, error: sessionError } = await client.auth.getSession();
      if (sessionError) return defaultResult.err('AUTH_SESSION_FAILED', sessionError.message || 'Unable to fetch current session.', sessionError);
      const authSession = data?.session;
      if (!authSession?.user) return defaultResult.ok(null);

      let staffResult = await getStaffProfileBySelector({ auth_user_id: authSession.user.id });
      if (!staffResult.ok && authSession.user.email) {
        staffResult = await getStaffProfileBySelector({ auth_email: authSession.user.email });
      }
      if (!staffResult.ok) return staffResult;
      return defaultResult.ok(normalizeStaffSummary(staffResult.data));
    }

    async function getStaffById(staffId) {
      if (!canUseSupabase()) return local.staff.getStaffById(staffId);
      if (!staffId) return defaultResult.ok(null);

      let staffResult = await getStaffProfileBySelector({ id: staffId });
      if (!staffResult.ok) {
        staffResult = await getStaffProfileBySelector({ staff_code: staffId });
      }
      if (!staffResult.ok) {
        if (staffResult.error?.code === 'STAFF_PROFILE_NOT_FOUND') return defaultResult.ok(null);
        return staffResult;
      }
      return defaultResult.ok(normalizeStaffSummary(staffResult.data));
    }

    async function listStaff(filters = {}) {
      if (!canUseSupabase()) return local.staff.listStaff(filters);
      let query = client.from(staffTable).select(staffProfileSelect);
      if (filters.roleCode) query = query.eq('role_code', filters.roleCode);
      if (typeof filters.isActive === 'boolean') query = query.eq('is_active', filters.isActive);
      if (filters.search) {
        const escaped = String(filters.search).replace(/,/g, ' ');
        query = query.or(`full_name.ilike.%${escaped}%,staff_code.ilike.%${escaped}%`);
      }
      const { data, error: queryError } = await query.order('full_name', { ascending: true });
      if (queryError) return defaultResult.err('STAFF_LIST_FETCH_FAILED', 'Could not fetch staff list from Supabase.', queryError);
      return defaultResult.ok((Array.isArray(data) ? data : []).map(normalizeStaffSummary).filter(Boolean));
    }

    async function listActiveStaff() {
      return listStaff({ isActive: true });
    }

    async function getEffectivePermissions(staffId) {
      if (!canUseSupabase()) return local.permissions.getEffectivePermissions(staffId);
      const staffResult = await getStaffById(staffId);
      if (!staffResult.ok) return staffResult;
      const staff = staffResult.data;
      if (!staff) return defaultResult.ok([]);

      const rolePermsResult = await fetchRolePermissions(staff.roleCode);
      const tempGrantResult = await fetchTempGrants(staff.id);

      const rolePerms = rolePermsResult.ok && rolePermsResult.data.length
        ? rolePermsResult.data.filter((item) => item.allowed !== false)
        : buildDefaultPermissions(staff.roleCode);
      const tempPerms = tempGrantResult.ok
        ? tempGrantResult.data.map((item) => ({ toolCode: item.toolCode, allowed: item.enabled !== false, source: 'temp_grant' }))
        : [];

      const merged = new Map();
      rolePerms.forEach((perm) => {
        if (perm?.toolCode) merged.set(`role:${perm.toolCode}`, perm);
      });
      tempPerms.forEach((perm) => {
        if (perm?.toolCode) merged.set(`temp_grant:${perm.toolCode}`, perm);
      });
      return defaultResult.ok(Array.from(merged.values()));
    }

    async function hasPermission(payload) {
      if (!canUseSupabase()) return local.permissions.hasPermission(payload);
      const permsResult = await getEffectivePermissions(payload?.staffId);
      if (!permsResult.ok) return permsResult;
      return defaultResult.ok(permsResult.data.some((perm) => perm.toolCode === payload?.toolCode && perm.allowed !== false));
    }

    async function listCustomers(filters = {}) {
      if (!canUseSupabase()) return local.customers.listCustomers(filters);
      const rowsResult = await fetchCustomersRows(filters);
      if (!rowsResult.ok) return rowsResult;
      return buildCustomersForUi(rowsResult.data || []);
    }

    async function searchCustomers(query) {
      if (!canUseSupabase()) return local.customers.searchCustomers(query);
      return listCustomers({ search: query || '' });
    }

    async function getCustomerById(customerId) {
      if (!canUseSupabase()) return local.customers.getCustomerById(customerId);
      const rowsResult = await fetchCustomersRows({ customerId });
      if (!rowsResult.ok) return rowsResult;
      const built = await buildCustomersForUi((rowsResult.data || []).slice(0, 1));
      if (!built.ok) return built;
      return defaultResult.ok(built.data[0] || null);
    }

    async function getCustomerByAccountNumber(accountNumber) {
      if (!canUseSupabase()) return local.customers.getCustomerByAccountNumber(accountNumber);
      const rowsResult = await fetchCustomersRows({ accountNumber });
      if (!rowsResult.ok) return rowsResult;
      const built = await buildCustomersForUi((rowsResult.data || []).slice(0, 1));
      if (!built.ok) return built;
      return defaultResult.ok(built.data[0] || null);
    }

    async function getAccountByNumber(accountNumber) {
      if (!canUseSupabase()) return local.accounts.getAccountByNumber(accountNumber);
      const customerResult = await getCustomerByAccountNumber(accountNumber);
      if (!customerResult.ok) return customerResult;
      return defaultResult.ok(customerResult.data ? customerToAccountSummary(customerResult.data) : null);
    }

    async function getAccountSummary(accountId) {
      if (!canUseSupabase()) return local.accounts.getAccountSummary(accountId);
      let accountResult = await fetchAccountBySelector({ id: accountId });
      if (!accountResult.ok) return accountResult;
      let customer = null;
      let accountRow = accountResult.data;
      if (accountRow?.customer_id) {
        const customerResult = await getCustomerById(accountRow.customer_id);
        if (!customerResult.ok) return customerResult;
        customer = customerResult.data;
      }
      if (!customer) {
        const customerResult = await getCustomerById(accountId);
        if (!customerResult.ok) return customerResult;
        customer = customerResult.data;
      }
      if (!customer && accountRow?.account_number) {
        const customerResult = await getCustomerByAccountNumber(accountRow.account_number);
        if (!customerResult.ok) return customerResult;
        customer = customerResult.data;
      }
      if (!customer) return defaultResult.ok(null);
      const summary = customerToAccountSummary(customer);
      if (summary && accountRow?.id) summary.accountId = accountRow.id;
      if (summary && accountRow?.status) summary.status = accountRow.status;
      const balanceResult = await fetchBalancesByAccountIds([summary?.accountId]);
      if (summary && balanceResult.ok && balanceResult.data[0] && balanceResult.data[0].book_balance != null) {
        summary.bookBalance = Number(balanceResult.data[0].book_balance || 0);
      }
      return defaultResult.ok(summary);
    }

    async function getAccountStatement(payload = {}) {
      if (!canUseSupabase()) return local.accounts.getAccountStatement(payload);
      const txResult = await fetchTransactionsByAccountId(payload.accountId);
      if (!txResult.ok) return txResult;
      const fromDate = payload.fromDate ? new Date(payload.fromDate).getTime() : null;
      const toDate = payload.toDate ? new Date(payload.toDate).getTime() : null;
      let entries = (txResult.data || []).map((row) => normalizeStatementEntry({
        id: row.id,
        type: row.tx_type,
        amount: row.amount,
        details: row.details,
        effective_at: row.effective_at || row.created_at,
        created_at: row.created_at,
        balance_after: row.balance_after,
      })).filter(Boolean).filter((entry) => {
        const time = new Date(entry.date).getTime();
        if (fromDate && time < fromDate) return false;
        if (toDate && time > toDate + 86399999) return false;
        return true;
      }).sort((a, b) => new Date(b.date) - new Date(a.date));
      if (payload.limit && payload.limit > 0) entries = entries.slice(0, payload.limit);
      return defaultResult.ok(entries);
    }

    async function buildSessionFromSupabaseAuthSession(authSession) {
      if (!authSession?.user) return defaultResult.ok(null);

      const currentStaffResult = await getCurrentStaff();
      if (!currentStaffResult.ok) return currentStaffResult;
      const currentStaff = currentStaffResult.data;
      if (!currentStaff) return defaultResult.ok(null);

      const permissionsResult = await getEffectivePermissions(currentStaff.id);
      if (!permissionsResult.ok) return permissionsResult;

      return defaultResult.ok(
        normalizeStaffSession(
          authSession.access_token,
          authSession.expires_at ? new Date(authSession.expires_at * 1000).toISOString() : undefined,
          currentStaff,
          permissionsResult.data
        )
      );
    }

    async function resolveAuthEmailByStaffId(staffId) {
      const staffResult = await getStaffProfileBySelector({ staff_code: staffId });
      if (!staffResult.ok) return staffResult;

      const row = staffResult.data;
      const email = row.auth_email || (staffEmailMode === 'synthetic_suffix' ? `${row.staff_code}${syntheticEmailSuffix}` : null);
      if (!email) return defaultResult.err('AUTH_EMAIL_NOT_FOUND', 'Auth email could not be resolved for this Staff ID.');
      return defaultResult.ok({ email, staffRow: row });
    }

    async function loginWithStaffId(payload) {
      if (!canUseSupabase()) return local.auth.loginWithStaffId(payload);
      if (!payload?.staffId || !payload?.password) {
        return defaultResult.err('AUTH_INPUT_REQUIRED', 'Staff ID and password are required.');
      }

      const emailResult = await resolveAuthEmailByStaffId(payload.staffId);
      if (!emailResult.ok) return emailResult;

      const signInResult = await client.auth.signInWithPassword({
        email: emailResult.data.email,
        password: payload.password,
      });

      if (signInResult.error) {
        return defaultResult.err('AUTH_LOGIN_FAILED', signInResult.error.message || 'Unable to sign in with Supabase.', signInResult.error);
      }

      const authSession = signInResult.data?.session;
      return buildSessionFromSupabaseAuthSession(authSession);
    }

    async function logout() {
      if (!canUseSupabase()) return local.auth.logout();
      const { error: signOutError } = await client.auth.signOut();
      if (signOutError) return defaultResult.err('AUTH_LOGOUT_FAILED', signOutError.message || 'Unable to sign out.', signOutError);
      return defaultResult.ok({ success: true });
    }

    async function getSession() {
      if (!canUseSupabase()) return local.auth.getSession();
      const { data, error: sessionError } = await client.auth.getSession();
      if (sessionError) return defaultResult.err('AUTH_SESSION_FAILED', sessionError.message || 'Unable to fetch current session.', sessionError);
      return buildSessionFromSupabaseAuthSession(data?.session || null);
    }

    async function getCurrentStaffContext() {
      const sessionResult = await getSession();
      if (!sessionResult.ok) return sessionResult;
      return defaultResult.ok({
        businessDate: (local.appState.loadState() || {}).businessDate,
        activeStaffId: sessionResult.data?.staff?.id || '',
        session: sessionResult.data || null,
      });
    }

    return {
      ...local,
      auth: {
        loginWithStaffId,
        logout,
        getSession,
        getCurrentStaffContext,
      },
      staff: {
        getCurrentStaff,
        getStaffById,
        listStaff,
        listActiveStaff,
      },
      permissions: {
        getEffectivePermissions,
        hasPermission,
        listTempGrants,
        createTempGrant: (...args) => local.permissions.createTempGrant(...args),
        revokeTempGrant: (...args) => local.permissions.revokeTempGrant(...args),
      },
      customers: {
        listCustomers,
        searchCustomers,
        getCustomerById,
        getCustomerByAccountNumber,
        submitAccountOpening,
        submitAccountMaintenance,
        submitAccountReactivation,
      },
      accounts: {
        getAccountByNumber,
        getAccountSummary,
        getAccountStatement,
        submitCredit,
        submitDebit,
        submitJournalEntries,
      },
      approvals: {
        listApprovalRequests,
        getApprovalRequestById,
        submitApprovalRequest,
        approveRequest,
        rejectRequest,
      },
      cod: {
        getCodPreview,
        submitCod,
        listCodSubmissions,
        getCodSubmissionById,
        resolveCod,
        listDebts,
        getDebtById,
        submitDebtRepayment,
      },
      __meta: {
        adapter: 'supabase',
        phase: '3E',
        usesLocalBehavior: true,
        authProvider: 'supabase',
        staffProvider: 'supabase',
        permissionsProvider: 'supabase',
        customersProvider: 'supabase',
        accountsReadProvider: 'supabase',
        accountWritesProvider: 'backend_approval_queue',
        approvalsProvider: 'supabase',
        authoritativePostingProvider: approvalPostingRpc ? 'supabase_rpc' : 'supabase_safe_mutation',
      },
      __supabase: {
        client: client || null,
        configured: !!client,
      },
      __realtime: {
        subscribe: subscribeRealtime,
      }
    };
  }
  function createGateway(options = {}) {
  const config = mergeConfig(options);
  return createSupabaseAdapter(config);
}

  global.DucessGateway = {
    createGateway,
    createLocalAdapter,
    createSupabaseAdapter,
  };
})(window);


