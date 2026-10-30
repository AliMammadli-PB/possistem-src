; One restaurant, several PCs: the PC marked "Əsas" on possistem.az listens on
; TCP 43180 for the other PCs of the same shop. Every call is signed with the
; customer's key, so the port is only useful to that shop's own tills. Opened
; for private networks only - never on a public (café Wi-Fi) profile.
; electron-builder includes build/installer.nsh automatically.
;
; Xprinter network setup (Settings -> Printer): the printer answers the search
; on UDP 9600, from another subnet by broadcast, so the core needs an inbound
; rule. Limited to the POS core program; all profiles, because a shop network
; is often classed "Public". Updates run this too, so existing tills get it.

!macro customInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="possistem LAN"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="possistem LAN" dir=in action=allow protocol=TCP localport=43180 profile=private,domain'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="possistem Xprinter"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="possistem Xprinter" dir=in action=allow protocol=UDP localport=9600 profile=any program="$INSTDIR\resources\native\win32-x64\restaurant-pos-core.exe"'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="possistem LAN"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="possistem Xprinter"'
!macroend
