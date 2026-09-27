# AutoDeal Pro — Business Rules

All rules are enforced in the core services (main process) and, where possible, again by database constraints/triggers. Amounts below are in currency units; internally they are stored ×100.

## 1. Vehicle cost & profitability
* **Actual Vehicle Cost = Purchase (or trade-in) value + all direct costs** linked to the vehicle (transport, customs, registration, maintenance, parts, bodywork, paint, tires, detailing, insurance, accessories, other).
* Direct costs can be added before or after the sale; profitability always uses the *current* actual cost (a snapshot `cost_at_sale` is also kept on the sale).
* **Gross Profit = Selling Price − Actual Cost**; **Gross Margin % = Gross Profit ÷ Selling Price × 100** (2 decimals).
  *Example:* 1,000,000 + 50,000 = 1,050,000; sold 1,200,000 → profit 150,000, margin 12.50 %.
* Fees charged to the customer (registration/admin) are part of the contract value but **not** of vehicle revenue for margin.
* General overhead (rent, salaries, …) is never added to a vehicle's cost; it appears in the monthly profitability report as a separate line (Net profit = gross profit − sale expenses − general expenses).
* The acquisition line (purchase price / trade-in value) is locked; it changes only through *Purchases → correct purchase price* (reason required, audited).

## 2. Pricing
* Asking price and minimum price per vehicle; `minimum ≤ asking`.
* Selling below the minimum: blocked for users without `sales.override_min_price`; with the permission the user must confirm and give a reason; the override is written to the audit log (`override_min_price`) and stored on the sale.
* Price changes are audited with old/new values. Sold vehicles cannot be re-priced.

## 3. Vehicle status lifecycle
`preparation / maintenance / available / returned` (manual) → `reserved` (reservation) → `sold` (sale) → `delivered` (delivery). Reserved/sold/delivered are system-controlled. Cancelling a sale returns the car to `available` (or `returned` if it had been delivered). Reservations that pass their expiry date become `expired` automatically and free the vehicle.

## 4. Validation rules
* Cannot sell or reserve a SOLD/DELIVERED vehicle (service check + DB trigger + unique active-sale index).
* A vehicle reserved for customer A cannot be sold to customer B.
* VIN / chassis number and engine number must be unique (case-insensitive) among non-deleted vehicles; national ID unique among customers.
* Negative amounts are rejected everywhere; amounts that must be positive (prices, payments, installments) reject zero.
* A payment can never exceed the outstanding balance of the contract.
* A custom installment schedule must sum **exactly** to the amount being financed — otherwise the save is blocked (and the whole sale is rolled back).
* A sale with installment collections cannot be cancelled (void the collections first). A customer with any transaction cannot be deleted. A vehicle linked to a purchase/sale/reservation/trade-in cannot be deleted (use status instead). Soft delete is used for vehicles, customers, suppliers, leads, cost lines and expenses.

## 5. Sales
Sale types: Cash, Installments, Trade-In + Cash, Trade-In + Installments.
```
Selling price        = list price − discount
Total contract value = selling price + fees
Financed amount      = total − trade-in value − reservation deposit − down payment
```
* Cash types: the customer pays the full remaining amount at sale (financed = 0).
* Installment types: financed must be > 0 and a plan is required.
* An active reservation for the same customer is converted automatically and its deposit credited.
* On save: vehicle → SOLD, quotation → sold, lead → won, trade-in vehicle → inventory, payments + contract created — all in one transaction.

## 6. Installment engine
* Plans: **Equal** (rounded to the configured unit, difference added to the last installment so the total is exact), **Balloon** (N−1 regular + final remainder), **Custom** (any amounts/dates; multiple installments in the same month allowed; dates must be non-decreasing).
* Never assumes `total ÷ count`.
* **Status** (computed at query time):
  1. cancelled (superseded by reschedule / sale cancelled)
  2. PAID — remaining = 0
  3. OVERDUE — due date < today AND remaining > 0 (days overdue = today − due date)
  4. PARTIALLY PAID — paid > 0 and not yet due
  5. DUE TODAY
  6. NOT DUE
* **Payment allocation**: default oldest-due first; optional manual selection of installments. A surplus over the selected installments is rejected unless the user explicitly enables "spill over to next installments" (advance payment). Paid > due is impossible (DB CHECK).
  *Example:* installment 75,000, payment 50,000 → paid 50,000, remaining 25,000, status Partially Paid.
* **Early settlement**: pays the whole outstanding balance, optionally with a settlement discount (requires `installments.manage`), recorded as a waiver on the remaining installments; the contract becomes *settled*.
* **Rescheduling** (requires `installments.manage`, reason mandatory, confirmation dialog): unpaid installments are cancelled, partially-paid ones are closed at their paid amount, and a new schedule (equal/balloon/custom) is generated for exactly the outstanding amount. Old & new schedules, reason, user and date are stored in `reschedules` and in the audit log.
* **Voiding a collection** (requires `payments.void`, reason mandatory) removes its allocations (installments return to their previous state) and keeps the receipt as *voided*.

## 7. Reservations
Deposit ≥ 0 recorded as a receipt; default validity from settings; can be extended; cancellation requires a reason and may refund all or part of the deposit (refund receipt). Expired deposits stay as a customer credit until refunded or used.

## 8. Trade-in
```
Expected total cost  = trade-in value + expected preparation cost
Expected profit      = expected selling price − expected total cost
```
The evaluation is used inside a sale (Trade-In + Cash / Installments). On acceptance the car is created in inventory as *used / under preparation* with a locked cost line equal to the trade-in value and asking price = expected selling price. Actual profit is reported once that car is resold.

## 9. Customer balance & statement
Statement debits: contract value of active sales, refunds. Credits: trade-in values, all valid payments, early-settlement discounts. Closing balance > 0 ⇒ the customer owes; < 0 ⇒ customer credit. Customer outstanding balance = remaining of all active installment contracts.

## 10. Inventory aging
Days in stock = today − acquisition date (for sold cars: sale date − acquisition date). Buckets 0–30, 31–60, 61–90, 91–120, 120+. Cars above the configured threshold (default 90 days) are flagged as stale on the dashboard and in the aging report.

## 11. Roles (default matrix – editable except Admin)
| Role | Access |
|---|---|
| Admin | Everything |
| Manager | Dashboard, reports (incl. profit), sales (incl. min-price override, cancel, deliver), inventory & pricing, customers, CRM, quotations, reservations, trade-ins, audit view |
| Salesperson | Customers, leads, quotations, reservations, sales, trade-in evaluation, vehicle list (no costs/profit) |
| Accountant | Purchases, vehicle costs, collections (create/void), installments management, expenses, reports, backups |
| Viewer | Read-only screens |

## 12. Audit trail
Logged with user, timestamp, action, module, record, old value, new value, details: logins (and failed logins), create/update/delete of master data, price changes, cost changes, purchase-price corrections, minimum-price overrides, sales, sale cancellations, deliveries, reservations (create/extend/cancel/expire), collections, voids, early settlements, reschedules, trade-in accept/reject, user & permission changes, settings, backups and restores. Audit rows cannot be edited or deleted.
