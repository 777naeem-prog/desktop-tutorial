'use strict';
/* NN Trading POS — optional cloud sync (Supabase).
   The app always works from this device's own copy. When signed in, every document,
   customer, vehicle and the settings are mirrored to the cloud and to other devices
   signed in with the same account. The key below is a publishable key: it only
   grants what the database's row-level security allows a signed-in user. */

const SB_URL = 'https://eveceikpyjjqylqzblis.supabase.co';
const SB_KEY = 'sb_publishable_pdJ6kGdHEdr6mD8m8CCoTA_oqmNnvh0';
const SYNC_KEY = 'nn-pos-sync-v1';

const Sync = (() => {
  // shadow: fingerprint of each record as the cloud last had it; lastPull: newest cloud change seen
  const blank = () => ({ session: null, shadow: {}, lastPull: '' });
  let st = blank();
  try { st = Object.assign(blank(), JSON.parse(localStorage.getItem(SYNC_KEY) || '{}')); } catch (e) { /* start fresh */ }
  let busy = false, again = false, timer = null;
  let state = 'idle', lastOk = 0, lastError = '';

  const persist = () => { try { localStorage.setItem(SYNC_KEY, JSON.stringify(st)); } catch (e) { /* storage full */ } };

  /* The database reorders JSON keys, so fingerprints use a key-sorted form. */
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  function fingerprint(v) {
    const s = canon(v);
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + '.' + s.length;
  }

  const LISTS = { doc: 'docs', customer: 'customers', vehicle: 'vehicles' };
  function localMap() {
    // settings are only shared once this device has been set up, so a blank device never overwrites real ones
    const m = db.settings.setupDone ? { 'settings:main': db.settings } : {};
    for (const kind in LISTS) for (const r of db[LISTS[kind]]) m[kind + ':' + r.id] = r;
    return m;
  }
  function applyRemote(row) {
    if (row.kind === 'settings') {
      if (!row.deleted) db.settings = mergeDeep(defaultData().settings, row.data);
      return;
    }
    const list = db[LISTS[row.kind]];
    if (!list) return;
    const i = list.findIndex((r) => r.id === row.id);
    if (row.deleted) { if (i >= 0) list.splice(i, 1); }
    else if (i >= 0) list[i] = row.data;
    else list.push(row.data);
  }
  /* two devices that were offline may both have used the same next number */
  function fixNumbering() {
    for (const type of Object.keys(DOC_TYPES)) {
      const n = db.settings.numbering[type];
      let max = 0;
      for (const d of db.docs) {
        if (d.type !== type || !String(d.number).startsWith(n.prefix)) continue;
        const m = /(\d+)$/.exec(d.number);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      }
      if (num(n.next) <= max) n.next = max + 1;
    }
  }

  /* ---------- auth ---------- */
  async function authCall(path, body) {
    const r = await fetch(SB_URL + '/auth/v1/' + path, { method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      let msg = j.msg || j.error_description || j.message || 'Could not sign in';
      if (/database error/i.test(msg)) msg = 'This email has not been invited. Ask the person who set up the app to add it.';
      const e = new Error(msg);
      e.auth = true;
      throw e;
    }
    return j;
  }
  function setSession(j) {
    st.session = {
      access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000,
      email: (j.user && j.user.email) || (st.session && st.session.email) || '',
    };
    persist();
  }
  async function token() {
    if (!st.session) throw new Error('Not signed in');
    if (st.session.exp - Date.now() < 60000) {
      try { setSession(await authCall('token?grant_type=refresh_token', { refresh_token: st.session.refresh })); }
      catch (e) {
        if (e.auth) { st.session = null; persist(); throw new Error('Signed out — please sign in again'); }
        throw e;
      }
    }
    return st.session.access;
  }
  async function rest(method, qs, body, prefer) {
    const t = await token();
    const headers = { apikey: SB_KEY, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
    if (prefer) headers.Prefer = prefer;
    const r = await fetch(SB_URL + '/rest/v1/records' + qs, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error('The cloud refused the request (' + r.status + ')');
    return method === 'GET' ? r.json() : null;
  }

  /* ---------- the sync itself: pull what changed in the cloud, then push what changed here ---------- */
  async function run() {
    if (!st.session) return;
    if (busy) { again = true; return; }
    busy = true; setState('syncing');
    try {
      let applied = false, newest = st.lastPull;
      const since = st.lastPull ? '&updated_at=gt.' + encodeURIComponent(st.lastPull) : '';
      for (let offset = 0; ; offset += 500) {
        const rows = await rest('GET', `?select=kind,id,data,deleted,updated_at&order=updated_at.asc,kind.asc,id.asc&limit=500&offset=${offset}${since}`);
        const local = localMap();
        for (const row of rows) {
          const key = row.kind + ':' + row.id;
          const theirs = row.deleted ? 'x' : fingerprint(row.data);
          const ours = key in local ? fingerprint(local[key]) : 'x';
          const known = st.shadow[key];
          if (row.updated_at > newest) newest = row.updated_at;
          if (theirs === ours) { st.shadow[key] = theirs; continue; }
          // Changed here since the last sync as well: keep this device's version (it is pushed below).
          if (known !== undefined && ours !== known) continue;
          // Never let settings from a device that was not set up replace this device's real ones.
          if (row.kind === 'settings' && db.settings.setupDone && !(row.data && row.data.setupDone)) continue;
          applyRemote(row);
          st.shadow[key] = theirs;
          applied = true;
        }
        if (rows.length < 500) break;
      }
      st.lastPull = newest;
      if (applied) { fixNumbering(); saveDb(true); }

      const local = localMap(), out = [];
      for (const key in local) {
        const fp = fingerprint(local[key]);
        if (st.shadow[key] !== fp) out.push({ key, fp, deleted: false, data: local[key] });
      }
      for (const key in st.shadow) {
        if (!(key in local) && st.shadow[key] !== 'x') out.push({ key, fp: 'x', deleted: true, data: {} });
      }
      for (let i = 0; i < out.length; i += 40) {
        const chunk = out.slice(i, i + 40);
        await rest('POST', '?on_conflict=user_id,kind,id', chunk.map((o) => {
          const cut = o.key.indexOf(':');
          return { kind: o.key.slice(0, cut), id: o.key.slice(cut + 1), data: o.data, deleted: o.deleted };
        }), 'resolution=merge-duplicates,return=minimal');
        for (const o of chunk) st.shadow[o.key] = o.fp;
        persist();
      }
      persist();
      lastOk = Date.now(); lastError = '';
      setState('ok');
      if (applied && typeof onSyncApplied === 'function') onSyncApplied();
    } catch (e) {
      lastError = navigator.onLine === false || e instanceof TypeError ? 'Offline — changes are saved on this device and will sync later' : e.message;
      persist();
      setState('error');
    } finally {
      busy = false;
      if (again) { again = false; schedule(300); }
    }
  }

  function schedule(ms) {
    if (!st.session) return;
    clearTimeout(timer);
    timer = setTimeout(run, ms == null ? 1500 : ms);
  }
  function setState(s) { state = s; if (typeof onSyncStatus === 'function') onSyncStatus(); }

  async function signIn(email, password) {
    setSession(await authCall('token?grant_type=password', { email, password }));
    await run();
  }
  /* returns 'in' when signed in straight away, 'confirm' when the email must be confirmed first */
  async function signUp(email, password) {
    const j = await authCall('signup' + backTo(), { email, password });
    if (!j.access_token) return 'confirm';
    setSession(j);
    await run();
    return 'in';
  }
  /* where the links in confirmation and reset emails should bring the person back to */
  function backTo() {
    return location.protocol.startsWith('http') ? '?redirect_to=' + encodeURIComponent(location.origin + location.pathname) : '';
  }
  async function recover(email) { await authCall('recover' + backTo(), { email }); }
  async function setPassword(password) {
    const t = await token();
    const r = await fetch(SB_URL + '/auth/v1/user', { method: 'PUT', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.msg || j.message || 'Could not change the password'); }
  }
  /* Arriving from an emailed link: the address carries a session. Returns 'recovery', 'signup', … or null. */
  async function adoptFromUrl() {
    const h = location.hash.slice(1);
    if (!h.includes('access_token=')) return null;
    const q = new URLSearchParams(h);
    history.replaceState(null, '', location.pathname + location.search + '#/settings');
    st.session = { access: q.get('access_token'), refresh: q.get('refresh_token'), exp: Date.now() + (parseInt(q.get('expires_in'), 10) || 3600) * 1000, email: '' };
    try {
      const r = await fetch(SB_URL + '/auth/v1/user', { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + st.session.access } });
      if (!r.ok) throw new Error('expired');
      st.session.email = (await r.json()).email || '';
    } catch (e) { st.session = null; persist(); return null; }
    persist();
    return q.get('type') || 'signin';
  }

  function signOut() {
    const s = st.session;
    if (s) fetch(SB_URL + '/auth/v1/logout', { method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + s.access } }).catch(() => {});
    st = blank(); persist(); setState('idle');
  }

  function status() {
    if (!st.session) return { signedIn: false, ok: false, text: 'This device only' };
    if (state === 'syncing') return { signedIn: true, ok: true, text: 'Syncing…', email: st.session.email };
    if (state === 'error') return { signedIn: true, ok: false, text: lastError, email: st.session.email };
    const mins = Math.round((Date.now() - lastOk) / 60000);
    return { signedIn: true, ok: true, email: st.session.email, text: !lastOk ? 'Cloud sync on' : mins < 1 ? 'Synced just now' : `Synced ${mins} min ago` };
  }

  window.addEventListener('online', () => schedule(200));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(200); });
  setInterval(() => { if (!document.hidden) schedule(0); }, 60000);

  return { run, schedule, signIn, signUp, signOut, status, recover, setPassword, adoptFromUrl };
})();
