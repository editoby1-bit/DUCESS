(() => {
  const runtimeConfig = window.__DUCESS_CONFIG__ || {};
  const STORAGE_KEY = runtimeConfig.storageKey || 'duces_enterprise_ledger_v1';
  const gateway = window.DucessGateway?.createGateway?.({
    storageKey: STORAGE_KEY,
    useSupabaseBackend: runtimeConfig.useSupabaseBackend === true,
    supabase: runtimeConfig.supabase || {}
  }) || null;
  const DATE_FMT = new Intl.DateTimeFormat('en-GB', { day:'2-digit', month:'short', year:'numeric' });
  const THEMES = ['classic','ducess-sheet','ocean','dark-slate','neutral-stone'];
  const THEME_LABELS = { classic:'Classic', 'ducess-sheet':'Ducess Sheet', ocean:'Ocean', 'dark-slate':'Dark Slate', 'neutral-stone':'Neutral Stone' };
  const money = (n) => Number(n || 0).toLocaleString();
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
  const COMPRESSED_IMAGE_MAX_SIDE = 700;
  const COMPRESSED_IMAGE_QUALITY = 0.55;
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
    approving_officer: 'Approving Officer',
    admin_officer: 'Administrative Officer',
    report_officer: 'Report Officer'
  };

  const MODULES = {
    customer_service: {
      title: 'Customer Service',
      desc: 'Check balance, open, maintain, reactivate accounts and print statements.',
      icon: '👤',
      tools: ['check_balance','account_opening','account_maintenance','account_reactivation','account_statement','operational_accounts']
    },
    tellering: {
      title: 'Tellering',
      desc: 'Credit and debit customers through a journal workflow with approved float control.',
      icon: '💳',
      tools: ['check_balance','credit','debit','operational_accounts','my_balance','opening_balance','my_close_day']
    },
    approvals: {
      title: 'Approval',
      desc: 'Approve or reject submitted requests and review close-of-day activity.',
      icon: '✅',
      tools: ['central_close_day','approval_queue','approval_customer_service','approval_tellering','approval_others']
    },
    administration: {
      title: 'Administration',
      desc: 'Manage working tools, operational postings, temporary grants, and staff settings.',
      icon: '🛠️',
      tools: ['operational_posting','operational_accounts','permissions','staff_directory','customer_directory']
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
    credit: 'Credit',
    debit: 'Debit',
    my_balance: 'My Balance',
    opening_balance: 'Form',
    my_close_day: 'My Close of Day',
    central_close_day: 'Central Close of Day',
    approval_queue: 'Approval Queue',
    approval_customer_service: 'Customer Service',
    approval_tellering: 'Teller',
    approval_others: 'Others',
    permissions: 'Permissions Matrix',
    operational_posting: 'Income & Expense Posting',
    operational_accounts: 'Income & Expense Accounts',
    staff_directory: 'Staff Directory',
    customer_directory: 'Customer Directory',
    business_balance: 'Business Balance',
    operational_balance: 'Operational Balance',
    teller_balances: 'Teller Balances'
  };

  const DEFAULT_PERMS = {
    customer_service: ['check_balance','account_opening','account_maintenance','account_reactivation','account_statement','operational_accounts'],
    teller: ['check_balance','account_statement','credit','debit','operational_accounts','my_balance','opening_balance','my_close_day'],
    approving_officer: ['check_balance','account_opening','account_maintenance','account_reactivation','account_statement','credit','debit','central_close_day','approval_queue','approval_customer_service','approval_tellering','approval_others','business_balance','operational_balance','operational_accounts','my_balance','opening_balance','my_close_day'],
    admin_officer: ['check_balance','account_opening','account_maintenance','account_reactivation','account_statement','credit','debit','central_close_day','approval_queue','approval_customer_service','approval_tellering','approval_others','permissions','operational_accounts','operational_posting','staff_directory','customer_directory','business_balance','operational_balance','teller_balances','my_balance','opening_balance','my_close_day'],
    report_officer: ['check_balance','account_statement','business_balance','operational_balance','teller_balances','operational_accounts']
  };

  let realtimeBound = false;
  let realtimeUnsub = null;
  const state = bootstrapState();
  state.ui = state.ui || { module: null, tool: null, selectedCustomerId: null, theme: 'classic', businessFilter: { preset: 'all', from: '', to: '' }, operationalFilter: { preset: 'all', from: '', to: '' }, approvalsLimit: 20, businessEntriesLimit: 20, operationalEntriesLimit: 20, tellerEntriesLimit: 20, approvalsSection:'tellering', generatedJournals:{}, customerDirectorySearch: '' };
  state.ui.customerDirectorySearch = state.ui.customerDirectorySearch || '';
  if (state.ui.module && !MODULES[state.ui.module]) state.ui.module = null;
  if (state.ui.module && state.ui.tool && !(MODULES[state.ui.module]?.tools || []).includes(state.ui.tool)) state.ui.tool = null;
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
    const s = {
      staff: [
        { id:'st1', name:'Daniel Johnson', role:'customer_service', active:true },
        { id:'st2', name:'Mary Daniel', role:'teller', active:true },
        { id:'st3', name:'Francis Etta', role:'approving_officer', active:true },
        { id:'st4', name:'Admin Officer', role:'admin_officer', active:true }
      ],
      customers: [
        { id:'c1', accountNumber:'1000', oldAccountNumber:'A-221', name:'Emma Johnson', address:'14 Palm Street', nin:'12345678901', bvn:'2200114422', phone:'08012345678', balance:32000, photo:'', active:true, createdAt:new Date().toISOString(), transactions:[
          txObj('credit', 15000, 'Opening contribution', 'SYSTEM', 'system', null, 'customer', today()),
          txObj('credit', 17000, 'Cash contribution', 'SYSTEM', 'system', null, 'customer', today())
        ] },
        { id:'c2', accountNumber:'1001', oldAccountNumber:'A-222', name:'Uduak Peters', address:'Market Road', nin:'22345678901', bvn:'2200118899', phone:'08022223333', balance:6500, photo:'', active:true, createdAt:new Date().toISOString(), transactions:[
          txObj('credit', 6500, 'Savings credit', 'SYSTEM', 'system', null, 'customer', today())
        ] }
      ],
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
    s.operations.incomeAccounts.push({ id:'ia1', name:'Commission', accountNumber:'INC-2000', createdAt:new Date().toISOString() });
    s.operations.incomeAccounts.push({ id:'ia2', name:'Registration Fee', accountNumber:'INC-2001', createdAt:new Date().toISOString() });
    s.operations.incomeAccounts.push({ id:'ia3', name:'Security Fee', accountNumber:'INC-2002', createdAt:new Date().toISOString() });
    s.operations.incomeAccounts.push({ id:'ia4', name:'Passbook Sold', accountNumber:'INC-2003', createdAt:new Date().toISOString() });
    s.operations.expenseAccounts.push({ id:'ea1', name:'Transport Expense', accountNumber:'EXP-3000', createdAt:new Date().toISOString() });
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
    state.businessDate ||= today();
    ensureDefaultIncomeAccounts(state);
    state.dayClosures ||= [];
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
    return state.staff.find(s => s.id === state.activeStaffId) || state.staff[0] || null;
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
  function staffById(id){ return state.staff.find(s=>s.id===id) || null; }
  function customerName(id){ return state.customers.find(c=>c.id===id)?.name || ''; }
  function getStaffWalletCustomer(staffId){ const acc=ensureStaffAccount(staffId); return state.customers.find(c=>c.id===acc.linkedCustomerId) || null; }
  function ensureStaffWalletCustomer(staffId, sourceState=state){
    const st=(sourceState.staff||[]).find(x=>x.id===staffId); if(!st) return null;
    sourceState.customers ||= [];
    const existing=sourceState.customers.find(c=>c.staffId===staffId && c.accountType==='staff_wallet');
    if(existing) return existing;
    const idx=sourceState.customers.filter(c=>String(c.accountType||'')==='staff_wallet').length + 1;
    const c={ id: uid('c'), accountNumber: `${4000000 + idx}`, oldAccountNumber:'', name: st.name, address:'', nin:'', bvn:'', phone:'', photo:'', active:true, createdAt:new Date().toISOString(), transactions:[], staffId, accountType:'staff_wallet'};
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
  function canCloseBusinessDay(staff=currentStaff()){ return !!staff && ['admin_officer','approving_officer'].includes(staff.role); }

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
      'Commission': 'INC-2000',
      'Registration Fee': 'INC-2001',
      'Security Fee': 'INC-2002',
      'Passbook Sold': 'INC-2003'
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

  function hasPermission(tool, staff=currentStaff()) {
    if (!staff) return false;
    if (['check_balance','operational_accounts','my_balance','my_close_day'].includes(tool)) return true;
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
    const d = new Date(iso);
    return isNaN(d) ? iso : DATE_FMT.format(d);
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
    return state.customers.find(c => c.accountNumber === String(accountNumber || '').trim());
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
      save();
    }
    return result;
  }




  async function syncCodFromGateway(filters = {}) {
    if (!isSupabaseApprovalMode() || !gateway.cod?.listCodSubmissions) return defaultResultOk(state.cod || []);
    const result = await gateway.cod.listCodSubmissions(filters);
    if (result?.ok && Array.isArray(result.data)) {
      const existing = new Map((state.cod || []).map(item => [item.id, item]));
      result.data.forEach(item => {
        existing.set(item.id, Object.assign({}, existing.get(item.id) || {}, item, { staffName: staffName(item.staffId) || item.staffName || item.staffId }));
      });
      state.cod = Array.from(existing.values()).sort((a,b)=>new Date(b.submittedAt||b.resolvedAt||b.date)-new Date(a.submittedAt||a.resolvedAt||a.date));
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
      const existing = new Map((state.staff || []).map(st => [st.id, st]));
      result.data.forEach(item => {
        existing.set(item.id, Object.assign({}, existing.get(item.id) || {}, {
          id: item.id,
          name: item.fullName || item.name || item.staffId || '',
          role: item.roleCode || item.role || 'customer_service',
          active: item.isActive !== false,
          staffId: item.staffId || item.staff_code || '',
          branchId: item.branchId || null,
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
      state.customers = result.data.map(normalizeGatewayCustomerForState).filter(Boolean);
      normalizeStaffWalletAccounts();
      syncAllStaffWallets();
      recalcAllCustomerBalances();
      recalcAllTellerBalances();
      save();
    }
    return result;
  }

  async function syncAllSharedStateFromGateway() {
    await syncStaffFromGateway();
    await syncCustomersListFromGateway();
    await syncApprovalsFromGateway();
    await syncCodFromGateway();
    await syncDebtBalancesFromGateway();
    render();
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
    const refreshApprovals = debounceAsync(async () => { await syncApprovalsFromGateway(); render(); }, 150);
    const refreshCod = debounceAsync(async () => { await syncCodFromGateway(); await syncDebtBalancesFromGateway(); render(); }, 150);
    const refreshBalances = debounceAsync(async (payload) => {
      const row = payload?.new || payload?.old || {};
      if (row.customer_id) await syncCustomerFromGateway({ customerId: row.customer_id });
      else if (row.account_id && gateway.accounts?.getAccountByNumber) {
        const acct = await gateway.accounts.getAccountSummary(row.account_id);
        if (acct?.ok && acct.data?.accountNumber) await syncCustomerFromGateway({ accountNumber: acct.data.accountNumber });
      } else {
        await syncCustomersListFromGateway();
      }
      render();
    }, 150);
    const refreshCustomers = debounceAsync(async () => { await syncCustomersListFromGateway(); render(); }, 200);
    const refreshStaff = debounceAsync(async () => { await syncStaffFromGateway(); render(); }, 200);
    realtimeUnsub = gateway.__realtime.subscribe({
      approval: refreshApprovals,
      cod: refreshCod,
      debt: refreshCod,
      balance: refreshBalances,
      customer: refreshCustomers,
      staff: refreshStaff,
      onStatus: (status) => { state.__realtimeStatus = status; }
    });
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

  if (approvalRecord.type === 'account_opening') {
    return syncCustomersListFromGateway();
  }

  if (approvalRecord.type === 'customer_credit' || approvalRecord.type === 'customer_debit') {
    return syncCustomerFromGateway({
      customerId: approvalRecord.payload?.customerId,
      accountNumber: approvalRecord.payload?.accountNumber
    });
  }

  if (approvalRecord.type === 'customer_credit_journal' || approvalRecord.type === 'customer_debit_journal') {
    const rows = Array.isArray(approvalRecord.payload?.rows) ? approvalRecord.payload.rows : [];
    for (const row of rows) {
      await syncCustomerFromGateway({
        customerId: row.customerId,
        accountNumber: row.accountNumber
      });
    }
    return defaultResultOk(true);
  }

  if (approvalRecord.type === 'float_topup' || approvalRecord.type === 'float_declaration') {
    return syncCodFromGateway({
      staffId: approvalRecord.payload?.staffId,
      businessDate: approvalRecord.payload?.date
    });
  }

  if (approvalRecord.type === 'debt_repayment') {
    return syncDebtBalancesFromGateway();
  }

  return defaultResultOk(null);
}

  async function submitApprovalThroughGateway(type, payload, meta = {}) {
    if (!isSupabaseApprovalMode()) return defaultResultOk(createRequest(type, payload, meta));
    const staff = currentStaff();
    let result;
    if (type === 'account_opening' && gateway.customers?.submitAccountOpening) {
      result = await gateway.customers.submitAccountOpening({
        fullName: payload.name, phone: payload.phone, address: payload.address, nin: payload.nin, bvn: payload.bvn, photoRef: payload.photo || null, openedByStaffId: staff?.id || '', requestedByName: staff?.name || 'System'
      });
    } else if (type === 'account_maintenance' && gateway.customers?.submitAccountMaintenance) {
      result = await gateway.customers.submitAccountMaintenance({
        customerId: payload.customerId,
        updates: { ...payload.patch },
        requestedByStaffId: staff?.id || '',
        requestedByName: staff?.name || 'System'
      });
    } else if (type === 'account_reactivation' && gateway.customers?.submitAccountReactivation) {
      result = await gateway.customers.submitAccountReactivation({
        customerId: payload.customerId,
        requestedByStaffId: staff?.id || '',
        note: payload.note || '',
        requestedByName: staff?.name || 'System'
      });
    } else if ((type === 'customer_credit' || type === 'customer_debit') && gateway.accounts) {
      const fn = type === 'customer_credit' ? gateway.accounts.submitCredit : gateway.accounts.submitDebit;
      result = await fn({
        accountId: payload.customerId,
        amount: Number(payload.amount || 0),
        details: payload.details || '',
        requestedByStaffId: staff?.id || '',
        businessDate: payload.date,
        requestedByName: staff?.name || 'System',
        customerId: payload.customerId, customerName: payload.customerName, accountNumber: payload.accountNumber, receivedOrPaidBy: payload.receivedOrPaidBy, payoutSource: payload.payoutSource, staffId: payload.staffId, date: payload.date
      });
    } else if ((type === 'customer_credit_journal' || type === 'customer_debit_journal') && gateway.accounts?.submitJournalEntries) {
      result = await gateway.accounts.submitJournalEntries({
        entries: (payload.rows || []).map(row => ({ accountId: row.customerId, txType: type === 'customer_debit_journal' ? 'debit' : 'credit', amount: Number(row.amount || 0), details: row.details || '', customerId: row.customerId, customerName: row.customerName, accountNumber: row.accountNumber, receivedOrPaidBy: row.receivedOrPaidBy, payoutSource: row.payoutSource })),
        requestedByStaffId: staff?.id || '',
        requestedByName: staff?.name || 'System',
        businessDate: payload.date,
        staffId: payload.staffId,
        date: payload.date,
        openingFloat: payload.openingFloat,
        fieldNote: payload.fieldNote || null
      });
    } else if (gateway.approvals?.submitApprovalRequest) {
      result = await gateway.approvals.submitApprovalRequest({
        requestType: type,
        requestedByStaffId: staff?.id || '',
        requestedByName: staff?.name || 'System',
        payload
      });
    }
    if (!result?.ok) return result;
    await syncApprovalsFromGateway();
    pushAudit('request_created', `${type} by ${staff?.name || 'System'}</div>`);
    return result;
  }

  async function approveRequestRemote(id) {
    if (!isSupabaseApprovalMode()) { approveRequest(id); return defaultResultOk(true); }
    const staff = currentStaff();
    const result = await gateway.approvals.approveRequest({ requestId: id, approvedByStaffId: staff?.id || '', approvedByName: staff?.name || 'System' });
    if (result?.ok) {
      await syncApprovalsFromGateway();
      await syncApprovalEffectsFromGateway(result.data);
      pushAudit('request_approved', `${result.data?.type || 'request'} approved</div>`);
      render();
    }
    return result;
  }

  async function rejectRequestRemote(id) {
    if (!isSupabaseApprovalMode()) { rejectRequest(id); return defaultResultOk(true); }
    const staff = currentStaff();
    const result = await gateway.approvals.rejectRequest({ requestId: id, rejectedByStaffId: staff?.id || '', rejectedByName: staff?.name || 'System' });
    if (result?.ok) { await syncApprovalsFromGateway(); pushAudit('request_rejected', `${result.data?.type || 'request'} rejected</div>`); render(); }
    return result;
  }

  function defaultResultOk(data) { return { ok: true, data }; }

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
      case 'float_declaration': {
        if (!hasBaseOpeningBalanceForDate(req.payload.staffId, req.payload.date)) {
          addStaffEntry(req.payload.staffId, 'approved_float', req.payload.amount, req.payload.amount, `Approved form for ${req.payload.date}`, { floatDate: req.payload.date });
        }
        break;
      }
      case 'float_topup': {
        addStaffEntry(req.payload.staffId, 'approved_float_topup', req.payload.amount, req.payload.amount, `Approved float top-up for ${req.payload.staffName || 'staff'} on ${req.payload.date}`, { floatDate: req.payload.date });
        break;
      }
      case 'customer_credit': {
        const c = state.customers.find(x => x.id === req.payload.customerId);
        if (!c || isCustomerFrozen(c) || c.active === false) break;
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
          customerCreditAmount
        }));
        recalcCustomerBalance(c);
        addStaffEntry(req.payload.staffId, 'customer_credit', totalAmount, -totalAmount, `Customer credit ${c.accountNumber}`, { customerId: c.id, date: `${req.payload.date}T12:00:00.000Z`, chargeBreakdown, totalChargeAmount: totalCharges, chargeTraceId, customerCreditAmount });
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
              note: `${row.label} from ${c.accountNumber} • Trace ${chargeTraceId}`,
              date: `${req.payload.date}T12:00:00.000Z`,
              postedBy: req.requestedByName,
              approvedBy: currentStaff()?.name || '',
              traceId: chargeTraceId,
              sourceTransactionType: 'customer_credit'
            });
            state.businessExtras.unshift({
              date: `${req.payload.date}T12:00:00.000Z`,
              accountNumber: incomeAccount?.accountNumber || 'INC-2000',
              accountName: incomeAccount?.name || row.accountName || row.label,
              details: `${row.label} from ${c.accountNumber} • Trace ${chargeTraceId}`,
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
        const c = state.customers.find(x => x.id === req.payload.customerId);
        if (!c || isCustomerFrozen(c) || c.active === false) break;
        c.transactions.push(txObj('debit', req.payload.amount, req.payload.details, req.requestedByName, req.requestedBy, currentStaff()?.name || '', 'customer', req.payload.date, {
          receivedOrPaidBy: req.payload.receivedOrPaidBy,
          paymentMode: req.payload.paymentMode || req.payload.payoutSource || '',
          postedBy: req.requestedByName,
          approvedBy: currentStaff()?.name || ''
        }));
        recalcCustomerBalance(c);
        if (req.payload.payoutSource === 'teller') {
          addStaffEntry(req.payload.staffId, 'customer_debit', req.payload.amount, req.payload.amount, `Customer debit ${c.accountNumber}`, { customerId: c.id, date: `${req.payload.date}T12:00:00.000Z` });
        }
        break;
      }
      case 'customer_credit_journal': {
        (req.payload.rows || []).forEach(row => applyRequest({
          type:'customer_credit',
          payload:{...row, staffId:req.payload.staffId, date:req.payload.date},
          requestedByName:req.requestedByName,
          requestedBy:req.requestedBy
        }));
        break;
      }
      case 'customer_debit_journal': {
        (req.payload.rows || []).forEach(row => applyRequest({
          type:'customer_debit',
          payload:{...row, staffId:req.payload.staffId, date:req.payload.date},
          requestedByName:req.requestedByName,
          requestedBy:req.requestedBy
        }));
        break;
      }
      case 'operational_entry': {
        state.operations.entries.unshift({
          id: uid('op'),
          kind: req.payload.kind,
          accountId: req.payload.accountId,
          accountName: req.payload.accountName,
          amount: req.payload.amount,
          note: req.payload.note,
          date: `${req.payload.date}T12:00:00.000Z`,
          postedBy: req.requestedByName,
          approvedBy: currentStaff()?.name || ''
        });
        break;
      }
      case 'create_operational_account': {
        const dest = req.payload.category === 'income' ? state.operations.incomeAccounts : state.operations.expenseAccounts;
        dest.push({ id: uid('oa'), name: req.payload.name, accountNumber: req.payload.accountNumber, createdAt: new Date().toISOString() });
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
        if (wallet) { wallet.transactions.push(txObj('credit', req.payload.amount, req.payload.note || 'Wallet funded', req.requestedByName, req.requestedBy, currentStaff()?.name || '', 'staff_wallet', businessDate())); recalcCustomerBalance(wallet); acc.walletBalance = Number(wallet.balance||0); }
        addStaffEntry(req.payload.staffId, 'wallet_fund', req.payload.amount, 0, req.payload.note || 'Wallet funded');
        break;
      }
      case 'debt_repayment': {
        const acc = ensureStaffAccount(req.payload.staffId); const wallet=getStaffWalletCustomer(req.payload.staffId);
        if (wallet) { wallet.transactions.push(txObj('debit', req.payload.amount, req.payload.note || 'Debt repaid', req.requestedByName, req.requestedBy, currentStaff()?.name || '', 'staff_wallet', businessDate())); recalcCustomerBalance(wallet); acc.walletBalance = Number(wallet.balance||0); }
        acc.debtBalance = Math.max(0, Number(acc.debtBalance||0) - Number(req.payload.amount||0));
        addStaffEntry(req.payload.staffId, 'debt_repayment', req.payload.amount, 0, req.payload.note || 'Debt repaid');
        state.businessExtras ||= []; state.businessExtras.unshift({ date:new Date().toISOString(), accountNumber: acc.accountNumber, details:'Staff debt repayment', kind:'credit', amount:Number(req.payload.amount||0), balanceAfter:0, receivedOrPaidBy: req.requestedByName, postedBy: currentStaff()?.name || req.requestedByName });
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
    if (nm && customer && customerStatusLabel(customer) === 'Frozen') nm.innerHTML = `${customer.name} <span class="badge rejected">Frozen</span>`;
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
    const staffSel = byId('staffSelect');
    staffSel.innerHTML = state.staff.map(s => `<option value="${s.id}">${s.name} — ${ROLE_LABELS[s.role] || s.role}</option>`).join('');
    staffSel.value = state.activeStaffId;
    staffSel.onchange = () => {
      state.activeStaffId = staffSel.value;
      state.ui.module = null;
      state.ui.tool = null;
      resetJournalUiState();
      save();
      render();
    };
    byId('btnTodayFloat').onclick = openFloatModal;
    byId('btnCOD').onclick = () => canCloseBusinessDay() ? confirmAction(`Close business date ${businessDate()}? This will open ${nextDate(businessDate())}.`, openCODModal) : showToast('Only Approval Officer or Admin can close day');
    byId('btnCOD').disabled = !canCloseBusinessDay();
    byId('btnAudit').onclick = openAuditModal;
    const themeBtn = byId('btnThemeCycle');
    if (themeBtn) {
      themeBtn.textContent = `◐ ${THEME_LABELS[state.ui.theme || 'classic'] || 'Classic'}`;
      themeBtn.onclick = () => {
        const curr = state.ui.theme || 'classic';
        const idx = THEMES.indexOf(curr);
        const next = THEMES[(idx + 1) % THEMES.length];
        applyTheme(next, true);
        showToast(`Theme: ${THEME_LABELS[next]}</div>`);
      };
    }
    byId('globalNameSearch').oninput = (e) => {
      const results = searchCustomersByName(e.target.value);
      if (!e.target.value.trim()) return;
      openCustomerSearchModal(results);
    };
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

  function smoothScrollToOpenedSegment(selector) {
    requestAnimationFrame(() => {
      const target = (selector && q(selector)) || q('.workspace-card');
      target?.scrollIntoView({ behavior:'smooth', block:'start' });
    });
  }

  function renderModules() {
    const current = state.ui.module;
    const moduleOrder = ['administration','balances','tellering','customer_service','approvals'];
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
          ${toolBtn('my_balance')}
          ${toolBtn('opening_balance')}
          ${toolBtn('my_close_day')}
          ${toolBtn('operational_accounts')}
        </div>`;
      }
      return module.tools.map(t => `<button class="tool-tab ${state.ui.tool===t?'active':''}" data-tool="${t}" ${hasPermission(t)?'':'disabled'}>${TOOL_LABELS[t]}</button>`).join('');
    };
    const tabs = `<div class="workspace-switcher"><div class="tool-tabs vertical-tool-tabs ${state.ui.module==='tellering'?'tellering-tool-tabs':''}">${renderToolButtons()}</div><div class="workspace-tool-body">${state.ui.tool ? renderTool(state.ui.tool) : `<div class="tool-empty-state"><div class="tool-empty-title">${module.title}</div><div class="tool-empty-note">Select a heading to open that work area.</div></div>`}</div></div>`;
    byId('workspace').innerHTML = tabs;
    qq('.tool-tab').forEach(btn => btn.onclick = () => {
      const nextTool = btn.dataset.tool;
      if (state.ui.tool === nextTool) {
        state.ui.tool = null;
      } else {
        state.ui.tool = nextTool;
        if (nextTool === 'approval_customer_service') state.ui.approvalsSection = 'customer_service';
        if (nextTool === 'approval_tellering') state.ui.approvalsSection = 'tellering';
        if (nextTool === 'approval_others') state.ui.approvalsSection = 'others';
      }
      if (state.ui.tool === 'check_balance') state.ui.checkBalanceLoaded = false;
      state.ui.modalToggleTool = state.ui.tool && ['my_balance','opening_balance','my_close_day','central_close_day'].includes(state.ui.tool) ? state.ui.tool : null;
      save();
      renderWorkspace();
      if (nextTool === 'my_balance' && state.ui.tool === 'my_balance') openMyBalanceModal();
      if (nextTool === 'opening_balance' && state.ui.tool === 'opening_balance') openFloatModal();
      if (nextTool === 'my_close_day' && state.ui.tool === 'my_close_day') openMyCODModal();
      if (nextTool === 'central_close_day' && state.ui.tool === 'central_close_day') openCODModal();
      if (['my_balance','opening_balance','my_close_day','central_close_day'].includes(nextTool)) return;
      if (['approval_customer_service','approval_tellering','approval_others'].includes(nextTool) && state.ui.tool === nextTool) {
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
      case 'credit': return renderJournalTool('credit');
      case 'debit': return renderJournalTool('debit');
      case 'my_balance': return `<div class="tool-empty-state"><div class="tool-empty-title">My Balance</div><div class="tool-empty-note">Balance details open in a modal when this heading is selected.</div></div>`;
      case 'opening_balance': return `<div class="tool-empty-state"><div class="tool-empty-title">Form</div><div class="tool-empty-note">Form opens in a modal when this heading is selected.</div></div>`;
      case 'my_close_day': return `<div class="tool-empty-state"><div class="tool-empty-title">My Close of Day</div><div class="tool-empty-note">Close-of-day details open in a modal when this heading is selected.</div></div>`;
      case 'central_close_day': return `<div class="tool-empty-state"><div class="tool-empty-title">Central Close of Day</div><div class="tool-empty-note">Central close-of-day opens in a modal when this heading is selected.</div></div>`;
      case 'approval_customer_service':
      case 'approval_tellering':
      case 'approval_others':
      case 'approval_queue': return renderApprovals();
      case 'permissions': return renderPermissions();
      case 'operational_posting': return renderOperationalPosting();
      case 'operational_accounts': return renderOperationalAccounts();
      case 'staff_directory': return renderStaffDirectory();
      case 'customer_directory': return renderCustomerDirectory();
      case 'business_balance': return renderBusinessBalance();
      case 'operational_balance': return renderOperationalBalance();
      case 'teller_balances': return renderTellerBalances();
      default: return '<div class="note">Tool not found.</div>';
    }
  }

  function renderCheckBalance() {
    return `
      <div class="form-card cs2-card check-balance-card">
        <div class="cs2-title">Check Balance</div>
        <div class="cs2-stack">
          <div class="cs2-row">
            <div class="cs2-label">Account Number</div>
            <div class="cs2-input-wrap cs2-short"><input id="lookupAcc" class="entry-input cs2-input" maxlength="4" inputmode="numeric"></div>
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
          </div>
          <div class="sheet-photo-row hidden" id="checkBalancePhotoRow">
            <div class="photo-box inline-photo" data-fill="photo"><span>No Photo</span></div>
          </div>
        </div>
      </div>`;
  }

  function renderAccountOpening() {
    return `
      <div class="form-card cs2-card opening-card">
        <div class="cs2-title">Account Opening</div>
        <div class="cs2-stack">
          <div class="cs2-row">
            <div class="cs2-label">Account Name</div>
            <div class="cs2-input-wrap cs2-wide"><input id="openName" class="entry-input cs2-input"></div>
          </div>
          <div class="cs2-row">
            <div class="cs2-label">Address</div>
            <div class="cs2-input-wrap cs2-wide"><input id="openAddress" class="entry-input cs2-input"></div>
          </div>
          <div class="cs2-row">
            <div class="cs2-label">Phone Number</div>
            <div class="cs2-input-wrap cs2-medium"><input id="openPhone" class="entry-input cs2-input digit-11-input" inputmode="numeric"></div>
          </div>
          <div class="cs2-row">
            <div class="cs2-label">NIN</div>
            <div class="cs2-input-wrap cs2-medium"><input id="openNin" class="entry-input cs2-input digit-11-input" inputmode="numeric"></div>
          </div>
          <div class="cs2-row">
            <div class="cs2-label">BVN</div>
            <div class="cs2-input-wrap cs2-medium"><input id="openBvn" class="entry-input cs2-input digit-11-input" inputmode="numeric"></div>
          </div>
          <div class="cs2-row">
            <div class="cs2-label">Old A/N</div>
            <div class="cs2-input-wrap cs2-short"><input id="openOldAccount" class="entry-input cs2-input" maxlength="4" inputmode="numeric"></div>
          </div>
          <div class="cs2-upload-row">
            <button id="openPhotoBtn" type="button" class="sheet-btn cs2-btn cs2-btn-ghost">Photo Upload</button>
            <input id="openPhoto" class="entry-input cs-sheet-input hidden-photo-input" type="file" accept="image/*">
            <div id="openPhotoStatus" class="cs2-note-box">No photo selected</div>
            
          </div>
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
    return `
      <div class="form-card cs2-card ${isReactivation ? 'reactivation-card' : 'maintenance-card'}">
        <div class="cs2-title">${isReactivation ? 'Account Reactivation' : 'Account Maintenance'}</div>
        <div class="cs2-stack">
          <div class="cs2-row">
            <div class="cs2-label">Account Number</div>
            <div class="cs2-input-wrap cs2-short"><input id="${prefix}Acc" class="entry-input cs2-input" maxlength="4" inputmode="numeric"></div>
            <button id="${prefix}Search" class="sheet-btn cs2-btn cs2-btn-solid">Search</button>
          </div>
          <div class="cs2-row">
            <div class="cs2-label">Account Name</div>
            <div class="cs2-input-wrap ${isReactivation ? 'cs2-wide' : 'cs2-name-narrow'}"><input id="${prefix}Name" class="entry-input cs2-input cs-detail-input"></div>
          </div>
          ${isReactivation ? '' : `<div class="cs2-row"><div class="cs2-label">Address</div><div class="cs2-input-wrap cs2-name-narrow"><input id="${prefix}Address" class="entry-input cs2-input cs-detail-input"></div></div>`}
          ${isReactivation ? '' : `<div class="cs2-row"><div class="cs2-label">Phone Number</div><div class="cs2-input-wrap cs2-medium"><input id="${prefix}Phone" class="entry-input cs2-input cs-detail-input digit-11-input" inputmode="numeric"></div></div>`}
          ${isReactivation ? '' : `<div class="cs2-row"><div class="cs2-label">NIN</div><div class="cs2-input-wrap cs2-medium"><input id="${prefix}Nin" class="entry-input cs2-input cs-detail-input digit-11-input" inputmode="numeric"></div></div>`}
          ${isReactivation ? '' : `<div class="cs2-row"><div class="cs2-label">BVN</div><div class="cs2-input-wrap cs2-medium"><input id="${prefix}Bvn" class="entry-input cs2-input cs-detail-input digit-11-input" inputmode="numeric"></div></div>`}
          ${isReactivation ? '' : `<div class="cs2-row"><div class="cs2-label">Old A/N</div><div class="cs2-input-wrap cs2-short"><input id="${prefix}OldAccount" class="entry-input cs2-input cs-detail-input" maxlength="4" inputmode="numeric"></div></div>`}
          <div class="cs2-footer">
            <div class="cs2-status">Account Name: <strong id="${prefix}DisplayName">—</strong> &nbsp;&nbsp; Phone Number: <strong id="${prefix}DisplayPhone">—</strong> &nbsp;&nbsp; Current Status: <strong id="${prefix}DisplayStatus">—</strong></div>
            <div class="cs2-hint">${isReactivation ? 'Search account, confirm details, and submit reactivation.' : 'Search first, update details, then save for approval.'}</div>
          </div>
          <div class="cs2-button-row">
            <button id="${prefix}Edit" class="sheet-btn cs2-btn cs2-btn-ghost">Edit</button>
            <button id="${prefix}Submit" class="sheet-btn cs2-btn ${isReactivation ? 'cs2-btn-solid' : 'cs2-btn-ghost'}">${btnLabel}</button>
          </div>
        </div>
      </div>`;
  }

  function renderAccountStatement() {

    return `
      <div class="stack">
        <div class="form-card">
          <h3>Account Statement</h3>
          <div class="form-grid three account-statement-filter-grid polished-statement-grid">
            <div class="field stmt-field stmt-acc-field"><label>Account Number</label><input id="stmtAcc" class="entry-input stmt-acc-input" inputmode="numeric" maxlength="4"></div>
            <div class="field stmt-field stmt-date-field"><label>From Date</label><input id="stmtFrom" class="entry-input stmt-date-input polished-date-input" type="date"></div>
            <div class="field stmt-field stmt-date-field"><label>To Date</label><input id="stmtTo" class="entry-input stmt-date-input polished-date-input" type="date"></div>
          </div>
          <div class="action-row compact-action-row"><button id="stmtGenerate" class="tiny-btn">Generate Statement</button><button class="secondary tiny-btn" id="stmtPrintBtn">Print Statement</button></div>
        </div>
        <div id="statementArea"></div>
      </div>`;
  }

  function renderJournalTool(kind) {
    const title = kind === 'credit' ? 'Credit' : 'Debit';
    const st = currentStaff();
    const opening = getOpeningBalanceForDate(st?.id, businessDate());
    const running = currentFloatAvailable(st?.id, businessDate());
    state.ui.generatedJournals ||= {};
    state.ui.collapsedJournals ||= {};
    const journalKey = `${st?.id || 'staff'}:${businessDate()}:${kind}`;
    const journalVisible = !!state.ui.generatedJournals[journalKey];
    const journalCollapsed = !!state.ui.collapsedJournals[journalKey];
    return `
      <div class="tellering-stack">
        <div class="tellering-sheet journal-sheet standalone-posting-sheet">
          <div class="sheet-head-row single-head">
            <div>
              <div class="sheet-super">TELLERING</div>
              <div class="sheet-title">${title}</div>
            </div>
          </div>
          <div class="posting-modal-rows polished-posting-modal">
            <div class="posting-row posting-row-top">
              <div class="posting-row-left">
                <div class="posting-inline-group posting-inline-account">
                  <label class="sheet-label posting-label-account" for="txAcc">Account Number</label>
                  <input id="txAcc" class="entry-input sheet-input short-code" maxlength="4" inputmode="numeric" value="${escapeHtml(String(state.ui.txAccDraft ?? getSelectedCustomer()?.accountNumber ?? ''))}" />
                  <button id="txSearch" class="sheet-btn tiny-btn ultra-compact-btn">Search</button>
                </div>
              </div>
              <div class="posting-kpis compact-posting-kpis">
                <div class="mini-kpi small"><span class="mini-kpi-label">Form</span><span class="mini-kpi-value">${money(opening)}</span></div>
                <div class="mini-kpi small"><span class="mini-kpi-label">Remaining Balance</span><span class="mini-kpi-value" id="postingRunningFloat">${money(Math.max(0, running))}</span></div>
                <div class="mini-kpi small"><span class="mini-kpi-label">Variance</span><span class="mini-kpi-value balance-negative" id="postingVariance">${money(Math.max(0, -running))}</span></div>
              </div>
            </div>

            <div class="posting-row posting-row-name">
              <label class="sheet-label posting-label-name" for="txName">Account Name</label>
              <div class="display-field value-wide" id="txName">—</div>
            </div>

            <div class="posting-row posting-row-amount">
              <label class="sheet-label amount-primary-label" for="txAmount">Amount</label>
              <input id="txAmount" class="entry-input sheet-input medium-amt" type="number" />
              <button id="txPostSingle" class="sheet-btn secondary tiny-btn ultra-compact-btn">Post</button>
              ${journalVisible ? '' : `<button id="txJournalAdd" class="sheet-btn secondary tiny-btn ultra-compact-btn">Generate Journal</button>`}
            </div>
            ${kind === 'credit' ? `<div class="posting-row posting-row-commission-toggle subtle-commission-toggle-row"><label class="commission-toggle-chip"><input id="txApplyCharges" type="checkbox"> <span>Apply Charges</span></label></div><div class="posting-row posting-row-commission subtle-commission-row hidden" id="txChargesRow"><div class="charges-grid">${CHARGE_DEFS.map(def => `<div class="charge-item"><label class="charge-toggle-chip"><input type="checkbox" data-charge-check="${def.key}" data-charge-scope="single"> <span>${def.label}</span></label><input data-charge-input="${def.key}" data-charge-scope="single" class="entry-input sheet-input commission-input hidden" type="number" /></div>`).join('')}</div><div class="commission-mini-field"><label class="sheet-label">Total Charges</label><div class="display-field commission-display" id="txTotalCharges">${money(0)}</div></div><div class="commission-mini-field"><label class="sheet-label">To Customer Account</label><div class="display-field commission-display" id="txCustomerGets">${money(0)}</div></div></div>` : ''}
          </div>
        </div>
        <div class="tellering-inline-meta form-card compact-left tellering-entry-card">
          <div class="form-grid tellering-meta-line compact-fields-inline">
            <div class="field"><label>${kind === 'credit' ? 'Received By' : 'Paid To'}</label><input id="txCounterparty" class="entry-input"></div>
            <div class="field"><label>${kind === 'credit' ? 'Mode' : 'Payout Source'}</label><div class="tx-mode-toggle inline-mode-toggle"><label class="tx-toggle-pill"><input type="radio" name="txMode" value="cash" checked> <span>Cash</span></label><label class="tx-toggle-pill"><input type="radio" name="txMode" value="transfer"> <span>Transfer</span></label></div></div>
            <div class="field"><label>Business Date</label><div class="display-field">${businessDate()}</div></div>
            <div class="field"><label>Details</label><input id="txDetails" class="entry-input"></div>
          </div>
        </div>
        <div class="w-full flex justify-center journal-center-wrap ${journalVisible ? '' : 'hidden'}" id="journalPaneWrap">
        <div class="journal-wrapper">
        <div class="journal-pane form-card spacious-journal-pane standalone-journal-pane" id="journalPane">
          <div class="journal-pane-head compact-journal-head">
            <h3>Journal Generated</h3>
            <div class="journal-pane-actions ${journalCollapsed ? "" : "journal-pane-actions-hidden"}"><button id="journalCollapseTopBtn" class="secondary">${journalCollapsed ? 'Expand Journal' : 'Collapse Journal'}</button></div>
          </div>
          <div class="journal-pane-body ${journalCollapsed ? 'hidden' : ''}" id="journalPaneBody">
            <div class="table-wrap journal-table-wrap"><table class="table journal-table"><thead><tr><th>S/N</th><th>Account Name</th><th>Account Number</th><th>Form</th><th>Amount</th><th>Remaining Balance</th><th>Variance</th><th>Action</th></tr></thead><tbody id="journalRows"></tbody></table></div>
            <div class="journal-entry-shell journal-entry-foot">
              <div class="journal-entry-top row-one">
                <div class="journal-cell"><input id="journalAcc" class="entry-input" maxlength="4"><div class="journal-cell-label">Account Number</div></div>
                <div class="journal-cell grow"><div class="display-field" id="journalName">—</div><div class="journal-cell-label">Account Name</div></div>
                <div class="journal-cell"><input id="journalAmount" class="entry-input" type="number"><div class="journal-cell-label">Amount</div></div>
              </div>
              <div class="journal-entry-top row-two">
                <div class="journal-cell grow"><input id="journalCounterparty" class="entry-input"><div class="journal-cell-label">${kind === 'credit' ? 'Received By' : 'Paid To'}</div></div>
                <div class="journal-cell grow"><input id="journalDetails" class="entry-input"><div class="journal-cell-label">Details</div></div>
                <div class="journal-cell action"><button id="journalAddRow" class="sheet-btn">Add to Journal</button></div>
                <div class="journal-cell action"><button id="journalCollapseBtn" class="secondary">${journalCollapsed ? 'Expand Journal' : 'Collapse Journal'}</button></div>
              </div>
              ${kind === 'credit' ? `<div class="journal-entry-top row-three commission-journal-row subtle-commission-toggle-row"><div class="journal-cell commission-toggle-cell"><label class="commission-toggle-chip commission-toggle-chip-mini"><input id="journalApplyCharges" type="checkbox"> <span>Apply Charges</span></label></div></div><div class="journal-entry-top row-three commission-journal-row subtle-commission-row hidden" id="journalChargesRow"><div class="charges-grid journal-charges-grid">${CHARGE_DEFS.map(def => `<div class="charge-item"><label class="charge-toggle-chip"><input type="checkbox" data-charge-check="${def.key}" data-charge-scope="journal"> <span>${def.label}</span></label><input data-charge-input="${def.key}" data-charge-scope="journal" class="entry-input commission-input hidden" type="number"></div>`).join('')}</div><div class="journal-cell commission-mini-field"><div class="display-field commission-display" id="journalTotalCharges">${money(0)}</div><div class="journal-cell-label">Total Charges</div></div><div class="journal-cell commission-mini-field grow"><div class="display-field commission-display" id="journalCustomerGets">${money(0)}</div><div class="journal-cell-label">To Customer Account</div></div></div>` : ''}
            </div>
            <div class="action-row journal-submit-row"><button id="journalSubmit">Submit Journal</button><button class="secondary" id="journalClear">Clear Journal</button><label class="sheet-btn secondary file-trigger-btn" for="journalFieldNoteInput">Upload Field Note</label><input id="journalFieldNoteInput" type="file" accept="image/*,.pdf,application/pdf" class="visually-hidden-file-input"><span class="compact-file-name" id="journalFieldNoteName">No file selected</span></div>
          </div>
        </div>
        </div>
        </div>
      </div>`;
  }

  function renderApprovals() {
    state.ui.codAdminDate ||= businessDate();
    const categories = { customer_service: ['account_opening','account_maintenance','account_reactivation'], tellering: ['customer_credit','customer_debit','customer_credit_journal','customer_debit_journal','float_declaration'], others: ['float_topup','operational_entry','create_operational_account','close_of_day','temp_grant','wallet_fund','debt_repayment'] };
    const currentSection = state.ui.approvalsSection || 'tellering';
    const allRows = state.approvals.filter(a => categories[currentSection].includes(a.type));
    const limit = state.ui.approvalsLimit || 20;
    const approvals = allRows.slice(0, limit);
    const rows = approvals.map((a, i) => `<tr><td>${i+1}</td><td>${prettyApprovalType(a.type)}</td><td>${approvalSubmittedBy(a)}</td><td>${approvalDetails(a)}</td><td>${fmtDate(a.requestedAt)}</td><td><span class="badge ${a.status}">${a.status}</span></td><td>${a.type.includes('_journal') ? `<div class="stack-actions"><button type="button" data-inspect-journal="${a.id}" class="secondary">Inspect</button>${a.status === 'pending' ? `<div class="inline-actions"><button type="button" data-approve="${a.id}" class="success">Approve</button><button type="button" data-reject="${a.id}" class="danger">Reject</button></div>`:''}</div>`:''}${['account_opening','account_maintenance','account_reactivation'].includes(a.type) ? `<button type="button" data-inspect-request="${a.id}" class="secondary">View</button> `:''}${!a.type.includes('_journal') ? (a.status === 'pending' ? `<div class="inline-actions"><button type="button" data-approve="${a.id}" class="success">Approve</button><button type="button" data-reject="${a.id}" class="danger">Reject</button></div>` : a.approvedBy || '—') : ''}</td></tr>`).join('');
    const codRows=(state.cod||[]).filter(c=>c.status==='flagged').map((c,i)=>{
      const creditCash = Number(c.totalCreditCash ?? approvedCreditTotalForDateByMode(c.staffId, c.date, 'cash'));
      const creditTransfer = Number(c.totalCreditTransfer ?? approvedCreditTotalForDateByMode(c.staffId, c.date, 'transfer'));
      const debitCash = Number(c.totalDebitCash ?? approvedDebitTotalForDateByMode(c.staffId, c.date, 'cash'));
      const debitTransfer = Number(c.totalDebitTransfer ?? approvedDebitTotalForDateByMode(c.staffId, c.date, 'transfer'));
      const formAmount = Number(c.formAmount ?? c.openingBalance ?? getOpeningBalanceForDate(c.staffId, c.date));
      const remaining = Number(c.remainingBalance ?? c.runningFloat ?? currentFloatAvailable(c.staffId, c.date));
      const variance = Number(c.variance ?? Math.max(0, -remaining));
      const overdraw = Number(c.overdraw ?? Math.max(0, -remaining));
      return `<tr><td>${i+1}</td><td>${fmtDate(c.date)}</td><td>${c.staffName}</td><td>${money(formAmount)}</td><td>${money(creditCash)}</td><td>${money(creditTransfer)}</td><td>${money(debitCash)}</td><td>${money(debitTransfer)}</td><td class="${remaining<0?'balance-negative':''}">${money(remaining)}</td><td class="${variance>0?'balance-negative':''}">${money(variance)}</td><td class="${overdraw>0?'balance-negative':''}">${money(overdraw)}</td><td>${c.resolutionNote || c.note || '—'}</td><td>${(canCloseBusinessDay())?`<button data-cod-resolve="${c.id}" class="warning">Resolve</button>`:'Awaiting Resolution'}</td></tr>`;
    }).join('');
    const selected = state.ui.codAdminDate;
    const codStatusRows = state.staff.filter(s => (DEFAULT_PERMS[s.role]||[]).includes('credit') || (DEFAULT_PERMS[s.role]||[]).includes('debit')).map((s,i)=>{ const rec=(state.cod||[]).find(c=>c.staffId===s.id && c.date===selected); const status=rec?(rec.status==='resolved'?'Resolved':rec.status==='flagged'?'Flagged':'Submitted'):'Missing'; const formAmount = rec ? Number(rec.formAmount ?? rec.openingBalance ?? getOpeningBalanceForDate(rec.staffId, rec.date)) : null; const remaining = rec ? Number(rec.remainingBalance ?? rec.runningFloat ?? currentFloatAvailable(rec.staffId, rec.date)) : null; return `<tr><td>${i+1}</td><td>${s.name}</td><td>${ROLE_LABELS[s.role]||s.role}</td><td>${status}</td><td>${rec?money(formAmount):'—'}</td><td>${rec?money(remaining):'—'}</td></tr>`; }).join('');
    const moreLess = `<div class="action-row">${allRows.length > limit ? `<button id="approvalsMore" class="secondary">Show More</button>`:''}${limit > 20 ? `<button id="approvalsLess" class="secondary">Show Less</button>`:''}</div>`;
    return `<div class="stack">${codRows?`<div class="table-card"><h3>COD Resolution Queue</h3><div class="table-wrap"><table class="table"><thead><tr><th>S/N</th><th>Date</th><th>Staff</th><th>Form</th><th>Credit Cash</th><th>Credit Transfer</th><th>Debit Cash</th><th>Debit Transfer</th><th>Remaining Balance</th><th>Variance</th><th>Overdraw</th><th>Note</th><th>Action</th></tr></thead><tbody>${codRows}</tbody></table></div></div>`:''}<div class="approvals-top-controls"><div class="action-row approvals-central-cod-row">${hasPermission('central_close_day')?'<button id="approvalsCentralCloseDayBtn">Central Close of Day</button>':''}</div><div class="tool-tabs approvals-sections" id="approvalsSectionTabs">${[['customer_service','Customer Service'],['tellering','Teller'],['others','Others']].map(([k,l])=>`<button class="tool-tab ${currentSection===k?'active':''}" data-approval-section="${k}">${l}</button>`).join('')}</div></div><div class="table-card" id="approvalsQueueCard"><div class="action-row" style="justify-content:space-between;align-items:center"><h3>Approval Queue</h3></div><div class="table-wrap"><table class="table"><thead><tr><th>S/N</th><th>Request</th><th>Submitted By</th><th>Details</th><th>Date</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="muted">No requests yet</td></tr>'}</tbody></table></div>${moreLess}</div>${canCloseBusinessDay()?`<div class="table-card"><h3>COD Daily Submission Status</h3><div class="action-inline"><div class="inline-field compact"><span>COD Date</span><input type="date" id="codAdminDate" value="${selected}"></div></div><div class="table-wrap"><table class="table"><thead><tr><th>S/N</th><th>Staff</th><th>Office</th><th>Status</th><th>Form</th><th>Remaining Balance</th></tr></thead><tbody>${codStatusRows}</tbody></table></div></div>`:''}</div>`;
  }

  function approvalSubmittedBy(a) {
    const p = a.payload || {};
    const staffId = p.staffId || a.requestedBy;
    const staff = (state.staff || []).find(s => s.id === staffId) || {};
    const roleLabel = ROLE_LABELS[staff.role] || staff.role || '';
    const name = a.requestedByName || staffName(staffId);
    if (a.type === 'customer_credit_journal' || a.type === 'customer_debit_journal') return `${name} • ${roleLabel || 'Staff'} • Journal`;
    return `${name} • ${roleLabel || 'Staff'}`;
  }
  function approvalDetails(a) {
    const p = a.payload || {};
    if (a.type === 'customer_credit') return `${money(p.amount)} to ${customerName(p.customerId) || p.accountNumber}${chargeSummaryText(p)}${p.details ? ' • ' + p.details : ''}`;
    if (a.type === 'customer_debit') return `${money(p.amount)} from ${customerName(p.customerId) || p.accountNumber}${p.details ? ' • ' + p.details : ''}`;
    if (a.type === 'customer_credit_journal' || a.type === 'customer_debit_journal') { const rows = p.rows || p.entries || []; const total = rows.reduce((s,r)=>s+Number(r.amount||0),0); const totalCharges = rows.reduce((s,r)=>s+getTotalChargeAmount(r),0); const attachmentTag = p.fieldNote ? ' • Note attached' : ''; const chargeTag = a.type === 'customer_credit_journal' && totalCharges > 0 ? ` • Charges ${money(totalCharges)}` : ''; return `${rows.length} item${rows.length===1?'':'s'} • Total ${money(total)}${chargeTag}${attachmentTag}`; }
    if (a.type === 'wallet_fund') return `${staffName(p.staffId)} • Wallet fund • ${money(p.amount)}`;
    if (a.type === 'debt_repayment') return `${staffName(p.staffId)} • Debt repayment • ${money(p.amount)}`;
    return requestSummary(a);
  }

  function prettyApprovalType(type) {
    return {
      account_opening:'Account Opening', account_maintenance:'Account Maintenance', account_reactivation:'Account Reactivation',
      customer_credit:'Credit', customer_debit:'Debit', customer_credit_journal:'Credit Journal', customer_debit_journal:'Debit Journal', float_declaration:'Form', float_topup:'Float Top-Up', operational_entry:'Operational Entry',
      create_operational_account:'Operational Account', close_of_day:'Close of Day', temp_grant:'Temporary Grant'
    }[type] || type;
  }

  function requestSummary(a) {
    const p = a.payload || {};
    if (a.type === 'float_declaration') return `${money(p.amount)} for ${p.date}`;
    if (a.type === 'float_topup') return `${money(p.amount)} to ${p.staffName || 'staff'} for ${p.date}`;
    if (a.type === 'customer_credit' || a.type === 'customer_debit') return `${p.accountNumber} • ${money(p.amount)}${a.type === 'customer_credit' ? chargeSummaryText(p) : ''}`;
    if (a.type === 'account_opening') return `${p.name} • Phone ${p.phone || '—'} • NIN ${p.nin || '—'} • BVN ${p.bvn || '—'}`;
    if (a.type === 'account_maintenance') return `${p.accountNumber} • update`; 
    if (a.type === 'account_reactivation') return `${p.accountNumber} • reactivate`; 
    if (a.type === 'operational_entry') return `${p.accountName} • ${money(p.amount)}`;
    if (a.type === 'create_operational_account') return `${p.category} • ${p.name}`;
    if (a.type === 'close_of_day') return `${p.staffName} • ${p.date} • Form ${money(p.formAmount ?? p.openingBalance ?? 0)} • Remaining ${money(p.remainingBalance ?? p.runningFloat ?? 0)}`;
    if (a.type === 'temp_grant') return `${staffName(p.staffId)} • ${TOOL_LABELS[p.tool]} = ${p.enabled ? 'ON' : 'OFF'}`;
    if (a.type === 'wallet_fund') return `${staffName(p.staffId)} • Wallet fund • ${money(p.amount)}`;
    if (a.type === 'debt_repayment') return `${staffName(p.staffId)} • Debt repayment • ${money(p.amount)}`;
    return '—';
  }

  function normalizeCommissionAmount(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  function openJournalApprovalModal(reqId){
    const req = state.approvals.find(r => String(r?.id) === String(reqId)); if(!req) return;
    const rows = req.payload?.rows || req.payload?.entries || [];
    const total = rows.reduce((s,r)=>s+Number(r.amount||0),0);
    const totalCharges = rows.reduce((s,r)=>s+getTotalChargeAmount(r),0);
    const opening = getOpeningBalanceForDate(req.payload?.staffId, req.payload?.date || req.payload?.businessDate);
    const fieldNote = req.payload?.fieldNote || null;
    let running = opening;
    const bodyRows = rows.map((r,i)=>{ const commission = normalizeCommissionAmount(r.amount, r.commissionAmount); const customerGets = getCustomerCreditAmount(r); running -= Number(r.amount||0); const chargeMeta = getTotalChargeAmount(r) > 0 ? `<div class="journal-inline-meta">${chargeInlineMeta(r)}</div>` : ''; return `<tr><td>${i+1}</td><td>${escapeHtml(r.customerName || '—')}${chargeMeta}</td><td>${escapeHtml(r.accountNumber || '—')}</td><td>${money(r.amount)}</td><td class="${running<0?'balance-negative':''}">${money(running)}</td></tr>`; }).join('');
    const fieldNoteBlock = fieldNote?.dataUrl ? `<div class="journal-attachment-review"><div class="label">Field Note</div><div class="journal-attachment-card"><div class="journal-attachment-meta"><strong>${escapeHtml(fieldNote.name || 'Attached file')}</strong><span>${escapeHtml(formatFileSize(fieldNote.size || 0))}</span></div><a href="${fieldNote.dataUrl}" target="_blank" rel="noopener" download="${escapeHtml(fieldNote.name || 'field-note')}">Open Attachment</a></div></div>` : '';
    const actions = [{label:'Close', className:'secondary', onClick: closeModal}];
    if (req.status === 'pending') {
      actions.unshift({label:'Reject Journal', className:'danger', onClick: ()=>{ rejectRequestRemote(req.id).then((result)=>{ if(result?.ok===false) showToast(result?.error?.message || 'Unable to reject request'); }); closeModal(); }});
      actions.unshift({label:'Approve Journal', className:'success', onClick: ()=>{ approveRequestRemote(req.id).then((result)=>{ if(result?.ok===false) showToast(result?.error?.message || 'Unable to approve request'); }); closeModal(); }});
    }
    openModal('Journal Approval', `<div class="stack"><div class="kpi-row balance-kpi-row"><div class="kpi"><div class="label">Posted By</div><div class="number">${escapeHtml(req.requestedByName)}</div></div><div class="kpi"><div class="label">Form</div><div class="number">${money(opening)}</div></div><div class="kpi"><div class="label">Total</div><div class="number">${money(total)}</div></div>${req.type === 'customer_credit_journal' ? `<div class="kpi"><div class="label">Charges</div><div class="number">${money(totalCharges)}</div></div>` : ''}<div class="kpi"><div class="label">Overdraw</div><div class="number ${running<0?'balance-negative':''}">${money(Math.max(0,-running))}</div></div></div>${fieldNoteBlock}<div class="table-wrap"><table class="table"><thead><tr><th>S/N</th><th>Customer</th><th>Account</th><th>Amount</th><th>Remaining Balance</th></tr></thead><tbody>${bodyRows}</tbody></table></div></div>`, actions);
  }

  function openRequestDetailModal(reqId){
    const req = state.approvals.find(r=>r.id===reqId); if(!req) return; const p=req.payload||{};
    const esc = (v) => String(v ?? '—').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    const field = (label, value, cls='') => `<div class="field ${cls}"><label>${label}</label><div class="display-field">${esc(value)}</div></div>`;
    const customer = state.customers.find(c => c.id === p.customerId);
    const photoSrc = p.photo || customer?.photo || '';
    const photoBlock = `<div class="approval-photo-stack"><button type="button" class="secondary" id="approvalPhotoToggle">Display Picture</button><div class="approval-photo-panel hidden" id="approvalPhotoPanel"><div class="photo-box approval-photo-box">${photoSrc ? `<img src="${photoSrc}" alt="customer photo">` : '<span>No Photo</span>'}</div></div></div>`;
    let html = '';
    if (req.type === 'account_opening') {
      const assignBlock = req.status === 'pending'
        ? `<div class="field field-account approval-assign-field"><label>Assign Account Number</label><input id="approvalAssignAccount" class="entry-input approval-assign-input" inputmode="numeric" value="${esc(p.generatedAccountNumber || '')}" autocomplete="off"></div>`
        : '';
      html = `<div class="stack approval-opening-linear">
        ${field('Name', p.name, 'field-wide')}
        ${field('Phone', p.phone, 'field-phone')}
        ${field('Address', p.address, 'field-wide')}
        ${field('NIN', p.nin, 'field-id')}
        ${field('BVN', p.bvn, 'field-bvn')}
        ${assignBlock}
        ${photoBlock}
      </div>`;
    } else if (req.type === 'account_maintenance') {
      const patch = p.patch || {};
      html = `<div class="stack"><div class="form-grid two modal-cs-grid">${field('Customer Name', customer?.name || patch.name, 'field-wide')}${field('Account Number', p.accountNumber, 'field-account')}${field('Current Status', customerStatusLabel(customer), 'field-status')}${field('Old Account Number', patch.oldAccountNumber, 'field-account')}${field('Updated Name', patch.name, 'field-wide')}${field('Updated Phone', patch.phone, 'field-phone')}${field('Updated Address', patch.address, 'field-wide')}${field('Updated NIN', patch.nin, 'field-id')}${field('Updated BVN', patch.bvn, 'field-bvn')}</div>${photoBlock}</div>`;
    } else if (req.type === 'account_reactivation') {
      html = `<div class="stack"><div class="form-grid two modal-cs-grid">${field('Customer Name', customer?.name, 'field-wide')}${field('Account Number', p.accountNumber, 'field-account')}${field('Current Status', customerStatusLabel(customer), 'field-status')}${field('Requested Action', 'Reactivate Account', 'field-submit')}</div>${photoBlock}</div>`;
    } else {
      html = `<pre>${esc(JSON.stringify(p,null,2))}</pre>`;
    }
    const actions = [{label:'Close', className:'secondary', onClick: closeModal}];
    if (req.status === 'pending') {
      actions.unshift({label:'Reject', className:'danger', onClick: ()=>{ rejectRequestRemote(req.id).then((result)=>{ if(result?.ok===false) showToast(result?.error?.message || 'Unable to reject request'); }); closeModal(); }});
      actions.unshift({label:'Approve', className:'success', onClick: ()=>{ if (req.type === 'account_opening') { const assignInput = byId('approvalAssignAccount'); if (assignInput) req.payload.generatedAccountNumber = assignInput.value.trim(); } approveRequestRemote(req.id).then((result)=>{ if(result?.ok===false) showToast(result?.error?.message || 'Unable to approve request'); }); closeModal(); }});
    }
    openModal(prettyApprovalType(req.type), html, actions);
    const btn = byId('approvalPhotoToggle');
    if (btn) btn.onclick = ()=> byId('approvalPhotoPanel')?.classList.toggle('hidden');
  }

  function renderPermissions() {
    const tools = ['check_balance','account_opening','account_maintenance','account_reactivation','account_statement','credit','debit','approval_queue','business_balance'];
    return `
      <div class="stack">
        <div class="table-card">
          <h3>Administrative Working Tools</h3>
          <div class="table-wrap"><table class="table"><thead><tr><th>S/N</th><th>Staff</th><th>Office</th>${tools.map(t=>`<th>${TOOL_LABELS[t]}</th>`).join('')}</tr></thead>
          <tbody>${state.staff.map((s,i)=>`<tr><td>${i+1}</td><td>${s.name}</td><td>${ROLE_LABELS[s.role] || s.role}</td>${tools.map(t=>`<td>${hasPermission(t,s)?'YES':'NO'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        </div>
        <div class="form-card">
          <h3>Temporary Access Grant</h3>
          <div class="form-grid three">
            <div class="field"><label>Staff</label><select id="grantStaff" class="entry-input">${state.staff.map(s=>`<option value="${s.id}">${s.name}</option>`).join('')}</select></div>
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
            <div class="field"><label>Account</label><select id="oeAccount" class="entry-input">${allAccts.map(a=>`<option value="${a.id}">${a.accountNumber} — ${a.name}</option>`).join('')}</select></div>
            <div class="field"><label>Amount</label><input id="oeAmount" class="entry-input" type="number"></div>
            <div class="field"><label>Date</label><input id="oeDate" class="entry-input" type="date" value="${businessDate()}"></div>
            <div class="field"><label>Note</label><input id="oeNote" class="entry-input"></div>
            <div class="field"><label>Type</label><div class="display-field" id="oeKindDisplay">Auto from account</div></div>
          </div>
          <div class="action-row compact-action-row"><button id="oeSubmit" class="tiny-btn">Submit for Approval</button></div>
        </div>
      </div>`;
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
              <div class="field"><label>Account Number</label><div class="display-field" id="oaNumberPreview">INC-2001</div></div>
            </div>
            <div class="action-row compact-action-row"><button id="oaCreate" class="tiny-btn">Submit for Approval</button></div>
          </div>` : ''}
          <div class="form-card">
            <h3>Post into Account</h3>
            <div class="form-grid three">
              <div class="field"><label>Account</label><select id="oeAccount" class="entry-input">${allAccts.map(a=>`<option value="${a.id}">${a.accountNumber} — ${a.name}</option>`).join('')}</select></div>
              <div class="field"><label>Amount</label><input id="oeAmount" class="entry-input" type="number"></div>
              <div class="field"><label>Date</label><input id="oeDate" class="entry-input" type="date" value="${businessDate()}"></div>
              <div class="field"><label>Note</label><input id="oeNote" class="entry-input"></div>
              <div class="field"><label>Type</label><div class="display-field" id="oeKindDisplay">Auto from account</div></div>
            </div>
            <div class="action-row compact-action-row"><button id="oeSubmit" class="tiny-btn">Submit for Approval</button></div>
          </div>
        </div>
        <div class="table-card">
          <h3>Existing Accounts</h3>
          <div class="table-wrap"><table class="table"><thead><tr><th>Type</th><th>Account Number</th><th>Name</th><th>Entries</th></tr></thead><tbody>${allAccts.map(a=>`<tr><td>${a.category}</td><td>${a.accountNumber}</td><td>${a.name}</td><td>${state.operations.entries.filter(e=>e.accountId===a.id).length}</td></tr>`).join('') || '<tr><td colspan="4">No accounts</td></tr>'}</tbody></table></div>
        </div>
      </div>`;
  }

  function renderCustomerDirectory() {
    const search = String(state.ui.customerDirectorySearch || '').trim().toLowerCase();
    const customers = [...(state.customers || [])]
      .filter(c => String(c.accountType || 'customer') !== 'staff_wallet')
      .sort((a,b)=> String(a.name||'').localeCompare(String(b.name||'')));
    const filteredCustomers = search
      ? customers.filter(c => [c.name, c.accountNumber, c.phone, c.email].some(value => String(value || '').toLowerCase().includes(search)))
      : customers;
    const totalCustomers = customers.length;
    return `
      <div class="stack">
        <div class="kpi-row balance-kpi-row">
          <div class="kpi"><div class="label">Total Customers</div><div class="number">${totalCustomers}</div></div>
        </div>
        <div class="table-card">
          <div class="action-inline"><h3 style="margin:0">Customer Directory</h3></div>
          <div class="form-grid one" style="margin-top:12px">
            <div class="field"><label>Search Customer</label><input id="customerDirectorySearch" class="entry-input" placeholder="Search by name, account number, phone or email" value="${escapeHtml(state.ui.customerDirectorySearch || '')}"></div>
          </div>
          <div class="table-wrap"><table class="table"><thead><tr><th>S/N</th><th>Customer Name</th><th>Account Number</th><th>Started</th><th>Balance</th><th>Total Credits</th><th>Total Debits</th></tr></thead><tbody>${filteredCustomers.map((c,i)=>{
            const credits = (c.transactions || []).filter(tx => tx.type === 'credit').reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
            const debits = (c.transactions || []).filter(tx => tx.type === 'debit').reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
            return `<tr><td>${i+1}</td><td>${c.name}</td><td>${c.accountNumber || '—'}</td><td>${fmtDate(c.createdAt)}</td><td>${money(Number(c.balance || 0))}</td><td>${money(credits)}</td><td>${money(debits)}</td></tr>`;
          }).join('') || '<tr><td colspan="7">No matching customers</td></tr>'}</tbody></table></div>
          <div class="action-row" style="margin-top:14px"><button id="customerDirectoryCloseBtn" class="secondary">Collapse Directory</button></div>
        </div>
      </div>`;
  }

  function renderStaffDirectory() {
    return `
      <div class="table-card">
        <div class="action-inline"><h3 style="margin:0">Staff Directory</h3><button id="addStaffBtn">ADD STAFF</button></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>S/N</th><th>Staff</th><th>Office</th><th>Status</th><th>Teller Account</th><th>Wallet</th><th>Debt</th><th>Remaining Float</th><th>Action</th></tr></thead><tbody>${state.staff.map((s,i)=>{
          const acc = ensureStaffAccount(s.id);
          return `<tr><td>${i+1}</td><td>${s.name}</td><td>${ROLE_LABELS[s.role] || s.role}</td><td>${s.active === false ? 'Inactive' : 'Active'}</td><td>${acc.accountNumber}</td><td>${money(acc.walletBalance)}</td><td class="${Number(acc.debtBalance||0)>0?'balance-negative':''}">-${money(acc.debtBalance)}</td><td>${money(acc.balance)}</td><td><button class="secondary" data-staff-toggle="${s.id}">${s.active === false ? 'Reactivate' : 'Deactivate'}</button></td></tr>`;
        }).join('')}</tbody></table></div>
      </div>`;
  }

  function renderBusinessBalance() {
    const rawBusiness = filterByDate(flattenBusinessEntries(), state.ui.businessFilter || { preset: 'all', from: '', to: '' });
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
        <div class="table-card"><h3>Business Entries</h3><div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Account</th><th>Details</th><th>Debit</th><th>Credit</th><th>Balance</th><th>Received/Paid By</th><th>Posted By</th></tr></thead><tbody>${filtered.slice(0,state.ui.businessEntriesLimit || 20).map(t=>`<tr><td>${fmtDate(t.date)}</td><td>${t.accountNumber || '—'}</td><td>${t.details}</td><td>${t.kind==='debit'?money(t.amount):''}</td><td>${t.kind==='credit'?money(t.amount):''}</td><td>${money(t.balanceAfter || 0)}</td><td>${t.receivedOrPaidBy || '—'}</td><td>${t.postedBy || '—'}</td></tr>`).join('') || '<tr><td colspan="8">No entries</td></tr>'}</tbody></table></div><div class="action-row">${filtered.length > (state.ui.businessEntriesLimit || 20) ? `<button id="businessMore" class="secondary">Show More</button>` : ''}${(state.ui.businessEntriesLimit || 20) > 20 ? `<button id="businessLess" class="secondary">Show Less</button>` : ''}</div></div>
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
        <div class="table-card"><h3>Operational Entries</h3><div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Account</th><th>Type</th><th>Amount</th><th>Note</th><th>Posted By</th><th>Approved By</th></tr></thead><tbody>${filtered.slice(0,state.ui.operationalEntriesLimit || 20).map(e=>`<tr><td>${fmtDate(e.date)}</td><td>${e.accountName}</td><td>${e.kind}</td><td>${money(e.amount)}</td><td>${e.note||'—'}</td><td>${e.postedBy}</td><td>${e.approvedBy}</td></tr>`).join('') || '<tr><td colspan="7">No entries</td></tr>'}</tbody></table></div><div class="action-row">${filtered.length > (state.ui.operationalEntriesLimit || 20) ? `<button id="operationalMore" class="secondary">Show More</button>` : ''}${(state.ui.operationalEntriesLimit || 20) > 20 ? `<button id="operationalLess" class="secondary">Show Less</button>` : ''}</div></div>
      </div>`;
  }

  
  function getOperationalFilteredRows() {
    const rawOperational = filterByDate(state.operations.entries || [], state.ui.operationalFilter || { preset: 'all', from: '', to: '' });
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
        note: e.note || e.details || '',
        details: e.details || e.note || '',
        balanceAfter: runningBalance,
        receivedOrPaidBy: e.receivedOrPaidBy || e.postedBy || '—',
        postedBy: e.postedBy || '—'
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
      ['S/N','DATE','TYPE','ACCOUNT NAME','AMOUNT','DETAILS','BALANCE AFTER','POSTED BY'],
      ...rows.map(r => [
        r.sn,
        r.date,
        String(r.type || '').toUpperCase(),
        r.accountName,
        Number(r.amount || 0),
        r.details || r.note || '',
        Number(r.balanceAfter || 0),
        r.postedBy || ''
      ]),
      []
    ];

    if (activeFilter === 'all') {
      csvRows.push(['', '', '', 'TOTAL INCOME', Number(summary.totalIncome || 0), '', '', '']);
      csvRows.push(['', '', '', 'TOTAL EXPENSE', Number(summary.totalExpense || 0), '', '', '']);
      csvRows.push(['', '', '', 'NET BALANCE', Number(summary.netOperationalBalance || 0), '', '', '']);
    } else {
      csvRows.push(['', '', '', 'TOTAL AMOUNT', Number(summary.totalAmount || 0), '', '', '']);
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
        <td>${String(r.type || '').toUpperCase()}</td>
        <td>${r.accountName}</td>
        <td>${money(r.amount)}</td>
        <td>${r.note}</td>
        <td>${money(r.balanceAfter)}</td>
        <td>${r.postedBy}</td>
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
            </tr>
          </thead>
          <tbody>
            ${bodyRows || '<tr><td colspan="8">No entries</td></tr>'}
          </tbody>
        </table>
        <div class="statement-total"><strong>Total Amount:</strong> ${money(summary.totalAmount)}</div>
      </div>
    `;
    printHtml(html, true);
  }

  
  function getBusinessFilteredRows() {
    const rawBusiness = filterByDate(flattenBusinessEntries(), state.ui.businessFilter || { preset: 'all', from: '', to: '' });
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
        details: e.details || e.note || '',
        balanceAfter: Number(e.balanceAfter || 0),
        receivedOrPaidBy: e.receivedBy || e.receivedOrPaidBy || e.postedBy || '',
        postedBy: e.postedBy || ''
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
      ['S/N','DATE','TYPE','ACCOUNT NAME','AMOUNT','DETAILS','BALANCE AFTER','RECEIVED OR PAID BY','POSTED BY'],
      ...rows.map(r => [
        r.sn,
        r.date,
        r.type,
        r.accountName,
        Number(r.amount || 0),
        r.details || '',
        Number(r.balanceAfter || 0),
        r.receivedOrPaidBy || '',
        r.postedBy || ''
      ]),
      []
    ];

    if (activeFilter === 'all') {
      csvRows.push(['', '', '', 'TOTAL CREDIT', Number(summary.totalCredit || 0), '', '', '', '']);
      csvRows.push(['', '', '', 'TOTAL DEBIT', Number(summary.totalDebit || 0), '', '', '', '']);
      csvRows.push(['', '', '', 'NET BALANCE', Number(summary.netBookBalance || 0), '', '', '', '']);
    } else {
      csvRows.push(['', '', '', 'TOTAL AMOUNT', Number(summary.totalAmount || 0), '', '', '', '']);
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
        <td>${r.type}</td>
        <td>${r.accountName}</td>
        <td>${money(r.amount)}</td>
        <td>${r.details}</td>
        <td>${money(r.balanceAfter)}</td>
        <td>${r.receivedOrPaidBy}</td>
        <td>${r.postedBy}</td>
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

function renderTellerBalances() {
    const rows = state.staff.slice(0, state.ui.tellerEntriesLimit || 20).map(s=>{
      const acc = ensureStaffAccount(s.id);
      const debtBalance = Number(acc.balance || 0) < 0 ? Number(acc.balance || 0) : 0;
      const totalCreditReceived = acc.entries
        .filter(e => ['customer_credit','credit','approved_float','approved_float_topup'].includes(String(e.type || '').toLowerCase()))
        .reduce((sum,e)=>sum+Number(e.amount||0),0);
      const totalDebitsPaid = acc.entries
        .filter(e => ['customer_debit','debit'].includes(String(e.type || '').toLowerCase()))
        .reduce((sum,e)=>sum+Number(e.amount||0),0);
      return `<tr><td>${s.name}</td><td>${ROLE_LABELS[s.role] || s.role}</td><td>${acc.accountNumber}</td><td>${money(acc.balance)}</td><td class="balance-negative">${debtBalance < 0 ? "-" + money(Math.abs(debtBalance)) : money(0)}</td><td>${money(totalCreditReceived)}</td><td>${money(totalDebitsPaid)}</td></tr>`;
    }).join('');
    return `<div class="table-card"><div class="action-row" style="justify-content:space-between;align-items:center"><h3>Teller and Posting Accounts</h3><div class="note" style="margin:0">Business Date: <strong>${businessDate()}</strong></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Staff</th><th>Office</th><th>Account Number</th><th>Balance</th><th>Debt Balance</th><th>Total Credit Received</th><th>Total Debits Paid</th></tr></thead><tbody>${rows}</tbody></table></div><div class="action-row">${state.staff.length > (state.ui.tellerEntriesLimit || 20) ? `<button id="tellerMore" class="secondary">Show More</button>` : ''}${(state.ui.tellerEntriesLimit || 20) > 20 ? `<button id="tellerLess" class="secondary">Show Less</button>` : ''}</div></div>`;
  }

  function allApprovedCustomerTx(kind) {
    return flattenCustomerTx().filter(t => t.type === kind);
  }
  function flattenCustomerTx() {
    return state.customers.flatMap(customer => (customer.transactions||[]).map(tx => ({ ...tx, customer })) ).sort((a,b)=>new Date(b.date)-new Date(a.date));
  }

  
  function isTelleringDirectModalTool(tool) {
    return ['my_balance', 'form', 'my_close_day'].includes(tool);
  }

  function bindToolHandlers() {
    switch (state.ui.tool) {
      case 'check_balance': bindCheckBalance(); break;
      case 'account_opening': bindAccountOpening(); break;
      case 'account_maintenance': bindMaintenance('maintenance'); break;
      case 'account_reactivation': bindMaintenance('reactivation'); break;
      case 'account_statement': bindStatement(); break;
      case 'credit': bindJournal('credit'); break;
      case 'debit': bindJournal('debit'); break;
      case 'central_close_day':
      case 'approval_queue':
      case 'approval_customer_service':
      case 'approval_tellering':
      case 'approval_others': bindApprovals(); break;
      case 'permissions': bindPermissions(); break;
      case 'operational_posting': bindOperationalAccounts(); break;
      case 'operational_accounts': bindOperationalAccounts(); break;
      case 'staff_directory': bindStaffDirectory(); break;
      case 'customer_directory': bindCustomerDirectory(); break;
      case 'business_balance': bindBalanceFilters('business'); break;
      case 'operational_balance': bindBalanceFilters('operational'); break;
      case 'teller_balances': bindTellerBalances(); break;
    }
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
  }

  function openFloatTopUpModal(staffId=null) {
    if (!canAssignFloatTopUp()) return showToast('Only Approval Officer or Admin can assign float');
    const postingStaff = state.staff.filter(x => hasPermission('credit', x) || hasPermission('debit', x));
    const defaultStaff = state.staff.find(x => x.id === staffId) || postingStaff[0];
    if (!defaultStaff) return showToast('No eligible staff found');
    openModal('Assign Float Top-Up', `
      <div class="form-grid three">
        <div class="field"><label>Staff</label><select id="floatTopupStaff" class="entry-input">${postingStaff.map(st => `<option value="${st.id}" ${st.id===defaultStaff.id?'selected':''}>${st.name} — ${ROLE_LABELS[st.role] || st.role}</option>`).join('')}</select></div>
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
      state.ui.selectedCustomerId = c.id;
      state.ui.checkBalanceLoaded = true;
      save();
      lookupFill(byId('workspace'), c);
    };
    byId('lookupBtn').onclick = () => openCustomerSearchModal(state.customers);
    byId('lookupAcc').oninput = () => {
      const v = (byId('lookupAcc')?.value || '').trim();
      if (!v) return doLookup(true);
      if (/^\d{4}$/.test(v)) doLookup(true);
    };
    byId('lookupAcc').onchange = () => doLookup(true);
    byId('lookupAcc').onkeyup = (e) => { if (e.key === "Enter") doLookup(false); };
    byId('openStatementBtn').onclick = () => { state.ui.tool = 'account_statement'; renderWorkspace(); setTimeout(()=>{ byId('stmtAcc').value = getSelectedCustomer()?.accountNumber || ''; }, 30); };
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
    const photoInput = byId('openPhoto');
    const photoBtn = byId('openPhotoBtn');
    const photoStatus = byId('openPhotoStatus');
    if (photoBtn && photoInput) photoBtn.onclick = () => photoInput.click();
    if (photoInput) photoInput.onchange = async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const base64 = await toBase64(f);
        if (estimateDataUrlBytes(base64) > CUSTOMER_PHOTO_MAX_BYTES) {
          photoInput.value = '';
          photoInput.dataset.base64 = '';
          if (photoStatus) photoStatus.textContent = 'No photo selected';
          return showToast('Photo must be 1 MB or less after compression');
        }
        photoInput.dataset.base64 = base64;
        const compressedLabel = `${formatFileSize(estimateDataUrlBytes(base64))}`;
        if (photoStatus) photoStatus.textContent = f.name.length > 18 ? `${f.name.slice(0, 15)}... • ${compressedLabel}` : `${f.name} • ${compressedLabel}`;
      } catch (error) {
        photoInput.value = '';
        photoInput.dataset.base64 = '';
        if (photoStatus) photoStatus.textContent = 'No photo selected';
        showToast(error?.message || 'Unable to process selected photo');
      }
    };
    byId('submitOpening').onclick = () => {
      const payload = {
        name: byId('openName').value.trim(),
        address: byId('openAddress').value.trim(),
        phone: byId('openPhone').value.trim(),
        nin: byId('openNin').value.trim(),
        bvn: byId('openBvn').value.trim(),
        oldAccountNumber: byId('openOldAccount').value.trim(),
        generatedAccountNumber: '',
        photo: byId('openPhoto').dataset.base64 || ''
      };
      if (!payload.name || !payload.address || !payload.phone || !payload.nin || !payload.bvn) return showToast('Complete all required fields');
      confirmAction('Submit account opening request?', async () => {
  const result = await submitApprovalThroughGateway('account_opening', payload);
  if (!result?.ok) return showToast(result?.error?.message || 'Unable to submit request');
  render();
  showToast('Account opening sent for approval');
});
    };
  }

  function bindMaintenance(prefix) {
    const detailIds = [`${prefix}Name`, `${prefix}Address`, `${prefix}Phone`, `${prefix}Nin`, `${prefix}Bvn`, `${prefix}OldAccount`];
    const clearFilledCustomer = () => {
      if (byId(`${prefix}Name`)) byId(`${prefix}Name`).value = '';
      if (byId(`${prefix}Address`)) byId(`${prefix}Address`).value = '';
      if (byId(`${prefix}Phone`)) byId(`${prefix}Phone`).value = '';
      if (byId(`${prefix}Nin`)) byId(`${prefix}Nin`).value = '';
      if (byId(`${prefix}Bvn`)) byId(`${prefix}Bvn`).value = '';
      if (byId(`${prefix}OldAccount`)) byId(`${prefix}OldAccount`).value = '';
      byId(`${prefix}DisplayName`).textContent = '—';
      byId(`${prefix}DisplayPhone`).textContent = '—';
      byId(`${prefix}DisplayStatus`).textContent = '—';
      if (state.ui.selectedCustomerId) {
        const selected = getSelectedCustomer();
        if (selected?.accountNumber === (byId(`${prefix}Acc`)?.value || '').trim() || !(byId(`${prefix}Acc`)?.value || '').trim()) {
          state.ui.selectedCustomerId = null;
        }
      }
      save();
      setDetailsEditable(false);
    };
    const setDetailsEditable = (editable) => {
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
      save();
      byId(`${prefix}Acc`).value = c.accountNumber || '';
      byId(`${prefix}Name`).value = c.name || '';
      if (byId(`${prefix}Address`)) byId(`${prefix}Address`).value = c.address || '';
      if (byId(`${prefix}Phone`)) byId(`${prefix}Phone`).value = c.phone || '';
      if (byId(`${prefix}Nin`)) byId(`${prefix}Nin`).value = c.nin || '';
      if (byId(`${prefix}Bvn`)) byId(`${prefix}Bvn`).value = c.bvn || '';
      if (byId(`${prefix}OldAccount`)) byId(`${prefix}OldAccount`).value = c.oldAccountNumber || '';
      byId(`${prefix}DisplayName`).textContent = c.name || '—';
      byId(`${prefix}DisplayPhone`).textContent = c.phone || '—';
      byId(`${prefix}DisplayStatus`).textContent = customerStatusLabel(c);
      setDetailsEditable(false);
    };
    setDetailsEditable(false);
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
        if (!v) return doLookup(true);
        if (/^\d{4}$/.test(v)) doLookup(true);
      };
      accInput.onchange = () => doLookup(true);
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
        name: byId(`${prefix}Name`).value.trim(),
        address: byId(`${prefix}Address`).value.trim(),
        phone: byId(`${prefix}Phone`)?.value.trim() || c.phone,
        nin: byId(`${prefix}Nin`)?.value.trim() || c.nin,
        bvn: byId(`${prefix}Bvn`)?.value.trim() || c.bvn,
        oldAccountNumber: byId(`${prefix}OldAccount`)?.value.trim() || (c.oldAccountNumber || '')
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

  render();
};

    const selected = getSelectedCustomer();
    if (selected) {
      const matchesTool = (accInput?.value || '').trim() ? (selected.accountNumber === (accInput?.value || '').trim()) : true;
      if (matchesTool) fillCustomer(selected);
    }
  }

  function bindStatement() {
    const stmtAcc = byId('stmtAcc');
    const autoSelect = (quiet=false) => {
      const val = (stmtAcc?.value || '').trim();
      if (!val) return;
      const c = getCustomerByAccountNo(val);
      if (!c) { if (!quiet) showToast('Customer not found. Use name search.'); return; }
      state.ui.selectedCustomerId = c.id;
      save();
    };
    if (stmtAcc) {
      stmtAcc.oninput = () => { const v = (stmtAcc.value || '').trim(); if (/^\d{4}$/.test(v)) autoSelect(true); };
      stmtAcc.onchange = () => autoSelect(true);
      stmtAcc.onkeyup = (e) => { if (e.key === 'Enter') autoSelect(false); };
    }
    byId('stmtGenerate').onclick = () => {
      const c = getCustomerByAccountNo(byId('stmtAcc').value);
      if (!c) return showToast('Customer not found');
      const from = byId('stmtFrom').value;
      const to = byId('stmtTo').value;
      const rows = (c.transactions || []).filter(tx => {
        const d = tx.date.slice(0,10);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      }).map((tx, i) => `<tr><td>${i+1}</td><td>${fmtDate(tx.date)}</td><td>${tx.details || ''}</td><td>${tx.type==='debit'?money(tx.amount):''}</td><td>${tx.type==='credit'?money(tx.amount):''}</td><td>${money(tx.balanceAfter)}</td><td>${tx.receivedOrPaidBy || '—'}</td><td>${tx.postedBy || tx.postedById || '—'}</td><td>${tx.approvedBy || '—'}</td></tr>`).join('');
      byId('statementArea').innerHTML = `
        <div class="record-card statement-record-minimal">
          <div class="lookup-card statement-lookup-minimal">
            <div class="stack">
              <div class="info-grid">
                <div class="info-item"><div class="k">A/C Name</div><div class="v">${c.name}</div></div>
                <div class="info-item"><div class="k">Phone No</div><div class="v">${c.phone}</div></div>
                <div class="info-item"><div class="k">Address</div><div class="v">${c.address}</div></div>
                <div class="info-item"><div class="k">Available Balance</div><div class="v">${money(c.balance)}</div></div>
              </div>
            </div>
          </div>
          <div class="table-wrap" style="margin-top:16px"><table class="table"><thead><tr><th>S/N</th><th>Date</th><th>Details</th><th>Debit</th><th>Credit</th><th>Balance</th><th>Received/Paid By</th><th>Posted By</th><th>Approved By</th></tr></thead><tbody>${rows || '<tr><td colspan="9">No entries in range</td></tr>'}</tbody></table></div>
        </div>`;
    };

    byId('stmtPrintBtn').onclick = () => {
      const area = byId('statementArea').innerHTML;
      if (!area.trim()) return showToast('Generate statement first');
      printHtml(`<h2>Customer Statement</h2>${area}</div>`);
    };
  }

  function hasApprovedFloat(staffId, date=businessDate()) {
    const acc = ensureStaffAccount(staffId);
    return acc.entries.some(e => e.type === 'approved_float' && e.floatDate === date);
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
    const updateJournalCommissionPreview = () => readChargePreview('journal', byId('journalAmount')?.value || 0);
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
    const resetJournalEntryFields = () => {
      ['journalAcc','journalAmount','journalCounterparty','journalDetails'].forEach(id=>{ if(byId(id)) byId(id).value=''; });
      if (byId('journalApplyCharges')) byId('journalApplyCharges').checked = false;
      CHARGE_DEFS.forEach(def => {
        const check = q(`[data-charge-check="${def.key}"][data-charge-scope="journal"]`);
        const input = q(`[data-charge-input="${def.key}"][data-charge-scope="journal"]`);
        if (check) check.checked = false;
        if (input) input.value = '';
      });
      if (byId('journalName')) byId('journalName').textContent='—';
      state.ui.selectedJournalCustomerId = null;
      updateJournalCommissionPreview();
    };

    const recalcPreview = () => {
      const approvedBase = currentFloatAvailable(staff.id, businessDate());
      const totalPending = pendingJournalTotal(staff.id, businessDate());
      const thisJournalTotal = journal.reduce((acc,row)=>acc+Number(row.amount||0),0);
      let running = approvedBase - (totalPending - thisJournalTotal);
      const withBalances = journal.map((row) => {
        const before = running;
        running -= Number(row.amount||0);
        const remaining = running;
        const variance = Math.max(0, -remaining);
        return { row, before, remaining, variance };
      });
      const rows = withBalances.map(({ row, before, remaining, variance }, displayIndex) => { const chargeMeta = getTotalChargeAmount(row) > 0 ? `<div class="journal-inline-meta">${chargeInlineMeta(row)}</div>` : ''; return `<tr><td>${displayIndex+1}</td><td>${row.customerName}${chargeMeta}</td><td>${row.accountNumber}</td><td>${money(before)}</td><td>${money(row.amount)}</td><td class="${remaining<0?'balance-negative':''}">${money(remaining)}</td><td class="${variance>0?'balance-negative':''}">${money(variance)}</td><td><span class="linklike" data-remove-row="${row.id}">Remove</span></td></tr>`; }).join('') || '<tr><td colspan="8">No journal entries yet</td></tr>';
      if (byId('journalRows')) byId('journalRows').innerHTML = rows;
      ['journalRunningFloat','postingRunningFloat'].forEach(id => { if (byId(id)) byId(id).textContent = money(Math.max(0,running)); });
      ['journalVariance','postingVariance'].forEach(id => { if (byId(id)) byId(id).textContent = money(Math.max(0,-running)); });
      const fileNameEl = byId('journalFieldNoteName');
      if (fileNameEl) fileNameEl.textContent = attachmentState.loading ? 'Reading file…' : (attachmentState.fieldNote?.name ? `${attachmentState.fieldNote.name} (${formatFileSize(attachmentState.fieldNote.size)})` : 'No file selected');
      const inputEl = byId('journalFieldNoteInput');
      if (inputEl) inputEl.disabled = attachmentState.loading;
      qq('[data-remove-row]').forEach(el => el.onclick = () => {
        const idx = journal.findIndex(r => r.id === el.dataset.removeRow);
        if (idx >= 0) {
          journal.splice(idx,1);
          save();
          recalcPreview();
        }
      });
    };

    const searchSingle = () => {
      const value = (byId('txAcc')?.value || '').trim();
      state.ui.txAccDraft = value;
      const c = getCustomerByAccountNo(value);
      if (!c) return showToast('Customer not found');
      if (isCustomerFrozen(c) || c.active === false) { freezeInactiveCustomer(c); save(); return showToast('Account is frozen'); }
      state.ui.selectedCustomerId = c.id;
      state.ui.generatedJournals ||= {};
      state.ui.collapsedJournals ||= {};
      state.ui.generatedJournals[visibilityKey] = false;
      state.ui.collapsedJournals[visibilityKey] = false;
      save();
      renderWorkspace();
      requestAnimationFrame(() => {
        if (byId('txName')) byId('txName').textContent = c.name;
        if (byId('txBalance')) byId('txBalance').innerHTML = balanceHtml(c.balance);
      });
    };

    const searchJournal = () => {
      const value = (byId('journalAcc')?.value || '').trim();
      const c = getCustomerByAccountNo(value);
      if (!c) return showToast('Customer not found');
      if (isCustomerFrozen(c) || c.active === false) { freezeInactiveCustomer(c); save(); return showToast('Account is frozen'); }
      state.ui.selectedJournalCustomerId = c.id;
      save();
      if (byId('journalName')) byId('journalName').textContent = c.name;
    };

    if (byId('txSearch')) byId('txSearch').onclick = () => openCustomerSearchModal(state.customers);
    if (byId('txAcc')) {
      byId('txAcc').oninput = () => {
        const v = (byId('txAcc').value || '').trim();
        state.ui.txAccDraft = v;
        if (!v) {
          if (byId('txName')) byId('txName').textContent = '—';
          if (byId('txBalance')) byId('txBalance').innerHTML = '—';
          state.ui.selectedCustomerId = null;
          state.ui.generatedJournals ||= {};
          state.ui.collapsedJournals ||= {};
          state.ui.generatedJournals[visibilityKey] = false;
          state.ui.collapsedJournals[visibilityKey] = false;
          save();
          renderWorkspace();
          return;
        }
        if (/^\d{4}$/.test(v)) searchSingle();
      };
      byId('txAcc').onchange = () => {
        const v = (byId('txAcc').value || '').trim();
        state.ui.txAccDraft = v;
        if (!v) {
          if (byId('txName')) byId('txName').textContent = '—';
          if (byId('txBalance')) byId('txBalance').innerHTML = '—';
          state.ui.selectedCustomerId = null;
          state.ui.generatedJournals ||= {};
          state.ui.collapsedJournals ||= {};
          state.ui.generatedJournals[visibilityKey] = false;
          state.ui.collapsedJournals[visibilityKey] = false;
          save();
          renderWorkspace();
          return;
        }
        searchSingle();
      };
      byId('txAcc').onkeyup = e => { if(e.key==='Enter') searchSingle(); };
    }

    if (byId('txApplyCharges')) byId('txApplyCharges').onchange = updateSingleCommissionPreview;
    if (byId('txAmount')) byId('txAmount').oninput = updateSingleCommissionPreview;
    CHARGE_DEFS.forEach(def => {
      const check = q(`[data-charge-check="${def.key}"][data-charge-scope="single"]`);
      const input = q(`[data-charge-input="${def.key}"][data-charge-scope="single"]`);
      if (check) check.onchange = updateSingleCommissionPreview;
      if (input) input.oninput = updateSingleCommissionPreview;
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

    if (byId('journalAcc')) {
      byId('journalAcc').oninput = () => { const v = (byId('journalAcc').value || '').trim(); if (/^\d{4}$/.test(v)) searchJournal(); };
      byId('journalAcc').onchange = searchJournal;
      byId('journalAcc').onkeyup = e => { if(e.key==='Enter') searchJournal(); };
    }

    if (byId('journalApplyCharges')) byId('journalApplyCharges').onchange = updateJournalCommissionPreview;
    if (byId('journalAmount')) byId('journalAmount').oninput = updateJournalCommissionPreview;
    CHARGE_DEFS.forEach(def => {
      const check = q(`[data-charge-check="${def.key}"][data-charge-scope="journal"]`);
      const input = q(`[data-charge-input="${def.key}"][data-charge-scope="journal"]`);
      if (check) check.onchange = updateJournalCommissionPreview;
      if (input) input.oninput = updateJournalCommissionPreview;
    });

    if (byId('journalAddRow')) byId('journalAddRow').onclick = () => {
      const customer = (state.ui.selectedJournalCustomerId && state.customers.find(c => c.id === state.ui.selectedJournalCustomerId)) || getCustomerByAccountNo(byId('journalAcc')?.value || '');
      if (!customer) return showToast('Search for customer first');
      if (isCustomerFrozen(customer) || customer.active === false) { freezeInactiveCustomer(customer); save(); return showToast('Frozen account cannot accept transactions'); }
      const amount = Number(byId('journalAmount')?.value || 0);
      if (!(amount > 0)) return showToast('Enter a valid amount');
      const mode = selectedMode();
      const chargeBreakdown = kind === 'credit' ? collectChargeBreakdownFromUi('journal', amount) : [];
      const totalChargeAmount = chargeBreakdown.reduce((sum, row) => sum + Number(row.amount || 0), 0);
      const customerCreditAmount = kind === 'credit' ? Math.max(0, amount - totalChargeAmount) : amount;
      journal.unshift({
        id: uid('jr'),
        customerId: customer.id,
        customerName: customer.name,
        accountNumber: customer.accountNumber,
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
      save();
      recalcPreview();
      resetJournalEntryFields();
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
      const input = byId('journalFieldNoteInput');
      if (input) input.value = '';
      save();
      renderWorkspace();
    };

    if (byId('txPostSingle')) byId('txPostSingle').onclick = () => {
      if (!hasPermission(kind)) return showToast('No access to post');
      if (!hasApprovedFloat(staff.id, businessDate())) return showToast('Approved form required before posting');
      const customer = getSelectedCustomer() || getCustomerByAccountNo(byId('txAcc').value);
      if (!customer) return showToast('Search for customer first');
      if (isCustomerFrozen(customer) || customer.active === false) { freezeInactiveCustomer(customer); save(); return showToast('Frozen account cannot accept transactions'); }
      const amount = Number(byId('txAmount').value || 0);
      if (!(amount > 0)) return showToast('Enter a valid amount');
      const mode = selectedMode();
      const chargeBreakdown = kind === 'credit' ? collectChargeBreakdownFromUi('single', amount) : [];
      const totalChargeAmount = chargeBreakdown.reduce((sum, row) => sum + Number(row.amount || 0), 0);
      const customerCreditAmount = kind === 'credit' ? Math.max(0, amount - totalChargeAmount) : amount;
      confirmAction(`Submit single ${kind} request for approval?`, () => {
        submitApprovalThroughGateway(kind === 'credit' ? 'customer_credit' : 'customer_debit', {
          customerId: customer.id,
          customerName: customer.name,
          accountNumber: customer.accountNumber,
          amount,
          customerCreditAmount,
          chargeBreakdown,
          totalChargeAmount,
          commissionAmount: chargeBreakdown.find(row => row.key === 'commission')?.amount || 0,
          chargeTraceId: totalChargeAmount > 0 ? uid('ctr') : '',
          commissionTraceId: totalChargeAmount > 0 ? uid('ctr') : '',
          details: byId('txDetails').value.trim(),
          receivedOrPaidBy: byId('txCounterparty').value.trim(),
          payoutSource: mode,
          paymentMode: mode,
          staffId: staff.id,
          date: businessDate()
        }).then((result) => {
          if (!result?.ok) return showToast(result?.error?.message || 'Unable to submit request');
          resetFields();
          showToast(`${kind === 'credit' ? 'Credit' : 'Debit'} request sent for approval`);
          render();
        });
      });
    };

    if (byId('journalSubmit')) byId('journalSubmit').onclick = () => {
      if (!hasPermission(kind)) return showToast('No access to post');
      if (!hasApprovedFloat(staff.id, businessDate())) return showToast('Approved form required before posting');
      if (!journal.length) return showToast('Generate journal first');
      if (attachmentState.loading) return showToast('Please wait for the field note to finish loading');
      confirmAction(`Submit ${kind} journal for approval?`, () => {
        submitApprovalThroughGateway(kind === 'credit' ? 'customer_credit_journal' : 'customer_debit_journal', {
          staffId: staff.id,
          date: businessDate(),
          openingFloat: getOpeningBalanceForDate(staff.id, businessDate()),
          rows: journal.map(row => ({
            customerId: row.customerId,
            customerName: row.customerName,
            accountNumber: row.accountNumber,
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
        }).then((result) => {
          if (!result?.ok) return showToast(result?.error?.message || 'Unable to submit journal');
          journal.splice(0);
          attachmentState.fieldNote = null;
          attachmentState.loading = false;
          state.ui.generatedJournals[visibilityKey] = false;
          const input = byId('journalFieldNoteInput');
          if (input) input.value = '';
          save();
          showToast(`${kind === 'credit' ? 'Credit' : 'Debit'} journal sent for approval`);
          renderWorkspace();
        });
      });
    };

    updateSingleCommissionPreview();
    updateJournalCommissionPreview();
    recalcPreview();
  }

  function bindApprovals() {
    qq('[data-approve]').forEach(btn => btn.onclick = () => {
      if (!hasPermission('approval_queue')) return showToast('No approval rights');
      confirmAction('Approve this request?', () => { approveRequestRemote(btn.dataset.approve).then((result) => { if (result?.ok === false) showToast(result?.error?.message || 'Unable to approve request'); }); });
    });
    qq('[data-reject]').forEach(btn => btn.onclick = () => {
      if (!hasPermission('approval_queue')) return showToast('No approval rights');
      confirmAction('Reject this request?', () => { rejectRequestRemote(btn.dataset.reject).then((result) => { if (result?.ok === false) showToast(result?.error?.message || 'Unable to reject request'); }); });
    });
    qq('[data-cod-resolve]').forEach(btn => btn.onclick = () => openCODResolutionModal(btn.dataset.codResolve));
    const more = byId('approvalsMore');
    if (more) more.onclick = () => { state.ui.approvalsLimit = (state.ui.approvalsLimit || 20) + 20; save(); renderWorkspace(); };
    const less = byId('approvalsLess');
    if (less) less.onclick = () => { state.ui.approvalsLimit = Math.max(20, (state.ui.approvalsLimit || 20) - 20); save(); renderWorkspace(); };
    const codDate = byId('codAdminDate');
    if (codDate) codDate.onchange = () => { state.ui.codAdminDate = codDate.value || businessDate(); save(); renderWorkspace(); };
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
        openJournalApprovalModal(this.dataset.inspectJournal);
      }, true);
    });
    qq('[data-inspect-request]').forEach(btn => btn.onclick = ()=> openRequestDetailModal(btn.dataset.inspectRequest));
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
    const list = category === 'income' ? state.operations.incomeAccounts : state.operations.expenseAccounts;
    const base = category === 'income' ? 2000 : 3000;
    return `${category === 'income' ? 'INC' : 'EXP'}-${base + list.length}`;
  }

  function bindOperationalAccounts() {
    const updatePreview = () => {
      const cat = byId('oaCategory').value;
      byId('oaNumberPreview').textContent = nextOperationalNumber(cat);
    };
    if (byId('oaCategory')) { updatePreview(); byId('oaCategory').onchange = updatePreview; }
    if (byId('oaCreate')) byId('oaCreate').onclick = () => {
      if (currentStaff()?.role !== 'admin_officer') return showToast('Only admin can create operational accounts');
      const category = byId('oaCategory').value;
      const name = byId('oaName').value.trim();
      if (!name) return showToast('Enter account name');
      createRequest('create_operational_account', { category, name, accountNumber: nextOperationalNumber(category) });
      showToast('Operational account request sent');
      render();
    };
    const syncKind = () => {
      const id = byId('oeAccount').value;
      const income = state.operations.incomeAccounts.find(a=>a.id===id);
      byId('oeKindDisplay').textContent = income ? 'Income' : 'Expense';
    };
    syncKind();
    byId('oeAccount').onchange = syncKind;
    byId('oeSubmit').onclick = () => {
      const accountId = byId('oeAccount').value;
      const amount = Number(byId('oeAmount').value || 0);
      const date = byId('oeDate').value || today();
      const note = byId('oeNote').value.trim();
      if (!(amount > 0)) return showToast('Enter amount');
      const account = [...state.operations.incomeAccounts, ...state.operations.expenseAccounts].find(a=>a.id===accountId);
      if (!account) return showToast('Select account');
      const kind = state.operations.incomeAccounts.some(a=>a.id===accountId) ? 'income' : 'expense';
      createRequest('operational_entry', { accountId, accountName: account.name, kind, amount, note, date });
      showToast('Operational posting sent for approval');
      render();
    };
  }

  function openFloatModal() {
    const st = currentStaff();
    const requiresFloat = hasPermission('credit') || hasPermission('debit');
    if (!requiresFloat) return showToast('Current staff does not need posting float');
    if (hasFloatDeclaredOrPending(st.id, businessDate())) return showToast('Form already declared for today');
    openModal('Form', `
      <div class="form-grid three compact-modal-grid">
        <div class="field"><label>Staff</label><div class="display-field">${st.name}</div></div>
        <div class="field field-date-compact"><label>Date</label><div class="display-field compact-date-display">${businessDate()}</div></div>
        <div class="field"><label>Amount</label><input id="floatAmount" class="entry-input" type="number"></div>
      </div>
      <div class="note">Posting cannot begin until this form is approved.</div>
    </div>`, [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Submit', onClick: () => {
          const amount = Number(byId('floatAmount').value || 0);
          if (!(amount > 0)) return showToast('Enter valid float');
          if (hasFloatDeclaredOrPending(st.id, businessDate())) return showToast('Form already declared for today');
          createRequest('float_declaration', { staffId: st.id, amount, date: businessDate() });
          closeModal();
          render();
          showToast('Float declaration sent for approval');
      }}
    ]);
  }

  function openCODModal() {
    if (!canCloseBusinessDay()) return showToast('Only Approval Officer or Admin can close day');
    const postingStaff = state.staff.filter(st => hasPermission('credit', st) || hasPermission('debit', st));
    const rows = postingStaff.map(st => {
      const formAmount = getOpeningBalanceForDate(st.id, businessDate());
      const creditCash = approvedCreditTotalForDateByMode(st.id, businessDate(), 'cash');
      const creditTransfer = approvedCreditTotalForDateByMode(st.id, businessDate(), 'transfer');
      const debitCash = approvedDebitTotalForDateByMode(st.id, businessDate(), 'cash');
      const debitTransfer = approvedDebitTotalForDateByMode(st.id, businessDate(), 'transfer');
      const credits = creditCash + creditTransfer;
      const debits = debitCash + debitTransfer;
      const netBook = credits - debits;
      const running = currentFloatAvailable(st.id, businessDate());
      const variance = Math.max(0, -running);
      const overdraw = Math.max(0, -running);
      return `<tr><td>${st.name}</td><td>${money(formAmount)}</td><td>${money(creditCash)}</td><td>${money(creditTransfer)}</td><td>${money(credits)}</td><td>${money(debitCash)}</td><td>${money(debitTransfer)}</td><td>${money(debits)}</td><td class="${netBook<0?'balance-negative':''}">${money(netBook)}</td><td class="${running<0?'balance-negative':''}">${money(running)}</td><td class="${variance>0?'balance-negative':''}">${money(variance)}</td><td class="${overdraw>0?'balance-negative':''}">${money(overdraw)}</td><td><input class="entry-input" data-cod-note="${st.id}"></td></tr>`;
    }).join('');
    openModal('Central Close of Day', `<div class="stack"><div class="note">You are closing business date <strong>${businessDate()}</strong>. Closing opens the next business date immediately.</div><div class="note">Form is the approved opening money collected from the field. Remaining Balance reduces as staff use the form. Net Balance is Total Credits minus Total Debits. Variance and Overdraw are derived from how the form is used.</div><div class="table-wrap"><table class="table"><thead><tr><th>Staff</th><th>Form</th><th>Credit Cash</th><th>Credit Transfer</th><th>Total Credits</th><th>Debit Cash</th><th>Debit Transfer</th><th>Total Debits</th><th>Net Balance</th><th>Remaining Balance</th><th>Variance</th><th>Overdraw</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table></div></div></div>`, [{label:'Cancel', className:'secondary', onClick: closeModal}, {label:'Close Business Day', onClick: async ()=> {
      if (isSupabaseApprovalMode() && gateway.cod?.submitCod) {
        for (const st of postingStaff) {
          const formAmount = getOpeningBalanceForDate(st.id,businessDate());
          const creditCash = approvedCreditTotalForDateByMode(st.id, businessDate(), 'cash');
          const creditTransfer = approvedCreditTotalForDateByMode(st.id, businessDate(), 'transfer');
          const debitCash = approvedDebitTotalForDateByMode(st.id, businessDate(), 'cash');
          const debitTransfer = approvedDebitTotalForDateByMode(st.id, businessDate(), 'transfer');
          const credits = creditCash + creditTransfer;
          const debits = debitCash + debitTransfer;
          const netBook = credits - debits;
          const running = currentFloatAvailable(st.id,businessDate());
          const note=q(`[data-cod-note="${st.id}"]`)?.value?.trim()||'';
          const variance=Math.max(0,-running);
          const overdraw=Math.max(0,-running);
          const result = await gateway.cod.submitCod({ staffId: st.id, businessDate: businessDate(), actualCash: running, note, submittedByStaffId: currentStaff()?.id || st.id });
          if (result?.ok && result.data) {
            const existingIndex = (state.cod || []).findIndex(item => item.id === result.data.id);
            const nextRow = Object.assign({}, result.data, { staffName: st.name, formAmount, openingBalance: formAmount, totalCreditCash: creditCash, totalCreditTransfer: creditTransfer, totalDebitCash: debitCash, totalDebitTransfer: debitTransfer, totalCredits: credits, totalDebits: debits, netBookBalance: netBook, actualCash: running, expectedCash: running, runningFloat: running, remainingBalance: running, variance, overdraw, note });
            if (existingIndex >= 0) state.cod.splice(existingIndex, 1, nextRow); else state.cod.unshift(nextRow);
          } else if (result?.ok === false) { showToast(result.error?.message || 'Unable to submit close of day'); return; }
        }
      } else {
        postingStaff.forEach(st => {
          const formAmount=getOpeningBalanceForDate(st.id,businessDate());
          const creditCash = approvedCreditTotalForDateByMode(st.id, businessDate(), 'cash');
          const creditTransfer = approvedCreditTotalForDateByMode(st.id, businessDate(), 'transfer');
          const debitCash = approvedDebitTotalForDateByMode(st.id, businessDate(), 'cash');
          const debitTransfer = approvedDebitTotalForDateByMode(st.id, businessDate(), 'transfer');
          const credits=creditCash+creditTransfer;
          const debits=debitCash+debitTransfer;
          const netBook=credits-debits;
          const running=currentFloatAvailable(st.id,businessDate());
          const note=q(`[data-cod-note="${st.id}"]`)?.value?.trim()||'';
          const variance=Math.max(0,-running);
          const overdraw=Math.max(0,-running);
          state.cod.unshift({id:uid('cod'), staffId:st.id, staffName:st.name, date:businessDate(), formAmount, openingBalance:formAmount, totalCreditCash:creditCash, totalCreditTransfer:creditTransfer, totalDebitCash:debitCash, totalDebitTransfer:debitTransfer, totalCredits:credits, totalDebits:debits, netBookBalance:netBook, actualCash:running, expectedCash:running, runningFloat:running, remainingBalance:running, variance, overdraw, note, fieldPapers:[], status: variance===0 && overdraw===0 ? 'balanced':'flagged', approvedAt:new Date().toISOString(), approvedBy:currentStaff()?.name||''});
        });
      }
      state.dayClosures.push({date:businessDate(), closedAt:new Date().toISOString(), closedBy:currentStaff()?.name||''}); state.businessDate = nextDate(businessDate()); save(); closeModal(); render(); showToast(`Business day closed. New open date: ${state.businessDate}`); }}]);
  }

  function openAuditModal() {
    const st = currentStaff();
    const rows = state.audit.filter(a => st?.role === 'admin_officer' || a.actorId === st?.id || a.actor === st?.name).map(a=>`<tr><td>${fmtDate(a.at)}</td><td>${a.actor}</td><td>${a.action}</td><td>${a.details}</td></tr>`).join('');
    openModal('Audit Trail', `<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Actor</th><th>Action</th><th>Details</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No audit records</td></tr>'}</tbody></table></div></div>`, [{label:'Close', onClick: closeModal}]);
  }

  function staffName(id) { return state.staff.find(s=>s.id===id)?.name || id; }
  function customerName(id) { return state.customers.find(c=>c.id===id)?.name || ''; }
  function getSelectedCustomer() { return state.customers.find(c => c.id === state.ui.selectedCustomerId) || null; }
  function balanceHtml(n){ return `<span class="${Number(n)<0 ? 'balance-negative' : ''}">${money(n)}</span>`; }
  function isCustomerFrozen(c){ if(!c) return false; if(c.frozen) return true; const last=(c.transactions||[]).slice().sort((a,b)=>new Date(b.date)-new Date(a.date))[0]; if(!last) return false; const days=(Date.now()-new Date(last.date).getTime())/86400000; return days>=90; }
  function customerStatusLabel(c){ if(!c) return '—'; return (!c.active || isCustomerFrozen(c)) ? 'Frozen' : 'Active'; }
  function freezeInactiveCustomer(c){ if(!c) return; if(c.active === false) c.frozen = true; }

  function openCustomerSearchModal(list) {
    const renderRows = arr => arr.map(c=>`<tr><td>${c.accountNumber}</td><td>${c.name}</td><td>${c.phone}</td><td><span class="linklike" data-pick="${c.id}">Select</span></td></tr>`).join('');
    openModal('Customer Search', `<div class="stack"><input id="modalCustomerSearch" class="entry-input" placeholder="Search customer by name or account number"><div class="table-wrap"><table class="table"><thead><tr><th>Account Number</th><th>Name</th><th>Phone</th><th></th></tr></thead><tbody id="modalCustomerRows">${renderRows(list)}</tbody></table></div></div></div>`, [{label:'Close', className:'secondary', onClick: closeModal}]);
    const bindPicks = () => qq('[data-pick]').forEach(el => el.onclick = () => { state.ui.selectedCustomerId = el.dataset.pick; save(); closeModal(); applySelectedCustomerToActiveTool(); });
    bindPicks();
    const search = byId('modalCustomerSearch');
    if (search) search.oninput = () => {
      const qv = search.value.trim().toLowerCase();
      const filtered = !qv ? list : list.filter(c => String(c.accountNumber).includes(qv) || c.name.toLowerCase().includes(qv));
      byId('modalCustomerRows').innerHTML = renderRows(filtered); bindPicks();
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
    return hasBaseOpeningBalanceForDate(staffId, dateStr) || state.approvals.some(r => r.type === 'float_declaration' && r.status === 'pending' && r.payload.staffId === staffId && r.payload.date === dateStr);
  }

  function hasBaseOpeningBalanceForDate(staffId, dateStr) {
    const acc = ensureStaffAccount(staffId);
    return acc.entries.some(e => e.type === 'approved_float' && e.floatDate === dateStr);
  }

  function hasOpeningBalanceForDate(staffId, dateStr) {
    const acc = ensureStaffAccount(staffId);
    return acc.entries.some(e => ['approved_float','approved_float_topup'].includes(e.type) && e.floatDate === dateStr);
  }

  function openingBalanceOnlyForDate(staffId, dateStr) {
    const acc = ensureStaffAccount(staffId);
    return acc.entries.filter(e => e.type === 'approved_float' && e.floatDate === dateStr).reduce((s,e)=>s+Number(e.amount||0),0);
  }

  function floatTopUpsForDate(staffId, dateStr) {
    if (isSupabaseApprovalMode()) {
      return (state.approvals || []).filter(r => r.type === 'float_topup' && r.status === 'approved' && r.payload?.staffId === staffId && r.payload?.date === dateStr).reduce((s, r) => s + Number(r.payload?.amount || 0), 0);
    }
    const acc = ensureStaffAccount(staffId);
    return acc.entries.filter(e => e.type === 'approved_float_topup' && e.floatDate === dateStr).reduce((s,e)=>s+Number(e.amount||0),0);
  }

  function getOpeningBalanceForDate(staffId, dateStr) {
    return openingBalanceOnlyForDate(staffId, dateStr) + floatTopUpsForDate(staffId, dateStr);
  }


  function normalizePaymentMode(mode) {
    return String(mode || '').trim().toLowerCase() === 'transfer' ? 'transfer' : 'cash';
  }

  function approvalModeAmount(record, mode) {
    const desiredMode = normalizePaymentMode(mode);
    if (!record || record.status !== 'approved') return 0;
    if (record.type === 'customer_credit_journal' || record.type === 'customer_debit_journal') {
      return (record.payload?.rows || []).reduce((sum, row) => sum + (normalizePaymentMode(row.paymentMode || row.payoutSource) === desiredMode ? Number(row.amount || 0) : 0), 0);
    }
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
    return (state.approvals||[]).filter(r => ['customer_credit','customer_credit_journal'].includes(r.type) && r.status === 'approved' && r.payload?.staffId === staffId && r.payload?.date === dateStr).reduce((s,r)=> s + (r.type==='customer_credit_journal' ? (r.payload.rows||[]).reduce((a,x)=>a+Number(x.amount||0),0) : Number(r.payload?.amount||0)), 0);
  }

  function approvedDebitTotalForDate(staffId, dateStr) {
    return (state.approvals||[]).filter(r => ['customer_debit','customer_debit_journal'].includes(r.type) && r.status === 'approved' && r.payload?.staffId === staffId && r.payload?.date === dateStr).reduce((s,r)=> s + (r.type==='customer_debit_journal' ? (r.payload.rows||[]).reduce((a,x)=>a+Number(x.amount||0),0) : Number(r.payload?.amount||0)), 0);
  }

  function pendingPostedFloatImpactForDate(staffId, dateStr) {
    return (state.approvals||[])
      .filter(r => ['customer_credit','customer_debit','customer_credit_journal','customer_debit_journal'].includes(r.type)
        && r.status === 'pending'
        && r.payload?.staffId === staffId
        && r.payload?.date === dateStr)
      .reduce((s,r)=> s + (r.type.endsWith('_journal') ? (r.payload.rows||[]).reduce((a,x)=>a+Number(x.amount||0),0) : Number(r.payload?.amount||0)), 0);
  }

  function currentFloatAvailable(staffId, date=businessDate()) {
    const opening = getOpeningBalanceForDate(staffId, date);
    const usedApproved = approvedCreditTotalForDate(staffId, date);
    const debitsApproved = approvedDebitTotalForDate(staffId, date);
    const pendingPosted = pendingPostedFloatImpactForDate(staffId, date);
    return opening - usedApproved - debitsApproved - pendingPosted;
  }

  function currentFloatOverdraw(staffId, date=businessDate()) {
    return Math.max(0, -currentFloatAvailable(staffId, date));
  }

  function pendingJournalTotal(staffId, date=businessDate()) {
    const journals = state.ui?.staffJournals || {};
    const creditKey = `${staffId}:${date}:credit`;
    const debitKey = `${staffId}:${date}:debit`;
    const total = (arr => (arr||[]).reduce((s,r)=>s+Number(r.amount||0),0));
    return total(journals[creditKey]) + total(journals[debitKey]);
  }

  function staffCODRecords(staffId) {
    return (state.cod || []).filter(c => c.staffId === staffId);
  }

  function openMyBalanceModal() {
    const st = currentStaff();
    const acc = ensureStaffAccount(st.id);
    openModal('My Balance', `<div class="modal-sheet my-balance-sheet"><div class="modal-sheet my-balance-sheet">
      <div class="stack my-balance-modal">
        <div class="kpi-row">
          <div class="kpi"><div class="label">Wallet Balance</div><div class="number">${money(acc.walletBalance||0)}</div></div>
          <div class="kpi"><div class="label">Debt Balance</div><div class="number ${Number(acc.debtBalance||0)>0 ? 'balance-negative' : ''}">-${money(acc.debtBalance||0)}</div></div>
          <div class="kpi"><div class="label">Form</div><div class="number">${money(getOpeningBalanceForDate(st.id, businessDate()))}</div></div>
          <div class="kpi"><div class="label">Remaining Balance Today</div><div class="number">${money(currentFloatAvailable(st.id, businessDate()))}</div></div>
        </div>
        <div class="form-grid three">
          <div class="field"><label>Wallet Funding Amount</label><input id="walletFundAmt" class="entry-input my-balance-input" type="number"></div>
          <div class="field"><label>Debt Repayment Amount</label><input id="walletRepayAmt" class="entry-input my-balance-input" type="number"></div>
          <div class="field"><label>Note</label><input id="walletNote" class="entry-input my-balance-input"></div>
        </div>
      </div>
    `,[
      {label:'Fund Wallet', onClick: ()=> {
        const amt = Number(byId('walletFundAmt').value||0); if(!(amt>0)) return showToast('Enter amount');
        createRequest('wallet_fund',{staffId:st.id,amount:amt,note:byId('walletNote').value.trim()}); closeModal(); render(); showToast('Wallet funding sent for approval');
      }},
      {label:'Pay Debt', onClick: ()=> {
        const amt = Number(byId('walletRepayAmt').value||0); if(!(amt>0)) return showToast('Enter amount');
        if (amt > Number(acc.walletBalance||0)) return showToast('Insufficient wallet balance');
        if (amt > Number(acc.debtBalance||0)) return showToast('Amount exceeds debt');
        createRequest('debt_repayment',{staffId:st.id,amount:amt,note:byId('walletNote').value.trim()}); closeModal(); render(); showToast('Debt repayment sent for approval');
      }},
      {label:'Close', className:'secondary', onClick: closeModal}
    ]);
  }

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
    const remainingBalance = c ? Number(c.remainingBalance ?? c.runningFloat ?? currentFloatAvailable(c.staffId, c.date)) : 0;
    const varianceValue = c ? Number(c.variance ?? Math.max(0, -remainingBalance)) : 0;
    const overdrawValue = c ? Number(c.overdraw ?? Math.max(0, -remainingBalance)) : 0;
    const summary = c ? `
      <div class="kpi-row wrap cod-summary-grid">
        <div class="kpi"><div class="label">Form</div><div class="number">${money(c.formAmount ?? c.openingBalance ?? getOpeningBalanceForDate(c.staffId, c.date))}</div></div>
        <div class="kpi"><div class="label">Credit Cash</div><div class="number">${money(totalCreditCash)}</div></div>
        <div class="kpi"><div class="label">Credit Transfer</div><div class="number">${money(totalCreditTransfer)}</div></div>
        <div class="kpi"><div class="label">Total Credits</div><div class="number">${money(totalCredits)}</div></div>
        <div class="kpi"><div class="label">Debit Cash</div><div class="number">${money(totalDebitCash)}</div></div>
        <div class="kpi"><div class="label">Debit Transfer</div><div class="number">${money(totalDebitTransfer)}</div></div>
        <div class="kpi"><div class="label">Total Debits</div><div class="number">${money(totalDebits)}</div></div>
        <div class="kpi"><div class="label">Net Balance</div><div class="number ${netBook<0?'balance-negative':''}">${money(netBook)}</div></div>
        <div class="kpi"><div class="label">Remaining Balance</div><div class="number ${remainingBalance<0?'balance-negative':''}">${money(remainingBalance)}</div></div>
        <div class="kpi"><div class="label">Variance</div><div class="number ${varianceValue>0?'balance-negative':''}">${money(varianceValue)}</div></div>
        <div class="kpi"><div class="label">Overdraw</div><div class="number ${overdrawValue>0?'balance-negative':''}">${money(overdrawValue)}</div></div>
      </div>
      <div class="note">Form is the approved opening money collected from the field. Net Balance is Total Credits minus Total Debits. Remaining Balance, Variance, and Overdraw reflect how the form was used.</div>
      <div class="note"><strong>Status:</strong> ${c.status || 'balanced'} • <strong>Manager Note:</strong> ${c.resolutionNote || c.note || '—'}</div>` : `<div class="note">No close-of-day record for selected date.</div>`;
    openModal('My Close of Day', `<div class="modal-sheet my-close-day-sheet"><div class="stack"><div class="action-inline"><div class="inline-field compact"><span>COD Date</span><input type="date" id="myCodDate" value="${state.ui.myCodDate}"></div></div>${summary}</div></div>`, [{label:'Close', className:'secondary', onClick: closeModal}]);
    const picker = byId('myCodDate');
    if (picker) picker.onchange = () => { state.ui.myCodDate = picker.value || businessDate(); save(); openMyCODModal(state.ui.myCodDate); };
  }

  function openCODResolutionModal(codId) {
    const cod = state.cod.find(c => c.id === codId);
    if (!cod) return;
    const formAmount = Number(cod.formAmount ?? cod.openingBalance ?? getOpeningBalanceForDate(cod.staffId, cod.date));
    const totalCreditCash = Number(cod.totalCreditCash ?? approvedCreditTotalForDateByMode(cod.staffId, cod.date, 'cash'));
    const totalCreditTransfer = Number(cod.totalCreditTransfer ?? approvedCreditTotalForDateByMode(cod.staffId, cod.date, 'transfer'));
    const totalDebitCash = Number(cod.totalDebitCash ?? approvedDebitTotalForDateByMode(cod.staffId, cod.date, 'cash'));
    const totalDebitTransfer = Number(cod.totalDebitTransfer ?? approvedDebitTotalForDateByMode(cod.staffId, cod.date, 'transfer'));
    const totalCredits = Number(cod.totalCredits ?? (totalCreditCash + totalCreditTransfer));
    const totalDebits = Number(cod.totalDebits ?? (totalDebitCash + totalDebitTransfer));
    const currentNetBookBalance = Number(cod.netBookBalance ?? (totalCredits - totalDebits));
    const currentRemainingBalance = Number(cod.remainingBalance ?? cod.runningFloat ?? currentFloatAvailable(cod.staffId, cod.date));
    const currentVariance = Number(cod.variance ?? Math.max(0, -currentRemainingBalance));
    const currentOverdraw = Number(cod.overdraw ?? Math.max(0, -currentRemainingBalance));
    const defaultDebt = Math.max(currentOverdraw, currentVariance, Number(cod.debtAmount || 0));
    const isAdminOfficer = currentStaff()?.role === 'admin_officer';
    const savedAcceptedPosition = Number(cod.acceptedPosition ?? currentNetBookBalance);
    const savedAdjustment = Number(cod.adjustment ?? (savedAcceptedPosition - currentNetBookBalance));
    const savedCreateDebt = cod.createDebt ?? ((cod.debtAmount || 0) > 0);
    const savedResolutionType = cod.resolutionType || (savedCreateDebt ? 'staff_debt' : 'balanced');
    openModal('Resolve Close of Day', `
      <div class="stack">
        <div class="note">Form is the approved opening money collected from the field. Net Balance is Total Credits minus Total Debits. Final Agreed Amount corrects the system total only. Debt can still be recorded against staff where required.</div>
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
          <div class="field"><label>Debt Amount</label><input id="codDebtAmount" class="entry-input" type="number" placeholder="Enter teller debt amount" value="${cod.debtAmount ?? defaultDebt}"></div>
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
        if (isSupabaseApprovalMode() && gateway.cod?.resolveCod) {
          const result = await gateway.cod.resolveCod({ codSubmissionId: cod.id, finalAgreedAmount: acceptedPosition, debtAmount: debtAmt, resolutionNote: note, resolvedByStaffId: currentStaff()?.id || '' });
          if (result?.ok === false) return showToast(result.error?.message || 'Unable to resolve COD');
          if (result?.ok && result.data) {
            Object.assign(cod, result.data, { status: 'resolved', resolutionType, reversalNeeded: resolutionType === 'reversal_needed', createDebt, staffName: cod.staffName, formAmount, totalCreditCash, totalCreditTransfer, totalDebitCash, totalDebitTransfer, totalCredits, totalDebits, netBookBalance: currentNetBookBalance, remainingBalance: currentRemainingBalance, variance: currentVariance, overdraw: currentOverdraw });
            await syncCodFromGateway({ staffId: cod.staffId, businessDate: cod.date });
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
          state.businessExtras ||= [];
          state.businessExtras = state.businessExtras.filter(e => !(e.type === 'cod_adjustment' && e.codId === cod.id));
          if (shouldPostAdjustment) {
            state.businessExtras.unshift({ date:new Date().toISOString(), accountNumber:'COD', details:`COD adjustment for ${cod.staffName} (${cod.date})`, kind:adjustment > 0 ? 'credit' : 'debit', amount:Math.abs(adjustment), balanceAfter:0, receivedOrPaidBy:cod.staffName, postedBy:currentStaff()?.name || 'System', type:'cod_adjustment', codId: cod.id });
          }
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
        save(); closeModal(); render(); showToast(resolutionType === 'reversal_needed' ? 'COD flagged for reversal/correction' : 'COD resolved');
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
      postedBy: t.postedBy || t.postedById || ''
    }));
    const extras = (state.businessExtras || []).map(e => ({
      ...e,
      accountNumber: e.accountNumber || 'STAFF',
      accountName: e.accountName || e.customerName || e.accountNumber || 'STAFF',
      details: e.details || e.note || '',
      note: e.note || e.details || '',
      type: e.type || e.kind || (Number(e.delta || 0) >= 0 ? 'credit' : 'debit'),
      kind: e.kind || e.type || (Number(e.delta || 0) >= 0 ? 'credit' : 'debit'),
      delta: Number(e.delta || ((e.type || e.kind) === 'debit' ? -Number(e.amount || 0) : Number(e.amount || 0))),
      amount: Number(e.amount || 0),
      balanceAfter: Number(e.balanceAfter || 0),
      receivedOrPaidBy: e.receivedOrPaidBy || e.receivedBy || e.postedBy || '',
      postedBy: e.postedBy || ''
    }));
    return [...txRows, ...extras].sort((a,b)=>new Date(b.date)-new Date(a.date));
  }

  function renderBalanceFilters(kind) {
    const filter = state.ui[`${kind}Filter`] || { preset:'all', from:'', to:'' };
    const presets = [['daily','Daily'],['weekly','Weekly'],['monthly','Monthly'],['all','All']];
    const types = kind==='business' ? [['all','All'],['credit','Credit'],['debit','Debit']] : [['all','All'],['income','Income'],['expense','Expense']]; const activeType = state.ui[`${kind}Type`] || 'all'; return `<div class="form-card balance-filters-card"><div class="action-inline balance-filters-row">${presets.map(([k,l])=>`<button class="filter-chip ${filter.preset===k?'active':'secondary'}" data-filter-kind="${kind}" data-filter-preset="${k}">${l}</button>`).join('')}<label class="inline-field"><span>From</span><input id="${kind}From" type="date" value="${filter.from||''}"></label><label class="inline-field"><span>To</span><input id="${kind}To" type="date" value="${filter.to||''}"></label><button class="secondary" id="${kind}CustomApply">Apply Custom</button><button class="secondary" id="${kind}ExportCsv">Export CSV</button><button class="secondary" id="${kind}PrintSummary">Print Summary</button></div><div class="action-inline balance-filters-row" style="margin-top:10px">${types.map(([k,l])=>`<button class="filter-chip ${activeType===k?'active':'secondary'}" data-type-kind="${kind}" data-type-filter="${k}">${l}</button>`).join('')}</div></div>`;
  }

  function bindBalanceFilters(kind) {
    qq(`[data-filter-kind="${kind}"]`).forEach(btn => btn.onclick = () => {
      state.ui[`${kind}Filter`] = { preset: btn.dataset.filterPreset, from:'', to:'' }; save(); renderWorkspace();
    });
    byId(`${kind}CustomApply`).onclick = () => { state.ui[`${kind}Filter`] = { preset:'custom', from:byId(`${kind}From`).value, to:byId(`${kind}To`).value }; save(); renderWorkspace(); };
    qq(`[data-type-kind="${kind}"]`).forEach(btn => btn.onclick = () => { state.ui[`${kind}Type`] = btn.dataset.typeFilter; save(); renderWorkspace(); });
    const moreBtn = byId(`${kind}More</div>`);
    if (moreBtn) moreBtn.onclick = () => {
      const key = kind === 'business' ? 'businessEntriesLimit' : 'operationalEntriesLimit';
      state.ui[key] = (state.ui[key] || 20) + 20; save(); renderWorkspace();
    };
    const lessBtn = byId(`${kind}Less</div>`);
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
      const rows = filterByDate(flattenBusinessEntries(), state.ui.businessFilter || { preset: 'all', from: '', to: '' });
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

  function filterByDate(rows, filter) {
    const now = new Date();
    return rows.filter(r => {
      const d = new Date(r.date);
      const iso = d.toISOString().slice(0,10);
      if (filter.preset === 'daily') return iso === today();
      if (filter.preset === 'weekly') {
        const start = new Date(now); start.setDate(now.getDate()-6); start.setHours(0,0,0,0); return d >= start;
      }
      if (filter.preset === 'monthly') return d.getFullYear()===now.getFullYear() && d.getMonth()===now.getMonth();
      if (filter.preset === 'custom') {
        if (filter.from && iso < filter.from) return false;
        if (filter.to && iso > filter.to) return false;
      }
      return true;
    });
  }

  function exportCsv(rows, filename) {
    if (!rows.length) return showToast('Nothing to export');
    const cols = Object.keys(rows[0]);
    const csv = [cols.join(',')].concat(rows.map(r => cols.map(k => JSON.stringify(r[k] ?? '')).join(','))).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
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
      if (byId('txAcc')) byId('txAcc').value = c.accountNumber;
      if (byId('txName')) byId('txName').textContent = c.name;
      if (byId('txBalance')) byId('txBalance').textContent = money(c.balance);
      if (byId('journalAcc')) byId('journalAcc').value = c.accountNumber;
      if (byId('journalName')) byId('journalName').textContent = c.name;
      return;
    }
    if (state.ui.tool === 'account_statement') {
      if (byId('stmtAcc')) byId('stmtAcc').value = c.accountNumber;
      return;
    }
    if (state.ui.tool === 'account_maintenance') {
      if (byId('maintenanceAcc')) byId('maintenanceAcc').value = c.accountNumber;
      if (byId('maintenanceName')) byId('maintenanceName').value = c.name || '';
      if (byId('maintenanceAddress')) byId('maintenanceAddress').value = c.address || '';
      if (byId('maintenancePhone')) byId('maintenancePhone').value = c.phone || '';
      if (byId('maintenanceNin')) byId('maintenanceNin').value = c.nin || '';
      if (byId('maintenanceBvn')) byId('maintenanceBvn').value = c.bvn || '';
      if (byId('maintenanceOldAccount')) byId('maintenanceOldAccount').value = c.oldAccountNumber || '';
      if (byId('maintenanceDisplayName')) byId('maintenanceDisplayName').textContent = c.name || '—';
      if (byId('maintenanceDisplayPhone')) byId('maintenanceDisplayPhone').textContent = c.phone || '—';
      if (byId('maintenanceDisplayStatus')) byId('maintenanceDisplayStatus').textContent = customerStatusLabel(c);
      return;
    }
    if (state.ui.tool === 'account_reactivation') {
      if (byId('reactivationAcc')) byId('reactivationAcc').value = c.accountNumber;
      if (byId('reactivationName')) byId('reactivationName').value = c.name || '';
      if (byId('reactivationDisplayName')) byId('reactivationDisplayName').textContent = c.name || '—';
      if (byId('reactivationDisplayPhone')) byId('reactivationDisplayPhone').textContent = c.phone || '—';
      if (byId('reactivationDisplayStatus')) byId('reactivationDisplayStatus').textContent = customerStatusLabel(c);
      return;
    }
  }

  function bindStaffDirectory() {
    const addBtn = byId('addStaffBtn');
    if (addBtn) addBtn.onclick = () => openModal('Add Staff', `
      <div class="form-grid three">
        <div class="field"><label>Name</label><input id="newStaffName" class="entry-input"></div>
        <div class="field"><label>Role</label><select id="newStaffRole" class="entry-input">${Object.keys(ROLE_LABELS).map(k=>`<option value="${k}">${ROLE_LABELS[k]}</option>`).join('')}</select></div>
        <div class="field"><label>Status</label><div class="display-field">Active</div></div>
      </div>
    `,[{label:'Cancel', className:'secondary', onClick: closeModal},{label:'Add Staff', onClick:()=>{ const name=byId('newStaffName').value.trim(); const role=byId('newStaffRole').value; if(!name) return showToast('Enter staff name'); state.staff.push({id:uid('st'), name, role, active:true}); ensureStaffAccount(state.staff[state.staff.length-1].id); save(); closeModal(); render(); showToast('Staff added'); }}]);
    qq('[data-staff-toggle]').forEach(btn => btn.onclick = ()=> {
      const st = state.staff.find(s=>s.id===btn.dataset.staffToggle); if(!st) return; st.active = st.active === false ? true : false; save(); render(); showToast(`Staff ${st.active===false?'deactivated':'reactivated'}</div>`);
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
  }

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
    render();
    if (isSupabaseApprovalMode()) {
      syncApprovalsFromGateway().then((result) => { if (result?.ok) render(); });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp, { once: true });
  } else {
    startApp();
  }
})();



