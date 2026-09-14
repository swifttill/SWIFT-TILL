@echo off
echo Checking SwiftTill Safe Counter Agent health...
powershell -NoProfile -NonInteractive -Command "try { (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9721/health).Content } catch { Write-Host 'Print Agent not running. Run START_PRINT_AGENT.bat first.'; exit 1 }"
pause
