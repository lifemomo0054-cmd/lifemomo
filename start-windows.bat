@echo off
rem Windows: double-click this file to start the store map.
rem On the first run it asks for the data.go.kr key, then opens the browser.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install the LTS version from https://nodejs.org and double-click this file again.
  start "" https://nodejs.org
  pause
  exit /b 1
)
node server.js --open
pause
