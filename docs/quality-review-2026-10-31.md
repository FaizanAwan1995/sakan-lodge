# Public website and Ledger reliability review — 31 October 2026

Scope: public browsing, maps, availability, reservations, enquiries, photo management, Ledger navigation, authentication, refresh, financial data loading and existing regression tests. Review is based on source inspection, isolated tests and browser checks; it is not a guarantee that every device or failure condition has been covered.

## Findings addressed in this release, in order

| Priority | Evidence | Change | Regression verification |
| --- | --- | --- | --- |
| High | `main.jsx` treated `/ledger` as a root-mounted app, so internal navigation could leave `/ledger/` and reach `/activity`, which the Worker returned as plain “Not found”. | Canonical `/ledger/` entry, consistent router base, redirects for known old Ledger paths, explicit HTML SPA shell for Ledger navigation, no-store document caching. Asset 404s remain real 404s. | Root, legacy bookmarks, reports query, deep tenant links, navigation without browser-specific headers and missing asset tests. |
| High | Auth subscription was registered after bootstrap; no application-level return-from-suspension check or bounded bootstrap recovery existed. | Subscribe early with synchronous callbacks; check saved session and server user on focus, visible, pageshow and reconnect; preserve valid sessions; show login for invalid sessions; offer retry on network errors. Store last safe page and scroll separately per admin, without form values or credentials. | Simulated long absence with refreshed token, expired session, sign-out race, hidden tabs, network failure and timed-out auth check. |
| Medium | Ledger snapshot loading, availability checks, reservation POSTs and enquiry setup fetches had no client timeout, leaving controls or loading messages stuck during an interrupted connection. | Bounded requests, explicit timeout feedback and retryable controls. | Snapshot timeout propagates to Retry; availability timeout restores controls; existing form validation, inventory gate and enquiry retry tests. |
| Medium | Reservation retry fingerprint included the hidden Turnstile response; changing a verification token could replace the idempotency key despite unchanged applicant details. | Exclude the verification response from the business-field fingerprint. | Lost-response retry with a renewed verification token retains the same reservation request key. |

## Existing safeguards checked

- The database remains authoritative for booking inventory, capacity and availability; a client availability result does not confirm a reservation.
- Enquiries/reservations keep origin checks, verification, idempotency and private staff notifications.
- Segment and room photos use staff-only writes, upload validation and revision checks; room publication is independent of uploading photos.
- Ledger loading uses one complete snapshot rather than mixed partial financial tables.
- Financial and bond behavior is not changed by this release. Existing finance, report reconciliation, tenant, invoice and database workflow suites remain release checks.
- Map loading and nearby lookups already have bounded waits and explicit retry/error behavior.

## Verification limits and follow-up queue

1. A real multi-hour iPhone background/resume test and signed-in admin UI check should complement the simulated lifecycle tests. Browser verification here can test signed-out deep-link recovery without borrowing admin credentials.
2. Unsaved form edits are not persisted across a full browser process termination. Page restoration does not imply an unsubmitted financial or booking edit was saved.
3. Existing Supabase advisor warnings were reviewed earlier in this session; this release changes neither database permissions nor authentication provider policy.
4. Continue targeted review of complete journeys (room photo upload → approved listing → enquiry/reservation → admin response) when changing those features. Retain these lifecycle tests in CI to prevent the route regression returning.
