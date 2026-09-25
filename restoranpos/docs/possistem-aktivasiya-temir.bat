@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title possistem - temir + aktivasiya

echo.
echo  ============================================
echo   possistem - DB + aktivasiya temiri
echo  ============================================
echo.
echo  Bu skript:
echo   - Safe Mode / korrupt pos.db temizleyir
echo   - Aktivasiyani offlinegame.az yerine
echo     possistem.az uzerinden isledir
echo.

set "APP="
set "CORE="
if exist "%ProgramFiles%\possistem\possistem.exe" (
  set "APP=%ProgramFiles%\possistem\possistem.exe"
  set "CORE=%ProgramFiles%\possistem\resources\native\win32-x64\restaurant-pos-core.exe"
)
if not defined APP if exist "%LocalAppData%\Programs\possistem\possistem.exe" (
  set "APP=%LocalAppData%\Programs\possistem\possistem.exe"
  set "CORE=%LocalAppData%\Programs\possistem\resources\native\win32-x64\restaurant-pos-core.exe"
)

if not defined APP (
  echo [XETA] possistem.exe tapilmadi.
  echo        Evvel 1.5.8 setup qurasdirin, sonra bu bat-i yeniden isledin.
  echo.
  pause
  exit /b 1
)

echo  Tapildi: !APP!
echo  (1.5.8 artiq qurulubsa Enter basib davam edin)
echo.
pause

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo [!] Administrator lazimdir.
  echo     Bat faylina SAG KLIK -^> "Run as administrator"
  echo.
  pause
  exit /b 1
)

set "APPDATA_POS=%APPDATA%\Maison Aurelia POS"
set "DATA=%APPDATA_POS%\data"
set "STAMP=%DATE:~-4%%DATE:~3,2%%DATE:~0,2%_%TIME:~0,2%%TIME:~3,2%%TIME:~6,2%"
set "STAMP=%STAMP: =0%"
set "QUAR=%APPDATA_POS%\repair-quarantine\%STAMP%"
set "CONTROL_URL=https://possistem.az/pos/api"

if not exist "%APPDATA_POS%" (
  echo [XETA] Tapilmadi: "%APPDATA_POS%"
  pause
  exit /b 1
)

echo.
echo [1/5] Prosesler baglanir...
taskkill /F /IM possistem.exe >nul 2>&1
taskkill /F /IM "restaurant-pos-core.exe" >nul 2>&1
timeout /t 2 /nobreak >nul

mkdir "%QUAR%" >nul 2>&1
set "FIXED=0"

if exist "%DATA%\pos.db" call :RepairOne "%DATA%" "legacy-root"
if exist "%DATA%\tenants" (
  for /d %%T in ("%DATA%\tenants\*") do (
    if exist "%%~fT\pos.db" call :RepairOne "%%~fT" "%%~nxT"
  )
)

echo.
echo [2/5] DB quarantine: !FIXED! folder
echo      "%QUAR%"

echo.
echo [3/5] Core URL patch (offlinegame -^> possistem)...
if exist "!CORE!" (
  set "CORE_PATH=!CORE!"
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$p=$env:CORE_PATH; if(-not (Test-Path -LiteralPath $p)){ Write-Host 'core tapilmadi'; exit 1 };" ^
    "$b=[IO.File]::ReadAllBytes($p);" ^
    "$enc=[Text.Encoding]::ASCII;" ^
    "$old=$enc.GetBytes('https://offlinegame.az/pos/api');" ^
    "$new=$enc.GetBytes('https://possistem.az/pos/api//');" ^
    "if($old.Length -ne $new.Length){ Write-Host ('length mismatch ' + $old.Length + ' vs ' + $new.Length); exit 2 };" ^
    "$n=0; for($i=0; $i -le $b.Length-$old.Length; $i++){" ^
    "  $ok=$true; for($j=0; $j -lt $old.Length; $j++){ if($b[$i+$j] -ne $old[$j]){ $ok=$false; break } };" ^
    "  if($ok){ for($j=0; $j -lt $new.Length; $j++){ $b[$i+$j]=$new[$j] }; $n++; $i+=$old.Length-1 }" ^
    "};" ^
    "if($n -gt 0){ [IO.File]::WriteAllBytes($p,$b); Write-Host ('  OK patched: ' + $n) }" ^
    "else { Write-Host '  OK (artiq duzelib ve ya URL yoxdur)' }"
) else (
  echo   [!] core.exe tapilmadi - kecilir
)

echo.
echo [4/5] POS_CONTROL_URL + Desktop launcher...
setx POS_CONTROL_URL "%CONTROL_URL%" >nul
set "POS_CONTROL_URL=%CONTROL_URL%"

set "LAUNCH=%USERPROFILE%\Desktop\possistem-aktivasiya.bat"
> "%LAUNCH%" (
  echo @echo off
  echo set "POS_CONTROL_URL=https://possistem.az/pos/api"
  echo start "" "%%ProgramFiles%%\possistem\possistem.exe"
)
echo   launcher: Desktop\possistem-aktivasiya.bat

echo.
echo [5/5] Aktivasiya:
echo   Email: remzi@possistem.az   ^(IKI s - possistem^)
echo   Acar:  GKG1-8WD1-TCSQ-EPD1-6SCG-0XPT-4HA9-BKGT
echo   Sonra: Yoxla -^> Aktivlesdir
echo.
echo   SEHV: remzi@posistem.az ^(bir s^) - yazmayin
echo.

choice /C YN /M "possistem indi acilsin"
if not errorlevel 2 (
  set "POS_CONTROL_URL=%CONTROL_URL%"
  start "" "!APP!"
)

echo.
echo Bitdi. Enter ile bagla.
pause >nul
exit /b 0

:RepairOne
set "DIR=%~1"
set "TAG=%~2"
set "QDIR=%QUAR%\%TAG%"
mkdir "%QDIR%" >nul 2>&1
echo   -- %TAG%
for %%F in (pos.db pos.db-wal pos.db-shm pos.db-journal) do (
  if exist "%DIR%\%%F" (
    move /Y "%DIR%\%%F" "%QDIR%\%%F" >nul
    echo      quarantine: %%F
  )
)
set /a FIXED+=1
exit /b 0
