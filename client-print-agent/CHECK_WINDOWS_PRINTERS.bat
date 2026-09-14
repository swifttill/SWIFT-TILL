@echo off
echo Windows printers on this PC:
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Printer | Select-Object Name,Default,WorkOffline,PrinterStatus | Format-Table -AutoSize"
echo.
echo If no default printer is true, set thermal printer as Windows Default Printer.
pause
