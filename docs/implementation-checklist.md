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

## Verification and release gates

- [x] Existing application/PostgreSQL CI passed before the release-workflow correction.
- [ ] Verify the exact revised head in CI, including ledger release and post-migration concurrency checks.
- [x] Verify holds versus holds, check-ins versus check-ins, and holds versus check-ins in separate PostgreSQL sessions.
- [ ] Complete authenticated desktop/mobile, accessibility, offline and error-path acceptance.
- [ ] Verify deployment configuration, migration order and recovery rehearsal.
- [x] Recover the supplied agreement, fortnightly-in-advance payment terms and general two-week bond rule.
- [ ] Prepare the reusable private agreement from that source with current utilities wording, fresh applicant fields and fresh signatures; verify generated output.
- [ ] Verify and approve room content/readiness as each checked-out space is released from the ledger.
- [ ] Verify authorized test email delivery.
- [ ] Verify the deployed release and explicitly enable customer requests after acceptance.

Deployment-specific details and operational findings belong in private records.

The agreed decisions are recorded in [requirements-decisions.md](requirements-decisions.md). Routine release review is not a request to repeat those business decisions.
