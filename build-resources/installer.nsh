; AutoDeal Pro – NSIS customisations (included by electron-builder).
; Robust "is the app running?" check using the nsProcess plugin instead of the default
; PowerShell/tasklist pipeline (which can report false positives on some systems).
!macro customCheckAppRunning
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 == 0
    ${ifNot} ${Silent}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "برنامج AutoDeal Pro يعمل حالياً. اضغط OK لإغلاقه ومتابعة التثبيت.$\r$\nAutoDeal Pro is running. Click OK to close it and continue." IDOK adpKill
      Quit
    ${endIf}
    adpKill:
    ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    Sleep 2000
  ${endIf}
  ${nsProcess::Unload}
!macroend
