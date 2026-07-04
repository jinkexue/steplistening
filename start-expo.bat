@echo off
setlocal
chcp 65001 > nul
title Elearning Expo SDK 54
cd /d "%~dp0expo-app"

echo ================================================================
echo   Elearning Expo SDK 54
echo ================================================================
echo.
echo Starting Elearning Expo app from expo-app...
echo.

if not exist package.json (
  echo ERROR: package.json was not found in expo-app.
  echo Please make sure this script is in the project root folder.
  echo.
  pause
  exit /b 1
)

echo Step 1/3: Checking project dependencies...
echo ---------------------------------------------------------------
echo This may take a few minutes on the first run.
echo If Windows reports EPERM, close other Node/Expo terminals and retry.
echo.

call npm install --legacy-peer-deps
if errorlevel 1 (
  echo.
  echo ================================================================
  echo   npm install failed.
  echo ================================================================
  echo.
  echo Common fixes:
  echo   1. Close all other Expo / Node / VS Code terminals using this folder.
  echo   2. If needed, delete expo-app\node_modules and package-lock.json.
  echo   3. Double-click this script again.
  echo.
  echo If you saw: bob is not recognized, package.json has now been fixed
  echo for Expo SDK 54. Please retry after cleaning locked node_modules.
  echo.
  pause
  exit /b 1
)

echo.
echo Step 2/3: Let Expo align SDK 54 package versions...
echo ---------------------------------------------------------------
call npx expo install --fix
if errorlevel 1 (
  echo.
  echo WARNING: expo install --fix failed. Continuing with npm packages.
  echo.
)

echo.
echo Step 3/3: Starting Expo SDK 54 with cleared cache...
echo ---------------------------------------------------------------
echo.
echo Tips:
echo   - Open Expo Go on your phone and scan the QR code.
echo   - Press a to open Android emulator.
echo   - Press i to open iOS simulator.
echo   - Press w to open web browser.
echo   - Press Ctrl+C to stop the server.
echo.
echo ================================================================
echo.
call npx expo start --clear

echo.
echo ================================================================
echo   Expo server stopped.
echo ================================================================
echo.
pause
endlocal
