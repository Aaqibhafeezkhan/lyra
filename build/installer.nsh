; Extra NSIS steps for Lyra (electron-builder includes this automatically via nsis.include).

!macro customUnInstall
  ; Remove the "launch at startup" entry Electron writes, so uninstalling leaves nothing running at login.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Lyra"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "lyra"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Lyra"
!macroend
