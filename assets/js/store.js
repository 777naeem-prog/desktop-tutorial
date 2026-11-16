'use strict';
/* NN Trading POS — data layer: persistence, defaults, calculations */

const STORE_KEY = 'nn-pos-v1';

const DOC_TYPES = {
  invoice: { label: 'Invoice', plural: 'Invoices', prefix: 'INV', party: 'Bill to', dateLabel: 'Due date' },
  quote: { label: 'Quotation', plural: 'Quotations', prefix: 'QUO', party: 'Prepared for', dateLabel: 'Valid until' },
  refund: { label: 'Refund', plural: 'Refunds', prefix: 'CRN', party: 'Refund to', dateLabel: '' },
};

const PAY_METHODS = ['Cash', 'Bank transfer', 'Card', 'Finance', 'Trade-in', 'Other'];

function defaultData() {
  return {
    settings: {
      setupDone: false,
      company: { name: 'NN Trading', tagline: 'Vehicle sales & general trading', address: '', phone: '', email: '', website: '', regNo: '', taxNo: '' },
      logo: '',
      accent: '#0f4d3a',
      letterhead: 'slim',
      currency: 'R',
      tax: { name: 'VAT', rate: 15, inclusive: true },
      bank: '',
      terms: {
        invoice: 'Vehicles are sold as is unless otherwise agreed in writing. Ownership passes only once payment has been received in full.',
        quote: 'This quotation is subject to the vehicle or goods still being available. Prices are valid until the date shown above.',
        refund: 'This credit note confirms the refund described above.',
      },
      numbering: { invoice: { prefix: 'INV-', next: 1 }, quote: { prefix: 'QUO-', next: 1 }, refund: { prefix: 'CRN-', next: 1 } },
      distanceUnit: 'km',
      dueDays: 7,
      validDays: 14,
      signatures: true,
      acceptText: 'Accepted without prejudice',
      eoe: true,
      contactLine: '',
      footer: 'Thank you for your business.',
      lastBackup: '',
    },
    customers: [],
    vehicles: [],
    docs: [],
  };
}

function mergeDeep(base, extra) {
  if (!extra || typeof extra !== 'object') return base;
  for (const k of Object.keys(extra)) {
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) && extra[k] && typeof extra[k] === 'object' && !Array.isArray(extra[k])) {
      mergeDeep(base[k], extra[k]);
    } else if (extra[k] !== undefined) {
      base[k] = extra[k];
    }
  }
  return base;
}

let db = defaultData();

function loadDb() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) db = mergeDeep(defaultData(), JSON.parse(raw));
  } catch (e) {
    console.error('Could not read saved data', e);
  }
}

function saveDb(fromSync) {
  syncStock();
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
    if (!fromSync && typeof Sync !== 'undefined') Sync.schedule();
    return true;
  } catch (e) {
    console.error(e);
    alert('Could not save — this computer\'s browser storage is full. Export a backup in Settings, then remove a large logo or old records.');
    return false;
  }
}

