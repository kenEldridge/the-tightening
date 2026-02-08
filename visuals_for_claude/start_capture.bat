@echo off
echo Starting screen capture...
echo Screenshots will be saved every second.
echo Press Ctrl+C to stop when done.
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0capture.ps1"
