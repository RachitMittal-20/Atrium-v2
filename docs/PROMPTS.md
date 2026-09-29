# Atrium v2 — Claude Code prompt list

**How to use:** run each prompt in order in Claude Code, from the repo root. After each one: check it in the browser (`npm run dev`), then run its commit command. If a prompt's result is wrong, fix it in the same session *before* committing, so every commit works on its own.

**One-time setup (before Phase 2):**
```bash
cd ..  && git clone https://github.com/RachitMittal-20/Atrium.git && cd atrium-v2   # v1 for reference, read-only
mkdir -p docs && cp /path/to/CLAUDE.md . && cp /path/to/PROMPTS.md docs/
git add CLAUDE.md docs/PROMPTS.md && git commit -m "docs: add Claude Code context and prompt list"
```

---

## Phase 2 — The Plan data model

**2.1 Plan types**
> Read CLAUDE.md. Create `src/types/plan.ts` defining the editable building model: `Vec2`, `Wall` (id, a, b, thickness, height), `Opening` (id, wallId, kind door|window, offset along wall in metres, width, height, sillHeight), `Room` (id, name, wall loop ids, floorMaterial — rooms are derived, but names/materials are stored), `Item` (id, catalogId, position Vec3, rotationY, scale, colorOverrides), `Plan` (id, name, units "m", walls, openings, rooms, items, meta). Add `DesignOption` (id, name, plan snapshot). Include a small hand-made sample plan (a 2-bedroom house, ~12 walls, 4 doors, 5 windows) in `src/data/samplePlan.ts`.
```bash
git add -A && git commit -m "feat(plan): add editable Plan types and a sample two-bedroom plan"
```

**2.2 Plan store with undo/redo**
> Create `src/store/planStore.ts` with Zustand + Immer. Actions: loadPlan, addWall, updateWall, deleteWall (also removes its openings), moveWallEndpoint (moves every wall joined at that point, joints within 1 cm count as joined), addOpening, updateOpening, deleteOpening, addItem, updateItem, deleteItem, renameRoom, setRoomMaterial. Implement undo/redo with Immer patches (history capped at 100), plus a `transaction()` helper so a drag counts as one undo step. Add Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z using `src/lib/keyboard.ts`'s `isTypingTarget`.
```bash
git add -A && git commit -m "feat(plan): add plan store with patch-based undo/redo and joined wall endpoints"
```

**2.3 Geometry helpers**
> Create `src/lib/plan/geometry.ts`: wall length, direction, normal, wall outline polygon with mitred corners where walls join, point-to-wall distance, snapping (endpoints, midpoints, 90°/45° angles, 5 cm grid), and opening position clamping so an opening never extends past its wall. Pure functions, no React. Add a tiny test script `scripts/test-geometry.ts` runnable with `npx tsx` covering joins and clamping.
```bash
git add -A && git commit -m "feat(plan): add wall geometry, mitred joins and snapping helpers"
```

**2.4 Room detection from walls**
> Create `src/lib/plan/rooms.ts` that derives rooms from the wall graph: find closed loops (minimal cycles of the planar graph), compute each room's polygon, area in m² and centroid, and keep stored names/materials matched to rooms by overlap when walls change. Expose `useDerivedRooms()` in the plan store (memoised on walls).
```bash
git add -A && git commit -m "feat(plan): derive rooms, areas and centroids from closed wall loops"
```

**2.5 Plan to 3D**
> Create `src/components/three/PlanModel.tsx` that renders a Plan: walls as extruded outlines with openings cut out (door holes to the floor, window holes with sill height), simple door and window frames, room floors coloured by material, and a flat ceiling toggle. Everything regenerates from the store. Show it at `/studio` with the sample plan, a basic OrbitControls camera and soft daylight. Keep geometry memoised per wall so editing one wall rebuilds only that wall.
```bash
git add -A && git commit -m "feat(studio): render the Plan as 3D walls with cut openings and floors"
```

---

## Phase 3 — Blueprint to Plan