/* ---------- helpers ---------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function localISO(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const today = () => localISO(new Date());
function addDays(iso, days) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + num(days));
  return localISO(d);
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${+d} ${MONTHS[+m - 1]} ${y}`;
}
function fmtNum(n) {
  return round2(Math.abs(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function money(n) {
  const cur = db.settings.currency || '';
  return (n < -0.004 ? '−' : '') + cur + (cur.length > 1 ? ' ' : '') + fmtNum(n);
}
function moneyShort(n) {
  const cur = db.settings.currency || '';
  const a = Math.abs(n);
  const s = a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'm' : a >= 1e4 ? (a / 1e3).toFixed(0) + 'k' : Math.round(a).toLocaleString('en-US');
  return (n < 0 ? '−' : '') + cur + s;
}
/* black or white text, whichever reads better on the given colour */
function onAccent(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? '#151a18' : '#fff';
}
const vTitle = (v) => [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle';
const itemTitle = (it) => (it.kind === 'vehicle' ? vTitle(it.vehicle || {}) : it.desc || 'Item');
function docSummary(d) {
  if (!d.items.length) return '—';
  const more = d.items.length - 1;
  return itemTitle(d.items[0]) + (more > 0 ? ` +${more} more` : '');
}

/* ---------- calculations ---------- */
function lineTotal(it) {
  const base = (it.kind === 'vehicle' ? 1 : num(it.qty)) * num(it.price);
  return round2(base - Math.min(Math.max(base, 0), Math.max(num(it.discount), 0)));
}

function calcDoc(d) {
  const lines = d.items.map(lineTotal);
  const itemsTotal = round2(lines.reduce((a, b) => a + b, 0));
  const discount = Math.min(Math.max(itemsTotal, 0), Math.max(num(d.discount), 0));
  const net = round2(itemsTotal - discount);
  const rate = d.taxEnabled ? num(d.taxRate) : 0;
  let subtotal = net, tax = 0, total = net;
  if (rate > 0) {
    if (d.taxInclusive) { tax = round2(net * rate / (100 + rate)); subtotal = round2(net - tax); }
    else { tax = round2(net * rate / 100); total = round2(net + tax); }
  }
  const paid = round2((d.payments || []).reduce((a, p) => a + num(p.amount), 0));
  const hasLineDisc = d.items.some((it) => num(it.discount) > 0);
  return { lines, itemsTotal, discount, net, rate, subtotal, tax, total, paid, balance: round2(total - paid), hasLineDisc };
}

function refundsFor(docId) {
  return db.docs.filter((x) => x.type === 'refund' && x.refOf === docId);
}

/* status: { key, label } */
function docStatus(d) {
  const c = calcDoc(d);
  if (d.type === 'quote') {
    if (d.convertedTo && db.docs.some((x) => x.id === d.convertedTo)) return { key: 'ok', label: 'Invoiced' };
    if (d.dueDate && d.dueDate < today()) return { key: 'muted', label: 'Expired' };
    return { key: 'open', label: 'Open' };
  }
  if (d.type === 'refund') return { key: 'refund', label: 'Refunded' };
  const refunded = refundsFor(d.id).reduce((a, r) => a + calcDoc(r).total, 0);
  if (refunded > 0 && refunded >= c.total - 0.005) return { key: 'refund', label: 'Refunded' };
  if (c.total > 0 && c.balance <= 0.005) return { key: 'ok', label: 'Paid' };
  if (d.dueDate && d.dueDate < today()) return { key: 'bad', label: 'Overdue' };
  if (c.paid > 0) return { key: 'warn', label: 'Part paid' };
  return { key: 'open', label: 'Unpaid' };
}

/* what is still owed on an invoice (0 once refunded) */
function outstanding(d) {
  if (d.type !== 'invoice') return 0;
  const st = docStatus(d);
  if (st.label === 'Refunded') return 0;
  return Math.max(0, calcDoc(d).balance);
}

/* ---------- numbering ---------- */
function peekNumber(type) {
  const n = db.settings.numbering[type];
  // a bare running number (no prefix), e.g. 189, is left unpadded
  return n.prefix ? n.prefix + String(n.next).padStart(4, '0') : String(n.next);
}
function claimNumber(type, used) {
  if (used === peekNumber(type)) db.settings.numbering[type].next = num(db.settings.numbering[type].next) + 1;
}

/* ---------- stock ---------- */
/* A stock vehicle is "sold" while it sits on more invoices than refunds. */
function syncStock() {
  for (const v of db.vehicles) {
    let sold = 0, back = 0, lastInv = null;
    for (const d of db.docs) {
      if (!d.items.some((it) => it.vehicleId === v.id)) continue;
      if (d.type === 'invoice') { sold++; lastInv = d; }
      if (d.type === 'refund') back++;
    }
    v.status = sold > back ? 'sold' : 'stock';
    v.soldDocId = v.status === 'sold' && lastInv ? lastInv.id : '';
    v.soldFor = v.status === 'sold' && lastInv ? lineTotal(lastInv.items.find((it) => it.vehicleId === v.id)) : 0;
  }
}

function blankVehicle() {
  return { make: '', model: '', year: '', colour: '', vin: '', reg: '', mileage: '', engineNo: '' };
}

function newDoc(type) {
  const s = db.settings;
  const d = today();
  return {
    id: '', type, number: peekNumber(type), date: d,
    dueDate: type === 'invoice' ? addDays(d, s.dueDays) : type === 'quote' ? addDays(d, s.validDays) : '',
    customerId: '',
    customer: { name: '', phone: '', email: '', address: '', idNo: '', taxNo: '' },
    items: [],
    discount: 0,
    taxEnabled: num(s.tax.rate) > 0, taxRate: num(s.tax.rate), taxInclusive: !!s.tax.inclusive,
    notes: '', terms: s.terms[type] || '',
    payments: [], reference: '', refOf: '', refNumber: '', reason: '', refundMethod: 'Bank transfer', convertedTo: '',
  };
}

function upsertCustomer(c) {
  const name = (c.name || '').trim();
  if (!name) return '';
  let found = db.customers.find((x) => x.name.trim().toLowerCase() === name.toLowerCase());
  if (!found) { found = { id: uid() }; db.customers.push(found); }
  Object.assign(found, { name, phone: c.phone || found.phone || '', email: c.email || found.email || '', address: c.address || found.address || '', idNo: c.idNo || found.idNo || '', taxNo: c.taxNo || found.taxNo || '' });
  return found.id;
}
