# Reporting review

This describes management-report calculations and verification, not production activation or a claim that historical data is complete. Existing resident rates, agreements, bond declarations and transaction rows are preserved.

## Definitions

| Figure | Calculation |
| --- | --- |
| Rent earned | Agreed charges falling due in the selected property period, through the report date. |
| Rent received | Recorded rent payments dated in that period and no later than the report date. Never inferred from expected rent or paid-through balances. |
| Operating result | Rent earned plus other non-opening charges, less recorded costs and scheduled landlord obligations. |
| Receipts less recorded costs | Recorded rent payments less recorded expenses; separate from the operating result and not a bank balance. |
| Forecast | The same agreed rent due schedule over the full selected period, scheduled landlord costs, known costs and utilities provision. |
| Arrears and credit | Resident-by-resident closing balances, honoring imported paid-through baselines. Credits do not clear another resident's debt. |
| Bond balance | Recorded receipts less refunds and retained amounts. Legacy paid declarations remain visible for reconciliation; bonds stay outside income. |

## Confirmed corrections

- Removed the fallback that presented expected rent as actual cash collected.
- Separated earned, received, recorded-cost and forecast figures and exports.
- Made receipt property snapshots authoritative so moved residents cannot cause double attribution.
- Removed duplicate scheduled landlord costs when matching recorded costs cover the same property/due date. Partial records leave only the remainder scheduled; unmatched entries are retained and flagged for allocation review.
- Deducted whole-business overhead once from business totals and reconciled CSV totals to the same property periods used on screen. Headers are not sorted into transaction data.
- Kept opening balances, bond transactions and reimbursement status out of new income. Historical reimbursements cannot be reconstructed from a current status flag.
- Rolled fourteen-day cycles from each property's anchor relative to the report date. The previous-cycle view explicitly means the fourteen days before the next due date.
- Used calendar-month/year lengths for utilities budgets, including leap years. Budgets affect forecasts; known utility costs are not added twice.
- Kept historical paid bond declarations visible without inventing receipt dates or overwriting existing metadata.
- Neutralized spreadsheet formulas in all report/statement CSV text fields.
- Introduced a staff-only, RLS-preserving read-only database snapshot. All ledger tables share one statement snapshot; one JSON result avoids transaction truncation by table row limits. Older load responses cannot replace a newer result.
- Kept marketing stay-length categories separate from ledger billing. New reservation stays of at least a week use fortnightly ledger billing at the agreed weekly rate. Existing nightly residents retain their agreed nightly rates.

## Verification

Focused checks cover zero/future receipts, imported balances, first/final part periods, historical rates, property moves, opening arrears, resident credits, bond movements across years, legacy declarations, reimbursements, overhead, expense matching, monthly/leap-year budgets, date boundaries, CSV reconciliation and formula protection. Database checks cover missing budget columns, record preservation, more than one thousand transactions, read-only/staff-only access and a concurrent writer during a report snapshot.

GitHub CI passed 125 application/backup checks, all 45 PostgreSQL checks and two runtime tests, including six separate-session checks, with no failures or skips. The concurrent snapshot test verifies one consistent view while another staff transaction commits a payment and expense together.

## Remaining acceptance

- Apply the tested reporting migration before deploying a client that calls `ledger_snapshot()`. Customer activation remains off.
- Reconcile imported historical receipts, expenses and opening bond liabilities against source records. A paid-through date or paid-status declaration is not a transaction history.
- Import and approve the prepared private template after owner review. Structured nightly-rate approval is now implemented; signed rates, bonds and resident names govern confirmation/check-in. Automatic weekly-to-nightly conversion remains blocked; existing nightly ledger records are unchanged.
- Review unmatched/off-cycle landlord costs before treating their operating allocation as settled.
- Complete authenticated desktop/mobile and downloaded-CSV acceptance. Real-world completeness and browser behavior are not established by calculation tests alone.


## Admin collection view and source checks

Reports now has Property reports and Admin collections views. Admin collections has independent inclusive From/To dates plus recorded handler and payment-mode filters. It totals actual rent and bond cash/transfer receipts; bond refunds are outgoing and shown separately, with net receipts after refunds. Joint-account entries stay separate from individual admins. Missing or unknown handlers stay in Other / unassigned. Historical adjustments, bond applied to rent and retained bond allocations are excluded from new collections, even when an old allocation has a transfer method. Unverified payment modes and undated transactions remain flagged rather than assigned or treated as collected money. Refund-only selections can have negative net receipts; that is not negative income.

Admin summary and transaction CSVs use the selected filters. Transactions include IDs, recorded handler, tenant/property, amounts received/refunded and exclusions, allowing source reconciliation. Handler means the recorded receiver/processor, not verified ownership of a destination bank account. Net receipts do not include expenses and are not bank balances or profit.

Property reports now cross-check recorded rent totals and recorded expense totals against source rows, closing bond against the transaction ledger, and tenant statement balances against account balances. Bond opening balances and movements explain differences between current bond held and receipts in the selected period. Per-property cycle receipt checks use each property's own range; the bond movement explanation uses the explicitly shown common dates. Future periods do not imply receipts before their start.

The live 29 October 2026 snapshot audit matched all 24 account balances to database balances and tenant statements, matched source rent totals and CSV totals over four date ranges, and passed source checks across financial-year, monthly, previous-cycle, upcoming-cycle and custom views. This is a recorded-data arithmetic check, not evidence of historical completeness: no expense receipts were present, paid-through baselines do not reconstruct earlier rent cash receipts, and three profiles had no recorded bond receipt. Historical records were not changed by the reporting update.
