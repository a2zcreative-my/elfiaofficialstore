@echo off
setlocal EnableExtensions EnableDelayedExpansion
title ELFIA OFFICIAL STORE - deploy
REM ============================================================
REM  ELFIA OFFICIAL STORE - full deploy (site + API + database)
REM  Version 1.3.0
REM
REM  This script NEVER closes without telling you why. Everything it
REM  prints is also written to deploy-log.txt next to this file.
REM
REM  Just double-click it. It checks everything first and stops with a
REM  plain-English message if something is not ready.
REM ============================================================

set "LOG=%~dp0deploy-log.txt"
set "STEP=starting"
pushd "%~dp0" || (echo Could not enter the project folder & pause & exit /b 1)
echo ELFIA deploy - %DATE% %TIME% > "%LOG%"

echo.
echo   ELFIA OFFICIAL STORE - deploy
echo   ==============================
echo.

REM ---------------------------------------------------------------- checks
set "STEP=checking your computer"
call :say "[1/9] Checking Node.js and npm"
where node >nul 2>&1 || call :die "Node.js is not installed. Install the LTS version from nodejs.org, then run this again."
where npm  >nul 2>&1 || call :die "npm is missing. Reinstall Node.js from nodejs.org."
for /f "tokens=*" %%v in ('node --version 2^>nul') do call :say "      node %%v"

set "STEP=checking the project files"
if not exist "package.json"            call :die "package.json is missing - run this from inside the elfia-store folder."
if not exist "worker\wrangler.toml"    call :die "worker\wrangler.toml is missing - the download may be incomplete."
if not exist "worker\migrations"       call :die "worker\migrations is missing - the download may be incomplete."

set "STEP=checking wrangler.toml for placeholders"
call :say "[2/9] Checking worker\wrangler.toml"
findstr /C:"REPLACE_WITH_D1_DATABASE_ID" "worker\wrangler.toml" >nul && call :die "worker\wrangler.toml still says REPLACE_WITH_D1_DATABASE_ID.  Fix: cd worker  then  npx wrangler d1 create elfia-store  and paste the database_id it prints into worker\wrangler.toml"
findstr /C:"BANK_LINE = \"REPLACE" "worker\wrangler.toml" >nul && call :warn "BANK_LINE is still a placeholder - customers will see 'REPLACE...' instead of your bank account."
findstr /C:"WHATSAPP_DIGITS = \"60000000000\"" "worker\wrangler.toml" >nul && call :warn "WHATSAPP_DIGITS is still the dummy number - the floating WhatsApp button will stay hidden."

set "STEP=checking you are logged in to Cloudflare"
call :say "[3/9] Checking Cloudflare login"
pushd worker
call npx wrangler whoami >>"%LOG%" 2>&1
if errorlevel 1 (
  popd
  call :die "Not logged in to Cloudflare.  Fix: cd worker  then  npx wrangler login  - a browser window will open."
)
popd
call :say "      logged in"

REM ------------------------------------------------------------- install
set "STEP=installing site dependencies"
call :say "[4/9] Installing site dependencies (first run takes a few minutes)"
call npm install >>"%LOG%" 2>&1
if errorlevel 1 call :die "npm install failed for the site. Open deploy-log.txt and read the last lines - it is usually no internet connection."

set "STEP=installing worker dependencies"
call :say "[5/9] Installing worker dependencies"
pushd worker
call npm install >>"%LOG%" 2>&1
if errorlevel 1 ( popd & call :die "npm install failed for the worker. See deploy-log.txt." )
popd

REM ---------------------------------------------------------------- gates
set "STEP=running the safety gates"
call :say "[6/9] Safety gates - typecheck, brand isolation, no hardcoded keys"
call node tests\no-secrets.mjs
if errorlevel 1 call :die "A credential looks like it is written into the code. Nothing was deployed. See the list above - move each one into: cd worker  then  npx wrangler secret put NAME"
call node tests\worker-compile-gate.mjs
if errorlevel 1 call :die "The worker does not compile. Nothing was deployed. See the errors above."
call node tests\brand-isolation.mjs
if errorlevel 1 call :die "Another company's identity appears in this repo. Nothing was deployed."

REM ------------------------------------------------------ database + worker
set "STEP=applying database migrations"
call :say "[7/9] Applying database migrations, then deploying the API"
pushd worker
call npx wrangler d1 migrations apply elfia-store --remote
if errorlevel 1 ( popd & call :die "Database migration failed. Common causes: the database_id in wrangler.toml is wrong, or the database was never created (npx wrangler d1 create elfia-store)." )
call npx wrangler deploy
if errorlevel 1 ( popd & call :die "Deploying the worker failed. See the error above." )
popd

REM ------------------------------------------------------------- the site
set "STEP=building the site"
call :say "[8/9] Building and deploying the site"
call npx next build
if errorlevel 1 call :die "The site failed to build. See the error above - the last few lines name the file."
if not exist "out\index.html" call :die "The build produced no out\index.html. Nothing was deployed."
call npx wrangler pages deploy out --project-name=elfia-store --commit-dirty=true
if errorlevel 1 call :die "Uploading the site failed. If it says the project does not exist, create it once in the Cloudflare dashboard (Workers ^& Pages -^> Create -^> Pages) named elfia-store."

REM ------------------------------------------------------------ health
set "STEP=health check"
call :say "[9/9] Health check"
timeout /t 5 /nobreak >nul
curl -s https://elfiaofficialstore.my/api/v1/health > "%TEMP%\elfia-health.json" 2>>"%LOG%"
type "%TEMP%\elfia-health.json"
type "%TEMP%\elfia-health.json" >> "%LOG%"
echo.
echo.
echo   ============================================================
echo     DEPLOY COMPLETE - elfiaofficialstore.my
echo   ============================================================
echo.
echo   In the health line above, all of these should be true:
echo     "db"                          the database answered
echo     "migrations_current"          the database has every table (if
echo                                   false, the health line names the fix)
echo     "admin_key_configured"        you can sign in to /admin
echo     "bank_line_configured"        customers see your real account
echo     "gateway_configured"          online payment (Billplz) is on
echo     "gateway_signature_configured" callbacks are signature-checked
echo     "bridge_pull_configured"      counts come from the portal
echo     "bridge_push_configured"      your sales reach the portal
echo.
echo   Any that say false, set the matching secret and run this again:
echo     cd worker
echo     npx wrangler secret put ADMIN_KEY
echo     npx wrangler secret put BILLPLZ_SECRET
echo     npx wrangler secret put BILLPLZ_COLLECTION
echo     npx wrangler secret put BILLPLZ_XSIGN
echo     npx wrangler secret put BRIDGE_KEY
echo     npx wrangler secret put BRIDGE_URL        (portal inventory feed)
echo     npx wrangler secret put BRIDGE_PUSH_URL   (portal movements endpoint)
echo   (Each asks you to paste the value. It is never written to a file.)
echo.
echo   Then open /admin -^> Orders -^> "Test online payment (Billplz)".
echo.
echo   Full log: deploy-log.txt
echo.
popd
pause
exit /b 0

REM ------------------------------------------------------------ helpers
:say
echo   %~1
echo %~1 >> "%LOG%"
exit /b 0

:warn
echo.
echo   [!] %~1
echo WARNING: %~1 >> "%LOG%"
echo.
exit /b 0

:die
echo.
echo   ============================================================
echo     STOPPED while %STEP%
echo   ============================================================
echo.
echo   %~1
echo.
echo   Nothing was deployed. The full log is in deploy-log.txt
echo.
echo STOPPED while %STEP%: %~1 >> "%LOG%"
popd
pause
exit /b 1
