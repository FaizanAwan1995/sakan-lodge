# Public room guide and optional AI

The public guide offers verified topic cards and photo/listing links without representing scripted answers as AI. It never reports room totals as vacancies. Existing rates remain unchanged. Unconfirmed nightly prices and the updated short-term cutoff go to the enquiry form.

Conversational AI is enabled by the production Wrangler configuration with both bindings:
- `ROOM_AI`: Workers AI binding supporting `run`.
- `ROOM_AI_LIMITER`: Cloudflare rate-limit binding supporting `limit` (recommended 10 requests per minute per IP).

The endpoint is `/api/room-assistant`. GET reports activation; POST requires same-origin JSON, bounded input and a verified Cloudflare IP. AI receives only curated public facts, not tenant records, credentials or database output. No conversation persistence is implemented. Provider operation may have costs. Verify AI output quality, privacy disclosure and abuse controls before activation. Treat model answers as guidance requiring team confirmation, never booking decisions.

Future room cards can draw from the public catalogue once audience eligibility and date availability are explicitly represented. Current guide links to public listings instead of inferring vacancies or showing potentially unsuitable rooms.

Questions are bounded to 600 characters; at most four previous messages are accepted. Responses are rendered as plain text. The 10 requests/minute/IP limiter is per Cloudflare location (not a global billing cap). Conversation context is held only in browser memory and AI sees curated public facts only. Nightly prices and date-specific vacancies require a team response.
