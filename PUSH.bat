@echo off
setlocal EnableExtensions
title ELFIA OFFICIAL STORE - go live
REM ============================================================
REM  ELFIA OFFICIAL STORE - PUSH.bat  (v2)
REM
REM  THE STORE IS TWO SEPARATE THINGS AND THEY DEPLOY DIFFERENTLY.
REM  This is what went wrong on 25-08: the website updated and the
REM  engine did not, so the new header appeared but the product
REM  names still came from the old rules.
REM
REM    1. THE WEBSITE  (what you look at)
REM       Deploys BY ITSELF when this folder is pushed to GitHub.
REM
REM    2. THE ENGINE   (worker "elfia-api" - the database, the
REM       portal bridge, the prices, the photos, the carousel)
REM       Does NOT deploy from GitHub. It has to be published from
REM       this computer with wrangler. THAT is step 4 below, and
REM       it is the step that was missing.
REM
REM  This file now does both, in the right order, and checks the
REM  live result itself.
REM ============================================================

cd /d "%~dp0"
set "TMPH=%TEMP%\elfia-health.txt"

echo.
echo   ELFIA OFFICIAL STORE - go live
echo   ==============================
echo.

if not exist ".git"                 goto :nogit
if not exist "worker\wrangler.toml" goto :noworker

set "PKG="
for /f "tokens=2 delims=:, " %%v in ('findstr /C:"\"version\"" package.json') do if not defined PKG set "PKG=%%~v"
echo   Version in this folder: %PKG%
echo.

echo   [1/5] Checking you are signed in to Cloudflare...
pushd worker
call npx wrangler whoami >nul 2>&1
if errorlevel 1 (
  popd
  echo.
  echo   [X] Not signed in to Cloudflare, so the engine cannot be
  echo       published. Fix it once - a browser window opens:
  echo.
  echo         cd worker
  echo         npx wrangler login
  echo.
  echo       Then double-click this file again.
  echo.
  pause
  exit /b 1
)
popd
echo         signed in.
echo.

echo   [2/5] Sending the website to GitHub...
git add -A
git status --short
git commit -m "ELFIA store v%PKG% - portal photos, prices, discount and carousel"
if errorlevel 1 echo         nothing new to save - pushing anyway.
git push
if errorlevel 1 (
  echo.
  echo   [X] THE PUSH WAS REFUSED - the website will not update.
  echo       Usually: not signed in to GitHub, or someone else
  echo       changed the repo. Try:  git pull   then run this again.
  echo       Copy this window and send it over.
  echo.
  pause
  exit /b 1
)
echo         sent - Cloudflare rebuilds the website by itself.
echo.

echo   [3/5] Adding the new database columns (discount, carousel)...
REM  CI=true is REQUIRED: without it wrangler asks "continue?" and
REM  answering no exits 0 - which would publish new code against an
REM  un-migrated database.
set CI=true
pushd worker
call npx wrangler d1 migrations apply elfia-store --remote
if errorlevel 1 (
  popd
  set CI=
  echo.
  echo   [X] The database step failed. NOTHING was published - the
  echo       live site is untouched and still working. Send the
  echo       lines above over.
  echo.
  pause
  exit /b 1
)
popd
set CI=
echo.

echo   [4/5] Publishing the ENGINE - this is the step that was missing...
pushd worker
call npx wrangler deploy
if errorlevel 1 (
  popd
  echo.
  echo   ============================================
  echo    [X] THE ENGINE DID NOT PUBLISH.
  echo   ============================================
  echo    The website will still update from the push above, but
  echo    the portal takeover, the discount and the carousel all
  echo    live in the engine, so nothing will look different.
  echo.
  echo    If the error mentions the worker being connected to a
  echo    REPOSITORY, Cloudflare is refusing a direct publish:
  echo      Cloudflare - Workers and Pages - elfia-api
  echo      - Settings - Build - Disconnect, run this again,
  echo      then reconnect it afterwards.
  echo.
  echo    Copy this window and send it over.
  echo.
  pause
  exit /b 1
)
popd
echo.

echo   [5/5] Checking the live site...
echo.
set /a TRIES=0

:poll
set /a TRIES+=1
timeout /t 10 /nobreak >nul
curl.exe -s -m 20 https://elfiaofficialstore.my/api/v1/health > "%TMPH%" 2>nul
type "%TMPH%"
echo.
findstr /C:"\"version\":\"%PKG%\"" "%TMPH%" >nul && goto :live
if %TRIES% LSS 12 goto :poll

echo.
echo   [!] The live site still does not say v%PKG%. The publish
echo       above said it worked, so this is usually the domain
echo       pointing at a different worker. Send this window over.
echo.
pause
exit /b 1

:live
echo.
echo   ============================================
echo    DONE - v%PKG% is LIVE on elfiaofficialstore.my
echo   ============================================
echo.
echo    The engine now takes the PORTAL as the boss. Within 5
echo    minutes (it checks the portal every 5 minutes by itself):
echo      1. Product NAMES become the portal's names.
echo      2. Product PHOTOS become the photos you uploaded there.
echo      3. Discount RM shows as a crossed-out price + SALE badge.
echo      4. Carousel photos from the portal appear on the home page.
echo.
echo    Refresh the shop with Ctrl+F5 after 5 minutes.
echo.
echo    One thing still switched off - NEW products from the portal
echo    stay hidden until this is set (needed once only):
echo      cd worker
echo      npx wrangler secret put ADMIN_KEY
echo.
pause
exit /b 0

:nogit
echo   [X] This folder is not connected to git - the website half
echo       cannot be sent. Send this message over.
echo.
pause
exit /b 1

:noworker
echo   [X] worker\wrangler.toml is missing - this is not the full
echo       project folder. Send this message over.
echo.
pause
exit /b 1
