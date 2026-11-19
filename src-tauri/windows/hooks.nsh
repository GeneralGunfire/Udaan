; Extra steps for the Udaan installer.
;
; 1. Stop / Cancel while installing. The wizard normally greys out Cancel during the file copy, which leaves
;    nothing to press if setup takes a while. Here it stays enabled: pressing it asks once, then stops, and a
;    FRESH install is rolled back (an update over an existing install is left exactly as it was).
; 2. The udaan:// link: the "Check my version" button on the website opens udaan://check-update, which starts
;    (or reaches) the installed Udaan and runs its update check. Registered for the current user only and
;    removed again on uninstall.
; Nothing here touches the person's data folder.

Var UdaanWasFresh

!macro NSIS_HOOK_PREINSTALL
  ; Remember whether there was already an Udaan here (so a cancelled update never deletes it).
  ${If} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
    StrCpy $UdaanWasFresh "0"
  ${Else}
    StrCpy $UdaanWasFresh "1"
  ${EndIf}
  ; Keep Cancel pressable during the copy.
  GetDlgItem $0 $HWNDPARENT 2
  EnableWindow $0 1
!macroend

; Pressing Cancel: confirm once.
Function .onUserAbort
  MessageBox MB_YESNO|MB_ICONQUESTION "Stop setting up ${PRODUCTNAME}?$\r$\n$\r$\nAnything already copied will be removed. Your settings and files are not touched." IDYES udaan_stop
  Abort
  udaan_stop:
FunctionEnd

; The install stopped part-way (Cancel, or an error). Roll a fresh install back; leave an existing one alone.
Function .onInstFailed
  ${If} $UdaanWasFresh == "1"
    ; Only ever the product's own folder.
    ${StrLoc} $2 "$INSTDIR" "${PRODUCTNAME}" ">"
    ${If} $2 != ""
      SetOutPath "$TEMP"
      RMDir /r "$INSTDIR"
    ${EndIf}
  ${EndIf}
FunctionEnd

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\udaan" "" "URL:Udaan"
  WriteRegStr HKCU "Software\Classes\udaan" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\udaan\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\udaan\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\udaan"
  ; The installer remembers its folder under Software\Udaan\<product>; remove it, and Software\Udaan if now empty.
  DeleteRegKey /ifempty HKCU "Software\Udaan\${PRODUCTNAME}"
  DeleteRegKey /ifempty HKCU "Software\Udaan"
!macroend
