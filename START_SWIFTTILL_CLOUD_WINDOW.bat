@echo off
set URL=https://swift-till.onrender.com
start msedge --app=%URL% --new-window
if errorlevel 1 start chrome --app=%URL% --new-window
if errorlevel 1 start %URL%
