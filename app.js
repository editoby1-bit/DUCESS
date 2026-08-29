(() => {
  const runtimeConfig = window.__DUCESS_CONFIG__ || {};
  const STORAGE_KEY = runtimeConfig.storageKey || 'duces_enterprise_ledger_v1';
  const gateway = window.DucessGateway?.createGateway?.({
    storageKey: STORAGE_KEY,
    useSupabaseBackend: runtimeConfig.useSupabaseBackend === true,
    supabase: runtimeConfig.supabase || {}
  }) || null;
  // Enforced DD/MM/YYYY throughout (2026-08-14): numeric, unambiguous, not
  // dependent on month-name locale rendering.
  const DATE_FMT = new Intl.DateTimeFormat('en-GB', { day:'2-digit', month:'2-digit', year:'numeric' });
  const TIME_FMT = new Intl.DateTimeFormat('en-GB', { hour:'2-digit', minute:'2-digit', hour12:true });
  const THEMES = ['classic','ducess-sheet','ocean','dark-slate','neutral-stone'];
  const THEME_LABELS = { classic:'Classic', 'ducess-sheet':'Ducess Sheet', ocean:'Ocean', 'dark-slate':'Dark Slate', 'neutral-stone':'Neutral Stone' };
  const money = (n) => Number(n || 0).toLocaleString();
  // SURGICAL ADDITION 2026-08-19: amount fields were native type="number",
  // which can never display thousand-separator commas (a browser
  // restriction, not something CSS/JS can override on a number input) — so
  // a value like 500000 was indistinguishable from 50000 at a glance.
  // Converted to formatted text inputs; parseAmountInput() is the ONLY
  // correct way to read a numeric value back out of one (every call site
  // that used to do Number(byId(id).value) on these fields must use this
  // instead, or commas in the typed value would silently parse as NaN).
  function parseAmountInput(id) {
    return Number(String(byId(id)?.value || '').replace(/,/g, '').trim()) || 0;
  }
  function bindAmountCommaFormatting(id) {
    const el = byId(id);
    if (!el || el.dataset.commaFormatted) return;
    el.dataset.commaFormatted = '1';
    el.type = 'text';
    el.inputMode = 'decimal';
    el.addEventListener('input', () => {
      const raw = el.value.replace(/[^\d.]/g, '');
      const firstDot = raw.indexOf('.');
      const intPart = (firstDot === -1 ? raw : raw.slice(0, firstDot)).replace(/^0+(?=\d)/, '');
      const decPart = firstDot === -1 ? '' : '.' + raw.slice(firstDot + 1).replace(/\./g, '').slice(0, 2);
      const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      el.value = formattedInt + decPart;
    });
  }
  const uid = (p='id') => `${p}_${Math.random().toString(36).slice(2,9)}${Date.now().toString(36).slice(-4)}`;
  const today = () => new Date().toISOString().slice(0,10);
  const byId = (id) => document.getElementById(id);
  const q = (sel, root=document) => root.querySelector(sel);
  const qq = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  const escapeHtml = (value) => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const formatFileSize = (bytes) => { const size = Number(bytes || 0); if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`; if (size >= 1024) return `${Math.round(size / 1024)} KB`; return `${size} B`; };
  const isSupportedFieldNoteFile = (file) => !!file && (String(file.type || '').startsWith('image/') || String(file.type || '').toLowerCase() === 'application/pdf' || /\.(pdf|png|jpe?g|gif|webp|bmp)$/i.test(String(file.name || '')));
  const FIELD_NOTE_MAX_BYTES = 2 * 1024 * 1024;
  const CUSTOMER_PHOTO_MAX_BYTES = 1024 * 1024;
  // SURGICAL PATCH 2026-08-22 (Supabase egress overage — see the polling and
  // list-view fixes elsewhere): reduced from 700px/0.55 quality significantly.
  // The actual on-screen display size for these photos is a small thumbnail
  // (~260x110px in Check Balance, similar in the approval review panel), so
  // 480px max side is still comfortably larger than anything the UI ever
  // renders it at, while cutting typical file size roughly 60-65%.
  const COMPRESSED_IMAGE_MAX_SIDE = 480;
  const COMPRESSED_IMAGE_QUALITY = 0.45;
  const estimateDataUrlBytes = (dataUrl) => {
    const value = String(dataUrl || '');
    const base64 = value.includes(',') ? value.split(',')[1] : value;
    return Math.max(0, Math.floor((base64.length * 3) / 4));
  };
  async function fileToDataUrl(file) {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Unable to read selected file'));
      reader.readAsDataURL(file);
    });
  }
  async function compressImageFile(file, options = {}) {
    const maxSide = Number(options.maxSide || COMPRESSED_IMAGE_MAX_SIDE);
    const quality = Number(options.quality || COMPRESSED_IMAGE_QUALITY);
    const fallbackDataUrl = await fileToDataUrl(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Unable to process selected image'));
        el.src = fallbackDataUrl;
      });
      let { width, height } = img;
      const scale = Math.min(1, maxSide / Math.max(width, height, 1));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      return {
        name: String(file.name || 'image').replace(/\.[^.]+$/, '') + '.jpg',
        type: 'image/jpeg',
        size: estimateDataUrlBytes(dataUrl),
        dataUrl
      };
    } catch (error) {
      return {
        name: file.name || 'image',
        type: file.type || '',
        size: Number(file.size || 0),
        dataUrl: fallbackDataUrl
      };
    }
  }
  // SURGICAL ADDITION 2026-08-19: Check Balance's "Field Note (Form)" button
  // shows the CURRENT staff's own field note — today's upload if there is
  // one (checking both credit and debit journals for today), otherwise the
  // most recently uploaded one overall. This is staff/session-level, not
  // tied to whichever customer happens to be pulled up — field notes are
  // attached to a journal submission (which can span several customers),
  // not to any single customer's account.
  function getLatestFieldNoteForStaff(staffId) {
    const attachments = state.ui.staffJournalAttachments || {};
    const today = businessDate();
    let todayMatch = null;
    let latestOverall = null;
    Object.entries(attachments).forEach(([key, val]) => {
      if (!val?.fieldNote) return;
      const [sid, date] = key.split(':');
      if (sid !== staffId) return;
      if (date === today && !todayMatch) todayMatch = val.fieldNote;
      if (!latestOverall || new Date(val.fieldNote.uploadedAt || 0) > new Date(latestOverall.uploadedAt || 0)) latestOverall = val.fieldNote;
    });
    return todayMatch || latestOverall || null;
  }

  async function readFieldNoteFile(file) {
    if (!file) return null;
    if (String(file.type || '').startsWith('image/')) {
      const compressed = await compressImageFile(file);
      return {
        name: compressed.name || 'field-note.jpg',
        type: compressed.type || 'image/jpeg',
        size: Number(compressed.size || 0),
        dataUrl: String(compressed.dataUrl || ''),
        uploadedAt: new Date().toISOString()
      };
    }
    const dataUrl = await fileToDataUrl(file);
    return {
      name: file.name || 'field-note',
      type: file.type || '',
      size: Number(file.size || 0),
      dataUrl,
      uploadedAt: new Date().toISOString()
    };
  }

  const ROLE_LABELS = {
    customer_service: 'Customer Service Officer',
    teller: 'Teller',
    cash_officer: 'Treasury',
    approving_officer: 'Approving Officer',
    admin_officer: 'Administrative Officer',
    report_officer: 'Report Officer'
  };

  const MODULES = {
    customer_service: {
      title: 'Customer Service',
      desc: 'Check balance, open, maintain, reactivate accounts and print statements.',
      icon: '👤',
      tools: ['check_balance','account_opening','account_maintenance','account_reactivation']
    },
    cash_officer: {
      title: 'Treasury',
      desc: 'Non-cash transfers between accounts.',
      icon: '💰',
      tools: ['intra_transfer']
    },
    tellering: {
      title: 'Tellering',
      desc: 'Credit and debit customer accounts from your operational balance.',
      icon: '💳',
      tools: ['check_balance','credit','debit','journal','intra_transfer']
    },
    approvals: {
      title: 'Approval',
      desc: 'Approve or reject submitted requests and review approval history.',
      icon: '✅',
      tools: ['approval_queue','approval_customer_service','approval_tellering','approval_non_cash','approval_others','approval_history']
    },
    administration: {
      title: 'Administration',
      desc: 'Manage working tools, operational postings, temporary grants, staff settings, and central close of day.',
      icon: '🛠️',
      tools: ['central_close_day','operational_posting','operational_accounts','staff_roster','staff_directory','customer_directory','teller_balances','transaction_summary','overall_balance','permissions']
    },
    balances: {
      title: 'Balances',
      desc: 'Review business balance and operational balance with filters and teller summaries.',
      icon: '📊',
      tools: ['business_balance','operational_balance','teller_balances']
    }
  };

  const TOOL_LABELS = {
    check_balance: 'Check Balance',
    account_opening: 'Account Opening',
    account_maintenance: 'Account Maintenance',
    account_reactivation: 'Account Reactivation',
    account_statement: 'Account Statement',
    cash_receipt: 'Cash Receipt',
    staff_credit: 'Credit Staff Account',
    credit: 'Credit',
    debit: 'Debit',
    journal: 'Generate Journal',
    intra_transfer: 'Non Cash',
    my_close_day: 'My Close of Day',
    central_close_day: 'Central Close of Day',
    approval_queue: 'Approval Queue',
    approval_customer_service: 'Customer Service',
    approval_tellering: 'Teller',
    approval_non_cash: 'Non Cash',
    approval_others: 'Others',
    approval_history: 'Approval History',
    permissions: 'Permissions Matrix',
    operational_posting: 'Income & Expense Posting',
    operational_accounts: 'Income & Expense Balance',
    staff_directory: 'Staff Salary Balance',
    staff_roster: 'Staff Directory',
    customer_directory: "All Customers' Balance",
    business_balance: 'Business Balance',
    operational_balance: 'Operational Balance',
    overall_balance: 'Overall Balance',
    teller_balances: 'Teller Balances',
    transaction_summary: 'Transaction Summary'
  };

  const DEFAULT_PERMS = {
    customer_service: ['check_balance','account_opening','account_maintenance','account_reactivation','account_statement'],
    cash_officer: ['intra_transfer'],
    teller: ['check_balance','credit','debit','journal','intra_transfer'],
    approving_officer: ['approval_queue','approval_customer_service','approval_tellering','approval_non_cash','approval_others','approval_history'],
    admin_officer: ['check_balance','account_opening','account_maintenance','account_reactivation','account_statement','cash_receipt','staff_credit','credit','debit','journal','intra_transfer','central_close_day','approval_queue','approval_customer_service','approval_tellering','approval_non_cash','approval_others','approval_history','permissions','operational_accounts','operational_posting','overall_balance','staff_directory','staff_roster','customer_directory','business_balance','operational_balance','teller_balances','my_close_day','transaction_summary'],
    report_officer: ['check_balance','account_statement','business_balance','operational_balance','teller_balances','operational_accounts','staff_directory']
  };

  let realtimeBound = false;
  let realtimeUnsub = null;
  let realtimeRefreshInFlight = false;
  let realtimeRefreshQueued = false;
  let realtimePollingTimer = null;
  const state = bootstrapState();
  state.ui = state.ui || { module: null, tool: null, selectedCustomerId: null, theme: 'classic', businessFilter: { preset: 'daily', from: '', to: '' }, operationalFilter: { preset: 'daily', from: '', to: '' }, approvalsLimit: 20, businessEntriesLimit: 20, operationalEntriesLimit: 20, tellerEntriesLimit: 20, approvalsSection:'tellering', generatedJournals:{}, customerDirectorySearch: '' };
  state.ui.customerDirectorySearch = state.ui.customerDirectorySearch || '';
  if (state.ui.module && !MODULES[state.ui.module]) state.ui.module = null;
  if (state.ui.module && state.ui.tool && !hasPermission(state.ui.tool)) state.ui.tool = null;
  ensureState();
  resetJournalUiState();
  if (isSupabaseApprovalMode()) {
    syncAllSharedStateFromGateway();
    setupRealtimeSubscriptions();
  }

  function bootstrapState() {
    if (gateway?.appState?.bootstrapState) return gateway.appState.bootstrapState(seed);
    const loaded = load();
    return loaded || seed();
  }

  function seed() {
    // In Supabase mode, seed with empty staff/customers — real data comes from Supabase sync.
    // Demo data is only used in local (non-Supabase) mode.
    const isSupabase = typeof gateway !== 'undefined' && gateway?.__meta?.adapter === 'supabase';
    const demoStaff = isSupabase ? [] : [
      { id:'st1', name:'Daniel Johnson', role:'customer_service', active:true },
      { id:'st2', name:'Mary Daniel', role:'teller', active:true },
      { id:'st3', name:'Francis Etta', role:'approving_officer', active:true },
      { id:'st4', name:'Admin Officer', role:'admin_officer', active:true }
    ];
    const demoCustomers = isSupabase ? [] : [
      { id:'c1', accountNumber:'1000', oldAccountNumber:'A-221', name:'Emma Johnson', address:'14 Palm Street', nin:'12345678901', bvn:'2200114422', phone:'08012345678', balance:32000, photo:'', active:true, createdAt:new Date().toISOString(), transactions:[
          txObj('credit', 15000, 'Opening contribution', 'SYSTEM', 'system', null, 'customer', today()),
          txObj('credit', 17000, 'Cash contribution', 'SYSTEM', 'system', null, 'customer', today())
        ] },
      { id:'c2', accountNumber:'1001', oldAccountNumber:'A-222', name:'Uduak Peters', address:'Market Road', nin:'22345678901', bvn:'2200118899', phone:'08022223333', balance:6500, photo:'', active:true, createdAt:new Date().toISOString(), transactions:[
          txObj('credit', 6500, 'Savings credit', 'SYSTEM', 'system', null, 'customer', today())
        ] }
    ];
    const s = {
      staff: demoStaff,
      customers: demoCustomers,
      approvals: [],
      audit: [],
      staffAccounts: {},
      operations: { incomeAccounts: [], expenseAccounts: [], entries: [] },
      cod: [],
      tempGrants: [],
      businessExtras: [],
      businessDate: today(),
      dayClosures: [],
      activeStaffId: 'st4'
    };
    s.operations.incomeAccounts.push({ id:'ia1', name:'Commission', accountNumber:'I1', createdAt:new Date().toISOString() });
    s.operations.incomeAccounts.push({ id:'ia2', name:'Registration Fee', accountNumber:'I2', createdAt:new Date().toISOString() });
    s.operations.incomeAccounts.push({ id:'ia3', name:'Security Fee', accountNumber:'I3', createdAt:new Date().toISOString() });
    s.operations.incomeAccounts.push({ id:'ia4', name:'Passbook Sold', accountNumber:'I4', createdAt:new Date().toISOString() });
    s.operations.expenseAccounts.push({ id:'ea1', name:'Transport Expense', accountNumber:'E1', createdAt:new Date().toISOString() });
    s.staff.forEach(st => ensureStaffAccount(st.id, s));
    s.audit.push({ id: uid('aud'), at: new Date().toISOString(), actorId: 'system', actor: 'System', action: 'seed', details: 'Initial demo data created' });
    return s;
  }

  function txObj(type, amount, details, postedBy, postedById, approvedBy, counterparty, dateISO, extra={}) {
    return {
      id: uid('tx'),
      type,
      amount: Number(amount||0),
      details: details || '',
      postedBy,
      postedById,
      approvedBy,
      counterparty: counterparty || '',
      date: `${dateISO || today()}T12:00:00.000Z`,
      balanceAfter: null,
      ...extra
    };
  }

  function ensureState() {
    state.staff ||= [];
    state.customers ||= [];
    state.approvals ||= [];
    state.audit ||= [];
    state.operations ||= { incomeAccounts: [], expenseAccounts: [], entries: [] };
    state.operations.incomeAccounts ||= [];
    state.operations.expenseAccounts ||= [];
    state.operations.entries ||= [];
    state.cod ||= [];
    state.tempGrants ||= [];
    state.staffAccounts ||= {};
    state.businessExtras ||= [];
    state.dayClosures ||= [];
    if (!state.businessDate) {
      const latest = latestClosedBusinessDay();
      state.businessDate = latest?.date ? (latest.nextBusinessDate || nextDate(latest.date)) : today();
    }
    ensureDefaultIncomeAccounts(state);
    reconcileBusinessDateFromClosures();
    state.staff.forEach(st => { ensureStaffWalletCustomer(st.id); ensureStaffAccount(st.id); });
    normalizeStaffWalletAccounts();
    syncAllStaffWallets();
    recalcAllCustomerBalances();
    recalcAllTellerBalances();
  }

  function load() {
    if (gateway?.appState?.loadState) return gateway.appState.loadState();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function save() {
    if (gateway?.appState?.saveState) {
      gateway.appState.saveState(state);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function currentStaff() {
    return state.staff.find(s => s.id === state.activeStaffId) || state.staff.find(s => s.active !== false) || state.staff[0] || null;
  }

  function getStaffBackendId(staff = currentStaff()) {
    if (!staff) return '';
    return staff.uuid || staff.authUserId || staff.auth_user_id || staff.supabaseUserId || staff.supabase_user_id || staff.userId || staff.user_id || staff.backendId || staff.backend_id || staff.id || '';
  }

  function resetJournalUiState() {
    state.ui ||= {};
    state.ui.generatedJournals = {};
    state.ui.collapsedJournals = {};
    state.ui.staffJournals = {};
    state.ui.staffJournalAttachments = {};
    state.ui.selectedJournalCustomerId = null;
  }
  function businessDate() { return state.businessDate || today(); }
  function nextDate(iso) { const d=new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+1); return d.toISOString().slice(0,10); }

  function latestClosedBusinessDay() {
    const closureRows = Array.isArray(state.dayClosures) ? state.dayClosures : [];
    const codRows = Array.isArray(state.cod) ? state.cod : [];
    return [
      ...closureRows.map(row => ({
        date: String(row.date || row.businessDate || '').slice(0,10),
        nextBusinessDate: String(row.nextBusinessDate || '').slice(0,10)
      })),
      ...codRows
        .filter(row => row && row.status !== 'draft')
        .map(row => {
          const date = String(row.date || row.businessDate || '').slice(0,10);
          return { date, nextBusinessDate: date ? nextDate(date) : '' };
        })
    ]
      .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date))
      .sort((a,b) => a.date.localeCompare(b.date))
      .pop() || null;
  }

  function collectKnownBusinessDates() {
    const dates = [];
    const add = (value) => {
      const iso = String(value || '').slice(0,10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) dates.push(iso);
    };
    (state.dayClosures || []).forEach(row => { add(row.date || row.businessDate); add(row.nextBusinessDate); });
    (state.cod || []).forEach(row => add(row.date || row.businessDate));
    (state.approvals || []).forEach(row => add(approvalBusinessDate(row.type || row.requestType, row.payload || {})));
    (state.customers || []).forEach(customer => (customer.transactions || []).forEach(tx => add(tx.date || tx.businessDate || tx.business_date)));
    (state.businessExtras || []).forEach(row => add(row.date || row.businessDate));
    return Array.from(new Set(dates)).sort();
  }

  function reconcileBusinessDateFromClosures() {
    // DUCESS business date is sequential, not real calendar date.
    // Never repair backwards to the computer/calendar date or to an old closure.
    const latest = latestClosedBusinessDay();
    const current = String(state.businessDate || '').slice(0,10);
    let target = current;

    if (latest?.date) {
      const expectedOpenDate = latest.nextBusinessDate || nextDate(latest.date);
      if (!target || target === latest.date || target < expectedOpenDate) {
        target = expectedOpenDate;
      }
    }

    // Recovery guard: if synced approvals/transactions are already on a later
    // DUCESS business date, keep the active date at that later business date.
    // This prevents one device from falling back to an older local date.
    const latestKnownDate = collectKnownBusinessDates().pop();
    if (latestKnownDate) {
      const latestKnownClosed = isBusinessDateClosed(latestKnownDate);
      if (!target || target < latestKnownDate || (latestKnownClosed && target === latestKnownDate)) {
        target = latestKnownClosed ? nextDate(latestKnownDate) : latestKnownDate;
      }
    }

    if (!target) return false;
    if (target !== current) {
      state.businessDate = target;
      return true;
    }
    return false;
  }

  function approvalDisplayDate(approval) {
    const payloadDate = approvalBusinessDate(approval?.type, approval?.payload || {});
    return payloadDate || approval?.requestedAt || approval?.requested_at || '';
  }

  const COD_LOCKED_POSTING_TYPES = ['customer_credit','customer_debit','customer_credit_journal','customer_debit_journal','float_declaration','float_topup','wallet_fund','debt_repayment','operational_entry','close_of_day'];

  function approvalBusinessDate(type, payload = {}) {
    return String(payload?.date || payload?.businessDate || payload?.float_date || businessDate()).slice(0,10);
  }

  function isBusinessDateClosed(dateStr = businessDate()) {
    const target = String(dateStr || '').slice(0,10);
    if (!target) return false;
    // A DUCESS business date is closed if Central COD has closed it locally
    // OR if COD submissions for that date have synced from Supabase.
    // This makes COD Resolution dates authoritative across devices, not just
    // dependent on one browser's local dayClosures array.
    const locallyClosed = (state.dayClosures || []).some(row => String(row.date || row.businessDate || '').slice(0,10) === target);
    const codClosed = (state.cod || []).some(row => String(row.date || row.businessDate || '').slice(0,10) === target && row.status !== 'draft');
    return locallyClosed || codClosed;
  }

  function businessDateClosedMessage(dateStr = businessDate()) {
    return `Business date ${dateStr} is already closed. Posting is locked.`;
  }

  function shouldLockApprovalType(type) {
    return COD_LOCKED_POSTING_TYPES.includes(type);
  }


  function codRemainingBalance(formAmount, totalCredits, totalDebits) {
    return Number(formAmount || 0) - Number(totalCredits || 0) - Number(totalDebits || 0);
  }

  function buildCodDailySnapshot(dateStr, postingStaff = []) {
    const rows = postingStaff.map(st => {
      const formAmount = getStaffOperationalBalance(st.id);
      const creditCash = approvedCreditTotalForDateByMode(st.id, dateStr, 'cash');
      const creditTransfer = approvedCreditTotalForDateByMode(st.id, dateStr, 'transfer');
      const debitCash = approvedDebitTotalForDateByMode(st.id, dateStr, 'cash');
      const debitTransfer = approvedDebitTotalForDateByMode(st.id, dateStr, 'transfer');
      const totalCredits = creditCash + creditTransfer;
      const totalDebits = debitCash + debitTransfer;
      const netBookBalance = totalCredits - totalDebits;
      const remainingBalance = codRemainingBalance(formAmount, totalCredits, totalDebits);
      const variance = Math.abs(remainingBalance);
      const debt = Number(ensureStaffAccount(st.id)?.debtBalance || 0);
      return { staffId: st.id, staffName: st.name, formAmount, creditCash, creditTransfer, debitCash, debitTransfer, totalCredits, totalDebits, netBookBalance, remainingBalance, variance, debt };
    });
    return {
      rows,
      totalForm: rows.reduce((sum,row)=>sum+Number(row.formAmount||0),0),
      totalCredits: rows.reduce((sum,row)=>sum+Number(row.totalCredits||0),0),
      totalDebits: rows.reduce((sum,row)=>sum+Number(row.totalDebits||0),0),
      totalNetBookBalance: rows.reduce((sum,row)=>sum+Number(row.netBookBalance||0),0),
      totalRemainingBalance: rows.reduce((sum,row)=>sum+Number(row.remainingBalance||0),0),
      totalVariance: rows.reduce((sum,row)=>sum+Number(row.variance||0),0),
      totalDebt: rows.reduce((sum,row)=>sum+Number(row.debt||0),0)
    };
  }

  function carryForwardForms(fromDate, toDate, postingStaff = []) {
    // Disabled: each business day requires a fresh FORM declaration.
    // COD resolution handles previous day reconciliation.
    // No automatic carry-forward of remaining balance.
  }

  function finalizeBusinessDay(dateStr, postingStaff = []) {
    reconcileBusinessDateFromClosures();
    const closedDate = String(dateStr || businessDate()).slice(0,10);
    if (isBusinessDateClosed(closedDate)) return false;
    const nextOpenDate = nextDate(closedDate);
    const snapshot = buildCodDailySnapshot(closedDate, postingStaff);
    state.dayClosures.push({
      id: uid('dayclose'),
      date: closedDate,
      businessDate: closedDate,
      nextBusinessDate: nextOpenDate,
      closedAt: new Date().toISOString(),
      closedBy: currentStaff()?.name || '',
      closedById: currentStaff()?.id || '',
      snapshot
    });
    carryForwardForms(closedDate, nextOpenDate, postingStaff);
    state.businessDate = nextOpenDate;
    return true;
  }
  function staffById(id){ return state.staff.find(s=>s.id===id) || null; }
  function customerName(id){ return state.customers.find(c=>c.id===id)?.name || ''; }
  function getStaffWalletCustomer(staffId){ const acc=ensureStaffAccount(staffId); return state.customers.find(c=>c.id===acc.linkedCustomerId) || null; }
  function ensureStaffWalletCustomer(staffId, sourceState=state){
    const st=(sourceState.staff||[]).find(x=>x.id===staffId); if(!st) return null;
    sourceState.customers ||= [];
    const existing=sourceState.customers.find(c=>c.staffId===staffId && c.accountType==='staff_wallet');
    if(existing){ if(existing.name!==st.name) existing.name=st.name; return existing; }
    // Use a deterministic id derived from staffId so re-creation after Supabase sync
    // always produces the same id — preventing stale selectedJournalCustomerId references.
    const stableId = `swc-${staffId}`;
    const idx=(sourceState.staff||[]).findIndex(x=>x.id===staffId);
    const c={ id: stableId, accountNumber: `${4000 + Math.max(0,idx)}`, oldAccountNumber:'', name: st.name, address:'', nin:'', bvn:'', phone:'', photo:'', active:true, createdAt:new Date().toISOString(), transactions:[], staffId, accountType:'staff_wallet'};
    sourceState.customers.push(c); return c;
  }
  function syncStaffWallet(staffId){ const acc=ensureStaffAccount(staffId); const c=getStaffWalletCustomer(staffId); if(c){ acc.walletBalance=Number(c.balance||0); } }
  function syncAllStaffWallets(){ Object.keys(state.staffAccounts||{}).forEach(syncStaffWallet); }
  function normalizeStaffWalletAccounts(){
    (state.staff||[]).forEach((st, idx) => {
      const wallet = ensureStaffWalletCustomer(st.id);
      const acctNo = String(4000 + idx);
      if (wallet) wallet.accountNumber = acctNo;
      const acc = ensureStaffAccount(st.id);
      acc.accountNumber = acctNo;
      acc.linkedCustomerId = wallet?.id || acc.linkedCustomerId || null;
    });
  }
  function isAdminStaff(staff=currentStaff()) {
    const role = String(staff?.role || staff?.roleCode || '').trim().toLowerCase();
    const label = String(staff?.roleLabel || staff?.title || '').trim().toLowerCase();
    return role === 'admin_officer' || role === 'admin' || label.includes('admin');
  }
  function canCloseBusinessDay(staff=currentStaff()){ return !!staff && (isAdminStaff(staff) || ['approving_officer'].includes(staff.role)); }

  function ensureStaffAccount(staffId, sourceState=state) {
    sourceState.staffAccounts ||= {};
    const st=(sourceState.staff||[]).find(x=>x.id===staffId);
    if (!sourceState.staffAccounts[staffId]) {
      const wallet = ensureStaffWalletCustomer(staffId, sourceState);
      sourceState.staffAccounts[staffId] = {
        staffId,
        accountNumber: wallet?.accountNumber || `${4000000 + Object.keys(sourceState.staffAccounts).length + 1}`,
        linkedCustomerId: wallet?.id || null,
        entries: [],
        balance: 0,
        walletBalance: wallet?.balance || 0,
        debtBalance: 0
      };
    }
    const acc = sourceState.staffAccounts[staffId];
    if (!acc.linkedCustomerId) acc.linkedCustomerId = ensureStaffWalletCustomer(staffId, sourceState)?.id || null;
    if (typeof acc.walletBalance !== 'number') acc.walletBalance = 0;
    if (typeof acc.debtBalance !== 'number') acc.debtBalance = 0;
    return acc;
  }

  function auditEntry(actor, action, details) {
    return { id: uid('aud'), at: new Date().toISOString(), actorId: currentStaff()?.id || 'system', actor, action, details };
  }

  function pushAudit(action, details) {
    const st = currentStaff();
    state.audit.unshift(auditEntry(st?.name || 'System', action, details));
    save();
  }

  const CHARGE_DEFS = [
    { key: 'commission', label: 'Commission', accountName: 'Commission' },
    { key: 'registrationFee', label: 'Registration Fee', accountName: 'Registration Fee' },
    { key: 'securityFee', label: 'Security Fee', accountName: 'Security Fee' },
    { key: 'passbookSold', label: 'Passbook Sold', accountName: 'Passbook Sold' }
  ];

  function ensureDefaultIncomeAccounts(targetState=state) {
    targetState.operations ||= { incomeAccounts: [], expenseAccounts: [], entries: [] };
    targetState.operations.incomeAccounts ||= [];
    const map = {
      'Commission': 'I1',
      'Registration Fee': 'I2',
      'Security Fee': 'I3',
      'Passbook Sold': 'I4'
    };
    Object.entries(map).forEach(([name, accountNumber], idx) => {
      if (!targetState.operations.incomeAccounts.some(a => String(a.name || '').trim().toLowerCase() === name.toLowerCase())) {
        targetState.operations.incomeAccounts.push({ id: `ia_auto_${idx+1}`, name, accountNumber, createdAt: new Date().toISOString() });
      }
    });
  }

  function getIncomeAccountByName(name) {
    const accounts = state.operations?.incomeAccounts || [];
    return accounts.find(a => String(a.name || '').trim().toLowerCase() === String(name || '').trim().toLowerCase()) || accounts[0] || null;
  }

  function getCommissionIncomeAccount() {
    return getIncomeAccountByName('Commission');
  }

  function normalizeChargeAmount(totalAmount, chargeAmount) {
    const total = Number(totalAmount || 0);
    const amount = Number(chargeAmount || 0);
    if (!(total > 0) || !(amount > 0)) return 0;
    return Math.min(total, Math.max(0, amount));
  }

  function normalizeChargePayload(totalAmount, payload={}) {
    const total = Number(totalAmount || payload?.amount || 0);
    if (!(total > 0)) return [];
    const sourceRows = Array.isArray(payload?.chargeBreakdown) ? payload.chargeBreakdown : null;
    let rows = sourceRows ? sourceRows.map(row => {
      const def = CHARGE_DEFS.find(d => d.key === row.key || d.label === row.label || d.accountName === row.accountName) || {};
      return {
        key: row.key || def.key || '',
        label: row.label || def.label || row.accountName || '',
        accountName: row.accountName || def.accountName || row.label || '',
        amount: normalizeChargeAmount(total, row.amount)
      };
    }) : CHARGE_DEFS.map(def => ({
      key: def.key,
      label: def.label,
      accountName: def.accountName,
      amount: normalizeChargeAmount(total, payload?.[def.key])
    }));
    if (!sourceRows && !rows.some(r => r.key === 'commission') && Number(payload?.commissionAmount || 0) > 0) {
      rows.unshift({ key: 'commission', label: 'Commission', accountName: 'Commission', amount: normalizeChargeAmount(total, payload.commissionAmount) });
    }
    let remaining = total;
    rows = rows.map(row => {
      const amount = Math.min(remaining, normalizeChargeAmount(total, row.amount));
      remaining = Math.max(0, remaining - amount);
      return { ...row, amount };
    }).filter(row => row.amount > 0 && row.label);
    return rows;
  }

  function getTotalChargeAmount(payload) {
    const total = Number(payload?.amount || 0);
    return normalizeChargePayload(total, payload).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  }

  function getCustomerCreditAmount(payload) {
    const total = Number(payload?.amount || 0);
    const totalCharges = getTotalChargeAmount(payload);
    const explicit = Number(payload?.customerCreditAmount || 0);
    if (!(totalCharges > 0)) return total;
    return Math.max(0, explicit > 0 ? explicit : total - totalCharges);
  }

  function chargeSummaryText(payload) {
    const total = Number(payload?.amount || 0);
    const rows = normalizeChargePayload(total, payload);
    if (!rows.length) return '';
    const pieces = rows.map(row => `${row.label} ${money(row.amount)}`).join(' • ');
    const customerGets = getCustomerCreditAmount(payload);
    return ` • ${pieces} • To Customer Account ${money(customerGets)}`;
  }

  function commissionSummaryText(payload) {
    return chargeSummaryText(payload);
  }

  function chargeInlineMeta(payload) {
    const total = Number(payload?.amount || 0);
    const rows = normalizeChargePayload(total, payload);
    if (!rows.length) return '';
    return `${rows.map(row => `To ${row.label} ${money(row.amount)}`).join(' • ')} • To Customer Account ${money(getCustomerCreditAmount(payload))}`;
  }


  function cleanOperationalNote(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw
      .replace(/\s*•\s*Trace\s+[A-Za-z0-9_-]+/gi, '')
      .replace(/\s*Trace\s+[A-Za-z0-9_-]+/gi, '')
      .replace(/\s*•\s*$/g, '')
      .trim();
  }

  function hasPermission(tool, staff=currentStaff()) {
    if (!staff) return false;
    if (['check_balance','account_statement','operational_accounts','my_close_day'].includes(tool)) return true;
    const base = DEFAULT_PERMS[staff.role] || [];
    const grantOn = state.tempGrants.some(g => g.staffId === staff.id && g.tool === tool && g.enabled);
    return base.includes(tool) || grantOn;
  }

  function moduleAllowed(moduleKey, staff=currentStaff()) {
    if (moduleKey === 'administration' && staff?.role !== 'admin_officer') return false;
    return MODULES[moduleKey].tools.some(t => hasPermission(t, staff));
  }

  function showToast(msg) {
    const el = byId('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => el.classList.add('hidden'), 2800);
  }

  function openModal(title, bodyHtml, actions=[]) {
    byId('modalTitle').textContent = title;
    const modalEl = document.querySelector('#modalBack .modal');
    if (modalEl) modalEl.setAttribute('data-modal-title', title);
    byId('modalBody').innerHTML = bodyHtml;
    const box = byId('modalActions');
    box.innerHTML = '';
    actions.forEach(a => {
      const btn = document.createElement('button');
      btn.textContent = a.label;
      btn.className = a.className || '';
      btn.onclick = a.onClick;
      box.appendChild(btn);
    });
    byId('modalBack').classList.remove('hidden');
    overlayDateInputsWithDDMMYYYY(byId('modalBody') || document);
  }
  function closeModal() {
    byId('modalBack').classList.add('hidden');
    const modalEl = document.querySelector('#modalBack .modal');
    if (modalEl) modalEl.removeAttribute('data-modal-title');
    const toggleTool = state.ui?.modalToggleTool;
    if (toggleTool && state.ui.tool === toggleTool) {
      state.ui.tool = null;
      state.ui.modalToggleTool = null;
      save();
      renderWorkspace();
      return;
    }
    state.ui.modalToggleTool = null;
  }

  function fmtDate(iso) {
    const raw = String(iso || '');
    // Keep DUCESS business dates as plain business dates.
    // Parsing YYYY-MM-DD with new Date() can shift one day in some browser timezones.
    const plainDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const d = plainDate ? new Date(Number(plainDate[1]), Number(plainDate[2]) - 1, Number(plainDate[3]), 12, 0, 0) : new Date(raw);
    return isNaN(d) ? iso : DATE_FMT.format(d);
  }

  // SURGICAL PATCH 2026-08-13: audit entries are already stored with a full
  // timestamp (auditEntry() sets `at: new Date().toISOString()`), but the
  // Audit Trail table rendered them through fmtDate(), which only formats the
  // day — the time of occurrence was silently dropped. This is used only for
  // the Audit Trail column; fmtDate() itself is untouched everywhere else
  // since business/transaction dates are correctly date-only.
  function fmtDateTime(iso) {
    const raw = String(iso || '');
    const d = new Date(raw);
    if (isNaN(d)) return iso;
    return `${DATE_FMT.format(d)}, ${TIME_FMT.format(d)}`;
  }

  function recalcCustomerBalance(customer) {
    let bal = 0;
    (customer.transactions || []).sort((a,b)=>new Date(a.date)-new Date(b.date)).forEach(tx => {
      if (tx.type === 'credit') bal += Number(tx.amount || 0);
      if (tx.type === 'debit') bal -= Number(tx.amount || 0);
      tx.balanceAfter = bal;
    });
    customer.balance = bal;
  }

  function recalcAllCustomerBalances() {
    state.customers.forEach(recalcCustomerBalance);
    save();
  }

  function recalcStaffBalance(staffId) {
    const acc = ensureStaffAccount(staffId);
    let bal = 0;
    acc.entries.sort((a,b)=>new Date(a.date)-new Date(b.date)).forEach(e => {
      bal += Number(e.delta || 0);
      e.balanceAfter = bal;
    });
    acc.balance = bal;
  }
  function recalcAllTellerBalances() { Object.keys(state.staffAccounts).forEach(recalcStaffBalance); syncAllStaffWallets(); save(); }

  function addStaffEntry(staffId, type, amount, delta, note, extra={}) {
    const acc = ensureStaffAccount(staffId);
    acc.entries.push({
      id: uid('se'),
      type,
      amount: Number(amount || 0),
      delta: Number(delta || 0),
      note: note || '',
      date: new Date().toISOString(),
      postedBy: currentStaff()?.name || 'System',
      ...extra
    });
    recalcStaffBalance(staffId);
  }

  function getCustomerByAccountNo(accountNumber) {
    const key = String(accountNumber || '').trim();
    const customer = state.customers.find(c => String(c.accountNumber || '') === key);
    if (customer) return customer;
    const staff = (state.staff || []).find(st => {
      const acc = ensureStaffAccount(st.id);
      return String(acc.accountNumber || '') === key || String(st.staffCode || st.staff_code || '') === key || String(st.id || '') === key;
    });
    if (!staff) return null;
    const acc = ensureStaffAccount(staff.id);
    return {
      id: staff.id,
      customerId: staff.id,
      staffId: staff.id,
      staffUuid: getStaffBackendId(staff),
      accountNumber: acc.accountNumber || key,
      name: staff.name || staff.full_name || staff.id,
      balance: Number(acc.balance || 0),
      active: staff.active !== false && staff.is_active !== false,
      accountType: 'staff'
    };
  }

  function searchCustomersByName(term) {
    const q = String(term || '').trim().toLowerCase();
    if (!q) return [];
    return state.customers.filter(c => c.name.toLowerCase().includes(q) || c.accountNumber.includes(q));
  }

  function isSupabaseApprovalMode() { return gateway?.__meta?.adapter === 'supabase' && gateway?.approvals; }

  async function syncApprovalsFromGateway(filters = {}) {
    if (!isSupabaseApprovalMode() || !gateway.approvals?.listApprovalRequests) return defaultResultOk(state.approvals || []);
    const result = await gateway.approvals.listApprovalRequests(filters);
    if (result?.ok && Array.isArray(result.data)) {
      state.approvals = result.data;
      syncStaffBusinessEffectsFromApprovedRequests();
      syncOperationalEffectsFromApprovedRequests();
      reconcileBusinessDateFromClosures();
      save();
    }
    return result;
  }

  function resolveStaffWalletForBusinessPayload(payload = {}) {
    const accountNumber = String(payload.accountNumber || '').trim();
    const staffId = String(payload.staffAccountId || payload.staffId || payload.customerId || '').trim();
    let wallet = null;
    if (staffId) {
      wallet = state.customers.find(c => c.accountType === 'staff_wallet' && (c.staffId === staffId || c.id === staffId));
      if (!wallet && (state.staff || []).some(st => st.id === staffId)) wallet = ensureStaffWalletCustomer(staffId);
    }
    if (!wallet && accountNumber) wallet = state.customers.find(c => c.accountType === 'staff_wallet' && String(c.accountNumber || '') === accountNumber);
    if (!wallet && accountNumber) wallet = getCustomerByAccountNo(accountNumber);
    return wallet && (wallet.accountType === 'staff_wallet' || wallet.accountType === 'staff') ? wallet : null;
  }

  function applyApprovedStaffBusinessEntry(req, entryPayload = {}, txType = 'credit', rowKey = '') {
    if (!req || req.status !== 'approved') return;
    const payload = entryPayload || {};
    if (!(payload.accountType === 'staff' || payload.accountType === 'staff_wallet')) return;
    const wallet = resolveStaffWalletForBusinessPayload(payload);
    if (!wallet) return;
    wallet.transactions ||= [];
    const sourceApprovalId = req.id || payload.sourceApprovalId || '';
    const sourceRowKey = String(rowKey || payload.sourceRowKey || payload.accountNumber || payload.customerId || 'direct');
    if (sourceApprovalId && wallet.transactions.some(tx => tx.sourceApprovalId === sourceApprovalId && tx.sourceRowKey === sourceRowKey && tx.type === txType)) return;
    const grossAmount = Number(payload.amount || 0);
    if (!(grossAmount > 0)) return;
    const chargeBreakdown = txType === 'credit' ? normalizeChargePayload(grossAmount, payload) : [];
    const totalCharges = chargeBreakdown.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const postedAmount = txType === 'credit' ? getCustomerCreditAmount({ ...payload, chargeBreakdown }) : grossAmount;
    const baseDetails = String(payload.details || '').trim();
    const detailTag = txType === 'credit' && totalCharges > 0 ? `${baseDetails ? ' • ' : ''}${chargeInlineMeta({ amount: grossAmount, chargeBreakdown, customerCreditAmount: postedAmount })}` : '';
    wallet.transactions.push(txObj(txType, postedAmount, `${baseDetails}${detailTag}`.trim(), req.requestedByName || staffName(req.requestedBy) || 'System', req.requestedBy || '', req.approvedBy || req.approvedByName || '', 'staff_wallet', payload.date || payload.businessDate || businessDate(), {
      receivedOrPaidBy: payload.receivedOrPaidBy || '',
      paymentMode: payload.paymentMode || payload.payoutSource || '',
      postedBy: req.requestedByName || staffName(req.requestedBy) || 'System',
      approvedBy: req.approvedBy || req.approvedByName || '',
      sourceAmount: grossAmount,
      chargeBreakdown,
      totalChargeAmount: totalCharges,
      customerCreditAmount: postedAmount,
      sourceApprovalId,
      sourceRowKey,
      accountType: 'staff_wallet'
    }));
    recalcCustomerBalance(wallet);
    const acc = ensureStaffAccount(wallet.staffId);
    if (acc) acc.walletBalance = Number(wallet.balance || 0);
  }

  function syncStaffBusinessEffectsFromApprovedRequests() {
    normalizeStaffWalletAccounts();
    (state.approvals || []).forEach(req => {
      if (!req || req.status !== 'approved') return;
      const p = req.payload || {};
      if (req.type === 'customer_credit' || req.type === 'customer_debit') {
        const txType = req.type === 'customer_debit' ? 'debit' : 'credit';
        applyApprovedStaffBusinessEntry(req, p, txType, 'direct');
      }
      if (req.type === 'customer_credit_journal' || req.type === 'customer_debit_journal') {
        const txType = req.type === 'customer_debit_journal' ? 'debit' : 'credit';
        (Array.isArray(p.rows) ? p.rows : []).forEach((row, index) => applyApprovedStaffBusinessEntry(req, { ...row, date: row.date || p.date || p.businessDate }, txType, row.id || `${index}:${row.accountNumber || row.customerId || ''}`));
      }
    });
    syncAllStaffWallets();
  }

  function syncOperationalEffectsFromApprovedRequests() {
    state.operations ||= { incomeAccounts: [], expenseAccounts: [], entries: [] };
    state.operations.incomeAccounts ||= [];
    state.operations.expenseAccounts ||= [];
    state.operations.entries ||= [];
    const addChargeOperationalEntries = (req, entries) => {
      (entries || []).forEach((entry, entryIndex) => {
        const grossAmount = Number(entry?.amount || 0);
        const chargeBreakdown = normalizeChargePayload(grossAmount, entry);
        if (!chargeBreakdown.length) return;
        const customerAccount = entry?.accountNumber || entry?.customerName || 'customer';
        const traceId = entry?.chargeTraceId || entry?.commissionTraceId || `${req.id || 'approval'}_${entryIndex}`;
        chargeBreakdown.forEach((chargeRow, chargeIndex) => {
          const incomeAccount = getIncomeAccountByName(chargeRow.accountName || chargeRow.label);
          const sourceChargeKey = `${req.id || 'approval'}:${entry?.id || entryIndex}:${chargeRow.key || chargeRow.label || chargeIndex}:${Number(chargeRow.amount || 0)}`;
          if (state.operations.entries.some(e => e.sourceChargeKey === sourceChargeKey)) return;
          state.operations.entries.unshift({
            id: uid('op'),
            kind: 'income',
            accountId: incomeAccount?.id || chargeRow.key || '',
            accountName: incomeAccount?.name || chargeRow.accountName || chargeRow.label || 'Charge Income',
            amount: Number(chargeRow.amount || 0),
            note: cleanOperationalNote(`${chargeRow.label || 'Charge'} from ${customerAccount}`),
            date: `${entry?.date || req.payload?.date || req.payload?.businessDate || today()}T12:00:00.000Z`,
            postedBy: req.requestedByName || staffName(req.requestedBy) || 'System',
            approvedBy: req.approvedBy || req.approvedByName || '',
            traceId,
            sourceTransactionType: req.type,
            sourceApprovalId: req.id,
            sourceChargeKey
          });
        });
      });
    };
    (state.approvals || []).forEach(req => {
      if (!req || req.status !== 'approved') return;
      const p = req.payload || {};
      if (req.type === 'operational_entry') {
        if (state.operations.entries.some(e => e.sourceApprovalId === req.id)) return;
        const amount = Number(p.amount || 0);
        const accountId = String(p.accountId || '').trim();
        if (!accountId || !(amount > 0)) return;
        const account = [...state.operations.incomeAccounts, ...state.operations.expenseAccounts]
          .find(a => String(a.id || '') === accountId);
        if (!account) return;
        const kind = state.operations.incomeAccounts.some(a => String(a.id || '') === accountId) ? 'income' : 'expense';
        state.operations.entries.unshift({
          id: uid('op'),
          kind,
          accountId,
          accountName: p.accountName || account.name,
          amount,
          note: p.note || '',
          date: `${p.date || today()}T12:00:00.000Z`,
          postedBy: req.requestedByName || staffName(req.requestedBy) || 'System',
          approvedBy: req.approvedBy || req.approvedByName || '',
          sourceApprovalId: req.id
        });
      }
      if (req.type === 'customer_credit') addChargeOperationalEntries(req, [p]);
      if (req.type === 'customer_credit_journal') addChargeOperationalEntries(req, Array.isArray(p.rows) ? p.rows : Array.isArray(p.entries) ? p.entries : []);
      if (req.type === 'create_operational_account') {
        const dest = p.category === 'income' ? state.operations.incomeAccounts : state.operations.expenseAccounts;
        if (!Array.isArray(dest)) return;
        const exists = dest.some(a => a.sourceApprovalId === req.id || (String(a.accountNumber || '') === String(p.accountNumber || '') && String(a.name || '').toLowerCase() === String(p.name || '').toLowerCase()));
        if (!exists) dest.push({ id: uid('oa'), name: p.name, accountNumber: p.accountNumber, createdAt: req.approvedAt || new Date().toISOString(), sourceApprovalId: req.id });
      }
    });
  }




  async function syncCodFromGateway(filters = {}) {
    if (!isSupabaseApprovalMode() || !gateway.cod?.listCodSubmissions) return defaultResultOk(state.cod || []);
    const result = await gateway.cod.listCodSubmissions(filters);
    if (result?.ok && Array.isArray(result.data)) {
      const existing = new Map((state.cod || []).map(item => [item.id, item]));
      result.data.forEach(item => {
        const prev = existing.get(item.id) || {};
        const merged = Object.assign({}, prev, item, {
          staffName: staffName(item.staffId) || item.staffName || item.staffId
        });
        // Preserve locally-stored per-mode breakdown fields not stored in Supabase
        ['totalCreditCash','totalCreditTransfer','totalDebitCash','totalDebitTransfer','formAmount'].forEach(key => {
          if (merged[key] == null || merged[key] === 0) {
            if (prev[key] != null && prev[key] !== 0) merged[key] = prev[key];
          }
        });
        existing.set(item.id, merged);
      });
      state.cod = Array.from(existing.values()).sort((a,b)=>new Date(b.submittedAt||b.resolvedAt||b.date)-new Date(a.submittedAt||a.resolvedAt||a.date));
      reconcileBusinessDateFromClosures();
      save();
    }
    return result;
  }

  async function syncDebtBalancesFromGateway(staffId) {
    if (!isSupabaseApprovalMode() || !gateway.cod?.listDebts) return defaultResultOk(null);
    const result = await gateway.cod.listDebts(staffId ? { staffId } : {});
    if (result?.ok && Array.isArray(result.data)) {
      const grouped = {};
      result.data.forEach(d => {
        grouped[d.staffId] = (grouped[d.staffId] || 0) + Number(d.amount || 0);
      });
      (state.staff || []).forEach(st => {
        const acc = ensureStaffAccount(st.id);
        acc.debtBalance = Number(grouped[st.id] || 0);
      });
      save();
    }
    return result;
  }

  async function syncStaffFromGateway(filters = {}) {
    if (!isSupabaseApprovalMode() || !gateway.staff?.listStaff) return defaultResultOk(state.staff || []);
    const result = await gateway.staff.listStaff(filters);
    if (result?.ok && Array.isArray(result.data) && result.data.length) {
      // In Supabase mode, staff is the authoritative source — replace local state entirely.
      // Do NOT merge with seed staff (st1/st2/st3/st4) — those are demo-only.
      const supabaseIds = new Set(result.data.map(item => item.id));
      const preserveLocal = (state.staff || []).filter(st =>
        // Keep local staff only if they came from Supabase (have a UUID-like id)
        // and are not in the result (may be inactive/filtered). Drop seed staff (st1 etc).
        supabaseIds.has(st.id) || (st.uuid && st.uuid !== st.id && !st.id.startsWith('st'))
      );
      const existing = new Map(preserveLocal.map(st => [st.id, st]));
      result.data.forEach(item => {
        existing.set(item.id, Object.assign({}, existing.get(item.id) || {}, {
          id: item.id,
          name: item.fullName || item.name || item.staffId || '',
          role: item.roleCode || item.role || 'customer_service',
          active: item.isActive !== false,
          staffId: item.staffId || item.staff_code || '',
          branchId: item.branchId || null,
          uuid: item.uuid || item.id || '',
          authUserId: item.authUserId || item.auth_user_id || '',
          auth_user_id: item.authUserId || item.auth_user_id || '',
        }));
      });
      state.staff = Array.from(existing.values());
      normalizeStaffWalletAccounts();
      syncAllStaffWallets();
      save();
    }
    return result;
  }

  async function syncCustomersListFromGateway(filters = {}) {
    if (!isSupabaseApprovalMode() || !gateway.customers?.listCustomers) return defaultResultOk(state.customers || []);
    const result = await gateway.customers.listCustomers(filters);
    if (result?.ok && Array.isArray(result.data)) {
      // Replace customers entirely from Supabase — drop seed customers (c1, c2 etc)
      const incoming = result.data.map(normalizeGatewayCustomerForState).filter(Boolean);
      // Preserve any locally-created staff_wallet customers (they're not in Supabase)
      const staffWallets = (state.customers || []).filter(c => c.accountType === 'staff_wallet');
      state.customers = incoming;
      // Re-add staff wallets that aren't already in incoming
      const incomingIds = new Set(incoming.map(c => c.id));
      staffWallets.forEach(w => { if (!incomingIds.has(w.id)) state.customers.push(w); });
      normalizeStaffWalletAccounts();
      syncAllStaffWallets();
      recalcAllCustomerBalances();
      recalcAllTellerBalances();
      save();
    }
    return result;
  }

  async function syncAuditFromGateway(filters = {}) {
    if (!isSupabaseApprovalMode() || !gateway.audit?.listAuditLog) {
      return;
    }
    const result = await gateway.audit.listAuditLog(filters);
    if (result?.ok && Array.isArray(result.data)) {
      state.audit = result.data;
      save();
    }
  }

  async function syncAllSharedStateFromGateway() {
    await syncStaffFromGateway();
    await syncCustomersListFromGateway();
    await syncApprovalsFromGateway();
    await syncCodFromGateway();
    await syncDebtBalancesFromGateway();
    safeRender();
  }

  async function refreshRealtimeState(reason = 'realtime') {
    if (!isSupabaseApprovalMode()) return defaultResultOk(false);
    if (realtimeRefreshInFlight) {
      realtimeRefreshQueued = true;
      return defaultResultOk('queued');
    }
    realtimeRefreshInFlight = true;
    try {
      await syncStaffFromGateway();
      await syncCustomersListFromGateway();
      await syncApprovalsFromGateway();
      await syncCodFromGateway();
      await syncDebtBalancesFromGateway();
      await syncAuditFromGateway();
      state.__lastRealtimeRefresh = { reason, at: new Date().toISOString() };
      save();
      safeRender();
      return defaultResultOk(true);
    } finally {
      realtimeRefreshInFlight = false;
      if (realtimeRefreshQueued) {
        realtimeRefreshQueued = false;
        setTimeout(() => refreshRealtimeState('queued').catch(err => console.warn('[DUCESS realtime sync failed]', err)), 80);
      }
    }
  }

  function debounce(fn, wait = 200) {
    let t;
    return function(...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function debounceAsync(fn, wait = 250) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args).catch(err => console.warn('[DUCESS realtime sync failed]', err)), wait);
    };
  }

  function setupRealtimeSubscriptions() {
    if (!isSupabaseApprovalMode() || !gateway.__realtime?.subscribe || realtimeBound) return;
    const refreshApprovals = debounceAsync(async () => { await syncApprovalsFromGateway(); scheduleRender(); }, 120);
    const refreshCod = debounceAsync(async () => { await syncCodFromGateway(); await syncDebtBalancesFromGateway(); scheduleRender(); }, 120);
    const refreshBalances = debounceAsync(async (payload) => {
      const row = payload?.new || payload?.old || {};
      if (row.customer_id) await syncCustomerFromGateway({ customerId: row.customer_id });
      else if (row.account_id && gateway.accounts?.getAccountSummary) {
        const acct = await gateway.accounts.getAccountSummary(row.account_id);
        if (acct?.ok && acct.data?.accountNumber) await syncCustomerFromGateway({ accountNumber: acct.data.accountNumber });
        else await syncCustomersListFromGateway();
      } else {
        await syncCustomersListFromGateway();
      }
      await syncCodFromGateway();
      await syncDebtBalancesFromGateway();
      safeRender();
    }, 120);
    const refreshCustomers = debounceAsync(async () => { await syncCustomersListFromGateway(); scheduleRender(); }, 160);
    const refreshStaff = debounceAsync(async () => { await syncStaffFromGateway(); scheduleRender(); }, 160);
    const refreshAll = debounceAsync(async () => { await refreshRealtimeState('realtime-event'); }, 220);
    realtimeUnsub = gateway.__realtime.subscribe({
      approval: refreshApprovals,
      cod: refreshCod,
      debt: refreshCod,
      balance: refreshBalances,
      customer: refreshCustomers,
      staff: refreshStaff,
      onEvent: refreshAll,
      onStatus: (status) => { state.__realtimeStatus = status; save(); }
    });
    window.addEventListener('focus', () => refreshRealtimeState('window-focus').catch(err => console.warn('[DUCESS realtime sync failed]', err)));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshRealtimeState('visibility-return').catch(err => console.warn('[DUCESS realtime sync failed]', err));
    });
    // SURGICAL FIX 2026-08-22 (Supabase egress overage — org hit 141% of
    // free-tier quota, grace period ends Sep 20 2026): this was labeled a
    // "fallback" but ran completely unconditionally — every 8 seconds, on
    // every open tab, regardless of whether the realtime websocket
    // subscription above was already connected and delivering updates live.
    // state.__realtimeStatus IS already tracked (via onStatus above) but was
    // never actually checked here. Each tick runs 6 full-table queries
    // (refreshRealtimeState), so an 8-hour shift with one tab open was
    // ~450 ticks/hour x 6 queries — the single largest contributor to the
    // overage. Now: (1) only polls when realtime is NOT confirmed connected
    // — a true fallback, not a duplicate channel; (2) interval stretched
    // from 8s to 45s, since its only job is catching a dropped/missed
    // realtime event, not driving routine updates.
    //
    // ROBUSTNESS ADDITION (same date, deeper pass): onStatus only reflects
    // the websocket CHANNEL connecting — it does NOT confirm Postgres
    // replication is actually delivering row-change events for these
    // tables (that depends on the tables being added to the
    // supabase_realtime publication, a separate DB-level config). If that
    // publication were ever missing/misconfigured, the channel could
    // legitimately report 'SUBSCRIBED' while zero events ever arrive —
    // and with the gate above alone, that would silently suppress polling
    // forever, leaving the UI permanently stale with NO fallback, which is
    // worse than the original bug. So the gate now also force-polls if
    // it's been more than STALE_DATA_MS since the last successful refresh
    // of ANY kind (poll, realtime event, or focus/visibility trigger — all
    // already update state.__lastRealtimeRefresh), regardless of what the
    // channel status claims. This makes the poll self-healing: cheap when
    // realtime genuinely works, but never silently stuck if it doesn't.
    const STALE_DATA_MS = 90000;
    if (!realtimePollingTimer) {
      realtimePollingTimer = setInterval(() => {
        const lastAt = state.__lastRealtimeRefresh?.at ? new Date(state.__lastRealtimeRefresh.at).getTime() : 0;
        const isStale = (Date.now() - lastAt) > STALE_DATA_MS;
        if (!document.hidden && (state.__realtimeStatus !== 'SUBSCRIBED' || isStale)) {
          refreshRealtimeState('polling-fallback').catch(err => console.warn('[DUCESS realtime polling failed]', err));
        }
      }, 45000);
    }
    realtimeBound = true;
  }

  function normalizeGatewayCustomerForState(customer) {
    if (!customer) return null;
    return {
      id: customer.id,
      accountNumber: String(customer.accountNumber || ''),
      oldAccountNumber: customer.oldAccountNumber || '',
      name: customer.name || customer.fullName || '',
      address: customer.address || '',
      nin: customer.nin || '',
      bvn: customer.bvn || '',
      phone: customer.phone || '',
      balance: Number(customer.balance ?? customer.bookBalance ?? 0),
      photo: customer.photo || '',
      active: typeof customer.active === 'boolean' ? customer.active : String(customer.status || 'active').toLowerCase() === 'active',
      createdAt: customer.createdAt || customer.created_at || new Date().toISOString(),
      transactions: Array.isArray(customer.transactions) ? customer.transactions : [],
      staffId: customer.linkedStaffId || customer.staffId || null,
      accountType: customer.accountType || 'customer'
    };
  }

  async function syncCustomerFromGateway(ref = {}) {
    if (!isSupabaseApprovalMode() || !gateway.customers) return defaultResultOk(null);
    let result = null;
    if (ref.customerId && gateway.customers.getCustomerById) result = await gateway.customers.getCustomerById(ref.customerId);
    else if (ref.accountNumber && gateway.customers.getCustomerByAccountNumber) result = await gateway.customers.getCustomerByAccountNumber(ref.accountNumber);
    if (!result?.ok || !result.data) return result || defaultResultOk(null);
    const normalized = normalizeGatewayCustomerForState(result.data);
    if (!normalized) return defaultResultOk(null);
    const idx = state.customers.findIndex(c => c.id === normalized.id || c.accountNumber === normalized.accountNumber);
    if (idx >= 0) state.customers[idx] = { ...state.customers[idx], ...normalized };
    else state.customers.unshift(normalized);
    save();
    return defaultResultOk(normalized);
  }

  async function syncApprovalEffectsFromGateway(approvalRecord) {
  if (!approvalRecord?.type) return defaultResultOk(null);

  // Enrich approvalRecord.payload from local state when the gateway returns a
  // minimal record (e.g. after RPC approval). This ensures accountType is present.
  const localApproval = (state.approvals || []).find(r => r.id === approvalRecord.id);
  const enrichedPayload = Object.assign({}, localApproval?.payload || {}, approvalRecord.payload || {});

  if (approvalRecord.type === 'account_opening') {
    return syncCustomersListFromGateway();
  }

  if (approvalRecord.type === 'customer_credit' || approvalRecord.type === 'customer_debit') {
    if (enrichedPayload.accountType === 'staff' || enrichedPayload.accountType === 'staff_wallet') {
      // Staff wallet balances are maintained locally only. Apply the request directly
      // so the local balance updates — in Supabase mode applyRequest is not called
      // from approveRequestRemote, so without this the staff wallet never gets the transaction.
      const localReq = (state.approvals || []).find(r => r.id === approvalRecord.id);
      if (localReq) {
        localReq.status = 'approved';
        applyRequest(localReq);
      }
      return defaultResultOk(null);
    }
    return syncCustomerFromGateway({
      customerId: enrichedPayload.customerId,
      accountNumber: enrichedPayload.accountNumber
    });
  }

  if (approvalRecord.type === 'customer_credit_journal' || approvalRecord.type === 'customer_debit_journal') {
    const rows = Array.isArray(enrichedPayload.rows) ? enrichedPayload.rows : [];
    const hasStaffRow = rows.some(r => r.accountType === 'staff' || r.accountType === 'staff_wallet');
    if (hasStaffRow) {
      // Journal contains staff account rows — apply locally so all balances update.
      const localReq = (state.approvals || []).find(r => r.id === approvalRecord.id);
      if (localReq) {
        localReq.status = 'approved';
        applyRequest(localReq);
      }
      // Also sync any non-staff rows from Supabase
      for (const row of rows) {
        if (row.accountType === 'staff' || row.accountType === 'staff_wallet') continue;
        await syncCustomerFromGateway({ customerId: row.customerId, accountNumber: row.accountNumber });
      }
      return defaultResultOk(true);
    }
    for (const row of rows) {
      await syncCustomerFromGateway({ customerId: row.customerId, accountNumber: row.accountNumber });
    }
    return defaultResultOk(true);
  }

  if (approvalRecord.type === 'float_declaration') {
  syncApprovedFormFromApprovalRecord(approvalRecord);
  await syncCodFromGateway({
    staffId: approvalRecord.payload?.staffId,
    businessDate: approvalRecord.payload?.date
  });
  save();
  return defaultResultOk(true);
}

if (approvalRecord.type === 'float_topup') {
  return defaultResultOk(true);
}

  if (approvalRecord.type === 'wallet_fund' || (approvalRecord.type === 'debt_repayment' && enrichedPayload.source === 'my_balance')) {
    const localReq = (state.approvals || []).find(r => r.id === approvalRecord.id);
    if (localReq) {
      localReq.status = 'approved';
      localReq.approvedBy = approvalRecord.approvedBy || approvalRecord.approvedByName || localReq.approvedBy;
      localReq.approvedAt = approvalRecord.approvedAt || localReq.approvedAt || new Date().toISOString();
      applyRequest(localReq);
      save();
    }
    return defaultResultOk(true);
  }

  if (approvalRecord.type === 'debt_repayment') {
    return syncDebtBalancesFromGateway();
  }

  return defaultResultOk(null);
}

  function activeApprovingOfficers() {
    return (state.staff || []).filter(s => s.role === 'approving_officer' && s.active !== false && s.is_active !== false);
  }

  function promptForApprovingOfficer() {
    const officers = activeApprovingOfficers();
    if (!officers.length) return Promise.resolve(null); // nobody to route to — admin-only fallback, no prompt needed
    return new Promise((resolve) => {
      openModal('Send to Approving Officer', `
        <p style="margin:0 0 10px;font-size:0.85em;color:var(--text-muted)">Choose who should approve this request. Only they — or an Administrative Officer — will be able to act on it.</p>
        <div class="field"><label>Approving Officer <span style="color:red">*</span></label>
          <select id="approverPickerSelect" class="entry-input">
            ${officers.map(o => `<option value="${o.id}">${escapeHtml(o.name || o.full_name || 'Officer')}</option>`).join('')}
          </select>
        </div>
      `, [
        {label:'Cancel', className:'secondary', onClick: () => { closeModal(); resolve(null); }},
        {label:'Send for Approval', onClick: () => {
          const select = byId('approverPickerSelect');
          const officer = officers.find(o => o.id === select?.value);
          closeModal();
          resolve(officer ? { id: officer.id, name: officer.name || officer.full_name || 'Officer' } : null);
        }}
      ]);
    });
  }

  async function submitApprovalThroughGateway(type, payload, meta = {}) {
    reconcileBusinessDateFromClosures();
    const requestDate = approvalBusinessDate(type, payload);
    if (shouldLockApprovalType(type) && isBusinessDateClosed(requestDate)) {
      return defaultResultErr('BUSINESS_DATE_CLOSED', businessDateClosedMessage(requestDate));
    }
    // SURGICAL PATCH 2026-08-12b: promptForApprovingOfficer() opens a modal
    // (.modal-back, z-index 9999) to let the user pick an officer. But every
    // caller shows the global processing overlay (.processing-overlay,
    // z-index 10100) BEFORE calling this function, so the overlay sits on top
    // of the officer-picker modal and silently blocks all clicks on it —
    // the "Send for Approval" button becomes unclickable and the request
    // hangs forever on "Sending request...". Hide the overlay while the
    // picker modal is open, then restore it (with its original label) once
    // an officer has been chosen, before the network call proceeds.
    const _processingOverlayEl = byId('globalProcessingOverlay');
    const _wasProcessingVisible = !!(_processingOverlayEl && !_processingOverlayEl.classList.contains('hidden'));
    const _processingLabelText = _wasProcessingVisible ? (byId('processingText')?.textContent || 'Processing...') : '';
    if (_wasProcessingVisible) hideProcessing();
    const approver = await promptForApprovingOfficer();
    if (_wasProcessingVisible) { showProcessing(_processingLabelText); await nextPaint(); }
    if (activeApprovingOfficers().length && !approver) {
      return defaultResultErr('APPROVER_REQUIRED', 'Choose an approving officer to send this request to.');
    }
    if (approver) {
      payload = { ...payload, assignedApproverId: approver.id, assignedApproverName: approver.name };
    }
    if (!isSupabaseApprovalMode()) return defaultResultOk(createRequest(type, payload, meta));
    const staff = currentStaff();
    let result;
    // SURGICAL PATCH 2026-08-12: the actual network call is made inside this IIFE so
    // it can be raced against a hard deadline via withRequestTimeout — see below.
    try {
      result = await withRequestTimeout((async () => {
        if (type === 'account_opening' && gateway.customers?.submitAccountOpening) {
          return await gateway.customers.submitAccountOpening({
  ...payload,
  fullName: payload.name,
  phone: payload.phone,
  address: payload.address,
  nin: payload.nin,
  bvn: payload.bvn,
  oldAccountNumber: payload.oldAccountNumber || '',
  generatedAccountNumber: payload.generatedAccountNumber || '',
  photo: payload.photo || null,
  photoRef: payload.photo || null,
  openedByStaffId: getStaffBackendId(staff),
  requestedByName: staff?.name || 'System'
});

        } else if (type === 'account_maintenance' && gateway.customers?.submitAccountMaintenance) {
          return await gateway.customers.submitAccountMaintenance({
            customerId: payload.customerId,
            updates: { ...payload.patch },
            requestedByStaffId: getStaffBackendId(staff),
            requestedByName: staff?.name || 'System'
          });
        } else if (type === 'account_reactivation' && gateway.customers?.submitAccountReactivation) {
          return await gateway.customers.submitAccountReactivation({
            customerId: payload.customerId,
            requestedByStaffId: getStaffBackendId(staff),
            note: payload.note || '',
            requestedByName: staff?.name || 'System'
          });
        } else if ((type === 'customer_credit' || type === 'customer_debit') && gateway.accounts && payload.accountType !== 'staff' && payload.accountType !== 'staff_wallet') {
          const fn = type === 'customer_credit' ? gateway.accounts.submitCredit : gateway.accounts.submitDebit;
          return await fn({
            accountId: payload.customerId,
            accountType: payload.accountType || 'customer',
            staffAccountId: payload.staffAccountId || '',
            staffAccountUuid: payload.staffAccountUuid || '',
            amount: Number(payload.amount || 0),
            details: payload.details || '',
            requestedByStaffId: getStaffBackendId(staff),
            businessDate: payload.date,
            requestedByName: staff?.name || 'System',
            customerId: payload.customerId, customerName: payload.customerName, accountNumber: payload.accountNumber, receivedOrPaidBy: payload.receivedOrPaidBy, payoutSource: payload.payoutSource, paymentMode: payload.paymentMode, staffId: payload.staffId, date: payload.date, customerCreditAmount: payload.customerCreditAmount, chargeBreakdown: payload.chargeBreakdown, totalChargeAmount: payload.totalChargeAmount, commissionAmount: payload.commissionAmount, chargeTraceId: payload.chargeTraceId || payload.commissionTraceId, commissionTraceId: payload.commissionTraceId
          });
        } else if ((type === 'customer_credit_journal' || type === 'customer_debit_journal') && gateway.accounts?.submitJournalEntries && !(payload.rows || []).some(row => row.accountType === 'staff' || row.accountType === 'staff_wallet')) {
          return await gateway.accounts.submitJournalEntries({
            entries: (payload.rows || []).map(row => ({ accountId: row.accountType === 'staff' ? (row.staffAccountUuid || row.staffAccountId || row.accountNumber || row.customerId) : row.customerId, accountType: row.accountType || 'customer', staffAccountId: row.staffAccountId || '', staffAccountUuid: row.staffAccountUuid || '', txType: type === 'customer_debit_journal' ? 'debit' : 'credit', amount: Number(row.amount || 0), details: row.details || '', customerId: row.customerId, customerName: row.customerName, accountNumber: row.accountNumber, receivedOrPaidBy: row.receivedOrPaidBy, payoutSource: row.payoutSource, paymentMode: row.paymentMode, customerCreditAmount: row.customerCreditAmount, chargeBreakdown: row.chargeBreakdown, totalChargeAmount: row.totalChargeAmount, commissionAmount: row.commissionAmount, chargeTraceId: row.chargeTraceId || row.commissionTraceId, commissionTraceId: row.commissionTraceId })),
            rows: payload.rows || [],
            requestedByStaffId: getStaffBackendId(staff),
            requestedByName: staff?.name || 'System',
            businessDate: payload.date,
            staffId: payload.staffId,
            date: payload.date,
            openingFloat: payload.openingFloat,
            formAmount: Number(payload.formAmount || 0),
            formPaymentMode: payload.formPaymentMode || 'cash',
            fieldNote: payload.fieldNote || null
          });
        } else if (gateway.approvals?.submitApprovalRequest) {
          return await gateway.approvals.submitApprovalRequest({
            requestType: type,
            requestedByStaffId: getStaffBackendId(staff),
            requestedByName: staff?.name || 'System',
            payload
          });
        }
        return undefined;
      })());
    } catch (requestError) {
      return defaultResultErr('REQUEST_TIMEOUT', requestError?.message || 'Request failed. Please check your connection and try again.');
    }
    if (!result?.ok) return result;
    if (result.data) {
      const exists = (state.approvals || []).some(item => item.id === result.data.id);
      if (!exists) state.approvals.unshift(result.data);
      save();
    }
    // Do not block the teller on a full approvals refresh after submit.
    // The request has already been inserted by Supabase; refresh the queue quietly in the background.
    syncApprovalsFromGateway().catch(error => console.warn('Background approvals refresh failed after submit', error));
    pushAudit('request_created', `${type} by ${staff?.name || 'System'}</div>`);
    return result;
  }

  async function approveRequestRemote(id, payloadOverride = null) {
    const pendingReq = (state.approvals || []).find(r => r.id === id);
    if (pendingReq && shouldLockApprovalType(pendingReq.type)) {
      const reqDate = approvalBusinessDate(pendingReq.type, pendingReq.payload || {});
      if (isBusinessDateClosed(reqDate)) return defaultResultErr('BUSINESS_DATE_CLOSED', businessDateClosedMessage(reqDate));
    }
    if (!isSupabaseApprovalMode()) { approveRequest(id); return defaultResultOk(true); }
    const staff = currentStaff();

    // SURGICAL PATCH 2026-08-12c: same class of bug as submitApprovalThroughGateway
    // — these gateway calls had no timeout, so a stalled or interrupted connection
    // left "Approving request..." spinning forever with no way to recover. Bound
    // the whole remote approve operation with the same hard deadline used for
    // submissions, so a network interruption always resolves into a clear,
    // recoverable error instead of hanging.
    try {
      return await withRequestTimeout((async () => {
        // Detect staff account transactions before calling the gateway.
        // The gateway's approval flow (RPC or direct posting) tries to fetch
        // the account from Supabase customers table — staff accounts don't
        // exist there. Handle staff approvals entirely in local state.
        const pendingPayload = pendingReq?.payload || {};
        const isStaffDirectTx = (pendingReq?.type === 'customer_credit' || pendingReq?.type === 'customer_debit') &&
          (pendingPayload.accountType === 'staff' || pendingPayload.accountType === 'staff_wallet');
        const isStaffJournalTx = (pendingReq?.type === 'customer_credit_journal' || pendingReq?.type === 'customer_debit_journal') &&
          Array.isArray(pendingPayload.rows) && pendingPayload.rows.length > 0 &&
          pendingPayload.rows.some(r => r.accountType === 'staff' || r.accountType === 'staff_wallet');
        const isMyBalanceRequest = pendingReq?.type === 'wallet_fund' ||
          (pendingReq?.type === 'debt_repayment' && pendingPayload.source === 'my_balance');

        if (isStaffDirectTx || isStaffJournalTx || isMyBalanceRequest) {
          // Mark approved in Supabase via a minimal direct update (no posting RPC, no customer/debt-table fetch)
          const markResult = await gateway.approvals.markApprovalApprovedDirect({
            requestId: id,
            approvedByStaffId: getStaffBackendId(staff),
            approvedByName: staff?.name || 'System',
          });
          if (!markResult?.ok) return markResult;
          // Apply locally so balances update
          if (pendingReq) {
            pendingReq.status = 'approved';
            pendingReq.approvedBy = staff?.name || 'System';
            pendingReq.approvedAt = new Date().toISOString();
            applyRequest(pendingReq);
          }
          await syncApprovalsFromGateway();
          syncOperationalEffectsFromApprovedRequests();
          save();
          pushAudit('request_approved', `${pendingReq?.type || 'request'} approved`);
          render();
          return markResult;
        }

        const result = await gateway.approvals.approveRequest({
          requestId: id,
          approvedByStaffId: getStaffBackendId(staff),
          approvedByName: staff?.name || 'System',
          payload: payloadOverride || null
        });
        if (result?.ok) {
          await syncApprovalsFromGateway();
          await syncApprovalEffectsFromGateway(result.data);
          await syncCodFromGateway();
          syncOperationalEffectsFromApprovedRequests();
          save();
          pushAudit('request_approved', `${result.data?.type || 'request'} approved</div>`);
          render();
        }
        return result;
      })());
    } catch (requestError) {
      return defaultResultErr('REQUEST_TIMEOUT', requestError?.message || 'Request failed. Please check your connection and try again.');
    }
  }

  async function rejectRequestRemote(id) {
    if (!isSupabaseApprovalMode()) { rejectRequest(id); return defaultResultOk(true); }
    const staff = currentStaff();
    // SURGICAL PATCH 2026-08-12c: bound with the same hard deadline as approve —
    // see comment above.
    try {
      return await withRequestTimeout((async () => {
        const result = await gateway.approvals.rejectRequest({ requestId: id, rejectedByStaffId: getStaffBackendId(staff), rejectedByName: staff?.name || 'System' });
        if (result?.ok) { await syncApprovalsFromGateway(); pushAudit('request_rejected', `${result.data?.type || 'request'} rejected</div>`); render(); }
        return result;
      })());
    } catch (requestError) {
      return defaultResultErr('REQUEST_TIMEOUT', requestError?.message || 'Request failed. Please check your connection and try again.');
    }
  }

  function defaultResultOk(data) { return { ok: true, data }; }
  function defaultResultErr(code, message) { return { ok: false, error: { code, message } }; }

  // SURGICAL PATCH 2026-08-12: gateway network calls had no timeout, so a stalled
  // connection left the "Sending request..." overlay spinning forever with no
  // feedback and no way out. Races a promise against a hard deadline so a hung
  // request always resolves into a clear, recoverable error instead of hanging.
  const REQUEST_TIMEOUT_MS = 20000;
  function withRequestTimeout(promise, ms = REQUEST_TIMEOUT_MS) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Request timed out — check your connection and try again.')), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  function createRequest(type, payload, meta={}) {
    const staff = currentStaff();
    const req = {
      id: uid('rq'),
      type,
      status: 'pending',
      payload,
      requestedAt: new Date().toISOString(),
      requestedBy: staff?.id || 'system',
      requestedByName: staff?.name || 'System',
      ...meta
    };
    state.approvals.unshift(req);
    pushAudit('request_created', `${type} by ${req.requestedByName}</div>`);
    save();
    return req;
  }



  function approveRequest(id) {
    const req = state.approvals.find(r => r.id === id);
    if (!req || req.status !== 'pending') return;
    if (shouldLockApprovalType(req.type)) {
      const reqDate = approvalBusinessDate(req.type, req.payload || {});
      if (isBusinessDateClosed(reqDate)) return showToast(businessDateClosedMessage(reqDate));
    }
    req.status = 'approved';
    req.approvedAt = new Date().toISOString();
    req.approvedBy = currentStaff()?.name || 'System';
    applyRequest(req);
    pushAudit('request_approved', `${req.type} approved</div>`);
    save();
    render();
  }

  function rejectRequest(id) {
    const req = state.approvals.find(r => r.id === id);
    if (!req || req.status !== 'pending') return;
    req.status = 'rejected';
    req.approvedAt = new Date().toISOString();
    req.approvedBy = currentStaff()?.name || 'System';
    pushAudit('request_rejected', `${req.type} rejected</div>`);
    save();
    render();
  }

  function applyRequest(req) {
    switch (req.type) {
      case 'account_opening': {
        const p = req.payload;
        const assignedAccountNumber = String(p.generatedAccountNumber || '').trim() || nextCustomerAccountNumber();
        p.generatedAccountNumber = assignedAccountNumber;
        state.customers.push({
          id: uid('c'),
          accountNumber: assignedAccountNumber,
          oldAccountNumber: p.oldAccountNumber || '',
          name: p.name,
          address: p.address,
          nin: p.nin,
          bvn: p.bvn,
          phone: p.phone,
          photo: p.photo || '',
          active: true,
          createdAt: new Date().toISOString(),
          transactions: []
        });
        break;
      }
      case 'account_maintenance': {
        const c = state.customers.find(x => x.id === req.payload.customerId);
        if (c) Object.assign(c, req.payload.patch);
        break;
      }
      case 'account_reactivation': {
        const c = state.customers.find(x => x.id === req.payload.customerId);
        if (c) { c.active = true; c.frozen = false; }
        break;
      }
      case 'intra_bank_transfer': {
        // Debit source account
        const src = (state.customers || []).find(c => c.id === req.payload.sourceAccountId || c.accountNumber === req.payload.sourceAccountNumber);
        const dst = (state.customers || []).find(c => c.id === req.payload.destAccountId || c.accountNumber === req.payload.destAccountNumber);
        if (src) {
          const srcAcc = ensureCustomerAccount(src.id);
          srcAcc.balance = (Number(srcAcc.balance) || 0) - Number(req.payload.amount || 0);
        }
        // Credit destination account
        if (dst) {
          const dstAcc = ensureCustomerAccount(dst.id);
          dstAcc.balance = (Number(dstAcc.balance) || 0) + Number(req.payload.amount || 0);
        }
        break;
      }
      case 'cash_receipt': {
        // Credit Cash Officer's own operational account balance — recorded in staff_cash_ledger
        // The frontend getStaffOperationalBalance reads from state.approvals directly,
        // so no separate ledger entry needed in local mode.
        break;
      }
      case 'inter_staff_credit': {
        // Cash Officer credits a Teller's operational account.
        // getStaffOperationalBalance reads from state.approvals directly, so no ledger entry needed in local mode.
        break;
      }
      case 'float_declaration': {
        if (!hasBaseOpeningBalanceForDate(req.payload.staffId, req.payload.date)) {
          addStaffEntry(
            req.payload.staffId,
            'approved_form',
            req.payload.amount,
            req.payload.amount,
            `Approved form for ${req.payload.date}`,
            { formDate: req.payload.date }
          );
        }
        break;
      }
      case 'float_topup': {
        // Legacy — no-op
        break;
      }
      case 'customer_credit': {
        // Resolve customer: for staff accounts, the customerId may be a staffId;
        // find the staff_wallet customer linked to that staff member.
        let c = state.customers.find(x => x.id === req.payload.customerId);
        if (!c && (req.payload.accountType === 'staff' || req.payload.accountType === 'staff_wallet')) {
          // Try finding the staff wallet customer linked to this staff
          c = state.customers.find(x => x.staffId === req.payload.customerId && x.accountType === 'staff_wallet');
          if (!c) c = state.customers.find(x => x.accountNumber === req.payload.accountNumber && x.accountType === 'staff_wallet');
          if (!c) c = state.customers.find(x => x.accountNumber === req.payload.accountNumber);
        }
        if (!c || isCustomerFrozen(c) || c.active === false) break;
        const sourceApprovalId = req.payload.sourceApprovalId || req.id || '';
        const sourceRowKey = String(req.payload.sourceRowKey || 'direct');
        if (sourceApprovalId && (c.transactions || []).some(tx => tx.sourceApprovalId === sourceApprovalId && tx.sourceRowKey === sourceRowKey && tx.type === 'credit')) break;
        const totalAmount = Number(req.payload.amount || 0);
        const chargeBreakdown = normalizeChargePayload(totalAmount, req.payload);
        const totalCharges = chargeBreakdown.reduce((sum, row) => sum + Number(row.amount || 0), 0);
        const customerCreditAmount = getCustomerCreditAmount({ ...req.payload, chargeBreakdown });
        const chargeTraceId = req.payload.chargeTraceId || req.payload.commissionTraceId || uid('ctr');
        const baseDetails = String(req.payload.details || '').trim();
        const chargeDetailTag = totalCharges > 0 ? `${baseDetails ? ' • ' : ''}${chargeInlineMeta({ amount: totalAmount, chargeBreakdown, customerCreditAmount })}` : '';
        c.transactions.push(txObj('credit', customerCreditAmount, `${baseDetails}${chargeDetailTag}`.trim(), req.requestedByName, req.requestedBy, currentStaff()?.name || '', 'customer', req.payload.date, {
          receivedOrPaidBy: req.payload.receivedOrPaidBy,
          paymentMode: req.payload.paymentMode || req.payload.payoutSource || '',
          postedBy: req.requestedByName,
          approvedBy: currentStaff()?.name || '',
          sourceAmount: totalAmount,
          chargeBreakdown,
          totalChargeAmount: totalCharges,
          commissionAmount: chargeBreakdown.find(row => row.key === 'commission')?.amount || 0,
          chargeTraceId,
          commissionTraceId: chargeTraceId,
          customerCreditAmount,
          sourceApprovalId,
          sourceRowKey,
          accountType: c.accountType || 'customer'
        }));
        recalcCustomerBalance(c);
        // Only a genuinely direct posting draws on the daily FORM here — rows
        // dispatched from a journal (sourceRowKey !== 'direct') already get a
        // single lump FORM deduction posted once, in the journal case below.
        if (sourceRowKey === 'direct') {
          addStaffEntry(req.payload.staffId, 'customer_credit', totalAmount, -totalAmount, `Customer credit ${c.accountNumber}`, { customerId: c.id, date: `${req.payload.date}T12:00:00.000Z`, chargeBreakdown, totalChargeAmount: totalCharges, chargeTraceId, customerCreditAmount });
        }
        if (totalCharges > 0) {
          state.operations.entries ||= [];
          state.businessExtras ||= [];
          chargeBreakdown.forEach(row => {
            const incomeAccount = getIncomeAccountByName(row.accountName || row.label);
            state.operations.entries.unshift({
              id: uid('op'),
              kind: 'income',
              accountId: incomeAccount?.id || row.key,
              accountName: incomeAccount?.name || row.accountName || row.label,
              amount: row.amount,
              note: cleanOperationalNote(`${row.label} from ${c.accountNumber}`),
              date: `${req.payload.date}T12:00:00.000Z`,
              postedBy: req.requestedByName,
              approvedBy: currentStaff()?.name || '',
              traceId: chargeTraceId,
              sourceTransactionType: 'customer_credit'
            });
            state.businessExtras.unshift({
              date: `${req.payload.date}T12:00:00.000Z`,
              accountNumber: incomeAccount?.accountNumber || 'I1',
              accountName: incomeAccount?.name || row.accountName || row.label,
              details: cleanOperationalNote(`${row.label} from ${c.accountNumber}`),
              kind: 'credit',
              amount: row.amount,
              balanceAfter: 0,
              receivedOrPaidBy: req.payload.receivedOrPaidBy || '',
              postedBy: currentStaff()?.name || req.requestedByName,
              type: 'charge_credit',
              traceId: chargeTraceId
            });
          });
          pushAudit('charges_applied', `${c.accountNumber} • Amount ${money(totalAmount)} • ${chargeInlineMeta({ amount: totalAmount, chargeBreakdown, customerCreditAmount })} • Trace ${chargeTraceId}`);
        }
        break;
      }
      case 'customer_debit': {
        // Resolve customer: for staff accounts, the customerId may be a staffId
        let c = state.customers.find(x => x.id === req.payload.customerId);
        if (!c && (req.payload.accountType === 'staff' || req.payload.accountType === 'staff_wallet')) {
          c = state.customers.find(x => x.staffId === req.payload.customerId && x.accountType === 'staff_wallet');
          if (!c) c = state.customers.find(x => x.accountNumber === req.payload.accountNumber && x.accountType === 'staff_wallet');
          if (!c) c = state.customers.find(x => x.accountNumber === req.payload.accountNumber);
        }
        if (!c || isCustomerFrozen(c) || c.active === false) break;
        const sourceApprovalId = req.payload.sourceApprovalId || req.id || '';
        const sourceRowKey = String(req.payload.sourceRowKey || 'direct');
        if (sourceApprovalId && (c.transactions || []).some(tx => tx.sourceApprovalId === sourceApprovalId && tx.sourceRowKey === sourceRowKey && tx.type === 'debit')) break;
        c.transactions.push(txObj('debit', req.payload.amount, req.payload.details, req.requestedByName, req.requestedBy, currentStaff()?.name || '', 'customer', req.payload.date, {
          receivedOrPaidBy: req.payload.receivedOrPaidBy,
          paymentMode: req.payload.paymentMode || req.payload.payoutSource || '',
          postedBy: req.requestedByName,
          approvedBy: currentStaff()?.name || '',
          sourceApprovalId,
          sourceRowKey,
          accountType: c.accountType || 'customer'
        }));
        recalcCustomerBalance(c);
        if (sourceRowKey === 'direct' && req.payload.payoutSource === 'teller') {
          addStaffEntry(req.payload.staffId, 'customer_debit', req.payload.amount, req.payload.amount, `Customer debit ${c.accountNumber}`, { customerId: c.id, date: `${req.payload.date}T12:00:00.000Z` });
        }
        break;
      }
      case 'customer_credit_journal': {
        (req.payload.rows || []).forEach((row, index) => applyRequest({
          id: req.id,
          type:'customer_credit',
          payload:{...row, staffId:req.payload.staffId, date:req.payload.date, sourceApprovalId:req.id, sourceRowKey: row.id || `${index}:${row.accountNumber || row.customerId || ''}`},
          requestedByName:req.requestedByName,
          requestedBy:req.requestedBy
        }));
        // The journal's own FORM amount (not its row totals) is what draws down
        // the staff's daily FORM, posted once per journal.
        const journalFormAmount = Number(req.payload.formAmount || 0);
        if (journalFormAmount > 0 && !ensureStaffAccount(req.payload.staffId).entries.some(e => e.sourceApprovalId === req.id && e.type === 'customer_credit_journal')) {
          addStaffEntry(req.payload.staffId, 'customer_credit_journal', journalFormAmount, -journalFormAmount, `Journal form for ${req.payload.date}`, { date: `${req.payload.date}T12:00:00.000Z`, sourceApprovalId: req.id, formPaymentMode: req.payload.formPaymentMode || 'cash' });
        }
        break;
      }
      case 'customer_debit_journal': {
        (req.payload.rows || []).forEach((row, index) => applyRequest({
          id: req.id,
          type:'customer_debit',
          payload:{...row, staffId:req.payload.staffId, date:req.payload.date, sourceApprovalId:req.id, sourceRowKey: row.id || `${index}:${row.accountNumber || row.customerId || ''}`},
          requestedByName:req.requestedByName,
          requestedBy:req.requestedBy
        }));
        const journalFormAmount = Number(req.payload.formAmount || 0);
        if (journalFormAmount > 0 && !ensureStaffAccount(req.payload.staffId).entries.some(e => e.sourceApprovalId === req.id && e.type === 'customer_debit_journal')) {
          addStaffEntry(req.payload.staffId, 'customer_debit_journal', journalFormAmount, -journalFormAmount, `Journal form for ${req.payload.date}`, { date: `${req.payload.date}T12:00:00.000Z`, sourceApprovalId: req.id, formPaymentMode: req.payload.formPaymentMode || 'cash' });
        }
        break;
      }
      case 'operational_entry': {
        const amount = Number(req.payload.amount || 0);
        const accountId = String(req.payload.accountId || '').trim();
        const account = [...state.operations.incomeAccounts, ...state.operations.expenseAccounts]
          .find(a => String(a.id || '') === accountId);
        if (!accountId || !(amount > 0) || !account) break;
        if (state.operations.entries.some(e => e.sourceApprovalId === req.id)) break;
        const kind = state.operations.incomeAccounts.some(a => String(a.id || '') === accountId) ? 'income' : 'expense';
        state.operations.entries.unshift({
          id: uid('op'),
          kind,
          accountId,
          accountName: req.payload.accountName || account.name,
          amount,
          note: req.payload.note,
          date: `${req.payload.date || today()}T12:00:00.000Z`,
          postedBy: req.requestedByName,
          approvedBy: currentStaff()?.name || '',
          sourceApprovalId: req.id
        });
        break;
      }
      case 'create_operational_account': {
        const dest = req.payload.category === 'income' ? state.operations.incomeAccounts : state.operations.expenseAccounts;
        if (!dest.some(a => a.sourceApprovalId === req.id || (String(a.accountNumber || '') === String(req.payload.accountNumber || '') && String(a.name || '').toLowerCase() === String(req.payload.name || '').toLowerCase()))) {
          dest.push({ id: uid('oa'), name: req.payload.name, accountNumber: req.payload.accountNumber, createdAt: new Date().toISOString(), sourceApprovalId: req.id });
        }
        break;
      }
      case 'close_of_day': {
        const variance = Number(req.payload.actualCash||0) - Number(req.payload.expectedCash||0);
        state.cod.unshift({
          id: uid('cod'),
          staffId: req.payload.staffId,
          staffName: req.payload.staffName,
          date: req.payload.date,
          actualCash: req.payload.actualCash,
          expectedCash: req.payload.expectedCash,
          variance,
          overdraw: req.payload.overdraw || 0,
          note: req.payload.note,
          fieldPapers: req.payload.fieldPapers,
          status: variance === 0 && !(req.payload.overdraw>0) ? 'balanced' : 'flagged',
          approvedAt: new Date().toISOString(),
          approvedBy: currentStaff()?.name || ''
        });
        break;
      }
      case 'wallet_fund': {
        const acc = ensureStaffAccount(req.payload.staffId); const wallet=getStaffWalletCustomer(req.payload.staffId);
        if (wallet && !wallet.transactions?.some(tx => tx.sourceApprovalId === req.id && tx.type === 'credit')) {
          wallet.transactions ||= [];
          wallet.transactions.push(txObj('credit', req.payload.amount, req.payload.note || 'Wallet funded', req.requestedByName, req.requestedBy, currentStaff()?.name || '', 'staff_wallet', req.payload.date || businessDate(), { sourceApprovalId: req.id }));
          recalcCustomerBalance(wallet); acc.walletBalance = Number(wallet.balance||0);
          addStaffEntry(req.payload.staffId, 'wallet_fund', req.payload.amount, 0, req.payload.note || 'Wallet funded');
        }
        break;
      }
      case 'debt_repayment': {
        const acc = ensureStaffAccount(req.payload.staffId); const wallet=getStaffWalletCustomer(req.payload.staffId);
        if (wallet && !wallet.transactions?.some(tx => tx.sourceApprovalId === req.id && tx.type === 'debit')) {
          wallet.transactions ||= [];
          wallet.transactions.push(txObj('debit', req.payload.amount, req.payload.note || 'Debt repaid', req.requestedByName, req.requestedBy, currentStaff()?.name || '', 'staff_wallet', req.payload.date || businessDate(), { sourceApprovalId: req.id }));
          recalcCustomerBalance(wallet); acc.walletBalance = Number(wallet.balance||0);
          acc.debtBalance = Math.max(0, Number(acc.debtBalance||0) - Number(req.payload.amount||0));
          addStaffEntry(req.payload.staffId, 'debt_repayment', req.payload.amount, 0, req.payload.note || 'Debt repaid');
          state.businessExtras ||= [];
          if (!state.businessExtras.some(e => e.sourceApprovalId === req.id)) state.businessExtras.unshift({ sourceApprovalId:req.id, date:req.payload.date || businessDate(), accountNumber: acc.accountNumber, details:'Staff debt repayment', kind:'credit', amount:Number(req.payload.amount||0), balanceAfter:0, receivedOrPaidBy: req.requestedByName, postedBy: currentStaff()?.name || req.requestedByName });
        }
        break;
      }
      case 'temp_grant': {
        const existing = state.tempGrants.find(g => g.staffId === req.payload.staffId && g.tool === req.payload.tool);
        if (existing) existing.enabled = req.payload.enabled;
        else state.tempGrants.push({ ...req.payload });
        break;
      }
    }
    recalcAllCustomerBalances();
    recalcAllTellerBalances();
  }

  function nextCustomerAccountNumber(sourceState=state) {
    const nums = (sourceState.customers || [])
      .filter(c => String(c.accountType || 'customer') !== 'staff_wallet')
      .map(c => String(c.accountNumber || '').trim())
      .filter(no => /^1\d+$/.test(no))
      .map(no => Number(no))
      .filter(Boolean);
    return String((nums.length ? Math.max(...nums) : 999) + 1);
  }

  function lookupFill(root, customer) {
    const map = {
      name: customer?.name || '',
      phone: customer?.phone || '',
      balance: customer ? balanceHtml(customer.balance) : '—',
      address: customer?.address || '',
      nin: customer?.nin || '',
      bvn: customer?.bvn || ''
    };
    Object.entries(map).forEach(([k,v]) => {
      const el = q(`[data-fill="${k}"]`, root);
      if (el) { if(k==='balance') el.innerHTML = v || '—'; else el.textContent = v || '—'; }
    });
    const photo = q('[data-fill="photo"]', root);
    if (photo) photo.innerHTML = customer?.photo ? `<img src="${customer.photo}" alt="photo">` : '<span>No Photo</span>';
    const nm = q('[data-fill="name"]', root);
    if (nm && customer && customerStatusLabel(customer) === 'Frozen') nm.innerHTML = `${escapeHtml(customer.name || '')} <span class="badge rejected">Frozen</span>`;
  }

  let _renderScheduled = false;
  // Input fields that must retain focus — a render while these are active
  // would destroy the DOM node and lose the cursor.
  const FOCUS_GUARD_SELECTORS = ['#txAmount', '#txAcc', '#journalAmount', '#journalAcc', '#txDetails', '#txCounterparty', '#journalDetails', '#journalCounterparty', '[data-charge-input]'];
  let _deferredRenderPending = false;

  function isInputFocused() {
    const active = document.activeElement;
    if (!active || active === document.body) return false;
    // SURGICAL PATCH 2026-08-14: this guard only protected a hardcoded
    // handful of transaction/journal field IDs, so a background sync every
    // ~8s (or any realtime event) could wipe focus out of EVERY OTHER field
    // in the app mid-keystroke — account opening, check balance, staff
    // creation, maintenance edits, all of it. Broadened to cover any
    // editable field generically, not just the old whitelist.
    const tag = active.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (active.isContentEditable) return true;
    return FOCUS_GUARD_SELECTORS.some(sel => active.matches && active.matches(sel));
  }

  function scheduleRender() {
    if (_renderScheduled) return;
    // If a protected input has focus, queue a deferred render instead of
    // immediately replacing the DOM. The render fires as soon as the user
    // leaves the field (blur event on the input or its parent).
    if (isInputFocused()) {
      if (_deferredRenderPending) return;
      _deferredRenderPending = true;
      const runDeferred = () => {
        _deferredRenderPending = false;
        if (!isInputFocused()) {
          scheduleRender();
        } else {
          // Still focused — keep waiting
          _deferredRenderPending = true;
          document.activeElement.addEventListener('blur', runDeferred, { once: true });
        }
      };
      document.activeElement.addEventListener('blur', runDeferred, { once: true });
      return;
    }
    _renderScheduled = true;
    requestAnimationFrame(() => { _renderScheduled = false; render(); });
  }

  function safeRender() {
    if (isInputFocused()) scheduleRender();
    else render();
  }

  function render() {
    document.body.classList.remove('home-lock-scroll');
    if (!state.ui.module) document.body.classList.add('home-lock-scroll');
    bindHeader();
    renderHero();
    renderModules();
    renderWorkspace();
  }

  function bindHeader() {
    // Show logged-in staff identity — no dropdown switching after login
    const activeStaff = state.staff.find(s => s.id === state.activeStaffId);
    const nameEl = byId('staffNameDisplay');
    const roleEl = byId('staffRoleDisplay');
    if (nameEl) nameEl.textContent = activeStaff?.name || '';
    if (roleEl) roleEl.textContent = ROLE_LABELS[activeStaff?.role] || activeStaff?.role || '';
    byId('btnCOD').onclick = () => canCloseBusinessDay() ? confirmAction(`Close business date ${businessDate()}? This will open ${nextDate(businessDate())}.`, openCODModal) : showToast('Only Approval Officer or Admin can close day');
    byId('btnCOD').disabled = !canCloseBusinessDay();
    if (byId('btnLogout') && isSupabaseApprovalMode()) {
      byId('btnLogout').onclick = async () => {
        await gateway.auth.logout();
        showLoginScreen();
        byId('loginStaffId').value = '';
        byId('loginPassword').value = '';
        byId('loginError').classList.add('hidden');
      };
    }
    byId('btnAudit').onclick = openAuditModal;
    const themeBtn = byId('btnThemeCycle');
    if (themeBtn) {
      themeBtn.textContent = `◐ ${THEME_LABELS[state.ui.theme || 'classic'] || 'Classic'}`;
      themeBtn.onclick = () => {
        const curr = state.ui.theme || 'classic';
        const idx = THEMES.indexOf(curr);
        const next = THEMES[(idx + 1) % THEMES.length];
        applyTheme(next, true);
        showToast(`Theme: ${THEME_LABELS[next]}`);
      };
    }
    byId('globalNameSearch').oninput = debounce((e) => {
      if (!e.target.value.trim()) return;
      const results = searchCustomersByName(e.target.value);
      openCustomerSearchModal(results);
    }, 200);
    byId('modalClose').onclick = closeModal;
    byId('modalBack').onclick = (e) => { if (e.target === byId('modalBack')) closeModal(); };
  }

  function renderHero() {
    const hero = q('.hero-card');
    if (hero) hero.classList.add('hidden');
  }

  function cardMetric(label, value, hint, action='') {
    return `<div class="summary-card ${action ? 'clickable' : ''}" ${action ? `data-hero-card="${action}"` : ''}><div class="section-label">${label}</div><div class="value">${value}</div><div class="hint">${hint}</div></div>`;
  }

  function setButtonLoading(btn, isLoading, text = 'Processing...') {
  if (!btn) return;
  if (isLoading) {
    btn.dataset.originalText = btn.innerHTML;
    btn.innerHTML = `<span class="spinner"></span> ${text}`;
    btn.disabled = true;
  } else {
    btn.innerHTML = btn.dataset.originalText || btn.innerHTML;
    btn.disabled = false;
  }
}

let _processingCancelTimer = null;
function showProcessing(text = 'Processing...') {
  const overlay = byId('globalProcessingOverlay');
  const label = byId('processingText');
  const cancelBtn = byId('processingCancelBtn');
  if (label) label.textContent = text;
  overlay?.classList.remove('hidden');
  // SURGICAL PATCH 2026-08-12: a request should never trap the user behind an
  // unclosable spinner. The network call itself is time-bounded (see
  // withRequestTimeout), but reveal a manual Cancel button after a few seconds
  // too, so the UI is never the thing blocking someone during a slow connection.
  if (cancelBtn) {
    cancelBtn.classList.add('hidden');
    clearTimeout(_processingCancelTimer);
    _processingCancelTimer = setTimeout(() => cancelBtn.classList.remove('hidden'), 6000);
    cancelBtn.onclick = () => {
      hideProcessing();
      showToast('Cancelled — the request may still complete in the background');
    };
  }
}

function hideProcessing() {
  clearTimeout(_processingCancelTimer);
  byId('globalProcessingOverlay')?.classList.add('hidden');
  byId('processingCancelBtn')?.classList.add('hidden');
}

  function smoothScrollToOpenedSegment(selector) {
    requestAnimationFrame(() => {
      const target = (selector && q(selector)) || q('.workspace-card');
      target?.scrollIntoView({ behavior:'smooth', block:'start' });
    });
  }

  function renderModules() {
    const current = state.ui.module;
    const moduleOrder = ['customer_service','tellering','approvals','administration','cash_officer'];
    byId('moduleGrid').innerHTML = `<div class="module-grid-title">DASHBOARD</div><div class="module-hub"><img src="logo.png" alt="Ducess Enterprises" class="module-hub-logo"></div>` + moduleOrder.map((key) => {
      const m = MODULES[key];
      const allowed = moduleAllowed(key);
      return `<div class="module-card ${current===key?'active':''} ${allowed?'':'disabled'}" data-module="${key}" data-module-key="${key}">
        <div class="module-icon">${m.icon}</div>
        <div class="module-title">${m.title}</div>
      </div>`;
    }).join('');
    qq('.module-card').forEach(card => {
      card.onclick = () => {
        const key = card.dataset.module;
        if (!moduleAllowed(key)) return showToast('No access for this section');
        if (state.ui.module === key) {
          state.ui.module = null;
          state.ui.tool = null;
        } else {
          state.ui.module = key;
          state.ui.tool = null;
        }
        save();
        render();
        if (state.ui.module) smoothScrollToOpenedSegment('.workspace-card');
      };
    });
  }

  function renderWorkspace() {
    const card = q('.workspace-card');
    const module = state.ui.module ? MODULES[state.ui.module] : null;
    if (!module) {
      if (card) card.classList.add('hidden');
      return;
    }
    if (card) card.classList.remove('hidden');
    byId('workspaceLabel').textContent = module.title;
    byId('workspaceTitle').textContent = state.ui.tool ? (TOOL_LABELS[state.ui.tool] || module.title) : `${module.title} Tools`;
    const renderToolButtons = () => {
      if (state.ui.module === 'tellering') {
        const toolBtn = (t) => module.tools.includes(t) ? `<button class="tool-tab ${state.ui.tool===t?'active':''}" data-tool="${t}" ${hasPermission(t)?'':'disabled'}>${TOOL_LABELS[t]}</button>` : '';
        return `<div class="tool-columns tellering-mixed-columns tellering-tools-only">
          <div class="tool-column-title tellering-tools-only-title">Tellering Tools</div>
          ${toolBtn('check_balance')}
          ${toolBtn('credit')}
          ${toolBtn('debit')}
          ${toolBtn('journal')}
          ${toolBtn('intra_transfer')}
        </div>`;
      }
      if (state.ui.module === 'cash_officer') {
        const toolBtn = (t) => module.tools.includes(t) ? `<button class="tool-tab ${state.ui.tool===t?'active':''}" data-tool="${t}" ${hasPermission(t)?'':'disabled'}>${TOOL_LABELS[t]}</button>` : '';
        return `<div class="tool-columns tellering-mixed-columns tellering-tools-only">
          <div class="tool-column-title tellering-tools-only-title">Treasury Tools</div>
          ${toolBtn('intra_transfer')}
        </div>`;
      }
      return module.tools.map(t => `<button class="tool-tab ${state.ui.tool===t?'active':''}" data-tool="${t}" ${hasPermission(t)?'':'disabled'}>${TOOL_LABELS[t]}</button>`).join('');
    };
    const tabs = `<div class="workspace-switcher"><div class="tool-tabs vertical-tool-tabs ${(state.ui.module==='tellering'||state.ui.module==='cash_officer')?'tellering-tool-tabs':''}">${renderToolButtons()}</div><div class="workspace-tool-body">${state.ui.tool ? renderTool(state.ui.tool) : `<div class="tool-empty-state"><div class="tool-empty-title">${module.title}</div><div class="tool-empty-note">Select a heading to open that work area.</div></div>`}</div></div>`;
    byId('workspace').innerHTML = tabs;
    qq('.tool-tab').forEach(btn => btn.onclick = () => {
      const nextTool = btn.dataset.tool;
      if (state.ui.tool === nextTool) {
        state.ui.tool = null;
      } else {
        state.ui.tool = nextTool;
        if (nextTool === 'staff_directory') {
          // Always re-fetch fresh on entry — a newly approved staff_salary
          // account (or a status change) shouldn't be masked by a stale cache.
          state.ui.staffSalaryAccountsCache = null;
        }
        if (nextTool === 'credit' || nextTool === 'debit') {
          state.ui.txAccDraft = '';
          state.ui.txAmountDraft = '';
      state.ui.txDetailsDraft = '';
      state.ui.txCounterpartyDraft = '';
          state.ui.journalAccDraft = '';
          state.ui.selectedCustomerId = null;
          state.ui.selectedJournalCustomerId = null;
          state.ui.generatedJournals ||= {};
          state.ui.collapsedJournals ||= {};
          const st = currentStaff();
          const journalKey = `${st?.id || 'staff'}:${businessDate()}:${nextTool}`;
          state.ui.generatedJournals[journalKey] = false;
          state.ui.collapsedJournals[journalKey] = false;
        }
        if (nextTool === 'approval_customer_service') state.ui.approvalsSection = 'customer_service';
        if (nextTool === 'approval_tellering') state.ui.approvalsSection = 'tellering';
        if (nextTool === 'approval_non_cash') state.ui.approvalsSection = 'non_cash';
        if (nextTool === 'approval_others') state.ui.approvalsSection = 'others';
      }
      if (state.ui.tool === 'check_balance') state.ui.checkBalanceLoaded = false;
      state.ui.modalToggleTool = state.ui.tool && ['my_close_day','central_close_day'].includes(state.ui.tool) ? state.ui.tool : null;
      save();
      renderWorkspace();
      if (nextTool === 'cash_receipt' && state.ui.tool === 'cash_receipt') openCashReceiptModal();
      if (nextTool === 'my_close_day' && state.ui.tool === 'my_close_day') openMyCODModal();
      if (nextTool === 'central_close_day' && state.ui.tool === 'central_close_day') openCODModal();
      if (['my_close_day','central_close_day'].includes(nextTool)) return;
      if (['approval_customer_service','approval_tellering','approval_non_cash','approval_others'].includes(nextTool) && state.ui.tool === nextTool) {
        smoothScrollToOpenedSegment('#approvalsSectionTabs');
        return;
      }
      if (state.ui.tool === nextTool) smoothScrollToOpenedSegment('.workspace-tool-body');
    });
    if (state.ui.tool) bindToolHandlers();
  }

  function renderTool(tool) {
    switch(tool) {
      case 'check_balance': return renderCheckBalance();
      case 'account_opening': return renderAccountOpening();
      case 'account_maintenance': return renderAccountMaintenance();
      case 'account_reactivation': return renderAccountReactivation();
      case 'account_statement': return renderAccountStatement();
      case 'cash_receipt': return `<div class="tool-empty-state"><div class="tool-empty-title">Cash Receipt</div><div class="tool-empty-note">Cash Receipt opens in a modal. Click the heading again to open it.</div></div>`;
      case 'staff_credit': return renderStaffCredit();
      case 'credit': return renderJournalTool('credit');
      case 'debit': return renderJournalTool('debit');
      case 'journal': return renderJournalStandalone();
      case 'intra_transfer': return renderIntraTransfer();
      case 'transaction_summary': return renderTransactionSummary();
      case 'my_close_day': return `<div class="tool-empty-state"><div class="tool-empty-title">My Close of Day</div><div class="tool-empty-note">Close-of-day details open in a modal when this heading is selected.</div></div>`;
      case 'central_close_day': return `<div class="tool-empty-state"><div class="tool-empty-title">Central Close of Day</div><div class="tool-empty-note">Central close-of-day opens in a modal when this heading is selected.</div></div>`;
      case 'approval_customer_service':
      case 'approval_tellering':
      case 'approval_non_cash':
      case 'approval_others':
      case 'approval_queue': return renderApprovals();
      case 'approval_history': return renderApprovalHistory();
      case 'permissions': return renderPermissions();
      case 'operational_posting': return renderOperationalPosting();
      case 'operational_accounts': return renderOperationalAccounts();
      case 'staff_directory': return renderStaffDirectory();
      case 'staff_roster': return renderStaffRoster();
      case 'customer_directory': return renderCustomerDirectory();
      case 'business_balance': return renderBusinessBalance();
      case 'operational_balance': return renderOperationalBalance();
      case 'overall_balance': return renderOverallBalance();
      case 'teller_balances': return renderTellerBalances();
      default: return '<div class="note">Tool not found.</div>';
    }
  }

  function renderCheckBalance() {
    // SURGICAL PATCH 2026-08-14: lookupFill() restores name/phone/balance/
    // photo on every re-render, but never touched this input, and the
    // template had no persisted value either — so any re-render (background
    // poll, tool switch, even the Photo/Statement buttons) silently wiped the
    // account number box back to empty while everything else stayed filled.
    const loadedCustomer = state.ui.checkBalanceLoaded ? getSelectedCustomer() : null;
    const lookupVal = loadedCustomer?.accountNumber || '';
    return `
      <div class="form-card cs2-card check-balance-card">
        <div class="cs2-title">Check Balance</div>
        <div class="cs2-stack">
          <div class="cs2-row">
            <div class="cs2-label">Account Number</div>
            <div class="cs2-input-wrap cs2-short"><input id="lookupAcc" class="entry-input cs2-input" maxlength="12" value="${escapeHtml(lookupVal)}" placeholder="e.g. 1024, T0012, S1"></div>
            <button id="lookupBtn" class="sheet-btn cs2-btn cs2-btn-solid">Search</button>
          </div>
          <div class="cs2-row">
            <div class="cs2-label">Account Name</div>
            <div class="display-field cs2-input cs2-display cs2-wide" data-fill="name">—</div>
          </div>
          <div class="cs2-row">
            <div class="cs2-label">Phone Number</div>
            <div class="display-field cs2-input cs2-display cs2-medium" data-fill="phone">—</div>
          </div>
          <div class="cs2-row">
            <div class="cs2-label">Available Balance</div>
            <div class="display-field cs2-input cs2-display cs2-medium" data-fill="balance">—</div>
          </div>
          <div class="cs2-button-row">
            <button id="searchPhotoBtn" class="sheet-btn cs2-btn cs2-btn-ghost">Photo</button>
            <button id="openStatementBtn" class="sheet-btn cs2-btn cs2-btn-ghost">Statement</button>
            <button id="openFieldNoteBtn" class="sheet-btn cs2-btn cs2-btn-ghost">Field Note (Form)</button>
          </div>
          <div class="sheet-photo-row hidden" id="checkBalancePhotoRow">
            <div class="photo-box inline-photo" data-fill="photo"><span>No Photo</span></div>
          </div>
        </div>
      </div>`;
  }

  function renderAccountOpening() {
    const openingDraft = state.ui.accountOpeningDraft ||= {};
    const acctType = openingDraft.accountType || 'customer';
    const isCustomer = acctType === 'customer';
    const isStaffOp = acctType === 'staff_operational';
    const isStaffSalary = acctType === 'staff_salary';
    const needsStaffLink = isStaffOp; // salary no longer linked to staff
    const isSystemAssigned = acctType !== 'customer';
    const staffOptions = (state.staff || [])
      .filter(s => s.is_active !== false)
      .filter(s => !isStaffOp || s.role === 'teller')
      .map(s =>
      `<option value="${s.id}" ${openingDraft.linkedStaffId === s.id ? 'selected' : ''}>${escapeHtml(s.name || '')} (${ROLE_LABELS[s.role] || s.role})</option>`
    ).join('');
    const systemNote = {
      staff_operational: '"T" + number (T1, T2, T3, ...) — assigned automatically when you submit. Tellers only — the account name is auto-set to TELLER <FULL NAME>.',
      staff_salary:      '"S" + number (S1, S2, S3, ...) — assigned automatically when you submit.',
      expense:           '"E" + number (E1, E2, ...) — assigned automatically when you submit',
      income:            '"I" + number (I1, I2, ...) — assigned automatically when you submit'
    }[acctType] || '';
    return `
      <div class="form-card cs2-card opening-card">
        <div class="cs2-title">Account Opening</div>
        <div class="cs2-stack">
          <div class="cs2-row">
            <div class="cs2-label">Account Type</div>
            <div class="cs2-input-wrap cs2-wide">
              <select id="openAccountType" class="entry-input cs2-input">
                <option value="customer"          ${acctType==='customer'          ?'selected':''}>Customer Account</option>
                <option value="staff_salary"      ${acctType==='staff_salary'      ?'selected':''}>Staff Salary Account</option>
                <option value="expense"           ${acctType==='expense'           ?'selected':''}>Expense Account</option>
                <option value="income"            ${acctType==='income'            ?'selected':''}>Income Account</option>
              </select>
            </div>
          </div>
          <div class="cs2-row">
            <div class="cs2-label">${needsStaffLink ? 'Account Display Name' : 'Account Name'}</div>
            <div class="cs2-input-wrap cs2-wide">
              ${isStaffOp
                ? `<div class="display-field" id="openNameDisplay">${escapeHtml(String(openingDraft.name || 'Select a teller below'))}</div><input type="hidden" id="openName" value="${escapeHtml(String(openingDraft.name || ''))}">`
                : `<input id="openName" class="entry-input cs2-input" value="${escapeHtml(String(openingDraft.name || ''))}" autocomplete="off"
                placeholder="${isStaffSalary ? 'e.g. John Doe Salary' : ''}">`}
            </div>
          </div>
          ${needsStaffLink ? `
          <div class="cs2-row">
            <div class="cs2-label">Link to Staff Member</div>
            <div class="cs2-input-wrap cs2-wide">
              <select id="openLinkedStaff" class="entry-input cs2-input">
                <option value="">— Select Staff Member —</option>
                ${staffOptions}
              </select>
            </div>
          </div>` : ''}
          ${(isCustomer || isStaffSalary) ? `
          ${isCustomer ? `
          <div class="cs2-row">
            <div class="cs2-label">Account Number <span style="font-weight:400;color:var(--muted);font-size:0.85em">(required — assigned by Customer Service)</span></div>
            <div class="cs2-input-wrap cs2-short"><input id="openAccountNumber" class="entry-input cs2-input" maxlength="6" inputmode="numeric" value="${escapeHtml(String(openingDraft.accountNumber || ''))}" autocomplete="off" placeholder="Enter account number"></div>
          </div>` : ''}
          <div class="cs2-row">
            <div class="cs2-label">Address</div>
            <div class="cs2-input-wrap cs2-wide"><input id="openAddress" class="entry-input cs2-input" value="${escapeHtml(String(openingDraft.address || ''))}" autocomplete="off"></div>
          </div>
          <div class="cs2-row">
            <div class="cs2-label">Phone Number</div>
            <div class="cs2-input-wrap cs2-medium"><input id="openPhone" class="entry-input cs2-input digit-11-input" inputmode="numeric" value="${escapeHtml(String(openingDraft.phone || ''))}" autocomplete="off"></div>
          </div>
          <div class="cs2-row">
            <div class="cs2-label">NIN</div>
            <div class="cs2-input-wrap cs2-medium"><input id="openNin" class="entry-input cs2-input digit-11-input" inputmode="numeric" value="${escapeHtml(String(openingDraft.nin || ''))}" autocomplete="off"></div>
          </div>
          <div class="cs2-row">
            <div class="cs2-label">BVN</div>
            <div class="cs2-input-wrap cs2-medium"><input id="openBvn" class="entry-input cs2-input digit-11-input" inputmode="numeric" value="${escapeHtml(String(openingDraft.bvn || ''))}" autocomplete="off"></div>
          </div>
          ${isCustomer ? `
          <div class="cs2-row">
            <div class="cs2-label">Old A/N</div>
            <div class="cs2-input-wrap cs2-short"><input id="openOldAccount" class="entry-input cs2-input" maxlength="4" inputmode="numeric" value="${escapeHtml(String(openingDraft.oldAccountNumber || ''))}" autocomplete="off"></div>
          </div>` : ''}
          <div class="cs2-upload-row">
            <button id="openPhotoBtn" type="button" class="sheet-btn cs2-btn cs2-btn-ghost">Photo Upload</button>
            <input id="openPhoto" class="entry-input cs-sheet-input hidden-photo-input" type="file" accept="image/*">
            <div id="openPhotoStatus" class="cs2-note-box">No photo selected</div>
          </div>
          ${isStaffSalary ? `<div class="cs2-note-box">${systemNote}</div><div class="cs2-note-box" id="openAccountNumberPreview" data-preview-type="${acctType}">Account Number: <strong>Loading…</strong></div>` : ''}` : `<div class="cs2-note-box">${systemNote}</div>${(acctType === 'staff_operational' || acctType === 'expense' || acctType === 'income') ? `<div class="cs2-note-box" id="openAccountNumberPreview" data-preview-type="${acctType}">Account Number: <strong>Loading…</strong></div>` : ''}`}
          <div class="cs2-button-row">
            <button id="submitOpening" class="sheet-btn cs2-btn cs2-btn-solid">Submit for Approval</button>
          </div>
        </div>
      </div>`;
  }

  function renderAccountMaintenance() {
    return maintenanceCommon('maintenance', 'Save');
  }
  function renderAccountReactivation() {
    return maintenanceCommon('reactivation', 'Activate');
  }
  function maintenanceCommon(prefix, btnLabel) {
    const isReactivation = prefix === 'reactivation';
    // SURGICAL REDESIGN 2026-08-14: this form only ever wrote field values
    // directly into the DOM (fillCustomer()), never into state — so once the
    // focus-guard fix defers a render until blur (tabbing to the next field),
    // the very next re-render rebuilds this template from scratch with
    // nothing to rehydrate from, wiping every field mid-edit. Persisted
    // draft added, mirroring the pattern Account Opening already uses.
    const draft = state.ui[`${prefix}Draft`] ||= {};
    const editable = !!draft.editable;
    const readonlyAttr = editable ? '' : 'readonly';
    const readonlyClass = editable ? '' : 'cs-readonly';
    const selected = getSelectedCustomer();
    const displayName = selected?.name || '—';
    const displayPhone = selected?.phone || '—';
    const displayStatus = selected ? customerStatusLabel(selected) : '—';
    return `
      <div class="form-card cs2-card ${isReactivation ? 'reactivation-card' : 'maintenance-card'}">
        <div class="cs2-title">${isReactivation ? 'Account Reactivation' : 'Account Maintenance'}</div>
        <div class="cs2-stack">
          <div class="cs2-row">
            <div class="cs2-label">Account Number</div>
            <div class="cs2-input-wrap cs2-short"><input id="${prefix}Acc" class="entry-input cs2-input" maxlength="12" value="${escapeHtml(draft.accountNumber || '')}"></div>
            <button id="${prefix}Search" class="sheet-btn cs2-btn cs2-btn-solid">Search</button>
          </div>
          <div class="cs2-row">
            <div class="cs2-label">Account Name</div>
            <div class="cs2-input-wrap ${isReactivation ? 'cs2-wide' : 'cs2-name-narrow'}"><input id="${prefix}Name" class="entry-input cs2-input cs-detail-input ${readonlyClass}" ${readonlyAttr} value="${escapeHtml(draft.name || '')}"></div>
          </div>
          ${isReactivation ? '' : `<div class="cs2-row"><div class="cs2-label">Address</div><div class="cs2-input-wrap cs2-name-narrow"><input id="${prefix}Address" class="entry-input cs2-input cs-detail-input ${readonlyClass}" ${readonlyAttr} value="${escapeHtml(draft.address || '')}"></div></div>`}
          ${isReactivation ? '' : `<div class="cs2-row"><div class="cs2-label">Phone Number</div><div class="cs2-input-wrap cs2-medium"><input id="${prefix}Phone" class="entry-input cs2-input cs-detail-input digit-11-input ${readonlyClass}" inputmode="numeric" ${readonlyAttr} value="${escapeHtml(draft.phone || '')}"></div></div>`}
          ${isReactivation ? '' : `<div class="cs2-row"><div class="cs2-label">NIN</div><div class="cs2-input-wrap cs2-medium"><input id="${prefix}Nin" class="entry-input cs2-input cs-detail-input digit-11-input ${readonlyClass}" inputmode="numeric" ${readonlyAttr} value="${escapeHtml(draft.nin || '')}"></div></div>`}
          ${isReactivation ? '' : `<div class="cs2-row"><div class="cs2-label">BVN</div><div class="cs2-input-wrap cs2-medium"><input id="${prefix}Bvn" class="entry-input cs2-input cs-detail-input digit-11-input ${readonlyClass}" inputmode="numeric" ${readonlyAttr} value="${escapeHtml(draft.bvn || '')}"></div></div>`}
          ${isReactivation ? '' : `<div class="cs2-row"><div class="cs2-label">Old A/N</div><div class="cs2-input-wrap cs2-short"><input id="${prefix}OldAccount" class="entry-input cs2-input cs-detail-input ${readonlyClass}" maxlength="4" inputmode="numeric" ${readonlyAttr} value="${escapeHtml(draft.oldAccountNumber || '')}"></div></div>`}
          <div class="cs2-footer">
            <div class="cs2-status">Account Name: <strong id="${prefix}DisplayName">${escapeHtml(displayName)}</strong> &nbsp;&nbsp; Phone Number: <strong id="${prefix}DisplayPhone">${escapeHtml(displayPhone)}</strong> &nbsp;&nbsp; Current Status: <strong id="${prefix}DisplayStatus">${escapeHtml(displayStatus)}</strong></div>
            <div class="cs2-hint">${isReactivation ? 'Search account, confirm details, and submit reactivation.' : 'Search first, update details, then save for approval.'}</div>
          </div>
          <div class="cs2-button-row">
            <button id="${prefix}Edit" class="sheet-btn cs2-btn cs2-btn-ghost">Edit</button>
            <button id="${prefix}Submit" class="sheet-btn cs2-btn ${isReactivation ? 'cs2-btn-solid' : 'cs2-btn-ghost'}">${btnLabel}</button>
          </div>
        </div>
      </div>`;
  }

  // SURGICAL REDESIGN 2026-08-14: three issues fixed together.
  // (1) The generated statement lived ONLY in a throwaway DOM node
  // (byId('statementArea').innerHTML = ...), never in state — so ANY
  // re-render (a background sync fires every ~8s) wiped it instantly. It's
  // now derived from state.ui on every render, same as everything else that
  // behaves correctly in this app.
  // (2) Removed the standalone account-number search — this screen now only
  // ever shows the customer already selected via Check Balance
  // (state.ui.selectedCustomerId), with just date filters.
  // (3) "Print Statement" is no longer a standalone always-visible button —
  // it only appears once a statement has actually been generated, inside
  // the generated statement block itself.
  function renderAccountStatement() {
    const customer = getSelectedCustomer();
    const filter = state.ui.accountStatementFilter ||= { from: '', to: '' };
    const generated = state.ui.accountStatementGenerated && customer;

    let statementHtml = '';
    if (generated) {
      const rows = (customer.transactions || []).filter(tx => {
        const d = tx.date.slice(0,10);
        if (filter.from && d < filter.from) return false;
        if (filter.to && d > filter.to) return false;
        return true;
      }).map((tx, i) => `<tr>
        <td>${i+1}</td>
        <td>${fmtDate(tx.date)}</td>
        <td>${escapeHtml(tx.details || '')}</td>
        <td>${tx.type==='debit'?money(tx.amount):''}</td>
        <td>${tx.type==='credit'?money(tx.amount):''}</td>
        <td>${money(tx.balanceAfter)}</td>
        <td>${escapeHtml(tx.receivedOrPaidBy || '—')}</td>
        <td>${escapeHtml(tx.postedBy || tx.postedById || '—')}</td>
        <td>${escapeHtml(tx.approvedBy || '—')}</td>
      </tr>`).join('');
      statementHtml = `
        <div class="record-card statement-record-minimal" id="statementPrintArea">
          <div class="lookup-card statement-lookup-minimal">
            <div class="stack">
              <div class="info-grid">
                <div class="info-item"><div class="k">A/C Name</div><div class="v">${escapeHtml(customer.name || customer.full_name || customer.display_name || '')}</div></div>
                <div class="info-item"><div class="k">Account Number</div><div class="v">${customer.accountNumber || '—'}</div></div>
                <div class="info-item"><div class="k">Phone No</div><div class="v">${escapeHtml(customer.phone || '—')}</div></div>
                <div class="info-item"><div class="k">Available Balance</div><div class="v">${money(customer.balance)}</div></div>
              </div>
            </div>
          </div>
          <div class="table-wrap" style="margin-top:16px">
            <table class="table">
              <thead><tr><th>S/N</th><th>Date</th><th>Details</th><th>Debit</th><th>Credit</th><th>Balance</th><th>Received/Paid By</th><th>Posted By</th><th>Approved By</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="9">No entries in range</td></tr>'}</tbody>
            </table>
          </div>
        </div>
        <div class="action-row compact-action-row" style="margin-top:10px">
          <button class="secondary tiny-btn" id="stmtPrintBtn">Print Statement</button>
        </div>`;
    }

    return `
      <div class="stack">
        <div class="form-card">
          <h3>Statement of Account</h3>
          ${customer ? `
          <div class="info-grid" style="margin-bottom:10px">
            <div class="info-item"><div class="k">A/C Name</div><div class="v">${escapeHtml(customer.name || customer.full_name || customer.display_name || '')}</div></div>
            <div class="info-item"><div class="k">Account Number</div><div class="v">${customer.accountNumber || '—'}</div></div>
          </div>` : `<div class="note">No customer selected. Go to Check Balance, search an account, then open Statement from there.</div>`}
          <div class="form-grid two account-statement-filter-grid polished-statement-grid">
            <div class="field stmt-field stmt-date-field"><label>From Date</label><input id="stmtFrom" class="entry-input stmt-date-input polished-date-input" type="date" lang="en-GB" value="${escapeHtml(filter.from || '')}"></div>
            <div class="field stmt-field stmt-date-field"><label>To Date</label><input id="stmtTo" class="entry-input stmt-date-input polished-date-input" type="date" lang="en-GB" value="${escapeHtml(filter.to || '')}"></div>
          </div>
          <div class="action-row compact-action-row">
            <button id="stmtGenerate" class="tiny-btn" ${customer ? '' : 'disabled'}>Generate Statement</button>
          </div>
        </div>
        <div id="statementArea">${statementHtml}</div>
      </div>`;
  }

  function renderJournalTool(kind) {
    const title = kind === 'credit' ? 'Credit' : 'Debit';
    const st = currentStaff();
    // REDESIGN 2026-08-19: replaced the Cash/Posting Cash/Variance tiles with
    // a more direct till reconciliation view. Opening Cash is literally the
    // teller's operational account balance (same figure Teller Balances
    // shows); Cash Received/Withdrawal are today's approved CASH-mode
    // transactions only (reusing the exact helpers Close of Day already uses
    // for this, so the numbers stay consistent across screens); Till is what
    // should physically be in the drawer right now.
    const tillBreakdown = (() => {
      const openingCash = getStaffOperationalBalance(st?.id);
      const cashReceived = approvedCreditTotalForDateByMode(st?.id, businessDate(), 'cash');
      const cashWithdrawal = approvedDebitTotalForDateByMode(st?.id, businessDate(), 'cash');
      return { openingCash, cashReceived, cashWithdrawal, till: openingCash + cashReceived - cashWithdrawal };
    })();
    state.ui.generatedJournals ||= {};
    state.ui.collapsedJournals ||= {};
    const journalKey = `${st?.id || 'staff'}:${businessDate()}:${kind}`;
    state.ui.telleringDrafts ||= {};
    const telleringDraft = state.ui.telleringDrafts[journalKey] ||= { singleCharges: { apply: false, checked: {}, values: {} }, journalCharges: { apply: false, checked: {}, values: {} } };
    telleringDraft.singleCharges ||= { apply: false, checked: {}, values: {} };
    telleringDraft.singleCharges.checked ||= {};
    telleringDraft.singleCharges.values ||= {};
    telleringDraft.journalCharges ||= { apply: false, checked: {}, values: {} };
    telleringDraft.journalCharges.checked ||= {};
    telleringDraft.journalCharges.values ||= {};
    return `
      <div class="tellering-stack">
        <div class="tellering-sheet journal-sheet standalone-posting-sheet">
          <div class="posting-modal-rows polished-posting-modal">
            <div class="posting-row posting-row-acc-kpi" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
              <div class="posting-acc-search-inline">
                <label class="sheet-label posting-label-account" for="txAcc">Acct No.</label>
                <input id="txAcc" class="entry-input sheet-input short-code" maxlength="12" value="${escapeHtml(String(state.ui.txAccDraft || ''))}" />
                <button id="txSearch" class="sheet-btn tiny-btn ultra-compact-btn">Search</button>
              </div>
              <div class="posting-business-date-corner"><span class="sheet-label">Business Date</span> <strong>${fmtDate(businessDate())}</strong></div>
            </div>

            <div class="posting-row posting-row-name">
              <label class="sheet-label posting-label-name" for="txName">Acct Name</label>
              <div class="display-field value-wide" id="txName">—</div>
            </div>

            <div class="posting-row posting-row-amount">
              <label class="sheet-label posting-label-name" for="txAmount">Amount ${kind === 'credit' ? 'Received' : 'Paid'}</label>
              <input id="txAmount" class="entry-input sheet-input medium-amt" type="number" value="${escapeHtml(String(state.ui.txAmountDraft || ''))}" />
              <button id="txPostSingle" class="sheet-btn secondary tiny-btn ultra-compact-btn">Post</button>
            </div>

            <div class="posting-row posting-row-details">
              <label class="sheet-label posting-label-name" for="txDetails">Details</label>
              <input id="txDetails" class="entry-input sheet-input posting-input-half" value="${escapeHtml(String(state.ui.txDetailsDraft || ''))}" placeholder="What is this transaction for?">
            </div>

            <div class="posting-row posting-row-counterparty">
              <label class="sheet-label posting-label-name" for="txCounterparty">${kind === 'credit' ? 'Received By' : 'Paid By'}</label>
              <input id="txCounterparty" class="entry-input sheet-input posting-input-half" value="${escapeHtml(String(state.ui.txCounterpartyDraft || ''))}">
            </div>

            <div class="posting-row posting-row-balance">
              <label class="sheet-label posting-label-name" for="txBalance">Available Balance</label>
              <div class="display-field" id="txBalance">—</div>
            </div>

            <div class="posting-row posting-row-mode">
              <label class="sheet-label posting-label-name">${kind === 'credit' ? 'Mode' : 'Payout Source'}</label>
              <div class="tx-mode-toggle inline-mode-toggle"><label class="tx-toggle-pill"><input type="radio" name="txMode" value="cash" ${(state.ui.txModeDraft || 'cash') === 'cash' ? 'checked' : ''}> <span>Cash</span></label><label class="tx-toggle-pill"><input type="radio" name="txMode" value="transfer" ${(state.ui.txModeDraft || 'cash') === 'transfer' ? 'checked' : ''}> <span>Transfer</span></label></div>
            </div>
            ${kind === 'credit' ? `<div class="posting-row posting-row-commission-toggle subtle-commission-toggle-row"><label class="commission-toggle-chip"><input id="txApplyCharges" type="checkbox" ${telleringDraft.singleCharges.apply ? 'checked' : ''}> <span>Apply Charges</span></label></div><div class="posting-row posting-row-commission subtle-commission-row ${telleringDraft.singleCharges.apply ? '' : 'hidden'}" id="txChargesRow"><div class="charges-grid">${CHARGE_DEFS.map(def => `<div class="charge-item"><label class="charge-toggle-chip"><input type="checkbox" data-charge-check="${def.key}" data-charge-scope="single" ${telleringDraft.singleCharges.checked[def.key] ? 'checked' : ''}> <span>${def.label}</span></label><input data-charge-input="${def.key}" data-charge-scope="single" class="entry-input sheet-input commission-input ${telleringDraft.singleCharges.checked[def.key] ? '' : 'hidden'}" type="number" value="${escapeHtml(String(telleringDraft.singleCharges.values[def.key] || ''))}" /></div>`).join('')}</div><div class="commission-mini-field"><label class="sheet-label">Total Charges</label><div class="display-field commission-display" id="txTotalCharges">${money(0)}</div></div><div class="commission-mini-field"><label class="sheet-label">To Customer Account</label><div class="display-field commission-display" id="txCustomerGets">${money(0)}</div></div></div>` : ''}
            <div class="posting-row posting-row-opbox">
              <div class="op-breakdown-box" id="txOpBreakdown">
                <div class="op-breakdown-cell"><span class="op-breakdown-label">Opening Cash</span><span class="op-breakdown-value" id="postingOpeningCash">${money(tillBreakdown.openingCash)}</span></div>
                <div class="op-breakdown-cell"><span class="op-breakdown-label">Cash Received</span><span class="op-breakdown-value" id="postingCashReceived">${money(tillBreakdown.cashReceived)}</span></div>
                <div class="op-breakdown-cell"><span class="op-breakdown-label">Cash Withdrawal</span><span class="op-breakdown-value" id="postingCashWithdrawal">${money(tillBreakdown.cashWithdrawal)}</span></div>
                <div class="op-breakdown-cell"><span class="op-breakdown-label">Till</span><span class="op-breakdown-value ${tillBreakdown.till < 0 ? 'balance-negative' : ''}" id="postingTill">${money(tillBreakdown.till)}</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }

  function renderJournalPaneMarkup(kind) {
    const st = currentStaff();
    state.ui.generatedJournals ||= {};
    state.ui.collapsedJournals ||= {};
    const journalKey = `${st?.id || 'staff'}:${businessDate()}:${kind}`;
    const journalVisible = !!state.ui.generatedJournals[journalKey];
    const journalCollapsed = !!state.ui.collapsedJournals[journalKey];
    state.ui.telleringDrafts ||= {};
    const telleringDraft = state.ui.telleringDrafts[journalKey] ||= { singleCharges: { apply: false, checked: {}, values: {} }, journalCharges: { apply: false, checked: {}, values: {} } };
    telleringDraft.journalCharges ||= { apply: false, checked: {}, values: {} };
    telleringDraft.journalCharges.checked ||= {};
    telleringDraft.journalCharges.values ||= {};
    if (!journalVisible) {
      // SURGICAL PATCH 2026-08-24 (client request): Journal Form Amount is
      // no longer something the teller types — it IS their operational
      // balance, always. If that balance is zero or negative, there's
      // nothing to post against, so journal creation stops here rather
      // than letting them generate a journal they can never balance/submit.
      const opBalanceForStart = getStaffOperationalBalance(st?.id);
      if (!(opBalanceForStart > 0)) {
        return `<div class="tellering-sheet journal-start-sheet form-card"><div class="note warning-note" style="text-align:center;padding:24px 0">Your operational balance is ${money(opBalanceForStart)}. You need a positive balance before you can post a ${kind === 'credit' ? 'Credit' : 'Debit'} Journal — ask Treasury to fund your operational account.</div></div>`;
      }
      return `<div class="tellering-sheet journal-start-sheet form-card"><div class="action-row" style="justify-content:center;padding:24px 0"><button id="genJournalStartBtn" class="sheet-btn">Generate ${kind === 'credit' ? 'Credit' : 'Debit'} Journal</button></div></div>`;
    }
    return `<div class="w-full flex justify-center journal-center-wrap" id="journalPaneWrap">
        <div class="journal-wrapper">
        <div class="journal-pane form-card spacious-journal-pane standalone-journal-pane" id="journalPane">
          <div class="journal-pane-head compact-journal-head">
            <h3>Journal Generated</h3>
            <div class="journal-pane-actions ${journalCollapsed ? "" : "journal-pane-actions-hidden"}"><button id="journalCollapseTopBtn" class="secondary">${journalCollapsed ? 'Expand Journal' : 'Collapse Journal'}</button></div>
          </div>
          <div class="journal-pane-body ${journalCollapsed ? 'hidden' : ''}" id="journalPaneBody">
            <div class="journal-entry-top row-zero journal-form-row" style="display:grid;grid-template-columns:max-content 160px max-content max-content;column-gap:10px;align-items:end;margin-bottom:10px;">
              <label class="sheet-label" for="journalFormAmount" style="margin:0;white-space:nowrap;align-self:center;">Journal Form Amount</label>
              <div id="journalFormAmount" class="display-field" data-op-balance="${getStaffOperationalBalance(st?.id)}" style="margin:0;">${money(getStaffOperationalBalance(st?.id))}</div>
              <div class="tx-mode-toggle inline-mode-toggle"><label class="tx-toggle-pill"><input type="radio" name="journalFormMode" value="cash" ${(telleringDraft.journalFormMode || 'cash') === 'cash' ? 'checked' : ''}> <span>Cash</span></label><label class="tx-toggle-pill"><input type="radio" name="journalFormMode" value="transfer" ${(telleringDraft.journalFormMode || 'cash') === 'transfer' ? 'checked' : ''}> <span>Transfer</span></label></div>
              <div class="posting-kpis-inline">
                <div class="mini-kpi-pill"><span class="mini-kpi-pill-label">JOURNAL BALANCE</span><span class="mini-kpi-pill-value" id="journalFormRunning">${money(0)}</span></div>
                <div class="mini-kpi-pill"><span class="mini-kpi-pill-label">JOURNAL VARIANCE</span><span class="mini-kpi-pill-value balance-negative" id="journalFormVariance">${money(0)}</span></div>
                <div class="mini-kpi-pill"><span class="mini-kpi-pill-label">TOTAL POSTED</span><span class="mini-kpi-pill-value" id="journalTotalPosted">${money(0)}</span></div>
              </div>
            </div>
            <div class="table-wrap journal-table-wrap"><table class="table journal-table"><thead><tr><th>S/N</th><th>Account Name</th><th>Account Number</th><th>Amount</th><th>Remaining Balance</th><th>Variance</th><th>Action</th></tr></thead><tbody id="journalRows"></tbody></table></div>
            <div class="journal-entry-shell journal-entry-foot">
              <div class="journal-entry-top row-one" style="display:grid;grid-template-columns:max-content 76px max-content 240px 190px;column-gap:6px;align-items:end;justify-content:start;">
                <label class="sheet-label posting-label-account" for="journalAcc" style="margin:0;white-space:nowrap;align-self:center;">Account Number</label>
                <input id="journalAcc" class="entry-input sheet-input short-code" maxlength="12" style="width:100px;min-width:100px;margin:0;" value="${escapeHtml(String(state.ui.journalAccDraft || ''))}">
                <button id="journalSearchBtn" type="button" class="sheet-btn tiny-btn ultra-compact-btn" style="margin:0;height:28px;align-self:center;">Search</button>
                <div class="journal-cell" style="width:240px;margin:0;"><div class="display-field" id="journalName">—</div><div class="journal-cell-label">Account Name</div></div>
                <div class="journal-cell" style="width:190px;margin:0;"><input id="journalAmount" class="entry-input" type="text" inputmode="decimal" value="${escapeHtml(String(telleringDraft.journalAmount || ''))}"><div class="journal-cell-label">Amount</div></div>
              </div>
              <div class="journal-entry-top row-two">
                <div class="journal-cell grow"><input id="journalCounterparty" class="entry-input"><div class="journal-cell-label">${kind === 'credit' ? 'Received By' : 'Paid To'}</div></div>
                <div class="journal-cell grow"><input id="journalDetails" class="entry-input"><div class="journal-cell-label">Details</div></div>
                <div class="journal-cell action"><button id="journalAddRow" type="button" class="sheet-btn">Add to Journal</button></div>
                <div class="journal-cell action"><button id="journalCollapseBtn" class="secondary">${journalCollapsed ? 'Expand Journal' : 'Collapse Journal'}</button></div>
              </div>
              ${kind === 'credit' ? `<div class="journal-entry-top row-three commission-journal-row subtle-commission-toggle-row"><div class="journal-cell commission-toggle-cell"><label class="commission-toggle-chip commission-toggle-chip-mini"><input id="journalApplyCharges" type="checkbox" ${telleringDraft.journalCharges.apply ? 'checked' : ''}> <span>Apply Charges</span></label></div></div><div class="journal-entry-top row-three commission-journal-row subtle-commission-row ${telleringDraft.journalCharges.apply ? '' : 'hidden'}" id="journalChargesRow"><div class="charges-grid journal-charges-grid">${CHARGE_DEFS.map(def => `<div class="charge-item"><label class="charge-toggle-chip"><input type="checkbox" data-charge-check="${def.key}" data-charge-scope="journal" ${telleringDraft.journalCharges.checked[def.key] ? 'checked' : ''}> <span>${def.label}</span></label><input data-charge-input="${def.key}" data-charge-scope="journal" class="entry-input commission-input ${telleringDraft.journalCharges.checked[def.key] ? '' : 'hidden'}" type="number" value="${escapeHtml(String(telleringDraft.journalCharges.values[def.key] || ''))}"></div>`).join('')}</div><div class="journal-cell commission-mini-field"><div class="display-field commission-display" id="journalTotalCharges">${money(0)}</div><div class="journal-cell-label">Total Charges</div></div><div class="journal-cell commission-mini-field grow"><div class="display-field commission-display" id="journalCustomerGets">${money(0)}</div><div class="journal-cell-label">To Customer Account</div></div></div>` : ''}
            </div>
            <div class="action-row journal-submit-row"><button id="journalSubmit">Submit Journal</button><button class="secondary" id="journalClear">Clear Journal</button><label class="sheet-btn secondary file-trigger-btn" for="journalFieldNoteInput">Upload Field Note</label><input id="journalFieldNoteInput" type="file" accept="image/*,.pdf,application/pdf" class="visually-hidden-file-input"><span class="compact-file-name" id="journalFieldNoteName">No file selected</span></div>
            <div id="journalFieldNotePreview" class="field-note-preview hidden"></div>
          </div>
        </div>
        </div>
        </div>`;
  }

  function renderJournalStandalone() {
    const kind = state.ui.journalStandaloneKind === 'debit' ? 'debit' : 'credit';
    return `<div class="tellering-stack">
        <div class="tellering-sheet journal-toggle-sheet standalone-posting-sheet">
          <div class="posting-row" style="padding:10px 14px">
            <div class="tx-mode-toggle inline-mode-toggle journal-kind-toggle"><label class="tx-toggle-pill"><input type="radio" name="journalStandaloneKind" value="credit" ${kind === 'credit' ? 'checked' : ''}> <span>Credit</span></label><label class="tx-toggle-pill"><input type="radio" name="journalStandaloneKind" value="debit" ${kind === 'debit' ? 'checked' : ''}> <span>Debit</span></label></div>
          </div>
        </div>
        ${renderJournalPaneMarkup(kind)}
      </div>`;
  }

  const APPROVAL_REVIEW_LOCK_MS = 60 * 1000;

  function normalizeApprovalLock(lock) {
    if (!lock) return null;
    const startedAt = typeof lock.startedAt === 'number' ? lock.startedAt : new Date(lock.startedAt || 0).getTime();
    if (!startedAt || Date.now() - startedAt > APPROVAL_REVIEW_LOCK_MS) return null;
    return {
      staffId: lock.staffId || lock.staff_id || '',
      staffName: lock.staffName || lock.staff_name || 'Staff',
      startedAt
    };
  }

  function cleanupApprovalReviewLocks() {
    state.ui ||= {};
    state.ui.approvalReviewLocks ||= {};
    Object.keys(state.ui.approvalReviewLocks).forEach(id => {
      if (!normalizeApprovalLock(state.ui.approvalReviewLocks[id])) delete state.ui.approvalReviewLocks[id];
    });
  }

  function getApprovalReviewLock(id) {
    cleanupApprovalReviewLocks();
    const approval = (state.approvals || []).find(a => a.id === id);
    return normalizeApprovalLock(approval?.payload?.__reviewLock) || normalizeApprovalLock(state.ui.approvalReviewLocks?.[id]);
  }

  function setApprovalReviewLock(id) {
    if (!id) return Promise.resolve(defaultResultErr('APPROVAL_LOCK_INVALID', 'Approval request id is required'));
    cleanupApprovalReviewLocks();
    const staff = currentStaff();
    state.ui.approvalReviewLocks[id] = {
      staffId: staff?.id || '',
      staffName: staff?.name || 'Staff',
      startedAt: Date.now()
    };
    save();
    if (isSupabaseApprovalMode() && gateway.approvals?.setReviewLock) {
      return gateway.approvals.setReviewLock({
        requestId: id,
        staffId: getStaffBackendId(staff),
        staffName: staff?.name || 'Staff',
        ttlMs: APPROVAL_REVIEW_LOCK_MS
      }).then(async (result) => {
        if (result?.ok) {
          await syncApprovalsFromGateway();
          return result;
        }
        if (result?.error?.code === 'APPROVAL_LOCKED') {
          delete state.ui.approvalReviewLocks[id];
          state.ui.selectedApprovalIds = (state.ui.selectedApprovalIds || []).filter(x => x !== id);
          save();
          showToast(result.error.message || 'This request is being reviewed by another staff');
          await syncApprovalsFromGateway();
          renderWorkspace();
          return result;
        }
        return result;
      }).catch((error) => {
        delete state.ui.approvalReviewLocks[id];
        state.ui.selectedApprovalIds = (state.ui.selectedApprovalIds || []).filter(x => x !== id);
        save();
        return defaultResultErr('APPROVAL_LOCK_FAILED', 'Could not mark this request as being reviewed.', error);
      });
    }
    return Promise.resolve(defaultResultOk(state.ui.approvalReviewLocks[id]));
  }

  function isApprovalLockedByOther(id) {
    // Timer-based review locking removed per client request — routing a
    // request to a specific approving officer (plus admin, who can always
    // approve) is the intended safeguard against double-approval now, not
    // a countdown lock.
    return false;
  }

  function approvalReviewIndicator(approval) {
    return '—';
  }

  function renderApprovals() {
    if (!state.ui.codAdminDate) {
      const lastClosed = latestClosedBusinessDay();
      state.ui.codAdminDate = lastClosed?.date || businessDate();
    }
    state.ui.selectedApprovalIds ||= [];
    cleanupApprovalReviewLocks();
    const categories = { customer_service: ['account_opening','account_maintenance','account_reactivation'], tellering: ['cash_receipt','inter_staff_credit','customer_credit','customer_debit','customer_credit_journal','customer_debit_journal'], non_cash: ['intra_bank_transfer'], others: ['float_topup','operational_entry','create_operational_account','close_of_day','temp_grant','wallet_fund','debt_repayment'] };
    reconcileBusinessDateFromClosures();
    const openDate = businessDate();
    const currentSection = state.ui.approvalsSection || 'tellering';
    const viewer = currentStaff();
    const allRows = state.approvals.filter(a => {
      if (!categories[currentSection].includes(a.type)) return false;
      if (a.status !== 'pending') return false; // decided items live in Approval History now
      const reqDate = approvalBusinessDate(a.type, a.payload || {});
      // Approval Queue belongs to the CURRENT OPEN business date only.
      // Closed dates belong to COD Resolution/history and must not remain
      // mixed with actionable approval work.
      if (reqDate !== openDate || isBusinessDateClosed(reqDate)) return false;
      // Officer routing: approving officers only see requests sent to them.
      // Admin always sees everything, regardless of routing.
      if (viewer?.role === 'approving_officer') {
        const assignedTo = a.payload?.assignedApproverId;
        if (assignedTo && assignedTo !== viewer.id) return false;
      }
      return true;
    });
    const limit = state.ui.approvalsLimit || 20;
    const approvals = allRows.slice(0, limit);
    const rows = approvals.map((a, i) => {
      const lockedByOther = isApprovalLockedByOther(a.id);
      const canSelect = a.status === 'pending' && !lockedByOther;
      const checked = state.ui.selectedApprovalIds.includes(a.id) ? 'checked' : '';
      const disabledAttr = canSelect ? '' : 'disabled';
      const actionDisabled = lockedByOther ? 'disabled' : '';
      const pendingActions = a.status === 'pending' ? `<div class="inline-actions"><button type="button" data-approve="${a.id}" class="success" ${actionDisabled}>Approve</button><button type="button" data-reject="${a.id}" class="danger" ${actionDisabled}>Reject</button></div>` : '';
      const journalActions = a.type.includes('_journal') ? `<div class="stack-actions"><button type="button" data-inspect-journal="${a.id}" class="secondary">Inspect</button>${pendingActions}</div>` : '';
      const normalActions = !a.type.includes('_journal') ? (a.status === 'pending' ? pendingActions : a.approvedBy || '—') : '';
      // View removed: the open account's own headings are shown inline below instead of a separate modal.
      const detailCell = ['account_opening','account_maintenance','account_reactivation'].includes(a.type)
        ? approvalAccountHeadingsInline(a)
        : approvalDetails(a);
      return `<tr><td><input type="checkbox" class="approval-select-checkbox" data-approval-select="${a.id}" ${checked} ${disabledAttr}></td><td>${i+1}</td><td>${prettyApprovalType(a.type)}</td><td>${approvalSubmittedBy(a)}</td><td>${detailCell}</td><td>${fmtDate(approvalDisplayDate(a))}</td><td><span class="badge ${a.status}">${a.status}</span></td><td>${journalActions}${normalActions}</td></tr>`;
    }).join('');
    state.ui.codResolutionLimit ||= 10;
    const codRows=(state.cod||[]).filter(c=>{
      const codDate = String(c.date || c.businessDate || '').slice(0,10);
      // COD Resolution visibility must be controlled by the COD record itself,
      // not by the current open date. If one device has not advanced yet, using
      // openDate here hides the closed-day evidence and makes resolution vanish.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(codDate)) return false;
      // Once a COD record has entered the resolution lifecycle, its own
      // status controls visibility. Do not re-hide it because a later live
      // balance recalculation temporarily reads zero/stale values. Resolution
      // records must remain visible until they are explicitly resolved.
      if (c.status === 'resolved' || c.status === 'draft') return false;
      return true;
    }).slice(0, state.ui.codResolutionLimit || 10).map((c,i)=>{
      const creditCash = Number(c.totalCreditCash ?? approvedCreditTotalForDateByMode(c.staffId, c.date, 'cash'));
      const creditTransfer = Number(c.totalCreditTransfer ?? approvedCreditTotalForDateByMode(c.staffId, c.date, 'transfer'));
      const debitCash = Number(c.totalDebitCash ?? approvedDebitTotalForDateByMode(c.staffId, c.date, 'cash'));
      const debitTransfer = Number(c.totalDebitTransfer ?? approvedDebitTotalForDateByMode(c.staffId, c.date, 'transfer'));
      const formAmount = Number(c.formAmount ?? c.openingBalance ?? getStaffOperationalBalance(c.staffId));
      const remaining = Number(c.remainingBalance ?? c.runningFloat ?? codRemainingBalance(formAmount, creditCash + creditTransfer, debitCash + debitTransfer));
      const variance = Number(c.variance ?? Math.abs(remaining));
      const overdraw = Number(c.overdraw ?? Math.max(0, -remaining));
      const recomputedVariance = Math.abs(remaining);
      const recomputedOverdraw = Math.max(0, -remaining);
      const codResolveId = c.id || c.codSubmissionId || c.cod_submission_id || '';
      const isAnomaly = remaining < 0;
      const statusBadge = isAnomaly
        ? `<span class="badge flagged">Anomaly</span>`
        : (recomputedVariance > 0 ? `<span class="badge">Variance</span>` : `<span class="badge balanced">Balanced</span>`);
      return `<tr><td>${i+1}</td><td>${fmtDate(c.date)}</td><td>${escapeHtml(c.staffName || '')}</td><td>${money(formAmount)}</td><td>${money(creditCash)}</td><td>${money(creditTransfer)}</td><td>${money(debitCash)}</td><td>${money(debitTransfer)}</td><td class="${remaining<0?'balance-negative':''}">${money(remaining)}</td><td class="${recomputedVariance>0?'balance-negative':''}">${money(recomputedVariance)}</td><td class="${recomputedOverdraw>0?'balance-negative':''}">${money(recomputedOverdraw)}</td><td>${statusBadge}</td><td>${escapeHtml(c.resolutionNote || c.note || '—')}</td><td>${(canCloseBusinessDay())?`<button data-cod-resolve="${codResolveId}" class="warning">Resolve</button>`:'Awaiting Resolution'}</td></tr>`;
    }).join('');
    const selected = state.ui.codAdminDate;
    const codStatusRows = state.staff.filter(s => (DEFAULT_PERMS[s.role]||[]).includes('credit') || (DEFAULT_PERMS[s.role]||[]).includes('debit')).map((s,i)=>{ const rec=(state.cod||[]).find(c=>c.staffId===s.id && c.date===selected); const status=rec?(rec.status==='resolved'?'Resolved':rec.status==='flagged'?'Anomaly':'Submitted'):'Missing'; const opBalance = rec ? Number(rec.formAmount ?? rec.openingBalance ?? getStaffOperationalBalance(rec.staffId)) : null; const remaining = rec ? Number(rec.remainingBalance ?? rec.runningFloat ?? 0) : null; return `<tr><td>${i+1}</td><td>${escapeHtml(s.name || '')}</td><td>${ROLE_LABELS[s.role]||s.role}</td><td>${status}</td><td>${rec?money(opBalance):'—'}</td><td>${rec?money(remaining):'—'}</td></tr>`; }).join('');
    const codResolutionAllCount = (state.cod||[]).filter(c=>{ const d=String(c.date||c.businessDate||'').slice(0,10); return /^\d{4}-\d{2}-\d{2}$/.test(d) && c.status!=='resolved' && c.status!=='draft'; }).length;
    const codResolutionMoreLess = codResolutionAllCount > 0 ? ('<div class="action-row" style="margin-top:8px">' + (codResolutionAllCount > (state.ui.codResolutionLimit||10) ? '<button id="codResolutionMore" class="secondary">Show More</button>' : '') + ((state.ui.codResolutionLimit||10) > 10 ? '<button id="codResolutionLess" class="secondary">Show Less</button>' : '') + '</div>') : '';
    const moreLess = `<div class="action-row">${allRows.length > limit ? `<button id="approvalsMore" class="secondary">Show More</button>`:''}${limit > 20 ? `<button id="approvalsLess" class="secondary">Show Less</button>`:''}</div>`;
    return `<div class="stack">${codRows?`<div class="table-card"><h3>COD Resolution Queue</h3><div class="note">Any teller who closes the day with a negative operational balance shows here as an <strong>Anomaly</strong> — Treasury/Admin resolves it directly with the staff involved.</div><div class="table-wrap cod-resolution-table-wrap"><table class="table cod-resolution-table"><thead><tr><th>S/N</th><th>Date</th><th>Staff</th><th>Form</th><th>Credit Cash</th><th>Credit Transfer</th><th>Debit Cash</th><th>Debit Transfer</th><th>Remaining Balance</th><th>Variance</th><th>Overdraw</th><th>Status</th><th>Note</th><th>Action</th></tr></thead><tbody>${codRows}</tbody></table></div>${codResolutionMoreLess}</div>`:''}<div class="approvals-top-controls"><div class="tool-tabs approvals-sections" id="approvalsSectionTabs">${[['customer_service','Customer Service'],['tellering','Teller'],['non_cash','Non Cash'],['others','Others']].map(([k,l])=>`<button class="tool-tab ${currentSection===k?'active':''}" data-approval-section="${k}">${l}</button>`).join('')}</div></div><div class="table-card" id="approvalsQueueCard"><div class="action-row" style="justify-content:space-between;align-items:center"><h3>Approval Queue</h3><div class="inline-actions"><button type="button" id="approvalSelectAll" class="secondary tiny-btn">Select Visible Pending</button><button type="button" id="approvalClearSelection" class="secondary tiny-btn">Clear</button><button type="button" id="approvalBulkApprove" class="success tiny-btn">Approve Selected</button><button type="button" id="approvalBulkReject" class="danger tiny-btn">Reject Selected</button></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Select</th><th>S/N</th><th>Request</th><th>Submitted By</th><th>Details</th><th>Date</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows || '<tr><td colspan="8" class="muted">No requests yet</td></tr>'}</tbody></table></div>${moreLess}</div>${canCloseBusinessDay()?`<div class="table-card"><h3>COD Daily Submission Status</h3><div class="action-inline"><div class="inline-field compact"><span>COD Date</span><input type="date" lang="en-GB" id="codAdminDate" value="${selected}"></div></div><div class="table-wrap"><table class="table"><thead><tr><th>S/N</th><th>Staff</th><th>Office</th><th>Status</th><th>Form</th><th>Remaining Balance</th></tr></thead><tbody>${codStatusRows}</tbody></table></div></div>`:''}</div>`;
  }

  function renderApprovalHistory() {
    const allTypes = ['account_opening','account_maintenance','account_reactivation','cash_receipt','inter_staff_credit','customer_credit','customer_debit','customer_credit_journal','customer_debit_journal','intra_bank_transfer','float_topup','operational_entry','create_operational_account','close_of_day','temp_grant','wallet_fund','debt_repayment'];
    const decided = (state.approvals || [])
      .filter(a => allTypes.includes(a.type) && a.status !== 'pending')
      .sort((a, b) => new Date(approvalDisplayDate(b) || 0) - new Date(approvalDisplayDate(a) || 0));
    const limit = state.ui.approvalHistoryLimit || 30;
    const rows = decided.slice(0, limit).map((a, i) => {
      const detailCell = ['account_opening','account_maintenance','account_reactivation'].includes(a.type)
        ? approvalAccountHeadingsInline(a)
        : approvalDetails(a);
      return `<tr><td>${i+1}</td><td>${prettyApprovalType(a.type)}</td><td>${approvalSubmittedBy(a)}</td><td>${detailCell}</td><td>${fmtDate(approvalDisplayDate(a))}</td><td><span class="badge ${a.status}">${a.status}</span></td><td>${escapeHtml(a.approvedBy || a.approvedByName || '—')}</td></tr>`;
    }).join('');
    const moreLess = `<div class="action-row">${decided.length > limit ? `<button id="approvalHistoryMore" class="secondary">Show More</button>`:''}${limit > 30 ? `<button id="approvalHistoryLess" class="secondary">Show Less</button>`:''}</div>`;
    return `<div class="stack"><div class="table-card"><h3>Approval History</h3><div class="table-wrap"><table class="table"><thead><tr><th>S/N</th><th>Request</th><th>Submitted By</th><th>Details</th><th>Date</th><th>Status</th><th>Decided By</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="muted">No decided requests yet</td></tr>'}</tbody></table></div>${moreLess}</div></div>`;
  }

  function approvalSubmittedBy(a) {
    const p = a.payload || {};
    const staffId = p.staffId || a.requestedBy;
    const staff = (state.staff || []).find(s => s.id === staffId) || {};
    const roleLabel = ROLE_LABELS[staff.role] || staff.role || '';
    const name = a.requestedByName || staffName(staffId);
    const routedNote = p.assignedApproverName ? `<div class="muted" style="font-size:0.85em">→ ${escapeHtml(p.assignedApproverName)}</div>` : '';
    if (a.type === 'customer_credit_journal' || a.type === 'customer_debit_journal') return `${escapeHtml(name)} • ${roleLabel || 'Staff'} • Journal${routedNote}`;
    return `${escapeHtml(name)} • ${roleLabel || 'Staff'}${routedNote}`;
  }
  function approvalDetails(a) {
    const p = a.payload || {};
    if (a.type === 'customer_credit') return `${money(p.amount)} to ${escapeHtml(customerName(p.customerId) || p.accountNumber || '')}${chargeSummaryText(p)}${p.details ? ' • ' + escapeHtml(p.details) : ''}`;
    if (a.type === 'customer_debit') return `${money(p.amount)} from ${escapeHtml(customerName(p.customerId) || p.accountNumber || '')}${p.details ? ' • ' + escapeHtml(p.details) : ''}`;
    if (a.type === 'customer_credit_journal' || a.type === 'customer_debit_journal') { const rows = p.rows || p.entries || []; const total = rows.reduce((s,r)=>s+Number(r.amount||0),0); const totalCharges = rows.reduce((s,r)=>s+getTotalChargeAmount(r),0); const attachmentTag = p.fieldNote ? ' • Note attached' : ''; const chargeTag = a.type === 'customer_credit_journal' && totalCharges > 0 ? ` • Total Charge ${money(totalCharges)}` : ''; const formTag = ` • Form ${money(p.formAmount || 0)}`; return `${rows.length} item${rows.length===1?'':'s'} • Total ${money(total)}${formTag}${chargeTag}${attachmentTag}`; }
    if (a.type === 'wallet_fund') return `${escapeHtml(staffName(p.staffId) || '')} • Wallet fund • ${money(p.amount)}`;
    if (a.type === 'debt_repayment') return `${escapeHtml(staffName(p.staffId) || '')} • Debt repayment • ${money(p.amount)}`;
    return requestSummary(a);
  }

  function approvalAccountHeadingsInline(a) {
    const p = a.payload || {};
    const esc = (v) => String(v ?? '—').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    const line = (label, value) => value ? `<span class="approval-heading-item"><strong>${label}:</strong> ${esc(value)}</span>` : '';
    if (a.type === 'account_opening') {
      const acctType = p.accountType || 'customer';
      const isCustomer = acctType === 'customer';
      const acctTypeLabels = { customer: 'Customer Account', staff_operational: 'Teller Account', staff_salary: 'Staff Salary Account', expense: 'Expense Account', income: 'Income Account' };
      // SURGICAL PATCH 2026-08-14: Customer Service now assigns the account
      // number at Account Opening (required, not optional) — the approving
      // officer only SEES it here, never assigns or edits it. Previously a
      // pending customer request showed an editable input letting the
      // approver type/overwrite the number themselves.
      // SURGICAL PATCH 2026-08-24: system-assigned types (Teller/Staff
      // Salary/Expense/Income) now also get their number at creation time,
      // same as customer accounts — so the approver sees the real number
      // here too, not a "generated on approval" placeholder.
      const assignInput = line('Account Number', p.generatedAccountNumber || (isCustomer ? 'Not assigned — return to Customer Service' : 'Not yet assigned — return to Customer Service'));
      return `<div class="approval-heading-inline">
        ${line('Type', acctTypeLabels[acctType] || acctType)}
        ${line('Name', p.fullName || p.name)}
        ${isCustomer ? line('Phone', p.phone) : ''}
        ${isCustomer ? line('Address', p.address) : ''}
        ${isCustomer ? line('NIN', p.nin) : ''}
        ${isCustomer ? line('BVN', p.bvn) : ''}
        ${acctType === 'staff_operational' ? line('Linked Staff', p.linkedStaffName || p.linkedStaffId) : ''}
        ${assignInput}
      </div>`;
    }
    if (a.type === 'account_maintenance') {
      const patch = p.patch || {};
      const customer = state.customers.find(c => c.id === p.customerId);
      return `<div class="approval-heading-inline">
        ${line('Account Number', p.accountNumber)}
        ${line('Current Name', customer?.name)}
        ${line('Updated Name', patch.name)}
        ${line('Updated Phone', patch.phone)}
        ${line('Updated Address', patch.address)}
        ${line('Updated NIN', patch.nin)}
        ${line('Updated BVN', patch.bvn)}
        ${line('Old A/N', patch.oldAccountNumber)}
      </div>`;
    }
    if (a.type === 'account_reactivation') {
      const customer = state.customers.find(c => c.id === p.customerId);
      return `<div class="approval-heading-inline">
        ${line('Account Number', p.accountNumber)}
        ${line('Name', customer?.name)}
        ${line('Current Status', customerStatusLabel(customer))}
      </div>`;
    }
    return approvalDetails(a);
  }

  function prettyApprovalType(type) {
    return {
      account_opening:'Account Opening', account_maintenance:'Account Maintenance', account_reactivation:'Account Reactivation',
      customer_credit:'Credit', customer_debit:'Debit', customer_credit_journal:'Credit Journal', customer_debit_journal:'Debit Journal', cash_receipt:'Cash Receipt', inter_staff_credit:'Staff Account Credit', intra_bank_transfer:'Non Cash Transaction', float_topup:'Float Top-Up', operational_entry:'Operational Entry',
      create_operational_account:'Operational Account', close_of_day:'Close of Day', temp_grant:'Temporary Grant', wallet_fund:'Wallet Funding', debt_repayment:'Debt Repayment'
    }[type] || type;
  }

  function requestSummary(a) {
    const p = a.payload || {};
    if (a.type === 'intra_bank_transfer') return `Non cash: ${money(p.amount)} from ${escapeHtml(p.sourceAccountName||p.sourceAccountNumber||'—')} → ${escapeHtml(p.destAccountName||p.destAccountNumber||'—')} • ${p.date}`;
    if (a.type === 'cash_receipt') return `${money(p.amount)} received by ${escapeHtml(p.staffName || 'Treasury')} • ${escapeHtml(p.paymentMode || 'cash')} • ${p.date}`;
    if (a.type === 'inter_staff_credit') return `${money(p.amount)} to ${escapeHtml(p.targetAccountName || p.targetAccountNumber || 'staff account')} • ${escapeHtml(p.paymentMode || 'cash')} • ${p.date}`;
    if (a.type === 'float_topup') return `${money(p.amount)} to ${escapeHtml(p.staffName || 'staff')} for ${p.date}`;
    if (a.type === 'customer_credit' || a.type === 'customer_debit') return `${escapeHtml(p.accountNumber || '')} • ${money(p.amount)}${a.type === 'customer_credit' ? chargeSummaryText(p) : ''}`;
    if (a.type === 'account_opening') return `${escapeHtml(p.name || '')} • Phone ${escapeHtml(p.phone || '—')} • NIN ${escapeHtml(p.nin || '—')} • BVN ${escapeHtml(p.bvn || '—')}`;
    if (a.type === 'account_maintenance') return `${escapeHtml(p.accountNumber || '')} • update`;
    if (a.type === 'account_reactivation') return `${escapeHtml(p.accountNumber || '')} • reactivate`;
    if (a.type === 'operational_entry') return `${escapeHtml(p.accountName || '')} • ${money(p.amount)}`;
    if (a.type === 'create_operational_account') return `${escapeHtml(p.category || '')} • ${escapeHtml(p.name || '')}`;
    if (a.type === 'close_of_day') return `${escapeHtml(p.staffName || '')} • ${p.date} • Form ${money(p.formAmount ?? p.openingBalance ?? 0)} • Remaining ${money(p.remainingBalance ?? p.runningFloat ?? 0)}`;
    if (a.type === 'temp_grant') return `${escapeHtml(staffName(p.staffId) || '')} • ${TOOL_LABELS[p.tool]} = ${p.enabled ? 'ON' : 'OFF'}`;
    if (a.type === 'wallet_fund') return `${escapeHtml(staffName(p.staffId) || '')} • Wallet fund • ${money(p.amount)}`;
    if (a.type === 'debt_repayment') return `${escapeHtml(staffName(p.staffId) || '')} • Debt repayment • ${money(p.amount)}`;
    return '—';
  }

  function normalizeCommissionAmount(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  async function openRequestDetailModal(reqId) {
  let req = state.approvals.find(r => r.id === reqId);
  if (!req) return;

  // SURGICAL FIX 2026-08-22: the routine list/poll sync now reads from a
  // stripped-down view (egress fix) that replaces photo/field-note bytes
  // with lightweight placeholders — the in-memory copy from state.approvals
  // may not carry the real image data. Fetch the single full record fresh
  // before showing details/wiring the Approve action, so the photo preview
  // AND the actual payload used to approve are always complete — this is
  // also what keeps the approve flow from ever posting a stripped photo to
  // a customer record. Scoped to only the request types that can actually
  // carry these heavy fields, so other types don't pay an extra round trip.
  if (gateway.approvals?.getApprovalRequestById && (req.type === 'account_opening' || req.type === 'customer_credit_journal' || req.type === 'customer_debit_journal')) {
    try {
      const full = await gateway.approvals.getApprovalRequestById(reqId);
      if (full?.ok && full.data) {
        req = { ...req, ...full.data };
        const idx = state.approvals.findIndex(r => r.id === reqId);
        if (idx !== -1) state.approvals[idx] = req;
      }
    } catch (err) {
      console.warn('[DUCESS] Full request fetch failed, showing list-level data', err);
    }
  }

  const p = req.payload || {};
  const esc = (v) => String(v ?? '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const field = (label, value, cls = '') =>
    `<div class="field ${cls}"><label>${label}</label><div class="display-field">${esc(value)}</div></div>`;

  const customer = state.customers.find(c => c.id === p.customerId);
  const photoSrc = p.photo || p.photoRef || p.photo_path || '';
  const photoBlock = `<div class="approval-photo-stack"><button type="button" class="secondary" id="approvalPhotoToggle">Display Picture</button><div class="approval-photo-panel hidden" id="approvalPhotoPanel"><div class="photo-box approval-photo-box">${photoSrc ? `<img src="${photoSrc}" alt="customer photo">` : '<span>No Photo</span>'}</div></div></div>`;

  let html = '';

  if (req.type === 'account_opening') {
    const acctType = p.accountType || 'customer';
    const isCustomer = acctType === 'customer';
    const acctTypeLabels = { customer: 'Customer Account', staff_operational: 'Teller Account', staff_salary: 'Staff Salary Account', expense: 'Expense Account', income: 'Income Account' };
    // SURGICAL PATCH 2026-08-14: same change as approvalAccountHeadingsInline
    // above — approver sees the number Customer Service already assigned,
    // never types or edits it here.
    // SURGICAL PATCH 2026-08-24: system-assigned types now get their number
    // at creation time too, same as customer accounts.
    const assignBlock = field('Account Number', p.generatedAccountNumber || 'Not assigned — return to Customer Service', 'field-account');

    html = `<div class="stack approval-opening-linear">
      ${field('Account Type', acctTypeLabels[acctType] || acctType, 'field-wide')}
      ${field('Name / Display Name', p.fullName || p.name, 'field-wide')}
      ${isCustomer ? field('Phone', p.phone, 'field-phone') : ''}
      ${isCustomer ? field('Address', p.address, 'field-wide') : ''}
      ${isCustomer ? field('NIN', p.nin, 'field-id') : ''}
      ${isCustomer ? field('BVN', p.bvn, 'field-bvn') : ''}
      ${acctType === 'staff_operational' ? field('Linked Staff', p.linkedStaffName || p.linkedStaffId || '—', 'field-wide') : ''}
      ${assignBlock}
      ${isCustomer ? photoBlock : ''}
    </div>`;
  } else if (req.type === 'account_maintenance') {
    const patch = p.patch || {};
    html = `<div class="stack"><div class="form-grid two modal-cs-grid">
      ${field('Customer Name', customer?.name || patch.name, 'field-wide')}
      ${field('Account Number', p.accountNumber, 'field-account')}
      ${field('Current Status', customerStatusLabel(customer), 'field-status')}
      ${field('Old Account Number', patch.oldAccountNumber, 'field-account')}
      ${field('Updated Name', patch.name, 'field-wide')}
      ${field('Updated Phone', patch.phone, 'field-phone')}
      ${field('Updated Address', patch.address, 'field-wide')}
      ${field('Updated NIN', patch.nin, 'field-id')}
      ${field('Updated BVN', patch.bvn, 'field-bvn')}
    </div>${photoBlock}</div>`;
  } else if (req.type === 'customer_credit_journal' || req.type === 'customer_debit_journal') {
    const rows = Array.isArray(p.rows) ? p.rows : Array.isArray(p.entries) ? p.entries : [];
    const total = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const totalCharges = rows.reduce((sum, row) => sum + getTotalChargeAmount(row), 0);
    const rowHtml = rows.map((row, idx) => {
      const chargeText = req.type === 'customer_credit_journal' ? chargeInlineMeta(row) : '';
      const detailsText = [row.details || '', chargeText].filter(Boolean).join(' • ');
      return `<tr>
        <td>${idx + 1}</td>
        <td>${esc(row.customerName || customerName(row.customerId) || '—')}</td>
        <td>${esc(row.accountNumber || '—')}</td>
        <td>${money(row.amount)}</td>
        <td>${esc(row.receivedOrPaidBy || row.paidTo || '')}</td>
        <td>${esc(row.payoutSource || row.paymentMode || '')}</td>
        <td>${esc(detailsText || '—')}</td>
      </tr>`;
    }).join('');
    const note = p.fieldNote;
    const noteBlock = note ? `<div class="note">Field note attached: ${esc(note.name || 'Attached file')}</div>` : '';
    html = `<div class="stack">
      <div class="form-grid three modal-cs-grid">
        ${field('Business Date', p.date || p.businessDate || '—', 'field-date')}
        ${field('Items', rows.length, 'field-account')}
        ${field('Total Amount', money(total), 'field-account')}
        ${field('Journal Form Amount', `${money(p.formAmount || 0)} (${p.formPaymentMode === 'transfer' ? 'Transfer' : 'Cash'})`, 'field-account')}
        ${req.type === 'customer_credit_journal' ? field('Total Charges', money(totalCharges), 'field-account') : ''}
      </div>
      <div class="table-wrap"><table class="table"><thead><tr><th>S/N</th><th>Account Name</th><th>Account Number</th><th>Amount</th><th>${req.type === 'customer_credit_journal' ? 'Received By' : 'Paid To'}</th><th>Mode</th><th>Details</th></tr></thead><tbody>${rowHtml || '<tr><td colspan="7" class="muted">No journal entries</td></tr>'}</tbody></table></div>
      ${noteBlock}
    </div>`;
  } else if (req.type === 'account_reactivation') {
    html = `<div class="stack"><div class="form-grid two modal-cs-grid">
      ${field('Customer Name', customer?.name, 'field-wide')}
      ${field('Account Number', p.accountNumber, 'field-account')}
      ${field('Current Status', customerStatusLabel(customer), 'field-status')}
      ${field('Requested Action', 'Reactivate Account', 'field-submit')}
    </div>${photoBlock}</div>`;
  } else if (req.type === 'intra_bank_transfer') {
    html = `<div class="stack"><div class="form-grid three modal-cs-grid">
      ${field('Teller', p.staffName || '—', 'field-wide')}
      ${field('Date', p.date || '—', 'field-date')}
      ${field('Amount', money(p.amount || 0), 'field-account')}
      ${field('From — Debit', `${p.sourceAccountName || '—'} (${p.sourceAccountNumber || '—'})`, 'field-wide')}
      ${field('To — Credit', `${p.destAccountName || '—'} (${p.destAccountNumber || '—'})`, 'field-wide')}
      ${p.details ? field('Narration', p.details, 'field-wide') : ''}
    </div></div>`;
  } else if (req.type === 'cash_receipt') {
    html = `<div class="stack"><div class="form-grid three modal-cs-grid">
      ${field('Treasury', p.staffName || '—', 'field-wide')}
      ${field('Date', p.date || '—', 'field-date')}
      ${field('Amount', money(p.amount || 0), 'field-account')}
      ${field('Payment Mode', p.paymentMode || 'cash', 'field-account')}
      ${p.note ? field('Note', p.note, 'field-wide') : ''}
    </div></div>`;
  } else if (req.type === 'inter_staff_credit') {
    html = `<div class="stack"><div class="form-grid three modal-cs-grid">
      ${field('From (Treasury)', p.staffName || '—', 'field-wide')}
      ${field('To (Account)', `${p.targetAccountName || '—'} (${p.targetAccountNumber || '—'})`, 'field-wide')}
      ${field('Date', p.date || '—', 'field-date')}
      ${field('Amount', money(p.amount || 0), 'field-account')}
      ${field('Payment Mode', p.paymentMode || 'cash', 'field-account')}
      ${p.note ? field('Note', p.note, 'field-wide') : ''}
    </div></div>`;
  } else {
    html = `<pre>${esc(JSON.stringify(p, null, 2))}</pre>`;
  }

  const actions = [{ label: 'Close', className: 'secondary', onClick: closeModal }];

  if (req.status === 'pending') {
    actions.unshift({
      label: 'Reject',
      className: 'danger',
      onClick: async () => {
        closeModal();
        showProcessing('Rejecting request...');
        await nextPaint();

        try {
          if (isApprovalLockedByOther(req.id)) {
            hideProcessing();
            showToast('This request is being reviewed by another staff');
            return;
          }
          const result = await rejectRequestRemote(req.id);

          if (result?.ok === false) {
            hideProcessing();
            showToast(result?.error?.message || 'Unable to reject request');
            return;
          }
          showToast('Request rejected');
        } finally {
          hideProcessing();
        }
      }
    });

    actions.unshift({
      label: 'Approve',
      className: 'success',
      onClick: async () => {
        if (req.type === 'account_opening') {
          const acctType = req.payload?.accountType || 'customer';
          // SURGICAL PATCH 2026-08-14: the approver used to be able to type
          // in the account number themselves via #approvalAssignAccount if
          // Customer Service left it blank. That input no longer exists —
          // Customer Service must assign it at Account Opening. If it's
          // somehow still missing here, block the approval instead of
          // silently letting it through unassigned.
          if (acctType === 'customer' && !String(req.payload?.generatedAccountNumber || '').trim()) {
            return showToast('No account number assigned. Return this request to Customer Service.');
          }
          // staff_operational, staff_salary, expense, income — system-assigned via RPC
        }

        closeModal();
        showProcessing('Approving request...');
        await nextPaint();

        try {
          if (isApprovalLockedByOther(req.id)) {
            hideProcessing();
            showToast('This request is being reviewed by another staff');
            return;
          }
          const result = await approveRequestRemote(req.id, req.payload);

          if (result?.ok === false) {
            hideProcessing();
            showToast(result?.error?.message || 'Unable to approve request');
            return;
          }
          showToast('Request approved');
        } finally {
          hideProcessing();
        }
      }
    });
  }

  openModal(prettyApprovalType(req.type), html, actions);

  const btn = byId('approvalPhotoToggle');
  if (btn) btn.onclick = () => byId('approvalPhotoPanel')?.classList.toggle('hidden');
}


function nextPaint() {
  return new Promise(resolve =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => resolve())
    )
  );
}

  function renderPermissions() {
    const tools = ['check_balance','account_opening','account_maintenance','account_reactivation','account_statement','credit','debit','approval_queue','business_balance'];
    return `
      <div class="stack">
        <div class="table-card">
          <h3>Administrative Working Tools</h3>
          <div class="table-wrap"><table class="table"><thead><tr><th>S/N</th><th>Staff</th><th>Office</th>${tools.map(t=>`<th>${TOOL_LABELS[t]}</th>`).join('')}</tr></thead>
          <tbody>${state.staff.map((s,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(s.name || '')}</td><td>${ROLE_LABELS[s.role] || s.role}</td>${tools.map(t=>`<td>${hasPermission(t,s)?'YES':'NO'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        </div>
        <div class="form-card">
          <h3>Temporary Access Grant</h3>
          <div class="form-grid three">
            <div class="field"><label>Staff</label><select id="grantStaff" class="entry-input">${state.staff.map(s=>`<option value="${s.id}">${escapeHtml(s.name || '')}</option>`).join('')}</select></div>
            <div class="field"><label>Tool</label><select id="grantTool" class="entry-input">${Object.keys(TOOL_LABELS).map(t=>`<option value="${t}">${TOOL_LABELS[t]}</option>`).join('')}</select></div>
            <div class="field"><label>Switch</label><select id="grantEnabled" class="entry-input"><option value="true">Grant Access</option><option value="false">Switch Off</option></select></div>
          </div>
          <div class="action-row"><button id="grantSubmit">Send Grant Request</button></div>
        </div>
      </div>`;
  }

  function renderOperationalPosting() {
    const allAccts = [
      ...state.operations.incomeAccounts.map(a=>({...a,category:'income'})),
      ...state.operations.expenseAccounts.map(a=>({...a,category:'expense'}))
    ];
    return `
      <div class="stack">
        <div class="form-card">
          <h3>Income & Expense Posting</h3>
          <div class="form-grid three">
            <div class="field"><label>Account</label><select id="oeAccount" class="entry-input">${allAccts.map(a=>`<option value="${a.id}">${escapeHtml(a.accountNumber || '')} — ${escapeHtml(a.name || '')}</option>`).join('')}</select></div>
            <div class="field"><label>Amount</label><input id="oeAmount" class="entry-input" type="number"></div>
            <div class="field"><label>Date</label><input id="oeDate" class="entry-input" type="date" lang="en-GB" value="${businessDate()}"></div>
            <div class="field"><label>Note</label><input id="oeNote" class="entry-input"></div>
            <div class="field"><label>Type</label><div class="display-field" id="oeKindDisplay">Auto from account</div></div>
          </div>
          <div class="action-row compact-action-row"><button id="oeSubmit" class="tiny-btn">Submit for Approval</button></div>
        </div>
      </div>`;
  }

  function operationalAccountTotals(a) {
    const entries = state.operations.entries.filter(e => e.accountId === a.id);
    const totalCredit = entries.filter(e => e.kind === 'income').reduce((s,e)=>s+Number(e.amount||0),0);
    const totalDebit = entries.filter(e => e.kind === 'expense').reduce((s,e)=>s+Number(e.amount||0),0);
    return { totalDebit, totalCredit, balance: totalCredit - totalDebit };
  }

  function operationalBalanceTable(title, accounts) {
    const sorted = [...accounts].sort((a,b)=> String(a.accountNumber||'').localeCompare(String(b.accountNumber||''), undefined, {numeric:true}));
    let grandBalance = 0, grandDebit = 0, grandCredit = 0;
    const rows = sorted.map((a,i) => {
      const t = operationalAccountTotals(a);
      grandDebit += t.totalDebit; grandCredit += t.totalCredit; grandBalance += t.balance;
      return `<tr><td>${i+1}</td><td>${escapeHtml(a.name)}</td><td>${money(t.totalDebit)}</td><td>${money(t.totalCredit)}</td><td>${money(t.balance)}</td><td>${fmtDate(a.createdAt)}</td></tr>`;
    }).join('');
    return `<div class="table-card"><h3>${title}</h3><div class="table-wrap"><table class="table"><thead><tr><th>S/N</th><th>Account Name</th><th>Total Debit</th><th>Total Credit</th><th>Balance</th><th>Start Date</th></tr></thead><tbody>${rows || `<tr><td colspan="6">No accounts</td></tr>`}<tr class="total-row"><td colspan="2"><strong>Total</strong></td><td><strong>${money(grandDebit)}</strong></td><td><strong>${money(grandCredit)}</strong></td><td><strong>${money(grandBalance)}</strong></td><td></td></tr></tbody></table></div></div>`;
  }

  function renderOperationalAccounts() {
    const allAccts = [
      ...state.operations.incomeAccounts.map(a=>({...a,category:'income'})),
      ...state.operations.expenseAccounts.map(a=>({...a,category:'expense'}))
    ];
    return `
      <div class="stack">
        <div class="layout-grid two">
          ${currentStaff()?.role === 'admin_officer' ? `<div class="form-card">
            <h3>Create Account</h3>
            <div class="form-grid three">
              <div class="field"><label>Category</label><select id="oaCategory" class="entry-input"><option value="income">Income</option><option value="expense">Expense</option></select></div>
              <div class="field"><label>Account Name</label><input id="oaName" class="entry-input"></div>
              <div class="field"><label>Account Number</label><div class="display-field" id="oaNumberPreview">I1</div></div>
            </div>
            <div class="action-row compact-action-row"><button id="oaCreate" class="tiny-btn">Submit for Approval</button></div>
          </div>` : ''}
          <div class="form-card">
            <h3>Post into Account</h3>
            <div class="form-grid three">
              <div class="field"><label>Account</label><select id="oeAccount" class="entry-input">${allAccts.map(a=>`<option value="${a.id}">${escapeHtml(a.accountNumber || '')} — ${escapeHtml(a.name || '')}</option>`).join('')}</select></div>
              <div class="field"><label>Amount</label><input id="oeAmount" class="entry-input" type="number"></div>
              <div class="field"><label>Date</label><input id="oeDate" class="entry-input" type="date" lang="en-GB" value="${businessDate()}"></div>
              <div class="field"><label>Note</label><input id="oeNote" class="entry-input"></div>
              <div class="field"><label>Type</label><div class="display-field" id="oeKindDisplay">Auto from account</div></div>
            </div>
            <div class="action-row compact-action-row"><button id="oeSubmit" class="tiny-btn">Submit for Approval</button></div>
          </div>
        </div>
        ${operationalBalanceTable("All Income Balance", state.operations.incomeAccounts)}
        ${operationalBalanceTable("All Expense Balance", state.operations.expenseAccounts)}
      </div>`;
  }

  function renderCustomerDirectory() {
    const search = String(state.ui.customerDirectorySearch || '').trim().toLowerCase();
    const customers = [...(state.customers || [])]
      .filter(c => String(c.accountType || 'customer') !== 'staff_wallet')
      .sort((a,b)=> String(a.accountNumber||'').localeCompare(String(b.accountNumber||''), undefined, {numeric:true}));
    const filteredCustomers = search
      ? customers.filter(c => [c.name, c.accountNumber, c.phone, c.email].some(value => String(value || '').toLowerCase().includes(search)))
      : customers;
    const totalCustomers = customers.length;
    let grandBalance = 0, grandDebit = 0, grandCredit = 0;
    const bodyRows = filteredCustomers.map((c,i)=>{
      const credits = (c.transactions || []).filter(tx => tx.type === 'credit').reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
      const debits = (c.transactions || []).filter(tx => tx.type === 'debit').reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
      grandCredit += credits; grandDebit += debits; grandBalance += Number(c.balance || 0);
      const frozen = isCustomerFrozen(c);
      const inactive = c.active === false;
      const statusLabel = inactive ? 'Removed' : frozen ? 'Frozen' : 'Active';
      const statusColor = inactive ? '#fee2e2' : frozen ? '#fef9c3' : '#d1fae5';
      const statusText = inactive ? '#991b1b' : frozen ? '#854d0e' : '#065f46';
      return `<tr style="${inactive ? 'opacity:0.5' : ''}"><td>${i+1}</td><td>${escapeHtml(c.name)}</td><td>${c.accountNumber || '—'}</td><td>${money(debits)}</td><td>${money(credits)}</td><td>${money(Number(c.balance || 0))}</td><td>${fmtDate(c.createdAt)}</td><td><span style="padding:1px 6px;border-radius:8px;font-size:0.8em;background:${statusColor};color:${statusText}">${statusLabel}</span></td><td>${!inactive ? `<button class="secondary" style="font-size:10px;padding:3px 8px" data-remove-customer="${c.id}">Remove</button>` : '<span style="font-size:10px;color:var(--muted)">Removed</span>'}</td></tr>`;
    }).join('');
    return `
      <div class="stack">
        <div class="kpi-row balance-kpi-row">
          <div class="kpi"><div class="label">Total Customers</div><div class="number">${totalCustomers}</div></div>
        </div>
        <div class="table-card">
          <div class="action-inline"><h3 style="margin:0">All Customers' Balance</h3></div>
          <div class="form-grid one" style="margin-top:12px">
            <div class="field"><label>Search Customer</label><input id="customerDirectorySearch" class="entry-input" placeholder="Search by name, account number, phone or email" value="${escapeHtml(state.ui.customerDirectorySearch || '')}"></div>
          </div>
          <div class="table-wrap"><table class="table"><thead><tr><th>S/N</th><th>Account Name</th><th>Account Number</th><th>Total Debit</th><th>Total Credit</th><th>Balance</th><th>Start Date</th><th>Status</th><th>Action</th></tr></thead><tbody>${bodyRows || '<tr><td colspan="9">No matching customers</td></tr>'}${filteredCustomers.length ? `<tr class="total-row"><td colspan="3"><strong>Total</strong></td><td><strong>${money(grandDebit)}</strong></td><td><strong>${money(grandCredit)}</strong></td><td><strong>${money(grandBalance)}</strong></td><td colspan="3"></td></tr>` : ''}</tbody></table></div>
          <div class="action-row" style="margin-top:14px"><button id="customerDirectoryCloseBtn" class="secondary">Collapse Directory</button></div>
        </div>
      </div>`;
  }

  function renderStaffRoster() {
    state.ui.staffDirectorySearch = state.ui.staffDirectorySearch || '';
    const search = String(state.ui.staffDirectorySearch || '').trim().toLowerCase();
    const filtered = state.staff.filter((s) => {
      const staffCode = String(s.staffCode || s.staff_code || s.id || '').toLowerCase();
      const staffName = String(s.name || s.full_name || '').toLowerCase();
      return !search || staffName.includes(search) || staffCode.includes(search);
    }).sort((a,b) => String(a.name || a.full_name || '').localeCompare(String(b.name || b.full_name || '')));
    const bodyRows = filtered.map((s, i) => {
      const staffCode = s.staffCode || s.staff_code || s.id || '—';
      const staffName = s.name || s.full_name || '—';
      const staffRole = s.role || s.role_code || '';
      const isActive = s.active !== false && s.is_active !== false;
      const acc = ensureStaffAccount(s.id);
      return `<tr><td>${i+1}</td><td>${escapeHtml(staffName)}</td><td><code style="font-size:0.85em">${escapeHtml(String(staffCode))}</code> <button class="secondary tiny-btn" data-staff-edit-code="${s.id}" title="Staff ID is manager-assigned — must stay unique">Edit ID</button></td><td><code style="font-size:0.85em">${escapeHtml(String(acc.accountNumber || '—'))}</code></td><td>${ROLE_LABELS[staffRole] || staffRole}</td><td><span style="padding:2px 8px;border-radius:10px;font-size:0.8em;background:${isActive?'#d1fae5':'#fee2e2'};color:${isActive?'#065f46':'#991b1b'}">${isActive ? 'Active' : 'Inactive'}</span></td><td><button class="secondary" data-staff-ledger="${s.id}">Ledger</button>${isAdminStaff() ? `<button class="secondary" data-staff-reset-password="${s.id}">Reset Password</button>` : ''}<button class="secondary" data-staff-toggle="${s.id}">${isActive ? 'Deactivate' : 'Reactivate'}</button></td></tr>`;
    }).join('');
    return `
      <div class="table-card">
        <div class="action-inline"><h3 style="margin:0">Staff Directory</h3><button id="adminRecoveryKeyBtn" class="secondary tiny-btn" title="Generate or regenerate Admin recovery key">Recovery Key</button><button id="addStaffBtn">ADD STAFF</button></div>
        ${isAdminStaff() ? `<div class="note" style="display:flex;align-items:center;gap:8px;justify-content:space-between;margin:6px 0;padding:7px 10px"><span><strong>Admin Security:</strong> Generate or regenerate the Admin Recovery Key for password recovery.</span><button id="adminRecoveryKeyInlineBtn" class="secondary tiny-btn">Generate / Regenerate Recovery Key</button></div>` : ''}
        <div class="action-row" style="justify-content:flex-start;gap:6px;align-items:center;margin:6px 0">
          <input id="staffDirectorySearch" class="entry-input" value="${escapeHtml(state.ui.staffDirectorySearch || '')}" placeholder="Search staff" style="height:24px;max-width:160px;font-size:0.78em;padding:2px 8px">
        </div>
        <div class="table-wrap"><table class="table"><thead><tr><th>S/N</th><th>Full Name</th><th>Staff ID</th><th>Account Number</th><th>Role</th><th>Status</th><th>Action</th></tr></thead><tbody>${bodyRows || '<tr><td colspan="7">No staff found</td></tr>'}</tbody></table></div>
      </div>`;
  }

  // REDESIGN 2026-08-14: "All Staff Balance" (wallet/float balance for every
  // staff regardless of role) and the separate "Staff Salary Balance" report
  // were two different balance views under confusingly similar names. Staff
  // management actions (Add Staff, Ledger, Reset Password, Deactivate,
  // Recovery Key) already live on "Staff Directory" (renderStaffRoster,
  // above) — nothing unique here needed preserving except the wallet balance
  // table, which is exactly the source of the confusion. So this tool is now
  // fully repurposed: it shows ONLY staff_salary account balances. Role
  // classification was removed 2026-08-14 (client didn't need the filter) —
  // search by account number instead.
  // "Teller Balances" remains its own separate, unambiguous report for
  // operational T#### accounts only.
  function renderStaffDirectory() {
    state.ui.staffSalarySearch = state.ui.staffSalarySearch || '';
    const search = String(state.ui.staffSalarySearch || '').trim();
    const loading = state.ui.staffSalaryBalanceLoading;
    const rows = state.ui.staffSalaryAccountsCache || [];
    const filtered = rows.filter(r => !search || String(r.accountNumber||'').includes(search) || String(r.name||'').toLowerCase().includes(search.toLowerCase()));
    const grandBalance = filtered.reduce((s, r) => s + Number(r.balance || 0), 0);
    const bodyRows = filtered.map((r, i) => `<tr><td>${i+1}</td><td>${escapeHtml(r.name || '—')}</td><td><code style="font-size:0.85em">${escapeHtml(String(r.accountNumber || '—'))}</code></td><td>${money(r.balance)}</td><td>${fmtDate(r.createdAt)}</td><td><span style="padding:2px 8px;border-radius:10px;font-size:0.8em;background:${r.active?'#d1fae5':'#fee2e2'};color:${r.active?'#065f46':'#991b1b'}">${r.active ? 'Active' : 'Inactive'}</span></td></tr>`).join('');
    return `
      <div class="table-card">
        <div class="action-inline"><h3 style="margin:0">Staff Salary Balance</h3></div>
        <div class="note" style="margin:6px 0">Shows Staff Salary account balances. Teller operational balances are on the separate "Teller Balances" report.</div>
        <div class="action-row" style="justify-content:flex-start;gap:6px;align-items:center;margin:6px 0">
          <input id="staffSalarySearch" class="entry-input" value="${escapeHtml(state.ui.staffSalarySearch || '')}" placeholder="Search by account number or name" style="height:24px;max-width:220px;font-size:0.78em;padding:2px 8px">
          ${loading ? '<span class="muted" style="font-size:0.8em">Loading…</span>' : ''}
        </div>
        <div class="table-wrap"><table class="table"><thead><tr><th>S/N</th><th>Account Name</th><th>Account Number</th><th>Balance</th><th>Opened</th><th>Status</th></tr></thead><tbody>${bodyRows || `<tr><td colspan="6">${loading ? 'Loading…' : 'No staff salary accounts found'}</td></tr>`}${filtered.length ? `<tr class="total-row"><td colspan="3"><strong>Total</strong></td><td><strong>${money(grandBalance)}</strong></td><td colspan="2"></td></tr>` : ''}</tbody></table></div>
      </div>`;
  }

  function renderOverallBalance() {
    // Overall Balance is a rollup of the OTHER balance categories — not another
    // per-account or staff-balance listing. Each row here is a category total.
    let customerDebit = 0, customerCredit = 0, customerBalance = 0;
    (state.customers || []).filter(c => String(c.accountType || 'customer') !== 'staff_wallet').forEach(c => {
      customerCredit += (c.transactions || []).filter(tx => tx.type === 'credit').reduce((s,tx)=>s+Number(tx.amount||0),0);
      customerDebit += (c.transactions || []).filter(tx => tx.type === 'debit').reduce((s,tx)=>s+Number(tx.amount||0),0);
      customerBalance += Number(c.balance||0);
    });
    let staffDebit = 0, staffCredit = 0, staffBalance = 0;
    (state.staff || []).forEach(s => {
      const acc = ensureStaffAccount(s.id);
      const wallet = (state.customers || []).find(c => c.id === acc.linkedCustomerId);
      staffCredit += (wallet?.transactions || []).filter(tx => tx.type === 'credit').reduce((s2,tx)=>s2+Number(tx.amount||0),0);
      staffDebit += (wallet?.transactions || []).filter(tx => tx.type === 'debit').reduce((s2,tx)=>s2+Number(tx.amount||0),0);
      staffBalance += Number(acc.balance||0);
    });
    let incomeDebit = 0, incomeCredit = 0, incomeBalance = 0;
    (state.operations.incomeAccounts || []).forEach(a => {
      const t = operationalAccountTotals(a);
      incomeDebit += t.totalDebit; incomeCredit += t.totalCredit; incomeBalance += t.balance;
    });
    let expenseDebit = 0, expenseCredit = 0, expenseBalance = 0;
    (state.operations.expenseAccounts || []).forEach(a => {
      const t = operationalAccountTotals(a);
      expenseDebit += t.totalDebit; expenseCredit += t.totalCredit; expenseBalance += t.balance;
    });
    const categories = [
      { name: "All Customers' Balance", totalDebit: customerDebit, totalCredit: customerCredit, balance: customerBalance },
      { name: 'All Staff Balance', totalDebit: staffDebit, totalCredit: staffCredit, balance: staffBalance },
      { name: 'Income Balance', totalDebit: incomeDebit, totalCredit: incomeCredit, balance: incomeBalance },
      { name: 'Expense Balance', totalDebit: expenseDebit, totalCredit: expenseCredit, balance: expenseBalance }
    ];
    const grandDebit = categories.reduce((s,c)=>s+c.totalDebit,0);
    const grandCredit = categories.reduce((s,c)=>s+c.totalCredit,0);
    const grandBalance = categories.reduce((s,c)=>s+c.balance,0);
    const bodyRows = categories.map((c,i) =>
      `<tr><td>${i+1}</td><td>${escapeHtml(c.name)}</td><td>${money(c.totalDebit)}</td><td>${money(c.totalCredit)}</td><td>${money(c.balance)}</td></tr>`
    ).join('');
    return `<div class="stack"><div class="table-card"><h3>Overall Balance</h3><div class="note">The company's entire truth — the balance of every other balance category, rolled up into one business total.</div><div class="table-wrap"><table class="table"><thead><tr><th>S/N</th><th>Balance Category</th><th>Total Debit</th><th>Total Credit</th><th>Balance</th></tr></thead><tbody>${bodyRows}<tr class="total-row"><td colspan="2"><strong>Overall Balance of the Business</strong></td><td><strong>${money(grandDebit)}</strong></td><td><strong>${money(grandCredit)}</strong></td><td><strong>${money(grandBalance)}</strong></td></tr></tbody></table></div></div></div>`;
  }

  function renderBusinessBalance() {
    const rawBusiness = filterByDate(flattenBusinessEntries(), state.ui.businessFilter || { preset: 'daily', from: '', to: '' });
    const typeFilter = state.ui.businessType || 'all';
    const filtered = rawBusiness.filter(t => typeFilter==='all' ? true : t.kind===typeFilter);
    const credits = filtered.filter(t => t.kind === 'credit').reduce((s,t)=>s+Number(t.amount||0),0);
    const debits = filtered.filter(t => t.kind === 'debit').reduce((s,t)=>s+Number(t.amount||0),0);
    return `
      <div class="stack business-balance-stack">
        ${renderBalanceFilters('business')}
        <div class="kpi-row compact-page-kpi-row business-balance-kpis">
          <div class="kpi compact-page-kpi"><div class="label">Total Credit</div><div class="number">${money(credits)}</div></div>
          <div class="kpi compact-page-kpi"><div class="label">Total Debit</div><div class="number">${money(debits)}</div></div>
          <div class="kpi compact-page-kpi"><div class="label">Entries</div><div class="number">${filtered.length}</div></div>
          <div class="kpi compact-page-kpi"><div class="label">Net Book Balance</div><div class="number">${money(credits-debits)}</div></div>
        </div>
        <div class="table-card"><h3>Business Entries</h3><div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Account</th><th>Details</th><th>Debit</th><th>Credit</th><th>Balance</th><th>Received/Paid By</th><th>Posted By</th><th>Approved By</th></tr></thead><tbody>${filtered.slice(0,state.ui.businessEntriesLimit || 20).map(t=>`<tr><td>${fmtDate(t.date)}</td><td>${escapeHtml(t.accountNumber || '—')}</td><td>${escapeHtml(t.details || '')}</td><td>${t.kind==='debit'?money(t.amount):''}</td><td>${t.kind==='credit'?money(t.amount):''}</td><td>${money(t.balanceAfter || 0)}</td><td>${escapeHtml(t.receivedOrPaidBy || '—')}</td><td>${escapeHtml(t.postedBy || '—')}</td><td>${escapeHtml(t.approvedBy || '—')}</td></tr>`).join('') || '<tr><td colspan="9">No entries</td></tr>'}</tbody></table></div><div class="action-row">${filtered.length > (state.ui.businessEntriesLimit || 20) ? `<button id="businessMore" class="secondary">Show More</button>` : ''}${(state.ui.businessEntriesLimit || 20) > 20 ? `<button id="businessLess" class="secondary">Show Less</button>` : ''}</div></div>
      </div>`;
  }

  function renderOperationalBalance() {
    const filtered = getOperationalFilteredRows();
    const income = filtered.filter(e=>e.kind==='income');
    const expense = filtered.filter(e=>e.kind==='expense');
    return `
      <div class="stack operational-balance-stack">
        ${renderBalanceFilters('operational')}
        <div class="kpi-row compact-page-kpi-row operational-balance-kpis">
          <div class="kpi compact-page-kpi"><div class="label">Total Income</div><div class="number">${money(income.reduce((s,e)=>s+Number(e.amount||0),0))}</div></div>
          <div class="kpi compact-page-kpi"><div class="label">Total Expense</div><div class="number">${money(expense.reduce((s,e)=>s+Number(e.amount||0),0))}</div></div>
          <div class="kpi compact-page-kpi"><div class="label">Net Operational</div><div class="number">${money(income.reduce((s,e)=>s+Number(e.amount||0),0)-expense.reduce((s,e)=>s+Number(e.amount||0),0))}</div></div>
          <div class="kpi compact-page-kpi"><div class="label">Entries</div><div class="number">${filtered.length}</div></div>
        </div>
        <div class="table-card"><h3>Operational Entries</h3><div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Account</th><th>Type</th><th>Amount</th><th>Note</th><th>Posted By</th><th>Approved By</th></tr></thead><tbody>${filtered.slice(0,state.ui.operationalEntriesLimit || 20).map(e=>`<tr><td>${fmtDate(e.date)}</td><td>${escapeHtml(e.accountName || '')}</td><td>${escapeHtml(e.kind || '')}</td><td>${money(e.amount)}</td><td>${escapeHtml(cleanOperationalNote(e.note || e.details) || '—')}</td><td>${escapeHtml(e.postedBy || '')}</td><td>${escapeHtml(e.approvedBy || '')}</td></tr>`).join('') || '<tr><td colspan="7">No entries</td></tr>'}</tbody></table></div><div class="action-row">${filtered.length > (state.ui.operationalEntriesLimit || 20) ? `<button id="operationalMore" class="secondary">Show More</button>` : ''}${(state.ui.operationalEntriesLimit || 20) > 20 ? `<button id="operationalLess" class="secondary">Show Less</button>` : ''}</div></div>
      </div>`;
  }

  
  function getOperationalFilteredRows() {
    const rawOperational = filterByDate(state.operations.entries || [], state.ui.operationalFilter || { preset: 'daily', from: '', to: '' });
    const kindFilter = state.ui.operationalType || 'all';
    return rawOperational.filter(e => kindFilter==='all' ? true : e.kind===kindFilter);
  }

  function buildOperationalStatementRows() {
    const filtered = [...getOperationalFilteredRows()].sort((a,b)=>new Date(a.date)-new Date(b.date));
    let runningBalance = 0;
    return filtered.map((e, idx) => {
      const amount = Number(e.amount || 0);
      const type = String(e.kind || e.type || '').toLowerCase();
      runningBalance += type === 'income' ? amount : -amount;
      return {
        sn: idx + 1,
        date: fmtDate(e.date),
        type,
        accountName: e.accountName || e.account || '—',
        amount,
        note: cleanOperationalNote(e.note || e.details) || '',
        details: cleanOperationalNote(e.details || e.note) || '',
        balanceAfter: runningBalance,
        receivedOrPaidBy: e.receivedOrPaidBy || e.postedBy || '—',
        postedBy: e.postedBy || '—',
        approvedBy: e.approvedBy || '—'
      };
    });
  }

  function getOperationalStatementSummary(rows) {
    const totalIncome = rows.filter(r=>r.type==='income').reduce((s,r)=>s+Number(r.amount||0),0);
    const totalExpense = rows.filter(r=>r.type==='expense').reduce((s,r)=>s+Number(r.amount||0),0);
    return {
      totalIncome,
      totalExpense,
      netOperationalBalance: totalIncome - totalExpense,
      totalAmount: rows.reduce((s,r)=>s+Number(r.amount||0),0)
    };
  }

  
  function exportOperationalStatementCsv() {
    const rows = buildOperationalStatementRows();
    const summary = getOperationalStatementSummary(rows);
    const activeFilter = String(state.ui.operationalType || 'all').toLowerCase();

    const csvRows = [
      ['S/N','DATE','TYPE','ACCOUNT NAME','AMOUNT','DETAILS','BALANCE AFTER','POSTED BY','APPROVED BY'],
      ...rows.map(r => [
        r.sn,
        `‌${r.date || ''}`,
        String(r.type || '').toUpperCase(),
        r.accountName,
        Number(r.amount || 0),
        r.details || r.note || '',
        Number(r.balanceAfter || 0),
        r.postedBy || '',
        r.approvedBy || ''
      ]),
      []
    ];

    if (activeFilter === 'all') {
      csvRows.push(['', '', '', 'TOTAL INCOME', Number(summary.totalIncome || 0), '', '', '', '']);
      csvRows.push(['', '', '', 'TOTAL EXPENSE', Number(summary.totalExpense || 0), '', '', '', '']);
      csvRows.push(['', '', '', 'NET BALANCE', Number(summary.netOperationalBalance || 0), '', '', '', '']);
    } else {
      csvRows.push(['', '', '', 'TOTAL AMOUNT', Number(summary.totalAmount || 0), '', '', '', '']);
    }

    exportCsv(csvRows, 'operational_balance.csv', true);
  }


  
  function printOperationalStatement() {
    const rows = buildOperationalStatementRows();
    const summary = getOperationalStatementSummary(rows);

    const bodyRows = rows.map(r => `
      <tr>
        <td>${r.sn}</td>
        <td>${r.date}</td>
        <td>${escapeHtml(String(r.type || '').toUpperCase())}</td>
        <td>${escapeHtml(r.accountName || '')}</td>
        <td>${money(r.amount)}</td>
        <td>${escapeHtml(r.note || '')}</td>
        <td>${money(r.balanceAfter)}</td>
        <td>${escapeHtml(r.postedBy || '')}</td>
        <td>${escapeHtml(r.approvedBy || '—')}</td>
      </tr>
    `).join('');

    const html = `
      <div class="statement-sheet operational-statement-sheet">
        <div class="statement-title">Operational Balance Statement</div>
        <div class="statement-summary-grid">
          <div class="statement-summary-item"><span>Total Income:</span> ${money(summary.totalIncome)}</div>
          <div class="statement-summary-item"><span>Total Expense:</span> ${money(summary.totalExpense)}</div>
          <div class="statement-summary-item"><span>Net Operational Balance:</span> ${money(summary.netOperationalBalance)}</div>
        </div>
        <div class="statement-rule"></div>
        <table class="statement-table operational-statement-table">
          <thead>
            <tr>
              <th>S/N</th>
              <th>Date</th>
              <th>Type</th>
              <th>Account Name</th>
              <th>Amount</th>
              <th>Note</th>
              <th>Balance After</th>
              <th>Posted By</th>
              <th>Approved By</th>
            </tr>
          </thead>
          <tbody>
            ${bodyRows || '<tr><td colspan="9">No entries</td></tr>'}
          </tbody>
        </table>
        <div class="statement-total"><strong>Total Amount:</strong> ${money(summary.totalAmount)}</div>
      </div>
    `;
    printHtml(html, true);
  }

  
  function getBusinessFilteredRows() {
    const rawBusiness = filterByDate(flattenBusinessEntries(), state.ui.businessFilter || { preset: 'daily', from: '', to: '' });
    const typeFilter = String(state.ui.businessType || 'all').toLowerCase();
    return rawBusiness.filter(e => {
      const rowType = String(e.type || e.kind || '').toLowerCase();
      return typeFilter === 'all' ? true : rowType === typeFilter;
    });
  }

  function buildBusinessStatementRows() {
    const filtered = [...getBusinessFilteredRows()].sort((a,b)=>new Date(a.date)-new Date(b.date));
    return filtered.map((e, idx) => {
      const txType = String(e.type || e.kind || '').toLowerCase();
      const normalizedType = txType === 'credit' || txType === 'debit'
        ? txType.toUpperCase()
        : (Number(e.delta || 0) >= 0 ? 'CREDIT' : 'DEBIT');
      return {
        sn: idx + 1,
        date: fmtDate(e.date),
        type: normalizedType,
        accountName: e.customer?.name || e.accountName || e.customerName || e.accountNumber || '—',
        amount: Number(e.amount || 0),
        details: cleanOperationalNote(e.details || e.note) || '',
        balanceAfter: Number(e.balanceAfter || 0),
        receivedOrPaidBy: e.receivedBy || e.receivedOrPaidBy || e.postedBy || '',
        postedBy: e.postedBy || '',
        approvedBy: e.approvedBy || ''
      };
    });
  }

  function getBusinessStatementSummary(rows) {
    const totalCredit = rows.filter(r => String(r.type).toLowerCase() === 'credit').reduce((s,r)=>s+Number(r.amount||0),0);
    const totalDebit = rows.filter(r => String(r.type).toLowerCase() === 'debit').reduce((s,r)=>s+Number(r.amount||0),0);
    return {
      totalCredit,
      totalDebit,
      netBookBalance: totalCredit - totalDebit,
      totalAmount: rows.reduce((s,r)=>s+Number(r.amount||0),0)
    };
  }

  function exportBusinessStatementCsv() {
    const rows = buildBusinessStatementRows();
    const summary = getBusinessStatementSummary(rows);
    const activeFilter = String(state.ui.businessType || 'all').toLowerCase();

    const csvRows = [
      ['S/N','DATE','TYPE','ACCOUNT NAME','AMOUNT','DETAILS','BALANCE AFTER','RECEIVED OR PAID BY','POSTED BY','APPROVED BY'],
      ...rows.map(r => [
        r.sn,
        `‌${r.date || ''}`,
        r.type,
        r.accountName,
        Number(r.amount || 0),
        r.details || '',
        Number(r.balanceAfter || 0),
        r.receivedOrPaidBy || '',
        r.postedBy || '',
        r.approvedBy || ''
      ]),
      []
    ];

    if (activeFilter === 'all') {
      csvRows.push(['', '', '', 'TOTAL CREDIT', Number(summary.totalCredit || 0), '', '', '', '', '']);
      csvRows.push(['', '', '', 'TOTAL DEBIT', Number(summary.totalDebit || 0), '', '', '', '', '']);
      csvRows.push(['', '', '', 'NET BALANCE', Number(summary.netBookBalance || 0), '', '', '', '', '']);
    } else {
      csvRows.push(['', '', '', 'TOTAL AMOUNT', Number(summary.totalAmount || 0), '', '', '', '', '']);
    }

    exportCsv(csvRows, 'business_balance.csv', true);
  }

  function printBusinessStatement() {
    const rows = buildBusinessStatementRows();
    const summary = getBusinessStatementSummary(rows);
    const bodyRows = rows.map(r => `
      <tr>
        <td>${r.sn}</td>
        <td>${r.date}</td>
        <td>${escapeHtml(r.type || '')}</td>
        <td>${escapeHtml(r.accountName || '')}</td>
        <td>${money(r.amount)}</td>
        <td>${escapeHtml(r.details || '')}</td>
        <td>${money(r.balanceAfter)}</td>
        <td>${escapeHtml(r.receivedOrPaidBy || '')}</td>
        <td>${escapeHtml(r.postedBy || '')}</td>
        <td>${escapeHtml(r.approvedBy || '—')}</td>
      </tr>
    `).join('');
    const html = `
      <div class="statement-sheet business-statement-sheet">
        <div class="statement-title">Business Balance Statement</div>
        <div class="statement-summary-grid">
          <div class="statement-summary-item"><span>Total Credit:</span> ${money(summary.totalCredit)}</div>
          <div class="statement-summary-item"><span>Total Debit:</span> ${money(summary.totalDebit)}</div>
          <div class="statement-summary-item"><span>Net Book Balance:</span> ${money(summary.netBookBalance)}</div>
        </div>
        <div class="statement-rule"></div>
        <table class="statement-table business-statement-table">
          <thead>
            <tr>
              <th>S/N</th>
              <th>Date</th>
              <th>Type</th>
              <th>Account Name</th>
              <th>Amount</th>
              <th>Details</th>
              <th>Balance After</th>
              <th>Received Or Paid By</th>
              <th>Posted By</th>
              <th>Approved By</th>
            </tr>
          </thead>
          <tbody>
            ${bodyRows || '<tr><td colspan="10">No entries</td></tr>'}
          </tbody>
        </table>
        <div class="statement-total"><strong>Total Amount:</strong> ${money(summary.totalAmount)}</div>
      </div>
    `;
    printHtml(html, true);
  }

function staffLedgerEvents(staffId) {
    const staff = staffById(staffId) || {};
    const acc = ensureStaffAccount(staffId);
    const events = [];
    const seen = new Set();
    const addEvent = (event) => {
      const key = event.key || `${event.date}|${event.type}|${event.amount}|${event.details}`;
      if (seen.has(key)) return;
      seen.add(key);
      events.push(event);
    };
    (acc.entries || []).forEach(entry => {
      const type = String(entry.type || '').toLowerCase();
      const amount = Number(entry.amount || 0);
      const date = entry.formDate || entry.floatDate || String(entry.date || '').slice(0,10) || businessDate();
      if (['approved_form','approved_float'].includes(type)) addEvent({ key: entry.id || `form-${date}-${amount}`, date, type: 'FORM', amount, delta: amount, details: entry.note || `Approved FORM for ${date}`, runningType: 'form' });
      else if (['customer_credit'].includes(type)) addEvent({ key: entry.id || `credit-${date}-${amount}`, date, type: 'Credit Impact', amount, delta: -amount, details: entry.note || 'Customer credit', runningType: 'credit' });
      else if (['customer_debit'].includes(type)) addEvent({ key: entry.id || `debit-${date}-${amount}`, date, type: 'Debit Impact', amount, delta: -amount, details: entry.note || 'Customer debit', runningType: 'debit' });
      else if (['customer_credit_journal'].includes(type)) addEvent({ key: entry.id || `credit-journal-${date}-${amount}`, date, type: 'Journal Form', amount, delta: -amount, details: entry.note || 'Credit journal form', runningType: 'credit' });
      else if (['customer_debit_journal'].includes(type)) addEvent({ key: entry.id || `debit-journal-${date}-${amount}`, date, type: 'Journal Form', amount, delta: -amount, details: entry.note || 'Debit journal form', runningType: 'debit' });
      else if (['debt_repayment','wallet_fund','wallet_funding'].includes(type)) addEvent({ key: entry.id || `${type}-${date}-${amount}`, date, type: type === 'debt_repayment' ? 'Debt Repayment' : 'Wallet', amount, delta: 0, details: entry.note || type.replace(/_/g,' '), runningType: 'other' });
    });
    (state.approvals || []).filter(r => String(r.status || '').toLowerCase() === 'approved').forEach(req => {
      const payload = req.payload || {};
      const date = payload.date || payload.float_date || String(req.approvedAt || req.requestedAt || '').slice(0,10) || businessDate();
      // Cash receipt: Cash Officer funded their own operational account
      if (req.type === 'cash_receipt' && payload.staffId === staffId) {
        const amount = Number(payload.amount || 0);
        addEvent({ key: req.id || `cash-receipt-${date}-${amount}`, date, type: 'Cash Receipt', amount, delta: amount, details: `Cash received • ${payload.paymentMode || 'cash'}`, runningType: 'form' });
      }
      // Inter-staff credit: operational account topped up by Cash Officer
      if (req.type === 'inter_staff_credit') {
        const opAccount = (state.customers || []).find(c => c.accountType === 'staff_operational' && c.linkedStaffId === staffId);
        if (opAccount && (payload.targetAccountId === opAccount.id || payload.operationalAccountId === opAccount.id)) {
          const amount = Number(payload.amount || 0);
          addEvent({ key: req.id || `inter-credit-${date}-${amount}`, date, type: 'Operational Credit', amount, delta: amount, details: `Credited by ${payload.staffName || 'Treasury'} • ${payload.paymentMode || 'cash'}`, runningType: 'form' });
        }
      }
      if (req.type === 'float_declaration' && (payload.staffId === staffId || payload.staff_id === staffId)) {
        const amount = Number(payload.amount || payload.floatAmount || 0);
        addEvent({ key: req.id || `form-approval-${date}-${amount}`, date, type: 'FORM', amount, delta: amount, details: `Approved FORM for ${date}`, runningType: 'form' });
      }
      if (req.type === 'customer_credit' && payload.staffId === staffId) {
        const amount = Number(payload.amount || 0);
        addEvent({ key: req.id || `credit-approval-${date}-${amount}`, date, type: 'Credit', amount, delta: -amount, details: `${payload.accountNumber || ''} ${payload.customerName || ''} ${payload.details || ''}`.trim() || 'Customer credit', runningType: 'credit' });
      }
      if (req.type === 'customer_debit' && payload.staffId === staffId) {
        const amount = Number(payload.amount || 0);
        addEvent({ key: req.id || `debit-approval-${date}-${amount}`, date, type: 'Debit', amount, delta: -amount, details: `${payload.accountNumber || ''} ${payload.customerName || ''} ${payload.details || ''}`.trim() || 'Customer debit', runningType: 'debit' });
      }
      if (req.type === 'customer_credit_journal' && payload.staffId === staffId) {
        const formAmount = Number(payload.formAmount || 0);
        addEvent({ key: req.id || `credit-journal-${date}`, date, type: 'Credit Journal', amount: formAmount, delta: -formAmount, details: `Credit journal (${(payload.rows || payload.entries || []).length} entries)`, runningType: 'credit' });
      }
      if (req.type === 'customer_debit_journal' && payload.staffId === staffId) {
        const formAmount = Number(payload.formAmount || 0);
        addEvent({ key: req.id || `debit-journal-${date}`, date, type: 'Debit Journal', amount: formAmount, delta: -formAmount, details: `Debit journal (${(payload.rows || payload.entries || []).length} entries)`, runningType: 'debit' });
      }
    });
    (state.cod || []).filter(cod => cod.staffId === staffId).forEach(cod => {
      const date = cod.date || String(cod.submittedAt || cod.resolvedAt || '').slice(0,10) || businessDate();
      addEvent({ key: cod.id || `cod-${date}`, date, type: `COD ${String(cod.status || 'Submitted').toUpperCase()}`, amount: Number(cod.remainingBalance ?? cod.runningFloat ?? cod.actualCash ?? 0), delta: 0, details: `Op. Balance ${money(getStaffOperationalBalance(staffId))} • Remaining ${money(cod.remainingBalance ?? cod.runningFloat ?? 0)} • Variance ${money(cod.variance || 0)}`, runningType: 'cod' });
    });
    let running = 0;
    return events.sort((a,b)=> new Date(`${a.date}T12:00:00Z`) - new Date(`${b.date}T12:00:00Z`)).map(event => {
      if (['form','credit','debit'].includes(event.runningType)) running += Number(event.delta || 0);
      return { ...event, runningBalance: running, staffName: staff.name || staffId };
    }).sort((a,b)=> new Date(`${b.date}T12:00:00Z`) - new Date(`${a.date}T12:00:00Z`));
  }

  async function openStaffLedgerModal(staffId) {
    const staff = staffById(staffId);
    if (!staff) return showToast('Staff not found');
    const acc = ensureStaffAccount(staffId);
    const staffName = staff.name || staff.full_name || staffId;
    const staffRole = ROLE_LABELS[staff.role] || staff.role || '';

    // Show modal immediately with local data, then upgrade with Supabase data
    function cleanStaffLedgerDetails(value) {
      return String(value || '—')
        .replace(/\s+posted from approval\s+[0-9a-f-]{12,}/ig, '')
        .replace(/\s+from approval\s+[0-9a-f-]{12,}/ig, '')
        .replace(/approval\s+[0-9a-f-]{12,}/ig, 'approval')
        .replace(/\s{2,}/g, ' ')
        .trim() || '—';
    }

    function staffLedgerDisplayDate(row) {
      return String(row.businessDate || row.business_date || row.floatDate || row.float_date || row.date || businessDate()).slice(0,10);
    }

    function buildRows(events) {
      return events.map((row, i) => {
        const displayDate = staffLedgerDisplayDate(row);
        return `<tr><td>${i+1}</td><td>${fmtDate(`${displayDate}T12:00:00.000Z`)}</td><td>${escapeHtml(row.type)}</td><td>${money(row.amount)}</td><td class="${Number(row.runningBalance || 0) < 0 ? 'balance-negative' : ''}">${money(row.runningBalance)}</td><td>${escapeHtml(cleanStaffLedgerDetails(row.details || row.note || '—'))}</td></tr>`;
      }).join('');
    }

    function buildModal(rows, loading) {
      const cod = staffCODRecords(staffId).slice().sort((a,b)=>new Date(b.submittedAt||b.resolvedAt||b.date)-new Date(a.submittedAt||a.resolvedAt||a.date))[0];
      return `
      <div class="stack staff-ledger-modal">
        <div class="kpi-row wrap staff-ledger-kpis">
          <div class="kpi"><div class="label">Staff</div><div class="number">${escapeHtml(staffName)}</div></div>
          <div class="kpi"><div class="label">Office</div><div class="number">${escapeHtml(staffRole)}</div></div>
          <div class="kpi"><div class="label">Account No.</div><div class="number">${escapeHtml(acc.accountNumber || '—')}</div></div>
          <div class="kpi"><div class="label">Op. Balance</div><div class="number">${money(getStaffOperationalBalance(staffId))}</div></div>
          <div class="kpi"><div class="label">Debt</div><div class="number ${Number(acc.debtBalance||0)>0 ? 'balance-negative' : ''}">${money(acc.debtBalance||0)}</div></div>
        </div>
        ${cod ? `<div class="note">Latest COD: <strong>${fmtDate(`${cod.date || cod.submittedAt}T12:00:00.000Z`)}</strong> • ${escapeHtml(cod.status || 'submitted')} • Remaining ${money(cod.remainingBalance ?? cod.runningFloat ?? cod.actualCash ?? 0)}</div>` : '<div class="note">No COD record yet for this staff.</div>'}
        ${loading ? '<div class="note" style="color:var(--text-muted)">Loading ledger from server…</div>' : ''}
        <div class="table-wrap"><table class="table"><thead><tr><th>S/N</th><th>Date</th><th>Entry</th><th>Amount</th><th>Running Balance</th><th>Details</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="muted">No ledger entries yet</td></tr>'}</tbody></table></div>
      </div>`;
    }

    // Show immediately with local data
    const localEvents = staffLedgerEvents(staffId);
    openModal(`Staff Ledger — ${escapeHtml(staffName)}`, buildModal(buildRows(localEvents), isSupabaseApprovalMode()), [{ label:'Close', className:'secondary', onClick: closeModal }]);

    // Fetch from Supabase and upgrade
    if (isSupabaseApprovalMode() && gateway.staff?.listStaffLedger) {
      try {
        const supabaseStaffId = staff.uuid || staff.auth_user_id || staffId;
        const result = await gateway.staff.listStaffLedger(supabaseStaffId);
        if (result?.ok && Array.isArray(result.data) && result.data.length > 0) {
          // Normalize Supabase ledger rows into the same format as local events
          let running = 0;
          const sbEvents = result.data.map((row, i) => {
            const entryType = String(row.entry_type || '').toLowerCase();
            const amount = Number(row.amount || 0);
            const delta = Number(row.delta || 0);
            let type = 'Entry';
            let runningType = 'other';
            if (['approved_form','approved_float'].includes(entryType)) { type = 'FORM'; runningType = 'form'; }
            else if (['customer_credit','credit'].includes(entryType)) { type = 'Credit Impact'; runningType = 'credit'; }
            else if (['customer_debit','debit'].includes(entryType)) { type = 'Debit Impact'; runningType = 'debit'; }
            else if (entryType === 'debt_repayment') { type = 'Debt Repayment'; }
            else if (['wallet_fund','wallet_funding'].includes(entryType)) { type = 'Wallet'; }
            else { type = entryType.replace(/_/g,' ').replace(/\w/g,c=>c.toUpperCase()); }
            if (['form','credit','debit'].includes(runningType)) running += delta || (runningType === 'form' ? amount : -amount);
            return {
              date: String(row.business_date || row.float_date || '').slice(0,10),
              businessDate: row.business_date || row.float_date || null,
              floatDate: row.float_date || null,
              createdAt: row.created_at || null,
              type,
              amount,
              runningBalance: running,
              details: row.note || '—'
            };
          }).sort((a,b)=> new Date(`${staffLedgerDisplayDate(b)}T12:00:00Z`) - new Date(`${staffLedgerDisplayDate(a)}T12:00:00Z`));

          // Update modal content
          const modalBody = document.querySelector('.modal-body, .modal .stack')?.closest('.modal-body') || document.querySelector('.modal-body');
          if (modalBody) modalBody.innerHTML = buildModal(buildRows(sbEvents), false);
        } else {
          // No Supabase data — remove loading indicator
          const modalBody = document.querySelector('.modal-body');
          if (modalBody) modalBody.innerHTML = buildModal(buildRows(localEvents), false);
        }
      } catch (err) {
        console.warn('[DUCESS] Staff ledger Supabase fetch failed:', err);
      }
    }
  }

function normalizeStaffLedgerEntryType(row) {
    return String(row?.entry_type || row?.type || row?.entryType || '').toLowerCase();
  }

  function summarizeStaffLedgerRows(rows = []) {
    const sorted = [...rows].sort((a,b)=>new Date(a.created_at || a.createdAt || a.float_date || a.floatDate || a.date || 0) - new Date(b.created_at || b.createdAt || b.float_date || b.floatDate || b.date || 0));
    let balance = 0;
    let totalCreditReceived = 0;
    let totalDebitsPaid = 0;
    sorted.forEach(row => {
      const type = normalizeStaffLedgerEntryType(row);
      const amount = Number(row.amount || 0);
      const delta = Number(row.delta || 0);
      if (Number.isFinite(delta) && delta !== 0) balance += delta;
      else if (['approved_form','approved_float','approved_float_topup','wallet_fund','wallet_funding'].includes(type)) balance += amount;
      else if (['customer_credit','customer_credit_journal','credit'].includes(type)) balance -= amount;
      else if (['customer_debit','customer_debit_journal','debit'].includes(type)) balance -= amount;
      if (['customer_credit','customer_credit_journal','credit'].includes(type)) totalCreditReceived += amount;
      if (['customer_debit','customer_debit_journal','debit'].includes(type)) totalDebitsPaid += amount;
    });
    const debtBalance = balance < 0 ? balance : 0;
    return { balance, debtBalance, totalCreditReceived, totalDebitsPaid };
  }

  function localTellerBalanceSummary(staffId) {
    const acc = ensureStaffAccount(staffId);
    const rows = (acc.entries || []).map(e => ({
      type: e.type,
      entry_type: e.type,
      amount: e.amount,
      delta: e.delta,
      date: e.date || e.floatDate || e.formDate || e.createdAt
    }));
    const summary = summarizeStaffLedgerRows(rows);
    return {
      balance: Number(acc.balance || summary.balance || 0),
      debtBalance: Number(acc.balance || 0) < 0 ? Number(acc.balance || 0) : Number(acc.debtBalance || 0) > 0 ? -Number(acc.debtBalance || 0) : summary.debtBalance,
      totalCreditReceived: summary.totalCreditReceived,
      totalDebitsPaid: summary.totalDebitsPaid
    };
  }

  function getTellerBalanceSummary(staffId) {
    state.ui ||= {};
    state.ui.tellerLedgerSummaries ||= {};
    return state.ui.tellerLedgerSummaries[staffId] || localTellerBalanceSummary(staffId);
  }

  async function refreshTellerBalanceLedgerSummaries() {
    if (!isSupabaseApprovalMode() || !gateway.staff?.listStaffLedger) return;
    state.ui ||= {};
    if (state.ui.tellerLedgerLoading) return;
    state.ui.tellerLedgerLoading = true;
    try {
      state.ui.tellerLedgerSummaries ||= {};
      const visibleStaff = state.staff.slice(0, state.ui.tellerEntriesLimit || 20);
      let changed = false;
      for (const s of visibleStaff) {
        const supabaseStaffId = s.uuid || s.auth_user_id || s.authUserId || s.id;
        const result = await gateway.staff.listStaffLedger(supabaseStaffId);
        if (result?.ok && Array.isArray(result.data)) {
          state.ui.tellerLedgerSummaries[s.id] = summarizeStaffLedgerRows(result.data);
          changed = true;
        }
      }
      if (changed) {
        save();
        if (state.ui.tool === 'teller_balances') renderWorkspace();
      }
    } catch (err) {
      console.warn('[DUCESS] Teller balance ledger summary refresh failed:', err);
    } finally {
      state.ui.tellerLedgerLoading = false;
    }
  }

  function renderTellerBalances() {
    const rows = state.staff.slice(0, state.ui.tellerEntriesLimit || 20).map(s=>{
      const acc = ensureStaffAccount(s.id);
      const summary = getTellerBalanceSummary(s.id);
      const debtBalance = Number(summary.debtBalance || 0);
      const totalCreditReceived = Number(summary.totalCreditReceived || 0);
      const totalDebitsPaid = Number(summary.totalDebitsPaid || 0);
      const balance = Number(summary.balance ?? acc.balance ?? 0);
      return `<tr><td>${escapeHtml(s.name || '')}</td><td>${ROLE_LABELS[s.role] || s.role}</td><td>${escapeHtml(acc.accountNumber || '')}</td><td>${money(balance)}</td><td class="balance-negative">${debtBalance < 0 ? "-" + money(Math.abs(debtBalance)) : money(0)}</td><td>${money(totalCreditReceived)}</td><td>${money(totalDebitsPaid)}</td><td><button class="secondary" data-staff-ledger="${s.id}">Ledger</button></td></tr>`;
    }).join('');
    return `<div class="table-card"><div class="action-row" style="justify-content:space-between;align-items:center"><h3>Teller and Posting Accounts</h3><div class="note" style="margin:0">Business Date: <strong>${businessDate()}</strong></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Staff</th><th>Office</th><th>Account Number</th><th>Balance</th><th>Debt Balance</th><th>Total Credit Received</th><th>Total Debits Paid</th><th>Ledger</th></tr></thead><tbody>${rows}</tbody></table></div><div class="action-row">${state.staff.length > (state.ui.tellerEntriesLimit || 20) ? `<button id="tellerMore" class="secondary">Show More</button>` : ''}${(state.ui.tellerEntriesLimit || 20) > 20 ? `<button id="tellerLess" class="secondary">Show Less</button>` : ''}</div></div>`;
  }

  function allApprovedCustomerTx(kind) {
    return flattenCustomerTx().filter(t => t.type === kind);
  }
  function flattenCustomerTx() {
    return state.customers.flatMap(customer => (customer.transactions||[]).map(tx => ({ ...tx, customer })) ).sort((a,b)=>new Date(b.date)-new Date(a.date));
  }

  
  function isTelleringDirectModalTool(tool) {
    return ['form', 'my_close_day'].includes(tool);
  }

  // SURGICAL FIX 2026-08-19: the previous version made the native input's
  // TEXT transparent and overlaid a mirror on top — but (1) it read the
  // overlay's color from the input's OWN computed style AFTER already
  // making that transparent, so the overlay copied the invisibility too
  // (zero-visibility bug), and (2) color:transparent only hides text, not
  // Chrome's internal focus-highlight box around the actively-edited date
  // segment, which kept showing through as a stray blue rectangle (overlap
  // bug). Replaced with the standard robust pattern instead: the native
  // input is made FULLY invisible (opacity:0, not just text-transparent, so
  // nothing internal can leak through) and stacked on top to catch every
  // click/keyboard interaction; a plain, fully-visible text input sits
  // underneath showing the formatted value. The native input keeps its
  // original id, so every existing byId('someDateField').value read/write
  // anywhere in the app continues to work completely unchanged.
  function overlayDateInputsWithDDMMYYYY(root = document) {
    root.querySelectorAll('input[type="date"]').forEach(input => {
      if (input.dataset.ddmmyyyyMirrored) {
        const display = input.parentElement?.querySelector('.date-mirror-display');
        if (display) display.value = input.value ? fmtDate(input.value) : (input.getAttribute('placeholder') || 'dd/mm/yyyy');
        // Self-heal: if the icon somehow didn't render on the first pass,
        // add it now rather than leaving the field looking unclickable.
        if (input.parentElement && !input.parentElement.querySelector('.date-mirror-icon')) {
          const icon = document.createElement('span');
          icon.className = 'date-mirror-icon';
          icon.textContent = '📅';
          input.parentElement.appendChild(icon);
        }
        return;
      }
      input.dataset.ddmmyyyyMirrored = '1';

      let wrap = input.parentElement;
      if (!wrap || !wrap.classList.contains('date-mirror-wrap')) {
        wrap = document.createElement('span');
        wrap.className = 'date-mirror-wrap';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
      }

      // Copy the native input's own classes onto the display input so it
      // renders identically across the ~10 different screens/size variants
      // this is used on, rather than guessing one shared style.
      const display = document.createElement('input');
      display.type = 'text';
      display.readOnly = true;
      display.tabIndex = -1;
      display.className = input.className + ' date-mirror-display';
      display.value = input.value ? fmtDate(input.value) : 'dd/mm/yyyy';
      wrap.insertBefore(display, input);

      // Making the native input fully opacity:0 (needed to hide its internal
      // focus-highlight box — see 2026-08-19 fix note above) also hides its
      // calendar icon, removing any visible sign the field is clickable.
      // Add our own decorative icon back — pointer-events:none so clicks
      // still reach the native input underneath, not this icon.
      const icon = document.createElement('span');
      icon.className = 'date-mirror-icon';
      icon.textContent = '📅';
      wrap.appendChild(icon);

      input.classList.add('date-mirror-native');
      input.addEventListener('input', () => { display.value = input.value ? fmtDate(input.value) : 'dd/mm/yyyy'; });
      input.addEventListener('change', () => { display.value = input.value ? fmtDate(input.value) : 'dd/mm/yyyy'; });
    });
  }

  function bindToolHandlers() {
    switch (state.ui.tool) {
      case 'check_balance': bindCheckBalance(); break;
      case 'account_opening': bindAccountOpening(); break;
      case 'account_maintenance': bindMaintenance('maintenance'); break;
      case 'account_reactivation': bindMaintenance('reactivation'); break;
      case 'account_statement': bindStatement(); break;
      case 'staff_credit': bindStaffCredit(); break;
      case 'intra_transfer': bindIntraTransfer(); break;
      case 'transaction_summary': bindTransactionSummary(); break;
      case 'credit': bindJournal('credit'); break;
      case 'debit': bindJournal('debit'); break;
      case 'journal': bindJournalStandalone(); break;
      case 'central_close_day':
      case 'approval_queue':
      case 'approval_customer_service':
      case 'approval_tellering':
      case 'approval_non_cash':
      case 'approval_others':
      case 'approval_history': bindApprovals(); break;
      case 'permissions': bindPermissions(); break;
      case 'operational_posting': bindOperationalAccounts(); break;
      case 'operational_accounts': bindOperationalAccounts(); break;
      case 'staff_directory': bindStaffDirectory(); break;
      case 'staff_roster': bindStaffDirectory(); break;
      case 'customer_directory': bindCustomerDirectory(); break;
      case 'business_balance': bindBalanceFilters('business'); break;
      case 'operational_balance': bindBalanceFilters('operational'); break;
      case 'teller_balances': bindTellerBalances(); break;
    }
    overlayDateInputsWithDDMMYYYY(byId('workspace') || document);
  }

  function canAssignFloatTopUp(staff=currentStaff()) {
    return ['admin_officer','approving_officer'].includes(staff?.role);
  }

  function bindTellerBalances() {
    const tellerMore = byId('tellerMore');
    if (tellerMore) tellerMore.onclick = () => { state.ui.tellerEntriesLimit = (state.ui.tellerEntriesLimit || 20) + 20; save(); renderWorkspace(); };
    const tellerLess = byId('tellerLess');
    if (tellerLess) tellerLess.onclick = () => { state.ui.tellerEntriesLimit = Math.max(20, (state.ui.tellerEntriesLimit || 20) - 20); save(); renderWorkspace(); };
    qq('[data-assign-topup]').forEach(btn => btn.onclick = () => openFloatTopUpModal(btn.dataset.assignTopup));
    qq('[data-staff-ledger]').forEach(btn => btn.onclick = () => openStaffLedgerModal(btn.dataset.staffLedger));
    refreshTellerBalanceLedgerSummaries();
  }

  function openFloatTopUpModal(staffId=null) {
    if (!canAssignFloatTopUp()) return showToast('Only Approval Officer or Admin can assign float');
    const postingStaff = state.staff.filter(x => hasPermission('credit', x) || hasPermission('debit', x));
    const defaultStaff = state.staff.find(x => x.id === staffId) || postingStaff[0];
    if (!defaultStaff) return showToast('No eligible staff found');
    openModal('Assign Float Top-Up', `
      <div class="form-grid three">
        <div class="field"><label>Staff</label><select id="floatTopupStaff" class="entry-input">${postingStaff.map(st => `<option value="${st.id}" ${st.id===defaultStaff.id?'selected':''}>${escapeHtml(st.name || '')} — ${ROLE_LABELS[st.role] || st.role}</option>`).join('')}</select></div>
        <div class="field"><label>Date</label><div class="display-field">${businessDate()}</div></div>
        <div class="field"><label>Amount</label><input id="floatTopupAmount" class="entry-input" type="number"></div>
      </div>
      <div class="form-grid one">
        <div class="field"><label>Note</label><input id="floatTopupNote" class="entry-input" placeholder="Reason for top-up"></div>
      </div>
      <div class="note">This request goes to Approvals → Others. Once approved, it increases the available form immediately for the selected staff on the current business date.</div>
    </div>`, [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Submit', onClick: () => {
          const selectedStaff = state.staff.find(x => x.id === byId('floatTopupStaff').value);
          const amount = Number(byId('floatTopupAmount').value || 0);
          const note = byId('floatTopupNote').value.trim();
          if (!selectedStaff) return showToast('Staff not found');
          if (!(amount > 0)) return showToast('Enter valid float top-up');
          createRequest('float_topup', { staffId: selectedStaff.id, staffName: selectedStaff.name, amount, date: businessDate(), note });
          closeModal();
          render();
          showToast('Float top-up sent for approval');
      }}
    ]);
  }

  function bindCheckBalance() {
    const hidePhoto = () => { const row = byId('checkBalancePhotoRow'); if (row) row.classList.add('hidden'); };
    const doLookup = (quiet=false) => {
      const val = (byId('lookupAcc')?.value || "").trim();
      hidePhoto();
      if (!val) { state.ui.checkBalanceLoaded = false; save(); return lookupFill(byId('workspace'), null); }
      const c = getCustomerByAccountNo(val);
      if (!c) { if (!quiet) showToast('Customer not found. Use name search.'); return; }
      // Clear any previously generated statement if switching to a different
      // customer, so Statement of Account never shows stale data.
      if (state.ui.selectedCustomerId !== c.id) state.ui.accountStatementGenerated = false;
      state.ui.selectedCustomerId = c.id;
      state.ui.checkBalanceLoaded = true;
      save();
      lookupFill(byId('workspace'), c);
    };
    byId('lookupBtn').onclick = () => openCustomerSearchModal(state.customers);
    byId('lookupAcc').oninput = debounce(() => {
      const v = (byId('lookupAcc')?.value || '').trim();
      if (!v) return doLookup(true);
      // SURGICAL FIX 2026-08-28: same stale /^\d{4}$/ regex bug as
      // txAcc/journalAcc — silently blocked live lookup for anything that
      // isn't a plain 4-digit number (T1/S1/E1/I1-style, or any
      // variable-length customer number). Now triggers on any genuine match.
      if (getCustomerByAccountNo(v)) doLookup(true);
    }, 200);
    byId('lookupAcc').onchange = () => doLookup(true);
    byId('lookupAcc').onkeyup = (e) => { if (e.key === "Enter") doLookup(false); };
    byId('openStatementBtn').onclick = () => { state.ui.tool = 'account_statement'; renderWorkspace(); };
    const fieldNoteBtn = byId('openFieldNoteBtn'); if (fieldNoteBtn) fieldNoteBtn.onclick = () => {
      const staff = currentStaff();
      const note = staff ? getLatestFieldNoteForStaff(staff.id) : null;
      if (!note) return showToast('No field note uploaded yet — upload one from Generate Journal');
      const isImage = String(note.type || '').startsWith('image/');
      const body = `<div class="stack">
        <div class="note">${String(note.uploadedAt || '').slice(0,10) === businessDate() ? "Today's field note" : `Last uploaded field note (${fmtDate(note.uploadedAt)})`}</div>
        ${isImage
          ? `<img src="${note.dataUrl}" alt="Field note" style="max-width:100%;border-radius:8px;border:1px solid var(--line)">`
          : `<a href="${note.dataUrl}" target="_blank" rel="noopener" class="field-note-pdf-link">📄 ${escapeHtml(note.name || 'Field note.pdf')}</a>`}
      </div>`;
      openModal('Field Note (Form)', body, [{ label: 'Close', className: 'secondary', onClick: closeModal }]);
    };
    const photoBtn = byId('searchPhotoBtn'); if (photoBtn) photoBtn.onclick = ()=> {
      const row = byId('checkBalancePhotoRow');
      const selected = getSelectedCustomer();
      if (!selected) return showToast('Search for customer first');
      if (row) row.classList.toggle('hidden');
    };
    hidePhoto();
    const selected = state.ui.checkBalanceLoaded ? getSelectedCustomer() : null;
    if (selected && state.ui.selectedCustomerId) lookupFill(byId('workspace'), selected); else lookupFill(byId('workspace'), null);
  }

  function bindAccountOpening() {
    state.ui.accountOpeningDraft ||= {};
    const openingDraft = state.ui.accountOpeningDraft;

    // SURGICAL ADDITION 2026-08-26 (client correction): show the account
    // number preview inline on the form, before submission — using the
    // non-consuming peek RPC, never the real number-consuming generator.
    // Fetches fresh on every bind (i.e. every render/type-change) so the
    // preview stays current; harmless to call repeatedly since it never
    // reserves anything.
    const previewEl = byId('openAccountNumberPreview');
    if (previewEl) {
      const previewType = previewEl.dataset.previewType;
      (async () => {
        try {
          const result = await gateway.customers.peekSystemAccountNumber(previewType);
          const el = byId('openAccountNumberPreview');
          if (!el || el.dataset.previewType !== previewType) return; // form moved on since the fetch started
          el.innerHTML = result?.ok && result.data
            ? `Account Number (preview): <strong>${escapeHtml(result.data)}</strong> — assigned when you submit`
            : `Account Number: <strong>Unavailable</strong> — will be assigned on submit`;
        } catch (err) {
          const el = byId('openAccountNumberPreview');
          if (el) el.innerHTML = `Account Number: <strong>Unavailable</strong> — will be assigned on submit`;
        }
      })();
    }

    // Re-render when account type changes
    const typeSelect = byId('openAccountType');
    if (typeSelect) typeSelect.onchange = () => {
      openingDraft.accountType = typeSelect.value;
      openingDraft.name = '';
      openingDraft.linkedStaffId = '';
      openingDraft.accountNumber = '';
      save();
      renderWorkspace();
    };

    const photoInput = byId('openPhoto');
    const photoBtn = byId('openPhotoBtn');
    const photoStatus = byId('openPhotoStatus');

    const draftBindings = {
      openName: 'name',
      openAddress: 'address',
      openPhone: 'phone',
      openNin: 'nin',
      openBvn: 'bvn',
      openOldAccount: 'oldAccountNumber',
      openAccountNumber: 'accountNumber'
    };

    Object.entries(draftBindings).forEach(([id, key]) => {
      const input = byId(id);
      if (!input) return;
      input.addEventListener('input', () => { openingDraft[key] = input.value; });
      input.addEventListener('focus', () => { state.ui.accountOpeningFocusedField = id; });
    });

    const linkedStaffSelect = byId('openLinkedStaff');
    if (linkedStaffSelect) linkedStaffSelect.onchange = () => {
      openingDraft.linkedStaffId = linkedStaffSelect.value;
      if ((openingDraft.accountType || 'customer') === 'staff_operational') {
        const linkedStaff = (state.staff || []).find(s => s.id === linkedStaffSelect.value);
        openingDraft.name = linkedStaff ? `TELLER ${String(linkedStaff.name || '').toUpperCase()}` : '';
        save();
        renderWorkspace();
      }
    };

    const focusedField = byId(state.ui.accountOpeningFocusedField || '');
    if (focusedField) {
      requestAnimationFrame(() => {
        const cursorPosition = focusedField.value.length;
        focusedField.focus();
        if (focusedField.setSelectionRange) focusedField.setSelectionRange(cursorPosition, cursorPosition);
      });
    }
    if (photoBtn && photoInput) photoBtn.onclick = () => photoInput.click();
    if (photoInput) {
      if (openingDraft.photo) photoInput.dataset.base64 = openingDraft.photo;
      if (openingDraft.photoStatus && photoStatus) photoStatus.textContent = openingDraft.photoStatus;
    }
    if (photoInput) photoInput.onchange = async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const base64 = await toBase64(f);
        if (estimateDataUrlBytes(base64) > CUSTOMER_PHOTO_MAX_BYTES) {
          photoInput.value = ''; photoInput.dataset.base64 = '';
          openingDraft.photo = ''; openingDraft.photoStatus = 'No photo selected';
          if (photoStatus) photoStatus.textContent = 'No photo selected';
          return showToast('Photo must be 1 MB or less after compression');
        }
        photoInput.dataset.base64 = base64;
        openingDraft.photo = base64;
        const compressedLabel = `${formatFileSize(estimateDataUrlBytes(base64))}`;
        if (photoStatus) photoStatus.textContent = f.name.length > 18 ? `${f.name.slice(0,15)}... • ${compressedLabel}` : `${f.name} • ${compressedLabel}`;
        openingDraft.photoStatus = photoStatus?.textContent || 'No photo selected';
      } catch (error) {
        photoInput.value = ''; photoInput.dataset.base64 = '';
        openingDraft.photo = ''; openingDraft.photoStatus = 'No photo selected';
        if (photoStatus) photoStatus.textContent = 'No photo selected';
        showToast(error?.message || 'Unable to process selected photo');
      }
    };

    byId('submitOpening').onclick = async (e) => {
      const acctType = openingDraft.accountType || 'customer';
      const isCustomer = acctType === 'customer';
      const name = (byId('openName')?.value || '').trim();
      if (!name) return showToast('Account name is required');

      let payload;
      if (isCustomer) {
        const address = (byId('openAddress')?.value || '').trim();
        const phone = (byId('openPhone')?.value || '').trim();
        const nin = (byId('openNin')?.value || '').trim();
        const bvn = (byId('openBvn')?.value || '').trim();
        const accountNumber = (byId('openAccountNumber')?.value || '').trim();
        if (!address || !phone || !nin || !bvn) return showToast('Complete all required fields');
        // SURGICAL PATCH 2026-08-14: account number is now required at
        // opening (assigned by Customer Service), not optional/left for the
        // approving officer to fill in later.
        if (!accountNumber) return showToast('Account number is required');
        if (getCustomerByAccountNo(accountNumber)) return showToast('This account number is already in use');
        payload = {
          accountType: 'customer', name, address, phone, nin, bvn,
          accountNumber,
          oldAccountNumber: (byId('openOldAccount')?.value || '').trim(),
          generatedAccountNumber: accountNumber,
          photo: byId('openPhoto')?.dataset?.base64 || ''
        };
      } else if (acctType === 'staff_operational') {
        const linkedStaffId = (byId('openLinkedStaff')?.value || '').trim();
        if (!linkedStaffId) return showToast('Select a staff member to link this account to');
        const linkedStaff = (state.staff || []).find(s => s.id === linkedStaffId);
        payload = {
          accountType: 'staff_operational', name,
          linkedStaffId, linkedStaffName: linkedStaff?.name || '',
          systemAssigned: true, generatedAccountNumber: ''
        };
      } else if (acctType === 'staff_salary') {
        // No staff link — opens like a regular account with system-assigned number,
        // but collects the same identity details a customer account does.
        // Role classification removed 2026-08-14 — client only needs
        // account-number search on the Staff Salary Balance report.
        const address = (byId('openAddress')?.value || '').trim();
        const phone = (byId('openPhone')?.value || '').trim();
        const nin = (byId('openNin')?.value || '').trim();
        const bvn = (byId('openBvn')?.value || '').trim();
        if (!address || !phone || !nin || !bvn) return showToast('Complete all required fields');
        payload = {
          accountType: 'staff_salary', name,
          address, phone, nin, bvn,
          oldAccountNumber: (byId('openOldAccount')?.value || '').trim(),
          photo: byId('openPhoto')?.dataset?.base64 || '',
          systemAssigned: true, generatedAccountNumber: ''
        };
      } else {
        // expense or income — fully system-assigned, name only
        payload = { accountType: acctType, name, systemAssigned: true, generatedAccountNumber: '' };
      }

      // SURGICAL FIX 2026-08-26 (client correction): the real, number-
      // CONSUMING generator used to be called right here, before the user
      // had even confirmed — every click (including cancelled ones) burned
      // a real sequence value, which is exactly why testing produced
      // numbers like "I3008" instead of starting at 1. The number is now
      // only generated AFTER the user clicks Confirm below. They've already
      // seen the (non-consuming) preview inline on the form before this
      // point, so the confirm prompt itself can stay plain.
      const confirmMessage = `Submit ${acctType.replace('_',' ')} account opening request?`;

      confirmAction(confirmMessage, async () => {
        showProcessing(payload.systemAssigned ? 'Assigning account number...' : 'Sending request...'); await nextPaint();
        try {
          if (payload.systemAssigned) {
            const numResult = await gateway.customers.generateSystemAccountNumber(acctType);
            if (!numResult?.ok || !numResult.data) {
              return showToast(numResult?.error?.message || 'Could not assign an account number — try again');
            }
            payload.generatedAccountNumber = numResult.data;
          }
          const result = await submitApprovalThroughGateway('account_opening', payload);
          if (!result?.ok) return showToast(result?.error?.message || 'Unable to submit request');
          state.ui.accountOpeningDraft = {};
          state.ui.accountOpeningFocusedField = '';
          render();
          showToast(payload.systemAssigned ? `Account opening sent for approval — account number ${payload.generatedAccountNumber}` : 'Account opening sent for approval');
        } finally { hideProcessing(); }
      });
    };
  }

  function bindStaffCredit() {
    const draft = state.ui.staffCreditDraft ||= {};
    const amtInput = byId('staffCreditAmount');
    const noteInput = byId('staffCreditNote');
    if (amtInput) amtInput.oninput = () => { draft.amount = amtInput.value; };
    if (noteInput) noteInput.oninput = () => { draft.note = noteInput.value; };
    qq('input[name="staffCreditMode"]').forEach(r => r.onchange = () => { if (r.checked) draft.mode = r.value; });
    const submitBtn = byId('submitStaffCredit');
    if (!submitBtn) return;
    submitBtn.onclick = async () => {
      const accountId = byId('staffCreditAccount')?.value;
      if (!accountId) return showToast('Select a staff account');
      const amount = Number(byId('staffCreditAmount')?.value || 0);
      if (!(amount > 0)) return showToast('Enter a valid amount');
      if (isBusinessDateClosed(businessDate())) return showToast(businessDateClosedMessage(businessDate()));
      const paymentMode = q('input[name="staffCreditMode"]:checked')?.value || 'cash';
      const note = (byId('staffCreditNote')?.value || '').trim();
      const targetAccount = (state.customers || []).find(c => c.id === accountId);
      const st = currentStaff();
      confirmAction(`Credit ${targetAccount?.name || 'staff account'} ${money(amount)}?`, async () => {
        showProcessing('Sending for approval...'); await nextPaint();
        try {
          const result = await submitApprovalThroughGateway('inter_staff_credit', {
            staffId: st.id, staffName: st.name,
            targetAccountId: accountId,
            targetAccountNumber: targetAccount?.accountNumber || targetAccount?.account_number,
            targetAccountName: targetAccount?.name || targetAccount?.displayName || targetAccount?.display_name,
            amount, paymentMode, date: businessDate(), note
          });
          if (!result?.ok) return showToast(result?.error?.message || 'Unable to submit');
          state.ui.staffCreditDraft = {};
          render();
          showToast('Staff credit sent for approval');
        } finally { hideProcessing(); }
      });
    };
  }

  function renderIntraTransfer() {
    const draft = state.ui.intraTransferDraft ||= {};
    return `
      <div class="form-card cs2-card opening-card">
        <div class="cs2-title">Non Cash Transaction</div>
        <div class="cs2-stack">
          <div class="cs2-row">
            <div class="cs2-label">Debit Account</div>
            <div class="cs2-input-wrap cs2-wide"><input id="itrSourceAcct" class="entry-input cs2-input" value="${escapeHtml(String(draft.sourceAcct || ''))}" placeholder="Account number to debit" autocomplete="off"></div>
            <button id="itrLookupSource" class="sheet-btn secondary tiny-btn">Search</button>
          </div>
          <div id="itrSourceName" class="cs2-note-box" style="min-height:24px">${draft.sourceName ? `<strong>${escapeHtml(draft.sourceName)}</strong>` : ''}</div>
          <div class="cs2-row">
            <div class="cs2-label">Credit Account</div>
            <div class="cs2-input-wrap cs2-wide"><input id="itrDestAcct" class="entry-input cs2-input" value="${escapeHtml(String(draft.destAcct || ''))}" placeholder="Account number to credit" autocomplete="off"></div>
            <button id="itrLookupDest" class="sheet-btn secondary tiny-btn">Search</button>
          </div>
          <div id="itrDestName" class="cs2-note-box" style="min-height:24px">${draft.destName ? `<strong>${escapeHtml(draft.destName)}</strong>` : ''}</div>
          <div class="cs2-row">
            <div class="cs2-label">Amount</div>
            <div class="cs2-input-wrap cs2-medium"><input id="itrAmount" class="entry-input cs2-input" type="text" inputmode="decimal" value="${escapeHtml(String(draft.amount || ''))}"></div>
          </div>
          <div class="cs2-row">
            <div class="cs2-label">Details / Narration</div>
            <div class="cs2-input-wrap cs2-wide"><input id="itrDetails" class="entry-input cs2-input" value="${escapeHtml(String(draft.details || ''))}" placeholder="e.g. Loan repayment"></div>
          </div>
          <div class="cs2-button-row">
            <button id="submitIntraTransfer" class="sheet-btn cs2-btn cs2-btn-solid">Submit for Approval</button>
          </div>
        </div>
      </div>`;
  }

  function bindIntraTransfer() {
    const draft = state.ui.intraTransferDraft ||= {};
    const sourceInput = byId('itrSourceAcct');
    const destInput = byId('itrDestAcct');
    const amtInput = byId('itrAmount');
    const detailsInput = byId('itrDetails');
    const lookupAcct = async (acctNum, nameElId, idKey, nameKey) => {
      const match = (state.customers || []).find(c => c.accountNumber === acctNum || c.account_number === acctNum);
      if (match) {
        draft[idKey] = match.id;
        draft[nameKey] = match.name || match.full_name || match.display_name || acctNum;
        if (byId(nameElId)) byId(nameElId).innerHTML = `<strong>${escapeHtml(draft[nameKey])}</strong>`;
      } else {
        if (byId(nameElId)) byId(nameElId).innerHTML = `<span style="color:var(--accent-red)">Account not found</span>`;
      }
    };

    // SURGICAL ADDITION 2026-08-28: account number fields should insert the
    // customer live as you type — Search is only meant as a fallback for
    // when you don't know the exact number (name search). Non Cash never
    // had this at all before, only the explicit Search button.
    if (sourceInput) sourceInput.oninput = () => {
      const v = sourceInput.value.trim();
      draft.sourceAcct = sourceInput.value; draft.sourceName = ''; draft.sourceId = '';
      if (byId('itrSourceName')) byId('itrSourceName').innerHTML = '';
      if (v && getCustomerByAccountNo(v)) lookupAcct(v, 'itrSourceName', 'sourceId', 'sourceName');
    };
    if (destInput) destInput.oninput = () => {
      const v = destInput.value.trim();
      draft.destAcct = destInput.value; draft.destName = ''; draft.destId = '';
      if (byId('itrDestName')) byId('itrDestName').innerHTML = '';
      if (v && getCustomerByAccountNo(v)) lookupAcct(v, 'itrDestName', 'destId', 'destName');
    };
    if (amtInput) { bindAmountCommaFormatting('itrAmount'); amtInput.oninput = () => { draft.amount = amtInput.value; }; }
    if (detailsInput) detailsInput.oninput = () => { draft.details = detailsInput.value; };

    if (byId('itrLookupSource')) byId('itrLookupSource').onclick = () => lookupAcct((byId('itrSourceAcct')?.value||'').trim(), 'itrSourceName', 'sourceId', 'sourceName');
    if (byId('itrLookupDest')) byId('itrLookupDest').onclick = () => lookupAcct((byId('itrDestAcct')?.value||'').trim(), 'itrDestName', 'destId', 'destName');

    if (byId('submitIntraTransfer')) byId('submitIntraTransfer').onclick = async () => {
      const amount = parseAmountInput('itrAmount');
      if (!draft.sourceId) return showToast('Look up the source account first');
      if (!draft.destId) return showToast('Look up the destination account first');
      if (draft.sourceId === draft.destId) return showToast('Source and destination must be different accounts');
      if (!(amount > 0)) return showToast('Enter a valid amount');
      if (isBusinessDateClosed(businessDate())) return showToast(businessDateClosedMessage(businessDate()));
      const st = currentStaff();
      confirmAction(`Non cash transaction: ${money(amount)} from ${draft.sourceName} → ${draft.destName}?`, async () => {
        showProcessing('Submitting non cash transaction...'); await nextPaint();
        try {
          const result = await submitApprovalThroughGateway('intra_bank_transfer', {
            staffId: st.id, staffName: st.name, date: businessDate(),
            sourceAccountId: draft.sourceId, sourceAccountNumber: draft.sourceAcct, sourceAccountName: draft.sourceName,
            destAccountId: draft.destId, destAccountNumber: draft.destAcct, destAccountName: draft.destName,
            amount, details: (byId('itrDetails')?.value||'').trim()
          });
          if (!result?.ok) return showToast(result?.error?.message || 'Unable to submit non cash transaction');
          state.ui.intraTransferDraft = {};
          render();
          showToast('Non cash transaction sent for approval');
        } finally { hideProcessing(); }
      });
    };
  }

  function renderTransactionSummary() {
    const filter = state.ui.txSummaryFilter ||= { date: businessDate(), period: 'day' };
    const categories = [
      { key: 'teller', label: 'Teller Transactions', icon: '💳', types: ['customer_credit','customer_debit','customer_credit_journal','customer_debit_journal','intra_bank_transfer'] },
      { key: 'customer', label: 'Customer Transactions', icon: '🧾', types: ['customer_credit','customer_debit','customer_credit_journal','customer_debit_journal','intra_bank_transfer','account_opening','account_maintenance','account_reactivation'] },
      { key: 'cash_officer', label: 'Treasury Transactions', icon: '💰', types: ['cash_receipt','inter_staff_credit'] },
      { key: 'salary', label: 'Staff Salary Account Transactions', icon: '👤', types: ['account_opening'], acctType: 'staff_salary' },
      { key: 'income', label: 'Income Account Transactions', icon: '📈', types: ['operational_entry'], acctType: 'income' },
      { key: 'expense', label: 'Expense Account Transactions', icon: '📉', types: ['operational_entry'], acctType: 'expense' },
    ];
    // SURGICAL PATCH 2026-08-14: two bugs found together.
    // (1) acctType was defined on the salary/income/expense categories but
    // never actually checked in the filter below — so e.g. "Income" and
    // "Expense" both matched every operational_entry regardless of which
    // account it hit, and "Staff Salary" matched every account_opening
    // regardless of account type.
    // (2) Several real transaction types (wallet_fund, debt_repayment,
    // create_operational_account, and any future type) weren't in ANY
    // category's list, so approved admin transactions of those types
    // silently never appeared anywhere in this report. Added a catch-all
    // "Administration Transactions" category computed by EXCLUSION (not a
    // fixed list) so any current or future uncategorized type surfaces here
    // instead of disappearing again.
    const matchesCategory = (r, cat) => {
      if (!cat.types.includes(r.type)) return false;
      if (!cat.acctType) return true;
      const p = r.payload || {};
      if (r.type === 'operational_entry') return p.kind === cat.acctType;
      if (r.type === 'account_opening') return p.accountType === cat.acctType;
      return true;
    };
    const coveredTypes = new Set(categories.flatMap(c => c.types));
    categories.push({ key: 'admin', label: 'Administration Transactions', icon: '🛠️', types: [], isCatchAll: true });
    const matchesAny = (r, cat) => cat.isCatchAll ? !coveredTypes.has(r.type) : matchesCategory(r, cat);
    const approvals = state.approvals || [];
    const activeKey = filter.activeKey || null;
    const filterDate = filter.date || businessDate();

    // Get filtered approvals for the selected category
    let detailRows = '';
    let detailTitle = '';
    if (activeKey) {
      const cat = categories.find(c => c.key === activeKey);
      detailTitle = cat?.label || '';
      const filtered = approvals.filter(r => {
        if (r.status !== 'approved') return false;
        const d = r.payload?.date || String(r.approvedAt||'').slice(0,10);
        if (d !== filterDate) return false;
        return cat && matchesAny(r, cat);
      });

      if (filtered.length === 0) {
        detailRows = `<tr><td colspan="7" style="text-align:center;color:var(--muted)">No transactions for this date</td></tr>`;
      } else if (activeKey === 'customer') {
        // For customer view: compute running balance per account
        // Build a map of all approved transactions per account (all time, sorted by date)
        const allApproved = approvals.filter(r => r.status === 'approved');
        const balanceMap = {}; // accountId -> running balance up to (not including) filterDate
        const todayTxMap = {}; // accountId -> [{amount, type, date, req}] for filterDate

        const affectsAccount = (r) => ['customer_credit','customer_debit','customer_credit_journal','customer_debit_journal','intra_bank_transfer'].includes(r.type);

        allApproved.filter(affectsAccount).forEach(r => {
          const p = r.payload || {};
          const d = p.date || String(r.approvedAt||'').slice(0,10);
          const processEntry = (accountId, amount, isCreditForAccount) => {
            if (!accountId) return;
            if (d < filterDate) {
              balanceMap[accountId] = (balanceMap[accountId] || 0) + (isCreditForAccount ? amount : -amount);
            } else if (d === filterDate) {
              todayTxMap[accountId] = todayTxMap[accountId] || [];
              todayTxMap[accountId].push({ amount, isCredit: isCreditForAccount, type: r.type, req: r, date: d, approvedAt: r.approvedAt });
            }
          };
          if (r.type === 'intra_bank_transfer') {
            processEntry(p.sourceAccountId, Number(p.amount||0), false);
            processEntry(p.destAccountId, Number(p.amount||0), true);
          } else if (r.type === 'customer_credit' || r.type === 'customer_credit_journal') {
            const rows = r.type.endsWith('_journal') ? (p.rows||[]) : [p];
            rows.forEach(row => processEntry(row.customerId || p.customerId, Number(row.amount||p.amount||0), true));
          } else if (r.type === 'customer_debit' || r.type === 'customer_debit_journal') {
            const rows = r.type.endsWith('_journal') ? (p.rows||[]) : [p];
            rows.forEach(row => processEntry(row.customerId || p.customerId, Number(row.amount||p.amount||0), false));
          }
        });

        // Now render today's transactions with running balance
        const rows = [];
        Object.entries(todayTxMap).forEach(([accountId, txList]) => {
          const customer = (state.customers||[]).find(c => c.id === accountId);
          const acctNum = customer?.accountNumber || customer?.account_number || accountId;
          const acctName = customer?.name || customer?.full_name || customer?.display_name || '—';
          let running = balanceMap[accountId] || 0;
          txList.forEach((tx, idx) => {
            running += tx.isCredit ? tx.amount : -tx.amount;
            rows.push(`<tr>
              <td>${acctNum}</td>
              <td>${escapeHtml(acctName)}</td>
              <td>${tx.type.replace(/_/g,' ')}</td>
              <td class="${tx.isCredit?'':'balance-negative'}">${tx.isCredit?'+':'-'}${money(tx.amount)}</td>
              <td class="${running<0?'balance-negative':''}">${money(running)}</td>
              <td style="white-space:nowrap">${fmtDateTime(tx.approvedAt) || tx.date}</td>
            </tr>`);
          });
        });
        detailRows = rows.length ? rows.join('') : `<tr><td colspan="6" style="text-align:center;color:var(--muted)">No customer transactions for this date</td></tr>`;
        if (rows.length) {
          const totalCredit = Object.values(todayTxMap).flat().filter(t=>t.isCredit).reduce((s,t)=>s+t.amount,0);
          const totalDebit = Object.values(todayTxMap).flat().filter(t=>!t.isCredit).reduce((s,t)=>s+t.amount,0);
          detailRows += `<tr class="total-row"><td colspan="3"><strong>Total</strong></td><td><strong>+${money(totalCredit)} / -${money(totalDebit)}</strong></td><td colspan="2"></td></tr>`;
        }
        // Override table header for customer view
        const tableHeader = `<thead><tr><th>A/N</th><th>Customer</th><th>Type</th><th>Amount</th><th>Running Balance</th><th>Date &amp; Time</th></tr></thead>`;
        // Wrap in special marker for template below
        detailRows = `__CUSTOMER_TABLE__${tableHeader}<tbody>${detailRows}</tbody>`;
      } else {
        detailRows = filtered.map((r,i) => {
          const p = r.payload || {};
          const amount = p.amount || p.formAmount || (p.rows||[]).reduce((s,x)=>s+Number(x.amount||0),0) || 0;
          const from = p.staffName || p.sourceAccountName || p.sourceName || '—';
          const to = p.customerName || p.destAccountName || p.targetAccountName || '—';
          return `<tr><td>${i+1}</td><td>${r.type.replace(/_/g,' ')}</td><td>${escapeHtml(String(from))}</td><td>${escapeHtml(String(to))}</td><td>${money(amount)}</td><td style="white-space:nowrap">${fmtDateTime(r.approvedAt) || '—'}</td></tr>`;
        }).join('');
        const grandTotal = filtered.reduce((s,r) => {
          const p = r.payload || {};
          return s + (p.amount || p.formAmount || (p.rows||[]).reduce((sx,x)=>sx+Number(x.amount||0),0) || 0);
        }, 0);
        detailRows += `<tr class="total-row"><td colspan="4"><strong>Total</strong></td><td><strong>${money(grandTotal)}</strong></td><td></td></tr>`;
      }
    }

    // REDESIGN 2026-08-14: the two-column layout (tall vertical card list next
    // to a short table) forced vertical scrolling on the left panel while the
    // right panel sat mostly empty, and the table got squeezed into a narrow
    // column. Switched to horizontal chips that wrap naturally, with the
    // table full-width underneath — no more mismatched-height columns.
    const catChips = categories.map(c => {
      const count = approvals.filter(r => r.status==='approved' && matchesAny(r, c) && (r.payload?.date||String(r.approvedAt||'').slice(0,10)) === filterDate).length;
      const isActive = filter.activeKey === c.key;
      return `<button type="button" class="summary-cat-chip ${isActive?'active':''}" data-cat="${c.key}" style="cursor:pointer;padding:8px 14px;border-radius:20px;border:1.5px solid ${isActive?'var(--brand)':'var(--line)'};background:${isActive?'var(--accent)':'var(--panel)'};color:var(--text);display:inline-flex;align-items:center;gap:8px;font:inherit;text-align:left">
        <span style="font-size:1.15em">${c.icon}</span>
        <span><span style="font-weight:700;font-size:0.88em;color:var(--text)">${c.label}</span><span style="font-size:0.78em;color:var(--muted);margin-left:6px">${count}</span></span>
      </button>`;
    }).join('');

    return `
      <div class="form-card cs2-card" style="max-width:1120px">
        <div class="cs2-title">Transaction Summary</div>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap">
          <label style="font-size:0.88em;font-weight:600">Date</label>
          <input id="txSummaryDate" type="date" lang="en-GB" class="entry-input" value="${filterDate}" style="width:160px">
          <button id="txSummaryToday" class="sheet-btn secondary tiny-btn">Today</button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px">${catChips}</div>
        ${activeKey ? `
        <div style="min-width:0">
          <div style="font-weight:700;font-size:0.95em;margin-bottom:10px">${escapeHtml(detailTitle)} — ${filterDate}</div>
          <div class="table-wrap" style="max-width:100%;overflow-x:auto">
            ${detailRows.startsWith('__CUSTOMER_TABLE__')
              ? `<table class="table">${detailRows.replace('__CUSTOMER_TABLE__','')}</table>`
              : `<table class="table"><thead><tr><th>#</th><th>Type</th><th>Posted By</th><th>Account</th><th>Amount</th><th>Date</th></tr></thead><tbody>${detailRows}</tbody></table>`
            }
          </div>
        </div>` : `<div class="note">Select a category above to see its transactions for this date.</div>`}
      </div>`;
  }

  function bindTransactionSummary() {
    const filter = state.ui.txSummaryFilter ||= { date: businessDate() };
    const dateInput = byId('txSummaryDate');
    if (dateInput) dateInput.onchange = () => { filter.date = dateInput.value; filter.activeKey = null; save(); renderWorkspace(); };
    if (byId('txSummaryToday')) byId('txSummaryToday').onclick = () => { filter.date = businessDate(); filter.activeKey = null; save(); renderWorkspace(); };
    qq('.summary-cat-chip').forEach(card => {
      card.onclick = () => {
        filter.activeKey = filter.activeKey === card.dataset.cat ? null : card.dataset.cat;
        save(); renderWorkspace();
      };
    });
  }

  function bindMaintenance(prefix) {
    const draft = state.ui[`${prefix}Draft`] ||= {};
    const detailIds = [`${prefix}Name`, `${prefix}Address`, `${prefix}Phone`, `${prefix}Nin`, `${prefix}Bvn`, `${prefix}OldAccount`];
    const draftKeyOf = { [`${prefix}Name`]: 'name', [`${prefix}Address`]: 'address', [`${prefix}Phone`]: 'phone', [`${prefix}Nin`]: 'nin', [`${prefix}Bvn`]: 'bvn', [`${prefix}OldAccount`]: 'oldAccountNumber' };
    const clearFilledCustomer = () => {
      Object.keys(draft).forEach(k => delete draft[k]);
      state.ui.selectedCustomerId = null;
      save();
      renderWorkspace();
    };
    const setDetailsEditable = (editable) => {
      draft.editable = editable;
      save();
      detailIds.forEach(id => {
        const el = byId(id);
        if (!el) return;
        el.readOnly = !editable;
        el.classList.toggle('cs-readonly', !editable);
      });
    };
    const fillCustomer = (c) => {
      if (!c) return;
      if (prefix==='reactivation' && !(isCustomerFrozen(c) || c.active === false)) return showToast('Account is not frozen');
      state.ui.selectedCustomerId = c.id;
      draft.accountNumber = c.accountNumber || '';
      draft.name = c.name || '';
      draft.address = c.address || '';
      draft.phone = c.phone || '';
      draft.nin = c.nin || '';
      draft.bvn = c.bvn || '';
      draft.oldAccountNumber = c.oldAccountNumber || '';
      draft.editable = false;
      save();
      renderWorkspace();
    };
    // Every detail field writes straight into the persisted draft on each
    // keystroke (save() only — no renderWorkspace() here, same as Account
    // Opening) so a deferred render after blur rehydrates from state instead
    // of wiping the form.
    detailIds.forEach(id => {
      const el = byId(id);
      if (!el) return;
      el.oninput = () => { draft[draftKeyOf[id]] = el.value; save(); };
    });
    const doLookup = (quiet=false) => {
      const accVal = (byId(`${prefix}Acc`)?.value || '').trim();
      if (!accVal) {
        clearFilledCustomer();
        return;
      }
      const c = getCustomerByAccountNo(accVal);
      if (!c) {
        if (!quiet) showToast('Customer not found. Use name search.');
        return;
      }
      fillCustomer(c);
    };
    const accInput = byId(`${prefix}Acc`);
    if (accInput) {
      accInput.oninput = () => {
        const v = (accInput.value || '').trim();
        draft.accountNumber = v;
        save();
        if (!v) return;
        if (getCustomerByAccountNo(v)) doLookup(true);
      };
      accInput.onkeyup = (e) => { if (e.key === 'Enter') doLookup(false); };
    }
    const searchBtn = byId(`${prefix}Search`);
    if (searchBtn) searchBtn.onclick = () => openCustomerSearchModal(state.customers);
    const editBtn = byId(`${prefix}Edit`);
    if (editBtn) editBtn.onclick = () => {
      const c = getSelectedCustomer() || getCustomerByAccountNo(byId(`${prefix}Acc`).value);
      if (!c) return showToast('Search for an account first');
      setDetailsEditable(true);
      showToast(prefix === 'reactivation' ? 'Account details are now editable' : 'You can now edit and save the account details');
    };
    byId(`${prefix}Submit`).onclick = async () => {
  const c = getSelectedCustomer() || getCustomerByAccountNo(byId(`${prefix}Acc`).value);
  if (!c) return showToast('Search for an account first');

  let result;

  if (prefix === 'maintenance') {
    result = await submitApprovalThroughGateway('account_maintenance', {
      customerId: c.id,
      accountNumber: c.accountNumber,
      patch: {
        name: (draft.name || '').trim(),
        address: (draft.address || '').trim(),
        phone: (draft.phone || '').trim() || c.phone,
        nin: (draft.nin || '').trim() || c.nin,
        bvn: (draft.bvn || '').trim() || c.bvn,
        oldAccountNumber: (draft.oldAccountNumber || '').trim() || (c.oldAccountNumber || '')
      }
    });

    if (!result?.ok) return showToast(result?.error?.message || 'Unable to submit request');
    showToast('Maintenance request sent for approval');
  } else {
    result = await submitApprovalThroughGateway('account_reactivation', {
      customerId: c.id,
      accountNumber: c.accountNumber
    });

    if (!result?.ok) return showToast(result?.error?.message || 'Unable to submit request');
    showToast('Reactivation request sent for approval');
  }

  Object.keys(draft).forEach(k => delete draft[k]);
  save();
  render();
};

    const selected = getSelectedCustomer();
    if (selected) {
      const matchesTool = (accInput?.value || '').trim() ? (selected.accountNumber === (accInput?.value || '').trim()) : true;
      if (matchesTool) fillCustomer(selected);
    }
  }

  function bindStatement() {
    const filter = state.ui.accountStatementFilter ||= { from: '', to: '' };
    const stmtFrom = byId('stmtFrom');
    const stmtTo = byId('stmtTo');
    if (stmtFrom) stmtFrom.onchange = () => { filter.from = stmtFrom.value || ''; save(); };
    if (stmtTo) stmtTo.onchange = () => { filter.to = stmtTo.value || ''; save(); };

    const generateBtn = byId('stmtGenerate');
    if (generateBtn) generateBtn.onclick = () => {
      if (!getSelectedCustomer()) return showToast('No customer selected — go to Check Balance first');
      state.ui.accountStatementGenerated = true;
      save();
      renderWorkspace();
    };

    const printBtn = byId('stmtPrintBtn');
    if (printBtn) printBtn.onclick = () => {
      const area = byId('statementPrintArea')?.innerHTML;
      if (!area?.trim()) return showToast('Generate statement first');
      printHtml(`<h2>Customer Statement</h2>${area}</div>`);
    };
  }

  function getStaffOperationalBalance(staffId) {
    return getStaffOperationalBreakdown(staffId).variance;
  }

  function getStaffOperationalBreakdown(staffId) {
    // Cash = total funded to this teller's operational account by Treasury (approved credits).
    // Posting Cash = total drawn from it via customer postings so far (approved debits).
    // Variance = Cash - Posting Cash = what's actually left to work with (can go negative —
    // a teller may credit a customer before Treasury has funded/reconciled them).
    const opAccount = (state.customers || []).find(c =>
      c.accountType === 'staff_operational' && c.linkedStaffId === staffId
    );
    if (!opAccount) return { cash: 0, postingCash: 0, variance: 0 };
    const cash = (state.approvals || [])
      .filter(r => r.status === 'approved' &&
        (r.type === 'cash_receipt' || r.type === 'inter_staff_credit') &&
        (r.payload?.operationalAccountId === opAccount.id || r.payload?.targetAccountId === opAccount.id))
      .reduce((s, r) => s + Number(r.payload?.amount || 0), 0);
    const postingCash = (state.approvals || [])
      .filter(r => r.status === 'approved' && r.payload?.staffId === staffId &&
        ['customer_credit','customer_debit','customer_credit_journal','customer_debit_journal'].includes(r.type))
      .reduce((s, r) => s + (r.type.endsWith('_journal') ? Number(r.payload?.formAmount || 0) : Number(r.payload?.amount || 0)), 0);
    return { cash, postingCash, variance: cash - postingCash };
  }

  function hasApprovedFloat(staffId, dateStr) {
    return openingBalanceOnlyForDate(staffId, dateStr) > 0 || hasBaseOpeningBalanceForDate(staffId, dateStr);
  }


  function bindJournalStandalone() {
    const kind = state.ui.journalStandaloneKind === 'debit' ? 'debit' : 'credit';
    qq('input[name="journalStandaloneKind"]').forEach(radio => radio.onchange = () => {
      if (!radio.checked) return;
      state.ui.journalStandaloneKind = radio.value === 'debit' ? 'debit' : 'credit';
      save();
      renderWorkspace();
    });
    const startBtn = byId('genJournalStartBtn');
    if (startBtn) startBtn.onclick = () => {
      const staff = currentStaff();
      state.ui.generatedJournals ||= {};
      state.ui.collapsedJournals ||= {};
      const journalKey = `${staff?.id || 'staff'}:${businessDate()}:${kind}`;
      state.ui.generatedJournals[journalKey] = true;
      state.ui.collapsedJournals[journalKey] = false;
      save();
      renderWorkspace();
    };
    // All journal-builder wiring (search, add row, submit, charges, etc.) is
    // shared with the credit/debit screens — bindJournal() only touches
    // elements that exist on whichever screen is currently rendered.
    bindJournal(kind);
  }

  function bindJournal(kind) {
    const staff = currentStaff();
    const journalBtn = byId('txJournalAdd');
    const postBtn = byId('txPostSingle');
    if (journalBtn && postBtn && postBtn.parentElement) postBtn.parentElement.appendChild(journalBtn);
    state.ui.staffJournals ||= {};
    state.ui.staffJournalAttachments ||= {};
    state.ui.generatedJournals ||= {};
    const visibilityKey = `${staff.id}:${businessDate()}:${kind}`;
    state.ui.collapsedJournals ||= {};
    state.ui.telleringDrafts ||= {};
    // Restore journalName display if customer was previously selected
    requestAnimationFrame(() => {
      if (byId('journalName') && state.ui.selectedJournalCustomerId) {
        const restoredCustomer = getCustomerByAccountNo(state.ui.journalAccDraft || byId('journalAcc')?.value || '');
        if (restoredCustomer && byId('journalName').textContent === '—') {
          byId('journalName').textContent = restoredCustomer.name;
        }
      }
    });
    const telleringDraft = state.ui.telleringDrafts[visibilityKey] ||= { singleCharges: { apply: false, checked: {}, values: {} }, journalCharges: { apply: false, checked: {}, values: {} } };
    telleringDraft.singleCharges ||= { apply: false, checked: {}, values: {} };
    telleringDraft.singleCharges.checked ||= {};
    telleringDraft.singleCharges.values ||= {};
    telleringDraft.journalCharges ||= { apply: false, checked: {}, values: {} };
    telleringDraft.journalCharges.checked ||= {};
    telleringDraft.journalCharges.values ||= {};
    const journal = state.ui.staffJournals[visibilityKey] ||= [];
    const attachmentState = state.ui.staffJournalAttachments[visibilityKey] ||= { fieldNote: null, loading: false };

    const selectedMode = () => q('input[name="txMode"]:checked')?.value || 'cash';
    const readChargePreview = (scope, amountValue) => {
      const amount = Number(amountValue || 0);
      const applyToggleId = scope === 'single' ? 'txApplyCharges' : 'journalApplyCharges';
      const rowId = scope === 'single' ? 'txChargesRow' : 'journalChargesRow';
      const totalId = scope === 'single' ? 'txTotalCharges' : 'journalTotalCharges';
      const customerId = scope === 'single' ? 'txCustomerGets' : 'journalCustomerGets';
      const toggle = byId(applyToggleId);
      const row = byId(rowId);
      const totalEl = byId(totalId);
      const customerEl = byId(customerId);
      const enabled = !!(toggle && toggle.checked);
      if (row) row.classList.toggle('hidden', !enabled);

      let totalCharges = 0;
      CHARGE_DEFS.forEach(def => {
        const check = q(`[data-charge-check="${def.key}"][data-charge-scope="${scope}"]`);
        const input = q(`[data-charge-input="${def.key}"][data-charge-scope="${scope}"]`);
        const checked = !!(enabled && check && check.checked);
        if (input) {
          input.classList.toggle('hidden', !checked);
          if (!checked) input.value = '';
        }
        if (checked && input) {
          const val = Math.max(0, Number(input.value || 0));
          totalCharges += val;
        }
      });

      totalCharges = Math.min(totalCharges, Math.max(0, amount));
      const customerGets = Math.max(0, amount - totalCharges);
      if (totalEl) totalEl.textContent = money(totalCharges);
      if (customerEl) customerEl.textContent = money(customerGets);
      return { amount, totalCharges, customerGets };
    };
    const updateSingleCommissionPreview = () => readChargePreview('single', byId('txAmount')?.value || 0);
    const updateJournalCommissionPreview = () => readChargePreview('journal', parseAmountInput('journalAmount'));
    const collectChargeBreakdownFromUi = (scope, amountValue) => {
      const amount = Math.max(0, Number(amountValue || 0));
      const toggleId = scope === 'single' ? 'txApplyCharges' : 'journalApplyCharges';
      const toggle = byId(toggleId);
      if (!(toggle && toggle.checked)) return [];
      let remaining = amount;
      const rows = [];
      CHARGE_DEFS.forEach(def => {
        const check = q(`[data-charge-check="${def.key}"][data-charge-scope="${scope}"]`);
        const input = q(`[data-charge-input="${def.key}"][data-charge-scope="${scope}"]`);
        if (!(check && check.checked && input)) return;
        const raw = Math.max(0, Number(input.value || 0));
        const amt = Math.min(raw, remaining);
        if (amt > 0) {
          rows.push({ key: def.key, label: def.label, amount: amt });
          remaining = Math.max(0, remaining - amt);
        }
      });
      return rows;
    };
    const resetFields = () => {
      ['txAcc','txAmount','txDetails','txCounterparty'].forEach(id=>{ if(byId(id)) byId(id).value=''; });
      state.ui.txAccDraft = '';
      state.ui.txAmountDraft = '';
      state.ui.txDetailsDraft = '';
      state.ui.txCounterpartyDraft = '';
      state.ui.txModeDraft = 'cash';
      telleringDraft.singleCharges = { apply: false, checked: {}, values: {} };
      if (byId('txApplyCharges')) byId('txApplyCharges').checked = false;
      CHARGE_DEFS.forEach(def => {
        const check = q(`[data-charge-check="${def.key}"][data-charge-scope="single"]`);
        const input = q(`[data-charge-input="${def.key}"][data-charge-scope="single"]`);
        if (check) check.checked = false;
        if (input) input.value = '';
      });
      if (byId('txName')) byId('txName').textContent='—';
      if (byId('txBalance')) byId('txBalance').innerHTML='—';
      state.ui.selectedCustomerId=null;
      updateSingleCommissionPreview();
    };
    const resetJournalEntryFields = (clearAccount = false) => {
      // Always clear amount/details after each entry
      ['journalAmount','journalCounterparty','journalDetails'].forEach(id=>{ if(byId(id)) byId(id).value=''; });
      telleringDraft.journalAmount = '';
      telleringDraft.journalCharges = { apply: false, checked: {}, values: {} };
      if (byId('journalApplyCharges')) byId('journalApplyCharges').checked = false;
      CHARGE_DEFS.forEach(def => {
        const check = q(`[data-charge-check="${def.key}"][data-charge-scope="journal"]`);
        const input = q(`[data-charge-input="${def.key}"][data-charge-scope="journal"]`);
        if (check) check.checked = false;
        if (input) input.value = '';
      });
      // Only clear account/name when explicitly requested (e.g. journal cleared/submitted)
      if (clearAccount) {
        if (byId('journalAcc')) byId('journalAcc').value = '';
        if (byId('journalName')) byId('journalName').textContent = '—';
        state.ui.journalAccDraft = '';
        state.ui.selectedJournalCustomerId = null;
      }
      updateJournalCommissionPreview();
    };

    const recalcPreview = () => {
      // Staff operational balance — funded by Cash Officer credits, drawn by all postings.
      const opBalance = getStaffOperationalBalance(staff.id);
      const otherPendingDraftForms = pendingJournalTotal(staff.id, businessDate());
      const dailyRunning = opBalance - otherPendingDraftForms;

      // This journal's own FORM — no longer typed; it IS the teller's
      // current operational balance, always. Also update the display in
      // case the balance changed since this journal was opened (e.g. a
      // Treasury credit landed mid-session).
      const journalForm = opBalance;
      if (byId('journalFormAmount')) {
        byId('journalFormAmount').textContent = money(journalForm);
        byId('journalFormAmount').dataset.opBalance = journalForm;
      }
      let jRunning = journalForm;
      const withBalances = journal.map((row) => {
        jRunning -= Number(row.amount||0);
        const remaining = jRunning;
        const variance = Math.max(0, -remaining);
        return { row, formBase: journalForm, remaining, variance };
      });
      const rows = withBalances.map(({ row, remaining, variance }, displayIndex) => { const chargeMeta = getTotalChargeAmount(row) > 0 ? `<div class="journal-inline-meta">${chargeInlineMeta(row)}</div>` : ''; return `<tr><td>${displayIndex+1}</td><td>${escapeHtml(row.customerName || '')}${chargeMeta}</td><td>${escapeHtml(row.accountNumber || '')}</td><td>${money(row.amount)}</td><td class="${remaining<0?'balance-negative':''}">${money(remaining)}</td><td class="${variance>0?'balance-negative':''}">${money(variance)}</td><td><span class="linklike" data-remove-row="${row.id}">Remove</span></td></tr>`; }).join('') || '<tr><td colspan="7">No journal entries yet</td></tr>';
      if (byId('journalRows')) byId('journalRows').innerHTML = rows;
      const totalPosted = journal.reduce((sum, row) => sum + Number(row.amount || 0), 0);
      if (byId('journalTotalPosted')) byId('journalTotalPosted').textContent = money(totalPosted);
      const openingCashLive = getStaffOperationalBalance(staff.id);
      const cashReceivedLive = approvedCreditTotalForDateByMode(staff.id, businessDate(), 'cash');
      const cashWithdrawalLive = approvedDebitTotalForDateByMode(staff.id, businessDate(), 'cash');
      const tillLive = openingCashLive + cashReceivedLive - cashWithdrawalLive;
      if (byId('postingOpeningCash')) byId('postingOpeningCash').textContent = money(openingCashLive);
      if (byId('postingCashReceived')) byId('postingCashReceived').textContent = money(cashReceivedLive);
      if (byId('postingCashWithdrawal')) byId('postingCashWithdrawal').textContent = money(cashWithdrawalLive);
      if (byId('postingTill')) {
        const el = byId('postingTill');
        el.textContent = money(tillLive);
        el.classList.toggle('balance-negative', tillLive < 0);
      }
      if (byId('journalFormRunning')) byId('journalFormRunning').textContent = money(Math.max(0, jRunning));
      if (byId('journalFormVariance')) byId('journalFormVariance').textContent = money(Math.max(0, -jRunning));
      const fileNameEl = byId('journalFieldNoteName');
      if (fileNameEl) fileNameEl.textContent = attachmentState.loading ? 'Reading file…' : (attachmentState.fieldNote?.name ? `${attachmentState.fieldNote.name} (${formatFileSize(attachmentState.fieldNote.size)})` : 'No file selected');
      const inputEl = byId('journalFieldNoteInput');
      if (inputEl) inputEl.disabled = attachmentState.loading;
      // SURGICAL ADDITION 2026-08-19: field note previously only showed its
      // filename after upload — no way to confirm the right document was
      // attached before submitting. Render an actual preview (thumbnail for
      // images, a named link for PDFs since those can't inline-preview).
      const previewEl = byId('journalFieldNotePreview');
      if (previewEl) {
        const fn = attachmentState.fieldNote;
        if (!fn || attachmentState.loading) {
          previewEl.classList.add('hidden');
          previewEl.innerHTML = '';
        } else {
          previewEl.classList.remove('hidden');
          previewEl.innerHTML = String(fn.type || '').startsWith('image/')
            ? `<img src="${fn.dataUrl}" alt="Field note preview">`
            : `<a href="${fn.dataUrl}" target="_blank" rel="noopener" class="field-note-pdf-link">📄 ${escapeHtml(fn.name || 'Field note.pdf')}</a>`;
        }
      }
      qq('[data-remove-row]').forEach(el => el.onclick = () => {
        const idx = journal.findIndex(r => r.id === el.dataset.removeRow);
        if (idx >= 0) {
          journal.splice(idx,1);
          save();
          recalcPreview();
        }
      });
    };

    const searchSingle = (opts = {}) => {
      const value = (byId('txAcc')?.value || '').trim();
      state.ui.txAccDraft = value;
      const c = getCustomerByAccountNo(value);
      if (!c) { if (!opts.quiet) showToast('Customer not found'); return null; }
      if (isCustomerFrozen(c) || c.active === false) {
        freezeInactiveCustomer(c);
        if (!opts.quiet) save();
        if (!opts.quiet) showToast('Account is frozen');
        return null;
      }
      state.ui.selectedCustomerId = c.id;
      state.ui.generatedJournals ||= {};
      state.ui.collapsedJournals ||= {};
      state.ui.generatedJournals[visibilityKey] = false;
      state.ui.collapsedJournals[visibilityKey] = false;
      if (byId('txName')) byId('txName').textContent = c.name;
      if (byId('txBalance')) byId('txBalance').innerHTML = balanceHtml(c.balance);
      // Quiet auto-lookup must not save/repaint while the user is moving from
      // Account Number into Amount. Journal was fixed the same way: keep the
      // in-memory selection and DOM update now; persist later on post/journal actions.
      if (!opts.quiet) save();
      return c;
    };

    const restoreSingleCustomerDisplay = () => {
      const value = String(byId('txAcc')?.value || state.ui.txAccDraft || '').trim();
      // Never restore when there is no account value — prevents stale data showing after clear
      if (!value) return;
      const selected = state.ui.selectedCustomerId ? state.customers.find(c => c.id === state.ui.selectedCustomerId) : null;
      const customer = selected && String(selected.accountNumber || '') === value ? selected : getCustomerByAccountNo(value);
      if (!customer) return;
      state.ui.selectedCustomerId = customer.id;
      state.ui.txAccDraft = customer.accountNumber || value;
      if (byId('txAcc') && String(byId('txAcc').value || '').trim() !== String(customer.accountNumber || '')) byId('txAcc').value = customer.accountNumber || value;
      if (byId('txName')) byId('txName').textContent = customer.name || '—';
      if (byId('txBalance')) byId('txBalance').innerHTML = balanceHtml(customer.balance);
    };

    const searchJournal = (opts = {}) => {
      const value = (byId('journalAcc')?.value || state.ui.journalAccDraft || '').trim();
      const c = getCustomerByAccountNo(value);
      if (!c) { if (!opts.quiet) showToast('Customer not found'); return null; }
      if (isCustomerFrozen(c) || c.active === false) { freezeInactiveCustomer(c); save(); if (!opts.quiet) showToast('Account is frozen'); return null; }
      state.ui.selectedJournalCustomerId = c.id;
      state.ui.journalAccDraft = value;
      if (byId('journalAcc') && String(byId('journalAcc').value || '').trim() !== value) byId('journalAcc').value = value;
      if (byId('journalName')) byId('journalName').textContent = c.name || '—';
      // Journal lookup is deliberately DOM-only during entry. Saving here can cause
      // the journal entry row to repaint while the user is moving between Account
      // Number and Amount, which steals the first click/focus. The actual journal
      // state is persisted when adding/submitting/clearing the journal.
      return c;
    };

    if (byId('txSearch')) byId('txSearch').onclick = () => openCustomerSearchModal(state.customers);
    if (byId('txAcc')) {
      const clearSingleCustomer = () => {
        if (byId('txName')) byId('txName').textContent = '—';
        if (byId('txBalance')) byId('txBalance').innerHTML = '—';
        state.ui.selectedCustomerId = null;
        state.ui.generatedJournals ||= {};
        state.ui.collapsedJournals ||= {};
        state.ui.generatedJournals[visibilityKey] = false;
        state.ui.collapsedJournals[visibilityKey] = false;
        save();
      };
      byId('txAcc').oninput = () => {
        const v = (byId('txAcc').value || '').trim();
        state.ui.txAccDraft = v;
        if (!v) { clearSingleCustomer(); return; }
        // Avoid repaint/save races while typing/selecting. Only perform the
        // quiet lookup once a genuine account exists for whatever's typed so
        // far. SURGICAL FIX 2026-08-28: this used to require exactly 4 plain
        // digits (/^\d{4}$/) before even checking for a match — a leftover
        // from when every account number was 4 digits. Since then this app
        // gained Teller (T1), Staff Salary (S1), Expense (E1), Income (I1),
        // and variable-length customer numbers — none of which are 4 plain
        // digits, so live-as-you-type lookup silently never fired for any
        // of them. Now it checks for a real match directly instead of
        // pattern-matching a specific format.
        if (!getCustomerByAccountNo(v)) {
          if (byId('txName')) byId('txName').textContent = '—';
          if (byId('txBalance')) byId('txBalance').innerHTML = '—';
          state.ui.selectedCustomerId = null;
          save();
          return;
        }
        const existing = state.ui.selectedCustomerId ? state.customers.find(c => c.id === state.ui.selectedCustomerId) : null;
        if (!existing || String(existing.accountNumber || '') !== v) {
          searchSingle({ quiet: true });
        }
      };
      byId('txAcc').onchange = (event) => {
        const v = (byId('txAcc').value || '').trim();
        state.ui.txAccDraft = v;
        if (!v) { clearSingleCustomer(); return; }
        // Guard: check both state.customers (regular customers) and getCustomerByAccountNo
        // (which also resolves staff accounts that are not in state.customers directly).
        const alreadyInCustomers = state.ui.selectedCustomerId ? state.customers.find(c => c.id === state.ui.selectedCustomerId) : null;
        const alreadyResolved = alreadyInCustomers || (state.ui.selectedCustomerId ? getCustomerByAccountNo(v) : null);
        const alreadyMatchesAccount = alreadyResolved && String(alreadyResolved.accountNumber || '') === v;
        if (event?.relatedTarget?.id === 'txAmount' || alreadyMatchesAccount) {
          if (byId('txName')) byId('txName').textContent = alreadyResolved?.name || byId('txName')?.textContent || '—';
          if (alreadyResolved && byId('txBalance')) byId('txBalance').innerHTML = balanceHtml(alreadyResolved.balance);
          return;
        }
        searchSingle();
      };
      byId('txAcc').onkeyup = e => { if(e.key==='Enter') searchSingle(); };
    }

    if (byId('txApplyCharges')) byId('txApplyCharges').onchange = () => {
      telleringDraft.singleCharges.apply = !!byId('txApplyCharges')?.checked;
      save();
      updateSingleCommissionPreview();
    };
    if (byId('txAmount')) {
      const amountInput = byId('txAmount');
      amountInput.oninput = () => {
        state.ui.txAmountDraft = amountInput.value || '';
        updateSingleCommissionPreview();
        // Do NOT call restoreSingleCustomerDisplay here — it was triggering
        // state mutations on every keystroke. The customer display is already
        // set when the account is searched; it only needs restoring on blur/change.
      };
      amountInput.onchange = () => { state.ui.txAmountDraft = amountInput.value || ''; save(); restoreSingleCustomerDisplay(); };
    }
    if (byId('txCounterparty')) {
      byId('txCounterparty').oninput = () => { state.ui.txCounterpartyDraft = byId('txCounterparty').value || ''; };
      byId('txCounterparty').onchange = () => { state.ui.txCounterpartyDraft = byId('txCounterparty').value || ''; };
    }
    if (byId('txDetails')) {
      byId('txDetails').oninput = () => { state.ui.txDetailsDraft = byId('txDetails').value || ''; };
      byId('txDetails').onchange = () => { state.ui.txDetailsDraft = byId('txDetails').value || ''; };
    }
    qq('input[name="txMode"]').forEach(radio => {
      radio.onchange = () => { state.ui.txModeDraft = radio.value; };
    });
    CHARGE_DEFS.forEach(def => {
      const check = q(`[data-charge-check="${def.key}"][data-charge-scope="single"]`);
      const input = q(`[data-charge-input="${def.key}"][data-charge-scope="single"]`);
      if (check) check.onchange = () => {
        telleringDraft.singleCharges.checked[def.key] = !!check.checked;
        if (!check.checked) telleringDraft.singleCharges.values[def.key] = '';
        save();
        updateSingleCommissionPreview();
      };
      if (input) input.oninput = () => {
        telleringDraft.singleCharges.values[def.key] = input.value || '';
        save();
        updateSingleCommissionPreview();
      };
    });

    const jumpToJournalPane = () => {
      requestAnimationFrame(() => {
        const pane = byId('journalPane') || q('#journalPane') || byId('journalPaneWrap');
        if (pane && pane.scrollIntoView) pane.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    };

    if (byId('txJournalAdd')) byId('txJournalAdd').onclick = () => {
      state.ui.generatedJournals[visibilityKey] = true;
      state.ui.collapsedJournals[visibilityKey] = false;
      save();
      renderWorkspace();
      jumpToJournalPane();
    };

    const toggleJournalCollapse = () => {
      const willExpand = !!state.ui.collapsedJournals[visibilityKey];
      state.ui.collapsedJournals[visibilityKey] = !state.ui.collapsedJournals[visibilityKey];
      save();
      renderWorkspace();
      if (willExpand) jumpToJournalPane();
    };

    if (byId('journalCollapseBtn')) byId('journalCollapseBtn').onclick = toggleJournalCollapse;
    if (byId('journalCollapseTopBtn')) byId('journalCollapseTopBtn').onclick = toggleJournalCollapse;

    if (byId('journalSearchBtn')) byId('journalSearchBtn').onclick = () => openJournalCustomerSearchModal(state.customers);
    if (byId('journalAcc')) {
      const clearJournalCustomer = () => {
        if (byId('journalName')) byId('journalName').textContent = '—';
        state.ui.selectedJournalCustomerId = null;
        // Do NOT call save() here — it can trigger re-renders that wipe the account field
      };
      byId('journalAcc').oninput = () => {
        if (byId('journalAcc')?.dataset?.restoring === '1') return;
        const v = (byId('journalAcc').value || '').trim();
        // CRITICAL: set journalAccDraft immediately so any re-render restores this value
        state.ui.journalAccDraft = v;
        if (!v) {
          state.ui.selectedJournalCustomerId = null;
          if (byId('journalName')) byId('journalName').textContent = '—';
          // Do not save while editing the journal account field; saving can repaint and steal focus.
          return;
        }
        const selected = state.ui.selectedJournalCustomerId ? state.customers.find(c => c.id === state.ui.selectedJournalCustomerId) : null;
        if (selected && String(selected.accountNumber || '') !== v) {
          state.ui.selectedJournalCustomerId = null;
          if (byId('journalName')) byId('journalName').textContent = '—';
        }
        // SURGICAL FIX 2026-08-28: same stale-regex bug as txAcc above —
        // used to only auto-lookup on exactly 4 plain digits, silently never
        // firing for T1/S1/E1/I1-style or variable-length account numbers.
        // Now triggers on any genuine match.
        const found = getCustomerByAccountNo(v);
        if (found && !isCustomerFrozen(found) && found.active !== false) {
          state.ui.selectedJournalCustomerId = found.id;
          if (byId('journalName')) byId('journalName').textContent = found.name;
        }
        // Do not save while typing; saving through the gateway can repaint the journal row and steal focus.
      };
      byId('journalAcc').onchange = () => {
        if (byId('journalAcc')?.dataset?.restoring === '1') return;
        const v = (byId('journalAcc').value || '').trim();
        state.ui.journalAccDraft = v;
        if (!v) { clearJournalCustomer(); return; }
        // Check if already resolved (works for both customers and staff accounts)
        const alreadyInCustomers = state.ui.selectedJournalCustomerId ? state.customers.find(c => c.id === state.ui.selectedJournalCustomerId) : null;
        const alreadyByAccNo = !alreadyInCustomers ? getCustomerByAccountNo(v) : null;
        const already = alreadyInCustomers || alreadyByAccNo;
        if (already && String(already.accountNumber || '') === v) {
          if (byId('journalName')) byId('journalName').textContent = already.name || '—';
          if (already.id !== state.ui.selectedJournalCustomerId) state.ui.selectedJournalCustomerId = already.id;
        }
      };
      byId('journalAcc').onkeyup = e => { if(e.key==='Enter') searchJournal(); };
    }

    if (byId('journalApplyCharges')) byId('journalApplyCharges').onchange = () => {
      telleringDraft.journalCharges.apply = !!byId('journalApplyCharges')?.checked;
      save();
      updateJournalCommissionPreview();
    };
    // journalFormAmount is now a derived display (teller's operational
    // balance), not a typed input — no bind handler needed, it's rendered
    // fresh from getStaffOperationalBalance() on every render.
    qq('input[name="journalFormMode"]').forEach(radio => radio.onchange = () => {
      if (radio.checked) { telleringDraft.journalFormMode = radio.value; save(); recalcPreview(); }
    });
    if (byId('journalAmount')) {
      bindAmountCommaFormatting('journalAmount');
      const journalAmountInput = byId('journalAmount');
      const protectJournalAccountDraft = () => {
        const accountInput = byId('journalAcc');
        const currentValue = String(accountInput?.value || state.ui.journalAccDraft || '').trim();
        if (currentValue) state.ui.journalAccDraft = currentValue;
      };
      journalAmountInput.onfocus = protectJournalAccountDraft;
      journalAmountInput.oninput = () => {
        if (journalAmountInput.dataset?.restoring === '1') return;
        protectJournalAccountDraft();
        telleringDraft.journalAmount = journalAmountInput.value || '';
        updateJournalCommissionPreview();
      };
      journalAmountInput.onchange = () => { protectJournalAccountDraft(); telleringDraft.journalAmount = journalAmountInput.value || ''; };
    }
    CHARGE_DEFS.forEach(def => {
      const check = q(`[data-charge-check="${def.key}"][data-charge-scope="journal"]`);
      const input = q(`[data-charge-input="${def.key}"][data-charge-scope="journal"]`);
      if (check) check.onchange = () => {
        telleringDraft.journalCharges.checked[def.key] = !!check.checked;
        if (!check.checked) telleringDraft.journalCharges.values[def.key] = '';
        save();
        updateJournalCommissionPreview();
      };
      if (input) input.oninput = () => {
        telleringDraft.journalCharges.values[def.key] = input.value || '';
        save();
        updateJournalCommissionPreview();
      };
    });

    const readJournalEntrySnapshot = () => ({
      acc: String(byId('journalAcc')?.value || ''),
      amount: String(byId('journalAmount')?.value || ''),
      counterparty: String(byId('journalCounterparty')?.value || ''),
      details: String(byId('journalDetails')?.value || ''),
      name: String(byId('journalName')?.textContent || '—'),
      selectedJournalCustomerId: state.ui.selectedJournalCustomerId || '',
      charges: {
        apply: !!telleringDraft.journalCharges?.apply,
        checked: { ...(telleringDraft.journalCharges?.checked || {}) },
        values: { ...(telleringDraft.journalCharges?.values || {}) }
      }
    });

    const restoreJournalEntrySnapshot = (snapshot) => {
      if (!snapshot) return;
      // Use a flag to suppress oninput/onchange handlers during restore
      const _restore = true;
      const setVal = (id, val) => {
        const el = byId(id);
        if (!el) return;
        el.dataset.restoring = '1';
        el.value = val;
        delete el.dataset.restoring;
      };
      setVal('journalAcc', snapshot.acc);
      setVal('journalAmount', snapshot.amount);
      setVal('journalCounterparty', snapshot.counterparty);
      setVal('journalDetails', snapshot.details);
      if (byId('journalName')) byId('journalName').textContent = snapshot.name || '—';
      state.ui.selectedJournalCustomerId = snapshot.selectedJournalCustomerId || state.ui.selectedJournalCustomerId || null;
      telleringDraft.journalAmount = snapshot.amount;
      telleringDraft.journalCharges = {
        apply: !!snapshot.charges?.apply,
        checked: { ...(snapshot.charges?.checked || {}) },
        values: { ...(snapshot.charges?.values || {}) }
      };
      if (byId('journalApplyCharges')) byId('journalApplyCharges').checked = !!telleringDraft.journalCharges.apply;
      CHARGE_DEFS.forEach(def => {
        const check = q(`[data-charge-check="${def.key}"][data-charge-scope="journal"]`);
        const input = q(`[data-charge-input="${def.key}"][data-charge-scope="journal"]`);
        if (check) check.checked = !!telleringDraft.journalCharges.checked[def.key];
        if (input) {
          input.dataset.restoring = '1';
          input.value = telleringDraft.journalCharges.values[def.key] || '';
          input.classList.toggle('hidden', !telleringDraft.journalCharges.checked[def.key]);
          delete input.dataset.restoring;
        }
      });
      updateJournalCommissionPreview();
    };

    if (byId('journalAddRow')) byId('journalAddRow').onclick = (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      const journalEntrySnapshot = readJournalEntrySnapshot();
      const journalAccValue = String(byId('journalAcc')?.value || state.ui.journalAccDraft || '').trim();
      const selectedJournalCustomer = state.ui.selectedJournalCustomerId ? state.customers.find(c => c.id === state.ui.selectedJournalCustomerId) : null;
      // Try to find customer: first by selected ID, then by account number lookup
      const customer = (selectedJournalCustomer && String(selectedJournalCustomer.accountNumber || '') === journalAccValue)
        ? selectedJournalCustomer
        : getCustomerByAccountNo(journalAccValue);
      // If still not found by account number alone, try matching against all customers
      const resolvedCustomer = customer || state.customers.find(c => String(c.accountNumber || '') === journalAccValue && c.active !== false);
      if (resolvedCustomer && !state.ui.selectedJournalCustomerId) {
        // Auto-resolve the customer if we found them by account number
        state.ui.selectedJournalCustomerId = resolvedCustomer.id;
        if (byId('journalName')) byId('journalName').textContent = resolvedCustomer.name || '—';
      }
      if (!journalAccValue || !resolvedCustomer) return showToast('Enter a valid account number');
      if (isCustomerFrozen(resolvedCustomer) || resolvedCustomer.active === false) { freezeInactiveCustomer(resolvedCustomer); save(); return showToast('Frozen account cannot accept transactions'); }
      const amount = parseAmountInput('journalAmount');
      if (!(amount > 0)) return showToast('Enter a valid amount');
      const mode = selectedMode();
      const chargeBreakdown = kind === 'credit' ? collectChargeBreakdownFromUi('journal', amount) : [];
      const totalChargeAmount = chargeBreakdown.reduce((sum, row) => sum + Number(row.amount || 0), 0);
      const customerCreditAmount = kind === 'credit' ? Math.max(0, amount - totalChargeAmount) : amount;
      journal.unshift({
        id: uid('jr'),
        customerId: resolvedCustomer.id,
        customerName: resolvedCustomer.name,
        accountNumber: resolvedCustomer.accountNumber,
        accountType: resolvedCustomer.accountType || 'customer',
        staffAccountId: (resolvedCustomer.accountType === 'staff' || resolvedCustomer.accountType === 'staff_wallet') ? (resolvedCustomer.staffId || resolvedCustomer.id) : '',
        staffAccountUuid: (resolvedCustomer.accountType === 'staff' || resolvedCustomer.accountType === 'staff_wallet') ? (resolvedCustomer.staffUuid || getStaffBackendId(state.staff?.find(s => s.id === resolvedCustomer.staffId)) || '') : '',
        amount,
        customerCreditAmount,
        chargeBreakdown,
        totalChargeAmount,
        commissionAmount: chargeBreakdown.find(row => row.key === 'commission')?.amount || 0,
        chargeTraceId: totalChargeAmount > 0 ? uid('ctr') : '',
        commissionTraceId: totalChargeAmount > 0 ? uid('ctr') : '',
        details: byId('journalDetails')?.value.trim() || '',
        receivedOrPaidBy: byId('journalCounterparty')?.value.trim() || '',
        payoutSource: mode,
        paymentMode: mode,
        date: businessDate()
      });
      // Clear the journal draft state before saving so the next render cannot restore old entry values.
      resetJournalEntryFields(true);
      state.ui.journalAccDraft = '';
      state.ui.selectedJournalCustomerId = null;
      telleringDraft.journalAmount = '';
      telleringDraft.journalCharges = { apply: false, checked: {}, values: {} };
      if (byId('journalAcc')) byId('journalAcc').value = '';
      if (byId('journalName')) byId('journalName').textContent = '—';
      recalcPreview();
      save();
      // Re-focus account for next entry
      requestAnimationFrame(() => byId('journalAcc')?.focus({ preventScroll: true }));
    };

    const fieldNoteInput = byId('journalFieldNoteInput');
    if (fieldNoteInput) {
      fieldNoteInput.value = '';
      fieldNoteInput.onchange = async (event) => {
        const file = event?.target?.files?.[0] || null;
        if (!file) { attachmentState.fieldNote = null; attachmentState.loading = false; save(); recalcPreview(); return; }
        if (!isSupportedFieldNoteFile(file)) { event.target.value = ''; attachmentState.fieldNote = null; attachmentState.loading = false; save(); recalcPreview(); return showToast('Only image and PDF field notes are supported'); }
        if (!String(file.type || '').startsWith('image/') && Number(file.size || 0) > FIELD_NOTE_MAX_BYTES) { event.target.value = ''; attachmentState.fieldNote = null; attachmentState.loading = false; save(); recalcPreview(); return showToast('Field note must be 2 MB or less'); }
        attachmentState.loading = true; save(); recalcPreview();
        try {
          attachmentState.fieldNote = await readFieldNoteFile(file);
          if (Number(attachmentState.fieldNote?.size || 0) > FIELD_NOTE_MAX_BYTES) {
            event.target.value = '';
            attachmentState.fieldNote = null;
            throw new Error('Field note must be 2 MB or less');
          }
        } catch (error) {
          attachmentState.fieldNote = null;
          showToast(error?.message || 'Unable to read selected file');
        } finally {
          attachmentState.loading = false;
          save();
          recalcPreview();
        }
      };
    }

    if (byId('journalClear')) byId('journalClear').onclick = () => {
      journal.splice(0);
      attachmentState.fieldNote = null;
      attachmentState.loading = false;
      state.ui.generatedJournals[visibilityKey] = false;
      state.ui.journalAccDraft = '';
      state.ui.selectedJournalCustomerId = null;
      telleringDraft.journalAmount = '';
      telleringDraft.journalFormAmount = '';
      telleringDraft.journalFormMode = 'cash';
      const input = byId('journalFieldNoteInput');
      if (input) input.value = '';
      save();
      renderWorkspace();
    };

    if (byId('txPostSingle')) byId('txPostSingle').onclick = () => {
      if (!hasPermission(kind)) return showToast('No access to post');
      if (isBusinessDateClosed(businessDate())) return showToast(businessDateClosedMessage(businessDate()));
      if (kind === 'debit' && getStaffOperationalBalance(staff.id) <= 0) return showToast('No operational balance to debit from — request a credit from Treasury first');
      const accountNumberInput = String(byId('txAcc')?.value || '').trim();
      const customer = getCustomerByAccountNo(accountNumberInput);
      if (!accountNumberInput || !customer) return showToast('Search for customer first');
      if (isCustomerFrozen(customer) || customer.active === false) { freezeInactiveCustomer(customer); save(); return showToast('Frozen account cannot accept transactions'); }
      const amount = Number(byId('txAmount').value || 0);
      if (!(amount > 0)) return showToast('Enter a valid amount');
      if (kind === 'debit' && amount > getStaffOperationalBalance(staff.id) + 0.01) return showToast(`Debit exceeds your operational balance (${money(getStaffOperationalBalance(staff.id))})`);
      const mode = selectedMode();
      const chargeBreakdown = kind === 'credit' ? collectChargeBreakdownFromUi('single', amount) : [];
      const totalChargeAmount = chargeBreakdown.reduce((sum, row) => sum + Number(row.amount || 0), 0);
      const customerCreditAmount = kind === 'credit' ? Math.max(0, amount - totalChargeAmount) : amount;
      // Snapshot form values NOW before confirmAction closes the modal (blur events
      // can fire during modal close and re-populate state from DOM values).
      const _details = String(byId('txDetails')?.value || '').trim();
      const _counterparty = String(byId('txCounterparty')?.value || '').trim();
      confirmAction(`Submit single ${kind} request for approval?`, async () => {
        // Wipe state and DOM immediately — before the network call — so no interim
        // render (from realtime events etc.) can ever restore old values.
        state.ui.txAccDraft = '';
        state.ui.txAmountDraft = '';
        state.ui.txDetailsDraft = '';
        state.ui.txCounterpartyDraft = '';
        state.ui.selectedCustomerId = null;
        if (state.ui.telleringDrafts) {
          state.ui.telleringDrafts[visibilityKey] = {
            singleCharges: { apply: false, checked: {}, values: {} },
            journalCharges: { apply: false, checked: {}, values: {} }
          };
        }
        ['txAcc','txAmount','txDetails','txCounterparty'].forEach(id => { const el = byId(id); if (el) el.value = ''; });
        if (byId('txName')) byId('txName').textContent = '—';
        if (byId('txBalance')) byId('txBalance').innerHTML = '—';
        save();
        showProcessing('Sending request...');
        await nextPaint();
        try {
          const result = await submitApprovalThroughGateway(kind === 'credit' ? 'customer_credit' : 'customer_debit', {
            customerId: customer.id,
            customerName: customer.name,
            accountNumber: customer.accountNumber,
            accountType: customer.accountType || 'customer',
            staffAccountId: customer.accountType === 'staff' ? customer.staffId : '',
            staffAccountUuid: customer.accountType === 'staff' ? customer.staffUuid : '',
            amount,
            customerCreditAmount,
            chargeBreakdown,
            totalChargeAmount,
            commissionAmount: chargeBreakdown.find(row => row.key === 'commission')?.amount || 0,
            chargeTraceId: totalChargeAmount > 0 ? uid('ctr') : '',
            commissionTraceId: totalChargeAmount > 0 ? uid('ctr') : '',
            details: _details,
            receivedOrPaidBy: _counterparty,
            payoutSource: mode,
            paymentMode: mode,
            staffId: staff.id,
            date: businessDate()
          });
          if (!result?.ok) {
            showToast(result?.error?.message || 'Unable to submit request');
            return;
          }
          showToast(`${kind === 'credit' ? 'Credit' : 'Debit'} request sent for approval`);
          renderWorkspace();
        } finally {
          hideProcessing();
        }
      });
    };

    if (byId('journalSubmit')) byId('journalSubmit').onclick = () => {
      if (!hasPermission(kind)) return showToast('No access to post');
      if (isBusinessDateClosed(businessDate())) return showToast(businessDateClosedMessage(businessDate()));
      // SURGICAL PATCH 2026-08-24 (client request): Journal Form Amount is
      // no longer typed — it's always the teller's current operational
      // balance. Applies to both credit and debit now (previously this
      // guard only checked debit): if the balance is zero or negative,
      // there's nothing to post against, so submission stops here.
      const journalFormAmount = getStaffOperationalBalance(staff.id);
      if (!(journalFormAmount > 0)) return showToast('No operational balance to post against — request a credit from Treasury first');
      const alreadySubmitted = (state.approvals || []).some(r =>
        r.type === (kind === 'credit' ? 'customer_credit_journal' : 'customer_debit_journal') &&
        r.payload?.staffId === staff.id && r.payload?.date === businessDate() &&
        (r.status === 'pending' || r.status === 'approved')
      );
      if (alreadySubmitted) return showToast(`A ${kind} journal has already been submitted for today. Use direct ${kind} for any additions.`);
      if (!journal.length) return showToast('Generate journal first');
      // Journal must balance: sum of rows must exactly equal the journal form amount
      const rowTotal = journal.reduce((s, r) => s + Number(r.amount || 0), 0);
      if (Math.abs(rowTotal - journalFormAmount) > 0.01) return showToast(`Journal does not balance — row total ${money(rowTotal)} must equal your operational balance ${money(journalFormAmount)}`);
      // NOTE: journalFormAmount IS getStaffOperationalBalance(staff.id) now
      // (see above) — the old "form amount can't exceed balance" check is
      // gone because it can no longer be anything other than the balance;
      // there's nothing left for it to exceed.
      const journalFormMode = (q('input[name="journalFormMode"]:checked')?.value) || telleringDraft.journalFormMode || 'cash';
      if (attachmentState.loading) return showToast('Please wait for the field note to finish loading');
      if (byId('journalSubmit')?.dataset?.submitting === '1') return;
      confirmAction(`Submit ${kind} journal for approval?`, async () => {
        const submitBtn = byId('journalSubmit');
        if (submitBtn) { submitBtn.dataset.submitting = '1'; submitBtn.disabled = true; }
        showProcessing('Sending journal...');
        await nextPaint();
        try {
          const result = await submitApprovalThroughGateway(kind === 'credit' ? 'customer_credit_journal' : 'customer_debit_journal', {
            staffId: staff.id,
            date: businessDate(),
            formAmount: journalFormAmount,
            formPaymentMode: journalFormMode,
            rows: journal.map(row => ({
              customerId: row.customerId,
              customerName: row.customerName,
              accountNumber: row.accountNumber,
              accountType: row.accountType || 'customer',
              staffAccountId: row.staffAccountId || '',
              staffAccountUuid: row.staffAccountUuid || '',
              amount: row.amount,
              customerCreditAmount: row.customerCreditAmount,
              chargeBreakdown: row.chargeBreakdown,
              totalChargeAmount: row.totalChargeAmount,
              commissionAmount: row.commissionAmount,
              chargeTraceId: row.chargeTraceId || row.commissionTraceId,
              commissionTraceId: row.commissionTraceId,
              details: row.details,
              receivedOrPaidBy: row.receivedOrPaidBy,
              payoutSource: row.payoutSource,
              paymentMode: row.paymentMode
            })),
            fieldNote: attachmentState.fieldNote ? { name: attachmentState.fieldNote.name, type: attachmentState.fieldNote.type, size: attachmentState.fieldNote.size, dataUrl: attachmentState.fieldNote.dataUrl, uploadedAt: attachmentState.fieldNote.uploadedAt } : null
          });
          if (!result?.ok) return showToast(result?.error?.message || 'Unable to submit journal');
          journal.splice(0);
          attachmentState.fieldNote = null;
          attachmentState.loading = false;
          state.ui.generatedJournals[visibilityKey] = false;
          telleringDraft.journalFormAmount = '';
          telleringDraft.journalFormMode = 'cash';
          const input = byId('journalFieldNoteInput');
          if (input) input.value = '';
          save();
          showToast(`${kind === 'credit' ? 'Credit' : 'Debit'} journal sent for approval`);
          renderWorkspace();
        } finally {
          hideProcessing();
          const submitBtn = byId('journalSubmit');
          if (submitBtn) { delete submitBtn.dataset.submitting; submitBtn.disabled = false; }
        }
      });
    };

    restoreSingleCustomerDisplay();
    updateSingleCommissionPreview();
    updateJournalCommissionPreview();
    recalcPreview();
  }

  function bindApprovals() {
    cleanupApprovalReviewLocks();
    state.ui.selectedApprovalIds ||= [];
    const refreshApprovalSelection = () => {
      state.ui.selectedApprovalIds = state.ui.selectedApprovalIds.filter(id => (state.approvals || []).some(a => a.id === id && a.status === 'pending') && !isApprovalLockedByOther(id));
      save();
    };
    refreshApprovalSelection();
    qq('[data-approval-select]').forEach(box => box.onchange = async () => {
      const id = box.dataset.approvalSelect;
      if (box.checked) {
        box.disabled = true;
        const lockResult = await setApprovalReviewLock(id);
        if (lockResult?.ok === false || isApprovalLockedByOther(id)) {
          box.checked = false;
          state.ui.selectedApprovalIds = state.ui.selectedApprovalIds.filter(x => x !== id);
        } else if (!state.ui.selectedApprovalIds.includes(id)) {
          state.ui.selectedApprovalIds.push(id);
        }
        box.disabled = false;
      } else {
        state.ui.selectedApprovalIds = state.ui.selectedApprovalIds.filter(x => x !== id);
      }
      save();
      renderWorkspace();
    });
    const visibleSelectable = () => qq('[data-approval-select]').filter(box => !box.disabled).map(box => box.dataset.approvalSelect);
    const selectAll = byId('approvalSelectAll');
    if (selectAll) selectAll.onclick = async () => {
      const ids = visibleSelectable();
      for (const id of ids) {
        if (isApprovalLockedByOther(id)) continue;
        const lockResult = await setApprovalReviewLock(id);
        if (lockResult?.ok !== false && !isApprovalLockedByOther(id) && !state.ui.selectedApprovalIds.includes(id)) {
          state.ui.selectedApprovalIds.push(id);
        }
      }
      save();
      renderWorkspace();
    };
    const clearSel = byId('approvalClearSelection');
    if (clearSel) clearSel.onclick = () => { state.ui.selectedApprovalIds = []; save(); renderWorkspace(); };
    const runBulk = (mode) => {
      if (!hasPermission('approval_queue')) return showToast('No approval rights');
      const ids = (state.ui.selectedApprovalIds || []).filter(id => !isApprovalLockedByOther(id));
      if (!ids.length) return showToast('Select pending requests first');
      confirmAction(`${mode === 'approve' ? 'Approve' : 'Reject'} ${ids.length} selected request${ids.length === 1 ? '' : 's'}?`, async () => {
        showProcessing(mode === 'approve' ? 'Approving selected requests...' : 'Rejecting selected requests...');
        await nextPaint();
        try {
          for (const id of ids) {
            const result = mode === 'approve' ? await approveRequestRemote(id) : await rejectRequestRemote(id);
            if (result?.ok === false) showToast(result?.error?.message || `Unable to ${mode} one selected request`);
          }
          state.ui.selectedApprovalIds = [];
          save();
          renderWorkspace();
        } finally {
          hideProcessing();
        }
      });
    };
    const bulkApprove = byId('approvalBulkApprove');
    if (bulkApprove) bulkApprove.onclick = () => runBulk('approve');
    const bulkReject = byId('approvalBulkReject');
    if (bulkReject) bulkReject.onclick = () => runBulk('reject');
    const isRoutedAway = (req) => {
      const viewer = currentStaff();
      if (viewer?.role !== 'approving_officer') return false; // admin always allowed
      const assignedTo = req?.payload?.assignedApproverId;
      return !!(assignedTo && assignedTo !== viewer.id);
    };
    qq('[data-approve]').forEach(btn => btn.onclick = () => {
      if (!hasPermission('approval_queue')) return showToast('No approval rights');
      const reqId = btn.dataset.approve;
      if (isApprovalLockedByOther(reqId)) return showToast('This request is being reviewed by another staff');
      const req = state.approvals.find(r => r.id === reqId);
      if (isRoutedAway(req)) return showToast(`This request was sent to ${req?.payload?.assignedApproverName || 'another approving officer'} — only they or an Admin can approve it`);
      if (req && req.type === 'account_opening' && (req.payload?.accountType || 'customer') === 'customer') {
        // SURGICAL PATCH 2026-08-14: account number is now assigned by
        // Customer Service at Account Opening, not typed in by the approver
        // here — check the stored payload value directly instead of reading
        // a DOM input that no longer exists (which would otherwise block
        // every customer approval, correctly-assigned or not).
        if (!String(req.payload?.generatedAccountNumber || '').trim()) {
          return showToast('No account number assigned. Return this request to Customer Service.');
        }
      }
      confirmAction('Approve this request?', async () => {
        showProcessing('Approving request...');
        await nextPaint();
        try {
          const result = await approveRequestRemote(reqId);
          if (result?.ok === false) showToast(result?.error?.message || 'Unable to approve request');
        } finally {
          hideProcessing();
        }
      });
    });
    qq('[data-reject]').forEach(btn => btn.onclick = () => {
      if (!hasPermission('approval_queue')) return showToast('No approval rights');
      if (isApprovalLockedByOther(btn.dataset.reject)) return showToast('This request is being reviewed by another staff');
      const rejectReq = state.approvals.find(r => r.id === btn.dataset.reject);
      if (isRoutedAway(rejectReq)) return showToast(`This request was sent to ${rejectReq?.payload?.assignedApproverName || 'another approving officer'} — only they or an Admin can act on it`);
      confirmAction('Reject this request?', async () => {
        showProcessing('Rejecting request...');
        await nextPaint();
        try {
          const result = await rejectRequestRemote(btn.dataset.reject);
          if (result?.ok === false) showToast(result?.error?.message || 'Unable to reject request');
        } finally {
          hideProcessing();
        }
      });
    });
    qq('[data-cod-resolve]').forEach(btn => btn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const codId = btn.dataset.codResolve || btn.getAttribute('data-cod-resolve') || '';
      openCODResolutionModal(codId);
    });
    const more = byId('approvalsMore');
    if (more) more.onclick = () => { state.ui.approvalsLimit = (state.ui.approvalsLimit || 20) + 20; save(); renderWorkspace(); };
    const less = byId('approvalsLess');
    if (less) less.onclick = () => { state.ui.approvalsLimit = Math.max(20, (state.ui.approvalsLimit || 20) - 20); save(); renderWorkspace(); };
    const historyMore = byId('approvalHistoryMore');
    if (historyMore) historyMore.onclick = () => { state.ui.approvalHistoryLimit = (state.ui.approvalHistoryLimit || 30) + 30; save(); renderWorkspace(); };
    const historyLess = byId('approvalHistoryLess');
    if (historyLess) historyLess.onclick = () => { state.ui.approvalHistoryLimit = Math.max(30, (state.ui.approvalHistoryLimit || 30) - 30); save(); renderWorkspace(); };
    const codDate = byId('codAdminDate');
    if (codDate) codDate.onchange = () => { state.ui.codAdminDate = codDate.value || businessDate(); save(); renderWorkspace(); };
    const codResolutionMore = byId('codResolutionMore');
    if (codResolutionMore) codResolutionMore.onclick = () => { state.ui.codResolutionLimit = (state.ui.codResolutionLimit||10)+10; save(); renderWorkspace(); };
    const codResolutionLess = byId('codResolutionLess');
    if (codResolutionLess) codResolutionLess.onclick = () => { state.ui.codResolutionLimit = Math.max(10,(state.ui.codResolutionLimit||10)-10); save(); renderWorkspace(); };
    const approvalsCentralCloseDayBtn = byId('approvalsCentralCloseDayBtn');
    if (approvalsCentralCloseDayBtn) approvalsCentralCloseDayBtn.onclick = () => openCODModal();
    qq('[data-approval-section]').forEach(btn => btn.onclick = ()=>{ state.ui.approvalsSection = btn.dataset.approvalSection; save(); renderWorkspace(); smoothScrollToOpenedSegment('#approvalsSectionTabs'); });
    const assignTopup = byId('assignFloatTopupFromApprovals');
    if (assignTopup) assignTopup.onclick = () => openFloatTopUpModal();
    qq('[data-inspect-journal]').forEach(btn => {
      btn.style.pointerEvents = 'auto';
      btn.style.position = 'relative';
      btn.style.zIndex = '10';
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        setApprovalReviewLock(this.dataset.inspectJournal); renderWorkspace(); openRequestDetailModal(this.dataset.inspectJournal);
      }, true);
    });
    qq('[data-inspect-request]').forEach(btn => btn.onclick = ()=> { setApprovalReviewLock(btn.dataset.inspectRequest); renderWorkspace(); openRequestDetailModal(btn.dataset.inspectRequest); });
  }

  function bindPermissions() {
    byId('grantSubmit').onclick = () => {
      createRequest('temp_grant', {
        staffId: byId('grantStaff').value,
        tool: byId('grantTool').value,
        enabled: byId('grantEnabled').value === 'true'
      });
      showToast('Temporary grant request sent for approval');
      render();
    };
  }

  function nextOperationalNumber(category) {
    // SURGICAL PATCH 2026-08-21: simplified per client request — plain
    // single-letter-prefix + sequential number (I1, I2... / E1, E2...)
    // instead of the old INC-2000/EXP-3000 style. Still client-generated
    // (not a DB sequence, unlike Teller/Staff Salary) since this was
    // already just a local array-length counter.
    const list = category === 'income' ? state.operations.incomeAccounts : state.operations.expenseAccounts;
    const prefix = category === 'income' ? 'I' : 'E';
    return `${prefix}${list.length + 1}`;
  }

  function bindOperationalAccounts() {
    const updatePreview = () => {
      const cat = byId('oaCategory').value;
      byId('oaNumberPreview').textContent = nextOperationalNumber(cat);
    };
    if (byId('oaCategory')) { updatePreview(); byId('oaCategory').onchange = updatePreview; }
    if (byId('oaCreate')) byId('oaCreate').onclick = async () => {
      if (currentStaff()?.role !== 'admin_officer') return showToast('Only admin can create operational accounts');
      const category = byId('oaCategory').value;
      const name = byId('oaName').value.trim();
      if (!name) return showToast('Enter account name');
      showProcessing('Submitting operational account...');
      await nextPaint();
      try {
        const result = await submitApprovalThroughGateway('create_operational_account', { category, name, accountNumber: nextOperationalNumber(category) });
        if (result?.ok === false) return showToast(result?.error?.message || 'Unable to submit operational account');
        showToast('Operational account request sent');
        render();
      } finally {
        hideProcessing();
      }
    };
    const syncKind = () => {
      const id = byId('oeAccount').value;
      const income = state.operations.incomeAccounts.find(a=>a.id===id);
      byId('oeKindDisplay').textContent = income ? 'Income' : 'Expense';
    };
    syncKind();
    byId('oeAccount').onchange = syncKind;
    byId('oeSubmit').onclick = async () => {
      const accountId = byId('oeAccount').value;
      const amount = Number(byId('oeAmount').value || 0);
      const date = byId('oeDate').value || today();
      const note = byId('oeNote').value.trim();
      if (isBusinessDateClosed(date)) return showToast(businessDateClosedMessage(date));
      if (!(amount > 0)) return showToast('Enter amount');
      const account = [...state.operations.incomeAccounts, ...state.operations.expenseAccounts].find(a=>a.id===accountId);
      if (!account) return showToast('Select account');
      const kind = state.operations.incomeAccounts.some(a=>a.id===accountId) ? 'income' : 'expense';
      showProcessing('Submitting operational posting...');
      await nextPaint();
      try {
        const result = await submitApprovalThroughGateway('operational_entry', { accountId, accountName: account.name, kind, amount, note, date });
        if (result?.ok === false) return showToast(result?.error?.message || 'Unable to submit operational posting');
        showToast('Operational posting sent for approval');
        render();
      } finally {
        hideProcessing();
      }
    };
  }

  function openCashReceiptModal() {
    const st = currentStaff();
    if (!hasPermission('cash_receipt')) return showToast('No access to cash receipt');
    // Cash Officer's own staff operational account
    const myOpAccount = (state.customers || []).find(c =>
      c.accountType === 'staff_operational' && c.linkedStaffId === st.id
    );
    openModal('Cash Receipt', `
      <div class="form-grid two compact-modal-grid">
        <div class="field"><label>Treasury</label><div class="display-field">${escapeHtml(st.name || '')}</div></div>
        <div class="field"><label>Amount Received</label><input id="cashReceiptAmount" class="entry-input" type="number"></div>
      </div>
      <div class="form-grid two compact-modal-grid" style="margin-top:8px">
        <div class="field"><label>Payment Mode</label>
          <div class="tx-mode-toggle"><label class="tx-toggle-pill"><input type="radio" name="cashReceiptMode" value="cash" checked> <span>Cash</span></label><label class="tx-toggle-pill"><input type="radio" name="cashReceiptMode" value="transfer"> <span>Transfer</span></label></div>
        </div>
        <div class="field"><label>Note (optional)</label><input id="cashReceiptNote" class="entry-input" type="text"></div>
      </div>
      ${myOpAccount ? `<div class="note">This will credit your operational account: <strong>${escapeHtml(myOpAccount.name || myOpAccount.account_number || 'your account')}</strong></div>` : '<div class="note warning-note">No operational account linked to your staff profile. Ask admin to open one.</div>'}
    `, [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      {
        label: 'Submit for Approval',
        onClick: async () => {
          const amount = Number(byId('cashReceiptAmount')?.value || 0);
          if (!(amount > 0)) return showToast('Enter a valid amount');
          if (!myOpAccount) return showToast('No operational account found — contact admin');
          if (isBusinessDateClosed(businessDate())) return showToast(businessDateClosedMessage(businessDate()));
          const paymentMode = q('input[name="cashReceiptMode"]:checked')?.value || 'cash';
          const note = byId('cashReceiptNote')?.value?.trim() || '';
          closeModal();
          showProcessing('Sending cash receipt for approval...');
          await nextPaint();
          try {
            const result = await submitApprovalThroughGateway('cash_receipt', {
              staffId: st.id,
              staffName: st.name,
              operationalAccountId: myOpAccount.id,
              operationalAccountNumber: myOpAccount.accountNumber || myOpAccount.account_number,
              amount,
              paymentMode,
              date: businessDate(),
              note
            });
            if (result?.ok === false) return showToast(result?.error?.message || 'Unable to submit cash receipt');
            render();
            showToast('Cash receipt sent for approval');
          } finally { hideProcessing(); }
        }
      }
    ]);
  }

  function renderStaffCredit() {
    // Cash Officer credits a Teller's staff operational account
    const staffOpAccounts = (state.customers || []).filter(c => c.accountType === 'staff_operational');
    const accountOptions = staffOpAccounts.map(a =>
      `<option value="${a.id}">${escapeHtml(a.name || a.displayName || a.display_name || '')} (${escapeHtml(a.accountNumber || a.account_number || '')})</option>`
    ).join('');
    const draft = state.ui.staffCreditDraft ||= {};
    return `
      <div class="form-card cs2-card opening-card">
        <div class="cs2-title">Credit Teller Account</div>
        <div class="cs2-stack">
          <div class="cs2-row">
            <div class="cs2-label">Staff Account</div>
            <div class="cs2-input-wrap cs2-wide">
              <select id="staffCreditAccount" class="entry-input cs2-input">
                <option value="">— Select Account —</option>
                ${accountOptions}
              </select>
            </div>
          </div>
          <div class="cs2-row">
            <div class="cs2-label">Amount</div>
            <div class="cs2-input-wrap cs2-medium"><input id="staffCreditAmount" class="entry-input cs2-input" type="number" value="${escapeHtml(String(draft.amount || ''))}"></div>
          </div>
          <div class="cs2-row">
            <div class="cs2-label">Payment Mode</div>
            <div class="tx-mode-toggle">
              <label class="tx-toggle-pill"><input type="radio" name="staffCreditMode" value="cash" ${(draft.mode||'cash')==='cash'?'checked':''}> <span>Cash</span></label>
              <label class="tx-toggle-pill"><input type="radio" name="staffCreditMode" value="transfer" ${(draft.mode||'')==='transfer'?'checked':''}> <span>Transfer</span></label>
            </div>
          </div>
          <div class="cs2-row">
            <div class="cs2-label">Note</div>
            <div class="cs2-input-wrap cs2-wide"><input id="staffCreditNote" class="entry-input cs2-input" value="${escapeHtml(String(draft.note || ''))}"></div>
          </div>
          <div class="cs2-button-row">
            <button id="submitStaffCredit" class="sheet-btn cs2-btn cs2-btn-solid">Submit for Approval</button>
          </div>
        </div>
      </div>`;
  }



  function openCODModal() {
    reconcileBusinessDateFromClosures();
    if (!canCloseBusinessDay()) return showToast('Only Approval Officer or Admin can close day');
    if (isBusinessDateClosed(businessDate())) return showToast(`Business date ${businessDate()} is already closed`);
    const postingStaff = state.staff.filter(st => hasPermission('credit', st) || hasPermission('debit', st));
    const rows = postingStaff.map(st => {
      const opBalance = getStaffOperationalBalance(st.id);
      const creditCash = approvedCreditTotalForDateByMode(st.id, businessDate(), 'cash');
      const creditTransfer = approvedCreditTotalForDateByMode(st.id, businessDate(), 'transfer');
      const debitCash = approvedDebitTotalForDateByMode(st.id, businessDate(), 'cash');
      const debitTransfer = approvedDebitTotalForDateByMode(st.id, businessDate(), 'transfer');
      const credits = creditCash + creditTransfer;
      const debits = debitCash + debitTransfer;
      const netBook = credits - debits;
      const remaining = opBalance;
      const variance = Math.max(0, -remaining);
      return `<tr><td>${escapeHtml(st.name || '')}</td><td>${money(opBalance)}</td><td>${money(creditCash)}</td><td>${money(creditTransfer)}</td><td>${money(credits)}</td><td>${money(debitCash)}</td><td>${money(debitTransfer)}</td><td>${money(debits)}</td><td class="${netBook<0?'balance-negative':''}">${money(netBook)}</td><td class="${remaining<0?'balance-negative':''}">${money(remaining)}</td><td class="${variance>0?'balance-negative':''}">${money(variance)}</td><td><input class="entry-input" data-cod-note="${st.id}"></td></tr>`;
    }).join('');
    openModal('Central Close of Day', `<div class="stack"><div class="note">You are closing business date <strong>${businessDate()}</strong>. Closing opens the next business date immediately.</div><div class="note">Operational Balance is the total funded by Treasury. Remaining Balance reduces as staff disburse funds. Net Balance is Total Credits minus Total Debits.</div><div class="table-wrap"><table class="table"><thead><tr><th>Staff</th><th>Op. Balance</th><th>Credit Cash</th><th>Credit Transfer</th><th>Total Credits</th><th>Debit Cash</th><th>Debit Transfer</th><th>Total Debits</th><th>Net Balance</th><th>Remaining</th><th>Variance</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table></div></div></div>`, [{label:'Cancel', className:'secondary', onClick: closeModal}, {label:'Close Business Day', onClick: async ()=> {
      closeModal();
      showProcessing('Closing business day...');
      await nextPaint();
      try {
      if (isSupabaseApprovalMode() && gateway.cod?.submitCod) {
        for (const st of postingStaff) {
          const opBalance = getStaffOperationalBalance(st.id);
          const creditCash = approvedCreditTotalForDateByMode(st.id, businessDate(), 'cash');
          const creditTransfer = approvedCreditTotalForDateByMode(st.id, businessDate(), 'transfer');
          const debitCash = approvedDebitTotalForDateByMode(st.id, businessDate(), 'cash');
          const debitTransfer = approvedDebitTotalForDateByMode(st.id, businessDate(), 'transfer');
          const credits = creditCash + creditTransfer;
          const debits = debitCash + debitTransfer;
          const netBook = credits - debits;
          const remaining = opBalance;
          const note=q(`[data-cod-note="${st.id}"]`)?.value?.trim()||'';
          const variance=Math.max(0,-remaining);
          const result = await gateway.cod.submitCod({
            staffId: st.id,
            staffUuid: getStaffBackendId(st),
            staffBackendId: getStaffBackendId(st),
            businessDate: businessDate(),
            actualCash: remaining,
            note,
            submittedByStaffId: currentStaff()?.id || st.id,
            submittedByStaffUuid: getStaffBackendId(currentStaff()),
            submittedByStaffBackendId: getStaffBackendId(currentStaff()),
            metrics: {
              openingBalance: opBalance,
              floatTopUps: 0,
              effectiveOpeningBalance: opBalance,
              totalCredits: credits,
              totalDebits: debits,
              netBookBalance: netBook,
              remainingBalance: remaining,
              expectedCash: remaining,
              variance
            }
          });
          if (result?.ok && result.data) {
            const existingIndex = (state.cod || []).findIndex(item => item.id === result.data.id);
            const nextRow = Object.assign({}, result.data, { staffName: st.name, formAmount: opBalance, openingBalance: opBalance, totalCreditCash: creditCash, totalCreditTransfer: creditTransfer, totalDebitCash: debitCash, totalDebitTransfer: debitTransfer, totalCredits: credits, totalDebits: debits, netBookBalance: netBook, actualCash: remaining, expectedCash: remaining, runningFloat: remaining, remainingBalance: remaining, variance, note });
            if (existingIndex >= 0) state.cod.splice(existingIndex, 1, nextRow); else state.cod.unshift(nextRow);
          } else if (result?.ok === false) { showToast(result.error?.message || 'Unable to submit close of day'); return; }
        }
      } else {
        postingStaff.forEach(st => {
          const opBalance = getStaffOperationalBalance(st.id);
          const creditCash = approvedCreditTotalForDateByMode(st.id, businessDate(), 'cash');
          const creditTransfer = approvedCreditTotalForDateByMode(st.id, businessDate(), 'transfer');
          const debitCash = approvedDebitTotalForDateByMode(st.id, businessDate(), 'cash');
          const debitTransfer = approvedDebitTotalForDateByMode(st.id, businessDate(), 'transfer');
          const credits=creditCash+creditTransfer;
          const debits=debitCash+debitTransfer;
          const netBook=credits-debits;
          const remaining=opBalance;
          const note=q(`[data-cod-note="${st.id}"]`)?.value?.trim()||'';
          const variance=Math.max(0,-remaining);
          state.cod.unshift({id:uid('cod'), staffId:st.id, staffName:st.name, date:businessDate(), formAmount:opBalance, openingBalance:opBalance, totalCreditCash:creditCash, totalCreditTransfer:creditTransfer, totalDebitCash:debitCash, totalDebitTransfer:debitTransfer, totalCredits:credits, totalDebits:debits, netBookBalance:netBook, actualCash:remaining, expectedCash:0, runningFloat:remaining, remainingBalance:remaining, variance, note, fieldPapers:[], status: variance===0 ? 'balanced':'flagged', approvedAt:new Date().toISOString(), approvedBy:currentStaff()?.name||''});
        });
      }
      const closingDate = businessDate();
      if (!finalizeBusinessDay(closingDate, postingStaff)) {
        showToast(`Business date ${closingDate} is already closed`);
        return;
      }
      save(); closeModal(); render(); showToast(`Business day closed. New open date: ${state.businessDate}`);
      } finally {
        hideProcessing();
      }
    }}]);
  }

  async function openAuditModal() {
    await syncStaffFromGateway();
    await syncAuditFromGateway();
    const st = currentStaff();
    const adminView = isAdminStaff(st);
    const audits = state.audit || [];
    const staffList = (state.staff || []).slice().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
    const getAuditActorStaff = (a) => {
      const actorId = a.actorId || a.actor_id || a.actorStaffId || a.actor_staff_id || '';
      const actorUuid = a.actorUuid || a.actor_uuid || a.actorUserId || a.actor_user_id || '';
      const actorName = String(a.actor || a.actorName || a.actor_name || '').trim().toLowerCase();
      return staffList.find(x => String(x.id || '') === String(actorId || ''))
        || staffList.find(x => String(x.uuid || x.authUserId || x.auth_user_id || '') && String(x.uuid || x.authUserId || x.auth_user_id || '') === String(actorUuid || ''))
        || staffList.find(x => String(x.name || '').trim().toLowerCase() === actorName)
        || null;
    };
    const isOwnAudit = (a) => {
      const actorStaff = getAuditActorStaff(a);
      return actorStaff?.id === st?.id
        || actorStaff?.uuid === st?.uuid
        || a.actorId === st?.id
        || a.actor_id === st?.id
        || a.actorUuid === st?.uuid
        || a.actor_uuid === st?.uuid
        || String(a.actor || '').trim() === String(st?.name || '').trim();
    };
    const baseAudit = adminView ? audits.slice() : audits.filter(isOwnAudit);
    const uniqueActions = Array.from(new Set(baseAudit.map(a => String(a.action || a.actionType || a.action_type || '').trim()).filter(Boolean))).sort();
    const roleOptions = Object.entries(ROLE_LABELS).map(([value,label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');
    const staffOptions = staffList.map(x => `<option value="${escapeHtml(x.id)}">${escapeHtml(x.name)} — ${escapeHtml(ROLE_LABELS[x.role] || x.role || '')}</option>`).join('');
    const actionOptions = uniqueActions.map(x => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join('');
    const filterHtml = `<div class="audit-filter-row" style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 10px;align-items:center;">
      ${adminView ? `<select id="auditRoleFilter" class="entry-input" style="width:auto;min-width:140px;"><option value="">All roles</option>${roleOptions}</select><select id="auditStaffFilter" class="entry-input" style="width:auto;min-width:170px;"><option value="">All staff</option>${staffOptions}</select>` : ''}
      <select id="auditActionFilter" class="entry-input" style="width:auto;min-width:150px;"><option value="">All actions</option>${actionOptions}</select>
      <input id="auditDateFrom" class="entry-input" type="date" lang="en-GB" style="width:auto;min-width:130px;" title="From date" value="">
      <span style="font-size:12px;color:var(--muted)">to</span>
      <input id="auditDateTo" class="entry-input" type="date" lang="en-GB" style="width:auto;min-width:130px;" title="To date" value="">
    </div>`;
    const formatActionType = (a) => {
      const raw = a.action || a.actionType || a.action_type || '';
      return raw.replace(/_/g, ' ').replace(/\w/g, c => c.toUpperCase());
    };
    const formatAuditDetail = (a) => {
      const parts = [];
      if (a.details || a.detail) parts.push(escapeHtml(a.details || a.detail));
      if (a.before != null || a.after != null) {
        const b = a.before != null ? JSON.stringify(a.before) : '—';
        const af = a.after != null ? JSON.stringify(a.after) : '—';
        if (b !== af) parts.push(`<span class="audit-change">Before: ${escapeHtml(b)} → After: ${escapeHtml(af)}</span>`);
      }
      return parts.join('<br>') || '—';
    };
    const actorName = (a) => {
      const actorStaff = getAuditActorStaff(a);
      return escapeHtml(actorStaff?.name || a.actor || a.actorName || a.actor_name || 'System');
    };
    const rowForAudit = (a) => `<tr><td style="white-space:nowrap">${fmtDateTime(a.at || a.timestamp || a.createdAt)}</td><td>${actorName(a)}</td><td><span class="audit-action-badge">${escapeHtml(formatActionType(a))}</span></td><td style="font-size:12px">${formatAuditDetail(a)}</td></tr>`;
    const scopeNote = adminView ? '<div class="note">Admin Global Audit View: showing all staff actions. Use role/staff filters to narrow the trail.</div>' : '<div class="note">Showing only your own audit trail.</div>';
    openModal('Audit Trail', `${scopeNote}${filterHtml}<div class="table-wrap"><table class="table"><thead><tr><th>Date &amp; Time</th><th>Actor</th><th>Action</th><th>Details</th></tr></thead><tbody id="auditTrailRows"></tbody></table></div>`, [{label:'Close', onClick: closeModal}]);
    const renderAuditRows = () => {
      const roleFilter = byId('auditRoleFilter')?.value || '';
      const staffFilter = byId('auditStaffFilter')?.value || '';
      const actionFilter = byId('auditActionFilter')?.value || '';
      const dateFrom = byId('auditDateFrom')?.value || '';
      const dateTo = byId('auditDateTo')?.value || '';
      const filtered = baseAudit.filter(a => {
        const actorStaff = getAuditActorStaff(a);
        const action = String(a.action || a.actionType || a.action_type || '').trim();
        const isoDate = String(a.at || a.timestamp || a.createdAt || '').slice(0,10);
        if (adminView && roleFilter && actorStaff?.role !== roleFilter) return false;
        if (adminView && staffFilter && actorStaff?.id !== staffFilter) return false;
        if (actionFilter && action !== actionFilter) return false;
        if (dateFrom && isoDate < dateFrom) return false;
        if (dateTo && isoDate > dateTo) return false;
        return true;
      });
      const tbody = byId('auditTrailRows');
      if (tbody) tbody.innerHTML = filtered.map(rowForAudit).join('') || '<tr><td colspan="4">No audit records</td></tr>';
    };
    ['auditRoleFilter','auditStaffFilter','auditActionFilter','auditDateFrom','auditDateTo'].forEach(id => {
      const el = byId(id);
      if (el) el.onchange = renderAuditRows;
    });
    // Clear date inputs in case browser auto-filled them
    const dfEl = byId('auditDateFrom'); if (dfEl) dfEl.value = '';
    const dtEl = byId('auditDateTo'); if (dtEl) dtEl.value = '';
    renderAuditRows();
  }

  function staffName(id) { return state.staff.find(s=>s.id===id)?.name || id; }
  function customerName(id) { return state.customers.find(c=>c.id===id)?.name || ''; }
  function getSelectedCustomer() { return state.customers.find(c => c.id === state.ui.selectedCustomerId) || null; }
  function balanceHtml(n){ return `<span class="${Number(n)<0 ? 'balance-negative' : ''}">${money(n)}</span>`; }
  function isCustomerFrozen(c){ if(!c) return false; if(c.frozen) return true; const last=(c.transactions||[]).slice().sort((a,b)=>new Date(b.date)-new Date(a.date))[0]; if(!last) return false; const days=(Date.now()-new Date(last.date).getTime())/86400000; return days>=90; }
  function customerStatusLabel(c){ if(!c) return '—'; return (!c.active || isCustomerFrozen(c)) ? 'Frozen' : 'Active'; }
  function freezeInactiveCustomer(c){ if(!c) return; if(c.active === false) c.frozen = true; }

  function openCustomerSearchModal(list) {
    const renderRows = arr => arr.map(c=>`<tr class="customer-search-row" data-pick-row="${c.id}"><td>${escapeHtml(c.accountNumber || '')}</td><td><button type="button" class="customer-name-pick" data-pick="${c.id}">${escapeHtml(c.name || '')}</button></td><td>${escapeHtml(c.phone || '')}</td><td class="customer-search-action-cell"><button type="button" class="secondary tiny-btn customer-pick-btn" data-pick="${c.id}">Select</button></td></tr>`).join('');
    openModal('Customer Search', `<div class="stack customer-search-modal"><input id="modalCustomerSearch" class="entry-input" placeholder="Search customer by name or account number"><div class="table-wrap customer-search-table-wrap"><table class="table customer-search-table"><thead><tr><th>Account Number</th><th>Name</th><th>Phone</th><th class="customer-search-action-head">Action</th></tr></thead><tbody id="modalCustomerRows">${renderRows(list)}</tbody></table></div></div>`, [{label:'Close', className:'secondary', onClick: closeModal}]);
    const pickCustomer = (id) => { state.ui.selectedCustomerId = id; save(); closeModal(); applySelectedCustomerToActiveTool(); };
    const bindPicks = () => {
      qq('[data-pick]').forEach(el => el.onclick = (event) => { event.stopPropagation(); pickCustomer(el.dataset.pick); });
      qq('[data-pick-row]').forEach(row => row.onclick = () => pickCustomer(row.dataset.pickRow));
    };
    bindPicks();
    const search = byId('modalCustomerSearch');
    if (search) search.oninput = () => {
      const qv = search.value.trim().toLowerCase();
      const filtered = !qv ? list : list.filter(c => String(c.accountNumber).includes(qv) || c.name.toLowerCase().includes(qv));
      byId('modalCustomerRows').innerHTML = renderRows(filtered); bindPicks();
    };
  }


  function openJournalCustomerSearchModal(list) {
    const renderRows = arr => arr.map(c=>`<tr class="customer-search-row" data-pick-journal-row="${c.id}"><td>${escapeHtml(c.accountNumber || '')}</td><td><button type="button" class="customer-name-pick" data-pick-journal="${c.id}">${escapeHtml(c.name || '')}</button></td><td>${escapeHtml(c.phone || '')}</td><td class="customer-search-action-cell"><button type="button" class="secondary tiny-btn customer-pick-btn" data-pick-journal="${c.id}">Select</button></td></tr>`).join('');
    openModal('Customer Search', `<div class="stack customer-search-modal"><input id="modalJournalCustomerSearch" class="entry-input" placeholder="Search customer by name or account number"><div class="table-wrap customer-search-table-wrap"><table class="table customer-search-table"><thead><tr><th>Account Number</th><th>Name</th><th>Phone</th><th class="customer-search-action-head">Action</th></tr></thead><tbody id="modalJournalCustomerRows">${renderRows(list)}</tbody></table></div></div>`, [{label:'Close', className:'secondary', onClick: closeModal}]);
    const pickJournalCustomer = (id) => {
      const c = state.customers.find(x => x.id === id);
      if (!c) return showToast('Customer not found');
      state.ui.selectedJournalCustomerId = c.id;
      state.ui.journalAccDraft = c.accountNumber || '';
      closeModal();
      if (byId('journalAcc')) byId('journalAcc').value = c.accountNumber || '';
      if (byId('journalName')) byId('journalName').textContent = c.name || '—';
    };
    const bindPicks = () => {
      qq('[data-pick-journal]').forEach(el => el.onclick = (event) => { event.stopPropagation(); pickJournalCustomer(el.dataset.pickJournal); });
      qq('[data-pick-journal-row]').forEach(row => row.onclick = () => pickJournalCustomer(row.dataset.pickJournalRow));
    };
    bindPicks();
    const search = byId('modalJournalCustomerSearch');
    if (search) search.oninput = () => {
      const qv = search.value.trim().toLowerCase();
      const filtered = !qv ? list : list.filter(c => String(c.accountNumber).includes(qv) || String(c.name || '').toLowerCase().includes(qv));
      byId('modalJournalCustomerRows').innerHTML = renderRows(filtered); bindPicks();
    };
  }

  async function toBase64(file) {
    if (!file) return '';
    if (!String(file.type || '').startsWith('image/')) return await fileToDataUrl(file);
    const compressed = await compressImageFile(file);
    return compressed.dataUrl;
  }


  function applyTheme(theme, persist=true) {
    state.ui.theme = theme || 'classic';
    document.body.setAttribute('data-theme', state.ui.theme === 'classic' ? '' : state.ui.theme);
    const b = byId('btnThemeCycle'); if (b) b.textContent = `Theme: ${THEME_LABELS[state.ui.theme] || 'Classic'}`;
    if (persist) save();
  }

  function hasFloatDeclaredOrPending(staffId, dateStr) {
  // Only block if actually approved — pending should not block re-declaration
  return hasBaseOpeningBalanceForDate(staffId, dateStr) ||
    state.approvals.some(r =>
      r.type === 'float_declaration' &&
      String(r.status || '').toLowerCase() === 'approved' &&
      (r.payload?.staffId === staffId || r.payload?.staff_id === staffId) &&
      (r.payload?.date === dateStr || r.payload?.float_date === dateStr)
    );
}

function syncApprovedFormFromApprovalRecord(approvalRecord) {
  const payload = approvalRecord?.payload || {};
  const staffId = payload.staffId || payload.staff_id || '';
  const date = payload.date || payload.float_date || businessDate();
  const amount = Number(payload.amount || payload.floatAmount || 0);

  if (!staffId || !(amount > 0)) return;

  const acc = ensureStaffAccount(staffId);
  const exists = (acc.entries || []).some(e =>
    (e.type === 'approved_form' || e.type === 'approved_float') &&
    (e.formDate === date || e.floatDate === date)
  );

  if (exists) return;

  addStaffEntry(
    staffId,
    'approved_form',
    amount,
    amount,
    `Approved form for ${date}`,
    { formDate: date, floatDate: date, approvalRequestId: approvalRecord.id }
  );
}


  function approvedFormTotalForDate(staffId, dateStr) {
    return (state.approvals || [])
      .filter(r => r.type === 'float_declaration'
        && String(r.status || '').toLowerCase() === 'approved'
        && (r.payload?.staffId === staffId || r.payload?.staff_id === staffId)
        && (r.payload?.date === dateStr || r.payload?.float_date === dateStr))
      .reduce((sum, r) => sum + Number(r.payload?.amount || r.payload?.floatAmount || 0), 0);
  }

  function hasBaseOpeningBalanceForDate(staffId, dateStr) {
    const acc = ensureStaffAccount(staffId);
    const localExists = acc.entries.some(e =>
      (e.type === 'approved_form' || e.type === 'approved_float') &&
      (e.formDate === dateStr || e.floatDate === dateStr) &&
      Number(e.amount || 0) > 0
    );
    return localExists || approvedFormTotalForDate(staffId, dateStr) > 0;
  }

  function hasOpeningBalanceForDate(staffId, dateStr) {
    return hasBaseOpeningBalanceForDate(staffId, dateStr);
  }

  function openingBalanceOnlyForDate(staffId, dateStr) {
    const acc = ensureStaffAccount(staffId);
    const localTotal = acc.entries
      .filter(e =>
        (e.type === 'approved_form' || e.type === 'approved_float') &&
        (e.formDate === dateStr || e.floatDate === dateStr)
      )
      .reduce((s, e) => s + Number(e.amount || 0), 0);
    const approvedTotal = approvedFormTotalForDate(staffId, dateStr);
    return Math.max(localTotal, approvedTotal);
  }

  function floatTopUpsForDate() {
    return 0;
  }

  function getOpeningBalanceForDate(staffId, dateStr) {
    return openingBalanceOnlyForDate(staffId, dateStr);
  }


  function normalizePaymentMode(mode) {
    return String(mode || '').trim().toLowerCase() === 'transfer' ? 'transfer' : 'cash';
  }

  function approvalModeAmount(record, mode) {
    const desiredMode = normalizePaymentMode(mode);
    if (!record || record.status !== 'approved') return 0;
    if (record.type === 'customer_credit_journal' || record.type === 'customer_debit_journal') {
      const journalMode = normalizePaymentMode(record.payload?.formPaymentMode);
      return journalMode === desiredMode ? Number(record.payload?.formAmount || 0) : 0;
    }
    // Direct customer_credit/customer_debit draw on the daily FORM directly.
    const recordMode = normalizePaymentMode(record.payload?.paymentMode || record.payload?.payoutSource);
    return recordMode === desiredMode ? Number(record.payload?.amount || 0) : 0;
  }

  function approvedCreditTotalForDateByMode(staffId, dateStr, mode) {
    return (state.approvals||[])
      .filter(r => ['customer_credit','customer_credit_journal'].includes(r.type) && r.status === 'approved' && r.payload?.staffId === staffId && r.payload?.date === dateStr)
      .reduce((sum, record) => sum + approvalModeAmount(record, mode), 0);
  }

  function approvedDebitTotalForDateByMode(staffId, dateStr, mode) {
    return (state.approvals||[])
      .filter(r => ['customer_debit','customer_debit_journal'].includes(r.type) && r.status === 'approved' && r.payload?.staffId === staffId && r.payload?.date === dateStr)
      .reduce((sum, record) => sum + approvalModeAmount(record, mode), 0);
  }

  function approvedCreditTotalForDate(staffId, dateStr) {
    return (state.approvals||[]).filter(r => ['customer_credit','customer_credit_journal'].includes(r.type) && r.status === 'approved' && r.payload?.staffId === staffId && r.payload?.date === dateStr).reduce((s,r)=> s + (r.type === 'customer_credit_journal' ? Number(r.payload?.formAmount || 0) : Number(r.payload?.amount || 0)), 0);
  }

  function approvedDebitTotalForDate(staffId, dateStr) {
    return (state.approvals||[]).filter(r => ['customer_debit','customer_debit_journal'].includes(r.type) && r.status === 'approved' && r.payload?.staffId === staffId && r.payload?.date === dateStr).reduce((s,r)=> s + (r.type === 'customer_debit_journal' ? Number(r.payload?.formAmount || 0) : Number(r.payload?.amount || 0)), 0);
  }

  function pendingPostedFloatImpactForDate(staffId, dateStr) {
    return (state.approvals||[])
      .filter(r => ['customer_credit','customer_debit','customer_credit_journal','customer_debit_journal'].includes(r.type)
        && r.status === 'pending'
        && r.payload?.staffId === staffId
        && r.payload?.date === dateStr)
      .reduce((s,r)=> s + (r.type.endsWith('_journal') ? Number(r.payload?.formAmount || 0) : Number(r.payload?.amount || 0)), 0);
  }

  function currentFloatAvailable(staffId, date = businessDate()) {
    const form = getOpeningBalanceForDate(staffId, date);
    const usedApproved = approvedCreditTotalForDate(staffId, date);
    const debitsApproved = approvedDebitTotalForDate(staffId, date);
    const pendingPosted = pendingPostedFloatImpactForDate(staffId, date);
    return form - usedApproved - debitsApproved - pendingPosted;
  }

  function currentFloatOverdraw(staffId, date = businessDate()) {
    return Math.max(0, -currentFloatAvailable(staffId, date));
  }

  function pendingJournalTotal(staffId, date=businessDate()) {
    // Sum of the FORM amount on any journal currently being drafted (not yet
    // submitted) for this staff/date — credit and debit drafts both count,
    // since both draw down the same daily FORM once approved.
    const drafts = state.ui?.telleringDrafts || {};
    const creditKey = `${staffId}:${date}:credit`;
    const debitKey = `${staffId}:${date}:debit`;
    const stripCommas = (v) => Number(String(v || '').replace(/,/g, '')) || 0;
    return stripCommas(drafts[creditKey]?.journalFormAmount) + stripCommas(drafts[debitKey]?.journalFormAmount);
  }

  function staffCODRecords(staffId) {
    return (state.cod || []).filter(c => c.staffId === staffId);
  }

  // REMOVED 2026-08-14: openMyBalanceModal() and its "Fund Wallet"/"Pay Debt"
  // buttons — the last live path that could submit new wallet_fund/
  // debt_repayment requests. This screen was already unreachable through
  // normal navigation (no menu ever set state.ui.tool to 'my_balance'), and
  // it belonged to the old design where a teller's wallet/debt were manually
  // funded and repaid. The current design lets a teller run a negative
  // balance until Treasury credits them (inter_staff_credit, already its own
  // report category), and staff-level balances now live on Staff Salary
  // Balance. Historical wallet_fund/debt_repayment records already approved
  // in the past are NOT touched — applyRequest() and the debt/wallet balance
  // calculations they feed are left exactly as they were, so old data keeps
  // rendering correctly. Only the ability to create NEW ones is removed.

  function openMyCODModal(selectedDate=null) {
    const st = currentStaff();
    state.ui.myCodDate = selectedDate || state.ui.myCodDate || businessDate();
    const c = staffCODRecords((st||{}).id).find(x => x.date === state.ui.myCodDate);
    const totalCreditCash = c ? Number(c.totalCreditCash ?? approvedCreditTotalForDateByMode(c.staffId, c.date, 'cash')) : 0;
    const totalCreditTransfer = c ? Number(c.totalCreditTransfer ?? approvedCreditTotalForDateByMode(c.staffId, c.date, 'transfer')) : 0;
    const totalDebitCash = c ? Number(c.totalDebitCash ?? approvedDebitTotalForDateByMode(c.staffId, c.date, 'cash')) : 0;
    const totalDebitTransfer = c ? Number(c.totalDebitTransfer ?? approvedDebitTotalForDateByMode(c.staffId, c.date, 'transfer')) : 0;
    const totalCredits = c ? Number(c.totalCredits ?? (totalCreditCash + totalCreditTransfer)) : 0;
    const totalDebits = c ? Number(c.totalDebits ?? (totalDebitCash + totalDebitTransfer)) : 0;
    const netBook = c ? Number(c.netBookBalance ?? (totalCredits - totalDebits)) : 0;
    const remainingBalance = c ? Number(c.remainingBalance ?? c.runningFloat ?? getStaffOperationalBalance((st||{}).id)) : 0;
    const varianceValue = c ? Number(c.variance ?? Math.max(0, -remainingBalance)) : 0;
    const summary = c ? `
      <div class="kpi-row wrap cod-summary-grid">
        <div class="kpi"><div class="label">Op. Balance</div><div class="number">${money(c.formAmount ?? c.openingBalance ?? getStaffOperationalBalance((st||{}).id))}</div></div>
        <div class="kpi"><div class="label">Credit Cash</div><div class="number">${money(totalCreditCash)}</div></div>
        <div class="kpi"><div class="label">Credit Transfer</div><div class="number">${money(totalCreditTransfer)}</div></div>
        <div class="kpi"><div class="label">Total Credits</div><div class="number">${money(totalCredits)}</div></div>
        <div class="kpi"><div class="label">Debit Cash</div><div class="number">${money(totalDebitCash)}</div></div>
        <div class="kpi"><div class="label">Debit Transfer</div><div class="number">${money(totalDebitTransfer)}</div></div>
        <div class="kpi"><div class="label">Total Debits</div><div class="number">${money(totalDebits)}</div></div>
        <div class="kpi"><div class="label">Net Balance</div><div class="number ${netBook<0?'balance-negative':''}">${money(netBook)}</div></div>
        <div class="kpi"><div class="label">Remaining Balance</div><div class="number ${remainingBalance<0?'balance-negative':''}">${money(remainingBalance)}</div></div>
        <div class="kpi"><div class="label">Variance</div><div class="number ${varianceValue>0?'balance-negative':''}">${money(varianceValue)}</div></div>
      </div>
      <div class="note">Operational Balance is the total funded by Treasury. Net Balance is Total Credits minus Total Debits. Remaining Balance reflects unaccounted funds.</div>
      <div class="note"><strong>Status:</strong> ${c.status === 'flagged' ? 'Anomaly' : (c.status || 'balanced')} • <strong>Manager Note:</strong> ${c.resolutionNote || c.note || '—'}</div>` : `<div class="note">No close-of-day record for selected date.</div>`;
    openModal('My Close of Day', `<div class="modal-sheet my-close-day-sheet"><div class="stack"><div class="action-inline"><div class="inline-field compact"><span>COD Date</span><input type="date" lang="en-GB" id="myCodDate" value="${state.ui.myCodDate}"></div></div>${summary}</div></div>`, [{label:'Close', className:'secondary', onClick: closeModal}]);
    const picker = byId('myCodDate');
    if (picker) picker.onchange = () => { state.ui.myCodDate = picker.value || businessDate(); save(); openMyCODModal(state.ui.myCodDate); };
  }


  function removeCodBusinessAdjustment(codId) {
    state.businessExtras ||= [];
    state.businessExtras = state.businessExtras.filter(e => !(e.type === 'cod_adjustment' && e.codId === codId));
  }

  function applyCodBusinessAdjustment(cod, adjustment, resolutionType, note) {
    state.businessExtras ||= [];
    removeCodBusinessAdjustment(cod.id);
    if (resolutionType === 'reversal_needed' || !adjustment) return;
    state.businessExtras.unshift({
      id: uid('bizcod'),
      date: cod.date || cod.businessDate || businessDate(),
      businessDate: cod.date || cod.businessDate || businessDate(),
      accountNumber: 'COD',
      accountName: cod.staffName || staffName(cod.staffId) || 'Staff',
      details: `COD final agreed adjustment for ${cod.staffName || staffName(cod.staffId) || 'staff'} (${cod.date || cod.businessDate || businessDate()})`,
      note: note || '',
      kind: adjustment > 0 ? 'credit' : 'debit',
      type: 'cod_adjustment',
      sourceType: 'cod_adjustment',
      delta: adjustment,
      amount: Math.abs(adjustment),
      balanceAfter: 0,
      receivedOrPaidBy: cod.staffName || staffName(cod.staffId) || '',
      postedBy: currentStaff()?.name || 'System',
      codId: cod.id
    });
  }

  function openCODResolutionModal(codId) {
    const cod = state.cod.find(c =>
      String(c.id || '') === String(codId || '') ||
      String(c.codSubmissionId || '') === String(codId || '') ||
      String(c.cod_submission_id || '') === String(codId || '')
    );
    if (!cod) return showToast('COD record not found. Please refresh and try again.');
    const formAmount = Number(cod.formAmount ?? cod.openingBalance ?? getStaffOperationalBalance(cod.staffId));
    const totalCreditCash = Number(cod.totalCreditCash ?? approvedCreditTotalForDateByMode(cod.staffId, cod.date, 'cash'));
    const totalCreditTransfer = Number(cod.totalCreditTransfer ?? approvedCreditTotalForDateByMode(cod.staffId, cod.date, 'transfer'));
    const totalDebitCash = Number(cod.totalDebitCash ?? approvedDebitTotalForDateByMode(cod.staffId, cod.date, 'cash'));
    const totalDebitTransfer = Number(cod.totalDebitTransfer ?? approvedDebitTotalForDateByMode(cod.staffId, cod.date, 'transfer'));
    const totalCredits = Number(cod.totalCredits ?? (totalCreditCash + totalCreditTransfer));
    const totalDebits = Number(cod.totalDebits ?? (totalDebitCash + totalDebitTransfer));
    const currentNetBookBalance = Number(cod.netBookBalance ?? (totalCredits - totalDebits));
    const currentRemainingBalance = formAmount - totalCredits - totalDebits;
    const currentVariance = Math.abs(currentRemainingBalance);
    const currentOverdraw = Math.max(0, -currentRemainingBalance);
    const defaultDebt = Math.max(currentOverdraw, Number(cod.debtAmount || 0));
    const isAdminOfficer = currentStaff()?.role === 'admin_officer';
    const savedAcceptedPosition = Number(cod.acceptedPosition ?? currentNetBookBalance);
    const savedAdjustment = Number(cod.adjustment ?? (savedAcceptedPosition - currentNetBookBalance));
    const savedCreateDebt = cod.createDebt ?? (defaultDebt > 0 || (cod.debtAmount || 0) > 0);
    const savedResolutionType = cod.resolutionType || (savedCreateDebt ? 'staff_debt' : 'balanced');
    openModal('Resolve Close of Day', `
      <div class="stack">
        <div class="note">Form is the approved opening money collected from the field. Net Balance is Total Credits minus Total Debits. Final Agreed Amount corrects the system total only. Debt can still be recorded against staff where required.</div>
        ${currentOverdraw > 0 ? `<div class="note" style="background:#fdecea;border-color:var(--danger)"><strong>Anomaly:</strong> this teller closed the day with a negative operational balance of ${money(currentOverdraw)}. Resolve directly with the staff involved before marking this closed.</div>` : ''}
        <div class="kpi-row">
          <div class="kpi"><div class="label">Form</div><div class="number">${money(formAmount)}</div></div>
          <div class="kpi"><div class="label">Credit Cash</div><div class="number">${money(totalCreditCash)}</div></div>
          <div class="kpi"><div class="label">Credit Transfer</div><div class="number">${money(totalCreditTransfer)}</div></div>
          <div class="kpi"><div class="label">Total Credits</div><div class="number">${money(totalCredits)}</div></div>
          <div class="kpi"><div class="label">Debit Cash</div><div class="number">${money(totalDebitCash)}</div></div>
          <div class="kpi"><div class="label">Debit Transfer</div><div class="number">${money(totalDebitTransfer)}</div></div>
          <div class="kpi"><div class="label">Total Debits</div><div class="number">${money(totalDebits)}</div></div>
          <div class="kpi"><div class="label">Net Balance</div><div class="number ${currentNetBookBalance<0?'balance-negative':''}">${money(currentNetBookBalance)}</div></div>
          <div class="kpi"><div class="label">Remaining Balance</div><div class="number ${currentRemainingBalance<0?'balance-negative':''}">${money(currentRemainingBalance)}</div></div>
          <div class="kpi"><div class="label">Variance</div><div class="number ${currentVariance>0?'balance-negative':''}">${money(currentVariance)}</div></div>
          <div class="kpi"><div class="label">Overdraw</div><div class="number ${currentOverdraw>0?'balance-negative':''}">${money(currentOverdraw)}</div></div>
        </div>
        <div class="form-grid two cod-resolution-grid">
          <div class="field"><label>Final Agreed Amount</label><input id="codAcceptedPosition" class="entry-input" type="number" placeholder="Enter final agreed system amount" value="${savedAcceptedPosition}" ${isAdminOfficer ? '' : 'readonly'}></div>
          <div class="field"><label>Adjustment</label><input id="codAdjustment" class="entry-input" type="number" value="${savedAdjustment}" readonly></div>
        </div>
        <div class="form-grid two cod-resolution-grid">
          <div class="field"><label>Resolution Type</label><select id="codResolutionType" class="entry-input"><option value="balanced" ${savedResolutionType==='balanced'?'selected':''}>Balanced</option><option value="staff_debt" ${savedResolutionType==='staff_debt'?'selected':''}>Staff Debt</option><option value="reversal_needed" ${savedResolutionType==='reversal_needed'?'selected':''}>Reversal Needed</option></select></div>
          <div class="field"><label>Create Teller Debt</label><select id="codCreateDebt" class="entry-input"><option value="yes" ${savedCreateDebt?'selected':''}>Yes</option><option value="no" ${!savedCreateDebt?'selected':''}>No</option></select></div>
        </div>
        <div class="form-grid two cod-resolution-grid">
          <div class="field"><label>Debt Amount</label><input id="codDebtAmount" class="entry-input" type="number" placeholder="Enter teller debt amount" value="${cod.debtAmount || defaultDebt}"></div>
          <div class="field"><label>Resolution Note</label><textarea id="codResolutionNote" class="entry-input">${cod.resolutionNote || ''}</textarea></div>
        </div>
      </div>
    `,[
      {label:'Close', className:'secondary', onClick: closeModal},
      {label:'Resolve', onClick: async ()=> {
        const note = byId('codResolutionNote').value.trim();
        if (!note) return showToast('Resolution note required');
        const resolutionType = byId('codResolutionType').value;
        const createDebt = byId('codCreateDebt').value === 'yes';
        const acceptedPosition = isAdminOfficer ? Number(byId('codAcceptedPosition').value || 0) : savedAcceptedPosition;
        const adjustment = isAdminOfficer ? (acceptedPosition - currentNetBookBalance) : savedAdjustment;
        const debtAmt = createDebt ? Math.max(0, Number(byId('codDebtAmount').value || 0)) : 0;
        closeModal();
        showProcessing('Resolving COD...');
        await nextPaint();
        try {
        if (isSupabaseApprovalMode() && gateway.cod?.resolveCod) {
          const result = await gateway.cod.resolveCod({ codSubmissionId: cod.id, finalAgreedAmount: acceptedPosition, debtAmount: debtAmt, resolutionNote: note, resolvedByStaffId: currentStaff()?.id || '' });
          if (result?.ok === false) return showToast(result.error?.message || 'Unable to resolve COD');
          if (result?.ok && result.data) {
            Object.assign(cod, result.data, { status: 'resolved', resolutionType, reversalNeeded: resolutionType === 'reversal_needed', createDebt, staffName: cod.staffName, formAmount, totalCreditCash, totalCreditTransfer, totalDebitCash, totalDebitTransfer, totalCredits, totalDebits, netBookBalance: currentNetBookBalance, remainingBalance: currentRemainingBalance, variance: currentVariance, overdraw: currentOverdraw, acceptedPosition, adjustment: resolutionType === 'reversal_needed' ? 0 : adjustment });
            applyCodBusinessAdjustment(cod, resolutionType === 'reversal_needed' ? 0 : adjustment, resolutionType, note);
            await syncCodFromGateway({ staffId: cod.staffId, businessDate: cod.date });
            applyCodBusinessAdjustment(cod, resolutionType === 'reversal_needed' ? 0 : adjustment, resolutionType, note);
            await syncDebtBalancesFromGateway(cod.staffId);
          }
        } else {
          const shouldPostAdjustment = isAdminOfficer && resolutionType !== 'reversal_needed' && adjustment !== 0;
          cod.status = 'resolved';
          cod.resolutionType = resolutionType;
          cod.reversalNeeded = resolutionType === 'reversal_needed';
          cod.resolutionNote = note;
          cod.resolvedBy = currentStaff()?.name || 'System';
          cod.resolvedAt = new Date().toISOString();
          cod.acceptedPosition = acceptedPosition;
          cod.adjustment = resolutionType === 'reversal_needed' ? 0 : adjustment;
          cod.debtAmount = debtAmt;
          cod.createDebt = createDebt;
          cod.formAmount = formAmount;
          cod.totalCreditCash = totalCreditCash;
          cod.totalCreditTransfer = totalCreditTransfer;
          cod.totalDebitCash = totalDebitCash;
          cod.totalDebitTransfer = totalDebitTransfer;
          cod.totalCredits = totalCredits;
          cod.totalDebits = totalDebits;
          cod.netBookBalance = currentNetBookBalance;
          cod.remainingBalance = currentRemainingBalance;
          cod.variance = currentVariance;
          cod.overdraw = currentOverdraw;
          applyCodBusinessAdjustment(cod, shouldPostAdjustment ? adjustment : 0, resolutionType, note);
          const acc = ensureStaffAccount(cod.staffId);
          const existingDebtEntries = (acc.entries||[]).filter(e => e.type === 'cod_resolution_debt' && e.codId === cod.id);
          if (existingDebtEntries.length) {
            acc.entries = (acc.entries||[]).filter(e => !(e.type === 'cod_resolution_debt' && e.codId === cod.id));
            const previousDebt = existingDebtEntries.reduce((s,e)=>s+Number(e.amount||0),0);
            acc.debtBalance = Math.max(0, Number(acc.debtBalance || 0) - previousDebt);
            recalcStaffBalance(cod.staffId);
          }
          if (createDebt && debtAmt > 0) {
            acc.debtBalance = Number(acc.debtBalance || 0) + debtAmt;
            addStaffEntry(cod.staffId, 'cod_resolution_debt', debtAmt, 0, `COD debt recorded: ${note}`, { codId: cod.id });
          }
        }
        save(); render(); showToast(resolutionType === 'reversal_needed' ? 'COD flagged for reversal/correction' : 'COD resolved');
        } finally {
          hideProcessing();
        }
      }}
    ]);
    const acceptedInput = byId('codAcceptedPosition');
    const adjustmentInput = byId('codAdjustment');
    const createDebtInput = byId('codCreateDebt');
    const debtAmountInput = byId('codDebtAmount');
    const resolutionTypeInput = byId('codResolutionType');
    const syncAdjustment = () => {
      const acceptedPosition = isAdminOfficer ? Number(acceptedInput?.value || 0) : savedAcceptedPosition;
      const adjustment = acceptedPosition - currentNetBookBalance;
      if (adjustmentInput) adjustmentInput.value = String(resolutionTypeInput?.value === 'reversal_needed' ? 0 : adjustment);
    };
    const syncDebtField = () => {
      const debtEnabled = createDebtInput?.value === 'yes';
      if (debtAmountInput) {
        debtAmountInput.disabled = !debtEnabled;
        if (!debtEnabled) debtAmountInput.value = '0';
        else if (!debtAmountInput.value) debtAmountInput.value = String(cod.debtAmount ?? defaultDebt);
      }
    };
    if (acceptedInput && isAdminOfficer) acceptedInput.oninput = syncAdjustment;
    if (resolutionTypeInput) resolutionTypeInput.onchange = syncAdjustment;
    if (createDebtInput) createDebtInput.onchange = syncDebtField;
    syncAdjustment();
    syncDebtField();
  }

  function flattenBusinessEntries() {
    const txRows = flattenCustomerTx().map(t => ({
      date: t.date,
      accountNumber: t.customer?.accountNumber || '',
      accountName: t.customer?.name || t.accountName || t.customerName || t.customer?.accountNumber || '',
      details: t.details || t.note || '',
      note: t.note || t.details || '',
      kind: t.type,
      type: t.type,
      delta: t.type === 'credit' ? Number(t.amount || 0) : -Number(t.amount || 0),
      amount: Number(t.amount || 0),
      balanceAfter: Number(t.balanceAfter || 0),
      receivedOrPaidBy: t.receivedOrPaidBy || t.receivedBy || t.postedBy || '',
      postedBy: t.postedBy || t.postedById || '',
      approvedBy: t.approvedBy || ''
    }));
    const extras = (state.businessExtras || []).map(e => ({
      ...e,
      accountNumber: e.accountNumber || 'STAFF',
      accountName: e.accountName || e.customerName || e.accountNumber || 'STAFF',
      details: cleanOperationalNote(e.details || e.note) || '',
      note: cleanOperationalNote(e.note || e.details) || '',
      type: e.type === 'cod_adjustment' ? (e.kind || (Number(e.delta || 0) >= 0 ? 'credit' : 'debit')) : (e.type || e.kind || (Number(e.delta || 0) >= 0 ? 'credit' : 'debit')),
      kind: e.kind || (e.type === 'cod_adjustment' ? (Number(e.delta || 0) >= 0 ? 'credit' : 'debit') : e.type) || (Number(e.delta || 0) >= 0 ? 'credit' : 'debit'),
      delta: Number(e.delta || ((e.type || e.kind) === 'debit' ? -Number(e.amount || 0) : Number(e.amount || 0))),
      amount: Number(e.amount || 0),
      balanceAfter: Number(e.balanceAfter || 0),
      receivedOrPaidBy: e.receivedOrPaidBy || e.receivedBy || e.postedBy || '',
      postedBy: e.postedBy || '',
      approvedBy: e.approvedBy || ''
    }));
    return [...txRows, ...extras].sort((a,b)=>new Date(b.date)-new Date(a.date));
  }

  function renderBalanceFilters(kind) {
    const filter = state.ui[`${kind}Filter`] || { preset:'daily', from:'', to:'' };
    const presets = [['daily','Daily'],['weekly','Weekly'],['monthly','Monthly'],['all','All']];
    const types = kind==='business' ? [['all','All'],['credit','Credit'],['debit','Debit']] : [['all','All'],['income','Income'],['expense','Expense']]; const activeType = state.ui[`${kind}Type`] || 'all'; return `<div class="form-card balance-filters-card"><div class="action-inline balance-filters-row">${presets.map(([k,l])=>`<button class="filter-chip ${filter.preset===k?'active':'secondary'}" data-filter-kind="${kind}" data-filter-preset="${k}">${l}</button>`).join('')}<label class="inline-field"><span>From</span><input id="${kind}From" type="date" lang="en-GB" value="${filter.from||''}"></label><label class="inline-field"><span>To</span><input id="${kind}To" type="date" lang="en-GB" value="${filter.to||''}"></label><button class="secondary" id="${kind}CustomApply">Apply Custom</button><button class="secondary" id="${kind}ExportCsv">Export CSV</button><button class="secondary" id="${kind}PrintSummary">Print Summary</button></div><div class="action-inline balance-filters-row" style="margin-top:10px">${types.map(([k,l])=>`<button class="filter-chip ${activeType===k?'active':'secondary'}" data-type-kind="${kind}" data-type-filter="${k}">${l}</button>`).join('')}</div></div>`;
  }

  function bindBalanceFilters(kind) {
    qq(`[data-filter-kind="${kind}"]`).forEach(btn => btn.onclick = () => {
      state.ui[`${kind}Filter`] = { preset: btn.dataset.filterPreset, from:'', to:'' }; save(); renderWorkspace();
    });
    byId(`${kind}CustomApply`).onclick = () => { state.ui[`${kind}Filter`] = { preset:'custom', from:byId(`${kind}From`).value, to:byId(`${kind}To`).value }; save(); renderWorkspace(); };
    qq(`[data-type-kind="${kind}"]`).forEach(btn => btn.onclick = () => { state.ui[`${kind}Type`] = btn.dataset.typeFilter; save(); renderWorkspace(); });
    const moreBtn = byId(`${kind}More`);
    if (moreBtn) moreBtn.onclick = () => {
      const key = kind === 'business' ? 'businessEntriesLimit' : 'operationalEntriesLimit';
      state.ui[key] = (state.ui[key] || 20) + 20; save(); renderWorkspace();
    };
    const lessBtn = byId(`${kind}Less`);
    if (lessBtn) lessBtn.onclick = () => {
      const key = kind === 'business' ? 'businessEntriesLimit' : 'operationalEntriesLimit';
      state.ui[key] = Math.max(20, (state.ui[key] || 20) - 20); save(); renderWorkspace();
    };
    const tellerMore = byId('tellerMore');
    if (tellerMore) tellerMore.onclick = () => { state.ui.tellerEntriesLimit = (state.ui.tellerEntriesLimit || 20) + 20; save(); renderWorkspace(); };
    const tellerLess = byId('tellerLess');
    if (tellerLess) tellerLess.onclick = () => { state.ui.tellerEntriesLimit = Math.max(20, (state.ui.tellerEntriesLimit || 20) - 20); save(); renderWorkspace(); };
    byId(`${kind}ExportCsv`).onclick = () => {
      if (kind === 'operational') {
        exportOperationalStatementCsv();
        return;
      }
      if (kind === 'business') {
        exportBusinessStatementCsv();
        return;
      }
      const rows = filterByDate(flattenBusinessEntries(), state.ui.businessFilter || { preset: 'daily', from: '', to: '' });
      exportCsv(rows, `${kind}_balance.csv</div>`);
    };
    byId(`${kind}PrintSummary`).onclick = () => {
      if (kind === 'operational') {
        printOperationalStatement();
        return;
      }
      if (kind === 'business') {
        printBusinessStatement();
        return;
      }
      printHtml(byId('workspace').innerHTML, true);
    };
  }

  function dateOnly(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const direct = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (direct) return direct[1];
    const d = new Date(raw);
    if (isNaN(d)) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function filterRowDate(row) {
    return dateOnly(row?.date || row?.businessDate || row?.business_date || row?.transactionDate || row?.transaction_date || row?.postedAt || row?.posted_at || row?.approvedAt || row?.approved_at || row?.createdAt || row?.created_at || row?.requestedAt || row?.requested_at);
  }

  function filterDateReference(rows = []) {
    // Always filter against the active DUCESS business date — never real calendar date,
    // never the most-recent-entry date. Daily = what happened on the open business date.
    return dateOnly(businessDate && businessDate()) || '';
  }

  function filterByDate(rows, filter) {
    const activeFilter = filter || { preset: 'daily', from: '', to: '' };
    if (activeFilter.preset === 'all') return rows || [];
    const referenceIso = filterDateReference(rows || []);
    const referenceDate = new Date(`${referenceIso}T12:00:00`);
    return (rows || []).filter(r => {
      const iso = filterRowDate(r);
      if (!iso) return false;
      const d = new Date(`${iso}T12:00:00`);
      if (activeFilter.preset === 'daily') return iso === referenceIso;
      if (activeFilter.preset === 'weekly') {
        const start = new Date(referenceDate);
        start.setDate(referenceDate.getDate() - 6);
        start.setHours(0,0,0,0);
        const end = new Date(referenceDate);
        end.setHours(23,59,59,999);
        return d >= start && d <= end;
      }
      if (activeFilter.preset === 'monthly') return d.getFullYear() === referenceDate.getFullYear() && d.getMonth() === referenceDate.getMonth();
      if (activeFilter.preset === 'custom') {
        if (activeFilter.from && iso < activeFilter.from) return false;
        if (activeFilter.to && iso > activeFilter.to) return false;
      }
      return true;
    });
  }

  function exportCsv(rows, filename) {
    if (!rows.length) return showToast('Nothing to export');
    const escapeCell = value => JSON.stringify(value ?? '');
    const csv = Array.isArray(rows[0])
      ? rows.map(row => (row || []).map(escapeCell).join(',')).join('\n')
      : (() => {
          const cols = Object.keys(rows[0]);
          return [cols.join(',')].concat(rows.map(r => cols.map(k => escapeCell(r[k])).join(','))).join('\n');
        })();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], {type:'text/csv;charset=utf-8;'}));
    a.download = filename; a.click();
  }

  function printHtml(html, autoPrint=true) {
    const w = window.open('', '_blank');
    const statementStyles = `
      <style>
        @page { size: landscape; margin: 10mm; }
        body { font-family: Arial, Helvetica, sans-serif; color:#111; margin:0; background:#fff; }
        .shell, .workspace { margin:0; padding:0; }
        .statement-sheet { padding: 4px 6px; }
        .statement-title { font-size: 16px; font-weight: 700; margin: 0 0 8px; }
        .statement-summary-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
          font-size: 11px;
          margin: 0 0 8px;
        }
        .statement-summary-item {
          padding: 4px 6px;
          border: 1px solid #999;
        }
        .statement-summary-item span { font-weight: 700; }
        .statement-rule { border-top: 1px solid #999; margin: 6px 0 8px; }
        .statement-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 9px;
          table-layout: fixed;
        }
        .statement-table th, .statement-table td {
          border: 1px solid #666;
          padding: 4px 5px;
          text-align: left;
          vertical-align: top;
          word-break: break-word;
        }
        .statement-table th { background: #f3f3f3; font-weight: 700; }
        .statement-total { margin-top: 8px; font-size: 11px; }
      </style>`;
    w.document.write(`<html><head><title>Print</title><link rel="stylesheet" href="app.css">${statementStyles}</head><body><div class="shell"><div class="workspace">${html}</div></div></body></html></div>`);
    w.document.close();
    w.focus();
    if (autoPrint) w.print();
  }

  function confirmAction(message, onYes) {
    openModal('Confirm Action', `<div class="note">${message}</div></div>`, [{label:'Cancel', className:'secondary', onClick: closeModal},{label:'Confirm', onClick:()=>{closeModal(); onYes();}}]);
  }

  function applySelectedCustomerToActiveTool() {
    const c = getSelectedCustomer();
    if (!c) return;
    if (state.ui.tool === 'check_balance') {
      state.ui.checkBalanceLoaded = true;
      save();
      const ws = byId('workspace');
      if (ws) lookupFill(ws, c); else render();
      return;
    }
    if (state.ui.tool === 'credit' || state.ui.tool === 'debit') {
      state.ui.txAccDraft = c.accountNumber || '';
      state.ui.selectedCustomerId = c.id;
      if (byId('txAcc')) byId('txAcc').value = c.accountNumber || '';
      if (byId('txName')) byId('txName').textContent = c.name || '—';
      if (byId('txBalance')) byId('txBalance').innerHTML = balanceHtml(c.balance);
      save();
      return;
    }
    if (state.ui.tool === 'account_statement') {
      // stmtAcc no longer exists (2026-08-14 redesign) — statement now always
      // reflects state.ui.selectedCustomerId, set via Check Balance.
      state.ui.selectedCustomerId = c.id;
      state.ui.accountStatementGenerated = false;
      save();
      renderWorkspace();
      return;
    }
    if (state.ui.tool === 'account_maintenance' || state.ui.tool === 'account_reactivation') {
      // Route through the same persisted draft fillCustomer() uses, so a
      // background re-render doesn't wipe the picked customer's details.
      const prefix = state.ui.tool === 'account_reactivation' ? 'reactivation' : 'maintenance';
      const draft = state.ui[`${prefix}Draft`] ||= {};
      draft.accountNumber = c.accountNumber || '';
      draft.name = c.name || '';
      draft.address = c.address || '';
      draft.phone = c.phone || '';
      draft.nin = c.nin || '';
      draft.bvn = c.bvn || '';
      draft.oldAccountNumber = c.oldAccountNumber || '';
      draft.editable = false;
      save();
      renderWorkspace();
      return;
    }
  }

  function openChangePasswordModal() {
    openModal('Change Password', `
      <div class="form-grid two" style="gap:10px;max-width:520px">
        <div class="field" style="grid-column:1/-1"><label>Old Password</label>${passwordInputRow('<input id="changeOldPassword" class="entry-input" type="password" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" data-no-password-store="true">', 'changeOldPassword')}</div>
        <div class="field"><label>New Password</label>${passwordInputRow('<input id="changeNewPassword" class="entry-input" type="password" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" data-no-password-store="true" placeholder="Minimum 6 characters">', 'changeNewPassword')}</div>
        <div class="field"><label>Confirm New Password</label>${passwordInputRow('<input id="changeConfirmPassword" class="entry-input" type="password" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" data-no-password-store="true">', 'changeConfirmPassword')}</div>
      </div>
      <p style="margin:8px 0 0;font-size:0.78em;color:var(--text-muted)">After a refresh or reopen, DUCESS will require login again.</p>
    `, [
      { label:'Cancel', className:'secondary', onClick: closeModal },
      { label:'Update Password', onClick: async () => {
        const oldPassword = byId('changeOldPassword')?.value || '';
        const newPassword = byId('changeNewPassword')?.value || '';
        const confirmPassword = byId('changeConfirmPassword')?.value || '';
        if (!oldPassword) return showToast('Enter old password');
        if (!newPassword || newPassword.length < 6) return showToast('New password must be at least 6 characters');
        if (newPassword !== confirmPassword) return showToast('New passwords do not match');
        const submitBtn = document.querySelector('.modal-actions button:last-child');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Updating…'; }
        try {
          await nextPaint();
          const result = await gateway.auth?.changePassword?.({ oldPassword, newPassword });
          if (!result?.ok) {
            showToast(result?.error?.message || 'Could not change password');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Update Password'; }
            return;
          }
          closeModal();
          showToast('✓ Password changed successfully');
        } catch (err) {
          showToast('Could not change password');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Update Password'; }
        }
      }}
    ]);
    bindPasswordToggles(byId('modalBody') || document);
    hardenCredentialInputs(byId('modalBody') || document);
  }

  function openLoginChangePasswordModal() {
    const loginStaffValue = (byId('loginStaffId')?.value || '').trim().toUpperCase();
    openModal('Change Password', `
      <div class="form-grid two" style="gap:10px;max-width:520px">
        <div class="field" style="grid-column:1/-1"><label>Staff ID</label><input id="loginChangeStaffId" class="entry-input" value="${escapeHtml(loginStaffValue)}" placeholder="e.g. ADMIN001" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" data-no-password-store="true" style="text-transform:uppercase"></div>
        <div class="field" style="grid-column:1/-1"><label>Current Password</label>${passwordInputRow('<input id="loginChangeOldPassword" class="entry-input" type="password" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" data-no-password-store="true">', 'loginChangeOldPassword')}</div>
        <div class="field"><label>New Password</label>${passwordInputRow('<input id="loginChangeNewPassword" class="entry-input" type="password" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" data-no-password-store="true" placeholder="Minimum 6 characters">', 'loginChangeNewPassword')}</div>
        <div class="field"><label>Confirm New Password</label>${passwordInputRow('<input id="loginChangeConfirmPassword" class="entry-input" type="password" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" data-no-password-store="true">', 'loginChangeConfirmPassword')}</div>
      </div>
      <p style="margin:8px 0 0;font-size:0.78em;color:var(--text-muted)">Use your current Staff ID and password. After the update, sign in with the new password.</p>
    `, [
      { label:'Cancel', className:'secondary', onClick: closeModal },
      { label:'Update Password', onClick: async () => {
        const staffId = (byId('loginChangeStaffId')?.value || '').trim().toUpperCase();
        const oldPassword = byId('loginChangeOldPassword')?.value || '';
        const newPassword = byId('loginChangeNewPassword')?.value || '';
        const confirmPassword = byId('loginChangeConfirmPassword')?.value || '';
        if (!staffId) return showToast('Enter Staff ID');
        if (!oldPassword) return showToast('Enter current password');
        if (!newPassword || newPassword.length < 6) return showToast('New password must be at least 6 characters');
        if (newPassword !== confirmPassword) return showToast('New passwords do not match');
        const submitBtn = document.querySelector('.modal-actions button:last-child');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Updating…'; }
        try {
          await nextPaint();
          const loginResult = await gateway.auth?.loginWithStaffId?.({ staffId, password: oldPassword });
          if (!loginResult?.ok) {
            showToast(loginResult?.error?.message || 'Current Staff ID or password is incorrect');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Update Password'; }
            return;
          }
          const result = await gateway.auth?.changePassword?.({ oldPassword, newPassword });
          if (!result?.ok) {
            showToast(result?.error?.message || 'Could not change password');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Update Password'; }
            return;
          }
          await gateway.auth?.logout?.().catch?.(() => {});
          if (byId('loginStaffId')) byId('loginStaffId').value = staffId;
          if (byId('loginPassword')) byId('loginPassword').value = '';
          closeModal();
          showLoginScreen();
          showToast('✓ Password changed. Sign in with the new password.');
        } catch (err) {
          showToast('Could not change password');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Update Password'; }
        }
      }}
    ]);
    bindPasswordToggles(byId('modalBody') || document);
    hardenCredentialInputs(byId('modalBody') || document);
  }

  function openAdminResetPasswordModal(staffId) {
    if (!isAdminStaff()) return showToast('Only admin can reset passwords');
    const target = state.staff.find(s => s.id === staffId);
    if (!target) return showToast('Staff not found');
    const staffCode = target.staffCode || target.staff_code || target.staffId || target.id || '';
    openModal('Reset Staff Password', `
      <div style="max-width:520px">
        <p style="margin:0 0 10px;font-size:0.86em">Reset password for <strong>${escapeHtml(target.name || target.full_name || staffCode)}</strong>.</p>
        <div class="form-grid two" style="gap:10px">
          <div class="field"><label>Staff ID</label><div class="display-field">${escapeHtml(String(staffCode))}</div></div>
          <div class="field"><label>Temporary Password</label>${passwordInputRow('<input id="adminTempPassword" class="entry-input" type="password" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" data-no-password-store="true" placeholder="Minimum 6 characters">', 'adminTempPassword')}</div>
          <div class="field"><label>Confirm Password</label>${passwordInputRow('<input id="adminTempPasswordConfirm" class="entry-input" type="password" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" data-no-password-store="true">', 'adminTempPasswordConfirm')}</div>
        </div>
        <p style="margin:8px 0 0;font-size:0.78em;color:var(--text-muted)">Give this temporary password to the staff securely.</p>
      </div>
    `, [
      { label:'Cancel', className:'secondary', onClick: closeModal },
      { label:'Reset Password', onClick: async () => {
        const temporaryPassword = byId('adminTempPassword')?.value || '';
        const confirmPassword = byId('adminTempPasswordConfirm')?.value || '';
        if (!temporaryPassword || temporaryPassword.length < 6) return showToast('Temporary password must be at least 6 characters');
        if (temporaryPassword !== confirmPassword) return showToast('Passwords do not match');
        const submitBtn = document.querySelector('.modal-actions button:last-child');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Resetting…'; }
        try {
          await nextPaint();
          const actor = currentStaff();
          const result = await gateway.auth?.resetStaffPassword?.({
            staffId: target.id,
            staffCode,
            authUserId: target.authUserId || target.auth_user_id || target.uuid || '',
            temporaryPassword,
            updatedByStaffId: actor?.id || null,
            updatedByName: actor?.name || actor?.fullName || null,
          });
          if (!result?.ok) {
            showToast(result?.error?.message || 'Could not reset password');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Reset Password'; }
            return;
          }
          closeModal();
          showToast('✓ Staff password reset successfully');
        } catch (err) {
          showToast('Could not reset password');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Reset Password'; }
        }
      }}
    ]);
    bindPasswordToggles(byId('modalBody') || document);
    hardenCredentialInputs(byId('modalBody') || document);
  }


  function openRecoveryKeyDisplayModal(recoveryKey, generatedAt) {
    const safeKey = escapeHtml(recoveryKey || '');
    openModal('Admin Recovery Key', `
      <div class="compact-panel" style="padding:10px;border:1px solid var(--line);border-radius:12px">
        <p style="margin:0 0 8px;font-size:0.86em;color:var(--text-muted)">Save this key now. It is shown once and is required if the Admin forgets password.</p>
        <div style="font-family:monospace;font-size:0.98em;letter-spacing:.04em;padding:10px;border:1px dashed var(--line);border-radius:10px;background:var(--panel-soft);word-break:break-all">${safeKey}</div>
        <p style="margin:8px 0 0;font-size:0.76em;color:var(--text-muted)">Generated: ${escapeHtml(generatedAt || new Date().toISOString())}</p>
        <label style="display:inline-flex;gap:8px;align-items:center;margin-top:10px;font-size:0.82em;line-height:1.25"><input id="recoveryKeySavedConfirm" type="checkbox" style="width:14px;height:14px;min-width:14px;max-width:14px;margin:0;accent-color:var(--accent,#1f5f91)"> <span>I have copied/saved this recovery key safely.</span></label>
      </div>
    `, [
      { label:'Copy Key', className:'secondary', onClick: async () => {
        try { await navigator.clipboard.writeText(recoveryKey || ''); showToast('Recovery key copied'); } catch (_) { showToast('Copy failed. Please copy manually.'); }
      }},
      { label:'Download Key', className:'secondary', onClick: () => {
        const blob = new Blob([`DUCESS Admin Recovery Key\n\n${recoveryKey}\n\nGenerated: ${generatedAt || new Date().toISOString()}\nKeep this file offline and secure.`], { type:'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'DUCESS-admin-recovery-key.txt';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }},
      { label:'Close', onClick: () => {
        if (!byId('recoveryKeySavedConfirm')?.checked) return showToast('Confirm that you have saved the recovery key');
        closeModal();
      }}
    ]);
  }

  async function openAdminRecoveryKeyModal(forceSetup=false) {
    if (!isAdminStaff()) return showToast('Only Admin can manage recovery key');
    const title = forceSetup ? 'Generate Recovery Key Required' : 'Admin Recovery Key';
    openModal(title, `
      <div class="compact-panel" style="padding:10px;border:1px solid var(--line);border-radius:12px">
        <p style="margin:0 0 8px;font-size:0.86em;color:var(--text-muted)">${forceSetup ? 'No Admin recovery key exists yet. Generate one now so this deployment can recover Admin access if password is forgotten.' : 'Generate or regenerate the Admin recovery key. Regeneration invalidates the previous key on this device/deployment.'}</p>
        <p style="margin:0;font-size:0.78em;color:var(--text-muted)">The key is displayed once. Store it offline before closing.</p>
      </div>
    `, [
      ...(forceSetup ? [] : [{ label:'Cancel', className:'secondary', onClick: closeModal }]),
      { label: forceSetup ? 'Generate Recovery Key' : 'Generate / Regenerate Key', onClick: async () => {
        const btn = q('#modalActions button:not(.secondary)');
        if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
        try {
          const result = await gateway.auth?.generateAdminRecoveryKey?.({ regenerate: !forceSetup });
          if (!result?.ok) {
            showToast(result?.error?.message || 'Could not generate recovery key');
            if (btn) { btn.disabled = false; btn.textContent = forceSetup ? 'Generate Recovery Key' : 'Generate / Regenerate Key'; }
            return;
          }
          openRecoveryKeyDisplayModal(result.data?.recoveryKey, result.data?.generatedAt);
        } catch (err) {
          showToast('Could not generate recovery key');
          if (btn) { btn.disabled = false; btn.textContent = forceSetup ? 'Generate Recovery Key' : 'Generate / Regenerate Key'; }
        }
      }}
    ]);
  }

  async function enforceAdminRecoveryKeySetup() {
    if (!isAdminStaff()) return;
    try {
      const result = await gateway.auth?.hasAdminRecoveryKey?.();
      if (result?.ok && !result.data?.exists) setTimeout(() => openAdminRecoveryKeyModal(true), 250);
    } catch (_) {}
  }

  function openEditStaffCodeModal(staffId) {
    const staff = state.staff.find(s => s.id === staffId);
    if (!staff) return showToast('Staff not found');
    const currentCode = staff.staffCode || staff.staff_code || staff.id || '';
    openModal('Edit Staff ID', `
      <p style="margin:0 0 10px;font-size:0.85em;color:var(--text-muted)">Staff ID is manager-assigned — it must be unique across all staff. Changing it changes their login ID.</p>
      <div class="field"><label>Staff ID <span style="color:red">*</span></label><input id="editStaffCodeInput" class="entry-input" value="${escapeHtml(String(currentCode))}" style="text-transform:uppercase" maxlength="10"></div>
    `, [
      {label:'Cancel', className:'secondary', onClick: closeModal},
      {label:'Save', onClick: async () => {
        const raw = byId('editStaffCodeInput')?.value?.trim();
        const newCode = raw ? raw.toUpperCase() : '';
        if (!newCode) return showToast('Enter a Staff ID');
        if (newCode.length > 10) return showToast('Staff ID must be 10 characters or fewer');
        if (newCode === currentCode.toUpperCase()) return closeModal();
        const clash = state.staff.some(s => s.id !== staffId && (s.staffCode || s.staff_code || s.id || '').toUpperCase() === newCode);
        if (clash) return showToast(`Staff ID "${newCode}" is already in use`);

        const submitBtn = document.querySelector('.modal-actions button:last-child');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving…'; }
        try {
          if (isSupabaseApprovalMode() && gateway.staff?.updateStaffCode) {
            const currentUser = state.staff.find(s => s.id === state.activeStaffId);
            const result = await gateway.staff.updateStaffCode({
              staffId,
              staffCode: newCode,
              updatedByStaffId: currentUser?.id || null,
              updatedByName: currentUser?.name || null,
            });
            if (!result.ok) {
              showToast(result.error?.message || 'Could not update Staff ID');
              if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save'; }
              return;
            }
          }
          staff.staffCode = newCode;
          staff.staff_code = newCode;
          save();
          closeModal();
          render();
          showToast(`✓ Staff ID updated to "${newCode}"`);
        } catch (err) {
          showToast('Unexpected error updating Staff ID');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save'; }
        }
      }}
    ]);
  }

  function bindStaffDirectory() {
    // REDESIGN 2026-08-14: staff_directory now shows Staff Salary Balance —
    // fetch fresh data on demand, same pattern used elsewhere for on-demand
    // reads. Guarded to only run when this tool (not staff_roster, which
    // shares this bind function) is the active screen.
    if (state.ui.tool === 'staff_directory') {
      const staffSalarySearch = byId('staffSalarySearch');
      if (staffSalarySearch) staffSalarySearch.oninput = debounce(() => {
        state.ui.staffSalarySearch = staffSalarySearch.value || '';
        save();
        renderWorkspace();
      }, 200);
      if (!state.ui.staffSalaryAccountsCache && !state.ui.staffSalaryBalanceLoading && gateway.customers?.listStaffSalaryAccounts) {
        state.ui.staffSalaryBalanceLoading = true;
        renderWorkspace();
        (async () => {
          try {
            const result = await gateway.customers.listStaffSalaryAccounts();
            state.ui.staffSalaryAccountsCache = result?.ok ? (result.data || []) : [];
            if (!result?.ok) showToast(result?.error?.message || 'Unable to load staff salary accounts');
          } catch (err) {
            state.ui.staffSalaryAccountsCache = [];
            showToast('Unexpected error loading staff salary accounts');
          } finally {
            state.ui.staffSalaryBalanceLoading = false;
            if (state.ui.tool === 'staff_directory') renderWorkspace();
          }
        })();
      }
      return;
    }
    const addBtn = byId('addStaffBtn');
    if (addBtn) addBtn.onclick = () => {
      openModal('Onboard New Staff', `
      <div class="form-grid two" style="gap:12px">
        <div class="field"><label>Full Name <span style="color:red">*</span></label><input id="newStaffName" class="entry-input" placeholder="e.g. Amaka Obi"></div>
        <div class="field"><label>Staff ID / Login ID <span style="color:red">*</span></label><input id="newStaffCode" class="entry-input" placeholder="e.g. TLR001" style="text-transform:uppercase" maxlength="10"></div>
        <div class="field"><label>Role <span style="color:red">*</span></label><select id="newStaffRole" class="entry-input">${Object.keys(ROLE_LABELS).map(k=>`<option value="${k}">${ROLE_LABELS[k]}</option>`).join('')}</select></div>
        <div class="field"><label>Temporary Password <span style="color:red">*</span></label>${passwordInputRow('<input id="newStaffPassword" class="entry-input" type="password" placeholder="Minimum 6 characters">', 'newStaffPassword')}</div>
        <div class="field" style="grid-column:1/-1"><label>Branch (optional)</label><input id="newStaffBranch" class="entry-input" placeholder="e.g. Main Branch"></div>
      </div>
      <p style="margin:10px 0 0;font-size:0.82em;color:var(--text-muted)">Staff will log in using their Staff ID and this password. Keep it short and memorable — e.g. TLR001, CSO002. They can change their password after first login.</p>
    `,[
      {label:'Cancel', className:'secondary', onClick: closeModal},
      {label:'Create Staff Account', onClick: async () => {
        const name = byId('newStaffName')?.value?.trim();
        const codeRaw = byId('newStaffCode')?.value?.trim();
        const staffCode = codeRaw ? codeRaw.toUpperCase() : '';
        const role = byId('newStaffRole')?.value;
        const password = byId('newStaffPassword')?.value;
        const branch = byId('newStaffBranch')?.value?.trim() || null;

        if (!name) return showToast('Enter staff full name');
        if (!staffCode) return showToast('Enter a Staff ID / login ID');
        if (staffCode.length > 10) return showToast('Staff ID must be 10 characters or fewer');
        if (!password || password.length < 6) return showToast('Password must be at least 6 characters');
        if (state.staff.some(s => (s.staffCode || s.staff_code || s.id || '').toUpperCase() === staffCode)) {
          return showToast(`Staff ID "${staffCode}" already exists`);
        }

        const submitBtn = document.querySelector('.modal-actions button:last-child');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creating…'; }

        try {
          let newStaffRecord = null;
          if (isSupabaseApprovalMode() && gateway.staff?.createStaff) {
            const currentStaff = state.staff.find(s => s.id === state.activeStaffId);
            const result = await gateway.staff.createStaff({
              staffCode,
              name,
              fullName: name,
              role,
              roleCode: role,
              branchId: branch,
              temporaryPassword: password,
              createdByStaffId: currentStaff?.id || null,
              createdByName: currentStaff?.name || null,
            });
            if (!result.ok) {
              showToast(`Error: ${result.error?.message || 'Could not create staff'}`);
              if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create Staff Account'; }
              return;
            }
            newStaffRecord = { id: result.data?.id || result.data?.staffId || uid('st'), staffCode, name, role, active: true, ...(result.data || {}) };
          } else {
            // Local fallback
            newStaffRecord = { id: uid('st'), staffCode, name, role, active: true };
          }

          state.staff.push(newStaffRecord);
          ensureStaffAccount(newStaffRecord.id);
          save();
          // SURGICAL PATCH 2026-08-13: staff creation was never recorded in
          // the audit trail — every other state-changing action calls
          // pushAudit(), this one was missed. The gateway also attempts a
          // server-side audit insert, but it's fire-and-forget and its result
          // is never checked, so this local entry is the reliable record.
          pushAudit('staff_created', `${name} (${staffCode}) added as ${ROLE_LABELS[role] || role}`);
          // SURGICAL PATCH 2026-08-14: tellers now get their operational
          // account auto-provisioned by the gateway at creation time (no more
          // separate Account Opening + approval step — see gateway.staff.createStaff).
          // Pull the fresh customer list so the new T#### account shows up
          // immediately, and log it as its own audit entry (distinct from
          // "staff_created") since it's a separate record being opened.
          if (newStaffRecord.operationalAccount?.account_number) {
            await syncCustomersListFromGateway();
            pushAudit('teller_account_opened', `Operational account ${newStaffRecord.operationalAccount.account_number} auto-opened for ${name}`);
          } else if (role === 'teller' && newStaffRecord.operationalAccountError) {
            showToast(`Staff created, but operational account setup failed: ${newStaffRecord.operationalAccountError}. Open it manually.`);
          }
          closeModal();
          render();
          showToast(`✓ Staff "${name}" (${staffCode}) created successfully${newStaffRecord.operationalAccount?.account_number ? ` — teller account ${newStaffRecord.operationalAccount.account_number} opened` : ''}`);
        } catch (err) {
          showToast('Unexpected error creating staff');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create Staff Account'; }
        }
      }}
    ]);
      bindPasswordToggles(byId('modalBody') || document);
    hardenCredentialInputs(byId('modalBody') || document);
    };

    const adminRecoveryKeyBtn = byId('adminRecoveryKeyBtn');
    if (adminRecoveryKeyBtn) adminRecoveryKeyBtn.onclick = () => openAdminRecoveryKeyModal(false);
    const adminRecoveryKeyInlineBtn = byId('adminRecoveryKeyInlineBtn');
    if (adminRecoveryKeyInlineBtn) adminRecoveryKeyInlineBtn.onclick = () => openAdminRecoveryKeyModal(false);
    qq('[data-staff-reset-password]').forEach(btn => btn.onclick = () => openAdminResetPasswordModal(btn.dataset.staffResetPassword));
    qq('[data-staff-edit-code]').forEach(btn => btn.onclick = () => openEditStaffCodeModal(btn.dataset.staffEditCode));

    const staffDirectorySearch = byId('staffDirectorySearch');
    if (staffDirectorySearch) {
      staffDirectorySearch.oninput = debounce(() => {
        state.ui.staffDirectorySearch = staffDirectorySearch.value || '';
        save();
        renderWorkspace();
      }, 200);
    }
    qq('[data-staff-ledger]').forEach(btn => btn.onclick = () => openStaffLedgerModal(btn.dataset.staffLedger));

    qq('[data-staff-toggle]').forEach(btn => btn.onclick = async () => {
      const st = state.staff.find(s => s.id === btn.dataset.staffToggle);
      if (!st) return;
      const isCurrentlyActive = st.active !== false && st.is_active !== false;

      if (isCurrentlyActive) {
        // Safety checks before deactivation
        const acc = ensureStaffAccount(st.id);
        const checks = [];
        if (Number(acc.balance || 0) !== 0) checks.push(`Outstanding FORM balance: ₦${money(acc.balance)}`);
        if (Number(acc.debtBalance || 0) > 0) checks.push(`Unpaid debt: ₦${money(acc.debtBalance)}`);
        const hasOpenCod = (state.cod || []).some(c => c.staffId === st.id && c.status === 'pending');
        if (hasOpenCod) checks.push('Unresolved COD submission');
        const hasPendingApprovals = (state.approvals || []).some(a => a.requestedByStaffId === st.id && a.status === 'pending');
        if (hasPendingApprovals) checks.push('Pending approval requests');

        if (checks.length > 0) {
          const blockers = checks.map(c => `• ${c}`).join('\n');
          openModal('Cannot Deactivate Staff', `
            <p style="margin:0 0 12px">Cannot deactivate <strong>${escapeHtml(st.name || st.full_name)}</strong> — the following must be resolved first:</p>
            <div style="background:var(--surface-alt,#fff8f0);border:1px solid #fbbf24;border-radius:6px;padding:12px;white-space:pre-line;font-size:0.9em">${escapeHtml(blockers)}</div>
          `, [{label:'OK', onClick: closeModal}]);
          return;
        }

        openModal('Confirm Deactivation', `
          <p>Are you sure you want to deactivate <strong>${escapeHtml(st.name || st.full_name)}</strong>?</p>
          <p style="font-size:0.85em;color:var(--text-muted)">Their login will be disabled. All historical records are preserved.</p>
          <div class="field" style="margin-top:10px"><label>Reason (optional)</label><input id="deactivateReason" class="entry-input" placeholder="e.g. Resigned, transferred…"></div>
        `, [
          {label:'Cancel', className:'secondary', onClick: closeModal},
          {label:'Deactivate', onClick: async () => {
            const reason = byId('deactivateReason')?.value?.trim() || '';
            closeModal();
            if (isSupabaseApprovalMode() && gateway.staff?.updateStaffStatus) {
              const currentStaff = state.staff.find(s => s.id === state.activeStaffId);
              await gateway.staff.updateStaffStatus({
                staffId: st.id,
                isActive: false,
                reason,
                updatedByStaffId: currentStaff?.id || null,
                updatedByName: currentStaff?.name || null,
              });
            }
            st.active = false;
            st.is_active = false;
            if (state.activeStaffId === st.id) {
              const replacement = state.staff.find(s => s.id !== st.id && s.active !== false && s.is_active !== false);
              if (replacement) state.activeStaffId = replacement.id;
            }
            save(); render();
            showToast(`Staff "${st.name || st.full_name}" deactivated`);
          }}
        ]);
      } else {
        // Reactivation
        openModal('Reactivate Staff', `
          <p>Reactivate <strong>${escapeHtml(st.name || st.full_name)}</strong> and restore their login access?</p>
        `, [
          {label:'Cancel', className:'secondary', onClick: closeModal},
          {label:'Reactivate', onClick: async () => {
            closeModal();
            if (isSupabaseApprovalMode() && gateway.staff?.updateStaffStatus) {
              const currentStaff = state.staff.find(s => s.id === state.activeStaffId);
              await gateway.staff.updateStaffStatus({
                staffId: st.id,
                isActive: true,
                updatedByStaffId: currentStaff?.id || null,
                updatedByName: currentStaff?.name || null,
              });
            }
            st.active = true;
            st.is_active = true;
            save(); render();
            showToast(`Staff "${st.name || st.full_name}" reactivated`);
          }}
        ]);
      }
    });
  }

  function bindCustomerDirectory() {
    const searchInput = byId('customerDirectorySearch');
    if (!searchInput) return;

    const applySearch = () => {
      const value = searchInput.value || '';
      const start = searchInput.selectionStart ?? value.length;
      const end = searchInput.selectionEnd ?? value.length;
      state.ui.customerDirectorySearch = value;
      renderWorkspace();
      const nextInput = byId('customerDirectorySearch');
      if (nextInput) {
        nextInput.focus();
        try { nextInput.setSelectionRange(start, end); } catch (err) {}
      }
    };

    const persistSearch = () => save();

    searchInput.addEventListener('input', applySearch);
    searchInput.addEventListener('search', applySearch);
    searchInput.addEventListener('change', persistSearch);
    searchInput.addEventListener('blur', persistSearch);

    const closeBtn = byId('customerDirectoryCloseBtn');
    if (closeBtn) {
      closeBtn.onclick = () => {
        state.ui.tool = null;
        save();
        renderWorkspace();
      };
    }

    // Remove customer buttons
    qq('[data-remove-customer]').forEach(btn => {
      btn.onclick = () => {
        const customerId = btn.dataset.removeCustomer;
        const customer = state.customers.find(c => c.id === customerId);
        if (!customer) return;
        openModal('Remove Customer', `
          <p>Remove <strong>${escapeHtml(customer.name)}</strong> (${escapeHtml(customer.accountNumber || '—')}) from the active customer list?</p>
          <p style="font-size:0.85em;color:var(--text-muted)">All transaction history and audit records are preserved. This action can be reversed by Admin.</p>
        `, [
          { label: 'Cancel', className: 'secondary', onClick: closeModal },
          { label: 'Remove Customer', onClick: () => {
            customer.active = false;
            customer.removedAt = new Date().toISOString();
            save();
            closeModal();
            render();
            showToast(`${customer.name} removed from active list`);
          }}
        ]);
      };
    });
  }


  function makePasswordToggle(inputId, label='Show') {
    return `<button type="button" class="secondary tiny-btn" data-password-toggle="${inputId}" style="white-space:nowrap;padding:7px 10px;font-size:0.78em">${label}</button>`;
  }

  function bindPasswordToggles(root=document) {
    qq('[data-password-toggle]', root).forEach(btn => {
      if (btn.dataset.boundPasswordToggle === '1') return;
      btn.dataset.boundPasswordToggle = '1';
      btn.onclick = () => {
        const input = byId(btn.dataset.passwordToggle);
        if (!input) return;
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        btn.textContent = showing ? 'Show' : 'Hide';
      };
    });
  }

  function passwordInputRow(inputHtml, inputId) {
    return `<div style="display:flex;gap:6px;align-items:center">${inputHtml}${makePasswordToggle(inputId)}</div>`;
  }

  function hardenCredentialInputs(root=document) {
    qq('input[type="password"], #loginStaffId, [data-no-password-store]', root).forEach(input => {
      input.setAttribute('autocomplete', input.id === 'loginPassword' ? 'new-password' : 'off');
      input.setAttribute('autocorrect', 'off');
      input.setAttribute('autocapitalize', 'none');
      input.setAttribute('spellcheck', 'false');
      input.setAttribute('data-no-password-store', 'true');
      if (!input.name || /password|username|staff/i.test(input.name)) {
        input.name = `ducess_${input.id || 'credential'}_${Math.random().toString(36).slice(2,8)}`;
      }
    });
  }

  function openAdminRecoveryModal() {
    openModal('Admin Password Recovery', `
      <div class="grid two compact-grid">
        <div class="field"><label>Admin Staff ID</label><input id="recoverAdminStaffId" class="entry-input" type="text" autocomplete="username" placeholder="e.g. ADMIN001"></div>
        <div class="field"><label>Recovery Key</label>${passwordInputRow('<input id="recoverAdminCode" class="entry-input" type="password" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" data-no-password-store="true" placeholder="DUCESS-RK-...">', 'recoverAdminCode')}</div>
        <div class="field"><label>Temporary Password</label>${passwordInputRow('<input id="recoverAdminTempPassword" class="entry-input" type="password" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" data-no-password-store="true" placeholder="Minimum 6 characters">', 'recoverAdminTempPassword')}</div>
        <div class="field"><label>Confirm Password</label>${passwordInputRow('<input id="recoverAdminTempConfirm" class="entry-input" type="password" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" data-no-password-store="true">', 'recoverAdminTempConfirm')}</div>
      </div>
      <p style="margin:8px 0 0;font-size:0.78em;color:var(--text-muted)">Use the Admin Recovery Key generated inside Administration. The key is shown once and should be stored offline. After reset, sign in with the temporary password and change it immediately.</p>
    `, [
      { label:'Cancel', className:'secondary', onClick: closeModal },
      { label:'Reset Admin Password', onClick: async () => {
        const staffCode = byId('recoverAdminStaffId')?.value?.trim() || '';
        const recoveryCode = byId('recoverAdminCode')?.value || '';
        const temporaryPassword = byId('recoverAdminTempPassword')?.value || '';
        const confirmPassword = byId('recoverAdminTempConfirm')?.value || '';
        if (!staffCode) return showToast('Enter Admin Staff ID');
        if (!recoveryCode) return showToast('Enter recovery key');
        if (!temporaryPassword || temporaryPassword.length < 6) return showToast('Temporary password must be at least 6 characters');
        if (temporaryPassword !== confirmPassword) return showToast('Passwords do not match');
        const submitBtn = q('#modalActions button:not(.secondary)');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Resetting…'; }
        try {
          const result = await gateway.auth?.recoverAdminPassword?.({ staffCode, recoveryCode, temporaryPassword });
          if (!result?.ok) {
            showToast(result?.error?.message || 'Admin recovery reset failed');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Reset Admin Password'; }
            return;
          }
          closeModal();
          showToast('✓ Admin password reset. Sign in with the temporary password.');
        } catch (err) {
          showToast('Admin recovery reset failed');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Reset Admin Password'; }
        }
      }}
    ]);
    bindPasswordToggles(byId('modalBody') || document);
    hardenCredentialInputs(byId('modalBody') || document);
  }

  // ===== LOGIN SCREEN =====
  function showLoginScreen() {
    const screen = byId('loginScreen');
    if (screen) screen.classList.remove('hidden');
    const shell = document.querySelector('.shell');
    if (shell) shell.style.visibility = 'hidden';
  }

  function hideLoginScreen() {
    const screen = byId('loginScreen');
    if (screen) screen.classList.add('hidden');
    const shell = document.querySelector('.shell');
    if (shell) shell.style.visibility = '';
  }

  function bindLoginScreen() {
    const btn = byId('loginBtn');
    const staffInput = byId('loginStaffId');
    const passInput = byId('loginPassword');
    const errEl = byId('loginError');
    hardenCredentialInputs(byId('loginScreen') || document);
    if (staffInput) staffInput.value = '';
    if (passInput) passInput.value = '';
    if (!btn) return;
    if (passInput && !passInput.parentElement?.querySelector('[data-password-toggle="loginPassword"]')) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '6px';
      row.style.alignItems = 'center';
      passInput.parentElement.insertBefore(row, passInput);
      row.appendChild(passInput);
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'secondary tiny-btn';
      toggle.dataset.passwordToggle = 'loginPassword';
      toggle.style.whiteSpace = 'nowrap';
      toggle.style.padding = '7px 10px';
      toggle.style.fontSize = '0.78em';
      toggle.textContent = 'Show';
      row.appendChild(toggle);
    }
    if (btn.parentElement && !byId('loginPasswordTools')) {
      const tools = document.createElement('div');
      tools.id = 'loginPasswordTools';
      tools.style.display = 'flex';
      tools.style.alignItems = 'center';
      tools.style.justifyContent = 'space-between';
      tools.style.gap = '8px';
      tools.style.marginTop = '8px';

      const changeBtn = document.createElement('button');
      changeBtn.type = 'button';
      changeBtn.id = 'loginChangePasswordBtn';
      changeBtn.className = 'secondary tiny-btn';
      changeBtn.style.flex = '1';
      changeBtn.style.padding = '6px 8px';
      changeBtn.style.fontSize = '0.74em';
      changeBtn.textContent = 'Change password';
      changeBtn.onclick = openLoginChangePasswordModal;
      tools.appendChild(changeBtn);

      const recoverBtn = document.createElement('button');
      recoverBtn.type = 'button';
      recoverBtn.id = 'adminRecoveryBtn';
      recoverBtn.className = 'secondary tiny-btn';
      recoverBtn.style.flex = '1';
      recoverBtn.style.padding = '6px 8px';
      recoverBtn.style.fontSize = '0.74em';
      recoverBtn.textContent = 'Admin forgot password?';
      recoverBtn.onclick = openAdminRecoveryModal;
      tools.appendChild(recoverBtn);

      btn.parentElement.appendChild(tools);
    }
    bindPasswordToggles(byId('loginScreen') || document);
    hardenCredentialInputs(byId('loginScreen') || document);

    async function attemptLogin() {
      const staffId = (staffInput?.value || '').trim();
      const password = (passInput?.value || '').trim();
      if (!staffId || !password) {
        errEl.textContent = 'Please enter your Staff ID and password.';
        errEl.classList.remove('hidden');
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Signing in…';
      errEl.classList.add('hidden');
      // SURGICAL FIX 2026-08-27: this had no try/catch around it — if
      // loginWithStaffId (or anything it calls) THREW instead of cleanly
      // resolving to {ok:false}, e.g. a network hiccup or timeout, the
      // button never got reset. It stayed stuck on "Signing in…" forever,
      // with the actual error going out as an unhandled promise rejection
      // that doesn't show up as a normal console message — exactly what
      // the screenshot showed (a red error-count badge, no visible auth
      // error). Now every path — success, a clean error, or an unexpected
      // throw — always resets the button and always shows something to
      // the person trying to log in.
      try {
        const result = await gateway.auth.loginWithStaffId({ staffId, password });
        if (!result.ok) {
          errEl.textContent = result.error?.message || 'Invalid Staff ID or password.';
          errEl.classList.remove('hidden');
          return;
        }
        // Login success — wipe typed credentials from the DOM immediately.
        if (passInput) passInput.value = '';
        if (staffInput) staffInput.value = '';
        // Login success — set active staff from session
        const sessionStaff = result.data?.staff;
        if (sessionStaff?.id) {
          state.activeStaffId = sessionStaff.id;
          save();
        }
        // SURGICAL PATCH 2026-08-18: state.ui.selectedCustomerId is shared
        // across Check Balance / Maintenance / Reactivation / Statement and
        // was never cleared on login — so a customer looked up in a PREVIOUS
        // session (possibly days earlier, by a different staff member on a
        // shared device) would silently resurface on Statement of Account
        // looking like a hardcoded "default customer". Reset per-session state
        // on every fresh login so nothing carries over.
        state.ui.selectedCustomerId = null;
        state.ui.checkBalanceLoaded = false;
        state.ui.accountStatementGenerated = false;
        save();
        hideLoginScreen();
        await syncStaffFromGateway();
        await syncApprovalsFromGateway();
        await syncCodFromGateway();
        render();
        await enforceAdminRecoveryKeySetup();
      } catch (err) {
        console.warn('[DUCESS] Login failed with an unexpected error', err);
        errEl.textContent = 'Sign-in failed unexpectedly — check your connection and try again.';
        errEl.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Sign In';
      }
    }

    btn.onclick = attemptLogin;
    passInput.onkeydown = (e) => { if (e.key === 'Enter') attemptLogin(); };
    staffInput.onkeydown = (e) => { if (e.key === 'Enter') passInput?.focus(); };
  }
  // ===== END LOGIN SCREEN =====

  function startApp() {
    try {
      const navEntry = performance.getEntriesByType?.('navigation')?.[0];
      if (navEntry?.type === 'reload') {
        state.ui.module = null;
        state.ui.tool = null;
        save();
      }
    } catch (err) {}
    applyTheme(state.ui.theme || 'classic', false);
    bindLoginScreen();
    window.addEventListener('pageshow', () => {
      const login = byId('loginScreen');
      if (login && !login.classList.contains('hidden')) {
        if (byId('loginStaffId')) byId('loginStaffId').value = '';
        if (byId('loginPassword')) byId('loginPassword').value = '';
        hardenCredentialInputs(login);
      }
    }, { once: true });

    if (isSupabaseApprovalMode()) {
      // Security rule: never restore a previous terminal session after refresh/reopen.
      // The shell may render behind the login overlay, but staff must sign in again.
      gateway.auth?.logout?.().catch(() => {});
      state.ui.module = null;
      state.ui.tool = null;
      save();
      showLoginScreen();
      render();
    } else {
      // Local mode — skip login
      render();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp, { once: true });
  } else {
    startApp();
  }
})();



