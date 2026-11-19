; Extra steps for the Udaan installer.
;
; The udaan:// link: the "Check my version" button on the website opens udaan://check-update, which starts
; (or reaches) the installed Udaan and runs its update check. It is registered for the current user only and
; removed again on uninstall. Nothing here touches the person's data folder.

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\udaan" "" "URL:Udaan"
  WriteRegStr HKCU "Software\Classes\udaan" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\udaan\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\udaan\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\udaan"
!macroend
