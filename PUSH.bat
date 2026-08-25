@echo off
setlocal EnableExtensions
title ELFIA + PORTAL - deploy everything
REM ============================================================
REM  ONE FILE. DOUBLE-CLICK IT. IT PUTS EVERYTHING LIVE.
REM
REM  There is an identical copy of this file in the other folder;
REM  it does not matter which one you run.
REM
REM  WHY THIS FILE EXISTS (the mistake that wasted 25-08):
REM  each project publishes TWO SEPARATE THINGS, and deploying
REM  one without the other is what made new features look broken:
REM
REM    a2zcreative-official
REM      * azoneofficial-api  - the engine   (worker\ folder)
REM      * azoneofficial      - the WEBSITE  (repo root, out\)
REM    elfiaofficialstore
REM      * elfia-api          - the engine   (worker\ folder)
REM      * elfia-store        - the WEBSITE  (Cloudflare Pages, out\)
REM
REM  On 25-08 the engines went live and the websites did not, so
REM  the portal kept showing the OLD carousel card with no way to
REM  reposition a photo, even though the feature was live in the
REM  engine underneath. This file always does all four, portal
REM  first (the shop reads from it), and checks the result itself.
REM ============================================================

REM  Which folder am I sitting in? The portal has a wrangler.toml at its
REM  ROOT (its website is a worker); the store does not (its website is a
REM  Pages project). That one file tells the two apart with no guessing.
set "STORE=%~dp0"
set "PORTAL=%~dp0..\a2zcreative-official"
if exist "%~dp0wrangler.toml" set "PORTAL=%~dp0"
if exist "%~dp0wrangler.toml" set "STORE=%~dp0..\elfiaofficialstore"

echo.
echo   DEPLOY EVERYTHING
echo   =================
echo   Portal: %PORTAL%
echo   Store : %STORE%
echo.
echo   This takes about 5 minutes. Leave the window open until it
echo   says DONE.
echo.

if not exist "%PORTAL%\worker\wrangler.toml" goto :nofolders
if not exist "%STORE%\worker\wrangler.toml"  goto :nofolders

REM ============================================================
REM  PORTAL
REM ============================================================
echo.
echo   ========== PORTAL (a2zcreative.my) ==========
cd /d "%PORTAL%"

echo   [1/5] Checking the Cloudflare login...
cd worker
call npx wrangler whoami >nul 2>&1
if errorlevel 1 goto :nologin
cd ..
echo         signed in.

echo   [2/5] Installing what the build needs...
call pnpm install
if errorlevel 1 goto :failed

echo   [3/5] Database columns...
set CI=true
cd worker
call npx wrangler d1 migrations apply azoneofficial --remote
if errorlevel 1 goto :failedpop
cd ..
set CI=

echo   [4/5] Publishing the ENGINE (azoneofficial-api)...
cd worker
call npx wrangler deploy
if errorlevel 1 goto :failedpop
cd ..

echo   [5/5] Building and publishing the WEBSITE (azoneofficial)...
echo         ^(this is the half that was missing^)
call pnpm build
if errorlevel 1 goto :failed
if not exist "out\index.html" goto :nobuild
call npx wrangler deploy
if errorlevel 1 goto :sitefailed

REM ============================================================
REM  STORE
REM ============================================================
echo.
echo   ========== STORE (elfiaofficialstore.my) ==========
cd /d "%STORE%"

echo   [1/5] Installing what the build needs...
call npm install --no-audit --no-fund
if errorlevel 1 goto :failed

echo   [2/5] Database columns...
set CI=true
cd worker
call npx wrangler d1 migrations apply elfia-store --remote
if errorlevel 1 goto :failedpop
cd ..
set CI=

echo   [3/5] Publishing the ENGINE (elfia-api)...
cd worker
call npx wrangler deploy
if errorlevel 1 goto :failedpop
cd ..

echo   [4/5] Building the shop...
call npx next build
if errorlevel 1 goto :failed
if not exist "out\index.html" goto :nobuild

echo   [5/5] Publishing the WEBSITE (elfia-store)...
call npx wrangler pages deploy out --project-name=elfia-store --commit-dirty=true
if errorlevel 1 goto :sitefailed

REM ============================================================
REM  SAVE THE CODE (never blocks a deploy - it runs last)
REM ============================================================
echo.
echo   Saving both folders to GitHub (history only - the deploys
echo   above are already live)...
cd /d "%PORTAL%"
git add -A >nul 2>&1
git commit -m "portal deploy" >nul 2>&1
git push >nul 2>&1
cd /d "%STORE%"
git add -A >nul 2>&1
git commit -m "store deploy" >nul 2>&1
git push >nul 2>&1

REM ============================================================
REM  CHECK THE LIVE SYSTEMS
REM ============================================================
echo.
echo   Checking both live systems...
echo.
echo     --- https://a2zcreative.my/api/v1/health
curl.exe -s -m 20 https://a2zcreative.my/api/v1/health
echo.
echo.
echo     --- https://elfiaofficialstore.my/api/v1/health
curl.exe -s -m 20 https://elfiaofficialstore.my/api/v1/health
echo.
echo.
echo   ============================================
echo    DONE - engines AND websites are published.
echo   ============================================
echo.
echo    IMPORTANT: your browser is still holding the old pages.
echo    Open each one and press Ctrl+F5 (hold Ctrl, tap F5):
echo      1. https://a2zcreative.my/portal  - the carousel card
echo         should now show "Change photo", "Whole photo" and
echo         "click the photo to aim".
echo      2. https://elfiaofficialstore.my  - discounted items
echo         show the old price crossed out with a SALE badge.
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

:nofolders
echo.
echo   [X] Could not find both project folders side by side.
echo       Expected them next to each other, for example:
echo         Desktop\elfiaofficialstore
echo         Desktop\a2zcreative-official
echo       Send this message over.
echo.
pause
exit /b 1

:nobuild
echo.
echo   [X] The build produced no out\index.html, so there is no
echo       website to publish. Nothing further was deployed.
echo       Send the lines above over.
echo.
pause
exit /b 1

:sitefailed
echo.
echo   ============================================
echo    [X] THE WEBSITE STEP WAS REFUSED.
echo   ============================================
echo    The engine above is already live, but the pages people
echo    actually look at were NOT updated - which is exactly the
echo    half-deployed state this file exists to prevent.
echo.
echo    The usual cause: that worker is connected to a GitHub
echo    repository, and Cloudflare will not let this computer
echo    publish over a git-connected worker. Fix it once:
echo      Cloudflare - Workers and Pages - pick the worker
echo      - Settings - Build - Disconnect
echo    then run this file again.
echo.
echo    Copy this window and send it over.
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
