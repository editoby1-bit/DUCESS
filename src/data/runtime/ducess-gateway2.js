(function (global) {
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
        getCodPreview: () => notYet('cod.getCodPreview'),
        submitCod: () => notYet('cod.submitCod'),
        listCodSubmissions: () => notYet('cod.listCodSubmissions'),
        getCodSubmissionById: () => notYet('cod.getCodSubmissionById'),
        resolveCod: () => notYet('cod.resolveCod'),
        listDebts: () => notYet('cod.listDebts'),
        getDebtById: () => notYet('cod.getDebtById'),
        submitDebtRepayment: () => notYet('cod.submitDebtRepayment'),
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
        submitAccountOpening: (...args) => local.customers.submitAccountOpening(...args),
        submitAccountMaintenance: (...args) => local.customers.submitAccountMaintenance(...args),
        submitAccountReactivation: (...args) => local.customers.submitAccountReactivation(...args),
      },
      accounts: {
        getAccountByNumber,
        getAccountSummary,
        getAccountStatement,
        submitCredit: (...args) => local.accounts.submitCredit(...args),
        submitDebit: (...args) => local.accounts.submitDebit(...args),
        submitJournalEntries: (...args) => local.accounts.submitJournalEntries(...args),
      },
      __meta: {
        adapter: 'supabase',
        phase: '3C.1',
        usesLocalBehavior: true,
        authProvider: 'supabase',
        staffProvider: 'supabase',
        permissionsProvider: 'supabase',
        customersProvider: 'supabase',
        accountsReadProvider: 'supabase',
        accountWritesProvider: 'local',
      },
      __supabase: {
        client: client || null,
        configured: !!client,
      }
    };
  }
  function createGateway(options = {}) {
    const config = mergeConfig(options);
    const adapter = config.useSupabaseBackend || config.activeAdapter === 'supabase' ? 'supabase' : 'local';
    if (adapter === 'supabase') return createSupabaseAdapter(config);
    return createLocalAdapter(config);
  }

  global.DucessGateway = {
    createGateway,
    createLocalAdapter,
    createSupabaseAdapter,
  };
})(window);
