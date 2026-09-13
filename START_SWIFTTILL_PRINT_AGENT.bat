@echo off
cd /d "%~dp0"
echo Starting SwiftTill local print agent...
echo Default mode saves printable receipt files to storage\print-spool.
echo To send to Windows default printer, edit this file and set SWIFTTILL_PRINTER_MODE=windows-print.
set SWIFTTILL_PRINT_AGENT_PORT=9721
set SWIFTTILL_PRINTER_MODE=spool-only
node apps\print-agent\agent.js
pause
