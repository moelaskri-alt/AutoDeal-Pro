#!/usr/bin/env bash
# Windows installer lifecycle test executed with Wine (fresh install, reinstall, upgrade, uninstall,
# clean re-install). Requires: wine (32+64 bit), release/AutoDealPro-Setup-1.0.0.exe and -1.0.1.exe.
# Usage: bash scripts/installer-test/run-installer-tests.sh
set -u
export WINEDEBUG=-all
export WINEPREFIX="${WINEPREFIX:-/tmp/adp-wineprefix}"
export DISPLAY="${DISPLAY:-:50}"
pgrep -x Xvfb >/dev/null || (Xvfb "$DISPLAY" -screen 0 1920x1080x24 >/dev/null 2>&1 &)
sleep 1
V1=release/AutoDealPro-Setup-1.0.0.exe
V2=release/AutoDealPro-Setup-1.0.1.exe
U="$WINEPREFIX/drive_c/users/${USER:-$(whoami)}"
APPDIR="$U/AppData/Local/Programs/AutoDealPro"
DATADIR="$U/AppData/Roaming/AutoDeal Pro/data"
PASS=0; FAIL=0
ok()   { echo "  ✔ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ✘ $1"; FAIL=$((FAIL+1)); }
check(){ if eval "$2"; then ok "$1"; else bad "$1"; fi; }
ver()  { grep -A14 'Uninstall\\\\[^]]*' "$WINEPREFIX/user.reg" 2>/dev/null | grep -m1 DisplayVersion | cut -d'"' -f4; }

rm -rf "$WINEPREFIX"; wineboot -i >/dev/null 2>&1; wineserver -w

echo "1) Fresh installation (silent, per-user)"
wine "$V1" /S; rc=$?; wineserver -w
check "installer exit code 0" "[ $rc -eq 0 ]"
check "application directory created" "[ -f \"$APPDIR/AutoDealPro.exe\" ]"
check "app.asar present" "[ -f \"$APPDIR/resources/app.asar\" ]"
check "Start Menu shortcut" "[ -f \"$U/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/AutoDeal Pro.lnk\" ]"
check "Desktop shortcut" "[ -f \"$U/Desktop/AutoDeal Pro.lnk\" ]"
check "uninstaller present" "[ -f \"$APPDIR/Uninstall AutoDealPro.exe\" ]"
check "registered in Add/Remove Programs (v1.0.0)" "[ \"$(ver)\" = '1.0.0' ]"

echo "2) First launch initialises the database"
( cd "$APPDIR" && AUTODEAL_E2E=1 timeout 60 wine AutoDealPro.exe >/dev/null 2>&1 & )
for i in $(seq 1 40); do [ -f "$DATADIR/autodeal.db" ] && break; sleep 1; done
wineserver -k; sleep 2
check "database file created in %APPDATA%\\AutoDeal Pro\\data" "[ -f \"$DATADIR/autodeal.db\" ]"
echo "marker" > "$DATADIR/../keep-me.txt"

echo "3) Re-installation of the same version"
wine "$V1" /S; rc=$?; wineserver -w
check "reinstall exit code 0" "[ $rc -eq 0 ]"
check "application still installed" "[ -f \"$APPDIR/AutoDealPro.exe\" ]"
check "customer data kept after reinstall" "[ -f \"$DATADIR/autodeal.db\" ] && [ -f \"$DATADIR/../keep-me.txt\" ]"

echo "4) Upgrade to 1.0.1"
wine "$V2" /S; rc=$?; wineserver -w
check "upgrade exit code 0" "[ $rc -eq 0 ]"
check "registered version is 1.0.1" "[ \"$(ver)\" = '1.0.1' ]"
check "customer data kept after upgrade" "[ -f \"$DATADIR/autodeal.db\" ]"

echo "5) Uninstall"
wine "$APPDIR/Uninstall AutoDealPro.exe" /S /currentuser; rc=$?; wineserver -w; sleep 3; wineserver -w
check "uninstaller exit code 0" "[ $rc -eq 0 ]"
check "program files removed" "[ ! -f \"$APPDIR/AutoDealPro.exe\" ]"
check "shortcuts removed" "[ ! -f \"$U/Desktop/AutoDeal Pro.lnk\" ] && [ ! -f \"$U/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/AutoDeal Pro.lnk\" ]"
check "removed from Add/Remove Programs" "[ -z \"$(ver)\" ]"
check "customer data preserved on uninstall (by design)" "[ -f \"$DATADIR/autodeal.db\" ]"

echo "6) Clean installation (after removing data)"
rm -rf "$U/AppData/Roaming/AutoDeal Pro"
wine "$V2" /S; rc=$?; wineserver -w
check "clean install exit code 0" "[ $rc -eq 0 ]"
check "application installed" "[ -f \"$APPDIR/AutoDealPro.exe\" ]"

echo; echo "Installer tests: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
