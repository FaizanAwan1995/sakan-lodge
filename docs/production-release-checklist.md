# Sakan Lodge production release and recovery checklist

This is a review checklist, not a claim that the steps have been performed.

## Before merging PR #3
1. Confirm latest GitHub Actions run succeeds for the exact head SHA.
2. Test login and all seven navigation tabs on a mobile phone and desktop.
3. Verify payment entry, duplicate warning, edit, typed delete confirmation, bond refund and tenant balance on a staging database.
4. Test emails with individual recipients, missing addresses, and placeholders. No automatic sends.
5. Test tenant statements against known ledger balances and verify cash-flow reports.
6. Check the Cloudflare Worker response headers, navigation and asset loading after deployment.
7. Run Lighthouse mobile and desktop, axe accessibility audit and keyboard-only walkthrough.
8. Test network-offline behavior and forced database permission errors.
9. Confirm monitoring endpoint ownership and privacy policy before setting VITE_MONITORING_ENDPOINT.
10. Verify restore using a separate disposable Supabase project; never restore over production to test.

## Access control: security blocker
The production RLS policies inspected on 2026-10-16 allow every authenticated user full access to properties, rooms, people, payments, expenses, charges, and maintenance (USING true / WITH CHECK true). This is authentication, not role-based authorization. Do not add superficial client-only role restrictions. Define owner/staff roles, provision existing accounts and test RLS in staging before replacing production policies. Do not apply an unverified RLS migration directly to production.

## Monitoring
Optional browser monitoring requires VITE_MONITORING_ENDPOINT to be set to an HTTPS collector controlled by Sakan Lodge. The app sends only whitelisted event names and numeric web vital values; no tenant names, addresses, amounts, tokens or email addresses. Until configured, no events are transmitted.

## Restore rehearsal
1. Download the latest successful encrypted/offsite backup and verify its checksum and file size.
2. Create a separate temporary database in the same Postgres major version.
3. Restore public schema and data into the temporary database; verify table counts, foreign keys, and representative financial totals.
4. Confirm authentication/users and Supabase-specific configuration are separately covered by the recovery plan (public-only pg_dump is not a full project backup).
5. Record restoration duration, recovery point, and procedure; delete temporary sensitive data securely after validation.

## Further hardening
- Financial duplicate detection in the UI is advisory; true idempotency needs a server-enforced request key and atomic database constraints.
- Current payment history pagination is client-side. At larger data volumes, move to server-side queries and totals with appropriate indexes.
- Production security headers are applied by the Worker; verify no alternate hosting path bypasses them.
- Use a staged rollout with a rollback plan; do not merge without acceptance testing.
