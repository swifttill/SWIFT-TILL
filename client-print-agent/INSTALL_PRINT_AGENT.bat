@echo off
setlocal
cd /d "%~dp0"
title SwiftTill Print Agent Installer

echo =============================================
echo SwiftTill POS - Client Print Agent Installer
echo =============================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed on this PC.
  echo Install Node.js LTS first, then run this file again.
  echo Download: https://nodejs.org/
  pause
  exit /b 1
)

echo Installing required files...
call npm install --omit=dev
if errorlevel 1 (
  echo.
  echo Installation failed. Check internet connection and Node.js installation.
  pause
  exit /b 1
)

echo.
echo Installation complete.
echo Next: run START_PRINT_AGENT.bat
echo.
pause
