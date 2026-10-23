# Tenant account workflow

Home tenant names and balances open the canonical tenant account. A separate Record payment action opens the same contextual dialog used inside the account. Search includes current, upcoming, and past tenants. Returning from an account restores the originating page and scroll position.

Account shows outstanding, overdue, due today, credit, next rent charge, bond, transactions, and statements. Details contains contact/stay information and admin tenancy actions; Documents contains linked documents and booking contracts. Reports > Transactions provides the all-tenant history. Old /rent links redirect there.

Payments use a server-side request UUID. The same request returns its original result after a network retry. A reused UUID with changed details is rejected. Corrections require the exact prior payment record and a reason; the audit retains both versions. The dialog shows the resulting balance before saving. There is no payment delete action in this workflow.

Future weekly rent/cycle changes append effective-dated terms at an existing future rent boundary. Stored baseline rates and earlier derived charges remain intact. Existing details can still be explicitly corrected by staff, with a reason, stale-record protection, and balance-change confirmation. Historical corrections can affect derived rent; use future scheduling for new agreed rates. Nightly stays retain their existing one-booking charge behavior.

Bond receipts, refunds and retained amounts stay separate from rent. Bond changes validate dated receipt history, preventing a refund funded only by a later receipt. A legacy paid flag without receipt history is shown as needing reconciliation; no receipts are invented.

## Deployment and recovery

Apply the additive tenant_account_workflow migration before publishing the new frontend. It briefly locks the four ledger tables and compares fingerprints for all pre-existing tenant, payment, charge and audit values plus calculated balances. Any difference aborts the entire migration. No existing rows are updated or deleted by the migration.


Before any scheduled billing changes are used, the previous frontend can run with the additive schema. After effective-dated changes are recorded, rollback must retain the new billing calculation support; an older client would not interpret scheduled rates. Do not drop audit columns, request records, or billing schedules during rollback.

Validation covers unchanged migration data, same-key retry behavior, optimistic payment/profile corrections, dated bond validation, future billing boundaries, staff-only functions, and PostgreSQL concurrent retry behavior in CI. Browser smoke testing uses an isolated, browser-local synthetic account; no real tenant transactions are entered for tests.
