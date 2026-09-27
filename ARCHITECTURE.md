# AutoDeal Pro — Architecture

## 1. Technology stack (and why)

| Layer | Choice | Reason |
|---|---|---|
| Desktop shell | **Electron 37** | Real Windows desktop app (window, icon, installer, shortcuts), mature auto-packaging, Chromium gives perfect Arabic/RTL text shaping and `printToPDF`. |
| Database | **SQLite 3.50 via `node:sqlite`** (built into Electron 37 / Node 22) | Offline-first, single file, ACID transactions, foreign keys, triggers. **No native module to compile** — the Windows installer can be cross-built reliably and there is nothing to break on the customer's PC. |
| Business core | TypeScript, framework-free (`src/core`) | Pure, testable, independent of Electron. The same code runs in unit tests (plain Node) and in the app. |
| UI | React 18 + TypeScript + Vite, hand-written CSS (RTL-first), Cairo font bundled offline | Fast, no CSS framework lock-in, full RTL control. |
| Excel export | `exceljs` (bundled) | Real `.xlsx` with RTL sheets and numeric cells. |
| Tests | Vitest (unit/integration/perf) + Playwright driving the real Electron app (E2E) | Tests the actual business rules and the actual desktop UI. |
| Installer | electron-builder → NSIS (`AutoDealPro-Setup-x.y.z.exe`) | Standard Windows installer: install dir choice, Start-menu + desktop shortcuts, uninstaller, upgrade in place. |

Rejected alternatives: **Tauri** (Rust toolchain + WebView2 dependency on older Windows, fewer printing APIs), **.NET/WPF** (weaker RTL/Arabic typography work, no cross-build from the CI host), **better-sqlite3** (native module → must be compiled per Electron ABI and per OS; a frequent source of broken installs).

## 2. Process model & layering

```
┌──────────────────────────── Renderer (Chromium, sandboxed) ────────────────────────────┐
│ React pages / components  ──  lib/api.ts  (window.adp.call(method, args))               │
└──────────────────────────────────────────┬──────────────────────────────────────────────┘
                                           │ contextBridge (preload.ts) – no Node APIs exposed
┌──────────────────────────── Main process (Node) ▼──────────────────────────────────────┐
│ main.ts: window lifecycle, splash, single-instance, auto-backup timer, session           │
│   IPC router 'api' ──► SPECIAL handlers (auth, backup, print, export)                    │
│                   └─► core/api.ts  (method → service function)                           │
│ output.ts: print preview windows, printToPDF, CSV/XLSX writers                           │
└──────────────────────────────────────────┬──────────────────────────────────────────────┘
                                           ▼
┌──────────────────────────── Core (src/core, pure TypeScript) ──────────────────────────┐
│ services/*   business logic + validation + permission checks (requirePerm) + audit     │
│ calc/*       pure calculations: money, dates, installment schedules, statuses, FIFO     │
│ validate.ts  input validation with Arabic messages                                      │
│ errors.ts    AppError + translation of SQLite errors to friendly Arabic messages        │
│ print/*      HTML templates for all printable documents                                 │
│ backup.ts    VACUUM INTO backups, validation, safe restore with rollback               │
│ db/*         Db wrapper (statement cache, savepoint transactions) + migrations          │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

Separation required by the brief: **UI** (`src/renderer`), **Business logic** (`core/services`), **Database** (`core/db`), **Reporting** (`core/services/reports.ts`, `core/print`), **Calculations** (`core/calc`), **Validation** (`core/validate.ts` + DB constraints), **Authentication** (`core/services/users.ts`, `core/security.ts`), **Backup** (`core/backup.ts`).

## 3. Security model

* Passwords hashed with **scrypt** (random salt, N=16384) – never stored in plain text.
* The session lives in the main process only. Every call rebuilds the user context from the DB, so permission changes apply immediately.
* **Permissions are enforced in the core services** (`requirePerm`) — hiding a button in the UI is cosmetic only. Cost/profit fields are removed **server-side** for users without `costs.view` / `reports.financial`.
* Renderer: `contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP, navigation and `window.open` blocked.
* The audit log is append-only (DB triggers reject UPDATE/DELETE).

