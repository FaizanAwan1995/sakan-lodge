# SAKAN Lodge development report

## Prepared implementation

The public website and private ledger share one database. Public pages expose only ledger-released, ready and approved listing profiles and aggregate availability. Resident identities, contact details and financial records remain staff-only.

An actual checkout must be explicitly released from the ledger. One shared-bed release cannot advertise other empty beds. A release starts readiness/publication review; check-ins consume releases, reservations/holds and maintenance reduce availability, and corrections or withdrawals remove eligibility. The catalogue, direct availability and sitemap share this gate.

The reservation flow supports pending requests, administrator review, expiring holds, signed-agreement confirmation, cancellation, archiving and atomic ledger check-in. Ledger occupancy, future reservations and room blocks use the same database inventory checks. Customer requests remain disabled until acceptance checks pass.

Additional work includes listing approval, versioned contracts, private signed-document storage, manually reviewed email drafts, privacy-safe error handling, SEO metadata and a published-only sitemap. Backup encryption support is included; deployment-specific configuration is deliberately excluded from these public notes.

## Validation

Application, API and isolated database tests are provided. A PostgreSQL service in CI runs the competing-reservation test using separate database sessions. Local checks do not replace authenticated browser acceptance or real-service delivery testing.

Verified in GitHub CI: **77 application/backup tests and 21 PostgreSQL workflow checks passed, with no failures or skips**. Separate sessions verified competing holds, competing ledger check-ins and a hold racing a check-in. Ledger checkout/extension and concurrent listing approval checks also passed. Syntax checks and the production build passed.

The subsequent explicit-ledger-release correction adds separate checks for checkout eligibility, released-bed limits, readiness/approval, consumption, withdrawal, corrections, reconfiguration and access control. Its exact-head CI result is recorded once verified.

The implementation is available in [draft PR #5](https://github.com/FaizanAwan1995/sakan-lodge/pull/5). These results verify the code and isolated database behavior; they do not assert production activation or browser acceptance.

## Release requirements

- Pass application/database CI and authenticated mobile/desktop acceptance.
- Review and apply the additive database migration in the correct release order.
- Use the supplied private agreement source, reconciling the later all-inclusive utilities decision and filling fresh applicant-specific fields/signatures. The source agreement is already supplied.
- Verify room content and readiness when staff release each checked-out space; no separate blanket list of properties to publish is required.
- Configure deployment secrets privately and verify backup recovery and email delivery.
- Verify the exact deployed code before enabling customer requests.

Operational findings, environment identifiers and private-data verification results are intentionally excluded from the public repository.
