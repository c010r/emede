@echo off
rem Instalador de emede para Windows: doble clic. Ejecuta install.ps1 sin cambiar la politica de scripts del equipo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
pause
