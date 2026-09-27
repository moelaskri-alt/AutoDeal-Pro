# AutoDeal Pro — Test Plan & Results

Test run date: 2026-09-27 (Linux container, Electron 37.10.3, SQLite 3.50.4, Wine 9 for installer tests).

## 1. Test layers

| Layer | Tool | Command | What it proves |
|---|---|---|---|
| Unit – calculations | Vitest | `npm test` | schedules, rounding, statuses, overdue days, FIFO, margins, dates |
| Integration – business rules | Vitest on a real SQLite DB | `npm test` | every service through the same API the UI uses; permissions; audit; backup/restore |
| Demo & final scenario (service level) | Vitest | `npm test` | §32 dataset + §61 BMW scenario incl. backup/restore/reopen |
| Performance | Vitest | `npx vitest run --config vitest.perf.config.ts` | 50k vehicles / 100k payments / 100k expenses |
| End-to-end UI | Playwright driving the packaged-mode Electron app under Xvfb | `xvfb-run -a npm run test:e2e` | full demo scenario through real screens; tour of all screens at 3 resolutions with automatic layout checks |
| Installer | Wine + NSIS silent flags | `bash scripts/installer-test/run-installer-tests.sh` | fresh / reinstall / upgrade / uninstall / clean install |

## 2. Results summary

| Suite | Result |
|---|---|
| Unit + integration + scenario (4 files, 44 tests) | **44 / 44 passed** |
| Performance | **passed** (see §5) |
| E2E final demo scenario | **22 / 22 steps passed**, 0 JS errors |
| E2E UI tour (22 screens × 3 resolutions + tabs + modals) | **0 layout issues**, 0 JS errors |
| Installer lifecycle | **21 / 21 checks passed** |

## 3. Scenario coverage (§33)

| # | Scenario | Covered by |
|---|---|---|
| 1 | Create vehicle | business.test (VIN), scenario UI "إضافة سيارة", security.test |
| 2 | Purchase vehicle | scenario step 2 (UI), all integration tests |
| 3–4 | Add vehicle cost / actual cost | business §34, scenario steps 3–4 (1,263,000) |
| 5–6 | Customer / lead | scenario step 5; demo.test (leads, follow-ups) |
| 7 | Quotation | scenario step 6 (1,400,000 + PDF) |
| 8 | Reservation | business (deposit credit, other-customer block, expiry, refund); scenario step 7 |
| 9 | Cash sale | business §34 |
| 10–11 | Installment sale / schedule | business §35, §36; scenario steps 8–11 |
| 12–13 | Partial / full payment | business §35 (50,000 → remaining 25,000, Partially Paid → Paid); scenario 12–13 |
| 14 | Overdue calculation | business §37 (days overdue 50 / 19), scenario step 14 |
| 15 | Trade-in | business §21 (existing & inline, expected vs actual profit) |
| 16 | Vehicle profitability | business §34, scenario 17–18 (87,000 / 6.44 %) |
| 17 | Inventory aging | demo.test (all reports), tour screenshot `report-aging` |
| 18–19 | Backup / restore | security.test, demo.test, scenario 20–23 (UI, with confirmation) |
| 20 | User permissions | security.test (sales, accountant, viewer, manager, last-admin), scenario (salesperson UI + server-side block) |
| 21 | Audit trail | security.test (old/new values, immutability), scenario |

## 4. Accounting checks (§34–§37)

