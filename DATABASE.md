# AutoDeal Pro — Database

SQLite 3.50 (single file `autodeal.db`, WAL mode, `foreign_keys = ON`). Schema is created and upgraded by versioned migrations in `src/core/db/migrations.ts` (table `schema_migrations`). **Money = INTEGER minor units (1/100).** Dates = `TEXT 'YYYY-MM-DD'`, timestamps = `TEXT 'YYYY-MM-DD HH:MM:SS'` (local).

Location on Windows: `%APPDATA%\AutoDeal Pro\data\autodeal.db` (backups in `%APPDATA%\AutoDeal Pro\backups`, configurable).

## Entity overview

```
roles ─< role_permissions >─ permissions          users >─ roles
suppliers ─< purchases >─ vehicles ─< vehicle_expenses (Cost Card lines)
                               │  └─< vehicle_images
customers ─< leads ─< follow_ups
customers ─< quotations >─ vehicles
customers ─< reservations >─ vehicles        (≤1 active reservation per vehicle)
customers ─< sales >─ vehicles               (≤1 active sale per vehicle)
sales ─ 1:1 ─ installment_contracts ─< installments
customers ─< payments ─< payment_allocations >─ installments
sales ─< trade_ins ─ 1:1 ─ vehicles (the traded-in car entering stock)
expenses (general / sale-related) >─ sales
installment_contracts ─< reschedules
audit_logs, settings, sequences, backups, schema_migrations
view v_vehicle_cost (acquisition_cost, direct_costs, actual_cost per vehicle)
```

## Tables

| Table | Purpose | Key constraints |
|---|---|---|
| `users` | Accounts (scrypt password hash) | `username` UNIQUE (case-insensitive), FK role |
| `roles`, `permissions`, `role_permissions` | RBAC matrix (editable, admin fixed) | composite PK |
| `suppliers` | Sellers: company / individual / dealer / agent / workshop | soft delete |
| `vehicles` | Vehicle master (new/used, specs, status, acquisition, asking/min price) | `stock_no` UNIQUE; partial UNIQUE on `vin` and `engine_no` (non-deleted); CHECK status/condition/year/mileage ≥ 0; `min_price ≤ asking_price` |
| `vehicle_images` | Compressed photos (BLOB) | FK vehicle CASCADE |
| `vehicle_expenses` | **Cost Card lines**: purchase price / trade-in value (locked) + direct costs (maintenance, bodywork, paint, tires, transport, customs, registration, insurance, detailing, accessories, parts, other) | FK vehicle; `amount ≥ 0`; soft delete |
| `purchases` | Purchase document linked 1:1 to vehicle | `vehicle_id` UNIQUE; `purchase_price > 0` |
| `purchase_payments` | Payments to the seller | `amount > 0` |
| `customers` | Customer master | `code` UNIQUE; partial UNIQUE `national_id`; soft delete |
| `leads`, `follow_ups` | CRM pipeline (status, source, next follow-up) | CHECK enumerations |
| `quotations` | Price quotes | CHECK `final_price = asking_price − discount` |
| `reservations` | Deposits holding a vehicle | partial UNIQUE (vehicle) WHERE active; CHECK expiry ≥ date; trigger blocks sold vehicles |
| `sales` | Sales invoice/contract header | partial UNIQUE (vehicle) WHERE active; CHECKs: `selling = list − discount`, `total = selling + fees`, `financed = total − trade_in − reservation_credit − down_payment`; trigger blocks sold vehicles |
| `installment_contracts` | One per installment sale | `sale_id` UNIQUE; `financed_amount > 0` |
| `installments` | Schedule lines (versioned) | CHECK `amount > 0`, `paid + waived ≤ amount`; `paid_amount` maintained by triggers |
| `payments` | Every money movement with a customer (reservation deposit, down payment, cash sale, installment, early settlement, refund) | `receipt_no` UNIQUE; `amount > 0`; CHECKs tie kind → contract/sale/reservation; soft void (`status='voided'`) |
| `payment_allocations` | Payment → installment split | triggers update `installments.paid_amount`; UPDATE forbidden |
| `reschedules` | Old/new schedule JSON, reason, user, versions | FK contract |
| `trade_ins` | Evaluations + acceptance (links sale and new vehicle) | `trade_in_value > 0` |
| `expenses` | General overhead & sale-related expenses (NOT vehicle direct costs) | CHECK `scope='sale' ⇒ sale_id NOT NULL`; soft delete |
| `audit_logs` | Who/when/what/module/record/old/new/details | append-only (UPDATE/DELETE triggers raise) |
| `settings` | Company data, business parameters, backup options | key/value |
| `sequences` | Yearly document counters (e.g. `SL-2026-00012`) | PK name |
| `backups` | Log of created backups | — |

## Indexes (main)

`vehicles(status, deleted_at)`, `vehicles(brand, model)`, `vehicles(acquisition_date)`, `vehicle_expenses(vehicle_id, deleted_at, category, amount)` (covering, used by the cost view), `sales(sale_date)`, `sales(customer_id)`, `sales(salesperson_id)`, `installments(contract_id, is_cancelled, seq)`, `installments(due_date, is_cancelled)`, `payments(customer_id, status)`, `payments(pay_date, status)`, `payments(contract_id)`, `payment_allocations(payment_id)`, `payment_allocations(installment_id)`, `expenses(expense_date, deleted_at)`, `audit_logs(created_at)`, `audit_logs(module, record_id)`, plus the UNIQUE indexes above.

## Views

`v_vehicle_cost(vehicle_id, acquisition_cost, direct_costs, actual_cost)` — **Actual Vehicle Cost = Σ non-deleted cost lines**. Migration 2 re-defined it with correlated sub-queries so paged lists compute costs only for returned rows.

## Migrations

| Version | Name |
|---|---|
| 1 | initial schema |
| 2 | faster cost view (correlated, index-backed) |

Rule: released migrations are never edited; new changes are appended. Backups from a *newer* schema are refused on restore; older backups are migrated automatically when opened.
