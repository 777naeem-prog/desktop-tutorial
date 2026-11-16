'use strict';
/* NN Trading POS — screens, routing and actions */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $('#view');

let draft = null;        // document being edited
let pendingDraft = null; // prepared draft waiting for the editor (convert, refund, sell…)
let dirty = false;
let currentHash = '';
let listQuery = '';
let stockFilter = 'stock';

const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
function setPath(o, p, v) {
  const ks = p.split('.');
  let x = o;
  for (let i = 0; i < ks.length - 1; i++) x = x[ks[i]];
  x[ks[ks.length - 1]] = v;
}

const ICON = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  car: '<path d="M4 16v-3l2-5.5h12l2 5.5v3"/><path d="M3 16h18v2.5H3z"/><circle cx="7.5" cy="13.5" r=".9"/><circle cx="16.5" cy="13.5" r=".9"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 20c.4-3.6 2.7-5.5 6-5.5s5.6 1.900 6 5.5"/><path d="M16 5.600a3 3 0 0 1 0 5.800M18.500 14.900c1.500.800 2.300 2.400 2.500 5.100"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.500M12 18.500V21M3 12h2.500M18.500 12H21M5.600 5.600l1.800 1.800M16.600 16.600l1.800 1.800M5.600 18.400l1.800-1.800M16.600 7.400l1.800-1.800"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  print: '<path d="M7 8V3.500h10V8"/><path d="M5 17H3.500V8.500h17V17H19"/><path d="M7 14h10v6.500H7z"/>',
  back: '<path d="M14 6l-6 6 6 6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
};
const icon = (n) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.700" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>`;

