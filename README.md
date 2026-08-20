# ELFIA OFFICIAL STORE — direct ecommerce

Standalone system for elfiaofficialstore.my. Next.js static storefront
(Cloudflare Pages) + TypeScript Worker (`elfia-api`) + D1 (`elfia-store`)
+ R2 (`elfia-media`).

Customer flow: catalogue → cart → checkout (order + stock reserved) →
order page with bank details + WhatsApp + receipt upload → you confirm in
/admin → ship with tracking → delivered. Statuses only move forward;
cancelling an unpaid order restocks automatically.

FIRST THING AFTER DEPLOYING: the ten Bawal designs (LUMI001–LUMI010) were
seeded with stock 0, so every one of them reads *Sold out*. Set the real
counts in /admin → Products, or press **Sync stock from portal** to pull them
from the agency portal by SKU. Prices (RM 49 plain / RM 59 printed) are
already correct.

Two other things to set, both in `worker/wrangler.toml`:
`WHATSAPP_DIGITS` (the floating WhatsApp button stays hidden until it is a
real number) and `BANK_LINE`.

- Prices/stock are decided by the Worker — the browser is never trusted.
- Receipts live under R2 `receipts/` and are only readable with the admin key.
- Stage B (Billplz FPX) is code-complete in `worker/src/billplz.ts` and inert
  until BILLPLZ_SECRET + BILLPLZ_COLLECTION are set. Test against the Billplz
  sandbox (BILLPLZ_SANDBOX = "1") or with one real RM1 bill first. The
  callback never trusts its parameters — every bill is re-queried against
  Billplz's authenticated API before an order is marked paid.

Deploy: follow the one-time steps in the header of `DEPLOY.bat`, then run
`DEPLOY.bat` for every release.
