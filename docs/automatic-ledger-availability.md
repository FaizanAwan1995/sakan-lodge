# Automatic ledger availability

Owner decision, 18 October 2026: advertise current vacant rooms and update customer availability automatically when a ledger checkout takes effect. This supersedes the manual release quota described in earlier release documentation.

Approved, ready room and property profiles remain required. Public content may use verified suburb, ledger room label/capacity, agreed public pricing and included utilities. Photos are optional; never invent photos, amenities or property details. Approval is for the profile, not for each vacancy cycle. New or changed room configurations still require content/readiness review.

The catalog, sitemap and date availability use physical database inventory directly. Completed checkouts free spaces on their Adelaide calendar date; future checkouts do not free today's inventory. New arrivals, active holds, confirmed reservations and maintenance blocks reduce capacity. Checkout corrections and cancellations are reflected without a background job or deployment. Public responses are not cached. Existing room locks and atomic booking validation remain unchanged.

The manual release buttons are retired. Historical release records remain private for audit. Staff can pause publication by unpublishing a profile or marking it not ready. Automatic availability does not enable customer reservation requests.

Validation includes initial vacancies with no checkout history, future departures, completed/reversed checkouts, readiness, maintenance, holds/cancellation, anonymous privacy and staff authorization, plus the existing database and application suites.
