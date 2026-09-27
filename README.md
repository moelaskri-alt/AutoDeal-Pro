# AutoDeal Pro — نظام إدارة معارض السيارات

Offline-first Windows desktop application for car dealerships (new & used cars): purchases, vehicle costing, pricing, CRM, quotations, reservations, cash / installment / trade-in sales, collections, expenses, profitability and reports. Arabic RTL interface.

| | |
|---|---|
| Stack | Electron 37 · SQLite 3.50 (`node:sqlite`, no native modules) · React 18 + TypeScript · Vite |
| Installer | `AutoDealPro-Setup-<version>.exe` — download from GitHub Actions / Releases (see below); built locally into `release/` |
| Data | `%APPDATA%\AutoDeal Pro\data\autodeal.db` · backups in `%APPDATA%\AutoDeal Pro\backups` · log in `%APPDATA%\AutoDeal Pro\logs\app.log` |
| First login | `admin` / `admin123` (change it from the ⚙ icon in the top bar) |

## Download the Windows installer

The installer is **not stored in the git repository** (it is a ~93 MB build output). It is produced by GitHub Actions on every push.

**From GitHub Actions (every push):**
1. Open <https://github.com/moelaskri-alt/AutoDeal-Pro/actions/workflows/build.yml>.
2. Click the most recent run with a green check ✔ for your branch (e.g. `claude/car-dealership-system-v8bgsw` or `main`).
3. Scroll to the **Artifacts** section at the bottom of the run summary.
4. Download **`AutoDealPro-Setup-1.0.0`** (the name follows the `version` in `package.json`). GitHub delivers it as a `.zip`; inside is **`AutoDealPro-Setup-1.0.0.exe`**.
5. Unzip and run the `.exe`. You must be signed in to GitHub with access to the repository to download artifacts; artifacts are kept for **90 days** (re-run the workflow, or use *Run workflow* on the workflow page, to produce a fresh one).

Workflow: `.github/workflows/build.yml`, job **`windows-installer`** (runs on `windows-latest`: `npm ci` → `npm test` → `npm run dist:win` → checks `release/AutoDealPro-Setup-<version>.exe` exists → uploads it).

**As a GitHub Release asset (permanent download link):** no release exists yet. To publish one:
1. Make sure `version` in `package.json` is the version you want (e.g. `1.0.0`) and CI is green.
2. Create and push a matching tag: `git tag v1.0.0 && git push origin v1.0.0`.
3. The workflow's **`release`** job then checks that the tag equals `v` + package version, downloads the installer artifact and attaches `AutoDealPro-Setup-1.0.0.exe` to the GitHub Release `v1.0.0` (created automatically, using the built-in `GITHUB_TOKEN`).
4. The file is then at `https://github.com/moelaskri-alt/AutoDeal-Pro/releases/download/v1.0.0/AutoDealPro-Setup-1.0.0.exe`.

The installer is not code-signed, so Windows SmartScreen may show "Windows protected your PC" → *More info* → *Run anyway*.

## Install (end user)
1. Run `AutoDealPro-Setup-1.0.0.exe` → choose "Only for me" (no admin rights needed) → Install.
2. Start **AutoDeal Pro** from the desktop or Start menu. The database is created on first launch.
3. Log in with `admin` / `admin123`. On an empty database the dashboard offers **"تحميل بيانات تجريبية"** (load demo data).

Demo users created by the demo data: `manager/manager123`, `sales/sales123`, `sales2/sales123`, `accountant/account123`, `viewer/viewer123`.

Uninstalling removes the program but **keeps your data** in `%APPDATA%\AutoDeal Pro` (delete that folder manually for a full wipe). Upgrades install over the old version and keep the data.

## Development
Requirements: Node.js 22+.
```bash
npm ci
npm start                 # build + run the desktop app
npm test                  # unit / integration tests (Vitest, real SQLite)
npx vitest run --config vitest.perf.config.ts   # performance test (50k vehicles, 100k payments, 100k expenses)
npm run build && xvfb-run -a npm run test:e2e   # end-to-end tests driving the real Electron app (Linux: needs Xvfb)
npm run dist:win          # build the Windows installer into release/
```
Building the Windows installer on Linux requires Wine (64 + 32 bit). On Windows it works natively. CI (`.github/workflows/build.yml`) runs all tests and builds the installer on `windows-latest`, uploading it as the artifact `AutoDealPro-Setup-<version>`. `dist:win` passes `--publish never` so electron-builder never tries to publish from CI on its own.

Installer lifecycle test (Wine): `bash scripts/installer-test/run-installer-tests.sh`.

## Project layout
```
src/core        business logic (framework-free): db, services, calc, validation, print templates, backup
src/main        Electron main process: window, IPC router, printing/PDF, Excel/CSV export
src/preload     secure bridge (contextIsolation)
src/renderer    React UI (Arabic RTL)
tests/unit      Vitest tests of all business rules + demo scenario
tests/perf      performance test
tests/e2e       Playwright tests driving the real desktop app
scripts         build helpers, icon generator, installer tests
```

## Documentation
[ARCHITECTURE.md](ARCHITECTURE.md) · [DATABASE.md](DATABASE.md) · [BUSINESS_RULES.md](BUSINESS_RULES.md) · [TEST_PLAN.md](TEST_PLAN.md) · [USER_GUIDE.md](USER_GUIDE.md) (عربي) · [CHANGELOG.md](CHANGELOG.md)
