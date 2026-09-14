@echo off
echo Sending test print to SwiftTill Safe Counter Agent...
powershell -NoProfile -NonInteractive -Command "try { (Invoke-WebRequest -UseBasicParsing -Method GET http://127.0.0.1:9721/test).Content } catch { Write-Host $_.Exception.Message; exit 1 }"
pause
