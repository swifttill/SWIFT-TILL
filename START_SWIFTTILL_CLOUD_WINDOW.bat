@echo off
setlocal
REM Change this URL after Vercel/Render deployment.
set SWIFTTILL_URL=https://your-swifttill-domain.example/
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "SwiftTill Cloud POS" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --app=%SWIFTTILL_URL% --disable-features=Translate --window-size=1366,768
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  start "SwiftTill Cloud POS" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" --app=%SWIFTTILL_URL% --disable-features=Translate --window-size=1366,768
) else if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
  start "SwiftTill Cloud POS" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app=%SWIFTTILL_URL% --window-size=1366,768
) else if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
  start "SwiftTill Cloud POS" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" --app=%SWIFTTILL_URL% --window-size=1366,768
) else (
  start "" %SWIFTTILL_URL%
)