## 4. Money & dates

* All amounts are **integers in minor units** (1/100) end-to-end (DB, services, API). The UI converts once on input (`MoneyInput`) and once on display (`fmtMoney`). No floating-point money.
* Dates are ISO `YYYY-MM-DD` strings (local); the "today" used by overdue logic comes from the context (injectable for tests).

## 5. Data integrity strategy (defence in depth)

1. Service validation with clear Arabic messages.
2. Database constraints: PK/FK, UNIQUE (VIN, engine no., national ID, document numbers, one active sale / reservation per vehicle), CHECK constraints (non-negative amounts, `selling_price = list_price − discount`, `financed = total − trade-in − deposit − down`, `paid + waived ≤ amount`, …).
3. Triggers: `installments.paid_amount` maintained from `payment_allocations`; allocations immutable; audit immutable; no reservation/sale insert on a sold vehicle.
4. Every multi-step operation runs inside one transaction (nested operations use SAVEPOINTs), so a failure leaves no partial data (e.g. a sale with a mismatching custom schedule is rolled back completely).

## 6. Real-time dashboard

Every mutating API call broadcasts `data:changed` to the renderer; every screen built on `useApi` reloads automatically. All dashboard numbers are computed by SQL at request time — nothing is cached or hard-coded.

## 7. Printing & export

Documents are rendered from HTML templates (`core/print/documents.ts`) with the Cairo font embedded, shown in a preview window (Print / Save PDF buttons) or written straight to PDF with Chromium `printToPDF`. Tables export to real `.xlsx` (RTL sheet) or UTF-8-BOM CSV (opens correctly in Excel).

## 8. Backup / restore

* `VACUUM INTO` produces a consistent single-file snapshot while the app is running (images are stored in the DB, so the backup is complete).
* Automatic backups on start-up / every N hours / on exit, with retention.
* Restore = validate file (integrity check, schema version) → **automatic safety backup** of current data → replace file → reopen + migrate. On any failure the safety copy is put back.

## 9. Performance

Measured with 50,000 vehicles, 100,000 payments (+ allocations), 300,000 installments, 100,000 expenses (see TEST_PLAN.md): every list/detail query < 350 ms, dashboard < 0.7 s. Techniques: server-side pagination/sorting/filtering, targeted indexes, a correlated/index-backed cost view (migration 2), no N+1 queries.

## 10. Decisions log

| # | Decision | Rationale |
|---|---|---|
| D1 | Electron + `node:sqlite` | Zero native deps → reliable cross-built Windows installer. |
| D2 | Minor-unit integers for money | Exact accounting; custom schedules must sum *exactly*. |
| D3 | Vehicle direct costs in `vehicle_expenses`; overhead in `expenses` | The brief forbids mixing direct cost with overhead. The acquisition price is itself a (locked) cost line, so *Actual Cost = Σ lines*. |
| D4 | Installment status computed from dates at query time | "Overdue" depends on today; storing it would go stale. Only `paid_amount/waived_amount` are stored (trigger-maintained). |
| D5 | Rescheduling closes partially-paid installments at their paid amount and cancels unpaid ones; the old & new schedules are stored as JSON in `reschedules` + audit | Keeps history immutable and totals exact. |
| D6 | Trade-in is accepted as part of a sale | The trade-in value is the customer's credit on that sale; the vehicle enters inventory with cost = trade-in value in the same transaction. |
| D7 | Cancelling a sale is blocked if installment collections exist; otherwise down payment/deposit are refunded (refund receipt) and the vehicle returns to stock | Prevents inconsistent receivables; money movements stay traceable. |
| D8 | Images stored as compressed JPEG BLOBs in SQLite | One-file backup/restore includes the photos. |
| D9 | Date inputs use `en-GB` locale (dd/mm/yyyy, Latin digits) inside the Arabic UI | Unambiguous numbers for accounting staff. |
| D10 | Application data in `%APPDATA%\AutoDeal Pro` (kept on uninstall/upgrade) | Upgrades never touch customer data. |
