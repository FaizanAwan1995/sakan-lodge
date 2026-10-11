# SAKAN Lodge â€” Project Handover

Last updated: 11 October 2026

This file is the practical recovery and operations guide for the SAKAN Lodge rooming-house ledger. Keep it with the project and keep a separate copy somewhere you control. It intentionally does not contain passwords, secret keys, database connection strings, or resident data.

## Project at a glance

SAKAN Lodge manages a small Adelaide subletting business. The partners take houses on lease and sublet individual rooms. The app tracks properties, room occupancy, resident stays, rent and bond transactions, lease costs, operating expenses, repairs, reports, and an audit history showing who recorded changes.

## Important links and identifiers

- Private GitHub repository: <https://github.com/FaizanAwan1995/sakan-lodge>
- Supabase project reference: `gpohuctqsmmoikupyfvi`
- Supabase project URL: <https://gpohuctqsmmoikupyfvi.supabase.co>
- Cloudflare Worker: `sakan-lodge` in the `faizan-awan` workers.dev account subdomain.
- Version URL shared during deployment: <https://6a71f3ed-sakan-lodge.faizan-awan.workers.dev/>
- Stable Worker URL to try: <https://sakan-lodge.faizan-awan.workers.dev/>

The URL with `6a71f3ed-` is version-prefixed and may point to a particular build. Use the stable URL without that prefix for normal access. Faizan asked to remove the personal name from the address; changing the Cloudflare account's workers.dev subdomain is still pending. A custom domain such as `sakanlodge.com` would require owning/registering that domain.

## Technology and source layout

- React 19 with Vite 8; JavaScript ES modules.
- Node.js 22.12 or newer and npm.
- Supabase JavaScript client and PostgreSQL for shared online data.
- Cloudflare Workers deployment with static Vite assets.
- `src/App.jsx`: screens, forms, user/session flow, and reports.
- `src/store.js`: local browser storage or Supabase persistence, realtime refresh, saves, and deletes.
- `src/ledger.js`: rent cycles, occupancy and financial calculations.
- `src/ledger.test.js`: automated ledger checks (`npm test`).
- `supabase/schema.sql`: initial database schema and seeded properties/rooms.
- `supabase/migrations/`: later database changes; apply in the order listed below.

## App capabilities

- **Today:** arrears, overdue residents, upcoming landlord rent, occupancy, bonds held, lease-end reminders, and urgent/overdue repairs.
- **Rooms & residents:** add/edit properties and rooms; resident contact details; long or short stays; check-in and checkout; rates, dates, bond amounts, and paid-up-through details.
- **Rent:** add/edit/delete rent and bond transactions; record payment date, method, notes, recipient/handler, and receipt details.
- **Expenses:** property or business-level costs, landlord rent, utilities, maintenance, and electricity bills with excess allocation.
- **Repairs:** track property/room, issue, urgency, contractor, due date, and completion.
- **Reports:** earned rent vs received rent, costs, net operating result, held bond liability, property-level figures, financial-year/month/custom date ranges, and CSV export.
- **Activity:** records creates, edits, checkouts, and deletes with the actor name; live mode keeps recent audit entries in the database.

## Business calculations to preserve

- Long-stay rent follows each property's 14-day lease cycle; first/mid-cycle rent can be prorated.
- Short stays use a nightly rate and booking charge.
- Bond money is a liability, not rent or profit. Refunds and retained amounts are separate transactions; amounts retained at settlement are reported as other income.
- Landlord rent is calculated from each property's lease cycle rather than entered repeatedly as an expense.
- Electricity bills record the full expense; usage above the configured cap can be allocated to residents pro rata by occupied quarter-nights. Live posting is atomic.
- Reports distinguish rent earned from cash received and only count payments on or before the report's as-of date.
- Financial year runs 1 July to 30 June; the ledger start date is 1 July 2026.

## Database and migrations

The shared Supabase database is intended to be the source of truth for Faizan and Danish. Tables include `properties`, `rooms`, `people`, `charges`, `payments`, `expenses`, `maintenance`, and `audit`. Row-level security is enabled; app data must only be accessed through an authenticated Supabase session. Realtime is used to refresh partner sessions when a record changes.

Initial schema: run `supabase/schema.sql` once in the Supabase SQL Editor. Then apply each migration once, in this order:

