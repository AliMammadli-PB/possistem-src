; Xprinter network setup (Settings -> Printer): the printer answers the search
; on UDP 9600, from another subnet by broadcast, so the core needs an inbound
; rule. Limited to the Market core program; all profiles, because a shop
; network is often classed "Public". Updates run this too, so existing tills get it.
; electron-builder includes build/installer.nsh automatically.

!macro customInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="MarketPos Xprinter"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="MarketPos Xprinter" dir=in action=allow protocol=UDP localport=9600 profile=any program="$INSTDIR\resources\native\win32-x64\market-pos-core.exe"'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="MarketPos Xprinter"'
!macroend
