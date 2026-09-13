@echo off
cd /d "%~dp0"
title SwiftTill Print Agent
set SWIFTTILL_PRINT_AGENT_PORT=9721
set SWIFTTILL_PRINTER_MODE=windows-print
if "%SWIFTTILL_CLOUD_URL%"=="" set SWIFTTILL_CLOUD_URL=https://swift-till.onrender.com
if "%SWIFTTILL_PRINT_AGENT_KEY%"=="" (
  echo Enter SwiftTill Print Agent Key.
  set /p SWIFTTILL_PRINT_AGENT_KEY=Print Agent Key: 
)
node apps\print-agent\agent.js
pause
