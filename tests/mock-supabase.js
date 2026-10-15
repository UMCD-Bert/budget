// Minimale in-memory vervanger voor de Supabase-client, voor browser-tests van index.html.
// Ondersteunt de query-keten die de app gebruikt (select/eq/neq/gt/gte/lt/lte/in/is/not/order/range/
// limit/single/maybeSingle/insert/update/upsert/delete) en simuleert de 1000-rijen-limiet van PostgREST.
// Gebruik: installMockSupabase(sb, db, doelWindow) — db is { tabelnaam: [rijen] }; doelWindow krijgt
// __calls (lijst van aangevraagde tabellen) en __db (de data) zodat tests erin kunnen kijken.
window.installMockSupabase = function (sb, db, target) {
  target = target || window;
  let nextId = 100000;
  const byId = (t, id) => (db[t] || []).find(r => String(r.id) === String(id));
  function decorate(table, row) {
    const r = { ...row };
    if (table === 'transactions') {
      const a = byId('accounts', r.account_id); r.accounts = a ? { scope: a.scope, name: a.name, bank: a.bank, type: a.type } : null;
      const c = byId('categories', r.category_id); r.categories = c ? { name: c.name } : null;
    }
    if (table === 'transaction_splits') { const t = byId('transactions', r.transaction_id); r.transactions = t ? { date: t.date } : null; }
    if (table === 'bank_transactions_staging') { const a = byId('accounts', r.account_id); r.accounts = a ? { name: a.name, scope: a.scope } : null; }
    return r;
  }
  const get = (row, col) => col.split('.').reduce((o, k) => (o == null ? undefined : o[k]), row);
  const same = (a, b) => String(a) === String(b);
  function qb(table) {
    const st = { filters: [], order: [], range: null, limit: null, mode: 'select', payload: null, single: false, maybe: false };
    const api = {};
    const add = fn => { st.filters.push(fn); return api; };
    api.select = () => api;
    api.eq = (c, v) => add(r => same(get(r, c), v));
    api.neq = (c, v) => add(r => !same(get(r, c), v));
    api.gte = (c, v) => add(r => get(r, c) >= v);
    api.gt = (c, v) => add(r => get(r, c) > v);
    api.lte = (c, v) => add(r => get(r, c) <= v);
    api.lt = (c, v) => add(r => get(r, c) < v);
    api.in = (c, vs) => add(r => vs.some(v => same(get(r, c), v)));
    api.is = (c, v) => add(r => (get(r, c) ?? null) === v);
    api.not = (c, op, v) => add(r => op === 'is' ? (get(r, c) ?? null) !== v : op === 'in' ? !String(v).replace(/[()]/g, '').split(',').includes(String(get(r, c))) : true);
    api.ilike = (c, v) => add(r => String(get(r, c) || '').toLowerCase().includes(String(v).replace(/%/g, '').toLowerCase()));
    api.or = () => api;
    api.order = (c, o) => { st.order.push([c, !(o && o.ascending === false)]); return api; };
    api.range = (a, b) => { st.range = [a, b]; return api; };
    api.limit = n => { st.limit = n; return api; };
    api.single = () => { st.single = true; return api; };
    api.maybeSingle = () => { st.maybe = true; return api; };
    api.insert = p => { st.mode = 'insert'; st.payload = p; return api; };
    api.update = p => { st.mode = 'update'; st.payload = p; return api; };
    api.upsert = p => { st.mode = 'upsert'; st.payload = p; return api; };
    api.delete = () => { st.mode = 'delete'; return api; };
    const run = () => {
      const rows = db[table] || (db[table] = []);
      if (st.mode === 'insert') {
        const made = [].concat(st.payload).map(p => { const r = { id: nextId++, ...p }; rows.push(r); return r; });
        return { data: (st.single || st.maybe) ? made[0] : made, error: null };
      }
      if (st.mode === 'upsert') {
        [].concat(st.payload).forEach(p => {
          const e = rows.find(r => same(r.category_id, p.category_id) && r.month === p.month);
          if (e) e.assigned = p.assigned; else rows.push({ id: nextId++, ...p, category_id: Number(p.category_id) });
        });
        return { data: null, error: null };
      }
      const hit = r => st.filters.every(f => f(decorate(table, r)));
      if (st.mode === 'update') { rows.forEach(r => { if (hit(r)) Object.assign(r, st.payload); }); return { data: null, error: null }; }
      if (st.mode === 'delete') { db[table] = rows.filter(r => !hit(r)); return { data: null, error: null }; }
      let out = rows.map(r => decorate(table, r)).filter(r => st.filters.every(f => f(r)));
      if (st.order.length) out.sort((a, b) => { for (const [c, asc] of st.order) { const x = get(a, c), y = get(b, c); if (x < y) return asc ? -1 : 1; if (x > y) return asc ? 1 : -1; } return 0; });
      out = st.range ? out.slice(st.range[0], Math.min(st.range[1] + 1, st.range[0] + 1000)) : out.slice(0, 1000);
      if (st.limit != null) out = out.slice(0, st.limit);
      if (st.single || st.maybe) return { data: out[0] || null, error: out[0] || st.maybe ? null : { message: 'geen rij' } };
      return { data: out, error: null };
    };
    api.then = (res, rej) => Promise.resolve(run()).then(res, rej);
    return api;
  }
  target.__calls = [];
  sb.from = t => { target.__calls.push(t); return qb(t); };
  Object.defineProperty(sb, 'functions', { configurable: true, value: { invoke: async () => ({ data: { results: [] }, error: null }) } });
  target.__db = db;
};
