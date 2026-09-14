@echo off
echo Retrying failed spooled print files...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { (Invoke-WebRequest -UseBasicParsing -Method POST http://127.0.0.1:9721/retry-spool).Content } catch { Write-Host $_.Exception.Message; exit 1 }"
pause
