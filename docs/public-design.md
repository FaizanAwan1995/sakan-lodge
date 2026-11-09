# Public website design and enquiry flow

Keep the established forest green, gold, warm neutral palette and Inter font. Public foundations live in `public/design-tokens.css`; pricing and enquiry polish live in `public/stay-ui.css`. Keep responsive overrides beside their components rather than appending successive redesigns to `site-ui.css`.

`src/public-offers.js` holds the advertised pricing cards and couples FAQ, plus the pricing summary shared by listing pages and the AI prompt. `npm run build` synchronizes those generated homepage sections through `scripts/sync-public-offers.mjs`. This does not alter database pricing or agreement rules. Existing published two-calendar-month room pricing is preserved; nightly stays still need a team quote. The separate couples flat requires a stay longer than three months.

`public/enquiry-context.js` validates public room preferences, dates and identifiers before they enter enquiry URLs. Room, suburb, dates, occupancy and advertised offer selection can carry over. Contact details and client-provided prices cannot. The visitor can edit the resulting enquiry, and staff still confirm availability and price. A completed availability check never reserves a room.

Keep direct WhatsApp and Messenger choices accessible. On phones the contact rail starts collapsed beside the concierge launcher so it does not cover room descriptions. All controls need visible keyboard focus, touch-sized targets and reduced-motion handling.

Validation includes enquiry retries and idempotency, room-to-form navigation, invalid date handling, public-fact synchronization, booking and ledger regression checks, and browser checks of desktop, phone and tablet layouts. Local previews do not use production Turnstile credentials or send real enquiries.
