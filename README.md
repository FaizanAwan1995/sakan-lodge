# SAKAN Lodge — Rooming House Ledger

A responsive web app for the four-house Adelaide portfolio. The key figures are calculated from the resident, payment and property records: rent outstanding, each house's earned income minus expenses, and Australian financial-year reporting.

## What is included

- Today: overdue residents, arrears and late days, next landlord payment, occupancy and bonds held.
- Optional head-lease end dates with a 60-day review reminder on Today.
- Branded SAKAN Lodge interface using the supplied logo and cream, forest green, plum and gold palette.
- Rooms: add or edit properties, room capacities, resident contact records, explicit check-in/check-out controls, rent rates, paid-up-to dates and occupancy-capacity checks.
- Rent: editable rent receipts and bond transactions, cash/transfer method, recipient, notes and a receipt trail. Bond receipts and refunds stay outside rent income; bond amounts retained at settlement are reported separately as other income.
- Expenses: property or whole-business expenses, personal spending reimbursement and electricity excess allocation preview.
- Repairs: a follow-up queue by property and room with urgency, contractor, and due date. Record paid repair work in Expenses so it appears in profit reports once.
- Reports: earned versus received, net profit, property results, category totals, financial-year/month/custom date ranges and CSV export.
- Activity history records who added, edited, checked out or removed entries. Local mode includes JSON backup and restore.
- Live cross-device updates when connected to Supabase.

## 1. Run locally first

Requirements: Node.js 22.12 or newer and npm. From this project directory:

```bash
npm install
npm test
npm run dev
```

`npm test` uses Node’s built-in test runner, so the ledger calculations can be tested without any extra test-runner package. Install dependencies before launching the React app.

Open the `Local` address printed by Vite, normally `http://localhost:5173`. To test from a phone on the same Wi-Fi, use the network address printed by Vite.

**No `.env` file is required for the first local preview.** Without Supabase credentials, the app starts in local mode and asks whether Danish or Faizan is using it. Changes and the selected name are saved only in that browser's local storage; Activity entries use the selected name. Use **Switch user** in the header to change names. This is a local workflow label, not a password-protected account: both names can edit the same browser ledger. Data is not shared across devices; download a JSON backup regularly from Activity.

To run against the shared database later, copy `.env.example` to `.env` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from your own Supabase project's **Connect** panel. A publishable key is expected to be public; database policies and authenticated sessions protect data. Never put a Supabase secret/service-role key in a browser app or commit any `.env` file. The old `VITE_SUPABASE_ANON_KEY` variable remains a temporary fallback for existing setups.

## 2. Configure the live database

1. Create a Supabase project on its Free plan and choose the closest available region to Adelaide.
2. In **SQL Editor → New query**, run `supabase/schema.sql` once. It creates tables, row-level security policies, audit logging, realtime publication entries, and the four seeded properties/rooms.
3. Run `supabase/migrations/20261011_atomic_electricity_bill.sql`, `supabase/migrations/20261011_payment_types_and_audit.sql`, `supabase/migrations/20261011_lease_end_reminders.sql`, `supabase/migrations/20261011_maintenance_queue.sql`, and `supabase/migrations/20261011_security_and_indexes.sql`. These add atomic electricity billing, separate rent/bond transactions, lease review dates, the shared repair queue, and tighter audit-function permissions with useful indexes.
4. In **Authentication → Providers → Email**, keep email/password sign-in enabled and disable public sign-ups. Create two confirmed accounts, one for Faizan and one for Danish. Use each person's real login email and a separate strong password.
5. In **Authentication → URL Configuration**, set the Site URL to the deployed Pages URL after the first deploy and add that same HTTPS origin to Redirect URLs.
6. Copy the project URL and publishable key into `.env` for a local shared-data test, or Cloudflare Pages Production environment variables for production.
7. Sign in with each operator account and verify that a payment entered on one device appears on the other.

The database is the source of truth for live use. The frontend only uses the public/anon key; row-level security restricts ledger tables to signed-in users. Keep the GitHub repository **private** because the backup files contain business/resident data.

