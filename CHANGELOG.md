# Changelog

## 1.0.0 — 2026-09-27
First commercial release.

### Features
- Windows desktop app (Electron) with splash screen, icon, NSIS installer, Start-menu/desktop shortcuts, single-instance lock.
- Arabic RTL UI: dashboard, vehicles (with photos, cost card, pricing, history), purchases & suppliers, vehicle direct costs, customers (360° view & statement), leads/CRM with follow-ups, quotations, reservations, sales wizard (cash / installments / trade-in + cash / trade-in + installments), installments & collections, trade-ins, expenses, reports, users/roles/audit log, settings, backup/restore.
- Installment engine: equal, balloon and custom schedules; partial and multiple payments; FIFO or manual allocation with optional spill-over; early settlement with discount; rescheduling with full history; payment voiding.
- 25 reports (inventory, aging, purchases, sales, profitability, installments, collections, receivables aging, expenses, trade-ins) with print, PDF, Excel (.xlsx) and CSV export.
- Printable documents: quotation, reservation receipt, sales invoice, sales contract, installment schedule/contract statement, payment receipt, customer statement, vehicle cost card, purchase document.
- Role-based permissions enforced in the main process; scrypt password hashing; immutable audit log.
- Automatic and manual backups (consistent online snapshot), validated restore with automatic safety copy.
- Demo dataset loader.

### Fixes during QA
- Backup audit entry was missing from the backup file itself (logged after the snapshot) → now written before the snapshot.
- Vehicle list and dashboard slow with 50k vehicles (grouped cost view) → migration 2: correlated, index-backed cost view (list 241 ms → 54 ms).
- Changing one's password with a wrong current password logged the user out (wrong error code) → validation error instead.
- Installer "application is running" false positive (PowerShell/tasklist check) → nsProcess-based check.
- Startup could stall before creating the database if the splash window blocked → database opened before any window; window shown by fallback timer if `ready-to-show` is late.
- Reports / vehicle table overflow at 1366×768, `mm/dd/yyyy` date inputs, sidebar scrolling at 768 px height → layout fixes, `en-GB` date format, compact sidebar.
