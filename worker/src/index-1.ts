/* NOT A SOURCE FILE - SAFE TO DELETE.
 *
 * 05-09-2026. A copy of the A2Z PORTAL's worker entry point was written into
 * this folder by accident while the desktop bridge was reconnecting. Windows
 * would not overwrite the store's own src/index.ts, so it kept the copy
 * beside it under this name.
 *
 * It broke the store deploy twice over: the compile gate read it and failed
 * on imports that only resolve in the other project (./staff, ./threads,
 * ./permissions), and the no-secrets gate found a password-hash template
 * inside it and refused the build.
 *
 * Its contents are gone - this file is now empty on purpose. Nothing imports
 * it, wrangler does not bundle it, and the real store worker is src/index.ts
 * next to it. Delete this file whenever convenient.
 *
 * worker/tsconfig.json now excludes duplicate names (-1 .. -9, copy) so a
 * stray copy cannot stop a deploy again.
 */
export {};
