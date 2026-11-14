# Fulham granny flat applications

Share `/locations/fulham/properties/fulham-house-1/rooms/granny-flat/#reservation-form`.
The couples page now links directly to this application. Enquiries remain separate.

Applicants provide dates and separate legal names, email addresses, phone numbers,
optional occupations and photo IDs for both occupants. Both occupants consent to
the application. IDs accept JPG, PNG or PDF up to 5 MB each. The Worker verifies
the security challenge, rate limits uploads, validates file signatures and bounds
the complete multipart request before saving IDs to private `reservation-ids`
storage. Only authorised staff can read applicant rows or download IDs. No ID
content or storage paths enter contracts, public responses or notification emails.

The whole flat requires two occupants and a stay longer than three calendar
months. Inventory uses two places, while the ledger splits the advertised $500
weekly rent and $1,000 bond equally: $250/week and $500 bond per tenant. The
contract explicitly displays both the couple totals and individual shares. No
existing tenants, payments or agreements are rewritten.

Submission creates one pending reservation, two private applicant records and an
automatic draft agreement using the property's existing agreement defaults. A
private PDF is rendered immediately. If PDF rendering or storage is interrupted,
the saved draft remains available through the existing staff PDF action. Retry
keys compare dates, both applicants and content-addressed ID paths; retries do
not create duplicate requests. Direct ordinary-room submissions cannot bypass
the required couples form and IDs.

In Ledger → Reservations, review both applicants and download their IDs, open
the generated draft PDF and use the existing signing invitation workflow. Each
resident signs individually. Admin approval rechecks inventory, creates two
tenant records with their own contacts and links their IDs and signed contract.
The IDs are available in each tenant's Documents tab. Payment recording remains
separate. An application alone does not hold inventory or confirm a booking.

Verification covers malformed/missing occupants and IDs, file signatures,
request-size and access gates, minimum dates, public form routing, draft creation,
retry integrity, private storage access, both signatures, admin approval,
separate tenant contacts and the combined rent/bond amounts. Existing ordinary
room, agreement and ledger regression tests remain enabled.
