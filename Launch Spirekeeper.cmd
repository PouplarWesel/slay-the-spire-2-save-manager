@echo off
cd /d "%~dp0"
if exist "dist\Spirekeeper-1.0.0.exe" (
  start "" "dist\Spirekeeper-1.0.0.exe"
  exit /b
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo Run npm install in this folder first.
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" .
