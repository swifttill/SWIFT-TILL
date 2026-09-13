@echo off
setlocal
cd /d "%~dp0"
title SwiftTill Print Agent Installer

echo =============================================
echo SwiftTill POS - Final Print Agent Installer
echo =============================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js LTS is not installed on this PC.
  echo Install Node.js LTS first, then run this file again.
  echo https://nodejs.org/
  pause
  exit /b 1
)

echo Node found:
node -v
echo.

set /p CLOUDURL=Cloud POS URL [https://swift-till.onrender.com]: 
if "%CLOUDURL%"=="" set CLOUDURL=https://swift-till.onrender.com

echo.
echo Enter Print Agent Key from owner/Render env SWIFTTILL_PRINT_AGENT_KEY.
echo Leave blank only for local browser-direct test mode.
set /p AGENTKEY=Print Agent Key: 

echo.
echo Printer name is optional. Blank means Windows Default Printer.
set /p PRINTERNAME=Printer Name [blank=default]: 

powershell -NoProfile -ExecutionPolicy Bypass -Command "$o=[ordered]@{SWIFTTILL_CLOUD_URL='%CLOUDURL%';SWIFTTILL_PRINT_AGENT_KEY='%AGENTKEY%';SWIFTTILL_PRINT_AGENT_PORT='9721';SWIFTTILL_PRINTER_MODE='windows-text';SWIFTTILL_PRINTER_NAME='%PRINTERNAME%';SWIFTTILL_PRINT_POLL_MS='1800';SWIFTTILL_RECEIPT_WIDTH_CHARS='42';SWIFTTILL_NOTEPAD_FALLBACK='0'}; $o | ConvertTo-Json | Set-Content -Encoding UTF8 'print-agent.config.json'"

echo.
echo Installing local package files...
call npm install --omit=dev
if errorlevel 1 (
  echo Installation failed. Check internet/Node.js.
  pause
  exit /b 1
)

echo.
echo Installation complete.
echo Next run: START_PRINT_AGENT.bat
echo Then run: TEST_PRINT_AGENT.bat
echo.
pause
