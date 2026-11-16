@echo off
REM ==============================================================================
REM AgriTwin - Universal Windows Launcher (Command Prompt / PowerShell compatible)
REM Works on Windows 10, Windows 11, and Windows Server
REM ==============================================================================
chcp 65001 >nul
setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set BACKEND_DIR=%SCRIPT_DIR%Adaptive Irrigation Twin
set FRONTEND_DIR=%SCRIPT_DIR%AgriTwin – Smart Irrigation

REM Fallback if directory name encoding differs on Windows
if not exist "%BACKEND_DIR%" (
    if exist "%SCRIPT_DIR%agritwin-backend" set BACKEND_DIR=%SCRIPT_DIR%agritwin-backend
)
if not exist "%FRONTEND_DIR%" (
    if exist "%SCRIPT_DIR%AgriTwin - Smart Irrigation" set FRONTEND_DIR=%SCRIPT_DIR%AgriTwin - Smart Irrigation
    if exist "%SCRIPT_DIR%agritwin-frontend" set FRONTEND_DIR=%SCRIPT_DIR%agritwin-frontend
)

echo ==========================================================
echo  Starting AgriTwin - Unified Smart Irrigation Application
echo  Platform: Windows
echo  Backend:  http://127.0.0.1:8768
echo  Frontend: http://localhost:8443
echo ==========================================================

REM 1. Verify Python
where python >nul 2>nul
if %errorlevel% neq 0 (
    where py >nul 2>nul
    if %errorlevel% neq 0 (
        echo [ERROR] Python was not found in PATH. Please install Python from python.org and check "Add Python to PATH".
        pause
        exit /b 1
    ) else (
        set PYTHON_CMD=py
    )
) else (
    set PYTHON_CMD=python
)

REM 2. Verify Node.js & npm
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js was not found in PATH. Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] npm was not found. Please verify your Node.js installation.
    pause
    exit /b 1
)

REM 3. Check dependencies
if not exist "%FRONTEND_DIR%\node_modules" (
    echo [!] Installing frontend dependencies with npm...
    cd /d "%FRONTEND_DIR%"
    call npm install
    cd /d "%SCRIPT_DIR%"
)

REM 4. Start Backend in background window
echo [1/2] Starting Python simulation backend on port 8768...
start "AgriTwin Backend (Python on 8768)" cmd /c "cd /d \"%BACKEND_DIR%\" && %PYTHON_CMD% local_server.py"

REM Allow backend 2 seconds to bind
timeout /t 2 /nobreak >nul

REM 5. Start Frontend in background window
echo [2/2] Starting AgriTwin Frontend on port 8443...
start "AgriTwin Frontend (Vite on 8443)" cmd /c "cd /d \"%FRONTEND_DIR%\" && npm run dev"

timeout /t 2 /nobreak >nul

echo ==========================================================
echo  AgriTwin is now running!
echo  Open your browser to: http://localhost:8443
echo ==========================================================
start http://localhost:8443
pause
