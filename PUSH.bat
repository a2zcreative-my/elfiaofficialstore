@echo off
setlocal EnableExtensions
title ELFIA OFFICIAL STORE - push and go live
REM ============================================================
REM  ELFIA OFFICIAL STORE - PUSH.bat
REM
REM  Double-click this. It sends the code in THIS folder to GitHub;
REM  Cloudflare builds and publishes it by itself a minute or two
REM  later. Then this window CHECKS the live site and prints the
REM  version it is running, so you can see it worked without
REM  asking anybody.
REM
REM  This is the path that actually put v1.5.1 live. DEPLOY.bat is
REM  the old direct-from-this-computer route; Cloudflare refuses it
REM  while the worker is connected to the repository.
REM ============================================================

cd /d "%~dp0"
set "TMPH=%TEMP%\elfia-health.txt"

echo.
echo   ELFIA OFFICIAL STORE - push and go live
echo   =======================================
echo.

if not exist ".git" (
  echo   [X] This folder is not connected to git, so there is
  echo       nothing to push. Send this message over.
  echo.
  pause
  exit /b 1
)

set "PKG="
for /f "tokens=2 delims=:, " %%v in ('findstr /C:"\"version\"" package.json') do if not defined PKG set "PKG=%%~v"
echo   Version in this folder: %PKG%
echo.

echo   [1/4] Checking what changed...
git add -A
git status --short
echo.

echo   [2/4] Saving the change...
git commit -m "ELFIA store v%PKG% - portal photos, prices, discount and carousel"
if errorlevel 1 (
  echo.
  echo       Nothing new to save - already committed. Pushing anyway,
  echo       in case it never reached GitHub.
  echo.
)

echo   [3/4] Sending to GitHub...
git push
if errorlevel 1 (
  echo.
  echo   ============================================
  echo    [X] THE PUSH WAS REFUSED. Nothing is live.
  echo   ============================================
  echo    Usual reasons:
  echo      * not signed in to GitHub on this computer
  echo      * someone else changed the repo - run:  git pull
  echo        then double-click this file again
  echo.
  echo    Copy this window and send it over.
  echo.
  pause
  exit /b 1
)
echo.
echo       Sent. Cloudflare is building now - 1 to 3 minutes.
echo       Leave this window open.
echo.

echo   [4/4] Watching the live site...
echo.
REM  A plain counter + goto, NOT a for-loop calling a subroutine:
REM  "goto" out of a CALLed label only returns to the loop, which
REM  would keep polling after the site was already up.
set /a TRIES=0

:poll
set /a TRIES+=1
timeout /t 20 /nobreak >nul
curl.exe -s -m 20 https://elfiaofficialstore.my/api/v1/health > "%TMPH%" 2>nul
type "%TMPH%"
echo.
findstr /C:"\"version\":\"%PKG%\"" "%TMPH%" >nul && goto :live
if %TRIES% LSS 20 goto :poll

echo.
echo   ============================================
echo    [!] Still not showing v%PKG% after 7 minutes.
echo   ============================================
echo    The push worked, so the build is either still running
echo    or it failed. Look here:
echo      Cloudflare - Workers and Pages - elfia-api - Builds
echo    Send over whatever the newest build says.
echo.
pause
exit /b 1

:live
echo.
echo   ============================================
echo    DONE - v%PKG% is LIVE on elfiaofficialstore.my
echo   ============================================
echo.

REM  Cloudflare's build publishes the code but does NOT touch the
REM  database. v1.7.0 adds the sale price and the carousel table,
REM  so the health line above says migrations_current:false until
REM  this runs. Do it here rather than leaving it to be discovered.
findstr /C:"\"migrations_current\":true" "%TMPH%" >nul
if not errorlevel 1 goto :dbok

echo    The database still needs the new columns for the discount
echo    and the carousel. Applying them now...
echo.
pushd worker
set CI=true
call npx wrangler d1 migrations apply elfia-store --remote
set "MIGFAIL=%errorlevel%"
set CI=
popd
if not "%MIGFAIL%"=="0" (
  echo.
  echo    [!] The migration did not run. The site is live but the
  echo        discount and carousel will not show until it does.
  echo        Run it by hand:
  echo          cd worker
  echo          npx wrangler d1 migrations apply elfia-store --remote
  echo.
)

:dbok
echo    What to check on the site (refresh with Ctrl+F5):
echo      1. Under the ELFIA logo it now reads
echo         "First Sight, Forever Yours" - same as the footer.
echo      2. Within 5 minutes the product names, photos and
echo         prices become whatever the portal says.
echo      3. Any Discount RM set in the portal shows as a
echo         crossed-out old price with a SALE badge.
echo      4. Carousel photos added in the portal appear at the
echo         top of the home page.
echo.
echo    Still to do once, whenever you have a minute - this is
echo    what stops NEW products from the portal being published:
echo      cd worker
echo      npx wrangler secret put ADMIN_KEY
echo.
pause
exit /b 0
