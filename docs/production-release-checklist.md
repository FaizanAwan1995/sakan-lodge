# Sakan Lodge production release and recovery checklist

This is a review checklist, not a claim that the steps have been performed.

## Before merging the current release PR
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

## Access control verification
The earlier unrestricted-authentication finding was superseded by staff allowlisting and staff-restricted RLS. Do not treat the old finding as current deployment status. Before release, verify current policies and both approved accounts, and repeat negative tests with anonymous and authenticated non-staff users. Restrict private workflow tables and signed-document storage to staff; public RPCs expose only curated listing fields and aggregate availability. Record environment-specific verification privately.

## Ledger release and agreement acceptance
1. Apply the reservation/inventory migration before the ledger-listing-release migration in an isolated environment, preserving existing records and agreed amounts.
2. Verify that an empty room, a future departure and an approved profile alone cannot publish a listing.
3. Complete an actual checkout, explicitly release the space from the ledger, verify readiness and approve its profile. Confirm the public page and sitemap appear only then.
4. Release one shared bed with other beds vacant; public availability must remain one. Test withdrawal, check-in consumption, cancellation, expired holds, checkout corrections and capacity changes.
5. Use the supplied private agreement source with fresh applicant fields and signatures. Apply the later all-inclusive utilities rule to new agreements, preserving historical agreements.
6. Verify the general two-week bond and fortnightly-in-advance terms without overwriting individually agreed resident rates or bonds.
7. Do not activate customer requests until browser and real-service acceptance pass.

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
