/* 0013 — products the PORTAL creates, and the photos it sends (store v1.5.0).
 *
 * The CEO, 25-08-2026: "on portal I want an option for me to upload the photo
 * and also to bridge directly to ELFIA … Shawl seem not yet being sync yet".
 *
 * The shawls were never a sync failure. The bridge can only refresh a SKU the
 * store ALREADY has, and ELFIA has no shawl products at all — the collection
 * was created in v0.2.0 and never filled. So the feed carried shawls that
 * matched nothing, every pull, forever.
 *
 * From v1.5.0 an unmatched SKU that arrives with a name and a price is
 * CREATED here instead of merely reported. It is created hidden: nothing the
 * portal invents reaches a customer before a human has looked at it.
 *
 *   portal_created  1 = this row was made by the bridge, not by /admin.
 *                   It also decides photo ownership (see portal.ts).
 *   portal_pending  1 = waiting in /admin → Products → From portal.
 *                   Publish sets it to 0 and active to 1; Dismiss sets it to 0
 *                   and leaves the product hidden.
 *   image_marker    the portal's own change-marker for the photo we last
 *                   downloaded (ISO time, ETag or hash — the store treats it
 *                   as opaque). Unchanged marker = no re-download, so a feed
 *                   may repeat it every five minutes for free.
 *
 * Every existing row defaults to 0 / 0 / NULL: nothing already in the shop is
 * portal-owned, nothing appears in the review list, and no existing photo is
 * ever replaced by the bridge.
 */

ALTER TABLE products ADD COLUMN portal_created INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN portal_pending INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN image_marker TEXT;

/* The review list asks "anything waiting?" on every /admin load. */
CREATE INDEX IF NOT EXISTS idx_products_portal_pending
  ON products (portal_pending) WHERE portal_pending = 1;
