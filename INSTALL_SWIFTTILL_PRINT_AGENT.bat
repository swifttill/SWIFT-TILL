@echo off
setlocal
cd /d "%~dp0"
echo Installing SwiftTill Print Agent dependencies...
call npm install
if errorlevel 1 pause & exit /b 1
echo.
echo Starting print agent in spool-only mode. For direct default-printer mode set SWIFTTILL_PRINTER_MODE=windows-print
set SWIFTTILL_PRINTER_MODE=spool-only
start "SwiftTill Print Agent" cmd /k "npm --workspace apps/print-agent start"
echo Open http://127.0.0.1:9721/health to verify.
pause
