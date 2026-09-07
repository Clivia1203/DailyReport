; 将 NSIS 安装器中用户选定的语言交给应用首次启动使用。
; 语言编号：2052=简体中文，1033=英文，1041=日文。
!macro customInstall
  FileOpen $0 "$INSTDIR\installer-locale.txt" w
  StrCmp $LANGUAGE "2052" 0 +3
    FileWrite $0 "zh-CN"
    Goto dailyreport_locale_done
  StrCmp $LANGUAGE "1041" 0 +3
    FileWrite $0 "ja-JP"
    Goto dailyreport_locale_done
  FileWrite $0 "en-US"
dailyreport_locale_done:
  FileClose $0
!macroend
