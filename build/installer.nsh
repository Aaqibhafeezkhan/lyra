; Extra NSIS steps for Lyra (electron-builder includes this automatically via nsis.include).

!ifndef BUILD_UNINSTALLER
  !include "WordFunc.nsh"
  !insertmacro VersionCompare
!endif

!macro customInit
  ; Always reinstall/update into the folder Lyra is already installed in (e.g. a drive the user chose),
  ; never create a second copy in the default location.
  ReadRegStr $R2 HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ${If} $R2 != ""
    ${If} ${FileExists} "$R2\${APP_EXECUTABLE_FILENAME}"
      StrCpy $INSTDIR "$R2"
    ${EndIf}
  ${EndIf}

  ; Refuse to "install again" when this version (or a newer one) is already installed.
  ; Silent runs are in-app updates (electron-updater) and must keep working.
  ${IfNot} ${Silent}
    ReadRegStr $R0 HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
    ${If} $R0 != ""
      ${VersionCompare} "$R0" "${VERSION}" $R1
      ; $R1: 0 = same, 1 = installed is newer, 2 = installed is older (upgrade is fine)
      ${If} $R1 != 2
        MessageBox MB_OK|MB_ICONINFORMATION "Lyra $R0 is already installed on this PC.$\r$\n$\r$\nTo update: open Lyra > Settings > About > Check now.$\r$\nTo remove it: Windows Settings > Apps > Lyra."
        Quit
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstall
  ; Downloaded updates live next to the install folder (not inside it). Remove them on a real uninstall,
  ; but not during an update, when the running installer is in there.
  ${ifNot} ${isUpdated}
    RMDir /r "$INSTDIR-updates"
  ${endIf}
  ; Remove the "launch at startup" entry Electron writes, so uninstalling leaves nothing running at login.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Lyra"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "lyra"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Lyra"
!macroend
