@echo off
cd /d "%~dp0"
echo Starting SwiftTill local print agent...
echo Default mode sends receipt to Windows default printer and also keeps a spool copy.
set SWIFTTILL_PRINT_AGENT_PORT=9721
set SWIFTTILL_PRINTER_MODE=windows-print
node apps\print-agent\agent.js
pause
