# Tenant agreement signing

In Ledger → Reservations, open a request and review the proposed room, dates, rent, bond, all resident names and terms. Generate and open the original PDF. Create a signing link and email draft, review the recipient and message, then choose **Send signing invitation**. Email uses the connected lodge Gmail account; there is no attachment or reply-and-upload step.

Each named resident signs for themselves on the private, mobile-friendly page with a typed or drawn signature and explicit electronic consent. The server keeps the original PDF pages and appends a signature receipt for each resident. The page offers a signed PDF download immediately. Signing submits for review; it does not reserve a room, allocate anyone or record a payment.

Use the **Signature review** reservation filter. Open the signed PDF, review each signature and applicant identity, check the room and financial terms, and confirm the review checkbox. **Approve signed agreement and allocate room** rechecks capacity and agreed terms in one database transaction. All residents are linked to the signed contract in their tenant profile under bookings/contracts. Reject requires a reason, releases any hold and preserves the signed evidence. The signing page shows the review outcome while the link remains valid. It refreshes while awaiting review and provides the agreed stay details and arrival next steps.

## Changes and recovery

- Unsigned links default to seven days, configurable from one to fourteen. After signature submission, private receipt access lasts at least thirty days. Keep them private. They carry access to the named agreement, including personal information. Tokens stay in a URL fragment and request header, never a query parameter or browser storage. Pages disable indexing, referrers, third-party assets and analytics.
- Before signing, replacing/revoking a link invalidates its predecessor. Revising agreement details invalidates outstanding signing requests; generate a new PDF and obtain fresh signatures. Signed terms are not silently edited or reassigned to a different room.
- A connection failure can be retried with the same signatures. A reload during processing offers the saved submission again. Immutable storage paths and transaction guards prevent duplicate evidence and allocation. Changed signatures require a fresh request.
- An expired link cannot be used to sign or download. Administrators retain private access to saved evidence. After expiry, residents can request a copy from the team.
- Emails require explicit administrator send. An uncertain delivery is never automatically resent: reconcile Gmail Sent Mail in Activity before retrying or replacing an invitation.
- Room conflicts leave the signed request pending review and create no tenant. Offer a replacement agreement for a different room. Recording bond/rent remains a separate payment action.
- The offline allocation option remains available for previously signed agreements without an active online signing request. It cannot bypass an online signature awaiting review.

## Access and deployment

`contract_signing_requests` has staff-only read access and no client write grants. Staff operations enforce the existing SAKAN staff allowlist; public operations require the server service key and a random token hash. Public responses whitelist necessary agreement fields. Private PDFs remain in the existing `reservation-contracts` bucket. The existing Worker Supabase secret and IP rate limiter bindings are required; no new credentials are needed.

Automated coverage includes signature validation, unchanged original PDF pages, private route headers, storage response recovery, tenant profile linkage, agreed rent overrides, expired/revoked/replaced links, nonstaff denial, duplicate approvals and concurrent room conflicts. UI verification uses synthetic records only. This workflow records consent and evidence; administrators remain responsible for identity review and use of the appropriate agreement terms.

## Completion notifications

A new signed submission queues one alert per authorised administrator and the lodge mailbox using the existing automatic email worker. Approve/reject queues one applicant outcome message in the same transaction; failed room allocation rolls the email back too. Approval includes the room, premises, dates, signed-copy link and arrival/key collection contact instructions. Rejection includes the reviewed reason. Outcome messages acknowledge no payment. No historical submissions are backfilled or emailed when the migration runs.

Delivery status is visible in the signing panel. Queued messages normally send on the next minute’s existing cron run. Missing Gmail configuration leaves the queue pending. An uncertain result never automatically retries. Staff can record verified Gmail delivery or explicitly requeue after checking Sent Mail; those decisions are audited.

Future agreements replace the old signed-PDF email-return instruction while retaining payment amounts and tenancy clauses. Historical PDFs and saved template versions remain unchanged. A pre-existing unsigned PDF with the obsolete instruction must be regenerated before a new invitation can be issued.

Legacy hold/review/confirm/check-in actions cannot bypass an active online signing review. Place a hold before creating the signing link. Cancelling an unsigned online request revokes its link. Signed requests must use Reject with a reason so the applicant receives the correct outcome. Material edits still require a new agreement and signatures.