/* ---------- small UI helpers ---------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
}

function closeModal() { $('#modal-root').innerHTML = ''; }
function modal(title, body, onSubmit, { submit = 'Save', wide = false } = {}) {
  $('#modal-root').innerHTML = `<div class="modal-back"><form class="modal ${wide ? 'wide' : ''}" autocomplete="off">
    <header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-act="close-modal" aria-label="Close">${icon('x')}</button></header>
    <div class="modal-body">${body}</div>
    ${onSubmit ? `<footer><button type="button" class="btn ghost" data-act="close-modal">Cancel</button><button class="btn primary">${esc(submit)}</button></footer>` : ''}
  </form></div>`;
  const form = $('#modal-root form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (onSubmit && onSubmit(Object.fromEntries(new FormData(form))) !== false) closeModal();
  });
  const first = $('input:not([type=hidden]),textarea,select', form);
  if (first) first.focus();
}

function fitSheets() {
  $$('.sheet-fit').forEach((el) => {
    const sh = el.firstElementChild;
    if (sh) sh.style.zoom = Math.min(1, el.clientWidth / 794);
  });
}
function setPreview(html) {
  const p = $('#preview');
  if (!p) return;
  p.innerHTML = html;
  $('#print-root').innerHTML = html;
  fitSheets();
}
function printSheet(d) {
  const old = document.title;
  if (d) document.title = `${d.number} - ${d.customer.name || DOC_TYPES[d.type].label}`;
  window.print();
  document.title = old;
}

const pill = (st) => `<span class="pill pill-${st.key}">${esc(st.label)}</span>`;
const plate = (d) => `<span class="plate plate-${d.type}">${esc(d.number)}</span>`;

/* generic form field. attr is `data-f` (editor draft), `data-s` (settings) or `name` (modals) */
function fld(label, attr, key, value, o = {}) {
  const a = `${attr}="${esc(key)}"`;
  const common = `${a} ${o.num ? 'data-num type="number" step="any" min="0"' : `type="${o.type || 'text'}"`} ${o.ph ? `placeholder="${esc(o.ph)}"` : ''} ${o.list ? `list="${o.list}"` : ''} ${o.req ? 'required' : ''}`;
  const input = o.area
    ? `<textarea ${a} rows="${o.area}" ${o.ph ? `placeholder="${esc(o.ph)}"` : ''}>${esc(value)}</textarea>`
    : o.options
      ? `<select ${a}>${o.options.map((x) => `<option ${x === value ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`
      : `<input ${common} value="${esc(o.num && !num(value) && !o.keepZero ? '' : value)}">`;
  return `<label class="fld ${o.cls || ''}"><span>${esc(label)}</span>${input}</label>`;
}

/* ---------- sidebar ---------- */
function renderSide() {
  const s = db.settings;
  const page = (location.hash.split('/')[1] || 'dashboard');
  const is = (...p) => (p.includes(page) ? 'on' : '');
  document.documentElement.style.setProperty('--accent', s.accent);
  document.documentElement.style.setProperty('--on-accent', onAccent(s.accent));
  const lastB = s.lastBackup ? `Backed up ${fmtDate(s.lastBackup)}` : 'Not backed up yet';
  $('#side').innerHTML = `
    <a class="brand" href="#/dashboard">
      ${s.logo ? `<img src="${esc(s.logo)}" alt="">` : `<span class="brand-mono">${esc(monogram(s.company.name))}</span>`}
      <span><b>${esc(s.company.name)}</b><i>Point of sale</i></span>
    </a>
    <div class="newbox">
      <button class="btn primary block" data-act="new" data-type="invoice">${icon('plus')} New invoice</button>
      <div class="newrow">
        <button class="btn dark" data-act="new" data-type="quote">Quotation</button>
        <button class="btn dark" data-act="new" data-type="refund">Refund</button>
      </div>
    </div>
    <nav>
      <a class="${is('dashboard')}" href="#/dashboard">${icon('home')} Dashboard</a>
      <a class="${is('documents', 'doc', 'new', 'edit')}" href="#/documents/all">${icon('doc')} Documents</a>
      <a class="${is('stock')}" href="#/stock">${icon('car')} Vehicle stock</a>
      <a class="${is('customers')}" href="#/customers">${icon('users')} Customers</a>
      <a class="${is('settings')}" href="#/settings">${icon('gear')} Settings</a>
    </nav>
    <a class="side-foot" href="#/settings"><span class="dot ${s.lastBackup ? 'ok' : ''}"></span>${lastB}</a>`;
}

/* ---------- router ---------- */
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

function route() {
  const hash = location.hash || '#/dashboard';
  if (dirty && hash !== currentHash) {
    if (!confirm('You have unsaved changes on this document. Leave without saving?')) {
      history.replaceState(null, '', currentHash);
      return;
    }
  }
  if (hash !== currentHash) { dirty = false; }
  currentHash = hash;
  closeModal();
  const [, page, arg] = hash.split('/');
  renderSide();
  window.scrollTo(0, 0);
  if (page === 'documents') viewDocuments(arg || 'all');
  else if (page === 'doc') viewDoc(arg);
  else if (page === 'new' && DOC_TYPES[arg]) { draft = pendingDraft || newDoc(arg); pendingDraft = null; viewEditor(); }
  else if (page === 'edit') {
    const d = db.docs.find((x) => x.id === arg);
    if (!d) return go('#/documents/all');
    draft = structuredClone(d); viewEditor();
  }
  else if (page === 'stock') viewStock();
  else if (page === 'customers') viewCustomers();
  else if (page === 'settings') viewSettings();
  else viewDashboard();
  if (!db.settings.setupDone) setupModal();
}

/* ---------- dashboard ---------- */
function viewDashboard() {
  const month = today().slice(0, 7);
  const inv = db.docs.filter((d) => d.type === 'invoice');
  const netFor = (m) => round2(db.docs.reduce((a, d) => {
    if (!d.date.startsWith(m)) return a;
    if (d.type === 'invoice') return a + calcDoc(d).total;
    if (d.type === 'refund') return a - calcDoc(d).total;
    return a;
  }, 0));
  const owed = inv.reduce((a, d) => a + outstanding(d), 0);
  const openQ = db.docs.filter((d) => d.type === 'quote' && docStatus(d).label === 'Open');
  const inStock = db.vehicles.filter((v) => v.status !== 'sold');
  let margin = 0, marginUnits = 0;
  for (const v of db.vehicles) {
    if (v.status !== 'sold' || !num(v.cost)) continue;
    const d = db.docs.find((x) => x.id === v.soldDocId);
    if (d && d.date.startsWith(month)) { margin += v.soldFor - num(v.cost); marginUnits++; }
  }

  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = localISO(dt).slice(0, 7);
    months.push({ key, label: MONTHS[dt.getMonth()], val: netFor(key) });
  }
  const peak = Math.max(1, ...months.map((m) => m.val));

  const attention = [
    ...inv.filter((d) => docStatus(d).label === 'Overdue').map((d) => ({ d, why: `Overdue since ${fmtDate(d.dueDate)}`, amt: outstanding(d) })),
    ...openQ.filter((d) => d.dueDate && d.dueDate <= addDays(today(), 3)).map((d) => ({ d, why: `Quote expires ${fmtDate(d.dueDate)}`, amt: calcDoc(d).total })),
  ];
  const recent = [...db.docs].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 7);
  const hr = new Date().getHours();
  const hello = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';

  view.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">${fmtDate(today())}</div><h1>${hello}</h1></div>
    </div>
    <div class="stats">
      <div class="stat stat-hero"><span>Sales this month</span><b>${money(months[5].val)}</b><i>${inv.filter((d) => d.date.startsWith(month)).length} invoice(s) · net of refunds</i></div>
      <div class="stat"><span>Owed to you</span><b>${money(owed)}</b><i>${inv.filter((d) => outstanding(d) > 0).length} unpaid invoice(s)</i></div>
      <div class="stat"><span>Open quotations</span><b>${money(openQ.reduce((a, d) => a + calcDoc(d).total, 0))}</b><i>${openQ.length} waiting on customers</i></div>
      <div class="stat"><span>Vehicles in stock</span><b>${inStock.length}</b><i>${money(inStock.reduce((a, v) => a + num(v.price), 0))} asking${marginUnits ? ` · ${money(margin)} margin this month` : ''}</i></div>
    </div>
    <div class="dash-grid">
      <section class="card">
        <div class="card-head"><h3>Recent documents</h3><a href="#/documents/all">View all</a></div>
        ${recent.length ? docTable(recent) : `<div class="empty"><b>Nothing yet.</b><p>Create your first invoice or quotation — it takes under a minute.</p><button class="btn primary" data-act="new" data-type="invoice">${icon('plus')} New invoice</button></div>`}
      </section>
      <div class="dash-col">
        <section class="card">
          <div class="card-head"><h3>Last 6 months</h3></div>
          <div class="bars">${months.map((m) => `<div class="bar" title="${esc(money(m.val))}"><em>${m.val ? moneyShort(m.val) : ''}</em><span style="height:${Math.max(2, Math.round(Math.max(0, m.val) / peak * 100))}%"></span><i>${m.label}</i></div>`).join('')}</div>
        </section>
        <section class="card">
          <div class="card-head"><h3>Needs attention</h3></div>
          ${attention.length ? attention.map((a) => `<a class="attn" href="#/doc/${a.d.id}">${plate(a.d)}<span><b>${esc(a.d.customer.name)}</b><i>${esc(a.why)}</i></span><strong>${money(a.amt)}</strong></a>`).join('') : '<p class="quiet">All clear — nothing overdue or about to expire.</p>'}
        </section>
      </div>
    </div>`;
}

/* ---------- documents list ---------- */
function docTable(list) {
  return `<table class="tbl tbl-docs"><thead><tr><th>Number</th><th>Date</th><th>Customer</th><th class="r">Total</th><th>Status</th></tr></thead><tbody>
    ${list.map((d) => `<tr data-act="open-doc" data-id="${d.id}"><td>${plate(d)}</td><td class="nowrap">${fmtDate(d.date)}</td><td class="who"><b>${esc(d.customer.name)}</b><span>${esc(docSummary(d))}</span></td><td class="r nowrap"><b>${d.type === 'refund' ? '−' : ''}${money(calcDoc(d).total)}</b></td><td>${pill(docStatus(d))}</td></tr>`).join('')}
  </tbody></table>`;
}

function viewDocuments(type) {
  const tabs = [['all', 'All'], ['invoice', 'Invoices'], ['quote', 'Quotations'], ['refund', 'Refunds']];
  view.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Records</div><h1>Documents</h1></div>
      <input class="search" id="doc-search" type="search" placeholder="Search number, customer, vehicle, VIN, reg…" value="${esc(listQuery)}">
    </div>
    <div class="tabs">${tabs.map(([k, l]) => `<a class="${k === type ? 'on' : ''}" href="#/documents/${k}">${l}<i>${k === 'all' ? db.docs.length : db.docs.filter((d) => d.type === k).length}</i></a>`).join('')}</div>
    <section class="card" id="doc-list"></section>`;
  const draw = () => {
    const q = listQuery.trim().toLowerCase();
    const list = db.docs.filter((d) => (type === 'all' || d.type === type) && (!q || JSON.stringify([d.number, d.customer, d.items, d.refNumber]).toLowerCase().includes(q)))
      .sort((a, b) => (b.date + (b.createdAt || 0)).localeCompare(a.date + (a.createdAt || 0)));
    $('#doc-list').innerHTML = list.length ? docTable(list) : `<div class="empty"><b>${q ? 'No matches.' : 'Nothing here yet.'}</b><p>${q ? 'Try a different search.' : 'Documents you create will be listed here.'}</p></div>`;
  };
  draw();
  $('#doc-search').addEventListener('input', (e) => { listQuery = e.target.value; draw(); });
}

/* ---------- document view ---------- */
function viewDoc(id) {
  const d = db.docs.find((x) => x.id === id);
  if (!d) return go('#/documents/all');
  const c = calcDoc(d), st = docStatus(d), T = DOC_TYPES[d.type];
  const links = [];
  const src = d.refOf && db.docs.find((x) => x.id === d.refOf);
  if (src) links.push([src, d.type === 'refund' ? 'Refund against' : 'Created from']);
  const conv = d.convertedTo && db.docs.find((x) => x.id === d.convertedTo);
  if (conv) links.push([conv, 'Invoiced as']);
  refundsFor(d.id).forEach((r) => links.push([r, 'Refunded by']));

  const acts = [`<button class="btn primary" data-act="print" data-id="${d.id}">${icon('print')} Print / Save PDF</button>`];
  if (d.type === 'invoice' && outstanding(d) > 0) acts.push(`<button class="btn accent" data-act="pay" data-id="${d.id}">Record payment</button>`);
  if (d.type === 'quote' && !conv) acts.push(`<button class="btn accent" data-act="convert" data-id="${d.id}">Convert to invoice</button>`);
  if (d.type === 'invoice' && st.label !== 'Refunded') acts.push(`<button class="btn" data-act="refund" data-id="${d.id}">Refund</button>`);
  acts.push(`<a class="btn" href="#/edit/${d.id}">Edit</a>`, `<button class="btn" data-act="dup" data-id="${d.id}">Duplicate</button>`, `<button class="btn danger" data-act="del-doc" data-id="${d.id}">Delete</button>`);

  view.innerHTML = `
    <div class="page-head">
      <div><a class="backlink" href="#/documents/${d.type}">${icon('back')} ${T.plural}</a>
        <h1>${plate(d)} <span class="h1-name">${esc(d.customer.name)}</span> ${pill(st)}</h1></div>
    </div>
    <div class="toolbar">${acts.join('')}</div>
    <div class="docview">
      <div class="sheet-fit" id="preview"></div>
      <aside class="doc-side">
        <section class="card pad">
          <div class="kv"><span>Total</span><b>${money(c.total)}</b></div>
          ${d.type === 'invoice' ? `<div class="kv"><span>Paid</span><b>${money(c.paid)}</b></div><div class="kv kv-big"><span>Balance</span><b>${money(outstanding(d))}</b></div>` : ''}
          ${d.type === 'quote' ? `<div class="kv"><span>Valid until</span><b>${fmtDate(d.dueDate)}</b></div>` : ''}
        </section>
        ${d.type === 'invoice' ? `<section class="card pad"><h3>Payments</h3>
          ${d.payments.length ? d.payments.map((p, i) => `<div class="payrow"><span><b>${money(num(p.amount))}</b><i>${fmtDate(p.date)} · ${esc(p.method)}${p.ref ? ' · ' + esc(p.ref) : ''}</i></span><button class="icon-btn" title="Remove payment" data-act="del-pay" data-id="${d.id}" data-i="${i}">${icon('x')}</button></div>`).join('') : '<p class="quiet">No payments recorded yet.</p>'}
          ${outstanding(d) > 0 ? `<button class="btn block" data-act="pay-full" data-id="${d.id}">Mark paid in full</button>` : ''}
        </section>` : ''}
        ${links.length ? `<section class="card pad"><h3>Linked</h3>${links.map(([x, l]) => `<a class="linkrow" href="#/doc/${x.id}"><i>${l}</i>${plate(x)}</a>`).join('')}</section>` : ''}
      </aside>
    </div>`;
  setPreview(renderSheet(d));
}

/* ---------- editor ---------- */
function viewEditor() {
  const d = draft, T = DOC_TYPES[d.type], s = db.settings;
  const f = (label, path, o) => fld(label, 'data-f', path, getPath(d, path), o);
  view.innerHTML = `
    <div class="editor">
      <div class="ed-form">
        <div class="page-head"><div><div class="eyebrow">${d.id ? 'Editing' : 'New'} ${T.label.toLowerCase()}${d.refNumber ? ` · from ${esc(d.refNumber)}` : ''}</div><h1>${d.id ? esc(d.number) : T.label}</h1></div></div>

        <section class="card pad">
          <h3>Customer</h3>
          <div class="grid g2">
            ${f('Name', 'customer.name', { list: 'custlist', ph: 'Start typing — saved customers appear' })}
            ${f('Phone', 'customer.phone')}
            ${f('Email', 'customer.email')}
            ${f('ID / company reg no', 'customer.idNo')}
            ${f('Address', 'customer.address', { area: 2, cls: 'span2' })}
          </div>
          <datalist id="custlist">${db.customers.map((c) => `<option value="${esc(c.name)}">`).join('')}</datalist>
        </section>

        <section class="card pad">
          <h3>Items</h3>
          <div id="lines"></div>
          <div class="addrow">
            <button class="btn" data-act="add-line" data-kind="vehicle">${icon('car')} Add vehicle</button>
            ${db.vehicles.some((v) => v.status !== 'sold') && d.type !== 'refund' ? `<button class="btn" data-act="pick-stock">From stock</button>` : ''}
            <button class="btn" data-act="add-line" data-kind="general">${icon('plus')} Add general item</button>
          </div>
        </section>

        <section class="card pad">
          <h3>Details</h3>
          <div class="grid g3">
            ${f('Number', 'number')}
            ${f('Date', 'date', { type: 'date' })}
            ${T.dateLabel ? f(T.dateLabel, 'dueDate', { type: 'date' }) : f('Against invoice', 'refNumber')}
            ${f('Overall discount', 'discount', { num: true, ph: '0.00' })}
            ${f(`${s.tax.name || 'Tax'} rate %`, 'taxRate', { num: true, ph: '0' })}
            <div class="fld"><span>${esc(s.tax.name || 'Tax')}</span>
              <label class="check"><input type="checkbox" data-f="taxEnabled" ${d.taxEnabled ? 'checked' : ''}> Charge ${esc(s.tax.name || 'tax')}</label>
              <label class="check"><input type="checkbox" data-f="taxInclusive" ${d.taxInclusive ? 'checked' : ''}> Prices already include it</label>
            </div>
          </div>
          ${d.type === 'refund' ? `<div class="grid g3">${f('Refunded by', 'refundMethod', { options: PAY_METHODS })}${f('Reason for refund', 'reason', { cls: 'span2g3' })}</div>` : ''}
        </section>

        <section class="card pad">
          <h3>Notes &amp; terms</h3>
          <div class="grid g2">
            ${f('Notes (shown on the document)', 'notes', { area: 3 })}
            ${f('Terms', 'terms', { area: 3 })}
          </div>
        </section>
      </div>
      <div class="ed-prev"><div class="prev-label">Live preview</div><div class="sheet-fit" id="preview"></div></div>
    </div>
    <div class="actionbar">
      <div class="ab-total"><span>Total</span><b id="ed-total"></b></div>
      <a class="btn ghost-dark" href="${d.id ? '#/doc/' + d.id : '#/documents/all'}">Cancel</a>
      <button class="btn" data-act="save-doc">Save</button>
      <button class="btn primary" data-act="save-doc" data-print="1">${icon('print')} Save &amp; print</button>
    </div>`;
  renderLines();
  refreshEditor();
}

function renderLines() {
  const f = (label, path, o) => fld(label, 'data-f', path, getPath(draft, path), o);
  $('#lines').innerHTML = draft.items.map((it, i) => {
    const p = `items.${i}`;
    const head = `<div class="line-top"><span class="line-tag">${String(i + 1).padStart(2, '0')} · ${it.kind === 'vehicle' ? 'Vehicle' : 'General item'}${it.vehicleId ? ' · from stock' : ''}</span><button class="icon-btn" title="Remove" data-act="del-line" data-i="${i}">${icon('x')}</button></div>`;
    if (it.kind === 'vehicle') {
      return `<div class="line">${head}
        <div class="grid g4">
          ${f('Make', `${p}.vehicle.make`, { ph: 'Toyota' })}
          ${f('Model', `${p}.vehicle.model`, { ph: 'Hilux 2.8 GD-6', cls: 'span2' })}
          ${f('Year', `${p}.vehicle.year`)}
          ${f('VIN / chassis no', `${p}.vehicle.vin`, { cls: 'span2' })}
          ${f('Registration', `${p}.vehicle.reg`)}
          ${f('Mileage', `${p}.vehicle.mileage`)}
          ${f('Colour', `${p}.vehicle.colour`)}
          ${f('Engine no', `${p}.vehicle.engineNo`)}
          ${f('Price', `${p}.price`, { num: true, ph: '0.00' })}
          ${f('Discount', `${p}.discount`, { num: true, ph: '0.00' })}
          ${f('Extra detail (optional)', `${p}.desc`, { cls: 'span4', ph: 'Service history, extras, condition…' })}
        </div></div>`;
    }
    return `<div class="line">${head}
      <div class="grid g4">
        ${f('Description', `${p}.desc`, { cls: 'span4', area: 1, ph: 'What is being sold or charged' })}
        ${f('Qty', `${p}.qty`, { num: true, keepZero: true })}
        ${f('Unit price', `${p}.price`, { num: true, ph: '0.00' })}
        ${f('Discount', `${p}.discount`, { num: true, ph: '0.00' })}
        <div class="fld"><span>Amount</span><output data-line="${i}"></output></div>
      </div></div>`;
  }).join('') || '<p class="quiet">No items yet. Add a vehicle or a general item below.</p>';
}

function refreshEditor() {
  const c = calcDoc(draft);
  $('#ed-total').textContent = money(c.total);
  $$('[data-line]').forEach((o) => { o.textContent = money(c.lines[+o.dataset.line] || 0); });
  setPreview(renderSheet(draft));
}

function saveDraft(andPrint) {
  const d = draft;
  if (!d.customer.name.trim()) { toast('Add the customer\'s name first'); $('[data-f="customer.name"]').focus(); return; }
  if (!d.items.length) { toast('Add at least one item'); return; }
  d.number = String(d.number || '').trim() || peekNumber(d.type);
  if (db.docs.some((x) => x.type === d.type && x.number === d.number && x.id !== d.id)) { toast(`${d.number} is already used — change the number`); return; }
  d.customerId = upsertCustomer(d.customer);
  if (!d.id) {
    d.id = uid();
    d.createdAt = Date.now();
    claimNumber(d.type, d.number);
    db.docs.push(d);
    if (d.type === 'invoice' && d.refOf) {
      const q = db.docs.find((x) => x.id === d.refOf && x.type === 'quote');
      if (q) q.convertedTo = d.id;
    }
  } else {
    db.docs[db.docs.findIndex((x) => x.id === d.id)] = d;
  }
  if (!saveDb()) return;
  dirty = false;
  draft = null;
  toast(`${d.number} saved`);
  go('#/doc/' + d.id);
  if (andPrint) setTimeout(() => printSheet(d), 200);
}

function copyItems(d) {
  return structuredClone(d.items).map((it) => ({ ...it, id: uid() }));
}

/* ---------- stock ---------- */
function viewStock() {
  const list = db.vehicles.filter((v) => stockFilter === 'all' || (stockFilter === 'sold') === (v.status === 'sold'))
    .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  const count = (k) => db.vehicles.filter((v) => k === 'all' || (k === 'sold') === (v.status === 'sold')).length;
  view.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Yard</div><h1>Vehicle stock</h1></div>
      <button class="btn primary" data-act="veh-edit">${icon('plus')} Add vehicle</button></div>
    <div class="tabs">${[['stock', 'In stock'], ['sold', 'Sold'], ['all', 'All']].map(([k, l]) => `<a href="#/stock" data-act="stock-filter" data-k="${k}" class="${k === stockFilter ? 'on' : ''}">${l}<i>${count(k)}</i></a>`).join('')}</div>
    ${list.length ? `<div class="veh-grid">${list.map((v) => {
      const sold = v.status === 'sold';
      const m = sold && num(v.cost) ? v.soldFor - num(v.cost) : num(v.cost) && num(v.price) ? num(v.price) - num(v.cost) : null;
      return `<article class="veh ${sold ? 'is-sold' : ''}">
        <div class="veh-top"><div><h3>${esc(vTitle(v))}</h3><p>${[v.colour, v.mileage && `${Number(String(v.mileage).replace(/[^\d.]/g, '')).toLocaleString('en-US')} ${esc(db.settings.distanceUnit || 'km')}`].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</p></div>${pill(sold ? { key: 'ok', label: 'Sold' } : { key: 'open', label: 'In stock' })}</div>
        <div class="veh-ids">${v.reg ? `<span class="plate">${esc(v.reg)}</span>` : ''}${v.vin ? `<span class="vin">VIN ${esc(v.vin)}</span>` : ''}</div>
        <div class="veh-money">
          <div><span>${sold ? 'Sold for' : 'Asking'}</span><b>${money(sold ? v.soldFor : num(v.price))}</b></div>
          <div><span>Cost</span><b>${num(v.cost) ? money(num(v.cost)) : '—'}</b></div>
          <div><span>${sold ? 'Margin' : 'Expected margin'}</span><b class="${m != null && m < 0 ? 'neg' : 'pos'}">${m == null ? '—' : money(m)}</b></div>
        </div>
        <div class="veh-acts">
          ${sold ? `<a class="btn" href="#/doc/${v.soldDocId}">View invoice</a>` : `<button class="btn primary" data-act="veh-sell" data-type="invoice" data-id="${v.id}">Sell</button><button class="btn" data-act="veh-sell" data-type="quote" data-id="${v.id}">Quote</button>`}
          <button class="btn ghost" data-act="veh-edit" data-id="${v.id}">Edit</button>
        </div>
      </article>`;
    }).join('')}</div>` : `<section class="card"><div class="empty"><b>${stockFilter === 'sold' ? 'No sold vehicles yet.' : 'No vehicles in stock.'}</b><p>Add the vehicles on your floor once — then sell or quote them in two clicks, with every detail filled in for you.</p></div></section>`}`;
}

function vehicleModal(id) {
  const v = db.vehicles.find((x) => x.id === id) || { ...blankVehicle(), cost: '', price: '', notes: '' };
  const f = (l, k, o) => fld(l, 'name', k, v[k], o);
  modal(id ? 'Edit vehicle' : 'Add vehicle to stock', `
    <div class="grid g4">
      ${f('Make', 'make', { req: true })}${f('Model', 'model', { cls: 'span2', req: true })}${f('Year', 'year')}
      ${f('VIN / chassis no', 'vin', { cls: 'span2' })}${f('Registration', 'reg')}${f('Mileage', 'mileage')}
      ${f('Colour', 'colour')}${f('Engine no', 'engineNo')}
      ${f('Cost (what you paid)', 'cost', { num: true })}${f('Asking price', 'price', { num: true })}
      ${f('Notes', 'notes', { cls: 'span4', ph: 'Service history, extras, condition… printed on the invoice' })}
    </div>
    <p class="hint">Cost is private — it never appears on a quotation or invoice.</p>
    ${id && v.status !== 'sold' ? `<button type="button" class="btn danger" data-act="veh-del" data-id="${id}">Remove from stock</button>` : ''}`,
  (data) => {
    const rec = db.vehicles.find((x) => x.id === id) || { id: uid(), addedAt: Date.now(), status: 'stock' };
    Object.assign(rec, data, { cost: num(data.cost), price: num(data.price) });
    if (!id) db.vehicles.push(rec);
    saveDb(); route();
  }, { wide: true });
}

function stockItem(v) {
  const { make, model, year, colour, vin, reg, mileage, engineNo } = v;
  return { id: uid(), kind: 'vehicle', vehicleId: v.id, vehicle: { make, model, year, colour, vin, reg, mileage, engineNo }, desc: v.notes || '', qty: 1, price: num(v.price), discount: 0 };
}

/* ---------- customers ---------- */
function viewCustomers() {
  const rows = db.customers.map((c) => {
    const docs = db.docs.filter((d) => d.customerId === c.id);
    return { c, n: docs.length, spent: docs.filter((d) => d.type === 'invoice').reduce((a, d) => a + calcDoc(d).total, 0), owed: docs.reduce((a, d) => a + outstanding(d), 0) };
  }).sort((a, b) => a.c.name.localeCompare(b.c.name));
  view.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">People</div><h1>Customers</h1></div>
      <button class="btn primary" data-act="cust-edit">${icon('plus')} Add customer</button></div>
    <section class="card">${rows.length ? `<table class="tbl"><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th class="r">Documents</th><th class="r">Invoiced</th><th class="r">Owing</th><th></th></tr></thead><tbody>
      ${rows.map(({ c, n, spent, owed }) => `<tr data-act="cust-edit" data-id="${c.id}"><td><b>${esc(c.name)}</b></td><td>${esc(c.phone)}</td><td class="dim">${esc(c.email)}</td><td class="r">${n}</td><td class="r">${money(spent)}</td><td class="r">${owed > 0 ? `<b class="neg">${money(owed)}</b>` : '—'}</td><td class="r"><button class="btn sm" data-act="cust-invoice" data-id="${c.id}">Invoice</button></td></tr>`).join('')}
      </tbody></table>` : '<div class="empty"><b>No customers yet.</b><p>They are saved automatically the first time you invoice or quote someone.</p></div>'}</section>`;
}

function customerModal(id) {
  const c = db.customers.find((x) => x.id === id) || {};
  const f = (l, k, o) => fld(l, 'name', k, c[k] || '', o);
  modal(id ? 'Edit customer' : 'Add customer', `
    <div class="grid g2">${f('Name', 'name', { req: true })}${f('Phone', 'phone')}${f('Email', 'email')}${f('ID / company reg no', 'idNo')}${f('Tax no', 'taxNo')}${f('Address', 'address', { area: 2, cls: 'span2' })}</div>
    ${id ? `<button type="button" class="btn danger" data-act="cust-del" data-id="${id}">Delete customer</button>` : ''}`,
  (data) => {
    if (id) Object.assign(c, data); else db.customers.push({ id: uid(), ...data });
    saveDb(); route();
  });
}

/* ---------- payments ---------- */
function paymentModal(id) {
  const d = db.docs.find((x) => x.id === id);
  modal(`Payment for ${d.number}`, `
    <div class="grid g2">
      ${fld('Amount', 'name', 'amount', outstanding(d), { num: true, req: true })}
      ${fld('Date', 'name', 'date', today(), { type: 'date' })}
      ${fld('Method', 'name', 'method', 'Bank transfer', { options: PAY_METHODS })}
      ${fld('Reference (optional)', 'name', 'ref', '')}
    </div><p class="hint">Balance owing: <b>${money(outstanding(d))}</b></p>`,
  (data) => {
    if (num(data.amount) <= 0) { toast('Enter an amount'); return false; }
    d.payments.push({ amount: num(data.amount), date: data.date || today(), method: data.method, ref: data.ref });
    saveDb(); toast('Payment recorded'); route();
  }, { submit: 'Record payment' });
}

/* ---------- settings ---------- */
function viewSettings() {
  const s = db.settings;
  const f = (label, path, o) => fld(label, 'data-s', path, getPath(s, path), o);
  const swatches = ['#0f4d3a', '#14294b', '#6b1d2a', '#8a6a3b', '#3b4a5a', '#151a18'];
  view.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Changes save as you type</div><h1>Settings</h1></div></div>
    <div class="editor">
      <div class="ed-form">
        <section class="card pad"><h3>Company</h3><div class="grid g2">
          ${f('Company name', 'company.name')}${f('Tagline', 'company.tagline')}
          ${f('Phone', 'company.phone')}${f('Email', 'company.email')}
          ${f('Website', 'company.website')}${f('Company reg no', 'company.regNo')}
          ${f('Tax / VAT no', 'company.taxNo')}<div></div>
          ${f('Address', 'company.address', { area: 3, cls: 'span2' })}
        </div></section>

        <section class="card pad"><h3>Letterhead</h3>
          <div class="lh-opts">
            <div class="fld"><span>Logo</span><div class="logo-row">
              ${s.logo ? `<img src="${esc(s.logo)}" alt="">` : '<div class="logo-none">No logo — using monogram</div>'}
              <label class="btn">Upload<input type="file" id="logo-file" accept="image/*" hidden></label>
              ${s.logo ? '<button class="btn ghost" data-act="logo-clear">Remove</button>' : ''}
            </div></div>
            <div class="fld"><span>Accent colour</span><div class="swatches">
              ${swatches.map((c) => `<button class="sw ${c === s.accent ? 'on' : ''}" style="background:${c}" data-act="accent" data-c="${c}" aria-label="${c}"></button>`).join('')}
              <input type="color" data-s="accent" value="${esc(s.accent)}" title="Custom colour">
            </div></div>
            <div class="fld"><span>Style</span><div class="seg">
              ${[['slim', 'Slim'], ['band', 'Bold band'], ['centre', 'Centred']].map(([k, l]) => `<button class="${s.letterhead === k ? 'on' : ''}" data-act="lh-style" data-k="${k}">${l}</button>`).join('')}
            </div></div>
          </div>
          <div class="grid g2">${f('Footer line', 'footer')}
            <div class="fld"><span>Signatures</span><label class="check"><input type="checkbox" data-s="signatures" ${s.signatures ? 'checked' : ''}> Show signature lines</label></div></div>
        </section>

        <section class="card pad"><h3>Money &amp; tax</h3><div class="grid g4">
          ${f('Currency symbol', 'currency', { ph: 'e.g. R, $, £, AED' })}
          ${f('Tax name', 'tax.name', { ph: 'VAT' })}
          ${f('Tax rate %', 'tax.rate', { num: true, ph: '0 = no tax' })}
          <div class="fld"><span>Pricing</span><label class="check"><input type="checkbox" data-s="tax.inclusive" ${s.tax.inclusive ? 'checked' : ''}> Prices include tax</label></div>
          ${f('Invoice due (days)', 'dueDays', { num: true, keepZero: true })}
          ${f('Quote valid (days)', 'validDays', { num: true, keepZero: true })}
          ${f('Distance unit', 'distanceUnit', { options: ['km', 'mi'] })}
        </div></section>

        <section class="card pad"><h3>Banking details</h3>
          ${f('Printed on invoices and quotations', 'bank', { area: 4, ph: 'Bank: …\nAccount name: …\nAccount no: …\nBranch code: …' })}
        </section>

        <section class="card pad"><h3>Default terms</h3>
          ${f('Invoices', 'terms.invoice', { area: 2 })}${f('Quotations', 'terms.quote', { area: 2 })}${f('Refunds', 'terms.refund', { area: 2 })}
        </section>

        <section class="card pad"><h3>Numbering</h3><div class="grid g3">
          ${['invoice', 'quote', 'refund'].map((t) => `<div class="numbox"><b>${DOC_TYPES[t].plural}</b>${f('Prefix', `numbering.${t}.prefix`)}${f('Next number', `numbering.${t}.next`, { num: true })}</div>`).join('')}
        </div></section>

        <section class="card pad"><h3>Backup</h3>
          <p class="hint">Everything is stored on this computer, in this browser. Export a backup regularly and keep it somewhere safe (USB, Google Drive, email it to yourself).</p>
          <div class="addrow"><button class="btn primary" data-act="export">Export backup</button>
            <label class="btn">Restore from backup<input type="file" id="import-file" accept="application/json,.json" hidden></label></div>
          <p class="hint">${s.lastBackup ? `Last backup: ${fmtDate(s.lastBackup)}` : 'No backup made yet.'} · ${db.docs.length} documents, ${db.customers.length} customers, ${db.vehicles.length} vehicles.</p>
        </section>
      </div>
      <div class="ed-prev"><div class="prev-label">Your letterhead</div><div class="sheet-fit" id="preview"></div></div>
    </div>`;
  setPreview(renderSheet(sampleDoc()));
  $('#logo-file').addEventListener('change', (e) => readLogo(e.target.files[0]));
  $('#import-file').addEventListener('change', (e) => importBackup(e.target.files[0]));
}

function readLogo(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 520 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      db.settings.logo = cv.toDataURL('image/png');
      saveDb(); route();
    };
    img.onerror = () => toast('That file is not an image');
    img.src = r.result;
  };
  r.readAsDataURL(file);
}

