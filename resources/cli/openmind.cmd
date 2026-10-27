@echo off
setlocal
set ELECTRON_RUN_AS_NODE=1
for %%I in ("%~dp0..") do set "resources_dir=%%~fI"
for %%I in ("%~dp0..\..") do set "app_dir=%%~fI"
"%app_dir%\OpenMind.exe" "%resources_dir%\app.asar\.build\electron\electron\cli\openmind.js" %*
exit /b %errorlevel%
