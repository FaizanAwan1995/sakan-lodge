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

## Verification and release gates

- [x] Pass application and PostgreSQL CI: 77 application/backup tests and 21 database checks, no failures/skips.
- [x] Verify holds versus holds, check-ins versus check-ins, and holds versus check-ins in separate PostgreSQL sessions.
- [ ] Complete authenticated desktop/mobile, accessibility, offline and error-path acceptance.
- [ ] Verify deployment configuration, migration order and recovery rehearsal.
- [ ] Approve agreement terms and verified property/room content.
- [ ] Verify authorized test email delivery.
- [ ] Verify the deployed release and explicitly enable customer requests after acceptance.

Deployment-specific details and operational findings belong in private records.
