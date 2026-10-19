@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 or newer is required. Install it from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\three\package.json" (
  echo Installing game dependencies. This needs an internet connection the first time.
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

start "" "http://localhost:3000"
call npm start
pause
