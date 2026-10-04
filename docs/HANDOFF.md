# Atrium 2.0 — Master Claude Code Handoff

This is the consolidated handoff for continuing Atrium 2.0. It combines the original Claude handoff, the completed implementation reports, the real browser failures we encountered, the fixes that were made, and the current Git/branch state.

## Priority change (2026-10-01): 3D editing first

Read this before sections 18-22, which still describe the old order.

- **3D editing and model import now come before 5.1b.** 5.1b as written in section 18 (the browser e2e that moves the real rendered camera, and the visual check of the ceilings from inside) waits. The walk controls themselves are already on `main` (`d80bc6e`); `scripts/e2e-studio.ts` has no walk test yet.
- **The 3D editing design is a SketchUp-style Push/Pull tool.** Choose the tool, hover a face and it highlights, press-drag-release or click-move-click moves that face along its normal, a live distance readout follows the pointer, typing a number and Enter sets the exact distance, Escape cancels. It replaces the earlier arrow-handle idea.
- **Faces, in three pieces:**
  - **4.7a (DONE):** the wall **top**. Pulling it changes the height of the whole straight wall (`wallRun`), or one piece with Alt. Every other face highlights and says "Not yet".
  - **4.7b (DONE):** door and window faces (sides, top, sill), plus a Move tool and selecting doors and windows in 3D.
  - **4.7c (DONE):** wall side faces (thickness with the opposite face fixed; Shift moves the wall), free wall ends, the Move tool on wall sides and corners, and hidden faces that are never targets.
- **4.7a is done** (not yet committed when this note was written). Checks, all passing: `npm test` (new `test-handles3d.ts` and `test-pushpull.ts` included), `npx tsc --noEmit`, `npm run build`, and `scripts/e2e-studio.ts` with the new "3D Push/Pull" block at 1440 (mouse) and 390 (real touch events); the production bundle contains neither dev hook (`grep -rlE "__studio3d|__pushPullDebug" .next/static` prints nothing). What it added: face roles on every wall triangle (`meshBuilders.ts`), the pure maths (`src/lib/handles3d/math.ts`, `src/lib/plan/pushpull.ts`), `src/store/pushPullStore.ts`, `PushPullTool.tsx`, `PushPullOverlay.tsx`, and the rail button (P).
- **4.7b is done** (not yet committed when this note was written; 2026-10-02). Checks, all passing on `main` + the 4.7b working tree: `npm test` (new `scripts/test-pushpull-openings.ts` included), `npx tsc --noEmit`, `npm run build`, the production bundle has neither dev hook (`grep -rlE "__studio3d|__pushPullDebug" .next/static` prints nothing), the full `scripts/e2e-studio.ts` (exit 0, every earlier section plus the new `checkOpenings3d` at 1440 mouse and 390 real touch), and a walk quick check (orbit camera restored to 0.000 mm, fov and near unchanged; the tool fell back to Select on entering walk). What it added: `edit.resizeOpeningEdge / resizeOpeningHead / resizeOpeningSill / moveOpening` (the opposite edge stays fixed; + makes the opening bigger), `src/lib/handles3d/edges.ts` (edge bands 14 / 44 px, `pickAlongRay`, the reveal quads), opening pulls and the `move` kind in `pushpull.ts` and `pushPullStore.ts`, the Move tool (key V; M is a unit letter in typed distances), both 3D tools disabled in 2D-only and while walking, and Select-tool picking of doors and windows in 3D (only real clicks select, so an orbit drag no longer selects a wall it ends on).
  - Covered by the e2e: hovering the south window's right jamb (it is **jambA**: w-EL runs east to west) with the blue edge found in real pixels, a 60 px drag (width grows by the label's value, the other side fixed to 1e-9, the frame mesh matches, the window becomes the selection), one Ctrl+Z, Escape mid-drag with history unchanged, typed 0.2 + Enter, the top pulled past the wall ("Wall is 2.70 m high" visible), the sill pulled down with the head fixed, a door's bottom ("A door stays on the floor", no pull), Move over a wall (refused, with the reason), Move sliding d-front about 80 px until it stops against win-living-n with the reason, a 3D click on a window selecting it in the panel and in Split's 2D pane, a 40 px orbit drag selecting nothing, and Walk disabling both tools. At 390 with real touch: the jamb drag, a Move, a Select tap, a touch orbit drag, Walk.
  - NOT covered by the e2e: Alt during an opening pull or a Move (covered in the store tests only), click-move-click on an opening face, typing at 390 through the 123 field for an opening (the 4.7a block covers the field on a wall top), Move's midpoint snap in the browser (store tests only), the gilt and lighter tints of a selected or hovered opening's frame (the test reads the selection, not the pixels), and a real phone.
  - One existing test changed: `test-pushpull.ts` looped over jamb, head and sill expecting "Not yet"; 4.7b wires those faces, so the loop now covers wall ends and sides only. Its 4.7a e2e block is unchanged and passes, which needed the edge-band rule refined: an edge beats faces of its own wall and faces behind it, but not a face of another wall in front of it.
