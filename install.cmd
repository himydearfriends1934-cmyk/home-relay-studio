@echo off
cd /d "%~dp0"
node scripts\install.js
if errorlevel 1 pause
