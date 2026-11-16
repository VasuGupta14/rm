@echo off
setlocal
cd /d "%~dp0"
set IRRIGATION_APP_PORT=8768
where python >nul 2>nul
if not errorlevel 1 (
  python local_server.py
) else if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
  "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" local_server.py
) else (
  py -3 local_server.py
)
if errorlevel 1 (
  echo.
  echo Could not start the local AquaCrop app server. Confirm Python and the AquaCrop source folders are available.
  pause
)
