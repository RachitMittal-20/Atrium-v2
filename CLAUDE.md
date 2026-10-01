# CLAUDE.md — Atrium v2

Read this file before every task. It is the shared context for all prompts in `docs/PROMPTS.md`.

## What this app is
Atrium v2 turns a floor-plan image into an **editable** 3D model that people can walk through, furnish, and export as 3D and 2D files. It is a zero-cost demo: one Next.js app deployed on Vercel's free tier, with no separate backend. OCR runs in the browser (tesseract.js).

## The one architectural rule
Everything is generated from a single `Plan` object (walls, openings, rooms, items, options). The 3D scene, the 2D plan, room areas, schedules, and every export are **derived views** of `Plan`. Never bake geometry into a mesh that can't be regenerated from `Plan`. If a feature seems to need that, stop and ask.

## Stack
Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind 4 (`@theme` tokens in `src/app/globals.css`), React Three Fiber + drei, three.js r186, GSAP + ScrollTrigger + Lenis, Zustand + Immer, tesseract.js.

## Existing code you must know
- `src/types/blueprint.ts`, `src/lib/blueprint/{grid,wallMask,rooms,ocr,roomLabels}.ts`: blueprint detection and OCR imported unchanged from Atrium v1. Reuse them; don't rewrite them unless a prompt says to.
- `src/components/motion/SmoothScrollProvider.tsx` + `src/store/scrollStore.ts`: the single GSAP-ticker clock for Lenis and ScrollTrigger. Nothing else calls `requestAnimationFrame`.
- `src/components/landing/LandingTour.tsx` + `src/data/landingScenes.ts`: the scroll-driven photo tour.
- `/studio` is the editor route. `/studio/import` is the upload and review screen.
- Blueprint analysis (`analyseBlueprint`) must never run on the main thread. The browser runs it in `src/workers/analyse.worker.ts`; only decoding the image and drawing the results happen on the page.
- Atrium v1 (for porting viewer controls) is cloned at `../Atrium`. Read from it, never modify it.

## Design tokens (use these, never hard-code colours)
`limestone` page ground, `vellum` panels, `stone` hairlines, `iron` text and lines, `smoke` secondary text, `gilt` the single accent, `cyanotype` blueprint ink and editor chrome. Fonts: `font-display` (Marcellus, headlines only) and `font-sans` (Figtree). Sentence case, no all-caps labels, no decorative numbering.

## How to work
1. Plan the whole change first and tell me the plan in a few lines before writing code.
2. Write whole files. Prefer rewriting a file completely over patching fragments of it.
3. Put a comment at the top of every file saying what it does and what it connects to, and inline comments beside non-obvious code.
4. One prompt = one commit. Don't commit yourself; I will run the commit command.
5. Before saying you're done, run `npx tsc --noEmit` and `npm run build` and fix every error.
6. Units: metres internally everywhere; convert only at display time.
7. Respect `prefers-reduced-motion`, keep keyboard focus visible, and keep the UI usable at 390px wide.

## Conventions
- `Opening.offset` is measured from a wall's `a` end to the opening's centre.
- Walls are split at T-junctions, so every joint is an endpoint of every wall touching it.
- Blueprint pixel rooms are `PixelRoom` (`src/types/blueprint.ts`); plan rooms are `Room` (`src/types/plan.ts`).
- The blueprint pipeline runs on the deskewed image. Coordinates from vectorize, scale and openings are in deskewed-pixel space, so the review screen must display the deskewed image, never the original.
- Pixel to plan: `buildPlan` maps deskewed pixels to metres as x = (px − origin.x) / pxPerM, y = (py − origin.y) / pxPerM, where origin is the top-left of the walls' bounding box. No flip: plan y points south, the same way image y points down.
- OCR reads the deskewed but UNFILLED image; the hollow-wall fill also fills some letter strokes. In hollow mode, windows drawn as lines inside walls are filled as wall, so their openings are not detected.