- **4.7c is done** (not committed; 2026-10-03). Checks, all passing on `main` (`0916e54`) + the 4.7c working tree, against `npm run dev` on port 3000 from this checkout: `npm test` (20 suites, new `scripts/test-pushpull-walls.ts` included), `npx tsc --noEmit`, `npm run build`, `grep -rlE "__studio3d|__pushPullDebug" .next/static || echo clean` prints `clean`, the full `scripts/e2e-studio.ts` (exit 0: every earlier section plus the new `checkWalls3d` at 1440 mouse and 390 real touch) and the new `scripts/e2e-walk.ts` (exit 0). What it added: per-triangle `exposed` flags in `meshBuilders.ts` (jamb caps cut at the sill and head; ends at joints hidden; `pickableFaceAt`), `pushpull.pullWallSide / pullWallEnd / dragCorner / planCorners / roomChanges / faceExposed`, `edges.resolveCorner`, `math.rayPlanePoint`, `geometry.isFreeEnd`, Shift and corner drags in `pushPullStore.ts`, corners and exposure in `PushPullTool.tsx`, wall and corner labels and the corner marker in `PushPullOverlay.tsx`, and `corner` / `exposed` on `__pushPullDebug`. CLAUDE.md has the rules (section "Wall faces, wall moves and corners").
  - Covered by tests: the failing-first check (`updateWall` thickness alone moves both faces by d/2; `pullWallSide` keeps the far face within 1e-9 m); the bedroom partition +0.10 (Bedroom 1 exactly -0.10 × 3.85, Bedroom 2 unchanged), Shift (±0.385), the north run thickened +0.10 (both pieces, outer face fixed), the 0.05 / 0.6 m limits (also set by another piece), the 0.2 m length stop, openings re-clamped, room names kept, a free end (longer, shorter, the 0.2 m stop, a window kept in place when the a end moves), corner drag = `dragEndpoint` to the same snapped point, one undo, Escape, typed = dragged, `resolveCorner`, `rayPlanePoint`, shortcuts unique; exposure: the north wall's split and corners expose no end, T stems' ends hidden, a free end exposed, every opening's jamb/head/sill exposed over exactly its reveal. In the browser (`checkWalls3d`): the south wall's outer face pulled 40 px (thickness = the label's value, inner face fixed in the store and in the mesh's box), Ctrl+Z / Undo, Escape / a second finger, Shift-drag of the partition (1440: the panel's bedroom areas move in opposite directions), Move sliding the three-piece south wall (thickness unchanged, the west wall stretches), Move dragging the SE corner (both walls follow, the snap marker and lengths shown, one undo), the hidden seam at L (hovers the side with Push/Pull, the corner with Move, never an end), an orbit drag selects nothing, Walk disables both tools. `scripts/e2e-walk.ts`: W at 1440 and the joystick at 390 walk into a wall (min clearance 0.200 m, never under the 0.2 m radius), Escape / Exit restores the orbit camera within 0.000000 mm, the tool goes to Select and both 3D tools are disabled while walking.
  - NOT covered: typing a distance for a wall face or a free end in the browser (store tests only); a free end in the browser (the sample has none); Alt and click-move-click on wall faces in the browser; Shift at 390 (a phone has no Shift key); a corner's 45°/90° and endpoint snaps in the browser (store tests only); walls overlapping without a shared joint (their buried faces stay exposed); a real phone.
  - Existing assertions changed (each because 4.7c wires a face that used to refuse): `test-pushpull.ts` "Not yet" loop now checks the two hidden ends of w-AB refuse with `HIDDEN_END` (sides moved to the new suite), and its hand-made `WallFaceData` gained `exposed: [true]`; `test-pushpull-openings.ts` `faceBlock(sideLeft)` is now null (was `NOT_YET`), Move over a side is now null (was `MOVE_WALL`), Move over a top says `MOVE_TOP`, and its store check hovers a wall top instead of a side; `e2e-studio.ts` 4.7a: the side face's label says "Wall side" (was "Not yet"), and the "press on a face that is not wired" check now presses the front door's bottom; 4.7b: "Move over a wall" now hovers the wall top and expects "Pull the top with Push/Pull".
  - Behaviour found by the browser test and fixed: at phone scale the 44 px corner and edge bands covered most of the model, so a finger's extra reach (14–44 px) now goes to the nearer target and a finger on a wall face keeps it; the touch rings now prefer the face nearest the camera among pullable ones; the pointer label is held inside the pane at 390.
- **I.1a is done** (import 3D models in the browser, piece A of 2; not committed; 2026-10-03). Checks, all passing on `main` (`c1dd982`) + the I.1a working tree, against `npm run dev` on port 3000 from this checkout: `npm test` (22 suites, new `scripts/test-import.ts` and `scripts/test-import-store.ts` included), `npx tsc --noEmit`, `npm run build`, `grep -rlE "__studio3d|__pushPullDebug|__importDebug" .next/static || echo clean` prints `clean`, `scripts/e2e-studio.ts` (exit 0), `scripts/e2e-walk.ts` (exit 0) and the new `scripts/e2e-import3d.ts` (exit 0, 1440 mouse and 390 real touch). What it added: `Item.import` (`ImportInfo`) checked strictly by `planStorage` (old plans load unchanged, no schema bump); `planStore.addImportedItem / setNodeOverride`; `selectionStore.itemId`; `src/lib/import/{assetStore,loadModel,model,assetCache}.ts`; `src/store/importStore.ts`; `ImportedItems.tsx` (3D), `ImportModelDialog.tsx`, `ItemPanel.tsx`; the TopBar Import menu; drop on the 3D pane; dashed footprints in `PlanCanvas`; Push/Pull and Move ignore models; `scripts/make-import-fixtures.ts` (writes `tests/fixtures/models/`). CLAUDE.md has the rules (section "Imported 3D models").
  - Covered by tests: detection by extension and bytes (GLB, glTF, OBJ, ASCII and binary STL, DAE, FBX headers, 3DS chunk), plain messages for garbage and wrong extensions, the unit guess, a COLLADA unit overriding it, up axis and floor, node paths stable across parses, overrides only on clones, triangle counts and the 500k / 3M limits (also through `loadModel`), 50 MB, zip safety (`..`, absolute paths, `__MACOSX`, hidden files, a forged 300 MB header, a real 2 MB bomb against a 1 MB cap), companions by relative path and case-insensitive name, missing ones reported, web addresses never fetched, Draco and Meshopt refused; the store: old JSON unchanged, round-trip, no bytes in the autosave, add / update / hide / delete / restore / delete item each one undo step with redo, the asset kept for Undo, missing and broken assets. In the browser at 1440 and 390: the menu's file chooser is the real input; the dialog's guess and sizes, unit and up axis changing them, Escape cancels, focus inside; cube on the floor (1 mm); typed x / y / height move the 3D object; a 3D click selects it; Push/Pull and Move hover nothing, say so, and a drag changes neither plan nor history; the 2D footprint (named, dashed, 1.2 m) and a click on it selects; Walk passes through it; room.dae dropped as a real DataTransfer (cm and Z up pre-selected), hide / delete / Restore and three Undos one by one, then Redo; the zip's 4 px texture used; deleting the table returns the renderer to exactly its earlier geometry and texture counts; .skp / .max / .txt / 60 MB messages; reload keeps both models and the hidden part; IndexedDB deleted, then reload: grey "Missing file" boxes, the panel message, no crash, no console errors.
  - NOT covered: FBX and 3DS success paths (no real files yet; only their refusals), big real-world files, a real phone, Safari and Firefox, OBJ textures loading under Node (only in the browser via the zip), shadows over / under 200k triangles, the object list's 400-row cap, "Place on the floor" off and "Show both sides" in the browser.
  - Found and fixed on the way: three's TDSLoader loops forever on a chunk of size 0 (now refused by `tdsChunksSound` before parsing); a `..` zip entry was being dropped silently as a hidden file instead of warned about; hidden model parts still caught clicks (three's raycaster ignores `visible`).
  - The `guessUnit` rule as specified (first of m, cm, mm, in, ft within 0.2–60 m) gives cm for a 3200-unit and a 126-unit model, not mm and in; the tests assert the rule, and the dialog shows every option's size.
  - One existing test line changed: `e2e-studio.ts` now opens the Import menu before following `import-link` (the link moved into the menu).
