@echo off
cd /d "%~dp0"
title SwiftTill Print Agent
set SWIFTTILL_PRINT_AGENT_PORT=9721
set SWIFTTILL_PRINTER_MODE=windows-print
echo Starting SwiftTill Print Agent...
echo Local URL: http://127.0.0.1:9721/health
echo Printer mode: Windows default printer
echo Keep this window open during billing.
echo.
node apps\print-agent\agent.js
pause
