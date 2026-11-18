@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Radio Interna - crea il programma per Windows
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Serve Node.js: scaricalo da https://nodejs.org ^(versione LTS^), installalo e riapri questo file.
  pause
  exit /b
)
if not exist node_modules call npm install --no-audit --no-fund
call npx electron-builder --win --publish never
echo.
echo  Fatto! I file da dare agli altri sono nella cartella dist: installer e versione portatile ^(.exe^).
start "" dist
pause