- **I.1b is done** (imported models, piece B of 3: the unit rule, Move / Rotate / Scale on models and their parts, Show in view, the selection outline, a real-file report script; not committed; 2026-10-04). The materials list moved to piece C. Preconditions checked first on the clean `main` (`ed3d641`): `npm test` and all three browser suites passed. Checks, all passing on `main` + the I.1b working tree, against `npm run dev` on port 3000 from this checkout (`lsof -i :3000`, cwd `/Users/rachitmittal20/Atrium-v2`, `next dev`): `npm test` (23 suites, new `scripts/test-import-transform.ts`), `npx tsc --noEmit`, `npm run build`, `grep -rlE "__studio3d|__pushPullDebug|__importDebug" .next/static || echo clean` prints `clean`, `scripts/e2e-studio.ts` (exit 0), `scripts/e2e-walk.ts` (exit 0), `scripts/e2e-import3d.ts` (exit 0, 1440 mouse and 390 real touch, piece A's checks plus the new `checkTools`). What it added: `model.guessUnit` (nearest 3 m on a log scale, `ambiguous`), `src/lib/import/transform.ts`, `model.partBox / applyPartTransforms / pickPart / frameMatrix` and transforms in `applyOverrides`, `NodeOverride.transform` (checked strictly by `planStorage`; no schema bump), `planStore.setNodeTransform`, `math.frameBox`, `selectionStore.editParts / partPath`, `viewStore.frame`, `src/store/itemToolStore.ts`, `ItemTool.tsx`, `ItemToolOverlay.tsx`, Rotate (Q) and Scale (Z) in the rail and `toolStore`, Move's model arbitration in `PushPullTool`, the outline, Show in view and part tints in `ImportedItems`, the figure / plan size / ambiguous line in the dialog, Show in view / Edit parts / part rows in `ItemPanel`, `test-models/` in `.gitignore`. CLAUDE.md has the rules (section "Imported models: move, rotate, scale, parts").
  - Covered by tests: the four rules with exact numbers, clamps and reasons, the rotation sign pinned to the panel field and three's rotateY, typed degrees and percentages; part transforms on a nested model with a turned, unevenly scaled parent in a cm / Z-up frame (the box moves by exactly the offset, turns and scales about its pivot, children follow, siblings stay, a transformed parent carries the part and turns it about the parent's pivot, re-applying undoes the earlier transform, hidden and deleted rules, Restore exact, the original untouched); `pickPart` (highest named, Alt, wrappers, tags after a deletion); `frameBox` at 1440×900 and 390×844 (inside the frustum with 15% spare, same direction, above ground, a camera from below raised); the unit rule (3200 → mm, 320 → cm, 126 → in, 3.2 → m, COLLADA overrides, 3000 → mm and ambiguous); the store (each edit one undo step with redo, rollback with history unchanged, typed = dragged for degrees and percent, Alt re-snaps, a part dragged in the model frame under a turned and scaled item, Reset part, flags never drop a transform); persistence (I.1a overrides load unchanged, transforms round-trip, malformed ones refused, no bytes). In the browser at 1440 and 390: the 3000-unit dialog (mm, the message, the plan size, the figure flag); Show in view from out of view (corners inside the pane, 8 px margin, camera above ground); the outline's pixels (1440: mean difference 25.0 per channel over the cube's crop, threshold 4; this measures outline AND tint together); Move hover, drag, label = box movement (mouse), 5 cm grid, one undo; Shift (1440) and the Lift toggle (390) raise it; Escape / a second finger roll back; Rotate drag in 15° steps, typed 30 (keys at 1440, the field at 390); Scale typed 150 (box ×1.5 within 1 mm, base fixed) and a drag; room.dae Edit parts: a click selects the Table and its row, Move / typed 30° / typed 150% change only the Table (Sofa, Lamp, cube within 1 mm), Undo, reload keeps the transform; Walk disables the three tools.
  - Screenshots (`/tmp/studio/`): `import-move-mid-drag-1440.png` (the cube, framed large and light blue as the Move target, the label "+0.15 m, +0.00 m / At x 2.15 m, y 2.00 m / On the floor", the Floor | Lift toggle and the status; the cube fills most of the pane and its far corners are cut by the pane edges, because Show in view framed it just before); `import-rotate-mid-drag-1440.png` (the cube outlined in gilt with its hidden back edges showing through, which is how an on-top outline looks, label "-45° / Rotation -45°", the status with the "Turn by (°)" field); `import-part-selected-1440.png` (the room lifted 3 m with the Table tinted and outlined, Sofa and Lamp plain, the cube grey behind, the panel's "Part: Table" rows and the active row); `import-scale-mid-drag-390.png` (the cube at 173% fills the whole phone pane, so only its faces and outline show, label "Scale 173% / Size 2.08 × 1.38 × 1.3 m", the tool bar with all nine tools); `import-dialog-ambiguous-1440.png` (the dialog with the figure beside a 3 m slab; the hand-made STL has zero normals, so the slab renders black; the dialog's lower part needs scrolling).
  - NOT covered: FBX and 3DS success paths (until real files go through the report script); a real phone, Safari and Firefox; Alt-click picking a deep part in the browser (unit tests only); dragging a part inside a parent that has its own part transform (a known limit: it ignores the parent's transform); the outline pixel check at 390; the automatic frame right after an import (only the button is checked); the typed part rows in the panel (store tests cover `setNodeTransform`); big real-world files.
  - Existing test lines changed: `test-import.ts` (3200 → mm, 126 → in, the 120 cm OBJ table → in and ambiguous); `e2e-import3d.ts` (Push/Pull's message; the "ignore it" loop covers Push/Pull only, as Move now moves models; table.zip expects inches and the ambiguous message, then picks centimetres; Escape before the GPU-count baseline so the selected room's outline lines are not counted). No other existing assertion changed; `test-import-store.ts` only gained assertions.
  - Found and fixed on the way: the label had no pointer position in Move (ItemTool returned before recording it); at 390, closing the details sheet after Show in view made the pane taller and narrower and cut the framed model, so the framed box now stays framed across pane resizes until the user orbits; the phone tool bar wrapped labels mid-word with nine tools (gaps removed, only "Push/Pull" may break after the slash).
  - **On-demand tool (not a pre-commit check):** `npx tsx scripts/import-report.ts` with `npm run dev` running and real files in `test-models/` (git-ignored). One row per file (format, MB, triangles, objects, parse ms, ms per MB, chosen unit, ambiguous, warnings), screenshots and object lists in `/tmp/import-report/`, a 30 s watchdog with a 2 s heartbeat. A synchronous freeze cannot be interrupted, only noticed.
- **Things 4.7b and 4.7c must know:**
  - `planStore.updateWall` re-clamps openings only when a wall's length changes. The tool shortens or lowers openings itself, inside its own transaction, by the rules of `edit.openingSize`. A new face that changes an opening or a wall's geometry must do the same.
  - The pixel fallback and the ray method differ by 1 / cos ψ near the 8° switch (about 7x), so the method is fixed when a face is grabbed. Do not switch mid-pull.
  - The roles are `top, endA, endB, sideLeft, sideRight, jambA, jambB, head, sill`. Hidden inside caps are named by the way they face. Face roles are the only thing a tool should use to decide what was hit.
  - Starting an edit drops redo steps, so Escape mid-pull leaves the history length unchanged but the redo stack empty (as with a 2D drag).
  - Not tested on a real phone. A second finger cancels a pull, but the two-finger orbit that follows starts only on the next touch.

## 1. Product

Atrium 2.0 is a new web-based architecture/interior-design tool. Core flow: upload 2D blueprint → detect walls/openings/OCR → convert to one editable Plan → edit in 2D/3D → later add walkthrough, bird's-eye, recenter, catalog/furniture/materials, design options, collaboration/review and exports.

The central rule is non-negotiable: the editable `Plan` is the source of truth. 2D, 3D, rooms, quantities, schedules and exports derive from it. Do not bake a one-off mesh and then try to edit the mesh.

V1 is read-only reference material. Never modify V1.

## 2. Stack / architecture

Next.js + React + TypeScript + Tailwind + React Three Fiber/drei + Zustand/Immer. Tesseract.js is used for OCR. Later: jsPDF, DXF writer, gltf-transform.

Important V2 areas:
- `src/types/plan.ts` editable data model
- `src/store/planStore.ts` Plan + undo/redo
- `src/store/selectionStore.ts` selection only, never undoable
- `src/store/toolStore.ts` current editor tool only
- `src/lib/plan/geometry.ts` pure geometry
- `src/lib/plan/edit.ts` pure edit/picking/drag rules
- `src/lib/plan/rooms.ts` derived rooms
- `src/lib/plan2d/*` 2D view/opening/measure math
- `src/components/plan2d/PlanCanvas.tsx` 2D editor
- `src/components/studio/*` editor shell/panels/tools
- `src/components/three/*` 3D Plan rendering
- `src/lib/blueprint/*` blueprint pipeline
- `src/lib/persist/*`, `src/store/persistence.ts` local persistence
- `scripts/test-*.ts` unit/integration tests
- `scripts/e2e-studio.ts` browser regression suite

## 3. Data model

`Plan` contains walls, openings, rooms, items, meta.

Wall: `id, a, b, thickness, height`.

Opening: `id, wallId, kind (door|window), offset, width, height, sillHeight`, and for doors `swing: left|right`.

Room: stored `id, name, wallIds, floorMaterial`; geometry such as polygon, area, perimeter and labelPoint is derived.

## 4. Conventions

- Plan is the source of truth.
- Never modify V1.
- Do not change blueprint detection/OCR/scale code during editor-only work unless explicitly requested.
- Keep geometry rules pure and testable.
- Real browser tests must use actual UI clicks/touch, not direct store mutation.
- Selection and Measure state are not Plan history.
- Autosave stores Plan only; never selection, tool, measurement, camera or history.
- One editor transaction = one undo step where specified.
- Escape cancels an edit without creating history.
- If something cannot be implemented honestly, document it as a known limitation instead of faking it.
- Read `CLAUDE.md` first; plan first; run tests/typecheck/build/e2e before completion.
- Do not commit unless explicitly told to commit.
- Do not rewrite huge working files when targeted edits are safer.
- If the same issue fails twice, escalate one model/effort level.

Visual language: cyanotype/blue chrome, vellum panels, limestone canvas, iron outlines, gilt accent, Marcellus/display font for project name. 2D uses plan x→screen right, plan y→screen DOWN; no flip.

## 5. Blueprint pipeline — complete enough for editor work

Phase 3 built a pipeline from image pixels to an editable Plan.

- vectorize wall masks into centerline wall segments
- deskew before masking
- hollow-wall mode for suitable plans
- scale from printed dimensions where possible
- detect doors/windows from gaps
- bridge detected opening gaps into wall + opening data
- OCR room names/dimensions
- derive rooms from closed wall loops
- `analyseBlueprint` wrapper exists

Clean fixtures 01–04: 13 walls, 4 doors, 4 windows, 4 rooms, no validator problems. Total wall length 54.00 m. 03 can give ~99.9 px/m. 04 is deskewed ~2.2°.

Known blueprint limitations:
- complex/diagonal-heavy plans are weaker than clean orthogonal plans
- OCR may lose decimal points or misread room names
- door vs window is a pixel-based guess and must remain editable
- complex scans may contain false gap pairs/free ends
- some hollow plans have different window representations
- scale can be unavailable; review must support user intervention

Room derivation uses half-edge traversal and net floor area. `labelPoint` replaced centroid for name matching because concave rooms can have centroids outside the polygon. U-shaped-room test proves the fix.

Sample room areas used historically: Bedroom 1 14.8225 m², Bedroom 2 14.8225 m², Bathroom 8.1225 m², L-shaped living 36.9275 m²; total 74.695 m².

## 6. 4.1 — editor shell — COMPLETE

Sonnet 5.5 Medium.

Built: top bar, project rename, Undo/Redo, 3D/2D/Split switch, Import plan, Export menu, left tool rail, right Plan panel, room rename, m²/sq ft display, 390px mobile layout, View popover, keyboard focus.

At <=640px Split is hidden; tool rail becomes bottom bar; details sheet collapses; no horizontal overflow.

## 7. 4.2 — 2D plan — COMPLETE

Sonnet 5.5 Medium.

Implemented SVG 2D drawing: room fills, grid, mitred walls, opening gaps, door leaf/arc, window symbols, room names/areas, scale bar, zoom, pan, pinch code, Fit, +/-, keyboard controls.

Pure math in `src/lib/plan2d/view.ts` and `openings.ts`.

Tests cover round trips, zoom-under-cursor, fit, scale bar and horizontal/vertical opening geometry. Browser e2e covers 1440 and 390, live link, zoom/pan/Fit.

Historical limitation: pinch support existed before it was proven on a real phone.

## 8. 4.3 — wall selection/edit — COMPLETE

Opus 5.5 High.

Implemented selection/hover, endpoint handles, body drag, endpoint drag, snapping, numeric length/thickness/height edit, delete, undo/redo, Escape rollback, room re-derivation and 3D selection/tint.

Tolerances: body pick ~8px, handle ~12px, touch target ~20px, snap range ~0.02–0.50m, grid 0.05m, min wall 0.2m, release rounding 1cm, nudge 0.05/0.25m, 400ms nudge merge, thickness 0.05–0.6m, height 1.0–6.0m.

Important bugs caught/fixed:
1. Large body drag checked min-wall only at end; a huge drag could cross degenerate geometry and silently destroy rooms. Fixed with 64 samples + bisection along the movement.
2. Dragging a joint could snap back onto its own previous position because the wrong endpoint was excluded. Fixed.
3. Shared-joint handle ties could reselect a neighbouring wall. Fixed so ties favour the selected wall.

Historical limitation that led to 4.3b: dragging one half of a split straight wall could tilt the other half.

## 9. 4.3b — whole straight wall run — COMPLETE

Opus 5.5 High.

`wallRun(plan, wallId)` finds maximal end-to-end collinear chains, direction within 1° and joint within 1cm; T stems do not break the run.

Body dragging now moves the whole run straight, with attached stems/side walls stretching; openings stay clamped; one undo restores the whole operation.

Real cases: north outer wall and east outer wall were previously tilting; both are now tested at 1440 and 390 with real touch on the phone case.

## 10. 4.4 — draw walls — COMPLETE

Opus 5.5 High.

Wall tool supports click-to-start, chained walls, Finish/double-click/Escape, endpoint/midpoint snapping, typed exact length, live preview, too-short rejection, overlap/crossing/collinear rejection, and midpoint split of existing walls.

If a new wall lands on an existing wall midpoint, the existing wall is split first and split + new wall are one transaction. Openings crossing the split are moved to preserve physical position. Rooms are re-derived.

New walls default to ~0.15m thickness and plan-common height.

Known limitation: crossing walls are refused, not automatically split.

Historical e2e issue: full script initially exited 1 only because `/favicon.ico` was missing. This was later fixed with `src/app/icon.svg` without weakening the console-error test. There was also an existing occasional 390 timing flake; do not weaken tests just to hide it.

## 11. 4.5 — doors/windows — COMPLETE

Opus 5.5 High.

Added Door and Window tools, OpeningPanel, opening selection, opening placement/clamping, width/position/height/sill editing, delete, undo/redo, door swing side and Flip, 2D selection styling and 3D door-leaf orientation.

Important requirement: imported swing is an inference, so every door has explicit `swing: left|right` and Flip.

Pure helpers include `usableSpan`, `snapOpening`, `placeOpening`, `openingProblem`, `slideOpening`, `resizeOpening`, `openingSize`, `pickOpening`.

Selection uses `selectedId` for wall and `openingId` for opening. Choosing one clears the other; empty click and Escape clear both.

Critical selection issue and resolution:
- One screenshot appeared to show door selection failing, but that screenshot was actually `main`/4.3b; it contained no 4.5 opening selection code.
- On the real 4.5 code, a real picker defect was found: door swing was an exact quarter-circle with zero tolerance. Visible leaf/arc pixels lay on its edge/rim, so many real clicks missed and then selected nothing or the wall.
- Fix introduced `pickTarget` as the authoritative Select-tool picker: wall end handle → opening → wall body → nothing.
- Opening tolerance covers the visible leaf/arc/gap. A wall on which the pointer is physically pressed can still win; merely being near a wall does not steal an opening.
- Browser e2e was made to click actual rendered door/window screen coordinates at 1440 and 390 real touch.

Known limitations:
- no 3D opening selection
- no jamb swap; hinge-side convention remains fixed
- no opening arrow-key nudge
- proactive opening overlap prevention after wall shrink is limited
- imported openings may need clamping on first edit
- 3D door leaf is visually only ~17° open, so Flip is subtle; stored rotation/2D swing are correct

## 12. Favicon fix — COMPLETE

`src/app/icon.svg` supplies an SVG favicon via Next.js app convention. It removed `/favicon.ico` 404s. Console-error checks were not weakened.

## 13. 4.6 — Measure + local autosave — COMPLETE

Sonnet 5.5 Medium.

Unified tool store now contains `select | wall | door | window | measure`.

Measure mode:
- first/second point
- horizontal/vertical/diagonal distance
- dimension line, markers, label
- stable through zoom/pan
- Escape/Clear
- no Plan/history changes
- blocks wall/opening selection and dragging while active
- real touch at 390

Autosave:
- localStorage key `atrium-v2:plan`
- envelope `{ schema:1, savedAt, plan }`
- strict reader rebuilding fields and rejecting bad schema/shapes/duplicates/dangling refs
- `migrate()` hook
- corrupt data safely ignored
- 800ms debounce
- 5s max wait
- pagehide/visibilitychange flush
- storage errors reported without crashing
- imported plans participate in persistence so they cannot be overwritten by an older save on Studio open

Never persist: selection, hover, current tool, Measure state, 2D pan/zoom, undo/redo history.

Technical caveat: localStorage.setItem is synchronous by API design, but the write is delayed outside the edit path. Do not call it truly asynchronous.

Critical regression found and fixed:
The first persistence reader dropped `Opening.swing`, which would make flipped doors return to `left` after reload. Reader now preserves and validates swing, and tests cover it.

Browser-level swing regression now exists in `scripts/e2e-studio.ts`:
- fresh browser
- select Bedroom 1 door in Split at 1440 or 2D on phone
- Flip left→right through UI
- wait for saved status
- read storage (test never writes storage)
- reload into a new page context
- select same door
- verify swing is still right and wall/width/offset/sizes unchanged
- Undo disabled after reload

Both 1440 and 390 real-touch cases pass.

## 14. Merge/cherry-pick history

A 4.6 cherry-pick onto an existing 4.4/4.5 checkout created package.json and other conflicts, including an add/add conflict in `toolStore.ts`. The correct recovery was `git cherry-pick --abort`. Never hand-resolve that conflict again.

The reconciled 4.4 + 4.5 + 4.6 tree was merged as `142abe6` on `claude/upbeat-ride-hu9qcd`. The door-swing persistence e2e regression was then committed there as `4ba7192` ("test(e2e): flipped door keeps its swing through autosave and reload").

`main` was fast-forwarded from `1810787` (4.3b) to `4ba7192` and pushed, and the lightweight tag `editor-complete-4.6` was pushed on the same commit. History is a straight line. The safety branch `rachit/steps-4.4-4.5` and the cloud branch `claude/serene-meitner-vyhsk1` still exist on the remote; leave them alone.

## 15. Git rules and verification status

Rules:
- Work on `main` only. No side branches.
- If a cloud session creates a `claude/...` branch, bring it into `main` before the next step with `git fetch --all && git merge --ff-only origin/<branch>`. If ff-only refuses, stop and inspect. Never cherry-pick or hand-merge.
- Always confirm what the browser is running: `git branch --show-current` and `git log --oneline -3`. A green test on another checkout proves nothing about this one.
- Do not reset or discard previous work.

Verification status at `4ba7192` (main):
- `npm test` (18 suites), `npx tsc --noEmit` and `npm run build` passed.
- The browser e2e (`scripts/e2e-studio.ts`) was run on this commit after main was updated, and it passed (result below). To re-run it: terminal A runs `npm run dev` and stays running (it must be port 3000, and it must be `dev` and not `start`, because the e2e uses dev-only hooks such as `window.__planStore`); terminal B runs `npx tsx scripts/e2e-studio.ts` and must exit 0.
- **Run before committing** (since 4.7c): `npm test`, `npx tsc --noEmit`, `npm run build`, `grep -rlE "__studio3d|__pushPullDebug|__importDebug" .next/static || echo clean` (must print `clean`), and with `npm run dev` on port 3000 from THIS checkout (`lsof -i :3000`, then the process's working directory): `npx tsx scripts/e2e-studio.ts`, `npx tsx scripts/e2e-walk.ts` and (since I.1a) `npx tsx scripts/e2e-import3d.ts`, all exit 0. Do not edit source files while an e2e runs: the dev server hot-reloads mid-test.
- e2e result on `4ba7192`, 2026-10-01: PASSED, exit 0. At 1440 (mouse) and 390 (real touch events): 2D, select and edit, wall runs, draw walls, opening selection, doors and windows, Measure, nothing outside the viewport, 19 tab stops all with a focus ring, and the Import plan link; plus autosave restore and flipped-door swing persistence through a reload at both sizes. No 390 px flake appeared in this run. Tag `editor-complete-4.6` points at `4ba7192`.

## 16. Historical engineering lessons

- Verify the browser is running the same branch/commit you are reasoning about.
- A green e2e on a different checkout proves nothing about the user’s build.
- Trace real browser event paths when a UI failure conflicts with unit tests.
- Do not fix a thin-symbol click problem by merely changing screenshot/test coordinates.
- Do not let Measure mode fall through to selection/edit handlers.
- Never drop new persisted fields when reconstructing a Plan.
- Never weaken the console-error test; fix the underlying 404.
- Do not hand-merge two competing tool stores without inspecting both.
- Preserve existing geometry behaviour when adding UI features.

## 17. Known remaining limitations to keep visible

- 3D wall dragging excluded; 3D wall click/tint exists.
- 3D opening selection: done in 4.7b (Select tool; Push/Pull resizes opening faces, Move slides them along their wall). Wall sides, free wall ends, wall moves and corner drags in 3D: done in 4.7c. Wall ends at joints are not pullable; drag the corner.
- Crossing walls refused in 4.4.
- Door/window classification in blueprint detection is probabilistic/user-editable.
- Some real/complex plans are low-confidence.
- Measure is 2D only and has no rubber-band preview.
- Measure is centreline-based, not face-to-face.
- Autosave is localStorage and last-write-wins across tabs.
- No reset-to-sample UI.
- Pinch code exists; test on a real phone after deployment.
- Historical lint errors exist in PlanViewer/PlanModel and should not be mixed into unrelated feature work.

## 18. Next feature — 5.1

Use **Opus 5.5 — High effort**.

Feature: indoor Walkthrough with collision against the editable Plan.

Requirements:
- reuse sound V1 WalkthroughControls/camera foundations where possible
- current Plan is the collision source of truth
- deterministic valid start point inside a room
- fixed eye height during ordinary movement
- forward/back/strafe/look
- finite camera radius
- cannot pass through solid walls
- doors are passable
- windows are solid
- slide along walls and respect corners
- collision updates when walls/openings change
- do not build a stale baked collision mesh
- memoise/derive a compact collision representation from Plan and invalidate on relevant edits
- walkthrough camera state is not persisted
- 390 controls must remain usable

Tests must cover valid start, wall blocking, diagonal slide, corner clearance, door traversal, window blocking, multiple openings, T/split wall continuity, and collision changing after a wall edit.

Browser e2e must move the actual rendered 3D camera, not just assert store state.

Split into two pieces so one cut-off session cannot lose everything:
- 5.1a (Opus 5.5 High): the pure collision model, `src/lib/walk/collision.ts` and `scripts/test-walk.ts`. No React, no camera.
- 5.1b (Opus 5.5 High): controls (reusing V1's), the camera, 390 px touch controls, the browser e2e that moves the real rendered camera, and a visual check of the ceilings from inside. The ceilings (View > Show ceilings) have never been seen from below.
Collision rules chosen for 5.1a: radius 0.2 m; doors pass only if width >= 2 x radius + 0.1 m; windows are solid at every height; the door leaf is never collision; wall ends extend by half the thickness so corners have no notch; substeps of at most radius/2 so thin walls cannot be tunnelled; collision is memoised on the identity of `plan.walls` and `plan.openings`.

## 19. Future roadmap

5.2 bird’s-eye — Sonnet Medium
5.3 recenter — Sonnet Medium
Phase 6 catalog/materials/furniture; 6.5 auto-furnish — Opus High
Phase 7 schedules and exports; PDF/DXF dimensions — Opus High
Phase 8 landing/presentation
Phase 9 design options, performance, accessibility, README/deploy

## 20. Immediate continuation rule

Do not restart prior phases. The browser e2e passed on `4ba7192` (section 15). Begin 5.1a.

For every future coding step:
- read CLAUDE.md and docs/HANDOFF.md first
- state the plan before code
- preserve the single Plan source of truth
- write or fix tests before weakening behaviour
- run npm test, tsc, build, the studio e2e and the walk e2e (`scripts/e2e-walk.ts`)
- report the exact root cause of failures
- do not commit unless explicitly asked

## 21. One-paragraph state summary

Atrium 2.0 now has the editable Plan pipeline, 2D/3D studio shell, wall selection/editing, straight wall-run movement, wall drawing, editable doors/windows with explicit swing + Flip, real opening selection including Split’s right 2D pane, Measure, local autosave, persistence of Opening.swing, favicon cleanup, and end-to-end validation. The major real bugs encountered—split-wall tilting, unsafe body drags, snapping onto the old joint, neighbouring-wall selection, thin door-symbol picking, wrong-branch manual testing, favicon 404, conflicting tool stores, and persisted swing being dropped—have been identified and addressed. `main` is at `4ba7192` (tag `editor-complete-4.6`), which includes the e2e swing-persistence regression; the browser e2e passed on it (see section 15). Next is 5.1a, the pure collision model for the walkthrough, using Opus High.

## 22. Queue of small items (not blocking 5.1)

- Reset-to-sample / New plan menu item: autosave keeps a half-edited plan forever and there is no way back (Sonnet Low).
- Find the root cause of the occasional 390 px e2e timing flake. Do not retry it away and do not weaken the test.
- Clear the lint errors (PlanViewer.tsx, PlanModel geometry cache) before deploying.
- Import screen: setting the scale needs mouse or touch points; add a keyboard path (pick a wall from a list, type its length). Faint dark squares appear where translucent wall pieces overlap in the overlay.
- Put the OCR language data (eng.traineddata) in `public/` so the demo works offline.
- Test pinch zoom on a real phone after deployment, and test the import worker in Safari and Firefox.
- Room list rounds each area to one decimal, so the rows can add to 0.1 less than the total. Fix with the schedules in 7.1.
- Decide the order after 5.3: landing page (Phase 8) before or after the catalog (Phase 6). The core editor, walkthrough, bird's-eye and recenter will be demoable by then.
