@echo off
setlocal EnableExtensions
title ELFIA OFFICIAL STORE - deploy
REM ============================================================
REM  DOUBLE-CLICK THIS. IT PUTS THE SHOP LIVE.
REM
REM  This project publishes TWO SEPARATE THINGS, and deploying
REM  one without the other is what made new features look broken
REM  on 25-08 - the engine went live, the website did not:
REM
REM    * elfia-api    - the ENGINE  (worker\ folder: database,
REM                     the portal bridge, prices, photos)
REM    * elfia-store  - the WEBSITE (Cloudflare Pages, out\)
REM
REM  This file always does both, applies any database changes
REM  first, and checks the live result itself.
REM
REM  The management portal is a separate project with its own
REM  copy of this file; run that one to publish that side.
REM ============================================================

cd /d "%~dp0"
if not exist "worker\wrangler.toml" goto :nofolder

echo.
echo   ELFIA OFFICIAL STORE - deploy
echo   =============================
echo   This takes a few minutes. Leave the window open until it
echo   says DONE.
echo.

echo   [1/6] Checking the Cloudflare login...
cd worker
call npx wrangler whoami >nul 2>&1
if errorlevel 1 goto :nologin
cd ..
echo         signed in.

echo   [2/6] Installing what the build needs...
call npm install --no-audit --no-fund
if errorlevel 1 goto :failed

echo   [3/6] Database changes...
REM  CI=true is REQUIRED: without it wrangler asks "continue?" and
REM  answering no exits 0, which would publish new code against an
REM  un-migrated database.
set CI=true
cd worker
call npx wrangler d1 migrations apply elfia-store --remote
if errorlevel 1 goto :failedpop
cd ..
set CI=

echo   [4/6] Publishing the ENGINE (elfia-api)...
cd worker
call npx wrangler deploy
if errorlevel 1 goto :failedpop
cd ..

echo   [5/6] Building the shop...
call npx next build
if errorlevel 1 goto :failed
if not exist "out\index.html" goto :nobuild

echo   [6/6] Publishing the WEBSITE (elfia-store)...
echo         ^(this is the half that was missing before^)
call npx wrangler pages deploy out --project-name=elfia-store --commit-dirty=true
if errorlevel 1 goto :sitefailed

echo.
echo   Saving the code (history only - the deploy above is live)...
git add -A >nul 2>&1
git commit -m "store deploy" >nul 2>&1
git push >nul 2>&1

echo.
echo   Checking the live shop...
echo.
echo     --- https://elfiaofficialstore.my/api/v1/health
curl.exe -s -m 20 https://elfiaofficialstore.my/api/v1/health
echo.
echo.
echo   ============================================
echo    DONE - engine AND website are published.
echo   ============================================
echo.
echo    Your browser is still holding the old pages. Open the
echo    shop and press Ctrl+F5 (hold Ctrl, tap F5).
echo.
pause
exit /b 0

:nologin
cd /d "%~dp0"
echo.
echo   [X] Not signed in to Cloudflare. Nothing was deployed.
echo       Fix it once - a browser window opens:
echo         cd worker
echo         npx wrangler login
echo       Then double-click this file again.
echo.
pause
exit /b 1

:nofolder
echo.
echo   [X] worker\wrangler.toml is missing - this is not the full
echo       project folder. Send this message over.
echo.
pause
exit /b 1

:nobuild
echo.
echo   [X] The build produced no out\index.html, so there is no
echo       website to publish. The engine above is already live.
echo       Send the lines above over.
echo.
pause
exit /b 1

:sitefailed
echo.
echo   ============================================
echo    [X] THE WEBSITE STEP WAS REFUSED.
echo   ============================================
echo    The engine is already live, but the pages customers look
echo    at were NOT updated - exactly the half-deployed state this
echo    file exists to prevent. Copy this window and send it over.
echo.
pause
exit /b 1

:failedpop
cd ..
set CI=
:failed
echo.
echo   ============================================
echo    [X] A STEP FAILED - nothing after it ran.
echo   ============================================
echo    Scroll up to the last error and send it over.
echo.
pause
exit /b 1