## 3. Free live deployment

The intended no-paid-plan path is **Cloudflare Pages Free + Supabase Free + a private GitHub repository**. A default `*.pages.dev` HTTPS address is free; a custom domain is optional and would cost money to register.

1. Push this project to a **private** GitHub repository (see below).
2. In Cloudflare, open **Workers & Pages → Create → Pages → Connect to Git** and select the repository.
3. Build settings: production branch `main`, build command `npm install && npm run build`, output directory `dist`. Set `NODE_VERSION` to `22.16.0` in Pages build environment variables (the repository also includes `.node-version`).
4. Add these Pages environment variables for Production: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Avoid enabling Preview deployments until you decide which preview origins should be allowed in Supabase Auth.
5. Deploy. In Supabase **Authentication → URL Configuration**, set the Site URL to the new `https://<project>.pages.dev` address and add that URL to Redirect URLs.
6. Open the HTTPS address on each phone and use the browser menu to **Add to Home Screen**.

Free services have limits and no uptime guarantee. Supabase Free projects can pause after low database activity over seven days, and the Free plan does not include downloadable managed database backups. Keep verified off-site exports. Review current usage and billing limits before production; do not enable paid add-ons if the $0 requirement is strict. Keep this as a static Pages deployment. In GitHub billing settings, set a budget with **stop usage when the limit is reached** for Actions if the account has a payment method.

## 4. Daily database backups (important)

The workflow in `.github/workflows/backup.yml` creates a daily logical database dump as a GitHub Actions artifact and keeps each artifact for 30 days to limit storage usage on GitHub Free. To enable it:

1. In Supabase, copy the database connection string from **Connect** (use the Session pooler if required for your project).
2. In the private GitHub repository, open **Settings → Secrets and variables → Actions → New repository secret** and create `SUPABASE_DB_URL` with that connection string.
3. Open **Actions → Nightly database backup → Run workflow**. Confirm the run succeeds and download the resulting artifact once to verify it is non-empty. The workflow retains 30 daily snapshots; download a copy to storage you control regularly.
4. Periodically verify backups and practice restoring one into a separate test database. This dump covers the app's `public` schema, not Supabase Auth user records; recreate the two operator accounts after a full recovery. Never commit a dump, connection string, or resident data.

GitHub Free includes limited private-repository Actions runtime and artifact storage. This small ledger should be modest, but the backup workflow can stop if account limits are exhausted. Artifacts are only a short-term recovery layer, not an independent backup; download critical backups to a safe location you control regularly.

## 5. Push to GitHub

Create a **private** repository named `sakan-lodge` on GitHub, without adding a README/license/gitignore there. Then run from this folder:

```bash
git init
git add .
git commit -m "Prepare SAKAN Lodge ledger"
git branch -M main
git remote add origin https://github.com/<your-user>/sakan-lodge.git
git push -u origin main
```

If Git is already initialized, skip `git init` and do not add a second `origin`. Authenticate with GitHub's browser/credential flow; do not paste a password or token into source files.

## Business rules and checks

- Long-stay rent is per resident and follows the property's 14-day cycle. Mid-cycle arrivals are pro-rated and proposed rounding remains editable.
- Short stays use a separate nightly rate and one charge for the booking.
- Bonds are tracked as liabilities and excluded from income/profit.
- Electricity bills record the full expense; the amount over a property's cap is previewed and allocated pro-rata by quarter nights to residents still living there on bill date. The expense and resident charges post atomically in live mode.
- Landlord rent is derived from the property's cycle/lease-start settings instead of stored as repeated manual expenses.
- Reports separate earned charges from received payments; balances only consider payments received on or before the as-of date.
- Financial years run 1 July through 30 June; ledger start is 1 July 2026.

The specification has one detail to verify before live data entry: the portfolio table says Fulham has 5 rooms and 6 beds, while the room-detail paragraph says all five spaces are single occupancy. The seeded layout gives the granny flat capacity 2 to match the 6-bed total; edit it if the real occupancy rule is different.
