# Public Sakan concierge

The responsive chat opens with an optional name/email/phone introduction. Successful submissions use the existing Turnstile-protected `/api/enquiries` workflow, including its idempotency, private storage and administrator inbox. The required enquiry-contact consent and separate optional future-availability consent, audience interest and timestamp are recorded in the enquiry message. No mailing campaign is sent by this feature. Visitors can browse without contact capture.

Contact form fields never enter model prompts or browser chat storage. The public chat warns against sharing personal details; email addresses and phone-like strings in chat are filtered client-side. This is a convenience filter, not a guarantee that arbitrary personal information can be detected.

Conversation history (up to 40 messages) and validated household/suburb preferences live in sessionStorage, expire after 24 hours, and survive reloads in the same tab. Closing the browser session or using New chat clears this context. No transcript is stored server-side. Each model request includes at most six previous question/answer pairs plus validated preferences, allowing follow-ups after longer conversations.

The Worker uses `ROOM_AI` and `ROOM_AI_LIMITER` (10 requests/minute/IP per Cloudflare location, not a global billing cap). The active 70B primary model falls back once to the active 8B fast variant on provider errors. Both receive curated public facts only, never tenant records or database data. UI errors preserve the draft and provide retry and an enquiry link. AI cannot book rooms, decide housing eligibility, confirm vacancies or invent nightly prices.

Room cards are curated public examples selected from visitor-stated preferences. Cards have fixed first-party image and listing URLs; generated text is rendered as plain text, never HTML. Photos do not prove availability. Team confirmation remains required.
