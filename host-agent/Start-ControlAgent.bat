@echo off
title TwinView Control Agent
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-ControlAgent.ps1"
pause
