/* 0016 — zoom, so the portal can pull a carousel photo BACK (store v1.9.0).
 *
 * The CEO, 25-08-2026: "Instead of clickable, I want to zoom out at least I
 * can see the full instead of like this!!!"
 *
 * 0015 gave the portal an aim point and a crop/no-crop switch. A switch has
 * no middle: either the photo filled the banner with its edges cut off, or
 * it sat fully inside with big empty bands. What she wants is the dial in
 * between, so this column carries it.
 *
 * zoom — per cent. 100 = the WHOLE photo fits inside the hero, nothing cut
 * off. Above that the photo grows and the hero crops it around the focus
 * point. Applied as a CSS transform over object-fit: contain, so the stored
 * file is never touched and re-framing stays free.
 *
 * Default 100 would visibly change every existing slide, so the store keeps
 * reading `fit` for rows the portal has not zoomed yet: NULL here means "use
 * the old switch". Only a slide she actually drags gets a number.
 */

ALTER TABLE portal_slides ADD COLUMN zoom INTEGER;
