!macro customInstall
  WriteRegStr SHCTX "Software\Classes\repoctopus" "" "URL:Repoctopus Change Activation"
  WriteRegStr SHCTX "Software\Classes\repoctopus" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\repoctopus\DefaultIcon" "" "$\"$INSTDIR\Repoctopus.exe$\",0"
  WriteRegStr SHCTX "Software\Classes\repoctopus\shell\open\command" "" "$\"$INSTDIR\Repoctopus.exe$\" $\"%1$\""
  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\App Paths\Repoctopus.exe" "" "$INSTDIR\Repoctopus.exe"
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\repoctopus"
  DeleteRegKey SHCTX "Software\Microsoft\Windows\CurrentVersion\App Paths\Repoctopus.exe"
!macroend
