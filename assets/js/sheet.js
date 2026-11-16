'use strict';
/* NN Trading POS — renders a document on the company letterhead (A4) */

function monogram(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '··';
  if (words[0].length <= 3) return words[0].toUpperCase();
  return words.slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

function docTitle(d) {
  if (d.type === 'quote') return 'Quotation';
  if (d.type === 'refund') return 'Credit Note';
  return d.taxEnabled && num(d.taxRate) > 0 ? 'Tax Invoice' : 'Invoice';
}

function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }

function renderSheet(d) {
  const s = db.settings, co = s.company, c = calcDoc(d), T = DOC_TYPES[d.type];
  const st = d.id ? docStatus(d) : null;
  const taxName = esc(s.tax.name || 'Tax');
  const cust = d.customer || {};

  const contact = [
    co.address && `<div>${nl2br(co.address)}</div>`,
    co.phone && `<div><b>T</b> ${esc(co.phone)}</div>`,
    co.email && `<div><b>E</b> ${esc(co.email)}</div>`,
    co.website && `<div><b>W</b> ${esc(co.website)}</div>`,
  ].filter(Boolean).join('');

  const mark = s.logo
    ? `<img class="lh-logo" src="${esc(s.logo)}" alt="">`
    : `<div class="lh-mono">${esc(monogram(co.name))}</div>`;

  const meta = [
    ['Date', fmtDate(d.date)],
    T.dateLabel && d.dueDate ? [T.dateLabel, fmtDate(d.dueDate)] : null,
    d.refNumber ? [d.type === 'refund' ? 'Against invoice' : 'Reference', esc(d.refNumber)] : null,
  ].filter(Boolean).map(([k, v]) => `<div class="meta-row"><span>${k}</span><b>${v}</b></div>`).join('');

  const custLines = [
    cust.address && nl2br(cust.address),
    cust.phone && esc(cust.phone),
    cust.email && esc(cust.email),
    cust.idNo && `ID / Reg no: ${esc(cust.idNo)}`,
    cust.taxNo && `${taxName} no: ${esc(cust.taxNo)}`,
  ].filter(Boolean).map((l) => `<div>${l}</div>`).join('');

  const rows = d.items.map((it, i) => {
    let body;
    if (it.kind === 'vehicle') {
      const v = it.vehicle || {};
      const specs = [
        ['VIN', v.vin], ['Reg', v.reg], ['Mileage', v.mileage && `${Number(String(v.mileage).replace(/[^\d.]/g, '')).toLocaleString('en-US')} ${s.distanceUnit || 'km'}`],
        ['Colour', v.colour], ['Engine no', v.engineNo],
      ].filter(([, val]) => val).map(([k, val]) => `<span class="spec"><i>${k}</i>${esc(val)}</span>`).join('');
      body = `<div class="it-title">${esc(vTitle(v))}</div>${specs ? `<div class="specs">${specs}</div>` : ''}${it.desc ? `<div class="it-note">${nl2br(it.desc)}</div>` : ''}`;
    } else {
      const [first, ...rest] = String(it.desc || '').split('\n');
      body = `<div class="it-title">${esc(first || 'Item')}</div>${rest.length ? `<div class="it-note">${nl2br(rest.join('\n'))}</div>` : ''}`;
    }
    const qty = it.kind === 'vehicle' ? 1 : num(it.qty);
    return `<tr>
      <td class="c-n">${String(i + 1).padStart(2, '0')}</td>
      <td>${body}</td>
      <td class="r">${qty}</td>
      <td class="r">${fmtNum(num(it.price))}</td>
      ${c.hasLineDisc ? `<td class="r">${num(it.discount) > 0 ? '−' + fmtNum(num(it.discount)) : ''}</td>` : ''}
      <td class="r"><b>${fmtNum(c.lines[i])}</b></td>
    </tr>`;
  }).join('') || `<tr><td></td><td class="it-empty" colspan="${c.hasLineDisc ? 5 : 4}">No items yet</td></tr>`;

  const tot = [];
  const showSub = c.discount > 0 || (c.rate > 0 && !d.taxInclusive);
  if (showSub) tot.push(`<div class="t-row"><span>Subtotal</span><span>${money(c.itemsTotal)}</span></div>`);
  if (c.discount > 0) tot.push(`<div class="t-row"><span>Discount</span><span>−${money(c.discount)}</span></div>`);
  if (c.rate > 0 && !d.taxInclusive) tot.push(`<div class="t-row"><span>${taxName} @ ${c.rate}%</span><span>${money(c.tax)}</span></div>`);
  tot.push(`<div class="t-row t-total"><span>${d.type === 'refund' ? 'Total refund' : 'Total'}</span><span>${money(c.total)}</span></div>`);
  if (c.rate > 0 && d.taxInclusive) tot.push(`<div class="t-row t-small"><span>Includes ${taxName} @ ${c.rate}%</span><span>${money(c.tax)}</span></div>`);
  if (d.type === 'invoice' && c.paid > 0) {
    tot.push(`<div class="t-row"><span>Paid</span><span>−${money(c.paid)}</span></div>`);
    tot.push(`<div class="t-row t-due"><span>Balance due</span><span>${money(Math.max(0, c.balance))}</span></div>`);
  }

  const left = [];
  if (d.type === 'refund') {
    if (d.reason) left.push(`<div class="blk"><h4>Reason for refund</h4><p>${nl2br(d.reason)}</p></div>`);
    if (d.refundMethod) left.push(`<div class="blk"><h4>Refunded by</h4><p>${esc(d.refundMethod)}</p></div>`);
  }
  if (d.type === 'invoice' && (d.payments || []).length) {
    left.push(`<div class="blk"><h4>Payments received</h4>${d.payments.map((p) => `<p class="payline"><span>${fmtDate(p.date)} · ${esc(p.method)}${p.ref ? ' · ' + esc(p.ref) : ''}</span><b>${money(num(p.amount))}</b></p>`).join('')}</div>`);
  }
  if (d.type !== 'refund' && s.bank) left.push(`<div class="blk"><h4>Banking details</h4><p>${nl2br(s.bank)}</p></div>`);
  if (d.notes) left.push(`<div class="blk"><h4>Notes</h4><p>${nl2br(d.notes)}</p></div>`);

  const stamp = st && d.type === 'invoice' && (st.label === 'Paid' || st.label === 'Refunded')
    ? `<div class="stamp ${st.label === 'Refunded' ? 'stamp-ref' : ''}">${st.label}</div>` : '';

  const sigs = s.signatures ? `<div class="sigs">
      <div><span></span><em>${d.type === 'quote' ? 'Accepted by customer' : d.type === 'refund' ? 'Received by customer' : 'Customer signature'}</em></div>
      <div><span></span><em>Date</em></div>
      <div><span></span><em>For ${esc(co.name)}</em></div>
    </div>` : '';

  const legal = [co.regNo && `Reg no ${esc(co.regNo)}`, co.taxNo && `${taxName} no ${esc(co.taxNo)}`].filter(Boolean).join('  ·  ');

  return `<article class="sheet lh-${esc(s.letterhead)}" style="--accent:${esc(s.accent)};--on-accent:${onAccent(s.accent)}">
    <header class="lh">
      <div class="lh-brand">${mark}<div><div class="lh-name">${esc(co.name)}</div>${co.tagline ? `<div class="lh-tag">${esc(co.tagline)}</div>` : ''}</div></div>
      <div class="lh-contact">${contact}</div>
    </header>
    <div class="lh-rule"></div>

    <section class="doc-head">
      <div>
        <div class="doc-title">${docTitle(d)}</div>
        <div class="plate">${esc(d.number || '—')}</div>
      </div>
      <div class="meta">${meta}</div>
    </section>

    <section class="party">
      <h4>${T.party}</h4>
      <div class="party-name">${esc(cust.name) || '<span class="ghost">Customer name</span>'}</div>
      <div class="party-lines">${custLines}</div>
    </section>

    <table class="items">
      <thead><tr><th class="c-n">#</th><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th>${c.hasLineDisc ? '<th class="r">Discount</th>' : ''}<th class="r">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <section class="summary">
      <div class="sum-left">${left.join('')}</div>
      <div class="totals">${tot.join('')}${stamp}</div>
    </section>

    ${sigs}
    ${d.terms ? `<div class="terms"><h4>Terms</h4><p>${nl2br(d.terms)}</p></div>` : ''}
    <footer class="sheet-foot"><span>${esc(s.footer)}</span><span>${legal}</span></footer>
  </article>`;
}

function sampleDoc() {
  const d = newDoc('invoice');
  d.number = peekNumber('invoice');
  d.customer = { name: 'Sample Customer', phone: '000 000 0000', email: 'customer@example.com', address: '12 Example Street\nYour City', idNo: '', taxNo: '' };
  d.items = [
    { id: 'a', kind: 'vehicle', vehicle: { make: 'Toyota', model: 'Hilux 2.8 GD-6 Double Cab', year: '2021', colour: 'White', vin: 'AHTKB3CD502600000', reg: 'ABC 123', mileage: '84500', engineNo: '1GD0000000' }, desc: 'Full service history, two keys', qty: 1, price: 465000, discount: 5000 },
    { id: 'b', kind: 'general', desc: 'Licence & registration', qty: 1, price: 2500, discount: 0 },
  ];
  return d;
}
