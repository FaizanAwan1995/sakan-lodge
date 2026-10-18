# Email workflow review

Tenant email previews are prepared on the server after staff authentication. The preview shows the actual connected sender, approved staff CC addresses, deduplicated BCC recipients, subject and plain-text body. No token refresh or Gmail delivery occurs during preview. This checks stored configuration, not whether Google will accept the next delivery.

The server stores a review for fifteen minutes, scoped to the reviewing user. Sending claims that review atomically and ignores replacement recipients, message content and client copy settings. Each review permits one attempt. Changed sender or staff CC addresses require a new preview. Draft edits or resident-address changes invalidate the displayed review. Expired previews fail closed.

Review content is removed from storage when claimed; a short-lived claim marker prevents repeated attempts. Expiry cleanup removes unused drafts and markers. Lost responses or uncertain delivery do not automatically retry. Staff must check Sent Mail before deliberately preparing another preview; a new preview is a new message, so this process still requires staff reconciliation after an uncertain result.

Reservation messages continue to use their database outbox claim and reservation revision checks. They cannot substitute caller-supplied recipients or text, and uncertain results require explicit reconciliation. General staff CC copies are not silently added to reservation-specific drafts.

Additional corrections exclude future arrivals from current-tenant selections, reject unresolved placeholders in subjects and bodies, reject address/header injection, fold Unicode MIME headers and body lines, and preserve successful delivery status when subsequent activity logging fails.

Mocked tests cover reviewed content, recipient privacy, no-delivery preview, concurrent/repeated attempts, uncertain outcomes, staff ownership, changed CC configuration, expired reviews, placeholder/header validation, Unicode MIME transport and audit failures. These are application tests, including a transactional storage fixture; they do not replace a Cloudflare runtime concurrency test, authenticated browser acceptance, OAuth renewal or authorised real delivery.

Deployment must include the Worker and ledger client together. Keep customer booking gates off. Remaining acceptance includes connected-account checks, mobile/desktop preview interactions, Cloudflare storage/expiry behavior, an explicitly authorised test send and Sent Mail/audit reconciliation. No real email was sent during this review.
