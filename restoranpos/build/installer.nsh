; One restaurant, several PCs: the PC marked "Əsas" on possistem.az listens on
; TCP 43180 for the other PCs of the same shop. Every call is signed with the
; customer's key, so the port is only useful to that shop's own tills. Opened
; for private networks only - never on a public (café Wi-Fi) profile.
; electron-builder includes build/installer.nsh automatically.

!macro customInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="possistem LAN"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="possistem LAN" dir=in action=allow protocol=TCP localport=43180 profile=private,domain'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="possistem LAN"'
!macroend
