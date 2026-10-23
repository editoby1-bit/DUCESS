// DUCESS Archive Viewer (2026-10-23): a read-only, in-memory stand-in for
// the Supabase client. archive.html loads an archive file and hands its
// tables to this client, so the normal app runs on the saved records —
// exactly as it did before the year was archived — without touching the
// live database. Every write is refused.
(function (global) {
  const READ_ONLY = { code: 'ARCHIVE_READ_ONLY', message: 'Archive view is read-only — changes are not possible here.' };
  const VIEWS = { approval_requests_list_view: 'approval_requests' };

  function cmp(a, b) {
    const na = Number(a), nb = Number(b);
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (a !== '' && b !== '' && !isNaN(na) && !isNaN(nb) && !/^\d{4}-\d{2}-\d{2}/.test(String(a))) return na - nb;
    const da = Date.parse(a), db = Date.parse(b);
    if (!isNaN(da) && !isNaN(db)) return da - db;
    return String(a).localeCompare(String(b));
  }
  const likeToRegex = (p) => new RegExp('^' + String(p).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i');

  // PostgREST "or" filter: a,b,c where each is column.operator.value
  function parseOr(expr) {
    return String(expr).split(',').map(part => {
      const m = part.trim().match(/^([\w]+)\.(eq|ilike|like|neq)\.(.*)$/);
      if (!m) return () => true;
      const [, col, op, val] = m;
      if (op === 'eq') return r => String(r[col]) === val;
      if (op === 'neq') return r => String(r[col]) !== val;
      const re = likeToRegex(val);
      return r => re.test(String(r[col] ?? ''));
    });
  }

  function create(tables) {
    const db = tables || {};
    function builder(rawTable) {
      const table = VIEWS[rawTable] || rawTable;
      let cols = '*', opts = {}, single = null, lim = null, rng = null, write = false;
      const filters = [], orders = [];
      const b = {
        select(c = '*', o = {}) { cols = c; opts = o || {}; return b; },
        insert() { write = true; return b; }, update() { write = true; return b; }, upsert() { write = true; return b; }, delete() { write = true; return b; },
        eq(c, v) { filters.push(r => String(r[c]) === String(v)); return b; },
        neq(c, v) { filters.push(r => String(r[c]) !== String(v)); return b; },
        in(c, vs) { const s = new Set((vs || []).map(String)); filters.push(r => s.has(String(r[c]))); return b; },
        not(c, op, v) { if (op === 'is' && v === null) filters.push(r => r[c] != null); else if (op === 'eq') filters.push(r => String(r[c]) !== String(v)); return b; },
        is(c, v) { filters.push(r => (v === null ? r[c] == null : r[c] === v)); return b; },
        gt(c, v) { filters.push(r => r[c] != null && cmp(r[c], v) > 0); return b; },
        gte(c, v) { filters.push(r => r[c] != null && cmp(r[c], v) >= 0); return b; },
        lt(c, v) { filters.push(r => r[c] != null && cmp(r[c], v) < 0); return b; },
        lte(c, v) { filters.push(r => r[c] != null && cmp(r[c], v) <= 0); return b; },
        ilike(c, p) { const re = likeToRegex(p); filters.push(r => re.test(String(r[c] ?? ''))); return b; },
        like(c, p) { return b.ilike(c, p); },
        or(expr) { const ors = parseOr(expr); filters.push(r => ors.some(f => f(r))); return b; },
        match(o) { Object.entries(o || {}).forEach(([c, v]) => b.eq(c, v)); return b; },
        order(c, o = {}) { orders.push([c, o.ascending !== false]); return b; },
        limit(n) { lim = n; return b; },
        range(a, z) { rng = [a, z]; return b; },
        maybeSingle() { single = 'maybe'; return b; },
        single() { single = 'one'; return b; },
        then(res, rej) { return Promise.resolve().then(run).then(res, rej); },
      };
      function project(r) {
        if (!cols || cols === '*') return { ...r };
        const o = {};
        String(cols).split(',').map(s => s.trim()).filter(Boolean).forEach(k => { o[k] = r[k] === undefined ? null : r[k]; });
        return o;
      }
      function run() {
        if (write) return { data: null, error: READ_ONLY, count: null };
        let rows = (db[table] || []).filter(r => filters.every(f => f(r)));
        orders.slice().reverse().forEach(([c, asc]) => {
          rows = rows.slice().sort((a, z) => { if (a[c] == null) return 1; if (z[c] == null) return -1; const d = cmp(a[c], z[c]); return asc ? d : -d; });
        });
        const count = opts.count ? rows.length : null;
        if (rng) rows = rows.slice(rng[0], rng[1] + 1);
        if (lim != null) rows = rows.slice(0, lim);
        let data = opts.head ? null : rows.map(project);
        if (single) data = data && data.length ? data[0] : null;
        return { data, error: null, count };
      }
      return b;
    }

    let session = null;
    const client = {
      from: builder,
      // No database functions in the viewer: the app falls back to plain reads.
      rpc: async (name) => ({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name} (archive view)` } }),
      auth: {
        async signInWithPassword({ email }) {
          const code = String(email || '').split('@')[0].toUpperCase();
          const st = (db.staff || []).find(s => String(s.staff_code || '').toUpperCase() === code || String(s.auth_email || '').toLowerCase() === String(email || '').toLowerCase());
          if (!st) return { data: null, error: { message: 'No staff member with that Staff ID in this archive.' } };
          session = { access_token: 'archive-view', expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: st.auth_user_id || st.id, email } };
          return { data: { session, user: session.user }, error: null };
        },
        async getSession() { return { data: { session }, error: null }; },
        async getUser() { return { data: { user: session?.user || null }, error: null }; },
        async signOut() { session = null; return { error: null }; },
        async updateUser() { return { data: null, error: READ_ONLY }; },
        onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      },
      channel() { const ch = { on() { return ch; }, subscribe(cb) { setTimeout(() => cb && cb('SUBSCRIBED'), 0); return ch; } }; return ch; },
      removeChannel() {},
    };
    return client;
  }

  global.DucessArchiveClient = { create };
})(window);
