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

## Cloud sync (office computer + phone)

In **Settings → Cloud sync**, create one account for the business (email and password), then confirm it by tapping the link in the email you receive. Sign in with that same account on every device. From then on each invoice, quotation, refund, customer, vehicle and setting is copied to the cloud and to the other devices within about a minute. Without internet the app keeps working and catches up when the connection returns.

On a new device, choose *Sign in to bring your records here* on the welcome screen.

## Security

- Only invited email addresses can create an account; each account sees only its own records.
- **App lock** (Settings): ask for a PIN whenever the app opens on a device.
- **Forgot password?** and **Change password** are in Settings → Cloud sync.
- Use a long password that is not used anywhere else, and keep a passcode on the phone and computer.

## On an iPhone

A phone cannot open a file from a computer, so the app has to be online at a web address. In Safari, open the address, then Share → Add to Home Screen. It opens full-screen like an app and keeps working without signal. Sign in under Cloud sync to see the same records as the office computer.

## Backups — important

Without cloud sync, all data lives in the browser on this one computer. With cloud sync there is also an online copy, but a backup file is still worth keeping. In **Settings → Backup**, press *Export backup* regularly and keep the file somewhere safe. *Restore from backup* loads it again (also how you move to a new computer). Clearing the browser's site data erases the records, so keep backups.

## For developers

Plain HTML/CSS/JS, no build step and no dependencies. Data is stored in `localStorage` under `nn-pos-v1`.

- `assets/js/store.js` — data, defaults, totals/tax/status calculations
- `assets/js/sheet.js` — the printable letterhead document
- `assets/js/sync.js` — cloud sync (Supabase project `nn-trading-pos`; table `public.records`, one row per record, row-level security per user)
- `assets/js/app.js` — screens, routing, actions
- `sw.js`, `manifest.webmanifest` — offline support and home-screen install
- `assets/app.css` — app UI, letterhead and print styles
