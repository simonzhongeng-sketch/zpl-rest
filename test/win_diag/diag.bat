@echo off
rem Double-click to collect network diagnostics for the printer-scan problem.
rem Read-only: no files are changed, nothing is installed.
cd /d "%~dp0"
echo Collecting network diagnostics, please wait...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0diag.ps1" %*
echo.
echo Done. The diag-<computername>.txt file in this folder is what we need.
pause
