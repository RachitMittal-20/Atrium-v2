/**
 * timeline.ts — the marks on the landing page's hero scroll, as shares of the scene's whole scroll (0 at the top of the
 * page, 1 where the hero has handed over to the photo tour). In a module of their own because BlueprintScene is in the
 * landing page's first-load JavaScript: importing them from blueprint.ts or story.ts would make Turbopack ship those
 * files' geometry with it. Re-exported by blueprint.ts and story.ts.
 *
 * Step H.2 (the hero story, after two reference videos the owner chose), as reworked in step H.3 (after a photograph of a
 * villa he wanted the house to look like): the lines of the plan rise, a scan band turns them into solid walls, the house
 * is finished as a small villa and dressed, the camera tours round it and comes to stand in front of it, a glowing sweep
 * reveals the illustrative villa photograph, the view pushes in towards its door, daylight fills it, and the lobby.
 *   BUILD_END     the walls stand at full height, as glowing lines (the build's progress b reaches 1); the camera has
 *                 tilted from straight down to the three-quarter view (step 8.1's build, now the first phase)
 *   SCAN_START, SCAN_END       the scan band climbs the walls, turning the lines into solid wall below it
 *   FINISH_START, FINISH_END   roof, windows, door, the garden and the sunset come in; the sheet gives way to ground
 *   TOUR_START, TOUR_END       the camera circles to the front of the house (from BUILD_END it settles into the orbit)
 *   APPROACH_END  the camera has come down to the front view, facing the house across its garden
 *   REVEAL_START, REVEAL_END   a glowing band rises up the screen, the villa photograph appearing below it
 *   PUSH_END      the view of the photograph has pushed in towards its front door
 *   LIGHT_START, LIGHT_END     daylight fills the view (a vellum wash over the stage)
 *   FADE_START    where the hand-over to the photo tour starts. Late on purpose: the tour's lobby rises into place under
 *                 the stage until the very end (the hero overlaps it by one screen), so the wash holds until the lobby is
 *                 nearly in place, and the last stretch dissolves onto it.
 *   FADE_END      the stage is fully gone (and hidden) a little before the very end, so a scroll that stops a few px short
 *                 of the hand-over never leaves a faint stage over the lobby (e2e-landing at 390 stopped 2 px short and
 *                 found it still "visible" at 1% opacity)
 *   PRELOADER_MAX_MS  the longest the preloader may cover the page, from the start of navigation (step L.2)
 */
export const BUILD_END = 0.22;
export const SCAN_START = 0.24;
export const SCAN_END = 0.38;
export const FINISH_START = 0.34;
export const FINISH_END = 0.5;
export const TOUR_START = 0.38;
export const TOUR_END = 0.64;
export const APPROACH_END = 0.72;
export const REVEAL_START = 0.74;
export const REVEAL_END = 0.83;
export const PUSH_END = 0.95;
export const LIGHT_START = 0.9;
export const LIGHT_END = 0.95;
export const FADE_START = 0.975;
export const FADE_END = 0.995;
export const PRELOADER_MAX_MS = 2800; // under the 3 s the brief allows, leaving the fade-out inside it