**3.1 Mask to wall segments**
> Create `src/lib/blueprint/vectorize.ts`. Input: the `WallMask` from `wallMask.ts`. Output: wall centre-line segments with thickness. Approach: decompose the mask into axis-aligned runs, merge collinear runs, derive centre lines and thickness from run width, then snap endpoints within 1.5× wall thickness into shared joints and drop segments shorter than 2× thickness. Diagonal walls can be skipped for now; list that as a known limitation in a comment.
```bash
git add -A && git commit -m "feat(blueprint): convert the wall mask into snapped centre-line wall segments"
```

**3.2 Scale calibration**
> Create `src/lib/blueprint/scale.ts`. Use `ocr.ts` to find dimension text (e.g. 12'6", 3.8 m, 3800), match each to the nearest parallel wall segment, and compute pixels-per-metre as the median of the agreeing matches. If nothing is readable, return null so the UI can ask the user to click one wall and type its length.
```bash
git add -A && git commit -m "feat(blueprint): calibrate plan scale from OCR dimensions with a manual fallback"
```

**3.3 Doors and windows**
> Create `src/lib/blueprint/openings.ts`: detect gaps in walls between collinear segments; gaps of 0.6–1.2 m become doors, and thin/hatched spans inside walls become windows. Return them as `Opening`s referencing the vectorized walls.
```bash
git add -A && git commit -m "feat(blueprint): detect door and window openings from wall gaps"
```

**3.4 Blueprint to Plan**
> Create `src/lib/blueprint/toPlan.ts` that runs the full pipeline (pixels → mask → segments → scale → openings → OCR room names) and returns a `Plan` in metres. Default wall height 3 m, exterior thickness from the mask, interior walls thinner. Keep every step's intermediate result for the review screen.
```bash
git add -A && git commit -m "feat(blueprint): assemble the full blueprint-to-Plan pipeline"
```

**3.5 Review screen**
> At `/studio/import`, build the upload and review flow: drop an image or PDF page, show progress per stage, then show detected walls, openings and room names drawn over the original image. Let the user delete a wall, drag endpoints, fix scale by clicking a wall and typing its length, and rename rooms. "Build model" loads the Plan into the store and opens `/studio`. Errors from `BlueprintError` show as plain instructions.
```bash
git add -A && git commit -m "feat(blueprint): add upload and review screen before building the model"
```

---

## Phase 4 — The editor

**4.1 Studio layout**
> Rebuild `/studio` as the editor: top bar (project name, undo/redo, view switch 2D | 3D | Split, export menu placeholder), left tool rail, right properties panel, and the canvas area. Split view shows 2D and 3D side by side editing the same store. Use the cyanotype editor chrome from CLAUDE.md.
```bash
git add -A && git commit -m "feat(studio): add editor layout with 2D, 3D and split views"
```

**4.2 2D plan canvas**
> Create `src/components/plan2d/PlanCanvas.tsx` (SVG) that draws walls as filled outlines, door swings, windows, room names with areas, and live dimensions on the selected wall. Pan with drag/space, zoom with wheel toward the cursor, fit-to-plan button.
```bash
git add -A && git commit -m "feat(plan2d): draw the plan as a pannable, zoomable 2D drawing"
```

**4.3 Select and edit walls**
> Add the Select tool: click a wall in 2D or 3D to select it (highlight in both). Drag the wall body to move it (joined walls stretch), drag endpoints to reshape, and edit length, thickness and height in the properties panel with exact numbers. Delete key removes it. Each drag is one undo step.
```bash
git add -A && git commit -m "feat(studio): select, drag and numerically edit walls in 2D and 3D"
```

**4.4 Draw walls**
> Add the Wall tool: click to start, click to add joined segments, Esc or double-click to finish. Show snapping guides and a live length label; typing a number while drawing sets the exact length.
```bash
git add -A && git commit -m "feat(studio): draw joined walls with snapping and typed lengths"
```

**4.5 Doors and windows**
> Add Door and Window tools: hover a wall to preview, click to place. Selected openings can be slid along the wall, resized, flipped (door swing) and deleted. Openings never overlap each other or wall ends.
```bash
git add -A && git commit -m "feat(studio): place, slide and resize doors and windows on walls"
```

**4.6 Measure and save**
> Add a Measure tool (two clicks, shows distance). Autosave the current Plan to IndexedDB every change (debounced), restore it on load, and add "Export project (.atrium.json)" / "Open project" for moving projects between devices.
```bash
git add -A && git commit -m "feat(studio): add measure tool and local autosave with project import/export"
```

---

## Phase 5 — Viewing modes

**5.1 Port camera controls from v1**
> Port `../Atrium/src/components/three/WalkthroughControls.tsx`, `PanoramaControls.tsx` and `SmoothZoom.tsx` into v2, replacing their `projectStore` dependency with a new small `src/store/viewStore.ts` (cameraMode: orbit | walk | panorama | top). Keep v1's behaviour where switching modes never resets the camera. Walkthrough collides with Plan walls (use wall outlines from geometry.ts, not mesh raycasts).
```bash
git add -A && git commit -m "feat(view): port walkthrough, panorama and smooth zoom controls from v1"
```

**5.2 Bird's-eye and mode switch**
> Add a top-down bird's-eye mode (orthographic-feeling high camera, animated in with GSAP) and a camera mode switch in the 3D view with keyboard shortcuts 1–4 and a controls help popover.
```bash
git add -A && git commit -m "feat(view): add bird's-eye mode and a camera mode switcher"
```

**5.3 Recenter**
> Add a Recenter button (and R key) visible in every mode: it animates the camera back to a home view framing the whole plan in orbit/top, and back to the entrance at eye height in walkthrough. Compute the home view from the plan's bounds so it works for any plan.
```bash
git add -A && git commit -m "feat(view): add recenter button that returns the camera to a home view"
```

---

## Phase 6 — Catalog, furniture and finishes

**6.1 Asset pipeline**
> Create `public/models/catalog/` and `scripts/optimize-assets.sh` using gltf-transform (draco + webp textures, max 1024px). Create `src/data/catalog.ts` listing items with id, name, category (lighting, chandeliers, furniture, appliances, decor, plants, paintings, outdoor, vehicles, pools), file path, real-world size in metres, licence and author. Add `CREDITS.md`. Start with ~25 CC0 items from Poly Haven, Kenney and Quaternius; tell me exactly which files to download.
```bash
git add -A && git commit -m "feat(catalog): add optimized CC0 asset pipeline and catalog index"
```

**6.2 Catalog panel and placement**
> Add a searchable catalog panel with category tabs and thumbnails. Drag an item into 3D or 2D to place it on the floor; items snap to walls when close. Selected items can be moved, rotated (15° steps with Shift), scaled within limits and deleted. Items render in 2D as outlined footprints.
```bash
git add -A && git commit -m "feat(catalog): place, move, rotate and delete furniture in 2D and 3D"
```

**6.3 Materials and colours**
> Add finishes: wall paint colour per wall side, floor material per room (wood, marble, tile, carpet using Poly Haven CC0 textures), and colour overrides on items' main material. Apply via the properties panel with a small swatch palette plus a colour picker.
```bash
git add -A && git commit -m "feat(finishes): paint walls, set floor materials and recolour items"
```

**6.4 Pools and outdoor**
> Add a site ground plane around the house and support pools: a pool item cuts a rectangular hole in the ground with water material and coping. Cars and outdoor items place on the ground plane.
```bash
git add -A && git commit -m "feat(site): add ground plane, pools and outdoor placement"
```

**6.5 Auto-furnish**
> Port the room-name-based furnishing rules from `../Atrium/src/lib/blueprint/furniture.ts` into an "Auto-furnish room" action that places catalog items by room type at real-world sizes, as normal editable Items.
```bash
git add -A && git commit -m "feat(catalog): auto-furnish rooms by type using v1's sizing rules"
```

---

## Phase 7 — Schedules and exports

**7.1 Live schedules**
> Add a Schedules panel: rooms (name, area, perimeter, floor material), doors and windows (size, count), wall areas per paint colour, flooring quantity per material, and item list. All derived live from the store.
```bash
git add -A && git commit -m "feat(schedules): add live room, opening, finish and item schedules"
```

**7.2 3D exports**
> Export the current model as GLB and OBJ from the 3D scene (use three's GLTFExporter and OBJExporter), with walls, floors and items named by their ids.
```bash
git add -A && git commit -m "feat(export): download the model as GLB and OBJ"
```

**7.3 PDF floor plan**
> Export a PDF floor plan with jsPDF drawn from Plan data (not a screenshot): walls, openings, room names and areas, overall and per-wall dimensions, north arrow, scale bar and title block, fitted to A3 landscape.
```bash
git add -A && git commit -m "feat(export): generate a dimensioned PDF floor plan from plan data"
```

**7.4 DXF and CSV**
> Export DXF (layers WALLS, OPENINGS, TEXT, DIMS) for AutoCAD users, and CSV files for each schedule.
```bash
git add -A && git commit -m "feat(export): add DXF drawing and CSV schedule exports"
```

**7.5 Import models**
> Allow importing GLB/glTF/OBJ/FBX as view-only site context or as a single catalog item (move, rotate, delete only). Show a clear note that imported models can't be wall-edited, and that .skp/.max files must be exported to glTF/OBJ/FBX first.
```bash
git add -A && git commit -m "feat(import): import GLB, OBJ and FBX models as context or items"
```

---

## Phase 8 — Landing 3D scenes

**8.1 Blueprint on a table**
> Create `src/components/landing/BlueprintScene.tsx` (R3F) placed before LandingTour on `/`: a cyanotype blueprint sheet on a table filling the screen. Scrolling (ScrollTrigger scrub, driven by SmoothScrollProvider) pulls the camera back and extrudes the drawn walls up into white 3D walls. Use a Plan in `src/data/landingPlan.ts` that matches the mansion's symmetrical layout, rendered with PlanModel.
```bash
git add -A && git commit -m "feat(landing): blueprint-on-a-table scene whose walls extrude on scroll"
```

**8.2 Construction site**
> Continue the scene: the extruded shell gains scaffolding, a crane and trucks (Kenney/Quaternius CC0 low-poly) that move on looped paths while scroll raises the building, then a crossfade to the mansion photo from the same high camera angle.
```bash
git add -A && git commit -m "feat(landing): construction-site scene that transitions into the mansion"
```

**8.3 Mansion depth and car**
> Generate a depth map for `public/images/01_mansion.jpg` (tell me how to make it free with Depth Anything on Hugging Face) and render the photo as a depth-parallax plane that shifts subtly with scroll and pointer. Add a small car driving the circular driveway to the door, synced to scroll. Move the hero headline into the sky area.
```bash
git add -A && git commit -m "feat(landing): depth-parallax mansion hero with a car arriving on the driveway"
```

**8.4 Landing polish**
> Add a preloader that waits for landing assets, lazy-load later photos, reduce the pinned tour on mobile to simple crossfades, and verify the full scroll from blueprint to "Upload a blueprint" on a 390px and a 1440px viewport.
```bash
git add -A && git commit -m "feat(landing): preloader, lazy loading and mobile tour"
```

---

## Phase 9 — Polish and launch the demo

**9.1 Design options**
> Add design options: duplicate the current plan as "Option B", switch between options, and a side-by-side compare view in 3D with synced cameras.
```bash
git add -A && git commit -m "feat(options): create, switch and compare design options"
```

**9.2 Performance**
> Profile the studio with a 40-wall plan and 60 items: instance repeated items, merge static wall geometry per room, cap pixel ratio at 1.5 on mobile, and keep 60 fps on a mid-range laptop. Report before/after numbers.
```bash
git add -A && git commit -m "perf(studio): instancing, geometry merging and adaptive pixel ratio"
```

**9.3 Accessibility and mobile**
> Audit the landing and studio at 390px: touch controls for orbit and walkthrough (virtual joystick), keyboard access for every tool, focus states, and reduced-motion fallbacks.
```bash
git add -A && git commit -m "fix(a11y): touch controls, keyboard access and reduced-motion fallbacks"
```

**9.4 Deploy and README**
> Prepare for Vercel: environment check, caching headers, 404 page, Open Graph image from the mansion photo. Rewrite README with features, screenshots, architecture (Plan as single source of truth), known limitations, credits, and AI usage.
```bash
git add -A && git commit -m "docs: final README, deployment setup and Open Graph image"
git push
```
