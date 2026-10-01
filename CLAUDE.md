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
- Door versus window is a guess from the pixels: a double door drawn in thin lines can read as a window, and grey outlines on wall faces can read as doors. The review screen lets the user change the kind.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
