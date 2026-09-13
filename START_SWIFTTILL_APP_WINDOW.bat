@echo off
setlocal
cd /d "%~dp0"
set PORT=5174
start "SwiftTill Server" /min cmd /c "npm start"
timeout /t 2 /nobreak >nul
set URL=http://localhost:%PORT%/
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "SwiftTill POS" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --app=%URL% --disable-features=Translate --window-size=1366,768
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  start "SwiftTill POS" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" --app=%URL% --disable-features=Translate --window-size=1366,768
) else if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
  start "SwiftTill POS" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app=%URL% --window-size=1366,768
) else if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
  start "SwiftTill POS" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" --app=%URL% --window-size=1366,768
) else (
  start "" %URL%
)
