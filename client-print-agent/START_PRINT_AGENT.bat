@echo off
cd /d "%~dp0"
title SwiftTill Print Agent
set SWIFTTILL_PRINT_AGENT_PORT=9721
set SWIFTTILL_PRINTER_MODE=windows-print
if "%SWIFTTILL_CLOUD_URL%"=="" set SWIFTTILL_CLOUD_URL=https://swift-till.onrender.com
if "%SWIFTTILL_PRINT_AGENT_KEY%"=="" (
  echo Enter SwiftTill Print Agent Key.
  echo This is NOT Render/Neon/Cloudflare credential. It is only for printer queue access.
  set /p SWIFTTILL_PRINT_AGENT_KEY=Print Agent Key: 
)
echo Starting SwiftTill Print Agent...
echo Local URL: http://127.0.0.1:9721/health
echo Cloud POS: %SWIFTTILL_CLOUD_URL%
echo Printer mode: Windows default printer
echo Keep this window open during billing.
echo.
node apps\print-agent\agent.js
pause