| Check | Expected | Result |
|---|---|---|
| 1,000,000 + 50,000 costs | actual cost 1,050,000 | ✔ |
| sold 1,200,000 | profit 150,000, margin 12.5 % — identical on cost card, sale, dashboard, profitability report | ✔ |
| 1,200,000 − 300,000 down | financed 900,000 = 12 × 75,000 | ✔ |
| pay 50,000 on 75,000 | paid 50,000, remaining 25,000, Partially Paid | ✔ |
| custom 100k+50k+100k+150k+200k+300k | = 900,000 saved | ✔ |
| custom not matching | save blocked, sale rolled back, vehicle still available | ✔ |
| 1,000,000 / 24 | 23 × 41,666 + 41,682 = 1,000,000 | ✔ |
| balloon 23 × 30,000 + 310,000 | = 1,000,000 | ✔ |
| overdue | due < today & remaining > 0 → Overdue, days = today − due; fully paid → Paid | ✔ |
| BMW demo | 1,200,000 + 63,000 = 1,263,000; sold 1,350,000 → 87,000 (6.44 %); upfront 350,000; financed 1,000,000; statement closing = contract remaining = dashboard outstanding | ✔ |
| early settlement with discount, then void | settled/0 → restored to full balance | ✔ |
| reschedule | outstanding preserved exactly; paid + remaining = financed | ✔ |
| cancel sale | down payment refunded, statement 0, vehicle sellable again | ✔ |

## 5. Performance (50,000 vehicles, 25,000 sales/contracts, 300,000 installments, 100,000 payments + allocations, 100,000 expenses)

| Query | ms |
|---|---|
| vehicles list page 1 | 54 |
| vehicles in-stock sorted by cost | 51 |
| vehicles search | 37 |
| payments list | 116 |
| payments by date range | 25 |
| overdue installments | 184 |
| contracts list (with totals) | 306 |
| customers list with balances | 2 |
| expenses list | 30 |
| sales list | 45 |
| dashboard (all KPIs + 12-month series) | 467 |
| vehicle profitability report (month) | 9 |
| receivables aging report | 195 |
| customer 360 / contract detail | 1 |

All queries run in the main process; the renderer never freezes (asynchronous IPC). Lists are paginated server-side.

## 6. UI / RTL checks

The tour visits every screen at **1366×768, 1920×1080, 2560×1440** and automatically checks: page-level horizontal overflow, clipped text in buttons/headers/badges/labels/KPIs/nav items/tabs, overlapping header buttons and KPI cards, JavaScript errors. Result: none. Screenshots are written to `tests/e2e/output/screens/<resolution>/`. Wide reports (13 columns) scroll horizontally *inside* the table card at 1366 px by design.

## 7. Installer (Wine)

Fresh install (files, `app.asar`, Start-menu and desktop shortcuts, uninstaller, Add/Remove Programs entry v1.0.0) · first launch creates `%APPDATA%\AutoDeal Pro\data\autodeal.db` · reinstall keeps data · upgrade to 1.0.1 keeps data and updates version · uninstall removes program, shortcuts and registry entry and keeps data · clean install after wiping data. **21/21 passed.**

## 8. Manual QA / self-review checklist (§56)

| Question | Answer |
|---|---|
| Add a car easily? | Yes — "تسجيل شراء" (purchase) or "إضافة سيارة" (opening stock); one form |
| Know the car's cost? | Yes — Cost Card tab, printable |
| Know the profit? | Expected (vehicle page, sale wizard) and actual (sale page, reports, dashboard) |
| Sell it? | Yes — from vehicle, customer, quotation or reservation |
| Installments? | Equal / balloon / custom with live preview & balance check |
| Record collections? | Yes — per contract or per installment, receipt printed automatically |
| Know overdue? | Dashboard KPIs & alerts, Installments → المتأخرة, overdue report, customer page |
| Print a contract? | Yes — contract with schedule & terms, PDF or printer |
| Backup / restore? | Yes — manual, automatic, restore with typed confirmation and safety copy |

## 9. Known limitations of the test environment
* The Electron UI could not be *displayed* under Wine in this Linux container (Chromium window creation hangs under Wine/Xvfb). The same build's UI is fully tested on Linux Electron, and the Windows build was verified up to installation and database initialisation under Wine. A final smoke test on a real Windows 10/11 PC is recommended (the CI job builds the installer on `windows-latest`).
