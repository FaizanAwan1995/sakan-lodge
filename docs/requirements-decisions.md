# SAKAN Lodge requirement decisions

This is a source requirement record, not permission to activate untested customer bookings. Later explicit business decisions supersede conflicting examples in older documents.

## Public website and private ledger

- The private ledger is the source of resident occupancy and actual checkouts. It remains separate from public pages, using the same underlying database inventory.
- Only spaces explicitly released from the ledger following an actual checkout may be advertised. An empty room or an approved profile alone is insufficient.
- The flow is checkout, explicit ledger release, readiness/cleaning/repair checks, then administrator publication approval. A scheduled future departure is not an actual checkout.
- Shared rooms advertise released bed spaces, not unrestricted whole-room capacity. Each new release requires review; check-ins consume releases, holds and confirmations reduce availability, and cancellation/expiry returns temporary allocations.
- Corrections to a checkout, withdrawal of a release and room reconfiguration remove eligibility. Historical releases remain in the private audit trail.
- Property and room pages, availability and sitemap all use the same release eligibility. Public output excludes resident identities, contact details, agreements and financial records.
- Support several properties per suburb. Public suburbs are Fulham, Clapham and Oaklands Park; paths are `/locations/{suburb}/properties/{property}/rooms/{room}/`.

## Prices and utilities

- Capacity above one: shared accommodation only, $185 per person/week, long-term only.
- Capacity one: private, $255/week long-term or $300/week short-term.
- Exactly two calendar months qualifies as long-term, including month-end date handling.
- Electricity, water, gas and internet are included without extra charges. The older electricity threshold/excess wording is superseded for new offers and agreements.
- Existing residents' agreed rates, bonds, financial history and signed agreements remain unchanged. Sample resident amounts are not defaults for new applicants.

## Agreements, payments and staff workflow

- An accommodation agreement source has been supplied; it is not a missing business input. Keep the resident-specific source and its signature private, and never reuse an existing signature on a new agreement.
- The existing specification records a bond generally equal to two weeks' rent, separately tracked as a liability. Preserve individual agreed amounts and permit explicit staff review.
- The supplied agreement records fortnightly rent in advance, using cash or direct transfer. Preserve the existing house-cycle and editable pro-rata ledger rules.
- Use reservation-specific names, premises, dates, agreed price and bond. Faizan or Danish approves each current agreement version and verifies the required proprietor/resident signatures.
- Do not infer a universal six-month term from a completed resident example, invent cancellation/refund fees, automate penalties, or copy historical applicant details into new contracts.
- Reservation requests are unconfirmed. Staff can review, modify, hold with an explicit expiry, confirm with a current signed agreement, cancel/archive and check in atomically.
- Notification drafts go through manual review and sending. Uncertain sends require reconciliation before retrying.
- Database validation must prevent double bookings across ledger residents, reservations and blocks, including concurrent writers.

## Reporting and billing

- Earned means agreed charges falling due in the period; received means dated recorded rent payments. Operating profit uses earned income, and the two measures remain separate.
- Imported paid-through dates establish resident balances; they do not create cash receipts or erase historical earned rent. Opening arrears are not new income.
- Bonds are liabilities outside operating income. Preserve existing paid-status declarations and agreed amounts; missing opening receipts/liabilities require reconciliation rather than invented cash entries.
- Count whole-business costs once. Reimbursement status does not create a second expense.
- Utilities budgets and future rent belong to forecasts. Forecast rent follows the same due-date basis as earned rent; expected rent never becomes recorded income.
- Reservation short/long is the public pricing category. Ledger billing for stays of a week or more remains fortnightly at the agreed weekly rate. Under-seven-night billing requires its separately approved nightly rate; do not derive it automatically from the public weekly quote.

## Release acceptance

- Preserve historical resident and financial records through every migration and test.
- Do not publish unverified descriptions/photos/amenities or automatically treat an old marketing image as a verified room photo.
- Keep customer requests off until database, browser and service acceptance is complete. Source/CI success is not proof of production activation.
