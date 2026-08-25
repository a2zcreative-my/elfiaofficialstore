/* 0015 — the carousel photo's framing, as the portal decided it (v1.8.0).
 *
 * The CEO, 25-08-2026: "I want to adjustable the photo so that I can focus
 * on what I want. it is look too zoom and which is cause the photo cant be
 * seen the overall!!"
 *
 * The hero is a wide letterbox (21:9 on desktop, 4:3 on a phone) and v1.7.0
 * cropped every slide the same way — "50% 30%", hard-coded — so a tall group
 * photo lost its heads and nobody could do anything about it from the
 * portal. These three columns carry her decision across instead.
 *
 * focus_x / focus_y — 0-100 per cent; the point of the photo that must
 * survive the crop. Straight into CSS object-position. The stored image is
 * never re-encoded, so reframing costs nothing and can be redone forever.
 *
 * fit — 'cover' fills the banner (default, and what most campaign shots
 * want); 'contain' shows the WHOLE photo letterboxed, for her "cant be seen
 * the overall" case.
 *
 * Defaults match v1.7.0's behaviour closely enough that an un-reframed slide
 * does not jump when this ships.
 */

ALTER TABLE portal_slides ADD COLUMN focus_x INTEGER NOT NULL DEFAULT 50;
ALTER TABLE portal_slides ADD COLUMN focus_y INTEGER NOT NULL DEFAULT 50;
ALTER TABLE portal_slides ADD COLUMN fit TEXT NOT NULL DEFAULT 'cover';
