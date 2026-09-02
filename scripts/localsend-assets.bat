@echo off
rem Phone -> asset-folder bridge via LocalSend (double-click needs a folder arg,
rem so create a shortcut with your asset folder as the argument, or run from cmd).
rem Usage: localsend-assets.bat D:\path\to\asset-folder ["StoryFlow 资产库"]
if "%~1"=="" (
  echo usage: localsend-assets.bat ^<asset-folder^> [alias]
  echo e.g.:  localsend-assets.bat D:\Sync\storyflow-assets
  pause
  exit /b 1
)
set ALIAS=%~2
if "%ALIAS%"=="" set ALIAS=StoryFlow 资产库
where python >nul 2>nul || (echo Python not found - install from python.org and retry & pause & exit /b 1)
python "%~dp0localsend_recv.py" "%~1" "%ALIAS%"
