@echo off
setlocal
cd /d "%~dp0"
node "src\cli\import-menu.js" %*
exit /b %ERRORLEVEL%