function exportBackup() {
  db.settings.lastBackup = today();
  saveDb();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(db, null, 1)], { type: 'application/json' }));
  a.download = `${db.settings.company.name.replace(/[^\w]+/g, '-').toLowerCase()}-backup-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Backup downloaded');
  route();
}

function importBackup(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const data = JSON.parse(r.result);
      if (!data.settings || !Array.isArray(data.docs)) throw new Error('bad');
      if (!confirm(`Restore this backup (${data.docs.length} documents)? It replaces everything currently in the app.`)) return;
      db = mergeDeep(defaultData(), data);
      saveDb(); toast('Backup restored'); go('#/dashboard');
    } catch (e) { toast('That file is not a valid backup'); }
  };
  r.readAsText(file);
}

function setupModal() {
  const s = db.settings;
  modal('Welcome — let\'s set up your letterhead', `
    <p class="hint">Two minutes now, and every invoice, quotation and refund comes out on your letterhead. You can change all of this later in Settings.</p>
    <div class="grid g2">
      ${fld('Company name', 'name', 'name', s.company.name, { req: true })}
      ${fld('Phone', 'name', 'phone', s.company.phone)}
      ${fld('Email', 'name', 'email', s.company.email)}
      ${fld('Currency symbol', 'name', 'currency', s.currency, { req: true, ph: 'e.g. R, $, £, AED' })}
      ${fld('Tax name', 'name', 'taxName', s.tax.name, { ph: 'VAT' })}
      ${fld('Tax rate % (0 if not registered)', 'name', 'taxRate', s.tax.rate, { num: true, keepZero: true })}
      ${fld('Address', 'name', 'address', s.company.address, { area: 2, cls: 'span2' })}
    </div>`,
  (data) => {
    Object.assign(s.company, { name: data.name.trim(), phone: data.phone, email: data.email, address: data.address });
    s.currency = data.currency.trim();
    s.tax.name = data.taxName.trim() || 'Tax';
    s.tax.rate = num(data.taxRate);
    s.setupDone = true;
    saveDb(); route();
  }, { submit: 'Start using the app' });
}

/* ---------- actions ---------- */
const ACT = {
  'close-modal': () => closeModal(),
  new: (t) => { pendingDraft = null; draft = null; go('#/new/' + t.dataset.type); },
  'open-doc': (t) => go('#/doc/' + t.dataset.id),
  print: (t) => printSheet(db.docs.find((x) => x.id === t.dataset.id)),
  'save-doc': (t) => saveDraft(!!t.dataset.print),
  'add-line': (t) => {
    draft.items.push(t.dataset.kind === 'vehicle'
      ? { id: uid(), kind: 'vehicle', vehicleId: '', vehicle: blankVehicle(), desc: '', qty: 1, price: 0, discount: 0 }
      : { id: uid(), kind: 'general', desc: '', qty: 1, price: 0, discount: 0 });
    dirty = true; renderLines(); refreshEditor();
    const inputs = $$('#lines .line:last-child input, #lines .line:last-child textarea');
    if (inputs[0]) inputs[0].focus();
  },
  'del-line': (t) => { draft.items.splice(+t.dataset.i, 1); dirty = true; renderLines(); refreshEditor(); },
  'pick-stock': () => {
    const avail = db.vehicles.filter((v) => v.status !== 'sold' && !draft.items.some((it) => it.vehicleId === v.id));
    modal('Add from stock', avail.length ? avail.map((v) => `<button type="button" class="pickrow" data-act="choose-stock" data-id="${v.id}"><span><b>${esc(vTitle(v))}</b><i>${[v.colour, v.reg, v.vin].filter(Boolean).map(esc).join(' · ')}</i></span><strong>${money(num(v.price))}</strong></button>`).join('') : '<p class="quiet">Every vehicle in stock is already on this document.</p>', null);
  },
  'choose-stock': (t) => {
    draft.items.push(stockItem(db.vehicles.find((v) => v.id === t.dataset.id)));
    dirty = true; closeModal(); renderLines(); refreshEditor();
  },
  pay: (t) => paymentModal(t.dataset.id),
  'pay-full': (t) => {
    const d = db.docs.find((x) => x.id === t.dataset.id);
    d.payments.push({ amount: outstanding(d), date: today(), method: 'Bank transfer', ref: '' });
    saveDb(); toast('Marked as paid'); route();
  },
  'del-pay': (t) => {
    if (!confirm('Remove this payment?')) return;
    db.docs.find((x) => x.id === t.dataset.id).payments.splice(+t.dataset.i, 1);
    saveDb(); route();
  },
  convert: (t) => {
    const q = db.docs.find((x) => x.id === t.dataset.id);
    const d = newDoc('invoice');
    Object.assign(d, { customer: { ...q.customer }, items: copyItems(q), discount: q.discount, taxEnabled: q.taxEnabled, taxRate: q.taxRate, taxInclusive: q.taxInclusive, notes: q.notes, refOf: q.id, refNumber: q.number });
    pendingDraft = d; go('#/new/invoice');
  },
  refund: (t) => {
    const inv = db.docs.find((x) => x.id === t.dataset.id);
    const d = newDoc('refund');
    Object.assign(d, { customer: { ...inv.customer }, items: copyItems(inv), discount: inv.discount, taxEnabled: inv.taxEnabled, taxRate: inv.taxRate, taxInclusive: inv.taxInclusive, refOf: inv.id, refNumber: inv.number });
    pendingDraft = d; go('#/new/refund');
  },
  dup: (t) => {
    const src = db.docs.find((x) => x.id === t.dataset.id);
    const d = newDoc(src.type);
    Object.assign(d, { customer: { ...src.customer }, items: copyItems(src).map((it) => (src.type === 'invoice' ? { ...it, vehicleId: '' } : it)), discount: src.discount, taxEnabled: src.taxEnabled, taxRate: src.taxRate, taxInclusive: src.taxInclusive, notes: src.notes, terms: src.terms });
    pendingDraft = d; go('#/new/' + src.type);
  },
  'del-doc': (t) => {
    const d = db.docs.find((x) => x.id === t.dataset.id);
    if (!confirm(`Delete ${d.number} for ${d.customer.name}? This cannot be undone.`)) return;
    db.docs = db.docs.filter((x) => x.id !== d.id);
    saveDb(); toast(`${d.number} deleted`); go('#/documents/' + d.type);
  },
  'stock-filter': (t, e) => { e.preventDefault(); stockFilter = t.dataset.k; viewStock(); },
  'veh-edit': (t) => vehicleModal(t.dataset.id),
  'veh-del': (t) => {
    if (!confirm('Remove this vehicle from stock?')) return;
    db.vehicles = db.vehicles.filter((v) => v.id !== t.dataset.id);
    saveDb(); route();
  },
  'veh-sell': (t) => {
    const d = newDoc(t.dataset.type);
    d.items.push(stockItem(db.vehicles.find((v) => v.id === t.dataset.id)));
    pendingDraft = d; go('#/new/' + t.dataset.type);
  },
  'cust-edit': (t) => customerModal(t.dataset.id),
  'cust-del': (t) => {
    if (!confirm('Delete this customer? Their documents are kept.')) return;
    db.customers = db.customers.filter((c) => c.id !== t.dataset.id);
    saveDb(); route();
  },
  'cust-invoice': (t) => {
    const c = db.customers.find((x) => x.id === t.dataset.id);
    const d = newDoc('invoice');
    d.customer = { name: c.name, phone: c.phone || '', email: c.email || '', address: c.address || '', idNo: c.idNo || '', taxNo: c.taxNo || '' };
    pendingDraft = d; go('#/new/invoice');
  },
  accent: (t) => { db.settings.accent = t.dataset.c; saveDb(); route(); },
  'lh-style': (t) => { db.settings.letterhead = t.dataset.k; saveDb(); route(); },
  'logo-clear': () => { db.settings.logo = ''; saveDb(); route(); },
  export: () => exportBackup(),
};

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  // a button inside a clickable row wins over the row
  if (t.tagName === 'TR' && e.target.closest('button,a')) return;
  const fn = ACT[t.dataset.act];
  if (fn) { if (t.tagName === 'BUTTON') e.preventDefault(); fn(t, e); }
});

function readInput(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.hasAttribute('data-num')) return num(el.value);
  return el.value;
}

let saveTimer;
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.f && draft) {
    setPath(draft, el.dataset.f, readInput(el));
    dirty = true;
    refreshEditor();
  } else if (el.dataset.s) {
    setPath(db.settings, el.dataset.s, readInput(el));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveDb(); renderSide(); }, 250);
    setPreview(renderSheet(sampleDoc()));
  }
});

// picking a saved customer fills in the rest of their details
document.addEventListener('change', (e) => {
  if (e.target.dataset.f !== 'customer.name' || !draft) return;
  const c = db.customers.find((x) => x.name.toLowerCase() === e.target.value.trim().toLowerCase());
  if (!c) return;
  for (const k of ['phone', 'email', 'address', 'idNo', 'taxNo']) {
    draft.customer[k] = c[k] || '';
    const inp = $(`[data-f="customer.${k}"]`);
    if (inp) inp.value = c[k] || '';
  }
  refreshEditor();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && draft && /^#\/(new|edit)\//.test(location.hash)) { e.preventDefault(); saveDraft(false); }
});
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('resize', fitSheets);
window.addEventListener('hashchange', route);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});

loadDb();
syncStock();
route();
