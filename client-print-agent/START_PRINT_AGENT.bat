@echo off
cd /d "%~dp0"
title SwiftTill Safe Counter Agent - Keep Open
set SWIFTTILL_PRINT_AGENT_PORT=9721
set SWIFTTILL_PRINTER_MODE=windows-text
if "%SWIFTTILL_CLOUD_URL%"=="" set SWIFTTILL_CLOUD_URL=https://swift-till.onrender.com
echo =============================================
echo SwiftTill Safe Counter Agent
echo =============================================
echo Keep this window open during billing.
echo Local health: http://127.0.0.1:9721/health
echo Cloud POS: %SWIFTTILL_CLOUD_URL%
echo.
node apps\print-agent\agent.js
pause
