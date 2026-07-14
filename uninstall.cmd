@echo off
cd /d "%~dp0"
node scripts\uninstall.js
if errorlevel 1 pause
