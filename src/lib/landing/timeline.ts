/**
 * timeline.ts — the two marks on the landing page's blueprint scroll (step 8.1), in a module of their own because
 * BlueprintScene is in the landing page's first-load JavaScript: importing them from blueprint.ts made Turbopack
 * ship blueprint.ts, geometry.ts and plan2d/openings.ts with it. Re-exported by blueprint.ts.
 *   BUILD_END   where in the scene's scroll the walls reach full height (the build's progress b reaches 1)
 *   FADE_START  where the hand-over fade to the mansion starts; it ends at the scene's last scroll
 *   PRELOADER_MAX_MS  the longest the preloader may cover the page, from the start of navigation (step L.2)
 */
export const BUILD_END = 0.8;
export const FADE_START = 0.85;
export const PRELOADER_MAX_MS = 2800; // under the 3 s the brief allows, leaving the fade-out inside it
