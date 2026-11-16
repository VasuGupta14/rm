<#
.SYNOPSIS
    AgriTwin Universal PowerShell Launcher (Windows / Linux / macOS)
.DESCRIPTION
    Launches both the Python biophysical simulation engine (port 8768)
    and the AgriTwin React frontend (port 8443) seamlessly.
#>

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Locate backend and frontend directories
$BackendDir = Join-Path $ScriptDir "Adaptive Irrigation Twin"
if (-not (Test-Path $BackendDir)) {
    $BackendDir = Join-Path $ScriptDir "agritwin-backend"
}

$FrontendDir = Join-Path $ScriptDir "AgriTwin – Smart Irrigation"
if (-not (Test-Path $FrontendDir)) {
    $FrontendDir = Join-Path $ScriptDir "agritwin-frontend"
}

Write-Host "==========================================================" -ForegroundColor Green
Write-Host " Starting AgriTwin – Unified Smart Irrigation Application" -ForegroundColor Green
Write-Host " Backend:  http://127.0.0.1:8768" -ForegroundColor Cyan
Write-Host " Frontend: http://localhost:8443" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Green

# 1. Check Python
$PythonCmd = if (Get-Command "python3" -ErrorAction SilentlyContinue) { "python3" } elseif (Get-Command "python" -ErrorAction SilentlyContinue) { "python" } elseif (Get-Command "py" -ErrorAction SilentlyContinue) { "py" } else { $null }

if (-not $PythonCmd) {
    Write-Host "[ERROR] Python 3 was not found. Please install Python 3." -ForegroundColor Red
    exit 1
}

# 2. Check Node & npm
if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js was not found. Please install Node.js." -ForegroundColor Red
    exit 1
}

# 3. Check node_modules
$NodeModules = Join-Path $FrontendDir "node_modules"
if (-not (Test-Path $NodeModules)) {
    Write-Host "[!] Installing frontend dependencies..." -ForegroundColor Yellow
    Push-Location $FrontendDir
    & npm install
    Pop-Location
}

# 4. Start Backend
Write-Host "[1/2] Starting Python simulation backend on port 8768..." -ForegroundColor Yellow
$BackendProcess = Start-Process -FilePath $PythonCmd -ArgumentList "local_server.py" -WorkingDirectory $BackendDir -PassThru

Start-Sleep -Seconds 2

# 5. Start Frontend
Write-Host "[2/2] Starting AgriTwin Frontend on port 8443..." -ForegroundColor Yellow
$FrontendProcess = Start-Process -FilePath "npm" -ArgumentList "run dev" -WorkingDirectory $FrontendDir -PassThru

Write-Host ""
Write-Host "AgriTwin is running! Opening browser..." -ForegroundColor Green
Start-Process "http://localhost:8443"

Write-Host "Press Ctrl+C to terminate services." -ForegroundColor Gray
try {
    Wait-Process -Id $FrontendProcess.Id
} finally {
    Stop-Process -Id $BackendProcess.Id -ErrorAction SilentlyContinue
    Stop-Process -Id $FrontendProcess.Id -ErrorAction SilentlyContinue
}