1. `supabase/migrations/20261011_atomic_electricity_bill.sql`
2. `supabase/migrations/20261011_payment_types_and_audit.sql`
3. `supabase/migrations/20261011_lease_end_reminders.sql`
4. `supabase/migrations/20261011_maintenance_queue.sql`
5. `supabase/migrations/20261011_security_and_indexes.sql`

The schema seeds four properties and 25 rooms. Verify the actual room capacities against the houses before relying on occupancy totals; the original brief had a Fulham capacity detail that needed confirmation.

## Local mode vs shared mode

The app selects its storage mode at build time:

- With no valid `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, it runs in local preview mode. Records live only in that browser's `localStorage`; Danish/Faizan buttons are labels, not secure accounts, and do not sync to another device.
- With those two variables configured, it uses Supabase. The chooser leads to Supabase sign-in; a name button by itself does not authenticate anyone or grant database access. Shared updates require valid Supabase users and RLS policies.

Login setup was deferred. Before entering real resident or payment details, create the partner users, confirm sign-in works, and test on two separate devices/browsers. Prefer separate user accounts so the audit trail can identify the actual editor. Do not disable RLS or expose a service-role key to make sign-in easier.

## Cloudflare deployment

Cloudflare Worker name: `sakan-lodge`.

Build settings used in the dashboard:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Root directory: `/`
- Build variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`

Set the two Vite variables in **Build variables** before building, because Vite embeds them in the generated client bundle. The publishable key is designed to be public; database security comes from Supabase Auth and RLS. Never place a Supabase secret/service-role key or database password in Vite variables or browser code.

The Cloudflare build completed successfully and the user confirmed the Worker was deployed. Confirm that the production build variables are present and that the stable Worker URL opens before sharing the app. If the GitHub-to-Cloudflare build integration is active, pushes to the configured production branch should trigger deployment; confirm the branch and deployment status in Cloudflare.

## Backups and recovery

### Supabase online database

The repository contains `.github/workflows/backup.yml`. It intends to make a daily SQL dump of the Supabase `public` schema, upload it as a GitHub Actions artifact, and retain each artifact for 30 days. It also supports a manual run.

This workflow requires the GitHub Actions repository secret `SUPABASE_DB_URL` containing the Supabase database connection string. **Do not assume backups are working until that secret is configured and a manual workflow run succeeds.** Download important artifacts to storage you control; the GitHub artifact is only short-term backup. The dump covers `public`, not Supabase Auth users, so recreate partner accounts after a full recovery. Practice restoring a dump to a separate test database before depending on it.

### Local browser preview

Local mode has **Activity â†’ Download backup** and **Restore backup**. Its JSON contains sensitive resident and financial details. Store it encrypted/private and never commit it to GitHub. Browser local storage is not a backup and can be lost when browser data is cleared.

### Keep code recoverable

Keep the GitHub repository private. Also retain a local/offline copy of the project and this handover file. The local checkout showed pending changes to `README.md` and `supabase/schema.sql`, plus an untracked `supabase/migrations/20261011_security_and_indexes.sql` when this note was written. Check `git status` and ensure intended changes are committed and pushed before treating GitHub as a complete copy.

## Current follow-up checklist

- [ ] Set up and verify Supabase sign-in for Faizan and Danish; set the production Site URL and Redirect URLs to the live app origin.
- [ ] Confirm the Cloudflare Worker has the two production **build** variables and uses Supabase mode after a fresh build.
- [ ] Test one resident, one rent payment, one expense, and one edit from each partner's device; verify realtime visibility and audit actor.
- [ ] Add `SUPABASE_DB_URL` to GitHub Actions secrets, manually run **Nightly database backup**, and download/verify the artifact.
- [ ] Confirm pending local files are committed/pushed and that Cloudflare deploys from the intended branch.
- [ ] Change the Cloudflare workers.dev account subdomain to a business name to remove `faizan-awan`, or connect a domain the business owns.
- [ ] Confirm the seeded room capacities and lease cycle/rent amounts match the actual four properties.

## Safe handling checklist

- Keep resident contact information and financial records private.
- Keep the GitHub repository private.
- Never share or commit `.env`, Supabase database connection strings, service-role/secret keys, partner passwords, or downloaded backups.
- Supabase publishable keys are public client identifiers, not database passwords; rely on authentication and RLS for access control.
- If a secret is ever exposed, rotate it in the provider dashboard and update the relevant GitHub/Cloudflare secret immediately.

