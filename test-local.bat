@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

call powershell -NoProfile -Command "$ports = 3000,3001,5000; foreach ($p in $ports) { $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue; foreach ($c in $conns) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue } }" >nul 2>nul

if not exist "%ROOT%\api\package.json" (
    echo ERROR: Run this script from the project root directory
    exit /b 1
)

echo ============================================
echo   Log Aggregation System - Local Test
echo ============================================
echo.

call "%ROOT%\stop-local.bat" >nul 2>nul

echo [1/5] Installing/updating Node dependencies...
pushd "%ROOT%\api"
call npm install
if errorlevel 1 (
    echo ERROR: Failed to install API dependencies
    popd
    exit /b 1
)
popd

pushd "%ROOT%\frontend"
call npm install
if errorlevel 1 (
    echo ERROR: Failed to install frontend dependencies
    popd
    exit /b 1
)
popd

echo.
echo [2/5] Preparing Python environment...
if not exist "%ROOT%\anomaly\venv\Scripts\python.exe" (
    pushd "%ROOT%\anomaly"
    python -m venv venv
    if errorlevel 1 (
        echo ERROR: Failed to create anomaly virtual environment
        popd
        exit /b 1
    )
    call venv\Scripts\pip install -r requirements.txt
    if errorlevel 1 (
        echo ERROR: Failed to install anomaly dependencies
        popd
        exit /b 1
    )
    popd
)

echo.
echo [3/5] Seeding local database...
pushd "%ROOT%\api"
call npm run seed
if errorlevel 1 (
    echo ERROR: Failed to seed local database
    popd
    exit /b 1
)
popd

echo.
echo [4/5] Starting services...
start "API Server" cmd /k "cd /d %ROOT%\api && set ""PORT=3000"" && npm run dev"
start "Anomaly Service" cmd /k "cd /d %ROOT%\anomaly && set ""DB_PATH=../api/data/logs.db"" && set ""MODEL_PATH=./data/anomaly_model.pkl"" && venv\Scripts\python -m uvicorn src.main:app --host 127.0.0.1 --port 5000"
start "Frontend" cmd /k "cd /d %ROOT%\frontend && npm run dev -- --port 3001"

echo Waiting for services to boot...
powershell -NoProfile -Command "Start-Sleep -Seconds 15" >nul

echo.
echo [5/5] Verifying endpoints...
set "API_STATUS="
set "ANOMALY_STATUS="
set "FRONTEND_STATUS="

for /f %%i in ('curl -s -o nul -w "%%{http_code}" http://localhost:3000/health') do set "API_STATUS=%%i"
if not "%API_STATUS%"=="200" (
    echo API not ready yet, waiting a bit longer...
    powershell -NoProfile -Command "Start-Sleep -Seconds 10" >nul
    for /f %%i in ('curl -s -o nul -w "%%{http_code}" http://localhost:3000/health') do set "API_STATUS=%%i"
)

for /f %%i in ('curl -s -o nul -w "%%{http_code}" http://localhost:5000/health') do set "ANOMALY_STATUS=%%i"
if not "%ANOMALY_STATUS%"=="200" (
    echo Anomaly not ready yet, waiting a bit longer...
    powershell -NoProfile -Command "Start-Sleep -Seconds 10" >nul
    for /f %%i in ('curl -s -o nul -w "%%{http_code}" http://localhost:5000/health') do set "ANOMALY_STATUS=%%i"
)

for /f %%i in ('curl -s -o nul -w "%%{http_code}" http://localhost:3001') do set "FRONTEND_STATUS=%%i"
if not "%FRONTEND_STATUS%"=="200" (
    echo Frontend not ready yet, waiting a bit longer...
    powershell -NoProfile -Command "Start-Sleep -Seconds 10" >nul
    for /f %%i in ('curl -s -o nul -w "%%{http_code}" http://localhost:3001') do set "FRONTEND_STATUS=%%i"
)

if not "%API_STATUS%"=="200" (
    echo ERROR: API health check failed with status %API_STATUS%
    exit /b 1
)
if not "%ANOMALY_STATUS%"=="200" (
    echo ERROR: Anomaly health check failed with status %ANOMALY_STATUS%
    exit /b 1
)
if not "%FRONTEND_STATUS%"=="200" (
    echo ERROR: Frontend health check failed with status %FRONTEND_STATUS%
    exit /b 1
)

echo.
echo PASS: Local stack is running.
echo   Frontend: http://localhost:3001
echo   API:      http://localhost:3000/api/logs/stats
echo   Anomaly:  http://localhost:5000/health
echo.
echo Use stop-local.bat when you are done.
exit /b 0
