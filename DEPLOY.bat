@echo off
setlocal EnableExtensions
REM ============================================================
REM  ELFIA OFFICIAL STORE - full deploy (site + API + database)
REM  Version 0.5.0
REM
REM  ONE-TIME before the first run:
REM    1. wrangler login
REM    2. cd worker && npx wrangler d1 create elfia-store
REM       -> paste the database_id into worker\wrangler.toml
REM    3. npx wrangler r2 bucket create elfia-media
REM    4. npx wrangler secret put ADMIN_KEY   (your /admin passcode)
REM    5. EDIT worker\wrangler.toml [vars]: BANK_LINE, WHATSAPP_DIGITS,
REM       SHIPPING_CENTS, FREE_ABOVE_CENTS  (the store's money facts)
REM    6. After step [5] of the deploy, attach elfiaofficialstore.my
REM       to the elfia-store Pages project in the dashboard.
REM  STAGE B (online FPX payment) - after Billplz approves the account:
REM    npx wrangler secret put BILLPLZ_SECRET      (API Secret Key)
REM    npx wrangler secret put BILLPLZ_COLLECTION  (Collection ID)
REM    (then redeploy - the storefront turns the option on by itself)
REM ============================================================

echo [1/6] Install site dependencies
call npm install
if errorlevel 1 goto :fail

echo [2/6] Install worker dependencies
cd worker
call npm install
if errorlevel 1 ( cd .. & goto :fail )
cd ..

echo [3/6] GATE: worker must typecheck + brand isolation must hold
node tests\worker-compile-gate.mjs
if errorlevel 1 goto :fail
node tests\brand-isolation.mjs
if errorlevel 1 goto :fail

echo [4/6] Apply database migrations, then deploy the worker
cd worker
call npx wrangler d1 migrations apply elfia-store --remote
if errorlevel 1 ( cd .. & goto :fail )
call npx wrangler deploy
if errorlevel 1 ( cd .. & goto :fail )
cd ..

echo [5/6] Build and deploy the site
call npx next build
if errorlevel 1 goto :fail
call npx wrangler pages deploy out --project-name=elfia-store --commit-dirty=true
if errorlevel 1 goto :fail

echo [6/6] Health check
curl -s https://elfiaofficialstore.my/api/v1/health
echo.
echo Expect: "ok":true, "admin_key_configured":true, "bank_line_configured":true
echo ============================================================
echo   DEPLOY COMPLETE - elfiaofficialstore.my
echo ============================================================
echo.
echo   v0.5.0 NOTE: the ten new Bawal designs ship with STOCK = 0, so the
echo   whole shop reads "Sold out" until you set the counts. Open /admin
echo   -^> Products and either type the real numbers or press
echo   "Sync stock from portal" to pull them from A2Zcreative by SKU.
goto :eof

:fail
echo.
echo ****** DEPLOY STOPPED - fix the error above and run again ******
exit /b 1
