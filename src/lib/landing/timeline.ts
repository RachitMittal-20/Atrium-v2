/**
 * timeline.ts — the marks on the landing page's hero scroll, as shares of the scene's whole scroll (0 at the top of the
 * page, 1 where the hero has handed over to the photo tour). In a module of their own because BlueprintScene is in the
 * landing page's first-load JavaScript: importing them from blueprint.ts or story.ts would make Turbopack ship those
 * files' geometry with it. Re-exported by blueprint.ts and story.ts.
 *
 * Step H.2 (the hero story, after two reference videos the owner chose): the lines of the plan rise, a scan band turns
 * them into solid walls, the house is finished and dressed, the camera tours round it and walks in at the front door.
 *   BUILD_END     the walls stand at full height, as glowing lines (the build's progress b reaches 1); the camera has
 *                 tilted from straight down to the three-quarter view (step 8.1's build, now the first phase)
 *   SCAN_START, SCAN_END       the scan band climbs the walls, turning the lines into solid wall below it
 *   FINISH_START, FINISH_END   floors, roof, the site round the house and the sky come in; the sheet gives way to ground
 *   TOUR_START, TOUR_END       the camera circles to the front of the house (from BUILD_END it settles into the orbit)
 *   ENTER_END     the camera has walked through the front door
 *   LIGHT_START, LIGHT_END     daylight fills the view as the camera crosses the threshold (a vellum wash over the stage)
 *   FADE_START    where the hand-over to the photo tour starts; it ends at the scene's last scroll. Late on purpose: the
 *                 tour's lobby rises into place under the stage until the very end (the hero overlaps it by one screen),
 *                 so the wash holds until the lobby is nearly in place, and the last stretch dissolves onto it.
 *   PRELOADER_MAX_MS  the longest the preloader may cover the page, from the start of navigation (step L.2)
 */
export const BUILD_END = 0.24;
export const SCAN_START = 0.26;
export const SCAN_END = 0.42;
export const FINISH_START = 0.38;
export const FINISH_END = 0.52;
export const TOUR_START = 0.42;
export const TOUR_END = 0.74;
export const ENTER_END = 0.95;
export const LIGHT_START = 0.88;
export const LIGHT_END = 0.94;
export const FADE_START = 0.975;
export const PRELOADER_MAX_MS = 2800; // under the 3 s the brief allows, leaving the fade-out inside it