## Editing (step 4.3, Select)
- Walls are selected in both views but edited only in 2D: clicking a wall mesh in 3D selects it, and **dragging in 3D is not implemented**. The 3D scene tints the selection and nothing more.
- Clicking a piece selects THAT piece and the panel edits it, but the whole run is outlined in a lighter gilt in 2D and tinted lighter in 3D, because a body drag from any piece moves the run. Delete removes only the selected piece. `useSelectedRun()` (`src/store/selectionStore.ts`) is the one place that derives it.
- Selection lives in `src/store/selectionStore.ts`, not in the plan, so it is never undoable. It clears itself when the selected wall leaves the plan.
- The drag maths is pure, in `src/lib/plan/edit.ts`; components only turn pointers into metres and call the store. A drag is one undo step because every pointer move re-applies the whole drag after `planStore.rollback()`.

## Drawing walls (step 4.4, Wall tool)
- The active tool lives in `src/store/toolStore.ts` (`select` | `wall`), not in the plan, so switching is never undoable. Choosing Wall clears the selection; choosing it while only 3D shows opens Split (2D on a phone), because drawing happens only in the 2D plan.
- Click (or tap) to start, click again to add a wall; each click after that adds a joined wall. The chain ends on Escape, double-click, the Finish button (for touch), or by itself when a click lands on a wall already in the plan (closing a room). A second Escape with nothing being drawn goes back to Select. A drag still pans. Implemented but not covered by any test: Enter with nothing typed also ends the chain, and lifting fingers after a pinch is not read as a tap.
- With a wall started, typing a length (3.5, 350 cm, 11' 6", read by `parseTypedLength`) and pressing Enter adds a wall exactly that long towards the pointer. Needs a mouse: on touch there is no pointer direction.
- Where a click lands is `snapDraw` (`src/lib/plan/edit.ts`): `snapPoint`'s order (endpoint, midpoint, 45°/90° ray, 5 cm grid) with one step after midpoint, **on wall**. A pointer within snap reach of a wall's body lands exactly on its centre line; if a 45°/90° ray also crosses that wall in reach, the crossing is used. Landing within 0.2 m of a wall's end takes the end itself. Joint and wall landings keep exact coordinates so they stay shared; free landings are on the grid or a ray; Alt turns snapping off and rounds to 1 cm.
- `planStore.drawWall(a, b, size)` is the only way a drawn wall enters the plan: one transaction, so one undo step. An end that lands on a wall's middle (`hostAt`) splits that wall there first (`splitWall` / `splitWallAt`): the first piece keeps the old id, the second is new, and openings past the split move to it at the same place. The result is an ordinary `Wall`; rooms re-derive through the normal wall-edit path.
- `drawProblem` refuses, with a message, a wall under 0.2 m, a wall that crosses or runs along an existing wall, and a T-junction inside a door or window or within 0.2 m of a wall's end. A refused or cancelled wall records nothing; the preview (outline, snap marker, guide line, live length) is local to PlanCanvas.
- New walls are 0.15 m thick (`DRAW_THICKNESS`) and take the plan's commonest wall height (2.7 m in an empty plan). Change either in the panel afterwards.
- When a chain ends, the panel lists anything it left unjoined (a free end is a validator problem), the same as after a drag.

## Doors and windows (step 4.5)
- **Swing side is data.** `Opening.swing` is `"left" | "right"`, the side of the wall a door's leaf opens to, looking from the wall's `a` end to its `b` end. The hinge is always the gap end nearer `a`. Doors must have it and windows must not; `validatePlan` reports either mistake. `doorSwing` (`src/lib/plan2d/openings.ts`) and the 3D leaf in `PlanModel` both read it.
- **Migration rule:** a door with no valid side gets `LEGACY_SWING = "left"` (`src/data/samplePlan.ts`), the side the 2D plan always drew. `withSwingSides` (`src/lib/plan/edit.ts`) applies it in `planStore.loadPlan` and to the initial plan, `buildPlan` stamps it on imported doors, and the sample's doors carry it explicitly. Existing plans look the same in 2D. In 3D the leaf used to stand open towards the right, disagreeing with 2D; it now follows the stored side, so migrated doors' 3D leaves turn the other way than before this step.
- **Flip** (`planStore.flipDoor`, the panel's Flip swing button or its Left/Right control) reverses only the side: wall, width, offset, height and sill stay. One undo step. It does nothing to a window.
- **Placing:** the Door and Window tools work in the 2D plan only, not in 3D. The pointer picks the nearest wall whose band (half its thickness plus 8 px) holds it. `snapOpening` projects onto that wall's centre line and snaps the centre to the wall's midpoint within snap reach, else to 0.05 m along the wall. The preview shows the opening and its width; a click or tap places a default door (0.9 × 2.1 m) or window (1.2 × 1.2 m on a 0.9 m sill) with `planStore.placeOpening`, one undo step. Escape goes back to Select.
- **Constraints** (`placeOpening`, `openingProblem`): an opening must sit inside its wall's **usable span**. Each end of the wall loses half the thickness of the thickest non-collinear wall joined there (more at a slanted joint, at most 4 half-thicknesses). A collinear neighbour and a free end take nothing. A centre outside the span (on or past a wall end, or in a corner) is refused with a reason; a centre inside it slides just far enough to fit. A wall too short for it, or an overlap with an opening already there, is refused. Widths are 0.3–4 m; a door is at least 1.8 m tall; a window at least 0.3 m; sill + height never goes above the wall.
- **Selecting:** every Select-tool press and hover goes through `pickTarget` (`src/lib/plan/edit.ts`), which picks in this order:
  1. A wall end handle.
  2. A door or window. Its stretch of wall band counts (half the wall's thickness plus the pick tolerance across, only 1 cm past the gap's ends). So does a door's swing quarter-circle, grown by the pick tolerance on every side so the drawn leaf and arc are clickable from either side. The tolerance is 8 px for mouse and 12 px for touch.
  3. A wall body.
  4. Nothing, which clears the selection.

  The swing loses only to a press physically on a wall (within half its thickness), never to one merely within a wall's pick tolerance; at low zoom that tolerance covers the drawn leaf. Picking is geometry on the pointer's plan coordinates, handled on the `<svg>` root, so SVG stacking and `pointer-events` never decide a hit.

  Selection state: `selectionStore.selectedId` is the selected wall and `openingId` the selected opening. Choosing one clears the other, and empty space or Escape clears both. Neither is in the plan or its history. The selected opening is outlined in cyanotype with its symbol redrawn in cyanotype (a door's leaf and arc, a window's three lines); a selected wall is gilt. Its 3D frame is tinted gilt, and `OpeningPanel` replaces the Summary.
- **Editing** (`OpeningPanel`): type, the wall it sits on, width, height, sill (windows only; doors start at the floor), the centre's distance from the wall's start, and for doors the swing side and Flip; Delete removes only the opening and leaves its wall. Typed values go through `resizeOpening` (keeps the centre if it fits, else shifts, else clamps to the free stretch between neighbours and span ends), `slideOpening` and `openingSize`, are rounded to 1 cm, and land with one `updateOpening`, so each is one undo step; a clamp says why. Dragging a selected opening slides it along its wall, in 0.05 m steps (Alt: free), stopping at its neighbours and the span ends, and rounds to 1 cm on release: one undo step. The Delete key deletes the selected opening.
- **Wall edits and splits:** wall edits still clamp openings with `clampOpening`, so a moved or resized wall never leaves an opening outside it, and the swing side is untouched. A 4.4 split (`splitWallAt`) keeps openings before the split on the first piece (the old id) and moves openings past it to the new piece at the same place. An opening is never duplicated, dropped or detached, and a split through one is refused. Rooms come from walls only, so openings never change them.

## Measure and autosave (step 4.6)
- The temporary Measure overlay lives in `src/store/toolStore.ts` beside the active tool (`select` | `wall` | `door` | `window` | `measure`), never in the plan, so they are not undoable and not saved. A measurement is two points in plan metres, so the 2D camera draws it correctly at any zoom. Pure maths: `src/lib/plan2d/measure.ts`. In Measure mode walls are not picked, hovered or dragged, dragging empty space still pans, and Escape (or the Clear button, for touch) cancels. Entering or leaving the tool clears it; choosing Measure from 3D opens the 2D plan like the other tools. In Measure mode the press is handled before `pickTarget`, so no wall or opening is picked, hovered or dragged. Measure points snap to wall ends and midpoints only, never to a grid, so the value is the real distance.
- Autosave stores ONLY the `Plan`, as `{ schema, savedAt, plan }` under one localStorage key (`src/lib/persist/planStorage.ts`). `src/store/persistence.ts` restores it once per page load, before the editor mounts, and writes after an 800 ms quiet time (at most 5 s apart). Anything corrupt, from another schema or the wrong shape is ignored and the sample plan stays. To change the stored shape, bump `SCHEMA_VERSION` and add a case to `migrate`. Restoring goes through `loadPlan`, which keeps stored room names by matching loops and label points; undo history is never saved or restored.

## Known limitations
- The hollow fill cannot tell a wall whose gap is outside the accepted range from furniture drawn as long parallel lines. Both are just two long lines with white between them.
- Walls whose gap is more than 3x the commonest gap are missed. On a plan with lots of narrow line pairs (window lines, shelving), the commonest gap can be narrower than the real walls, and then real walls are skipped.
- Room-size labels give no scale for open-plan rooms, rooms bounded mostly by windows, or rooms whose edges are single thin lines. The label is measured against the walls around it, and those rooms don't have enough wall to measure against.
- OCR sometimes splits a size label into fragments, and then the size is not read.
- When no scale can be worked out, the fallback is the user clicking a wall and typing its length.
- `OpeningCandidate.widthPx` is the clear gap between the wall ends as drawn, in deskewed pixels. A wall end next to a T-joint can be snapped into the joint, which makes that opening up to about one wall thickness too wide.
- Gap pairing has no maximum width, so two collinear free ends across a room can pair into a fake door (06 has a 481 px one). `buildPlan` (`src/lib/blueprint/toPlan.ts`) classifies each gap by real width once the scale is known: up to 2.4 m is a normal opening; over 2.4 m up to 4 m is a wide opening, kept and listed in `report.wideOpenings` (a wide passage stays a door, because the Plan has only door and window kinds); over 4 m is not bridged, its two wall ends stay free, and it is listed in `report.droppedPairs`.
- A body drag moves the whole **wall run**: `wallRun` (`src/lib/plan/edit.ts`) finds every piece one straight wall was split into at its T-junctions (collinear within 1°, sharing a joint within 1 cm; a stem at the joint neither joins the run nor breaks it), and `dragWallBody` slides all of them by the same perpendicular offset, so no piece tilts. Dragging a joint **handle** still moves only the walls joined at that joint, so a collinear neighbour tilts — that is what moving a vertex means, and it is expected.
- A joint shared by more than two non-parallel walls can only keep one of them pointing the same way during a body drag. `dragWallBody` keeps the least parallel one (its line crosses at the steepest angle) and the rest follow the joint, so their directions change.
- A wall body drag checks the 0.2 m minimum at 64 points along the slide, so a joining wall that dips below the minimum and comes back inside one 64th of a drag step is not caught.
- Drawing never splits the NEW wall. A wall that would cross an existing wall is refused (tested); so, by the same check, is one passing through an existing joint or touching an existing free end with its middle (not separately tested). Draw up to the meeting point and carry on from there.
- Drawing checks centre lines only: a wall drawn parallel to an existing one and closer than their thicknesses is allowed, and the two overlap visually.
- A T-junction on a diagonal wall keeps the landing exactly on the wall's line, so its coordinates are not on the 1 cm grid.
- The hinge end of a door is fixed at the gap end nearer the wall's `a`: Flip changes the side it opens to, not which jamb it hangs on.
- In 3D a door leaf stands only about 17° open, so at the default camera Flip is a small change on screen; the e2e checks the leaf's real rotation in the scene graph instead.
- A wall edit keeps each opening inside its wall (`clampOpening`), but not inside its usable span, and it can push two openings on a shortened wall into overlap. That is reported as a warning (the validator's overlap check), not prevented. Not covered by an e2e.
- Openings imported by `buildPlan` can be up to about one wall thickness too wide and can reach into a corner past the usable span. They are kept as imported; the first move or resize clamps them into it.
- Openings are not placed, dragged or selected from the 3D view. A 3D click on a door or window has not been tested.
- At low zoom (the phone with its sheet open, about 15 px/m) the 20 px touch end-handle reach covers about 1.3 m, so a tap on a short stretch of wall near a corner grabs the corner's handle rather than the wall body. This is 4.3 behaviour, unchanged; zoom in to pick that stretch.
- The swing of a door near a corner can reach over the joining wall. A press physically on that wall still picks the wall; a press just beside it, inside the swing, picks the door.
- The arrow keys nudge a selected wall but not a selected opening; drag it or type its position.
- Door versus window is a guess from the pixels: a double door drawn in thin lines can read as a window, and grey outlines on wall faces can read as doors. The review screen lets the user change the kind.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
