@echo off
setlocal
cd /d "%~dp0"
node "src\cli\export-halls-tables.js" %*
exit /b %ERRORLEVEL%
