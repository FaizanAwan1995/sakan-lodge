# SAKAN Lodge implementation checklist

Checked implementation items describe source code, not production activation.

## Requirements

- [x] Shared capacity above one: $185/person/week, long-term only.
- [x] Capacity one: private $255/week long-term or $300/week short-term.
- [x] Exactly two calendar months is long-term, with month-end handling.
- [x] Electricity, water, gas and internet included without surcharges.
- [x] Multiple properties per suburb; Fulham, Clapham and Oaklands Park.
- [x] Nested location/property/room URLs and separate private ledger.
- [x] Administrator approval before publication; public output excludes private records.
- [x] Checkout-driven explicit ledger release before readiness and publication approval.
- [x] Shared-room public availability limited to released bed spaces, not all empty beds.
- [x] Recover prior agreement/payment/bond decisions; supplied agreement is the private source document.

## Implementation

- [x] Server-rendered listing pages, SEO metadata, breadcrumbs and dynamic sitemap.
- [x] Shared inventory for ledger residents, active holds, reservations and blocks.
- [x] Database validation and locks for allocation changes and capacity edits.
- [x] Request idempotency, optimistic revisions, audit history and explicit hold expiry.
- [x] Staff listing editor, readiness, approval and concurrent-edit protection.
- [x] Reservation review/edit/hold/confirm/cancel/archive and atomic check-in.
- [x] Contract versions, administrator approval and private signed-document evidence.
- [x] Manually reviewed notification drafts with uncertain-send reconciliation.
- [x] Authenticated encrypted backup implementation and synthetic recovery test.
- [x] Realtime publication and staff refresh support.
- [x] Ledger release/withdrawal, idempotent release, check-in consumption and checkout-correction safeguards.
- [x] Reporting separates earned rent, actual receipts and forecasts; overhead, bonds, imported balances and CSV scopes reconcile.
- [x] Consistent staff-only ledger snapshot, large transaction-history checks and missing budget-column migration.
- [x] Multi-week reservation check-in preserves fortnightly billing at the agreed weekly rate.
- [x] Structured approved/signed nightly rates, bond and resident matching before confirmation/check-in.

## Verification and release gates

- [x] Pass revised application/PostgreSQL CI: 125 application/backup tests, 45 database checks and two runtime tests, no failures/skips.
- [x] Verify the latest reporting review in PostgreSQL CI, including concurrent snapshot consistency.
- [x] Verify competing ledger releases and reservation/check-in races after the release migration in separate PostgreSQL sessions.
- [x] Verify holds versus holds, check-ins versus check-ins, and holds versus check-ins in separate PostgreSQL sessions.
- [ ] Complete authenticated desktop/mobile, accessibility, offline and error-path acceptance.
- [ ] Verify deployment configuration, migration order and recovery rehearsal.
- [x] Recover the supplied agreement, fortnightly-in-advance payment terms and general two-week bond rule.
- [x] Private reusable template import/approval, immutable structured agreement snapshots and rendered A4 output with fresh signatures.
- [ ] Owner review and production import/approval of the proposed private source template.
- [ ] Verify and approve room content/readiness as each checked-out space is released from the ledger.
- [ ] Reconcile historical receipts/costs and opening bond liabilities against source records; paid-through/paid-status fields do not replace transaction history.
- [ ] Verify authorized test email delivery.
- [ ] Verify the deployed release and explicitly enable customer requests after acceptance.

Deployment-specific details and operational findings belong in private records.

The agreed decisions are recorded in [requirements-decisions.md](requirements-decisions.md). Routine release review is not a request to repeat those business decisions.

## Email preview and delivery review

- [x] Server-prepared immutable tenant email preview; real sender/staff CC and BCC recipients.
- [x] Atomic single-attempt claim; no automatic retry after uncertain delivery.
- [x] Subject/body placeholder checks, current-resident eligibility, MIME encoding and audit-failure regression coverage.
- [x] Application and PostgreSQL CI: 125 + 45 + 2 checks, no failures or skips.
- [x] Cloudflare workerd SQLite expiry/concurrency and persistence checks at the production compatibility date.
- [ ] Authenticated browser acceptance.
- [ ] Authorised real delivery and Gmail Sent Mail/audit reconciliation.
