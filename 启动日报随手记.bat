@echo off
setlocal
title Daily Report Launcher

rem Always run from the folder that contains this batch file.
cd /d "%~dp0"
if errorlevel 1 (
    echo [Daily Report] Cannot enter the project folder.
    pause
    exit /b 1
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo [Daily Report] npm was not found in PATH.
    echo Please install Node.js or add npm to the system PATH.
    pause
    exit /b 1
)

echo [Daily Report] Starting...
call npm.cmd start
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if "%EXIT_CODE%"=="0" (
    echo [Daily Report] npm start finished with exit code 0.
    echo If no window is visible, check the system tray; another instance may already be running.
) else (
    echo [Daily Report] npm start failed with exit code %EXIT_CODE%.
)
echo.
echo This window will stay open so you can read the result.
pause

endlocal & exit /b %EXIT_CODE%
