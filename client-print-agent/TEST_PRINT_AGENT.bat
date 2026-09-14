@echo off
echo Sending test print to SwiftTill Print Agent...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { (Invoke-WebRequest -UseBasicParsing -Method GET http://127.0.0.1:9721/test).Content } catch { Write-Host $_.Exception.Message; exit 1 }"
pause
