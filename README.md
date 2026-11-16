# NN Trading — Point of Sale

A desktop point of sale for NN Trading: invoices, quotations and refunds on the company letterhead, built around vehicle sales (with general items too).

## Using it

Double-click **`index.html`** — it opens in Chrome or Edge and works offline. No install, no internet, no accounts.

- **New invoice / Quotation / Refund** — buttons at the top of the sidebar. A live A4 preview updates as you type.
- **Print / Save PDF** — opens the print dialog; choose a printer, or "Save as PDF" to email or WhatsApp it.
- **Vehicle stock** — add a vehicle once (make, model, VIN, reg, mileage, cost, asking price), then *Sell* or *Quote* it in two clicks. Sold vehicles are marked automatically, and go back into stock if the sale is refunded. Cost is private and never printed.
- **Quotation → invoice** — open a quotation and press *Convert to invoice*.
- **Refund** — open an invoice and press *Refund*; a credit note is created against it.
- **Payments** — record deposits and part-payments on an invoice; the balance and PAID stamp update themselves.
- **Settings** — company details, logo, accent colour, letterhead style, currency, tax, banking details, default terms and numbering.

## On an iPhone

The app has a phone layout and can be added to the home screen, but a phone cannot open a file from a computer: the app first has to be put online at a web address. Then, in Safari, open the address and choose Share → Add to Home Screen. It opens full-screen like an app and keeps working without signal.

Until cloud sync is added, the phone and the desktop each keep their own separate records.

## Backups — important

All data lives in the browser on this one computer. In **Settings → Backup**, press *Export backup* regularly and keep the file somewhere safe. *Restore from backup* loads it again (also how you move to a new computer). Clearing the browser's site data erases the records, so keep backups.

## For developers

Plain HTML/CSS/JS, no build step and no dependencies. Data is stored in `localStorage` under `nn-pos-v1`.

- `assets/js/store.js` — data, defaults, totals/tax/status calculations
- `assets/js/sheet.js` — the printable letterhead document
- `assets/js/app.js` — screens, routing, actions
- `assets/app.css` — app UI, letterhead and print styles
