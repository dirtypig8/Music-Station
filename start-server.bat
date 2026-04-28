@echo off
setlocal
cd /d "%~dp0"

if not exist "venv\Scripts\python.exe" (
  echo [ERROR] venv\Scripts\python.exe not found
  pause
  exit /b 1
)

"venv\Scripts\python.exe" "server.py"
set "EC=%ERRORLEVEL%"

if not "%EC%"=="0" (
  echo.
  echo [ERROR] server.py failed with exit code %EC%
)

pause
