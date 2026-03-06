@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

if not exist "%ROOT%\docker\docker-compose.yml" (
    echo ERROR: Run this script from the project root directory
    exit /b 1
)

where docker >nul 2>nul
if errorlevel 1 (
    echo ERROR: Docker is not installed or not in PATH
    exit /b 1
)

docker info >nul 2>nul
if errorlevel 1 (
    echo ERROR: Docker Desktop is installed but the engine is not running
    echo Start Docker Desktop first, wait for it to say Engine running, then re-run this script.
    exit /b 1
)

echo ============================================
echo   Log Aggregation System - Docker Test
echo ============================================
echo.

echo [1/4] Starting Docker services...
pushd "%ROOT%\docker"
docker compose up -d --build
if errorlevel 1 (
    echo ERROR: docker compose up failed
    popd
    exit /b 1
)
popd

echo.
echo [2/4] Waiting for containers to boot...
powershell -NoProfile -Command "Start-Sleep -Seconds 30" >nul

echo.
echo [3/4] Seeding API database...
pushd "%ROOT%\api"
call npm install
if errorlevel 1 (
    echo ERROR: Failed to install API dependencies for seeding
    popd
    exit /b 1
)
call npm run seed
if errorlevel 1 (
    echo ERROR: Failed to seed API database
    popd
    exit /b 1
)
popd

echo.
echo [4/4] Verifying endpoints...
set "QUEUE_STATUS="
set "API_STATUS="
set "ANOMALY_STATUS="
set "FRONTEND_STATUS="

for /f %%i in ('curl -s -o nul -w "%%{http_code}" http://localhost:8081/api/logs/pending') do set "QUEUE_STATUS=%%i"
for /f %%i in ('curl -s -o nul -w "%%{http_code}" http://localhost:3000/api/logs/stats') do set "API_STATUS=%%i"
for /f %%i in ('curl -s -o nul -w "%%{http_code}" http://localhost:5000/health') do set "ANOMALY_STATUS=%%i"
for /f %%i in ('curl -s -o nul -w "%%{http_code}" http://localhost:3001') do set "FRONTEND_STATUS=%%i"

if not "%FRONTEND_STATUS%"=="200" (
    echo Frontend not ready yet, waiting a bit longer...
    powershell -NoProfile -Command "Start-Sleep -Seconds 15" >nul
    for /f %%i in ('curl -s -o nul -w "%%{http_code}" http://localhost:3001') do set "FRONTEND_STATUS=%%i"
)

if not "%QUEUE_STATUS%"=="200" (
    echo ERROR: Queue check failed with status %QUEUE_STATUS%
    exit /b 1
)
if not "%API_STATUS%"=="200" (
    echo ERROR: API check failed with status %API_STATUS%
    exit /b 1
)
if not "%ANOMALY_STATUS%"=="200" (
    echo ERROR: Anomaly check failed with status %ANOMALY_STATUS%
    exit /b 1
)
if not "%FRONTEND_STATUS%"=="200" (
    echo ERROR: Frontend check failed with status %FRONTEND_STATUS%
    exit /b 1
)

echo.
echo PASS: Docker stack is running.
echo   Queue:    http://localhost:8081
echo   Frontend: http://localhost:3001
echo   API:      http://localhost:3000/api/logs/stats
echo   Anomaly:  http://localhost:5000/health
echo.
echo To stop Docker services:
echo   cd docker ^&^& docker compose down
exit /b 0
