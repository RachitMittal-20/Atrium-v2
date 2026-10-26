# Atrium 2.0 — Master Claude Code Handoff

This is the consolidated handoff for continuing Atrium 2.0. It combines the original Claude handoff, the completed implementation reports, the real browser failures we encountered, the fixes that were made, and the current Git/branch state.

## Roadmap

Tick each active item (`[x]`) as its step finishes.

### Active, in order

- [x] 8.1 Blueprint scene
- [x] N.1 Studio polish: a way back from the autosaved plan, first-run hints, empty states, OCR room-name noise fix
- [x] 5.2 and 5.3 Bird's-eye view and Recenter
- [x] 8.4 Landing polish: preloader, lazy photos, simple mobile tour (step L.2, section 43)
- [x] 7.1, 7.3, 7.2 Area schedule, PDF takeoff report, GLB and OBJ export (step X.2, section 44)
- [ ] 9.2 and 9.3 Lighthouse audit, performance and accessibility, Safari and Firefox checks
- [ ] Reader fixes for doors and windows, proven on a fresh real plan

### Deferred on purpose

Revisit after the active list is done, and remind the user when it is.

- 8.2 Construction site
- 8.3 Depth-parallax mansion and driveway car
- Furniture catalog and auto-furnish
- Realistic rendering, R.1 to R.3
- .skp and .max via Autodesk (I.2)
- Design options
- Share links and co-editing

### Pending, not code

- [ ] Font licence texts in `src/app/fonts`
- [ ] Demo video link in the README
- [ ] Case study on the 7 percent arrowhead scale bug
- [ ] A fresh real plan, kept outside git, for testing

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
  - NOT covered: FBX and 3DS success paths (until real files go through the report script); a real phone, Safari and Firefox; Alt-click picking a deep part in the browser (unit tests only); the outline pixel check at 390; the automatic frame right after an import (only the button is checked); the typed part rows in the panel (store tests cover `setNodeTransform`); big real-world files.
  - Existing test lines changed: `test-import.ts` (3200 → mm, 126 → in, the 120 cm OBJ table → in and ambiguous); `e2e-import3d.ts` (Push/Pull's message; the "ignore it" loop covers Push/Pull only, as Move now moves models; table.zip expects inches and the ambiguous message, then picks centimetres; Escape before the GPU-count baseline so the selected room's outline lines are not counted). No other existing assertion changed; `test-import-store.ts` only gained assertions.
  - Found and fixed on the way: the label had no pointer position in Move (ItemTool returned before recording it); at 390, closing the details sheet after Show in view made the pane taller and narrower and cut the framed model, so the framed box now stays framed across pane resizes until the user orbits; the phone tool bar wrapped labels mid-word with nine tools (gaps removed, only "Push/Pull" may break after the slash).
  - **On-demand tool (not a pre-commit check):** `npx tsx scripts/import-report.ts` with `npm run dev` running and real files in `test-models/` (git-ignored). One row per file (format, MB, triangles, objects, parse ms, ms per MB, chosen unit, ambiguous, warnings), screenshots and object lists in `/tmp/import-report/`, a 30 s watchdog with a 2 s heartbeat. A synchronous freeze cannot be interrupted, only noticed.
- **I.1b-fix is done** (four corrections; not committed; 2026-10-04). On top of `240860c` (I.1b). Checks, all passing against `npm run dev` on port 3000 from this checkout (`lsof -i :3000`, cwd `/Users/rachitmittal20/Atrium-v2`, `next dev`): `npm test` (23 suites), `npx tsc --noEmit`, `npm run build`, the dev-hook grep prints `clean`, `scripts/e2e-import3d.ts`, `scripts/e2e-studio.ts`, `scripts/e2e-walk.ts` (each exit 0, 1440 mouse and 390 real touch).
  1. **Unit rule:** declared unit; else the candidates 0.2–60 m; the last import's unit (localStorage "atrium.lastImportUnit", never in the plan) when it is one; else metric nearest 1.5 m; imperial only when no metric fits (never, with these five units: the metric ranges cover all of 0.2–60,000 units, shown by a sweep in the test). `ambiguous` unchanged. Tests: 120 → cm and ambiguous, 3200 → mm, 320 → cm, 126 → cm and ambiguous, 3.2 → m, 3000 → mm and ambiguous, a declared unit wins (also over the last unit), last unit inches → 126 gives in, a last unit that doesn't fit is passed over.
  2. **Nested part drags:** `model.ancestorTransforms / partPivotNow / partTransformAfter`; the store turns a world move, turn or scale into X' = A⁻¹ · D · A · X. Tests (`test-import-transform.ts` 2b): an item turned 90° and ×2, the Table under a parent with its own part transform (turned 30°, ×0.5, moved) on top of the file's turn and uneven scale: a world move of (0.4, 0, −0.3) moves every vertex by exactly that (1e-6), 45° turns it about its pivot by exactly 45°, 150% grows it ×1.5 about the pivot, siblings stay; the I.1b sum is shown to be off by more than 0.1 m there; the same through the store (typed 45 and 150, and a floor drag by the snapped delta). Browser: new fixture `nested.glb` (Shelf turned 30° and ×0.5 in the file, holding Box_A and Box_B; GLTFLoader writes the names' spaces as _); Shelf gets its own part turn 30° and scale 50% (typed), then Box_A is dragged with the mouse at 1440 and a real finger at 390: its pivot lands on the label's grid point (0.5 mm), its world box moves exactly as its pivot (1e-6), Box_B stays, one undo.
  3. **Normals:** `loadModel.ensureNormals` (flat per face for STL, smooth otherwise) for missing or zero-length normals. Tests: the fixture STL (binary and ASCII) gets unit-length, flat normals; an indexed mesh without normals gets smooth ones and stays indexed; good normals are left alone. Browser: the imported 3000-unit STL's top face is 145 / 255 bright (threshold 60; it was black).
  4. **Outline:** visible edges solid gilt with depth testing, hidden ones at 20%. `import-rotate-mid-drag-1440.png` re-taken: the cube's visible edges (top face outline, the near vertical edges, the front bottom edge) are solid gilt lines; the three back edges (the far vertical edge and the two far bottom edges) are faint gilt and no longer read as solid lines; label "-45° / Rotation -45°".
  - Existing test lines changed: `test-import.ts`: 126 → cm (was in), the 120 cm OBJ table → cm (was in), and the comment naming the rule; `test-import-transform.ts` (unit section): 126 → cm (was in), the helper `g` takes a last unit; `e2e-import3d.ts`: table.zip expects cm (was in) and no longer clicks cm; the 3000-unit STL is now imported (it was cancelled) for the brightness check and then undone; `drag` gained a `beforeRelease` callback. Nothing else changed in existing assertions.
  - NOT covered: a model whose parts are turned by a parent's part transform AND typed in the panel's part rows (those numbers are the part's own offset); a real phone, Safari and Firefox.
- **M.1 (floor-plan PDFs) is split in two:**
  - **M.1a (DONE; not committed; 2026-10-11): read floor-plan PDFs.** All PDF work runs in the browser, in `src/workers/pdf.worker.ts`. pdf.js's core is set as `globalThis.pdfjsWorker` there, so it never starts a worker of its own or fetches one. Vector pages take their scale from the PDF's own dimensions and title block; walls are still traced from a raster. Scanned pages go through the image pipeline unchanged. A dimension check covers every printed dimension, with overrides and a CSV. CLAUDE.md has the rules (section "Reading PDFs (step M.1a)"). Checks, all passing against `npm run dev` on port 3000 from this checkout (`lsof -i :3000`, cwd `/Users/rachitmittal20/Atrium-v2`, `next dev`):
    - `npm test`: 24 suites, including the new `scripts/test-pdf.ts`.
    - `npx tsc --noEmit` and `npm run build`.
    - The dev-hook grep (now also `__importPdf`) prints `clean`.
    - `scripts/e2e-pdf-import.ts` (new), `scripts/e2e-studio.ts`, `scripts/e2e-walk.ts` and `scripts/e2e-import3d.ts`: each exit 0.
  - **What M.1a added:**
    - `pdfjs-dist` 6.4.299 (Apache-2.0). Dev only (a runtime dependency since step X.2, for the report): `pdf-lib` 1.17.1 (MIT); `@napi-rs/canvas` comes in as pdf.js's optional dependency and is used only by the Node scripts.
    - `public/pdfjs/wasm/`: pdf.js's JBIG2/CCITT, JPEG 2000 and ICC decoders with their licences, served from our own origin. Nothing else is fetched.
    - `src/lib/pdf/{open,extract,scale,dimensions,analysePdf,render}.ts`, `src/types/pdf.ts` and `src/types/pdfjs-worker.d.ts`.
    - The import screen: `PdfPanels.tsx` (page picker, badge, scale sources) and `DimensionCheck.tsx`, plus PDF handling in `importFile.ts` (`isPdf`, `runPdf`) and `page.tsx`.
    - `analyseBlueprint` gained an opt-in `straighten: false`. The image pipeline's behaviour and tests are unchanged.
    - `scale.ts` exports `band` and `median`, and `UnitlessScale.ifMillimetres` is optional (PDF only). `PlanScale.source` adds `"pdf"` and `"unitless-millimetres"`.
    - `scripts/make-pdf-fixtures.ts` writes the 8 fixtures (2–22 KB each) and `truth.json` in `tests/fixtures/pdf/`; `scripts/pdf-node.ts` sets up pdf.js for Node.
  - **Covered by tests:**
    - The title-block rule. It was written first and seen failing (`'good' !== 'check'`) before the rule existed.
    - Every straight segment within 0.01 pt after the matrix and /Rotate. Every other segment lies on a door arc within 0.05 + 0.01 pt.
    - Text strings, positions, rotations and heights.
    - Classification of all 8 fixtures and the cover page.
    - Scale "good" within 0.001% on filled, lines, rotated, imperial and two-pages. plan-fit: 1:115 and the exact warning. plan-no-dims: "check" from the title block alone.
    - Every dimension row OK under 1 mm. An injected 4100 mm is flagged, and an override keeps both values (also in the CSV).
    - Plain messages for over 50 MB, the path-command cap, empty, garbage, cut short, encrypted, and an empty page tree (a blank page).
    - The scanned fixture takes the raster route at 300 dpi.
    - plan-filled and plan-rotated build the sample's rooms by name and 54.0 m of wall.
  - **In the browser, at 1440 mouse:**
    - All 8 fixtures through the real file input, with the badge, scale status and reason.
    - Every table value within 0.1 mm of the truth, and the ft-in switch.
    - The page picker with thumbnails on the two-page file.
    - No request leaves the origin while a vector PDF is read.
    - Build and open in the studio: rooms named from the PDF, and every wall length within 4 raster pixels of the truth (worst 10.4 mm against a 45–57 mm tolerance).
    - About 1 s per vector page and 12.7 s for the scanned one, including OCR, which found 80.8 px/m.
  - **At 390, real touch:** plan-filled built and checked, the picker by tap, and the layout viewport and page exactly 390 px wide while the table scrolls inside its container. At both sizes, the misprinted copy is overridden and the CSV downloaded.
  - **Screenshots** (`/tmp/studio/`):
    - `pdf-review-1440.png`: plan-filled, Vector PDF badge, "Scale found · measures 1:100 on A4", 11 rows OK.
    - `pdf-fit-warning-1440.png`: "measures 1:115" and the gilt-bordered title-block warning; the plan sits smaller on the page.
    - `pdf-dimension-check-1440.png`: 10 OK and the 4100 mm row "Overridden" with measured 4000.0 mm kept and the note.
    - `pdf-review-390.png`: one column. The table shows Printed, Measured and part of Difference and scrolls sideways. On the phone the table comes BEFORE the PDF and scale panels, because it sits under the plan in the left column. Worth reordering for phones.
  - **NOT covered:**
    - plan-lines (walls as double lines) builds without its living room. Hollow mode doesn't close it, and its windows are missed; the e2e prints this instead of asserting it.
    - Real CAD PDFs: `test-plans/` has no PDFs yet.
    - A dimension line broken around its text, curved walls, multi-page reading, mixed pages (no fixture), and encrypted or damaged files in the browser (unit tests only).
    - JBIG2/CCITT/JPEG 2000 scans (decoders served but untested).
    - Safari, Firefox, a real phone.
  - **Found and fixed on the way:**
    - pdf.js's core, imported in a worker, wires itself to that worker's port and posts a "ready" handshake to the page, which first read as a failure. `runPdf` ignores non-protocol messages.
    - pdf.js shows a PDF with no pages as one blank A4 page, so blank pages are refused.
    - The table's `sr-only` header label escaped its scroll container and widened the phone layout to 577 px. The container is now `relative`, and the e2e checks `innerWidth` as well, because `scrollWidth <= innerWidth` alone could not see it.
  - **Existing test lines changed:** `e2e-import.ts` part e. The fake PDF now gets the damaged-PDF message (it said "PDFs aren't supported yet"), and the text-file message now mentions PDFs.
  - **One flake seen:** in the first combined run, `e2e-studio.ts` failed once at "390: the Delete key removes it too". A probe of mine was loading the same dev server at the time. The clean rerun passed. This step changes no studio code; this may be the known 390 timing flake (section 22).
  - **M.1b (DONE; not committed; 2026-10-11): exact walls from vector PDFs.** CLAUDE.md has the rules (section "Exact walls from vector PDFs (step M.1b)"). Checks, all passing against `npm run dev` on port 3000 from this checkout (pid 9154, cwd `/Users/rachitmittal20/Atrium-v2`, parent `next dev` ← `npm run dev`):
    - `npm test`: now including the new `scripts/test-pdf-walls.ts`. `npx tsc --noEmit`, `npm run build`, the dev-hook grep (`clean`).
    - `scripts/e2e-pdf-import.ts`, `e2e-studio.ts`, `e2e-walk.ts`, `e2e-import3d.ts`: each exit 0.
  - **What M.1b added:**
    - `src/lib/pdf/walls.ts`: face pairing, run in the PDF worker into `PdfInfo.vectorWalls`.
    - `src/lib/pdf/snap.ts`: `buildPdfPlan` / `mergeVector`, the merge with the traced plan, the 3 px limit, the fallbacks and the coverage report.
    - `Wall.provenance` and `Wall.edited`; the plan store's `edit()` sets `edited`.
    - `scale.ts`: lines broken around their text, ticks against line length, the OCR source, and reading-order text joining.
    - `analysePdf.ts`: the outlined-text OCR fallback (`ocrTexts`).
    - `dimensions.ts`: `modelRows` and the two-section CSV.
    - The import screen: `CoveragePanel`, the "Traced walls" overlay layer, `DimensionCheck` used for both tables, and a grid layout with the panels before the tables on a phone. `WallPanel` shows the provenance line.
    - Fixtures, all synthetic, drawn by `scripts/make-pdf-fixtures.ts` from the sample plan:
      - plan-clutter: hatching, a table, two boxed tags, a stray line and a diagonal wall.
      - plan-broken-dims: lines broken around their text, ticks, one line overshooting its ticks by 5 mm real size at each end, and the overall line without ticks.
      - plan-outlined: no text items. The room names and title block are glyph rectangles made from Arial drawn by @napi-rs/canvas; real CAD outlines are curves. The dimension texts are small embedded 300 dpi PNGs.
      - plan-single-line: one wall drawn as a single heavy line.
      - `truth.json` gained `planWalls` and `planOpenings` (the page's frame), `measure` and `lineLengthPt` per dimension, `diagonal`, and `tracedWalls`.
      - `tests/fixtures/pdf/clutter-chromium-trace.json` (15 KB): Chromium's noisy trace of plan-clutter, kept as a regression.
  - **Covered by tests (Node):**
    - FAILING FIRST: the traced plan-filled has a wall 10.0 mm off in length (more than 4 mm); snapped, 0.0000 mm.
    - filled, lines, rotated and imperial:
      - every wall's ends and thickness are within 0.5 mm of the truth, with coverage 100%;
      - the validator is clean, and room areas equal the truth's within 1e-6 m²;
      - openings are within 0.5 mm: 9 of 9, except on plan-lines.
    - plan-lines: 8 of 9 openings exact. The tracing made door `o3` 1.54 m wide (one jamb absorbed into the T at I). Snapping it would move a jamb 647 mm, so it stays traced and is reported.
    - plan-clutter: exactly the 14 real walls; the diagonal is counted; 3 clutter pairs are dropped. With the Chromium trace it is still 14 exact, 4 named rooms and 9 openings.
    - Synthetic tests:
      - pairing at the gap limits (0.05 and 0.60 pair; 0.04 and 0.61 don't) and at the overlap limit (60% pairs, 59% doesn't);
      - filled rectangles, widest wins, glass line = window, door gaps, clutter;
      - an L corner, a T-junction and a crossing.
    - Snapping: 1.5 px snaps; 2.5 px and an end 5 px out stay traced with their reasons; no end moves more than 3 px; a PDF stub that adds a validator problem is left out with its reason.
    - plan-single-line: the single-line wall is traced within 4 px and the rest lie on true centre lines. K–L also goes back to traced: its PDF end stops at the single line's face, more than 3 px from the traced centre line, so the validator round sends it back, and the notes say so.
    - Dimensions: broken lines are read; the overshooting line is exact between its ticks (by its line length it would be 10 mm over); "line length" for the overall line, which has no ticks.
    - OCR: the title block alone stays "check". OCR words at the printed places give "good", every row "read by OCR". Real tesseract on plan-outlined reads 11 of 11 dimensions, but not "Living room", which becomes "Room 2".
    - Model versus printed: centre to centre, OK to 0.5 mm; a misprint is flagged; traced rows are approximate; inside faces; both checks are in the CSV.
    - Persistence: old plans load unchanged; provenance and `edited` round-trip; unknown values are dropped.
    - The store marks an edited PDF wall and undo clears the mark.
  - **In the browser, at 1440 and 390 (real touch), through the real file input:**
    - Every new fixture (plan-filled too at 390): the coverage line, one dashed overlay line per traced wall, the model table and the "how" texts.
    - Built and opened in the studio: every wall read from the PDF lies on a true wall within 1 mm. The worst was 0.000 mm.
    - The panel says "Read from PDF", "Traced, approximate" (plan-single-line), and "Edited" after a height change.
    - At 390 the PDF, coverage and scale panels sit above the tables, with no sideways scroll.
    - Misprinted copy: flagged in both tables, one row in each overridden, and the CSV holds both sections.
    - plan-outlined's OCR fetches only tesseract's language data from its CDN; plan-outlined took 5 s with that data cached and 33 s on the first download.
  - **Screenshots** (`/tmp/studio/`):
    - `pdf-coverage-1440.png` (plan-filled): "14 of 14 walls read exactly … (100% of wall length); 0 walls are traced approximately (about 12 mm)", "Doors and windows: 9 snapped to the PDF, 0 traced, 0 added", and both tables with every row OK.
    - `pdf-model-check-1440.png`: 11 rows, centre to centre, 0.0 mm, OK.
    - `pdf-clutter-1440.png`: the hatched plan with its table, tags and diagonal; 14 of 14 exact; "1 diagonal wall … skipped"; the 9 openings added from the PDF.
    - `pdf-traced-1440.png` (plan-single-line): "12 of 14 … (89% of wall length); 2 walls are traced", with the two traced walls dashed in gilt round the bathroom's top and left and listed with reasons. Model table: 9 OK and 2 Flagged at ±6.0 mm; 4 rows are marked approximate.
    - `pdf-review-390.png`: one column in the order plan, PDF, "Read from the PDF", Scale, Build, Dimension check, Model versus printed. The model table's "Between" column is cut at the right edge and scrolls inside its box.
  - **NOT covered / limits:**
    - No real CAD PDF was tested: `test-plans/` has no PDFs, and every fixture is synthetic.
    - Diagonal and curved walls are only counted. Curved-wall counting is tested only by code reading; no fixture has one.
    - Door swing sides are not read from the arcs (done in M.1c). A door right at a corner is not bridged. Without a PDF scale, walls are traced only.
    - Real outlined text is curves, not the rectangles this fixture uses.
    - Safari, Firefox and a real phone were not tested.
  - **Found and fixed on the way:**
    - Chromium rasters plan-clutter differently from @napi-rs/canvas. The tracing became 61 noise pieces: letters, the title block, and the bottom wall's face line as a 0.05 m "wall" 8 px off. The first rule set then fell back to the whole traced plan. Now fragments and face lines inside PDF walls, traced clutter, and traced walls joined to nothing from the PDF are left out with notes.
    - Validator problems were compared as text, so a moved origin made old problems look new. They are now compared without numbers or ".sN" suffixes.
    - OCR boxes made "4000" and "mm" different heights, so they never joined. Bottom-to-top words were joined out of order.
  - **Existing test lines changed:**
    - `test-pdf.ts`: the trace note's text (the M.1a line was replaced, as asked).
    - `e2e-pdf-import.ts`:
      - the trace-note regex;
      - M.1a's 4-pixel length check and the unasserted plan-lines block are replaced by the 1 mm checks;
      - the CSV line count is now per section, because the CSV holds both tables;
      - the two-page file now resets its list of outside requests. It inherited plan-outlined's OCR requests once the order changed.
    - `test-persist.ts`: assertions added, none changed.
  - **Flakes and hangs seen:**
    - Once, at 390, the "Open in studio" tap on plan-clutter did not navigate. It passed alone and in the two later full runs; maybe the known 390 timing flake (section 22).
    - Once, `e2e-import3d.ts` hung after its first dialog check while other e2e runs had just finished. A clean rerun alone passed. M.1b changes nothing it uses.
  - **M.1c (DONE; not committed; 2026-10-12): doors, windows and door swings from the PDF's vectors.** CLAUDE.md has the rules (section "Openings from vector PDFs (step M.1c)"). Checks, all passing against `npm run dev` on port 3000 from this checkout (pid 9154, cwd `/Users/rachitmittal20/Atrium-v2`, parent `next dev` ← `npm run dev`):
    - `npm test`, including the new `scripts/test-pdf-openings.ts`. `npx tsc --noEmit`, `npm run build`, and the dev-hook grep (`clean`).
    - `scripts/e2e-pdf-import.ts`, `e2e-takeoff.ts`, `e2e-studio.ts`, `e2e-walk.ts`, `e2e-import3d.ts`: each exit 0, first time, no flake.
  - **Found before designing:** M.1b bridged a doorway into ONE wall with a door span, and every gap was a door with LEGACY_SWING. The PDF worker keeps only flattened segments (`curve` and `path` per segment, no control points), so a polyline arc arrived as plain straight pieces and its leaf could pair as a wall. The plan's "left" swing is the (-dy, dx) side of a→b, which is the visual RIGHT on screen (y down). The hinge is always the a-end jamb.
  - **What M.1c added:**
    - `src/lib/pdf/openings.ts` (pure): chains, Kasa circle fit, swing arcs with leaves, classification (door, double, sliding, window, unclassified), and the reasons arcs go unused.
    - `walls.ts`: arc pieces and leaves are never faces; openings are 0.45–4 m (gaps under 0.45 m are solid wall, where M.1b used 0.3 m); glazing pairs inside a gap are absorbed; each span is classified. `VectorOpening` gained `class`, `swingNormal`, `hinge` and `hingeEnd`; `VectorWalls` gained `arcs`.
    - `snap.ts`: PDF openings are primary (snapped, replaced, added; traced ones listed). Swing is re-derived on the final wall. Walls whose doors hang on the b jamb are turned round. `openingProblem` refusals restore the traced opening. Coverage gained `openings.{replaced, exact, total, doors, windows, unclassified, arcsNotUsed}`, `tracedOpenings`, `unclassifiedOpenings` and `unusedArcs`.
    - `Opening.provenance / edited / defaultHeight` (`plan.ts`, `planStorage`, `planStore.markEdited`). `OpeningPanel` shows the provenance line.
    - `dimensions.ts`: a row on a traced opening's jamb is approximate.
    - Review screen: the openings line, default heights, the lists, and the "Traced openings" and "Unclassified openings" overlay layers.
    - Fixture `plan-doors.pdf` (SYNTHETIC, drawn by `make-pdf-fixtures.ts`): polyline swings in all four hinge/side combinations, a double door, a sliding door (staggered panels), windows with three and two glazing lines, a bare gap, two printed opening widths, and Bézier decoys (sink r 0.35 with radius lines, chair r 0.25 at 120°, stair r 1.8 with a radius line, a leafless quarter circle on the bare gap's jamb). `truth.json` gained each opening's `class`, `hinge` and `side`, `decoyArcs`, and `spans` on the two opening dimensions. Every existing fixture PDF is byte-identical (their swings are Béziers and their windows three lines, as before).
  - **Covered by tests (Node):**
    - FAILING FIRST 1: plan-lines' traced door is 1.540 m (M.1b kept it). Before the change the check failed ("opening d-bed1 (900.0 mm) is within 0.5 mm in the built plan"); now it is 0.9000 m.
    - FAILING FIRST 2: a hand-checked door (leaf north on a west-to-east wall) must be "right". It failed with `'left' !== 'right'` before the derivation existed; now doorSwing draws its leaf at the PDF's tip.
    - Arc fitting: exact quarter; 79° and 101° rejected, 80.5° and 99.5° pass; ±0.5% noise accepted, ±2% not an arc; radius 0.49 and 1.51 m rejected, 0.51 and 1.49 m pass; no leaf, or a leaf 3% too long, rejected; polyline arcs found.
    - Swing: all four hinge × side combinations, Bézier and polyline.
    - Classification: door, double, sliding, window (two lines in a gap; faces plus glass) and unclassified. An arc 0.15 m off the jamb is unused (0.09 m is used), a mismatched radius is unused, and both are reported. A 0.44 m gap closes; a 0.46 m one opens.
    - Every vector fixture with a scale (filled, lines, fit, rotated, imperial, two-pages, clutter, broken-dims, single-line, no-dims, doors): every opening's jambs within 0.5 mm, kind right, "vector", default height, every door hinged on the PDF's jamb and opening to its side (through doorSwing), validator clean, the four rooms. Areas are exact wherever every wall is from the PDF.
    - plan-doors: 6 doors, 4 windows, 1 unclassified; the 4 decoys unused with their reasons; the model check's 1000 and 1200 mm opening widths OK at 0.000 mm; traced openings make those rows approximate.
    - Merge: 2.9 px snaps; a jamb 5 px out is replaced and noted; 3 px beside is replaced; 4 px beside stays traced and is listed; a missed opening is added; a refused PDF opening gives way to the traced one.
    - Store: edited and default-height marks, and undo. Persistence (`test-persist.ts`): old plans' openings unchanged, the marks round-trip, unknown values are dropped.
  - **In the browser** (plan-doors, 1440 mouse and 390 real touch, through the real file input):
    - The openings line "11 of 11 openings read exactly (doors 6, windows 4, unclassified 1); 0 traced approximately; 4 arcs not used.", the default-height line, no traced box, and one unclassified box exactly as long as the bare gap (80.8 px).
    - The model table's two "opening width" rows are OK.
    - Built and opened: all 11 openings within 1 mm (worst 0.000 mm), every door on the PDF's jamb and side. The panel says "Read from PDF · Default height".
    - 1440 only, 3D: each door's rendered frame-and-leaf box stands out on the PDF's side, in metres beyond the centre line on that side / behind it: d-front 0.29/0.11, d-bed1 0.26/0.06, d-bed2 0.26/0.06, d-bath 0.23/0.06, dd-living 0.46/0.11.
  - **Screenshots** (`/tmp/studio/`):
    - `pdf-openings-1440.png`: the review page. The openings line, the default heights and the unclassified list ("Opening o1, 1.00 m: Opening type not drawn; assumed door") are in the coverage panel, and both tables are all OK, with the two "opening width" rows. The plan on the overlay is small at page scale, so the orange box on the west wall is hard to see, and the free-end dots use the same orange.
    - `pdf-openings-3d-1440.png`: the 3D model from the default camera with every door leaf standing slightly open. The panel shows d-bed1 "Read from PDF · Default height", Right, 1.10 m from its turned-round wall's start. At this angle and about 17° of opening, the leaf directions are hard to judge by eye; the assertion reads the rendered boxes.
    - `pdf-openings-390.png`: one column, with the coverage panel and its openings line above the tables, which scroll inside their boxes.
  - **NOT covered:**
    - No real CAD PDF was tested: `test-plans/` has no PDFs, and every fixture is synthetic.
    - No fixture produces a traced opening, so the gilt traced-opening box is tested only through Node merges, not seen in the browser.
    - A wall carrying doors hung both ways (one stays mirrored, noted): Node code path only, no test.
    - Leaves drawn as thin rectangles (CAD often does) are not leaves by the 2% rule; such doors read as unclassified.
    - Bi-fold, pocket and arched doors; openings in diagonal or curved walls.
    - Safari, Firefox and a real phone.
  - **Existing test lines changed:**
    - `test-pdf-walls.ts`: the plan-lines branch (as the prompt stated). It now expects all 9 exact, 0 traced, and the "replaced by vo… read from the PDF (0.90 m)" note, and its header says so.
    - `e2e-pdf-import.ts`: the model check reads each row's expected "between" text from the truth (`spans`, else centre to centre, so the old fixtures check exactly as before), and plan-doors joined the 390 list.
    - `test-persist.ts`: assertions added, none changed.
- **M.2 (quantity takeoffs) is split in two:**
  - **M.2a (DONE; not committed; 2026-10-12): the Takeoff tool.** It measures lengths, polygon areas with cutouts, and wall faces in the 2D plan. It has units, references, discrepancy flags, overrides, a basis per row, a stale marker, totals and a CSV. CLAUDE.md has the rules (section "Quantity takeoffs (step M.2a)"). Checks, all passing against `npm run dev` on port 3000 from this checkout (pid 9154, cwd `/Users/rachitmittal20/Atrium-v2`, parent `next dev`):
    - `npm test`, including the new `scripts/test-takeoff.ts` and the assertions added to `test-persist.ts`. `npx tsc --noEmit`, `npm run build`, and the dev-hook grep (now with `__plan2d` and `__takeoffStore`) prints `clean`.
    - `scripts/e2e-takeoff.ts` (new), `e2e-studio.ts`, `e2e-walk.ts`, `e2e-import3d.ts`, `e2e-pdf-import.ts`: each exit 0.
  - **What M.2a added:**
    - `src/lib/units/format.ts` and `src/store/unitsStore.ts` (localStorage "atrium.units"). The Summary's m² | sq ft toggle now uses the same area setting, so it persists.
    - `src/lib/takeoff/{geometry,rows}.ts`.
    - `Plan.takeoffs?` / `Takeoff` in `src/types/plan.ts`, the four store actions, and the strict reader in `planStorage` (no schema bump).
    - `src/store/takeoffStore.ts`, `src/components/plan2d/TakeoffLayer.tsx` and `src/components/studio/TakeoffPanel.tsx`.
    - `takeoff` in `toolStore` (key K). The rail button is disabled in 3D-only and while walking. The page's tool keys now listen in every view and check each tool's pane.
  - **Covered by tests (Node):**
    - Units, including the failing-first totals test, which was seen failing as `'3 mm' !== '2 mm'` against a naive sum of rounded values.
    - Shoelace areas (rectangle 12.6, L 12, triangle 3, either winding), a bowtie refused, cutouts (inside, on the edge, half or wholly outside, in an L's notch), and polylines.
    - `wallFaceLengths` on the partition (3.85 / 4 / 3.85, rooms Bedroom 2 left and Bedroom 1 right) and on the south run (10.2 outside, 9.8 inside, equal to the sums of `wallOutline` edges). Alt gives one piece (3 m). A 0.3 m middle piece gives stepped faces of 10.3 and 9.9.
    - Snap priorities, Alt and Shift; tolerance boundaries for both kinds (exactly at the tolerance OK, 0.1 mm or 0.0001 m² beyond Flagged); overrides keep both values; totals from unrounded values; basis from provenance; the CSV's escaping and columns.
    - The stale hash and Mark as current; every store action is one undo step with redo; drafts never touch history.
    - `validatePlan`, rooms and collision are unaffected (no collision rebuild). The autosave round trip adds 358 bytes for two takeoffs, and the shortcuts are unique.
  - **In the browser:**
    - 1440 (mouse, Split): disabled in 3D-only with its tooltip. Length on the south outside face equals `wallOutline` (10.200000). Escape mid-draw leaves history unchanged. Area on Bedroom 1 equals its net area (14.822500), and a cutout subtracts 1 m². The partition's left face, centre line and right face are picked by the pointer's side and equal `wallOutline` ("Room side: Bedroom 2" on the hover label).
    - 1440, panel and persistence: the mm, ft-in and sq ft texts; a Flagged reference; an override showing both values; Delete then Ctrl+Z restores exactly. The CSV downloads and parses (`Length 1,length,Drawn,10200,10150,50.0,Flagged,10180,,10180,no`). A reload keeps the takeoffs and the units. K picks the tool, and entering Walk switches it to Select and disables it ("Exit Walk to use Takeoff").
    - 390 (real touch, 2D): Length by taps with Undo point and Finish; Cancel leaves history unchanged; Area by taps with Finish; the partition's left face through the Left toggle. The page and body are exactly 390 px wide while the 885 px table scrolls inside its 356 px box.
  - **Screenshots** (`/tmp/studio/`):
    - `takeoff-length-mid-draw-1440.png`: the draft along the south face with the "face corner" snap marker. The live label "Total 10.200 m · last 10.200 m" is flipped to the left of the point. Before that fix it was cut off at the pane's right edge.
    - `takeoff-area-cutout-1440.png`: Area 1 over Bedroom 1 with its dashed cutout and the "Add cutout to Area 1" button. The label "Area 1: 13.823 m²" overlaps the room's own "Bedroom 1" label.
    - `takeoff-panel-flagged-1440.png`: the 320 px panel scrolled sideways to Difference "+50 mm", the Flagged badge and the 10180 mm override. The "Overridden: …" line is cut at the box's right edge, which scrolls. On the canvas, the three partition takeoffs' labels overlap one another.
    - `takeoff-390.png`: the sheet open on the table (Name, Kind, Basis, Measured; the rest scrolls) and the totals. The mode bar and toggle cover the top of the small plan above the sheet.
  - **NOT covered:**
    - Copy table in the browser (the clipboard is not granted; its cells are the CSV's, which are tested).
    - Shift and Alt in the browser (Node tests only), the stepped-face label in the browser, and a cutout refused in the browser (Node tests only).
    - The stale marker and Mark as current in the browser (Node tests only), and the mm² unit in the browser.
    - The 390 CSV download and reload (1440 only), a real phone, Safari and Firefox.
  - **Existing tests:** only `test-persist.ts` gained assertions; nothing existing changed. `package.json`'s test script runs `test-takeoff.ts`. No `__plan2d` hook was needed: the e2e reuses the canvas camera attributes, as `e2e-studio.ts` does.
  - **M.2b (next):**
    - Recalibrate the scale inside the studio: type the true distance between two points, preview the factor and the new plan size, and apply it as one undo step.
    - Keep the PDF import's printed-dimension rows with the plan and show them beside the takeoffs.
    - Overlay the PDF page under the 2D plan.
- **M.1d (DONE; not committed; 2026-10-13): door hinges, typed precision, thin-rectangle leaves, gap reporting, a cycle guard and a deterministic table.zip.** CLAUDE.md has the rules (section "Hinges, typed precision and gap reporting (step M.1d)"). Checks, all passing against `npm run dev` on port 3000 from this checkout (pid 9154, cwd `/Users/rachitmittal20/Atrium-v2`, parent `next dev` ← `npm run dev`): `npm test` (35 suites, new `scripts/test-import-cycles.ts`), `npx tsc --noEmit`, `npm run build` (2.0 s, well under the new 5-minute cap), the dev-hook grep (`clean`; `__scene3d` is not in the bundle either), and `scripts/e2e-pdf-import.ts` (extended), `e2e-takeoff.ts`, `e2e-units.ts`, `e2e-studio.ts`, `e2e-walk.ts`, `e2e-import3d.ts`: each exit 0, **first time, no flake**. `npx eslint src/` reports the same 12 problems as HEAD (the PlanViewer / PlanModel ref errors already on the queue); M.1d adds none.
  - **What M.1d added:**
    - `TYPED_STEP = 1e-4` in `edit.ts`; `lengthTarget` and `typedTarget` round to it, and `OpeningPanel`/`ItemPanel` parse typed input to it. Drags, snaps and Push/Pull keep 1 cm and 5 cm.
    - `Opening.hinge?: "a" | "b"` (`types/plan.ts`), read through the new `doorSides` by `doorSwing` (2D, and `pickOpeningAt`'s swing quarter, whose arm now runs hinge → far jamb) and by the new `doorLeaf3d` (`meshBuilders.ts`), which `PlanModel` uses for the leaf's pivot, box and turn. `planStorage` reads it strictly; `markEdited` counts it.
    - `OpeningPanel`'s "Hinge side: A end | B end" group, one undo step, keyboard reachable; `flipDoor` still touches only the swing.
    - `snap.ts` lost the wall turn-round and the "hangs on the jamb nearer its wall's end" note; it stores `hinge: "b"` instead.
    - `openings.ts`'s `rectLeaf`: a leaf as a thin closed rectangle (20–100 mm); `Arc.leaf` became a list so all four sides stay out of the wall faces.
    - `walls.ts` records out-of-range gaps in `VectorWalls.gaps`; `Coverage.outOfRangeGaps` (through the merge AND the fallback), the `coverage-gaps-line` sentence, and a "Gaps not read" overlay layer in `PlanViewer`.
    - `scripts/test-import-cycles.ts` (in `npm test`), and `tableZip()` with a fixed `mtime` in `make-import-fixtures.ts`.
    - Fixtures `plan-doors-rect.pdf` and `plan-gaps.pdf` (both **SYNTHETIC**, drawn by `make-pdf-fixtures.ts`, as every PDF fixture is). `truth.json` gained `hingeEnd` per door and `outOfRangeGaps`; **every existing fixture PDF is byte-identical** and the truth changes are purely additive.
  - **Covered by tests (Node):**
    - FAILING FIRST 1 (typed precision), seen failing as `13'6" stores 4.1148 m, not 4.11  —  4.11 vs 4.1148`; now 4.1148, and `3800 mm` is exactly 3.8 m, with `2'7"` → 0.7874 m in an opening's width (`test-units-store.ts`).
    - FAILING FIRST 2 (the 3D pivot, written before the code), run against a copy of the tree with the pre-M.1d leaf rule: `b/left: 3D pivot x is the hinge jamb: -0.4 vs 0.4`. Now all four hinge × swing states of one hand-checked door agree in 2D (`doorSwing`) and 3D (`doorLeaf3d`), and no hinge stored behaves exactly as hinge "a" (`test-plan2d.ts`).
    - FAILING FIRST 3 (the cycle guard), run with `CYCLE_ROOT` on a copy where `format.ts` takes `parseTypedLength` back from `importFile.ts`: it printed `format.ts → importFile.ts → analyse.ts → toPlan.ts → validate.ts → current.ts → format.ts` and the banned-import line, exit 1. On the real tree: 100 files, 436 edges, no cycles.
    - Rectangle leaves: accepted with a Bézier or a polyline arc, on either jamb and either side, and the wall stays ONE wall (all four sides kept out of the faces); a rectangle with no arc leaves the gap unclassified; 20 mm and 100 mm pass, 120 mm does not; a rectangle 3% too long does not. Below 20 mm one long side passes the plain line-leaf test, so the door is still found — asserted as such.
    - Gaps: 0.30 m closes as wall and 4.60 m stays unbridged, both reported with their sizes; 0.44 m reported, 0.46 m an opening; overlaps are not gaps. On `plan-gaps.pdf` the report equals the truth, the narrow gap has wall through it and the wide one does not.
    - `plan-doors-rect.pdf`: 14 walls and 11 openings exact, validator clean, four rooms, the same four decoy arcs rejected, 7 swing arcs used; its two doors on the north wall are hinged at opposite jambs, open to opposite sides, and are both exact in width and offset.
    - Every vector fixture: each door's stored hinge equals the truth's jamb, and every wall still runs the way `walls.ts` read it (no turn-round). `plan-doors`' d-bed1 and d-bath, which M.1c turned their walls round for, now carry `hinge: "b"`.
    - The store: the hinge is one undo step with redo, Flip leaves it alone and it leaves Flip alone, all four states are valid (`test-opening-edit.ts`). Persistence: an old plan gains no `hinge`, "a" and "b" round-trip, unknown values are dropped (`test-persist.ts`).
    - Takeoffs: far-hinged doors leave every wall's left and right faces, rooms, pieces and labels byte-for-byte as they were (`test-takeoff.ts`) — the check that M.1c's turn-round would have failed.
    - `table.zip`: the writer gives the same SHA-256 twice, and that hash equals the committed fixture (`test-import.ts`).
  - **In the browser** (`e2e-pdf-import.ts`, 1440 mouse and 390 real touch, through the real file input):
    - `plan-doors-rect.pdf` at both sizes: the openings line "11 of 11 openings read exactly (doors 7, windows 3, unclassified 1); 0 traced approximately; 4 arcs not used.", 13 dimensions all OK, 14/14 walls exact, four rooms, every opening within 1 mm (worst 0.000 mm) with its width, offset, swing and hinge against the truth, and no wall turned round.
    - 1440, 3D: each door's rendered leaf pivots on its own jamb — `dr-a a`, `dr-b b`, `dr-bed1 b`, `dr-bed2 a`, `dr-bath b`, each 50 mm from the drawn jamb (the frame member's own width, which is where the pivot sits), and nearer it than the other jamb. Frame-and-leaf boxes still stand out on the PDF's side (dr-a 0.26/0.11 m, dr-b 0.26/0.11, dr-bed1 0.26/0.06, dr-bed2 0.26/0.06, dr-bath 0.23/0.06, ddr-living 0.46/0.11).
    - 1440: a real click on the panel's "A end" moved the 3D leaf 0.80 m along the wall to the other jamb and mirrored its turn; Ctrl+Z restored the pivot exactly and the turn exactly, and the swing side was untouched throughout.
    - `plan-gaps.pdf` at both sizes: "2 gaps outside 450 mm to 4000 mm were not read as openings (sizes: 300 mm, 4600 mm). A gap narrower than 450 mm is closed as wall; a wider one leaves the wall open. Draw or place them yourself.", two highlighted boxes on the overlay, each as long as its gap, and `data-sizes` agreeing unrounded.
  - **Screenshots** (`/tmp/studio/`):
    - `pdf-hinges-1440.png`: plan-doors-rect's review page. The coverage panel shows 14/14 walls and the 11-opening line; both dimension tables are all OK, with the two "900 mm" opening-width rows. The plan on the overlay is small at page scale, so the orange box on the west wall is again hard to see and shares its colour with the free-end dots (the M.1c note still stands).
    - `pdf-hinges-3d-1440.png`: the 3D model from the default camera, taken after the hinge flip and its Ctrl+Z, so the panel shows door `dr-b` as it was read: Width 900 mm, Centre from wall start 4400 mm, Swing side **Right**, Hinge side **B end**, "Read from PDF · Default height". That panel is the readable evidence in the shot. **The leaves are only about 17° open**, exactly as in the M.1c screenshots: `LEAF_OPEN` is a fixed 0.3 rad in `meshBuilders.ts` and there is **no dev flag to open them wider** — I did not add one — so which jamb each leaf hangs from is genuinely hard to judge by eye at this angle. The assertions read the leaf group's real world position instead, which is why they are the proof and the picture is not.
    - `pdf-gaps-1440.png`: plan-gaps' review page. The out-of-range sentence sits in the "Read from the PDF" panel under the coverage lines ("13 of 15 walls read exactly … 7 of 8 openings read exactly … 1 traced"), with its own swatch, and a "Gaps not read 2" layer toggle appears beside the others. Both dimension tables are 11 rows, all OK, with one model row marked approximate (it lands on a traced wall). On the overlay the 4.60 m gap reads as a long dashed run along the north wall; the 0.30 m one is only a few pixels long at page scale and is easy to miss. The traced-openings list names the tracing's own "Opening o6, 300 mm: no opening in the PDF within 3 px", which is the honest consequence noted above.
    - `pdf-hinges-390.png`: plan-doors-rect in one column — plan, then the warnings, PDF, coverage, scale and Build panels, then the tables, which scroll inside their own boxes. The page and body are exactly 390 px wide.
  - **NOT covered:**
    - **No real CAD PDF was tested.** `test-plans/` has no `.pdf` files (the e2e printed "test-plans/: no .pdf files, nothing extra to read"), and every fixture is synthetic. The per-file row (walls exact, openings exact, hinge a, hinge b, unclassified, out-of-range gaps, time) is written and ready but has never run on a real drawing.
    - The hinge control at 390 (the 3D and flip checks are 1440 only), and the hinge in 3D by any tool: Push/Pull and Move do not touch it and there is no 2D handle for it.
    - A leaf rectangle thicker than 100 mm (not a leaf; its sides can pair as a thin wall) and one thinner than 20 mm in a real plan (only the synthetic line-leaf fallback is tested).
    - plan-gaps' own walls are not checked against the truth: its 4.60 m gap deliberately leaves two free ends and an open living room, so the generic every-wall-exact, four-rooms and every-dimension-lands checks are skipped for that fixture. Its narrow gap is also still read by the IMAGE tracing as a 0.30 m door, which stays in the plan as a traced opening (asserted, not changed: M.1d must not change image detection).
    - Safari, Firefox and a real phone.
  - **Existing test lines changed:** `test-pdf-openings.ts` only — the plan-doors block that asserted M.1c's turn-round ("no door left hanging on its wall's b jamb") now asserts the new behaviour (d-bed1 and d-bath are drawn on the b jamb and stored with `hinge: "b"`, nothing mirrored, no note), and the header line describing the turn-round was rewritten. `checkDoorsReview` / `checkDoorsStudio` in `e2e-pdf-import.ts` take the file name so they can serve both door fixtures, and `toM` in `test-pdf-openings.ts` now passes `path` through (a rectangle leaf is found by path). **No test line asserted the old 1 cm typed rounding**, so item 1 changed none: `npm test` passed on the fixed code first time. `test-plan2d.ts`, `test-opening-edit.ts`, `test-persist.ts`, `test-takeoff.ts`, `test-units-store.ts` and `test-import.ts` only gained assertions.
  - **One behaviour worth knowing:** `tests/fixtures/models/table.zip` is rewritten once in this change (the committed copy carried a `Date.now()` stamp). From now on `writeFixtures()` produces the same bytes every run, so an e2e leaves no diff — verified by writing it twice and by `git status` after `e2e-import3d.ts`.

- **M.2b (DONE; not committed; 2026-10-13): phantom openings dropped, recalibration in the studio, and the PDF's printed dimensions carried in as takeoffs.** CLAUDE.md has the rules (section "Recalibrating, PDF dimension rows, phantom openings (step M.2b)"). Checks, all passing against `npm run dev` on port 3000 from this checkout (cwd `/Users/rachitmittal20/Atrium-v2`, `next-server (v16.3.4)`; pid 9154 for the first rounds, 16326 after the cold build restarted it): `npm test` (38 suites, new `test-calibrate.ts` and `test-pdf-takeoffs.ts`), `npx tsc --noEmit`, a COLD `perl -e 'alarm 300; exec @ARGV' npm run build` — dev server stopped and `.next` deleted first — which compiled in 3.9 s and finished in 10.8 s wall clock, well under the 5-minute cap; the dev-hook grep (`clean`, `__calibrateStore` included); and `scripts/e2e-calibrate.ts` (new), `e2e-pdf-import.ts`, `e2e-takeoff.ts`, `e2e-units.ts`, `e2e-studio.ts`, `e2e-walk.ts`, `e2e-import3d.ts`: each exit 0 on the final tree. **Four flakes on the way, all written up in the flake-hunt item in section 22 before being rerun**, none reproducible on a rerun: `e2e-import3d.ts` once, and then `e2e-studio.ts` (390 draw), `e2e-walk.ts` (`__walkDebug` missing) and `e2e-pdf-import.ts` (a wall said "Edited" on the second file) in one sweep that ran all seven back to back against a just-restarted server with a cold `.next`. Run them one at a time, and warm the routes after restarting `npm run dev`.
  - **What M.2b added:**
    - `snap.ts`: a traced opening under 0.45 m with no PDF opening near it is DROPPED where one contiguous run of the PDF's own walls covers its span with no PDF opening in it; `Coverage.droppedOpenings` and the `coverage-dropped-line` sentence on the review screen. An opening on a traced wall never reaches that test.
    - `src/lib/plan/calibrate.ts` (pure): `calibrateFactor`, `scalePlan`, `calibrationProblem`, `factorPercent`, `planExtent`. `Plan.calibrations?`, `planStore.calibratePlan` (one undo step; `edit()` gained a `keepMarks` option, used only here, so a rescale marks no wall "Edited").
    - `src/store/calibrateStore.ts` (never saved), the picking path in `PlanCanvas` (before any tool), the overlay, the "Set scale…" link beside the 2D scale bar and the panel's button, and `CalibrateDialog.tsx` (a native `<dialog>`: focus trapped, Escape closes). The studio page opens the 2D pane when picking starts; `refit` runs after Apply.
    - `Takeoff.source?: "pdf"` and `approximate?: true`, `src/lib/pdf/takeoffs.ts` (pure), the carry at Build model, the "From PDF" group in `TakeoffPanel.tsx` (the table was hoisted to a module-level `RowsTable`, so a plan change can no longer remount a half-typed field), the CSV's trailing `source` column, and the summary's "N printed dimensions carried…" line.
  - **Covered by tests (Node):** `test-pdf-openings.ts` (plan-gaps: 7 openings where M.1d had 8, the dropped one reported at 300 mm), `test-calibrate.ts` (the factor and its four refusals; f then 1/f exact to 1e-9; room areas × f²; heights, sills, model size, rotation, references and overrides untouched; the stale hash; refusals on the result; one undo step with redo; an old plan), `test-pdf-takeoffs.ts` (11 rows from plan-filled all OK and "PDF exact"; plan-single-line's traced rows "Traced approximate"; a misprint Flagged with its override kept beside the measured value; ×1.01 flags every row and ×1/1.01 restores them; the CSV column; the autosave round trip), `test-persist.ts` (assertions added, none changed).
  - **Covered in the browser** (`scripts/e2e-calibrate.ts`, 1440 mouse and 390 real touch, every action real input, hooks only read): the From PDF group and its OK count; Set scale from the panel (which opens the 2D pane) and from the scale-bar link; two real clicks on the plan's own geometry; the preview text word for word; Apply scaling every wall by exactly the typed factor (1e-6 m) with heights kept; all 11 rows Flagged afterwards; Ctrl+Z restoring walls, openings, takeoffs and statuses in exactly one step; Escape after the first point leaving the plan and history untouched; the dialog opening focused with Tab trapped inside it; a true distance typed as `13'6"` at 390 with the stored factor checked to 1e-9 and the page exactly 390 px wide; and plan-gaps' 7 openings with the dropped-openings sentence.
  - **Autosave size:** 11 carried rows add about 211 bytes each — 5.6 kB against 3.3 kB for the same plan without them (`test-pdf-takeoffs.ts` prints it). The cap is 200 rows.
  - **Existing test lines changed (all of them):**
    - `scripts/test-pdf-openings.ts`, the plan-gaps block: `openings.total` was `t.planOpenings.length + 1` and is now `t.planOpenings.length`; `openings.traced` was `1` and is now `0`; its console line was reworded. Assertions on the dropped opening were added.
    - `scripts/test-takeoff.ts`: the two CSV assertions (`cells[0]` and `cells[1]`) gained the trailing `source` column.
    - `scripts/e2e-takeoff.ts`: the CSV header line and the first CSV row gained `,source` / `,studio`.
    - `scripts/test-persist.ts`: assertions added, none changed.
  - **Not covered:** no real CAD PDF was read (`test-plans/` holds only images, and the e2e says so when it finds no .pdf there); the Basis and Status columns of the From PDF table are only reachable by scrolling the table sideways in its own box (M.2a's layout), so the browser test reads the group heading's counts and each row's `data-status` rather than the badges' pixels; the dialog is checked for focus trapping, not for a full keyboard-only walk from the tool rail; no test covers a calibration while walking, or two calibrations in a row; `scalePlan` is checked on the sample and plan-filled, not on a plan with imported model PARTS moved (their transforms are in the model frame and are not scaled, which is the intended behaviour but is untested).

- **M.2c (DONE; not committed; 2026-10-14): the imported drawing as a 2D background, kept aligned through Set scale, and "Rescaled" labels.** CLAUDE.md has the rules (section "The drawing under the 2D plan, and Rescaled labels (step M.2c)").
  - **Checks**, all on the final tree:
    - `npm test`: 38 suites; new `test-background.ts`.
    - `npx tsc --noEmit`.
    - A COLD `perl -e 'alarm 300; exec @ARGV' npm run build`, with the dev server stopped and `.next` deleted first: compiled in 5.9 s, 16 s wall clock.
    - After that build, the dev-hook grep (with `__background`, `__scene3d` and `__walkDebug` added) and the CDN grep: both `clean`. The layer's code is in the bundle (`bitmaprenderer` is found), so the hook grep is clean because of the guard, not because the code was dropped.
    - Then `npm run dev` restarted from this checkout (`next-server` pid 5363, cwd `/Users/rachitmittal20/Atrium-v2`, nothing else driving port 3000). All nine e2e suites ran ONE AT A TIME, each exit 0 **first time**, with `/studio` probed before each: `e2e-background` 29 s, `e2e-calibrate` 15 s, `e2e-takeoff` 20 s, `e2e-pdf-import` 64 s, `e2e-units` 24 s, `e2e-studio` 196 s, `e2e-walk` 21 s, `e2e-import3d` 155 s, `e2e-offline-ocr` 22 s.
    - `npx eslint src/` still reports the same 12 problems as HEAD; none is in a file M.2c touched.
  - **One incident on the way**, written up under section 23: a `flake-hunt --tag=after` run from F.1 was still driving the same dev server while M.2c was edited. Five of its failures are logged there. The machine then restarted, clearing `/tmp`, and every check above was rerun from scratch afterwards.
  - **What M.2c added:**
    - `Plan.background?: { assetId, kind, page?, mapping }` and `Affine` (`types/plan.ts`).
    - `planStorage` reads `background` strictly and drops a bad one, never the plan.
    - `planStore.setBackground` / `clearBackground` are one undo step each.
    - `calibratePlan` writes the scaled mapping in its one step.
    - `src/lib/background/mapping.ts` (pure): `apply`, `compose`, `invert`, `scaleAbout`, `pdfVectorMapping`, `rasterMapping`, `buildMapping`.
    - `src/lib/background/keep.ts`: `keepDrawing`, the I.1a asset store at Build model, plus the note when storage is refused.
    - `PdfInfo.pageSize`.
    - `calibrate.ts`: `scalePlan` scales the mapping, and `rescaledText` gives the label.
    - `src/store/backgroundStore.ts`: view settings in localStorage `atrium.background`, and the drawing's load state.
    - `src/workers/background.worker.ts`: pdf.js renders a page region to an ImageBitmap and cancels the stale task.
    - `src/components/plan2d/BackgroundLayer.tsx`:
      - an `<img>`, or a `<canvas>` (bitmaprenderer), behind the now-`relative` SVG, placed by one CSS matrix;
      - a render 300 ms after the camera settles, capped at 4096 px, never asking for the same region twice;
      - the dev hook `window.__background`.
    - `DrawingControls.tsx`, beside Set scale… in the 2D pane and in the panel's new Drawing section (with Remove drawing and the missing-file message).
    - `PlanPanel` takes `view2d`, so the section is hidden while only 3D shows.
    - Rescaled text in `WallPanel`, `OpeningPanel` and `TakeoffPanel` (the "PDF exact" basis cell and the From PDF heading).
  - **Covered by tests (Node, `test-background.ts`):**
    - **Stored mapping, PDF:** every PDF wall end, from the PDF's own lines read by `walls.ts` and taken back to points, lands on a true wall end and on a built-plan wall end. Worst cases: plan-filled 0.0003 mm, plan-rotated 0.0004 mm, plan-imperial 0.0000 mm (allowed 0.5 mm).
    - **Stored mapping, image:** on `public/samples/sample-plan.png`, each house corner measured from the image's own wall bands lands within one raster pixel (10 mm, the stated tolerance) of the plan's corner: 0.00 mm upright, 0.08 mm turned 3° (deskewed by the pipeline).
    - **FAILING FIRST:** run against `calibrate.ts` with the mapping line taken out, it failed with `with the fix the same PDF point maps to the scaled plan point within 1e-9 (worst 6.40e-1 m)`; the drift is 4.76% (= 1 − 1/1.05) of the distance from the origin. With the fix: 4.0e-15 m, wall ends within 0.0003 mm, also about another origin.
    - **Store:** setBackground and clearBackground are one undo step each with redo; calibratePlan carries the mapping in its one step and undo restores it exactly.
    - **Autosave:** it holds only the descriptor (120 bytes, 4 keys, no bytes; a 200 kB file adds under 400 bytes). Old plans load with no field; five kinds of malformed descriptor are dropped and the plan kept.
    - **keepDrawing:** uses the I.1a id rule. Refused storage gives exactly "The drawing could not be kept for the background." and no background.
    - **Asset load state:** a missing asset, or storage that throws, reads as "missing"; a stored one as "ready".
    - **Render region:** k = camera px per point × devicePixelRatio, inside the page, never over 4096, null off screen.
    - **Rescaled text:** none for zero calibrations, "Rescaled x1.0234" for one (1.0234) and for two (1.02 × 1.0033), and through the store ×1.02 → ×1.0033 → undo → undo, gone at the end.
    - `test-persist.ts` gained assertions only.
  - **Covered in the browser** (`scripts/e2e-background.ts`, not in `npm test`; real file input, clicks, wheel, keys and taps; hooks only read; no blind sleeps, every wait a named `e2e-helpers` condition):
    - **plan-filled at 1440:**
      - no drawing and no Drawing section in the 3D view;
      - in 2D, the toggle and slider in the pane and in the panel, starting at 50%;
      - **alignment in the DOM:** every on-screen wall end, taken back through the stored mapping, the bitmap placement and the element's computed CSS transform, lands within 0.0013 px of the camera's own drawing (allowed 1 px);
      - **alignment in the pixels:** with the SVG hidden and the drawing at 100%, the drawing's dark wall bands are centred on the plan's walls within 0.56 px over 53 crossings (allowed 1 px);
      - a 200 px crop around the longest wall differs between drawing on and off by a mean RGB difference of 11.03 (threshold 2);
      - the slider by keyboard: 50% → 40%, the computed opacity 0.4, the panel slider agrees, and localStorage holds `{ visible: true, opacity: 0.4 }` while the plan holds no opacity;
      - four quick wheel steps, 81.5 → 167.4 px/m: **exactly one** render after it settled (1 → 2, nothing pending); still aligned, 0.48 px in the pixels;
      - a Length takeoff by two real clicks on the drawing's wall ends, each snap read as "endpoint" before the click: 3000.000 mm against the printed 3000 mm (allowed 1 mm);
      - Set scale ×1.02 by two clicks and a typed distance: the mapping's a, d, e, f are scaled by the stored factor (1e-12), still aligned (0.0018 px DOM, 0.56 px in the pixels), "From PDF (11) · 11 flagged · Rescaled x1.0200", a wall "Read from PDF · Rescaled x1.0200", a door "Read from PDF · Rescaled x1.0200 · Default height";
      - Ctrl+Z restores the walls and the mapping exactly, aligned at 0.82 px, and the heading loses "Rescaled";
      - a reload keeps the drawing and the opacity;
      - after `indexedDB.deleteDatabase("atrium-assets")` and a reload, the panel says "The PDF this plan was imported from isn't stored in this browser. Import it again to see the background.", nothing is drawn, the plan is intact and there is no console error.
    - **390 with real touch:** the pane's controls are inside the viewport and 44 px tall, aligned (0.42 px in the pixels, 26 crossings), toggled off and on by tap (difference 9.51), and the page is exactly 390 px wide, also with the Plan details sheet open on its Drawing section.
    - **plan-scanned.pdf** (raster route, scale set by hand) and **03_with_dimensions.png**: the same toggle, slider, drawing kind, DOM alignment (0.0017 / 0.0005 px), pixel alignment (1.00 / 0.90 px; allowed 2 px, because the plan's walls there are TRACED from the picture and good to about a raster pixel) and on/off difference (11.95 / 8.64).
    - A Set scale whose refit leaves the same region of the page at the same pixels per point renders **nothing** (0 renders), because the bitmap on screen is placed in points. The suite waits for "the layer holds the plan's mapping and nothing is pending" rather than a render, and the alignment checks prove the placement.
  - **Screenshots** (`/tmp/studio/`):
    - `background-on-1440.png`: 2D only, plan-filled under the plan at 50%. The drawing's own large room names show grey behind the plan's smaller labels and overlap them ("Bedroom 1" twice, offset). Its printed dimension text sits beside the carried From PDF takeoff labels and is overlapped by them in places. The top dimension's text ("4000 mm") is cut by the top edge of the pane. The panel shows the Drawing section at 50%.
    - `background-takeoff-1440.png`: zoomed in on the bathroom's east wall with "Length 1: 3.000 m" drawn along it and the "wall end" snap label. The Length | Area | Wall bar covers the top-left of the pane, and the drawing's "3000 mm" text sits beside the takeoff.
    - `background-rescaled-1440.png`: after Set scale ×1.02; the From PDF labels read 4.080 m, 3.060 m and so on, and the studio's own "Length 1" now reads 3.060 m, its label printed over the Bathroom label. The panel shows the Summary (net area 77.7 m²). The wall and door labels with "Rescaled" were read and cleared before this shot, so they are not in it.
    - `background-390.png`: the phone's 2D plan, small at that width. The Drawing toggle and slider sit in a row above "Set scale…" (the row wraps upwards), clear of the plan. The carried takeoff labels and the drawing's text overlap heavily at this zoom.
  - **NOT covered:**
    - **No real CAD PDF was tested**: `test-plans/` has none, and every fixture is synthetic.
    - Pinch zoom and pan re-render counts (only the wheel at 1440 is counted).
    - Cancelling an in-flight render in the browser (the worker's cancel path and the id check are not forced by any test).
    - The 4096 px cap reached in the browser (Node only).
    - devicePixelRatio above 1 (the suite runs at 1).
    - Storage refused at Build model in a browser (Node only).
    - A drawing from page 2 of a multi-page PDF.
    - plan-rotated, plan-imperial and a tilted image in the browser (Node only).
    - An EXIF-rotated photo.
    - The panel's slider at 390 (only shown).
    - "Traced, approximate · Rescaled" in the browser (Node checks the text).
    - Safari, Firefox and a real phone.
  - **Existing test lines changed:** none. `test-persist.ts` only gained assertions, and `package.json`'s test script gained `test-background.ts`.
  - **Choices worth knowing:**
    - "Hidden in 3D" is read as: the drawing is drawn only in the 2D pane, and the panel's Drawing section is shown only while the 2D plan is.
    - A malformed stored background is dropped, not the plan.
    - The image route's object URL is made once per drawing and never revoked (a `ponytail:` comment says so).

- **L.1 (DONE; not committed; 2026-10-14): 2D labels no longer overprint, a Labels setting, and the Takeoff mode bar in its own strip.** CLAUDE.md has the rules (section "Labels never overprint (step L.1)").
  - **Failing first.** `scripts/e2e-labels.ts --baseline` (the rectangle reader `readLabelRects`, reading every label's `<text>` from the rendered SVG) on the tree BEFORE this step: the sample plan with a Length takeoff and three Wall takeoffs on the partition, at five zoom levels (out 2, fit, in 2, 4, 6): **11 overlapping pairs** over 13 labels per level (3, 3, 3, 2, 0; every pair among the three partition labels, e.g. "North wall, left face: 3.850 m" ⟷ "North wall, centre line: 4.000 m"). The same reader on the new tree: **0 pairs** at all five (12 labels: one of the 13 is no longer drawn at that spot). The pure `test-label-layout.ts` covers the same inputs without a browser.
  - **Checks**, all on the final tree: `npm test` (39 suites; new `test-label-layout.ts`); `npx tsc --noEmit`; a COLD `perl -e 'alarm 300; exec @ARGV' npm run build` with the dev server stopped and `.next` deleted first (compiled in 5.2 s, 14.6 s wall clock); after it, the dev-hook grep (with `__plan2d` in the pattern, as it has been) and the CDN grep both `clean`; `npx eslint src/` still reports the same 12 problems (6 errors, 6 warnings) as HEAD, none in a file L.1 touched. Then `npm run dev` restarted from this checkout (`next-server` pid 22324 for the e2e sweep, cwd `/Users/rachitmittal20/Atrium-v2`, nothing else driving port 3000), and `e2e-studio` 187 s, `e2e-walk` 23 s, `e2e-import3d` 179 s, `e2e-offline-ocr` 24 s, `e2e-background` 29 s, `e2e-calibrate` 16 s, `e2e-takeoff` 24 s, `e2e-units` 32 s, `e2e-pdf-import` 71 s and the new `e2e-labels` each exit 0 on the FINAL tree, one at a time, with `/studio` probed before each. **Four runs failed on the way and were logged in section 23 ("Logged during L.1") before being rerun**: three `e2e-takeoff` and one `e2e-studio`. None was a flake: each was the Takeoff strip or the Labels control moving or covering the plan, and each is fixed in the product, not in a test (no existing assertion was changed). The dev server was also wedged once at the start (100% CPU, not answering: the F.1 cause 4 livelock) and restarted; the first sweep's server was stopped and restarted for each fix.
  - **What L.1 added:**
    - `src/lib/plan2d/labelLayout.ts` (pure): `layoutLabels`, the priority table `PRIORITY`, `wrapLabel`, `estimateWidth`.
    - `src/lib/plan2d/labels.ts` (pure): `buildLabels`, `toLayout`, `resolveLabels`, `scaleBarObstacle`, `effectiveDetail`, `shows`, `keepsLayout`.
    - `src/store/labelsStore.ts`, `src/components/plan2d/{LabelControls,LabelText}.tsx`.
    - `PlanCanvas.tsx` places room names, areas, model names and takeoff labels through the pass and draws leader lines; `TakeoffLayer.tsx` no longer places its own labels; the Takeoff mode bar is a strip above the canvas and the camera moves with it.
    - `scripts/test-label-layout.ts` (in `npm test`), `scripts/e2e-labels.ts` (not in `npm test`).
  - **Covered in the browser** (`e2e-labels.ts`, real input, every wait a named condition; `data-labels-settled` after two frames for a camera change): at 1440 and 390 with `plan-filled.pdf`, the drawing on and off, m², mm² and sq ft, Full and Compact, five zoom levels, three Wall takeoffs on the partition, a rescale by 2%, a long takeoff name and a crowd of 17 takeoffs on one spot: **zero intersections among every visible label's real rectangle**; every real rectangle inside the one the layout reserved for it; nothing partly outside the pane; the page's "N hidden" equal to the layout's hidden list; the default under the drawing Compact and Full without it, a default never stored, a chosen setting kept through the drawing toggling and through a reload; Off keeps only the selected takeoff's label; the mode strip's rectangle and the canvas's do not intersect, nothing covers the canvas's corner, and at 390 it wraps onto a second row inside the viewport; the Labels control at least 44 × 44 px and inside the viewport; the page exactly 390 px wide.
  - **Hidden counts, honestly:** 0 in every state of the matrix and the zoom sweep: this layout always found room by stacking vertically for these inputs. The hidden path is covered in the browser only by the crowd step (14 more takeoffs on one spot: 25 labels visible, **11 hidden and counted**, the selected one still there), and in `test-label-layout.ts`.
  - **Screenshots** (`/tmp/studio/`):
    - `labels-on-1440.png`: Full, drawing off, 22 labels, none touching another, 0 hidden. The three partition takeoffs are on three lines, the moved ones with a short leader. Several labels still sit on top of the plan's own lines (the dashed takeoff lines, a window frame): label over geometry is not what the pass models.
    - `labels-compact-drawing-1440.png`: the default under the drawing. Room areas and the three takeoffs only; the carried PDF dimensions are gone. The drawing's own printed "Bedroom 1" and "Living room" show through at 50% right behind our "14.8 m²" areas: the layout cannot see text inside the background drawing.
    - `labels-390.png`: Full, drawing off, 23 labels, 0 hidden, none overlapping each other. "PDF 10000 mm: 10.000 m" runs under the zoom buttons (the control buttons are not obstacles) and is clipped there. The Labels control (a select) sits beside "Set scale…".
  - **NOT covered:**
    - A label over the plan's walls or over the drawing's printed text; the zoom buttons and the bottom control row are not obstacles, so a label can sit under them.
    - A room too small for its label is dropped by the old "does it fit" rule and is not counted as hidden.
    - The freeze while a drag read-out is live (code only: the e2e drags still pass, no label assertion is made during one), and the real 12 px pan rule in a browser (the unit test covers it).
    - The `<select>` is driven by `selectOption` at 390, not by a native picker; the taps in that test are for the strip and the takeoffs. Safari, Firefox, a real phone, and a font or text size other than the app's.
    - Wall length, selected-wall and opening labels are not drawn (priorities are reserved for them). No per-label dragging; 3D is untouched.
    - A shortened (ellipsis) label is covered by the unit test only; the browser test covers a wrapped one with its tooltip.
  - **Existing test lines changed:** none. `package.json` gains `test-label-layout.ts`.

- **L.1b (DONE; not committed; 2026-10-15): controls are obstacles to labels, every label has a backing plate, and a room too small for its label is counted as hidden.** CLAUDE.md "Labels never overprint (step L.1)" has the rules (the L.1b bullets are marked).
  - **Failing first.** `scripts/e2e-labels.ts --baseline-controls` on the L.1 tree (plan-filled.pdf, 390, touch, Full): **1 label under a control** — "PDF 10000 mm: 10.000 m" at x 214–355, y 214–228, under the zoom-out button (x 342–390) — saved as `/tmp/studio/labels-baseline-controls-390.png` (the label is cut off at the button). The same read on the new tree, in every state: 0.
  - **Checks**, all on the final tree: `npm test` (39 suites; `test-label-layout.ts` gains obstacles and too-small-room cases); `npx tsc --noEmit`; a COLD `perl -e 'alarm 300; exec @ARGV' npm run build` with the dev server stopped and `.next` deleted first (compiled in 4.2 s, 10.8 s wall clock); after it the dev-hook grep (with `__background`, `__plan2d`) and the CDN grep both `clean`; `npx eslint src/` the same 12 problems as before L.1 (6 errors, 6 warnings, none in a file L.1b touched). Then `npm run dev` restarted from this checkout (pid 30311, cwd this checkout, nothing else driving port 3000) and, each with `/studio` probed first: `e2e-labels` (27 s), `e2e-takeoff` (19 s) and `e2e-studio` (149 s) exit 0 first time; `e2e-background` failed twice for one reason and passed (22 s) after the test-helper fix (section 23, "Logged during L.1b").
  - **What changed:**
    - Obstacles: `data-plan-obstacle` on the zoom column, "Set scale…", the Labels control, "N hidden" and the Drawing group; `PlanCanvas` measures them (layout effect + `ResizeObserver`) and passes them to `layoutLabels` as kind `control` (priority 100, `fixed`, grown by `PAN_KEEP_PX`). `layoutLabels` now places any fixed label exactly at its anchor, with no clamp.
    - "N hidden" is its own `pointer-events-none` element; the explanation moved into the Labels select's `title`.
    - Plate: the `#label-plate` filter, applied in `LabelText`.
    - Too-small rooms: `PlanLabel.tooSmall` / `Label.tooSmall`; `buildLabels` no longer drops them; `layoutLabels` hides them (unless off screen) and so counts them.
  - **Covered in the browser** (`e2e-labels.ts`, in every state at 1440 and 390, the drawing on and off, three units, Full and Compact, five zooms, a crowd): no visible label touches any control (read by test id, with the `data-plan-obstacle` count asserted); after a window resize 1440×900 → 1100×700 → back, the controls are re-measured and the check holds; zoomed to 5 px/m the four rooms' names and areas are in `__plan2d.labels.hidden`, in the "N hidden" count (14 hidden, 9 visible) and not drawn, and none is hidden for size at fit; the plate: with the drawing at 100% the largest difference inside a room-area label's box (non-text pixels) is **7/255** with the plate and **140/255** with the filter removed (the same boxes, so the test cannot pass vacuously).
  - **Screenshots** (`/tmp/studio/`): `labels-baseline-controls-390.png` (before: the 10000 mm label cut off by the zoom buttons). `labels-390.png` (after): the same label sits above the zoom column with a plate, nothing under any control, 23 labels, 0 hidden. `labels-compact-drawing-1440.png`: the "14.8 m²", "36.9 m²" and "8.1 m²" labels are on plates and the drawing's text no longer shows through them; the drawing's large "Bedroom 1" and "Bathroom" prints still show around the small plates, with a bite taken out where a plate lies on them.
  - **Counts:** 0 hidden in the usual states again; 14 hidden zoomed out (8 of them the rooms' labels); 10 hidden in the crowd of 17 takeoffs (it was 11 before the obstacles).
  - **NOT covered:** a control that moves without changing size and without the pane resizing (nothing in the studio does); a label passing under a control during a pan before it settles (the plate and layout are for the settled state); the hint bars (Measure, Wall, Door, Window, Set scale) and the drag message are not obstacles; only Chromium; no real phone.
  - **Existing test lines changed:** one style string in `e2e-background.ts` (it also hides `[data-label]`; see section 23). `e2e-labels.ts` (new in L.1) now reads the "N hidden" tooltip from the select.

- **P.1 (DONE; not committed; 2026-10-15): takeoff points snap to the PDF drawing's own corners, line ends, midpoints and lines.** CLAUDE.md has the rules (section "Snapping to the drawing (step P.1)").
  - **Checks**, all on the final tree:
    - `npm test`: 40 suites, new `scripts/test-snap-index.ts`; `test-persist.ts` gained assertions only.
    - `npx tsc --noEmit`.
    - A COLD `perl -e 'alarm 300; exec @ARGV' npm run build` (dev server stopped, `.next` deleted): compiled in 3.9 s, 11 s wall clock.
    - After it, the dev-hook grep and the CDN grep: both `clean`. The new code is in the bundle ("Reading drawing for snapping" is found in two chunks), so clean means guarded, not dropped.
    - Then `npm run dev` restarted from this checkout (pid 73843, cwd `/Users/rachitmittal20/Atrium-v2`), nothing else driving it. All eleven suites ran ONE AT A TIME with `/studio` probed 200 before each, each exit 0 first time on that server: `e2e-snap` 22 s, `e2e-background` 23 s, `e2e-takeoff` 18 s, `e2e-calibrate` 11 s, `e2e-labels` 23 s, `e2e-pdf-import` 61 s, `e2e-units` 26 s, `e2e-studio` 151 s, `e2e-walk` 19 s, `e2e-import3d` 149 s, `e2e-offline-ocr` 20 s.
    - **One failure on the way, a product regression and not a flake.** On the first sweep (server pid 72475) `e2e-background` failed at its wall-end takeoff: a buried drawing corner outranked the wall's centre-line end. It was logged in section 23 before anything was changed. Fixed in `snapIndex.ts` (buried points are dropped), and the whole sweep was then rerun from the start.
  - **What P.1 added:**
    - `src/lib/pdf/snapIndex.ts` (pure, worker-safe): `buildSnapIndex`, `indexForPage` (null for a scanned page), `drawingCandidates`, the cap note and the two status texts.
    - `background.worker.ts`: an `index` message that extracts the page and builds the index off the main thread.
    - `src/store/drawingSnapStore.ts`: loading, the cache per asset and page, release on clear, and the disabled note.
    - `snapTakeoffPoint` gained the `drawing` source and the new priority tiers; `SnapKind` gained `drawing-corner | drawing-end | drawing-mid | drawing-edge`.
    - `takeoffStore`: `DRAWING_PX = 14`, `drawingSource`, `draftSnaps`.
    - `Takeoff.drawingSnaps` and `DrawingSnapKind` (`types/plan.ts`); `planStorage` reads them strictly and drops a bad list, keeping the takeoff.
    - `rows.drawnExact`: such a takeoff's basis is "PDF exact".
    - `TakeoffLayer`: the marker words and the bar's status line (`takeoff-drawing-snap`, `data-status`, `data-points`).
    - `BackgroundLayer`: only its reply switch (the worker's reply union grew).
  - **Covered by tests (Node, `test-snap-index.ts`):**
    - **Wall corners.** plan-filled, plan-lines and plan-rotated: every visible wall polygon vertex in the truth (82 of the 92) is an indexed corner, worst 1.05e-5 mm (allowed 0.01 mm). The 10 vertices under another wall's fill are not snap points on the filled pages; on plan-lines, which strokes the same polygons, they are real line crossings and stay.
    - **Hatching.** plan-clutter's 193 hatch lines are all skipped. The index is exactly the index of the page without them: 397 points, none from a hatch line, and no hatch line is an edge.
    - **Exactness.** A query 3 px from a corner returns that corner exactly.
    - **Priority, each with a competing nearer candidate:** face corner > drawing corner/end (the nearer of the two) > centre-line end > jamb > wall midpoint > drawing mid > drawing edge > grid.
    - **Tolerance at the boundary, through the store:** 14 px (mouse) and 44 px (finger), just inside and just outside. Alt keeps the raw point with no kind; a Shift point is stored with no drawing kind.
    - **FAILING FIRST:** two clicks 3 px outside the ends of a printed "3000 mm" chain dimension (both ends are drawing corners, 0.9 m from any wall) measure 3100.000 mm without drawing snaps, 100 mm wrong, because both land on the grid. With them: 2999.999892 mm, the PDF's corners exactly, kinds ["corner", "corner"], basis "PDF exact". The 0.0001 mm left over is pdf.js's float32 coordinates.
    - **Calibration ×1.05:** all 335 snap points move by exactly 1.05 about the origin (worst 5e-15 m). A query returns the moved corner, the takeoff scales and keeps its kinds, and it stays "PDF exact" with "Rescaled x1.0500".
    - **Speed:** a 50k-segment page indexes in about 290 ms and answers 1000 queries in 4.7 ms (stated budget 50 ms). The grid's answers equal a scan of every point.
    - **Cap:** 210,000 candidate points → 200,000 (ends before midpoints), with the note.
    - **Disabled:** a scanned page (plan-scanned's own extraction), an image background and a missing file give "Drawing snapping needs a vector PDF". A click while "Reading drawing for snapping…" still adds a point, and clearing the background releases the index.
  - **Covered in the browser** (`scripts/e2e-snap.ts`, not in `npm test`; real file input, mouse, wheel and keys at 1440, Chromium's touch input at 390; hooks only read; every wait named):
    - **Loading.** The snap worker's script is held back by a route, so "while loading" is certain, not a race. The bar says "Reading drawing for snapping…", and a click adds a point on the grid; then the index is ready with 335 points.
    - **The takeoff at 1440.** Two clicks 5 px away from the drawing's wall corners (6.9, 8.1) → (9.9, 8.1), the south wall's outer face, an offset copy of the printed "3000 mm", at 130+ px/m. Each hover shows the marker with the word "corner". The points equal the PDF corners (truth through the stored mapping) within 3.5e-4 mm, the value is 2999.9999 mm against 3000 mm, and the row's basis is "PDF exact".
    - **Alt-click** stores the pointer's own point, 36.9 mm from the corner, with the marker "free".
    - **Set scale ×1.0200, then again:** the points are within 3.6e-4 mm of the corners through the new mapping, the value is 1.0200 × 3000 mm (1.1e-4 mm off), and the first row reads "PDF exact · Rescaled x1.0200".
    - **390, real touch:** zoomed with the zoom buttons to 450+ px/m and panned with a one-finger drag; the two taps land on the corners (draft kind "corner"), within 3.5e-4 mm, 2999.9999 mm, and the page is exactly 390 px wide.
    - **plan-scanned.pdf and 03_with_dimensions.png:** the bar says "Drawing snapping needs a vector PDF", and a click still adds a point.
    - **test-plans/** has no .pdf files, so no row was printed.
  - **Screenshots** (`/tmp/studio/`, each taken after the drawing had finished rendering):
    - `snap-marker-1440.png`: zoomed in on the bathroom's south-east corner. The gilt draft runs along the south wall's outer face, with the marker circle at its east end, the word "corner" above it, and "Total 3.000 m · last 3.000 m" beside it. The drawing's own "3000 mm" dimension, its ticks and the carried From PDF dashed lines are below and to the right. The drawing's large "Bathroom" text shows through behind the plan's area label.
    - `snap-takeoff-1440.png`: the whole plan fitted, with "Length 1: 3.000 m" in gilt dashes along the bathroom's outer south face. Its label sits at the wall's right end, just above the drawing's printed "3000 mm" and the carried dimension line.
    - `snap-390.png`: the phone's 2D plan, the drawing faint under it. The gilt "Length 1: 3.000 m" is along the bathroom's south face, the carried dimension lines are dashed around the house, and the Drawing, Set scale and Labels controls are below the plan.
  - **NOT covered:**
    - **No real CAD PDF has been tested.** `test-plans/` has none, and every fixture is synthetic.
    - The marker's word on touch: a finger has no hover and lifting it clears the marker, so at 390 each tap's kind is read from the draft instead.
    - "mid" and "edge" snaps in the browser (Node only).
    - Clicks during loading at 390 (1440 only).
    - The cap note in the browser (Node only).
    - A missing asset in the browser (Node only; `e2e-background` covers the drawing's own missing-file message).
    - A worker that fails, a page other than 1, and a PDF with a full-page filled background.
    - The basis cell at 390 (the panel is in the sheet).
  - **Existing test lines changed:** none. `test-persist.ts` gained a block; `package.json`'s test script gained `test-snap-index.ts`.

- **U.1 (DONE; not committed; 2026-10-12): one units setting every length and area follows.** CLAUDE.md has the rules (section "One units setting (step U.1)"). Checks, all passing against `npm run dev` on port 3000 from this checkout (pid 9154, cwd `/Users/rachitmittal20/Atrium-v2`, parent `next dev`): `npm test` (29 suites, new `test-units-store.ts` and `test-units-everywhere.ts`), `npx tsc --noEmit`, `npm run build`, the dev-hook grep (`clean`), and `scripts/e2e-units.ts` (new), `e2e-takeoff.ts` (extended), `e2e-studio.ts`, `e2e-walk.ts`, `e2e-import3d.ts`, `e2e-pdf-import.ts`: each exit 0 on the final tree, no e2e flake.
  - **What U.1 added:**
    - `unitsStore` is the one source (`ftin` stays the stored key; `"ft-in"` is read as it). It is mirrored to `src/lib/units/current.ts` (`lenText`, `areaText`, `signedLenText`, `rangeText`, `sizeText`, `gridText`…), which the pure edit rules, Push/Pull and Move labels, the validator's warnings and the measure label use. In Node nothing sets it, so every old string is unchanged.
    - `format.ts` gained decimals (`STUDIO_DP`: metres 2, m² and sq ft 1), `niceScaleBarFor`, `lengthHint`, `sameLength` and `shouldCommit`. `useUnitFormat` is the components' hook.
    - A TopBar **Units** menu (real radios), the Summary's area switch (now m² | mm² | sq ft), the Takeoff panel's switches and the import review's dimension tables (mm | m | ft-in) are views of the one store.
    - Bare typed numbers are in the current unit in the wall, opening, item, scale and override fields and in Push/Pull's typed distance. Panels skip a typed value equal to the stored one.
    - The room list's note "Rows are rounded; the total is summed from exact values.".
    - The scale bar is in the unit (mm: 2000 mm; m: 2 m; ft-in: 5'-0").
  - **Audit** (before code; the fixed sites): `PlanPanel`'s own two-way helpers (m² | sq ft, decimal feet, never mm or ft-in), the wall, opening and item panels, PlanCanvas (draw, drag, door-width and room labels, scale bar, typed length), `formatMeasure`, PushPullOverlay and `pushpull.ts` labels, `itemToolStore` labels, `edit.ts` / `validate.ts` messages, the import dialog's plan size and 1.8 m figure, ScalePanel's plan size and manual length, the PDF coverage panel's lengths, DimensionCheck and the import Summary's thresholds.
  - **Guard test, failing first:** run on the tree as of the previous commit (`UNITS_ROOT=/tmp/atrium-old`, from `git archive HEAD`) it found **37** hard-coded unit texts in 15 files. On the fixed tree it finds **0**, and the allow-list is empty (an entry that matches nothing fails as stale; it caught my own: `parseTypedLength` moved to `src/lib/units/typed.ts`, outside the scanned folders).
  - **Build hang found and fixed on the way (the flake-hunt item has the timeline):** `npm run build` panicked in Turbopack, then stalled for 20+ minutes. A pristine `git archive HEAD` built in about 10 s and the changed tree did not, in isolated copies with their own `.next` (the hang is not the dev server); a layered bisect put it in the lib-only changes. Cause: `edit.ts` → `current.ts` → `format.ts` → `importFile.ts` → `new Worker(pdf.worker)` → `snap.ts` → `edit.ts`. `parseTypedLength` now lives in `src/lib/units/typed.ts`, re-exported by `importFile.ts`; the isolated build then took 10.7 s. Rule in CLAUDE.md: never import `importFile.ts` from `src/lib`.
  - **Covered by tests (Node), `test-units-store.ts`:**
    - The store persists and restores, an old saved value and `"ft-in"` load, garbled and blocked storage fall back, and length and area are independent.
    - 3.8 m is 3800 mm, 3.800 m and 12'-5 5/8" (your example "12'-6 1/4"" is 3.816 m; 3.8 m is 12'-5 5/8"). Typing `12'6` gives 3.81 m. Bare numbers are mm, m or feet. Areas read back.
    - The mirror's text in each unit, and Push/Pull's typed distance in the unit.
    - A field never writes what did not change: untouched, emptied, retyped and same-valued entries add no undo step in the helpers the panels use, and a real planStore wall at 2.7184 m shown as 2.72 m does not drift (one step, undone exactly).
    - The scale bar is 60–140 px at every scale from 5 to 500 px/m in each unit.
    - Room rows add to 74.6 while the exact total is 74.7.
  - **In the browser** (`e2e-units.ts`, 1440 mouse in Split and 390 real touch in 2D with the sheet open):
    - For mm / mm², ft-in / sq ft and m / m²: the Summary total, every room row, the 2D labels, the scale bar, the wall panel's three fields, the opening panel's four, a live drag label (the partition's end handle held 0.5 m south) and a Length and an Area takeoff row carry the right unit, and no text in those containers carries another length or area unit.
    - Typing in ft-in (`13'6` → 4.11 m after the length edit's 1 cm rounding; a bare `9` → 9 ft, 2.7432 m), and a bare number in mm.
    - Focus and blur on three fields, Enter on an untouched one, retyping the shown text and typing the same value another way add no undo step; 2.7184 m (shown 2718 mm) stays 2.7184.
    - The menu is a keyboard radio group (ArrowLeft/Right at 1440) and opens inside the viewport at 390 with the page exactly 390 px wide. The choice persists through a reload, and the Summary and Takeoff switches write the same setting the menu shows.
    - `e2e-takeoff.ts` gained the two cases: **mm²** (13,822,500 mm²; the room list and totals follow) and the **stale marker** (a takeoff on the partition, the partition dragged 0.3 m with the real mouse, 6 rows say "Walls have moved since this was measured", Mark as current clears the measured row only, its points unchanged).
  - **Screenshots** (`/tmp/studio/`):
    - `units-mm-1440.png`: Split with the window selected. The panel reads 1200 / 1200 / 900 / 5000 mm, the rooms are "14,822,500 mm²" … and the scale bar "2000 mm". In mm² the 2D label "Bedroom 1 / 14,822,500 mm²" is long and overlaps the takeoff's own "Area 1: 14,822,500 mm²" label, as takeoff labels already overlap room labels.
    - `units-ftin-1440.png`: the same in ft-in and sq ft (`3'-11 1/4"`, `159.5 sq ft`, `5'-0"`).
    - `units-menu-390.png`: the Units menu open over the phone's 2D plan, inside the viewport, Length and Area radios, m and m² chosen; the header wraps to two rows and the plan name truncates ("Two-bedroom h"), as it did with the three icons before.
    - `takeoff-stale-1440.png`: the stale marker.
  - **NOT covered / limits:**
    - The PDF reader's own notes in `src/lib/pdf` (e.g. "radius 0.45 m, outside 0.5–1.5 m", merge notes) are written once at read time in metres or mm, and the guard doesn't scan `src/lib/pdf`.
    - The import review's CSV stays in millimetres (it records the printed values).
    - The import dialog's file sizes follow the display unit, but its source-unit radios and its "It will be … m" size for a candidate unit were not browser-tested in mm or ft-in.
    - The Takeoff CSV and Copy table in each unit are tested in Node only, not at 390.
    - Walk mode's hints have no distances. 3D labels (Push/Pull, Move, Rotate/Scale) are tested in Node in each unit and in the browser only in metres, by the existing suites (an mm or ft-in pull was not driven in the browser).
    - The ft-in scale bar steps (1, 2, 3, 6 in, then 1, 2, 4, 5 × 10ⁿ ft) are my choice; 5 cm grid labels in ft-in say "1 15/16\" grid".
    - The snap grid itself is always 5 cm.
    - A bare number in the import review's override field is now in the chosen unit (it was metres).
    - A real phone, Safari and Firefox.
  - **Existing test lines changed:** `e2e-pdf-import.ts`: each browser context starts with `atrium.units` = mm (an init script), because those tables read millimetres to 0.1 mm and the new default is metres. Nothing else existing changed; `e2e-takeoff.ts` only gained cases.
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
- **CI (since C.1):** `.github/workflows/ci.yml` runs steps 1 to 3 of the list below on every push and pull request, on a clean Ubuntu machine: `npm test`, `npx tsc --noEmit`, the production build and both greps (lint is non-blocking). Browser e2e suites are still run by hand: see section 33.
- **Run before committing** (since 4.7c): `npm test`, `npx tsc --noEmit`, `perl -e 'alarm 300; exec @ARGV' npm run build` (this Mac has neither `timeout` nor `gtimeout`; since M.1d: a build that takes over five minutes means an import cycle or a hang, not a slow machine — a clean build is about 2 s. `npm test`'s `test-import-cycles.ts` catches the usual cause first), `grep -rlE "__studio3d|__pushPullDebug|__importDebug|__importPdf|__plan2d|__takeoffStore|__scene3d|__walkDebug|__background|__reviewRunaway|__runaway" .next/static || echo clean` (the last two since W.1) and `grep -rlE "cdn\.jsdelivr|unpkg\.com|cdnjs" .next/static || echo clean` (both must print `clean`, run after the build), and with `npm run dev` on port 3000 from THIS checkout (`lsof -i :3000`, then the process's working directory): `npx tsx scripts/e2e-studio.ts`, `npx tsx scripts/e2e-walk.ts`, (since I.1a) `npx tsx scripts/e2e-import3d.ts` and (since M.1a) `npx tsx scripts/e2e-pdf-import.ts` (since M.2a) `npx tsx scripts/e2e-takeoff.ts`, (since U.1) `npx tsx scripts/e2e-units.ts` and (since M.2b) `npx tsx scripts/e2e-calibrate.ts`, (since O.1) `npx tsx scripts/e2e-offline-ocr.ts` (since M.2c) `npx tsx scripts/e2e-background.ts`, (since L.1) `npx tsx scripts/e2e-labels.ts`, (since P.1) `npx tsx scripts/e2e-snap.ts` and (since W.1) `npx tsx scripts/e2e-pdf-watchdog.ts` (about 70 s: it waits out the real 60 s watchdog), all exit 0. Before a sweep, check nothing else is driving port 3000 (`pgrep -fl "flake-hunt|scripts/e2e-"`): in M.2c a `flake-hunt` run started during F.1 was still running and sharing the server (section 23). `npm run build` needs a working `.next`: if it stalls with no output, see the flake-hunt item. Do not edit source files while an e2e runs: the dev server hot-reloads mid-test.
- **On-demand tool (not a pre-commit check), since F.1:** `npx tsx scripts/flake-hunt.ts [--rounds=10] [--prod-rounds=5] [--phases=fresh,warm,prod] [--suites=…] [--tag=before]`. It takes over port 3000 (refusing to touch a server that is not this checkout), runs every e2e suite back to back for many rounds against a dev server restarted each round, a long-lived warm one and `npm run build && npm run start`, and prints failure counts by suite and server state with each failure's step, assertion and first console error. Logs in `/tmp/flake-hunt/<tag>/`. It never retries and never relaxes a check. A full matrix is about four hours.
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
- ~~Find the root cause of the occasional 390 px e2e timing flake.~~ Answered in step F.1 (section 23): the 390 cases were a blind wait before a scene hook and a tap whose selection had not landed, both now named ready conditions; nothing was retried away and no test was weakened.
- Clear the lint errors (PlanViewer.tsx, PlanModel geometry cache) before deploying.
- Import screen: setting the scale needs mouse or touch points; add a keyboard path (pick a wall from a list, type its length). Faint dark squares appear where translucent wall pieces overlap in the overlay.
- Test pinch zoom on a real phone after deployment, and test the import worker in Safari and Firefox.
- Room list rounds each area to one decimal, so the rows can add to 0.1 less than the total. Kept as is (the note under the list says so); step X.2's schedule, its CSV and the report sum totals from exact values too.
- Flake hunt: DONE, step F.1 (2026-10-14). Each of the eight logged one-off failures, its verdict and what changed are in section 23. `scripts/flake-hunt.ts` reproduces them on demand.
- A dev flag that opens 3D door leaves wide (for screenshots). `LEAF_OPEN` is a fixed 0.3 rad, so a 3D screenshot shows a leaf barely open.
- Decide the order after 5.3: landing page (Phase 8) before or after the catalog (Phase 6). The core editor, walkthrough, bird's-eye and recenter will be demoable by then.

## 23. F.1 — the flake hunt: findings (2026-10-14)

`scripts/flake-hunt.ts` (on-demand, not in `npm test`) runs the seven e2e suites back to back for many rounds against three server states and records every failure with its step, its assertion and its first console error. It never retries and never relaxes a check; no existing assertion or timeout was changed in this step, and no product behaviour outside the one fix in cause 3.

### What was run, and the numbers

**Before the fixes** — 10 rounds of all seven suites against a dev server restarted before every round (`.next` deleted before round 1, so every route compiled on demand), then 10 rounds against one long-lived dev server, then 5 against `npm run build && npm run start`:

| server state | failures | what they were |
| --- | --- | --- |
| fresh, restarted every round | **0 / 70** | nothing. Round 1 on a deleted `.next` was no slower than the rest: e2e-studio 151.8 s against a 150.7 s median |
| warm, one server for 10 rounds | **4 / 70** (3 in the measured phase, 1 in an earlier phase of the same shape) | one scene-hook read; three in the wake of a dev-server livelock |
| production, `npm run start` | **35 / 35** | by design: every suite reads development-only hooks |

The warm failures all came in rounds 3, 5, 8 and 10 — after twenty or more suite runs on the same server. The fresh phase, which restarts the server every round, never failed once.

### Causes

1. **Reading a scene hook after a blind wait — certain, reproduced.** Warm round 3: `e2e-studio` died with `TypeError: Cannot read properties of undefined (reading 'project')` at `checkOpenings3d` (`scripts/e2e-studio.ts:1924`), 1.5 s after the canvas appeared — `window.__studio3d` was not there yet. `<Canvas>` renders its children into a SECOND React root, from an effect, after an async renderer promise, so `__scene3d`, `__studio3d`, `__walkDebug` and `__importDebug` cannot exist before first render; 1500 ms was a guess, and under seven suites of software-GL load it is sometimes not enough. The same shape explains the logged `__walkDebug`, `__importDebug` and 390-draw failures. The 390 draw one is worth spelling out: `meshes()` returned `null`, and `null?.includes(id)` is `undefined`, so `assert.ok(undefined)` failed with the message "the 3D scene has a mesh for the new wall" and said nothing about the missing hook. **Fixed** by `waitForScene3d` and by two store-consistency waits (`sceneHasEveryWall`, `sceneHasEveryOpening`), each with a message naming what was missing.
2. **A route compiling on demand — ruled out.** 0 failures in 70 runs with a cold `.next`, and the cold round was no slower than the warm ones. Turbopack compiles these routes in a couple of seconds; it is not what broke anything. A per-suite `warmRoutes` was added anyway, because it costs one request and makes the first navigation's cost visible in the log.
3. **A real race in the app — one found, though not the one that was suspected.** The logged "Edited" failure (a wall's panel saying "Edited" on the second PDF in one browser) **never reproduced** in 140+ suite runs. But the window behind it is real and provable: `openInStudio` calls `loadPlan(built.plan)` and navigates, while the autosave writes 800 ms later, so for those 800 ms storage still holds the PREVIOUS file's plan, and the built plan survives only if the old document gets a turn to run `pagehide`. Any new document in that window — a reload, a hard navigation, Fast Refresh giving up — restores the older plan over the built one, and because plan-filled and plan-lines build geometrically identical plans, every other check passes and only the stale "Edited" mark gives it away. **Fixed** by `persistence.flushSavedPlan()`, called by `openInStudio` between `loadPlan` and `router.push`, so the built plan is in storage before anything can navigate. Proven by a deterministic store-level test in `scripts/test-persist.ts` (in `npm test`) that **failed first** with "with no wall left marked edited by the previous import", and by an e2e case in `scripts/e2e-pdf-import.ts` that imports plan-filled, edits a wall, imports plan-lines, builds, and checks the autosave already holds the built plan and that a reload right afterwards keeps it.
4. **`next dev` livelocks after a long run — certain, caught in the act.** In the warm phase, `e2e-studio` round 9 took **932 s** instead of 150 s and still passed; round 10 then failed with `page.waitForURL: Timeout 30000ms exceeded` (the Import-plan link), and the server stopped answering anything. A `sample` of `next-server` while it was wedged: the Node main thread parked in `_pthread_cond_wait` inside `next-swc.darwin-arm64.node`, with the Turbopack tokio workers at 103% CPU and 645 MB RSS, one minute after `/studio` had answered in 31 ms. It accepts connections and answers nothing. That is a Turbopack / `next dev` bug, not Atrium's, and it explains the logged cluster better than anything else: a back-to-back sweep of all seven suites is exactly when it happens, and the symptoms are whatever the suite was doing at the time — a navigation that never happens, a dialog that never opens, a PDF worker that will not start, a page whose JavaScript never arrives. **Mitigated in the harness**: `flake-hunt` probes `/studio` with curl before every suite and restarts the server, recording it as a restart rather than as a suite failure. **For a human: restart `npm run dev` between sweeps**, as the M.2b entry already advised.
5. **`__name is not defined`, a trap in the test harness itself — certain, mine, and worth writing down.** While wiring the helper I added `addInitScript(() => { const hide = () => …; … })`. tsx compiles these scripts with esbuild's keepNames, which wraps a named inner function as `__name(fn, "hide")`, and Playwright injects only the function's source — so the page threw `__name is not defined` 87 times in one run. With the page's own JavaScript dead, a 390 "Open in studio" tap did nothing and the navigation never happened: the logged symptom, exactly, from a cause that has nothing to do with the app. Injecting the stylesheet as a string fixed it. The rule is now in CLAUDE.md: never put a named inner function in anything handed to `page.evaluate`, `waitForFunction` or `addInitScript`.

Two harness bugs of my own were fixed on the way: `rm -rf .next` raced the dying dev server (ENOTEMPTY), and a Node `fetch` health probe reported a live server dead because its pooled keep-alive socket had gone stale during a 150 s suite — it now shells out to curl.

### Each logged failure, and its verdict

| # | logged failure | verdict |
| --- | --- | --- |
| 1 | 390 "Open in studio" tap did not navigate (e2e-pdf-import, M.1b) | **likely** cause 4 (a wedged dev server: the same `waitForURL` timeout was reproduced in e2e-studio round 10). Not the dev badge: measured at 390, the button sits mid-screen and `nextjs-portal`'s own box is 0×0, so `elementFromPoint` at the button's centre is the button. Cause 5 produces the same symptom but there is no record of page errors in that run. |
| 2 | e2e-import3d hung after its first dialog check (M.1b) | **likely** cause 4. A 20 s `waitForSelector` for the import dialog timed out the same way in warm round 5, with the server dead immediately after. |
| 3 | 390 "the Delete key removes it too" (e2e-studio, M.1a) | **likely** a tap whose selection had not landed: the line above it clicks `wall-delete`, which Playwright waits for, while the Delete key had no such wait. Now a named condition on `selectionStore.selectedId`. |
| 4 | `npm run build` panicked, then stalled 20+ minutes (U.1) | **certain**, and already fixed in U.1: an import cycle through the PDF worker's bundle. `scripts/test-import-cycles.ts` catches it. |
| 5 | `__importDebug` gone two steps after it worked (e2e-import3d, M.2b) | **cause (a) for the read; the disappearance itself is not explained.** Its effect's deps (`gl`, `camera`, `controls`) are stable, and `ImportedItems` never suspends (the asset cache is a zustand store, not a promise-thrower), so only a real unmount or a lost WebGL context fits. It did not recur in 140+ runs. `watchErrors` with `E2E_LOG_ERRORS=1` now prints the console error if it does. |
| 6 | 390 "the 3D scene has a mesh for the new wall" (e2e-studio, M.2b) | **certain**, cause 1: `meshes()` waited a blind 500 ms for `__scene3d` and then asserted on `undefined`. |
| 7 | `__walkDebug` missing at a clearance read (e2e-walk, M.2b) | **certain**, cause 1: a blind 1500 ms before the first hook read. (It is reported at the `clearance` helper's line because that is the call site in the stack.) |
| 8 | A wall said "Edited" on the second PDF (e2e-pdf-import, M.2b) | **not reproduced in 140+ runs; the window behind it is real and now closed** — cause 3. The counter-evidence in the old write-up (the module-level `started` flag) holds for a client-side navigation but not for a new document. |

### What changed

- **Product (one fix):** `flushSavedPlan()` in `src/store/persistence.ts`, called by `openInStudio` in `src/app/studio/import/page.tsx`. Nothing else: no detection, collision, walk input or assertion was touched, and the autosave payload is still `{ schema, savedAt, plan }`.
- **Tests:** `scripts/e2e-helpers.ts` (shared `warmRoutes`, `waitForHook`, `waitUntil`, `waitForScene3d`, `step`, `withSuiteTimeout`, `watchErrors`), all seven suites rewired to it, every blind wait before a hook or a mesh replaced by a named condition, a route warm-up and a step trace per suite, a suite-level timeout that names the step it died in, the Delete-key selection wait, the deterministic `checkBuildReachesStorage` in `test-persist.ts` and the F.1 case in `e2e-pdf-import.ts`.
- **Tooling:** `scripts/flake-hunt.ts`.

### Still unexplained

- Why `__importDebug` vanished mid-test in the M.2b run (failure 5).
- Which navigation let a restore land after Build model's `loadPlan` (failure 8). The window is closed either way.
- Why `next dev` livelocks inside `next-swc` after a long run of suites. It is reproducible (twice, both times around 60–65 suite runs on one server) but it is Next's bug, not ours.


### Logged during M.2c (2026-10-14): a flake-hunt run overlapping another step's edits

- **What was found.** While M.2c was being written, `npx tsx scripts/flake-hunt.ts --tag=after` (started 15:02 during F.1, run as `npm exec`, not by the M.2c session) was still running. It was in its warm phase, round 9 of 10, with the production phase still to come, against the same `npm run dev` on port 3000 that M.2c was editing and testing. It was found at 17:35, when stopping the server for the cold build made it restart `next dev` at once (pid 21756, parent `npm run dev` ← `flake-hunt.ts`).
- **Failures it logged in the overlap**, each with its step and server state (warm server, one `next dev` since its warm round 1):
  - warm-6 `e2e-import3d`, step "390 import 3D models", 17:06: `page.waitForSelector` timed out on `[data-testid="import-dialog"][data-kind="closed"]` (`confirmImport`).
  - warm-6 `e2e-takeoff`, step "1440 takeoffs", 17:08: a click on `camera-walk` timed out: "element is not stable".
  - warm-7 `e2e-import3d`, step "1440 import 3D models", 17:13: a click on `view-split` timed out.
  - warm-7 `e2e-takeoff`, step "1440 takeoffs", 17:14: a click on `tool-takeoff` timed out.
  - warm-9 `e2e-units`, step "390 units", 17:34:49: `ERR_CONNECTION_REFUSED` on `/studio`.
- **Verdicts.**
  - The four round-6 and round-7 failures are **almost certainly M.2c's own source edits hot-reloading the server under the suites**. They fall exactly in 17:03–17:15, when `PlanCanvas.tsx`, `PlanPanel.tsx`, `src/app/studio/page.tsx`, the plan store and the new stores were being written. Every symptom is an element that was remounting, unstable or missing. They are not product flakes.
  - The round-9 `e2e-units` failure is **certain**: the M.2c session stopped that server for the cold build at that second.
  - M.2c's own `e2e-background` development runs (17:15–17:30) also overlapped its suites.
- **Consequence:** the `--tag=after` results from about 17:03 onwards describe neither HEAD nor the M.2c tree and should not be counted. Its logs in `/tmp/flake-hunt/after/` did not survive (the machine's `/tmp` was cleared before M.2c finished), so the run cannot be re-read; rerun it if those numbers are needed.
- **Process rule added** to "Run before committing": check `pgrep -fl "flake-hunt|scripts/e2e-"` before a sweep, and never edit source while anything drives the dev server.

### Logged during L.1 (2026-10-14): four failures on the way, all product regressions, none a flake

Each was logged here with its step and server state before the suite was rerun, and each rerun was after a fix in the product. No existing assertion or timeout was changed. Every server below was `npm run dev` from `/Users/rachitmittal20/Atrium-v2` (checked with `lsof`), warm, `/studio` probed 200 first, `pgrep -fl "flake-hunt|scripts/e2e-"` empty, and no source file edited while a suite ran. (Between suites a few scratch scripts drove headless browsers against it to diagnose; they are deleted.)

1. **`e2e-takeoff`, step "1440 takeoffs" (Split), Wall check, `locator.waitFor` on `takeoff-wall-hover` timed out (`e2e-takeoff.ts:178`).** Server pid 19275 (after the cold build), the third suite on it (`e2e-background`, `e2e-calibrate` passed first). Length and Area, earlier in the step, had passed. **Cause:** the Takeoff mode bar, now a strip above the canvas, wraps onto a different number of rows per mode in Split's 520 px pane (55 px in Length and Area, 90 px in Wall), so the canvas changed height and the resize handler refitted the plan under the pointer: the test's `at(2, 4)` was stale.
2. **The same failure on the rerun, after a first fix.** Server pid 20208, the first suite on it. The first fix moved the camera by the strip's height change from a layout effect in `PlanCanvas`. A scratch script (not a rerun) showed the camera still lagging: `ty` 213.86 right after the click, 178.86 three frames later. `TakeoffBar` re-renders on its own store subscription, a commit `PlanCanvas` is not part of, so the effect ran a frame late. **Fixed** by having `TakeoffBar` report its height from its own layout effect (`onHeight`), so the shift is in the same commit and before the paint.
3. **`e2e-takeoff`, step "1440 takeoffs", the U.1 stale-marker check: "the wall really moved (one undo step more)" (`e2e-takeoff.ts:290`).** Server pid 20825. The test measures the partition's screen position with the strip showing, chooses Select (the strip goes away), then drags at that position. The strip leaving was an ordinary resize and refitted the plan. **Fixed** by the general rule: whenever the strip's height changes, from or to zero as well, the camera shifts by that amount, so the plan stays where it is on the page (the bar used to be an overlay, and no test or finger had to allow for the plan moving). `e2e-takeoff` then passed unchanged, at 1440 and 390.
4. **`e2e-studio`, step "390 wall runs": `null !== 'w-ME'`, "clicking w-ME selects that piece" (`e2e-studio.ts:519`).** Server pid 21139, the fifth suite on it. Everything before it had passed (1440 in full, and 390 "2D" and "select and edit"). **Cause:** the first Labels control was a segmented group 215 px wide. At 390 with the plan-details sheet open the canvas is 208 px tall, the control row reached x 327, and `elementsFromPoint` at the wall's midpoint (296, 255) gave `BUTTON plan-labels-off`: the tap pressed Off. **Fixed** by making the control a native 44 px `<select>`, about 130 px wide with its caption. `e2e-studio` then passed (187 s).

After the last fix every suite was rerun on the final tree, the whole sweep, one at a time: all exit 0 (listed in the L.1 entry).

### Logged during L.1b (2026-10-14/15): `e2e-background` failed on the pixel alignment after Set scale (twice, the same)

- **Failure.** `scripts/e2e-background.ts`, step "1440: Set scale by 2%: still aligned, labels say Rescaled", `inkAlignment` (`e2e-background.ts:206`): "1440 after Set scale: in the pixels, the drawing's wall bands are centred on the plan's walls within 1 px (worst 6.46 px over 50 crossings)". The DOM alignment check just before it (`alignment`) had passed, as had every check before this step.
- **Server state.** `npm run dev` pid 30311, cwd `/Users/rachitmittal20/Atrium-v2`, started a few seconds after the cold build (`.next` deleted); `/studio` probed 200 before the suite; `pgrep -fl "flake-hunt|scripts/e2e-"` empty; no source edited while it ran. It was the third suite on that server (`e2e-labels` and `e2e-takeoff` had passed first time just before it) and it ran for 8 s of the usual 26–29.
- **Rerun:** the same failure, 6.46 px again, so deterministic: a regression from L.1b, not a flake. **Cause:** the new backing plate is an SVG filter (`feFlood`), and Chromium paints a filter's flood even under `visibility: hidden`. `inkAlignment` hides the plan's SVG with exactly that to see only the drawing's ink, so the light plates at the labels' places covered the ink it measures (saved screenshot: light rectangles over the "Bedroom 1" print). Bisected by switching the filter off (suite passed). **Fixed in the test helper, not the product:** the injected style at `e2e-background.ts:149` now also hides `[data-label]` (a style string, no assertion changed). The plates are right in the product. Then `e2e-background` passed (22 s).

### Logged during P.1 (2026-10-15): `e2e-background` failed on the takeoff's wall-end snap (a product regression from P.1, not a flake)

- **Failure.** `scripts/e2e-background.ts`, step "1440: a Length takeoff on the drawing's wall ends" (`e2e-background.ts:404`): "no snap marker at the wall end after 5 s", seen `["drawing-corner", "takeoff", "length"]`. End (10, 5), the bathroom's 3000 mm dimension (10, 5) → (10, 8), pointer 0.03 m along the wall from that end at 167.4 px/m (5 px). Everything before it in the suite had passed (DOM alignment 0.0013 px, pixels 0.56 px, the wheel step's one render).
- **Server state.** `npm run dev` pid 72475, cwd `/Users/rachitmittal20/Atrium-v2`, started right after the cold build (`.next` deleted); `/studio` probed 200 before the suite; `pgrep -fl "flake-hunt|scripts/e2e-"` empty; no source edited while it ran. It was the second suite on that server (`e2e-snap` passed first, 25 s), and it failed after 12 s.
- **Cause (deterministic, so not rerun before the fix).** P.1's priority puts the drawing's corners and line ends above the walls' centre-line ends, with a 14 px reach. At the T-junction (10, 5) the bathroom partition (w-KM, 0.1 m) is drawn as a filled rectangle that runs on to x = 10.05, INSIDE the east wall's filled band; its two end vertices (10.05, 4.95) and (10.05, 5.05) are 0.054 m (9 px) from the pointer. They are vertices of the drawing's paths, but no one can see them: they are covered by the east wall's fill.
- **Fix (in the product, no assertion changed):** `snapIndex.ts` drops any point lying strictly inside (by more than 0.05 pt) a NARROW filled path (one whose box is at most 5 mm across), as a hidden 3D face is never a target (4.7c). Narrow only: a full-page white background fill must bury nothing. `test-snap-index.ts` (new in P.1) then checks every VISIBLE wall polygon vertex, and that every buried vertex is not indexed on the filled pages.
- **Rerun:** after the fix, the cold build, and `npm run dev` restarted (pid 73843), the whole sweep ran again from its first suite, and all eleven passed first time, `e2e-background` included (3000.000 mm, the wall-end snap read as "endpoint").

### Logged during Q.2 (2026-10-16): `e2e-pdf-import` failed on plan-dims-one-wrong's flagged row (a test bug in the new Q.2 expectation, not a flake)

- **Failure.** `scripts/e2e-pdf-import.ts`, the 1440 fixture loop, `checkTable` (`e2e-pdf-import.ts:616`): `plan-dims-one-wrong.pdf: "5000 mm" flagged` — `'ok' !== 'flagged'`. Every earlier fixture in the loop had passed (plan-dims-chain just before it). First run of the suite with E2E_WRITE_BASELINE=1, so it never reached the test-plans rows.
- **Server state.** `npm run dev` pid 64183, cwd `/Users/rachitmittal20/Atrium-v2`, started right after the cold build (`.next` deleted, build exit 0 in 12.6 s); `/studio` probed 200; `pgrep -fl "flake-hunt|scripts/e2e-"` empty; no source edited while it ran; the first suite on that server.
- **Cause (deterministic, so not rerun before the fix).** A Playwright probe of the review screen showed the reader right: the reason "10 of 11 printed dimensions agree within 5%; the other one does not and is flagged", and the row printed "5000 mm" on the 4 m line flagged at 4.0000 m. But the fixture printed "5000 mm" TWICE: the deliberately wrong label and the house's own 5 m dimension (x 11, y 0–5), which is OK. The new expectation picked rows by their printed text, so it found the genuine one first.
- **Fix (in the fixture, no product change, no older assertion changed):** the wrong label is now "5200 mm", a text no other dimension prints; `test-pdf-poche.ts` section 3b and the e2e's Q2 table name it.

### Logged during Q.2 (2026-10-16): `e2e-pdf-import` failed on plan-chatgpt-poche's wall count (an expectation taken from Node, not a flake)

- **Failure.** Second run (after the fix above), step "1440 plan-chatgpt-poche" (`e2e-pdf-import.ts:846`): `33 of 33 walls exact` — Chromium read `["32", "27", "5"]` (walls, exact, traced). Every fixture before it had passed, the twelve new synthetic ones included.
- **Server state.** The same `npm run dev` (pid 64183), its second suite; nothing else on port 3000; no source edited while it ran (the fixture fix above was made between the runs, with no suite running).
- **Cause (deterministic, so not rerun before the fix).** The row's numbers had been copied from the Node test. Node renders the page with @napi-rs/canvas, Chromium with its own rasteriser, so the TRACING differs, and so does the merge: in Node the merge falls back to a poor tracing and rule 8b uses the PDF alone (33 of 33, one free end); in Chromium the tracing is good enough that the merge keeps 27 PDF walls and 5 traced ones (33–123 mm from the PDF's lines, round the corridor and bathrooms), its validator is no worse than the PDF-only plan's, and rule 8b rightly does not replace it. A Playwright probe showed the rest of the review the same as Node's (13 of 13 openings, 12 dimensions OK, W4 named, the title block left out, the same eight rooms).
- **Fix (in the test, no product change):** the e2e row now asserts what Chromium reads; the test-plans baseline is taken from Chromium for the same reason (as asked). The Node test keeps Node's honest numbers.

### Logged during Q.2b (2026-10-17): `e2e-pdf-import` failed on plan-chatgpt-poche's wall count (the intended effect of the new merge choice, not a flake)

- **Failure.** First full run after the three Q.2b fixes, step "1440 plan-chatgpt-poche" (`e2e-pdf-import.ts:853`): `27 of 32 walls exact, 5 traced`. Chromium read `["33", "33", "0"]` (walls, exact, traced). Every fixture before it had passed, plan-stem-in-window's new Q.2b assertion and plan-levels included.
- **Server state.** The `npm run dev` left from Q.2 (pid 64183), its second suite this session (the first was the failing-first run for fix 2); nothing else on port 3000; no source edited while it ran.
- **Cause (deterministic, so not rerun before the fix).** A temporary log of rule 8b's tallies, read from Chromium's console and then removed, gave merged `{ kept: 31, problems: 1, rooms: 8 }` (27 exact + 5 traced standing in for 4, two PDF walls left out with nothing in their place) against the PDF alone `{ kept: 33, problems: 1, rooms: 8 }`. Q.2's rule needed strictly fewer problems, so the tie kept the merge; Q.2b compares walls kept first, so the complete reading wins. Chromium now reads what Node reads.
- **Fix (the expectation, as a consequence of fix 1):** the e2e row now asserts 33 of 33 exact, 0 traced, the PDF-only line and 33 walls in the studio. The test-plans baseline improves the same way (§28).

### Logged during Q.4a (2026-10-21): `e2e-pdf-import` failed on plan-flush-jamb's model rows (a bug in the new fixture's truth, not a flake)

- **Failure.** First run of the suite after the four Q.4a fixes, the 1440 fixture loop, `checkModel` (`e2e-pdf-import.ts:338`): `plan-flush-jamb.pdf: model row 0 opening width`, `'centre to centre' !== 'opening width'`. Every fixture before it had passed, including the new plan-arrows ("between arrow tips") and plan-t-breaks (2 gaps, 100 mm and 300 mm, none at a T).
- **Server state.** `npm run dev` pid 310, cwd `/Users/rachitmittal20/Atrium-v2`, started right after the cold build (`.next` deleted, build exit 0 in 12 s); `/studio` probed 200; `pgrep -fl "flake-hunt|scripts/e2e-"` empty; no source edited while it ran; the first suite on that server.
- **Cause (deterministic, so not rerun before the fix).** `make-pdf-fixtures.ts` marks the plan's two printed opening widths with `dims.slice(-onBC.length)`, where `onBC` is the openings on w-BC. plan-flush-jamb draws A–C as one wall (w-AC), so `onBC` is empty, `slice(-0)` is the whole list, and the truth said EVERY dimension was an opening width. The reader was right: the house's 11 dimensions run centre to centre.
- **Fix (in the fixture generator, no product change, no assertion changed):** the marking runs only when there are openings on w-BC. Regenerating left every PDF byte-identical (md5). Two truth entries changed, only in `dims[].spans`:
  - plan-flush-jamb.
  - **plan-gaps**, which had the same latent bug since M.1d. Its only w-BC opening is the out-of-range 4.6 m gap, which `onBC` leaves out, so the committed truth called all 11 of its dimensions opening widths. Nothing ever read that: the e2e's model check skips plan-gaps (its 4.6 m gap leaves the room open), and no Node test reads `spans`. So the correction changes no test's outcome.

### Logged during W.1 (2026-10-21): `e2e-pdf-watchdog` failed on its first run on the new code (a bug in the new test, not a flake)

- `page.waitForEvent: Timeout 120000ms exceeded while waiting for event "worker"`, step "wait for the watchdog's message while the worker loops".
- Cause: the suite recognised the review worker by `/review\.worker/` in its URL, but Turbopack's dev worker URL is `turbopack-worker-….js#params=…src_workers_review_worker_ts…`: an underscore. Seen by logging every `page.on("worker")` URL.
- Fix: the pattern is `/review[._]worker/`. No product source changed between the runs. The rerun passed (message after 60.3 s, longest heartbeat gap 105 ms).

## 24. O.1 — self-hosted OCR: DONE (2026-10-14)

- OCR makes no third-party request. Before: `worker.min.js` (124 kB) and `tesseract-core-simd-lstm.wasm.js` (3.9 MB) from jsdelivr, `eng.traineddata.gz` (2.95 MB, `@tesseract.js-data/eng` `4.0.0_best_int`) from jsdelivr, for both the image import and the PDF OCR fallback; tesseract.js and tesseract.js-core 5.1.1. Now served from `public/tesseract/` (about 11 MB with the non-SIMD core as fallback; under the 15 MB limit, so no LFS), config in `src/lib/blueprint/ocrAssets.ts`.
- A missing or blocked OCR file is checked before tesseract starts and reported by name ("The OCR files could not be loaded: eng.traineddata.gz"): as an image warning and as a PDF note. Before, a file failing inside the nested worker surfaced as "Your browser couldn't start the PDF reader". That message remains for a real worker failure.
- The production bundle held tesseract.js's own CDN default (dead code); `scripts/tesseract-default-options-loader.cjs` (Turbopack rule in `next.config.ts`) blanks it. `public/tesseract/worker.min.js` still contains tesseract's unused CDN defaults as text; they are overridden at runtime and the e2e proves no request is made.
- `scripts/e2e-offline-ocr.ts`: phase A aborts and counts every non-local request; phase B uses a browser that resolves only localhost. `context.setOffline(true)` was tried and dropped: it cuts localhost too (the app's lazy chunks), and re-serving localhost through a route stopped React hydrating.
- `test-pdf-walls.ts`'s real-OCR check now runs whenever `public/tesseract/eng.traineddata.gz` exists (always), instead of needing a cached `./eng.traineddata`; the check itself is unchanged.
- No suite failed on its rerun, so there is nothing new for the flake-hunt findings.

## 25. X.1 — a real-style PDF crashed the tab: DONE (2026-10-15)

**`test-plans/plan-test.pdf` is ChatGPT-generated (a reportlab script), not a real CAD export.** It is A3 landscape, vector, with real selectable text, walls as paired 0.25 pt face lines, door arcs, a sheet-wide border, a title block, furniture, and 9 dimensions printed as bare numbers. Its truth file (`~/plan-truth.json`) is local and not committed; neither is the PDF.

### The crash, measured before any change

Playwright's Chromium on `npm run dev`, with `page.on('crash')`, console and pageerror logged:

| stage | time after upload | size |
| --- | --- | --- |
| PDF read, vector extraction, classification | 0.37 → 0.57 s | A3 1191 × 842 pt; 476 segments, 25 text items, 385 path commands; `vector` |
| scale | — | 1:100 from the title block only, "check" (the dimensions are bare numbers) |
| rasterise for analysis (inside the PDF worker) | — | 2399 × 1697 px = 4.1 MP at 2.015 px/pt (57 px/m), the largest canvas |
| analysis in the worker, which posts "done" and closes | 1.25 s | 27 traced walls, 8 traced openings |
| **tab crashed** | **26.2 s** | on the main thread, with no worker running |

The snap index and the background render never ran: they only run in the studio. In Node, the same `buildPdfPlan` grew to a 2 GB heap in 8 s and ran out of memory.

### Cause

- **(d) something else — certain.** `polylabel` in `src/lib/plan/rooms.ts` sizes its first grid of cells by the polygon's shorter side.
  - The page's living-room sofa is drawn as rectangles whose lines are 0.39–0.6 m apart, so `walls.ts` reads it as seven "exact" walls: a closed 1.18 × 0.39 m loop of 0.39–0.6 m thick walls.
  - In the merge's third validator round, `deriveRooms` traced that loop as a face. Pulled in by half of each wall's thickness, its floor outline is about 1e-15 m tall, which asked for about 6e11 cells.
  - That happens on the import page's main thread (the review `useMemo` → `buildPdfPlan` → `mergeVector` → `deriveRooms`), so the tab died silently.
  - Found by bisecting `mergeVector` with temporary timing logs (removed afterwards). Its geometry is reproduced exactly in `test-rooms.ts`, which ran out of memory in 2.5 s before the fix.
- **(a) an oversized raster — ruled out.** 4.1 MP.
- **(b) runaway work in a worker — ruled out.** The worker finished in 1.2 s.
- **(c) the snap index or background — ruled out.** Neither had started.

### The fix

1. **Root cause** (`rooms.ts`): a polygon thinner than the precision (1 cm) returns its box's centre at once, mapbox polylabel's rule. Every room in the studio uses this, so a user who drew such a loop by hand was exposed too. plan-test.pdf now builds in 34 ms.
2. **The pixel budget** (`src/lib/pdf/render.ts`): 4096 px a side and 4096² (16.8 MP) in all.
   - `renderPage` refuses anything bigger with a plain message before it makes a canvas, and so does the background worker.
   - Scans and outlined-text OCR render at 300 dpi held to the budget. Before X.1 they were capped at 40 MP: a scanned A0 page was 7521 × 5320 px.
   - Images over the budget are scaled down in `decodeImage` before any canvas.
   - BackgroundLayer's `MAX_SIDE` is the same constant.
3. **The content box** (`analysePdf.ts`, `contentBox` / `vectorRaster`): strokes and text plus a 10 mm margin.
   - A drawing under half the sheet's longer side renders only that box, in whole pixels of the full page's raster, at 100 px/m. Every other page renders whole, exactly as before. The user chose this rule over cropping every page, because that made every A4 fixture's trace finer (2.85 → 3.39 px/pt) and broke existing assertions that encode the old trace's mistakes.
   - `PdfInfo.rasterOrigin` and `rasterSize` carry the crop through the labels, the scale boxes, snap.ts (the traced origin, the fallback's and the naming origin), the review overlay (`planToPixels`) and the background mapping.
4. **Caps** (`extract.ts`): 500,000 flattened segments and 50,000 text items, beside the existing 500,000 path commands, each with a plain message.
5. **Worker failures** (`importFile.ts`): `onmessageerror`, and a 180 s stall watchdog that does not count the page picker's wait, now reach the page as plain messages. BackgroundLayer handles a dead worker like a failed render.

### Tests

- **`scripts/test-pdf-budget.ts`** (new, in `npm test`):
  - the content box;
  - the budget on A4 to A0 either way up, and `renderPage`'s refusal (11797 × 8344 px);
  - `plan-small-on-big.pdf`: rendered 1771 × 2398 px (4.2 MP) from (1466, 855) pt at 96 px/m; 14/14 walls exact, worst 0.000 mm; 9 openings snapped; rooms named; the overlay within 0.37 px; the traced mapping within 2.0 mm;
  - every vector fixture's walls from the PDF within 0.5 mm (worst 0.000 mm on all);
  - 500,001 path segments refused (0.2 s), 100 curves flattening past 500,000 pieces refused, and too many text items refused.
- **Failing first:**
  - `test-rooms.ts`'s sliver loop ran out of memory on the old `rooms.ts`.
  - On the old tree, `plan-small-on-big.pdf` did **not** crash and did **not** exceed the budget. Its raster was 2399 × 1697 px, the whole A0 sheet squeezed under 2400 px at 0.712 px/pt, so it traced at 20.2 px/m (50 mm a pixel) while its PDF walls were still exact. The new test's 95 px/m check fails there.
  - The old scan rule's 40 MP A0 raster is the budget overrun, and the test shows that number.
- **`plan-small-on-big.pdf`** is new in `make-pdf-fixtures.ts`: plan-filled shifted onto an A0 landscape sheet. Every other fixture regenerated byte-identical.
- **`e2e-pdf-import.ts`:**
  - A crashed tab now fails with the file and the stage. With the old `rooms.ts` put back temporarily, it said "page crashed while importing plan-test.pdf at stage Working out scale (its worker had finished)".
  - plan-small-on-big goes through every fixture check.
  - One extra line is printed per file read at 1440.
  - test-plans/ files' built plans are written to `/tmp/atrium-pdf/<file>.plan.json` for comparing with a truth file by hand.

### plan-test.pdf now, against its truth

Row: `test-plans/plan-test.pdf: vector, walls 22, exact 12, traced 10, openings exact 5 of 9, traced 4, unclassified 2, arcs not used 2, hinge a 4, hinge b 1, out-of-range gaps 0, 0 dimensions read, 0 flagged in the first table, 0 in the second, 1.7 s`

Extra line: `vector, walls exact 12, walls traced 10, openings exact 5, openings traced 4, dimensions read 0, flagged 0, 1.4 s`

It imports and builds. It no longer crashes, but the reading is poor. Compared with the truth file (aligned on the exact east and south walls):

- **Walls** (9 true centre lines):
  - Exact: INT_KITCHEN_LIVING (100%) and INT_HALL_LIVING (100%).
  - Partly exact: EXT_EAST (31% exact; the rest traced as a slanted 600 mm wall) and EXT_SOUTH (42%, exact plus traced within 4.3 mm; the living room's stretch is traced 0.3 m north of its line, 510 mm thick).
  - Traced: INT_BATH_SOUTH (99%, within 1.2 mm), EXT_WEST (82%, 9.5 mm off, 210 thick) and INT_BEDROOM_HALL (19%, 14 mm off, 260 thick).
  - Missing as such: EXT_NORTH (only a traced wall slanting 84 mm over 6.7 m) and INT_BEDROOM_SPLIT (traced 59 mm off).
- **Wrong walls:** the sofa read as seven exact walls (v1, v8, v21, v22, v24, v25, v44; 150–600 mm thick). This is the known M.1b limit on parallel lines closer than 0.6 m, and the loop that crashed the tab. It now gives two 0 m² rooms.
- **Openings** (5 doors, 4 windows, 1 open passage):
  - Exact: the entry door D1 and the living door D5, with swing and hinge right (D5 hinged at b); window W1 (14 mm, on a traced wall).
  - The open passage reads as an "unclassified" door, 1200 mm exact.
  - Wrong kind: the kitchen window W3 reads as an unclassified door (1500 mm), and the bathroom door D4 as a traced window (890 mm).
  - Missing: both bedroom doors (D2, D3) and window W2. W4 is traced (1610 mm) on the slanted east wall, more than 50 mm out.
  - Extra: a traced 1200 mm door on the bedroom/hall wall and a traced 820 mm window on the hall/living wall.
- **Rooms:** truth Bedroom 1, Bedroom 2, Bathroom, Kitchen, Living, Hall; plan "Bathroom / Kitchen" (14.3 m², two labels in one room), "Living" (18.2 m² against 21.4) and the two sofa slivers. Bedroom 1, Bedroom 2 and Hall never close as rooms. The truth's own wall list has no wall between the bathroom and the kitchen though its rooms need one; the render shows a single line there.
- **Dimensions:** none of the 9 becomes a table row. They are bare numbers, which since M.1a only feed the "Feet or metres?" question. All 9 match their lines as unitless, at 35.278 units per point with a 0.0001% spread (exactly 1:100 in mm). The scale is "check" from the title block.

### Not covered

- `buildPdfPlan` still runs on the import page's main thread (the review and Build model). This fix removes the one runaway found there, but another would still freeze or kill the tab; the watchdog covers workers only. (Done in step W.1, section 32: the review and Build model's vector build run in `src/workers/review.worker.ts`.)
- A dedicated worker runs in the page's renderer process, so a worker that does run out of memory still takes the tab. The budget and caps keep it from getting there; nothing can catch it after.
- `decodeImage` decodes the whole image before its size is known, so an image of hundreds of megapixels can still crash in the decoder.
- The crop needs a small drawing. A sheet-wide border or a far-off title block (plan-test.pdf has both), or a page-sized white fill, makes the content box the whole sheet. plan-test.pdf therefore still traces at 57 px/m (17.5 mm a pixel).
- The background worker's render failures still go only to the console.
- Furniture drawn as paired lines under 0.6 m apart is still read as walls (M.1b).
- No real CAD PDF has been read. plan-test.pdf is a generated stand-in.

### Verification

- `npm test` (34 OK, exit 0) and `npx tsc --noEmit` pass.
- Cold build: `.next` deleted with the dev server stopped, then `perl -e 'alarm 300; exec @ARGV' npm run build`: exit 0 in 12 s.
- Both greps after the build: `clean`.
- `npm run dev` restarted (pid 97906, `/studio` 200, no other suite running). e2e-pdf-import (66 s), e2e-background (24 s), e2e-snap (21 s), e2e-takeoff (19 s), e2e-calibrate (42 s) and e2e-studio (147 s) all passed first time, one at a time, with no source edited meanwhile.
- No suite failed, so there is nothing new for the flake-hunt findings. The one deliberate failure, the crash-message proof with the old `rooms.ts`, was a check on the harness, not a flake.

## 26. Q.1 — general CAD conventions in the PDF reader (2026-10-15; not committed)

**No real CAD PDF has been tested.** The file this step was measured on, `plan-test.pdf` (now committed as `tests/fixtures/pdf/plan-chatgpt-flat.pdf`, 5.5 KB), was generated by ChatGPT with a reportlab script. **No rule was tuned to it**: every change is a general drawing convention, written failing-first on a new SYNTHETIC fixture that reproduces one class of failure (`scripts/test-pdf-conventions.ts`), and the plan-test file is read with those rules and tested with honest expectations (`scripts/test-pdf-chatgpt.ts`). CLAUDE.md has the rules ("General CAD conventions in the PDF reader").

### 1. The truth file against the drawing

All 476 segments and 25 texts were extracted. The page maps as x_pt = 420 + 0.028346·x_mm, y_pt = 586.89 − 0.028346·y_mm (A3, 1:100), and every wall face, jamb and arc matches the truth to under 0.01 mm. The disagreements, which are not Atrium faults (recorded in `plan-chatgpt-flat.truth.json`):

- **No wall between the Bathroom and the Kitchen.** The truth gives them as two rooms, but neither its wall list nor the drawing has a wall at x ≈ 6600, y 5558–7770; the single line there is DIM_07's dimension line (x = 6450). The drawing closes 5 rooms, not 6.
- DIM_07's extension lines start at x = 6543, the face of that undrawn wall.
- Wall ends: the header says centre-line ends, but interior walls end at the faces of the walls they meet, and INT_BEDROOM_SPLIT starts at a face and ends at a centre line. Atrium runs a wall that meets another to that wall's centre line.
- Doors mix two conventions: D1 and D4 draw the leaf shut along the face across the gap (the truth's "leaf_open_end" is then the shut leaf's tip); D2, D3 and D5 draw it open.
- Wall faces and dimension lines are both 0.25 pt; furniture is 0.2–0.35 pt, often heavier than walls. Line weight cannot separate them.
- Minor: "Bathroom" starts at x = 3995, inside the partition. The truth lists no furniture; the drawing has beds, a bath, basin, WC, counter, sofa and table.

### 2. Diagnosis (before any fix)

- **(a) 0 dimensions — certain.** All 9 texts were matched to their lines, the 5 reading bottom to top included (bare-number band n = 9, 35.2778 units/pt, spread 0.0001%). The rejecting rule was M.1a's "bare numbers only feed the Feet or metres? question"; the page states "ALL DIMENSIONS IN mm" and "UNITS mm". Not rotated text, ticks (3.6 pt, under one text height, irrelevant here), the text-height or the line-length rule.
- **(b) walls — the requested premise was disproved.** Exterior inner faces stop exactly one thickness (230 mm) short at each corner; even the shortest pair (470 / 700 mm) overlaps 100% of the shorter face against the 60% rule, and all 12 exterior pairs paired with exact centre lines. The real causes:

| Truth wall | What was read | Rejecting rule | |
| --- | --- | --- | --- |
| INT_BEDROOM_HALL | DIM_06's line (x 3650) paired with the partition's east face as a 508 mm wall; the real 115 mm pair lay inside it | widest pair wins; dimension lines were faces | certain |
| | the 900 mm face between D2 and D3 thrown away | M.1b leaf rule (≤ 1.5 m, an end on an arc's end): it was the strike jamb's face | certain |
| EXT_EAST | W4's glazing paired as a 153 mm wall; gap unbridged | a 535 mm phantom (DIM_09 line + glazing) crossed it | certain |
| EXT_NORTH | W3's gap unbridged | phantoms of glazing + dimension line or counter lines (592, 555, 442 mm) | certain |
| EXT_WEST / NORTH / EAST | stubs past the corners | extension lines joined to collinear faces; two stacked extension lines paired | certain |
| EXT_SOUTH | exact but split at phantom T-junctions (x 3904, 10560) | dimension-line phantoms | certain |
| INT_BATH_SOUTH | 5600–6543 piece lost | the same leaf rule (D4's arc end) | certain |
| everything, end to end | 12 exact, 10 traced | the merge keeps a group traced when the tracing is more than 2 px off; this tracing fused dimensions and furniture into 260–600 mm walls 45–305 mm off | certain |

- **(c) openings.** The arc rules were right (5 arcs, r 0.900 m, 90°, leaves found). D2 and D3 were lost to the leaf rule (their gaps merged into one 2.7 m gap cut at a T); D4 likewise (the tracing then called it an 890 mm window — likely); W2, W4 and W1 lost or traced through the merge; W3 blocked by phantoms; the passage OP1 is "unclassified" by design (there is no passage kind).
- **(d) rooms.** Bedroom 1, Bedroom 2 and Hall never closed because INT_BEDROOM_HALL was lost and its traced stand-in had free ends; Living was 18.2 m² (against 21.4) because the traced south wall had fused with the sofa's back; the sofa gave seven "exact" walls and two 0 m² rooms.

### 3. The fixes, each on its own fixture, failing first

Every new fixture is SYNTHETIC (`make-pdf-fixtures.ts`, new options default off; regenerating leaves every older PDF byte-identical, checked by md5). After every step the whole PDF suite ran and a snapshot of every older fixture's full reading and build (scale, rows, vector walls and openings, built walls, openings, rooms, coverage) was diffed against a pre-Q.1 copy of the source: **no older fixture's result changed at any step.**

| Rule | Fixture | Failing first (on the code before the rule) |
| --- | --- | --- |
| 1 stated unit (mm, cm, m) | plan-bare-mm | `0 !== 11` rows |
| 2 dimensions are annotation | plan-dims-close | phantom walls 0.55–0.6 m, real walls moved |
| 3 no line runs through a wall | plan-against-wall | the bath swallowed w-ME / a wall read across a true face |
| 5 a swing ends at the strike jamb | plan-strike-jamb | w-KL lost; doors 0.8 m apart lost |
| 4 a gap is closed only across the whole wall | plan-window-board | w-BC not bridged across its window |
| 9 a face bounds a wall on one side only (**added beyond the agreed list**) | plan-against-wall | two bath edges T-joined to the east wall |
| 6 small loops / 7 islands, reported | plan-furniture | the cupboard's partitions read as walls |
| 8 a complete PDF reading stands on its own | plan-dims-close, plan-window-board | 4 of 14 walls / 2 traced walls |

Notes on the way:
- Rule 3 first used a threshold ("past the pair by more than its thickness"); plan-window-board's short wall piece between a door and a window broke it, so it became "any line not on the pair's centre line"; a centre line (midway) is exempt.
- Once rule 9 existed it also covered rule 4's first fixture (a counter in front of a window), so that fixture was changed to a single-line window board, which only rule 4 handles; rule 4 fails first on it again.
- Rule 9 was added because two bath edges paired 0.5–0.55 m from the faces of the walls beside them were neither loops nor islands and left free ends that also blocked rule 8.
- Rule 8 applies only when the merge did not use the PDF's walls as read, so a clean merge keeps its snapping record and no older fixture's coverage changes. plan-single-line still merges (12 exact, 2 traced).
- A tried "same pen" rule for joining collinear faces was not needed and renumbered vector ids in two fixtures; dropped. A hairline-wall fixture traced fine and reproduced nothing; dropped.
- The furniture report: every dropped group (loop, island, and M.1b's clutter pieces as "small") is in `VectorWalls.furniture` and `Coverage.furniture` and listed on the review screen with its size and place. A stroked and a filled 0.5 m column are both reported 0.50 × 0.50 m at their places, not lost.

### 4. plan-chatgpt-flat.pdf now

Before: walls 22, exact 12, traced 10; openings exact 5 of 9, traced 4, unclassified 2; 0 dimensions; rooms "Bathroom / Kitchen" 14.3 m², "Living" 18.2 m² and two sofa slivers.

Now (e2e row): **walls 16 exact, 0 traced** ("Walls read entirely from the PDF; the picture tracing was not used."); **openings 10 of 10 exact** (doors 5 with hinge jamb and side right, windows 4, unclassified 1); **wrong type 1** (the open passage); **9 dimensions read, 0 flagged**, model check 9 of 9 OK; **rooms closed 5**: Bedroom 1 14.15 m², Bedroom 2 14.16 m², Hall 12.43 m², Living 21.44 m² (each equal to the truth's inside size within 1e-4 m²) and Bathroom / Kitchen 14.63 m²; 9 furniture groups listed; one out-of-range gap (the 115 mm break where the truth wants the missing wall); 1.4 s.

Still wrong, and why:
- The open passage is an unclassified door: the Plan has no passage kind (M.1c design).
- Bathroom and Kitchen are one room: the drawing has no wall between them (a truth discrepancy, not a reading fault).
- Heights and sills are defaults (a PDF has none).
- Interior wall lengths differ from the truth's by half a host thickness (the truth's mixed end convention).

### 5. Known failures, asserted as they are (so a change shows)

- An OFF-centre line drawn along a wall's whole length and past its ends costs that wall (rule 3 reads it as another wall's face). A centre line, a pipe inside a wall, or one running out past an end does not.
- A centre line collinear with a window's middle glazing line joins it into one long line, so that window is not read (plan-against-wall: its two west windows; 7 of 9 openings).
- Furniture standing END-ON against a wall (its two long edges pair, the pair's end joins the wall) stays as a stub wall with a free end; furniture backed onto a wall's face is dropped (rule 9).
- A real free-standing wall inside the building is dropped as an island, and a real duct or closet under 1 m² by rule 6; both are reported, not silent.

### 6. Tests and checks

- New in `npm test`: `scripts/test-pdf-conventions.ts` (rules 1–9, the synthetic L-corner cases, the known failures) and `scripts/test-pdf-chatgpt.ts` (the honest row against the trimmed truth).
- `e2e-pdf-import.ts`: the six new synthetic fixtures go through every generic fixture check at 1440; `checkQ1Review` asserts the PDF-only line exactly on plan-dims-close and plan-window-board and on no older fixture, plan-furniture's six groups with both columns' size and place, plan-bare-mm's note in the reason, and plan-against-wall's known failure; plan-chatgpt-flat has its own row, built and opened in the studio.
- **No existing assertion was changed.** Existing tests only gained the new fixtures in their generic loops (`test-pdf-budget`'s every-vector-fixture check, the e2e fixture loop).

### 7. Verification

- `npm test`: 36 suites, exit 0 (the two new ones included). `npx tsc --noEmit`: clean.
- Cold build: dev server (pid 97906) stopped, `.next` deleted, `perl -e 'alarm 300; exec @ARGV' npm run build`: exit 0 in 13 s. Both greps after the build: `clean`. (A first attempt raced the dev server's shutdown and left part of `.next`; it was deleted again and the build repeated cold.)
- `npm run dev` restarted (pid 56965, `/studio` 200, nothing else on port 3000). One at a time, no source edited meanwhile: e2e-pdf-import (85 s), e2e-background (25 s), e2e-snap (22 s), e2e-takeoff (18 s), e2e-calibrate (43 s), e2e-studio (152 s), all exit 0 **first time**. No suite failed, so there is nothing new for the flake-hunt findings.

## 27. Q.2 — poche walls, masks, centre lines and the title block (2026-10-16; not committed)

**No real CAD PDF has been tested.** `test-plans/plan-test-2.pdf` is ChatGPT-generated, not a real CAD export.

### 0. Prediction, written before the first fix (to be checked in §5)

For plan-test-2.pdf once every planned rule is in, read in Node (the Chromium row may differ in the traced numbers only):

- **Walls:** all 18 truth walls (the diagonal included) built exactly along the truth's centre lines at their thicknesses, 0 traced, read entirely from the PDF by rule 8b with **1 free end** left (the west end of INT_CORRIDOR_SOUTH, where the drawing leaves a 25 mm slot).
- **Windows:** 5 of 6 exact (W1, W2, W3, W5, W6). W4 is not read and is reported by name, because INT_BEDROOM_2_3 ends inside it.
- **Doors:** D1–D5 exact, each with the truth's hinge jamb and side; D6 exact as a double door; D7 (sliding) read at its exact jambs but unclassified, as a door (wrong type); OP1 (open passage) unclassified, as a door (wrong type).
- **Rooms:** 8 closed: Master Bedroom, Bedroom 2, Bedroom 3, Bathroom 1, Bathroom 2, Utility, one Dining + Kitchen room (no wall is drawn between them) and one Living + Corridor room (the 25 mm slot), whose name also picks up "FFL +0.150".
- **Dimensions:** 12 read, 0 flagged; scale "good" (the dimensions and the title block's 1:50 agree).

### 1. The truth file against the drawing

All 1798 segments, 38 texts, 32 black poche fills, 6 white fills and 746 clipped hatch strokes were extracted. The page maps as x_pt = 310 + 0.0566929·x_mm, y_pt = 875.551 − 0.0566929·y_mm (A2 landscape, 1:50); every poche rectangle, jamb, glazing line, arc and dimension end matches the truth to the 0.1 mm printed, and the 12 dimension values match their measured lengths to under 0.005 mm. The disagreements, which are not Atrium faults (all recorded in `tests/fixtures/pdf/plan-chatgpt-poche.truth.json`):

- DIM09 "2000" (0–2000) and DIM03 "5975" (300–6275) are drawn on ONE dimension line (y −1000), overlapping.
- No wall is drawn between Dining and Kitchen, though the truth gives two rooms and DIM04 / DIM05 measure to x 10450 / 10550.
- INT_CORRIDOR_SOUTH stops 25 mm short of the bathroom block (a slot at y 3675–3700, x 4225–4300): Corridor and Living are one space, and its west end is a real free end.
- INT_BEDROOM_2_3 ends inside window W4 (a partition meeting glass).
- Wall ends mix conventions (faces for INT_BEDROOM_FRONT, INT_BATH_*, the corridor's west end; centre lines for INT_BEDROOM_2_3, INT_CORRIDOR_UTILITY); INT_LIVING_DINING's truth end is 50 mm past the corridor wall's centre line.
- The diagonal ends 1.47 mm short of the north wall's centre line; INT_KITCHEN_UTILITY and INT_CORRIDOR_SOUTH meet 50 mm out of line.
- Bedroom 2 / Bedroom 3's bounds assume a 100 mm partition; INT_BEDROOM_2_3 is 150 mm in the truth's own wall list and in the poche (Bedroom 3 is 2525 × 2500 mm as drawn).
- Living's box stops at y 3525 though its area runs to 3700 under the bathrooms; "FFL +0.150" is printed inside Living.

### 2. Diagnosis (before any fix, measured in Node; the plan's own numbers were 0 of 48 walls and 0 of 15 openings in Chromium)

| Truth wall | What the PDF reader produced | First rule that broke it | |
| --- | --- | --- | --- |
| EXT_SOUTH, EXT_WEST, EXT_NORTH, EXT_EAST_LOWER, EXT_NOTCH_VERT | exact pieces cut up by 330 mm "walls": the six WHITE filled rectangles over the windows, which rule 2 read as walls; 6 mm stubs at their ends; every window gap blocked | rule 2 reads a paper-coloured mask as ink | certain |
| the same, INT_LIVING_DINING, INT_CORRIDOR_UTILITY | stretched past the building to y −1000 / −1225 by extension lines paired into walls; the dimension lines 450 mm apart paired into a wall | rule 2 (annotation) off: the "2000" mismatch made the dimension band "none" | certain |
| INT_BEDROOM_FRONT | nothing: the dash-dot centre line (y 6650) paired with the finish line (6730) into an 80 mm wall beside it; sliver loops; rule 6 dropped both | dashed lines taken as faces | certain |
| INT_MASTER_SIDE | dropped as an island (its host gone, the diagonal not read) | rule 7, after the above | certain |
| INT_MASTER_DIAGONAL | not read (rule 2 was axis-only); counted among "368 diagonal walls" | diagonals only counted | certain |
| INT_BEDROOM_2_3 | exact, south end free, split at 9272 by W4's sill/glazing pair (213 mm) | the above, and the W4 defect | certain |
| INT_CORRIDOR_SOUTH | exact; a 525 mm phantom paired the finish line (3495) with lines across the wall; west end free | rule 3 ignored filled walls' edges; the slot is the drawing's | certain |
| INT_BATH_* (4), INT_KITCHEN_UTILITY | exact | — | certain |
| everything | 0 exact: 85 PDF walls, with 8 title-block "walls" and 13 annotation walls with free ends; the merge dropped culprits for 3 rounds, then fell back to the whole tracing; rule 8 failed (free ends) | merge fallback, rule 8 | certain |

- (a) Each wall piece between openings is its own filled rectangle (even-odd fill), exterior pieces overlapping a full thickness at the corners; rule 2 read them right. The 746 hatch lines are 0.1 pt grey strokes clipped per wall piece; the extractor ignored clips, so they arrived as 45° lines up to 10.2 m long: never axis faces, but the false "368 diagonal walls skipped". The dash-dot centre lines did break pairing (above). There is no insulation line; the finish lines are harmless beside poche except where one pairs ACROSS a wall. (certain)
- (b) above. (certain, by experiment: with masks, dashes, hatching and the "2000" removed, the reading was 32 right walls + 12 junk; with the title block removed too, the PDF-only merge kept 24 of 36, losing the rest to free ends: W4, the diagonal, the slot.)
- (c) D1–D3's arcs "not at a jamb" (their wall dropped); D4/D5 and the double door were right; D7 read as a window because the centre line through its gap counted as glazing; the windows lost to the masks; W4 blocked by the partition crossing its gap; every traced door hinge a because the image pipeline never reads hinges (by design) and everything ended traced. (certain)
- (d) The three out-of-range gaps were annotation: 75 mm between INT_LIVING_DINING's poche end and an extension-line "wall" collinear with it; 150 and 100 mm between chained dimension lines in the 450 mm dimension-line "wall". (certain)
- (e) The diagonal was not read and miscounted (368); both re-entrant corners and the utility T joined exactly. (certain)
- (f) One row flagged: "2000", measured 5975 on DIM03's line (equal distance, first drawn wins); that one outlier made the spread 67%, the band "none", the scale the title block's "check", and switched annotation off. (certain)

### 3. The fixes, one class at a time, each failing first on its own SYNTHETIC fixture

Every fixture is a variant of plan-filled or plan-lines (`make-pdf-fixtures.ts`, new options default off; regenerating left every older PDF byte-identical, checked by md5 at every step, and every older truth entry identical). After every step the whole PDF suite ran and a snapshot of every older fixture's full reading and build (scale, rows, vector walls and openings, built walls, openings, rooms, coverage) was diffed against the step before. The holdout rule held: plan-test-2 was used to find each class, never to prove it.

| # | Rule (drawing convention) | Fixture | Failing first |
| --- | --- | --- | --- |
| 1 | A fill in the paper's colour is a mask, not ink (extract.ts tracks the fill colour) | plan-poche-mask | 112 filled segments for 92; 35 wrong pieces read |
| 2 | Dashed lines are never wall faces or opening lines (extract.ts marks `dashed`) | plan-centre-lines | w-HI and the west walls lost, 5 windows not read, the sliding door unclassified |
| 3 | A dimension's text sits at the middle of its line (tie-break between equally near lines) | plan-dims-chain | "1500 mm" measured 4.000 m |
| 3b | One wrong dimension is an outlier (as agreed: ≥ 5 agree within 5%, exactly one does not and is < 20% of all; never "good" with fewer than 5) | plan-dims-one-wrong | scale "check" from the title block |
| 4 | A clip path hides what lies outside it (extract.ts clips every segment to the clip regions in force) | plan-poche-hatch | 608 hatch lines unclipped, 259 counted as diagonal walls |
| 4b | Hatching is not a diagonal wall at a corner either (each line of a pair inside a wall) | synthetic hatched L, 0.3 m poche | 1 counted |
| 5 | Rule 3 also sees a filled wall's edges | plan-finish-line | a 0.28 m phantom across the partition, w-HI moved 6 cm onto it |
| 6 | A sheet holds more than the building (rule 7b): a group joined to nothing and outside the building is dropped only on EVIDENCE (title-block words inside it, or against the sheet's border / page edge), kept otherwise; reported either way, outlined on the overlay with its size; the building is the biggest box among groups WITHOUT evidence | plan-title-block, plan-outbuilding | 13 title-block "walls", the build 0 of 14 exact; the 4 × 3 m shed kept but not reported |
| 7 | A window's own lines are never a wall (a pair within a bridged opening's span with a line inside the wall's band) | plan-window-sill | 5 window "islands" reported as furniture |
| 8 | A wall closes a gap only by passing through it; an opening a wall then ends inside is not read and is REPORTED by name ("Window 1 (1.20 m) conflicts with a wall ending inside it; not read.") and boxed | plan-stem-in-window | the west wall broken at the window with free ends, the partition on the sill/glass pair, the window lost silently |
| 9 | A filled rectangle is a wall at any angle, joined to the walls it meets | plan-poche-diagonal | the 45° wall not read, its partition ending free, two rooms one |
| 10 | Rule 8b (done last, as agreed): when rule 8 fails, the PDF's walls alone, every one kept, are used only with STRICTLY fewer validator problems than the merged plan and no fewer rooms; the review says how many free ends remain | plan-free-end (a 1 m nib) | with a poor tracing (three traced walls 6 px off and 30 px short), the merge kept traced walls; the PDF alone was not tried |

Notes on the way:
- Step 6 first picked the building as the LONGEST group; the ruled title block (13 rows of 8 m) is longer than the house, so the house came out "detached". The building is now the biggest box among groups with no title-block or border evidence.
- Step 6's footprint of plan-title-block's title block is 8.65 m, not its frame's 8.11 m: its right edge pairs with the sheet border 15.3 pt away, and that pair is part of the group as read.
- Step 7 changed one older fixture's REPORT, not its reading: plan-window-board's window board (one line 0.1 m in front of its window) paired with a glazing line and was listed as a 1.20 × 0.27 m furniture "island"; it is now part of the window. No wall, opening or room changed.
- Step 8 first counted a stem's span grown by half its thickness, which reaches the far face exactly (−0.05 − 0.05 = −0.1); only the drawn span counts.
- Step 10: on plan-free-end as traced the merge TIES the PDF alone (one problem each: the nib's free end, traced), so the merge stands, as the rule says. Several variants (stroked walls, close dimensions, a second nib) all tied or came out "clean" by dropping walls (one merge kept 4 of 16 walls with 0 problems and 1 room), so the strict rule cannot fire on them; it was proven with a deliberately poor tracing. **This is the rule as agreed, and it has a gap: a merge that is clean only because its rounds dropped walls beats a complete PDF reading with one real free end.** A rule comparing walls kept or rooms first would catch it; not done.
- Every other older-fixture snapshot change was a new empty field (`detached`, `conflicts`, `freeEnds`), checked by diff each time.

### 4. plan-chatgpt-poche.pdf (plan-test-2) now

Committed as `tests/fixtures/pdf/plan-chatgpt-poche.pdf` (43 KB), labelled ChatGPT-generated, not real CAD, with its trimmed truth and discrepancies, and `scripts/test-pdf-chatgpt-poche.ts` (in `npm test`).

- **Node** (`test-pdf-chatgpt-poche.ts`): walls 33 exact of 33, 0 traced, read entirely from the PDF by rule 8b, 1 free end (the corridor wall's west end, at the drawing's 25 mm slot); every truth wall's centre line and thickness built end to end, the 45° wall included, but for the truth's own end convention (INT_LIVING_DINING 50 mm, the diagonal 1.5 mm); openings 13 exact of 13 (doors 6, windows 5, unclassified 2), D1–D5 with hinge jamb and side right, D6 double right; W4 not read, reported "Window 1 (1.40 m) conflicts with a wall ending inside it; not read."; 12 dimensions read, 0 flagged, scale good; title block left out and reported; 8 rooms: Master Bedroom, Bedroom 2, Bedroom 3 (6.31 m², 2525 × 2500 mm as drawn), Bathroom 1, Bathroom 2, Utility (7.875 m², the truth's), Dining / Kitchen, Corridor / Living / Ffl +0.150.
- **Chromium** (the e2e row and the committed baseline): walls 27 exact of 32, 5 traced (33–123 mm from the PDF's lines, round the corridor and bathrooms: Chromium's tracing is good enough that the merge is no worse by the validator than the PDF alone, so rule 8b rightly does not replace it); openings 13 of 13 exact, 2 unclassified (wrong type); W4 named as not read; 12 dimensions read, 0 flagged in either table; 8 rooms, the same names. Before Q.2: 0 of 48 walls and 0 of 15 openings.

**The prediction (§0) against the result.** Node: walls 18 of 18 truth walls, 0 traced, 1 free end — right. Windows 5 of 6 with W4 reported — right. D1–D5 with hinge and side, D6 double, D7 and OP1 unclassified — right. 8 rooms with Dining + Kitchen and Living + Corridor (+ "Ffl +0.150") merged — right, names exactly. 12 dimensions, 0 flagged, scale good — right. Chromium: the prediction said only the traced numbers might differ; in fact the WHOLE wall route differs (the merge stands with 5 traced walls, no PDF-only line, no free-end line). Openings, dimensions and rooms are the same in both.

**Still wrong, and why:**
- Chromium: 5 walls traced round the corridor and bathrooms (the merge keeps a tracing 33–123 mm off where it is clean, and rule 8b needs strictly fewer problems).
- W4 is not read: a partition ends inside it (the drawing's defect); reported by name.
- D7 (sliding) is drawn as two concentric lines covering 94% and 77% of the gap, not CAD's staggered panels; OP1 is an open passage, and the Plan has no passage kind. Both are unclassified doors.
- Dining + Kitchen are one room (no wall drawn), Living + Corridor one room (the 25 mm slot): right by the drawing.
- "FFL +0.150" is picked up as a room name (a level mark is not a name; not fixed).
- Heights and sills are defaults (a PDF has none).

### 5. Known failures and limits, asserted or recorded

(Step Q.2b, §28, fixed three of these: rule 8b's gap, the traced window kept at plan-stem-in-window's conflict, and "FFL +0.150" in a room name. They stay listed here as they were at Q.2.)

- Rule 8b's gap (above): a merge made clean by dropping walls beats a complete PDF reading with a real free end.
- In Chromium, plan-stem-in-window's tracing still reads the window the partition ends in, and keeps it as a TRACED window clamped onto one side of the joint (the conflict is still named). A traced opening where the PDF reports a conflict could be dropped as M.2b drops phantoms; not done.
- A detached outbuilding with title-block words inside its box (a shed labelled "SHED — SEE DRAWING 3") or drawn against the sheet border is dropped as a title block (reported and outlined, not silent). A building box holding title-block words could lose "the building" to a smaller group.
- Diagonal walls: only FILLED rectangles are read; stroked diagonal pairs are still only counted. A diagonal is never split by an axis wall's end landing on its middle, and openings in diagonal walls are not read.
- The one-outlier rule leaves a dimension band of fewer than 6 readings, or with two outliers, as before.
- Q.1's known failures stand for SOLID lines (an off-centre line along a whole wall; a centre line collinear with a window's middle glazing line); a DASHED centre line no longer causes either.
- Clipping is O(edges) per segment per clip region (`ponytail:` in extract.ts).

### 6. Tests and checks

- New in `npm test`: `scripts/test-pdf-poche.ts` (sections 1–10, 3b and 4b, each failing first; it imports test-pdf-conventions' helpers, which now export them, guarded by `require.main`, no assertion changed) and `scripts/test-pdf-chatgpt-poche.ts` (honest, Node).
- `e2e-pdf-import.ts`: the 12 new fixtures go through every fixture check at 1440 with their differences stated per file (`Q2`); `checkQ2Review` checks the detached outlines and list, the conflict sentence and box, the outlier reason; plan-chatgpt-poche has its own honest Chromium row, built and opened; the test-plans rows are compared with `tests/fixtures/pdf/test-plans-baseline.json` (numbers only, written from the Chromium run with `E2E_WRITE_BASELINE=1`) and **fail** when any number is worse. Proven: with plan-test-2's baseline raised to 28 exact walls, the suite failed "worse than its baseline: wallsExact 28 -> 27"; the baseline was then restored.
- **No existing assertion was changed.** test-pdf-conventions.ts only exports its helpers.

**No real CAD PDF has been tested.** Both ChatGPT plans are generated stand-ins, and every rule is proven on synthetic fixtures only.

### 7. Verification

- `npm test`: 38 suites, exit 0 (the two new ones included). `npx tsc --noEmit`: clean.
- Cold build: no dev server running (`lsof -i :3000` empty), `.next` deleted, `perl -e 'alarm 300; exec @ARGV' npm run build`: exit 0 in 12.6 s. Both greps after the build (dev hooks incl. `__background`, and CDN): `clean`.
- `npm run dev` started (pid 64183, `/studio` 200, nothing else on port 3000). `e2e-pdf-import` failed twice on the way, both logged in §23 before rerunning (a fixture text printed twice; an expectation copied from Node), then passed while writing the Chromium baseline, then failed ON PURPOSE against a doctored baseline (the harness check, restored after). No source under `src/` changed after the cold build (only scripts, fixtures and docs).
- The final sweep, one suite at a time, no source edited meanwhile: e2e-pdf-import (110 s), e2e-background (22 s), e2e-snap (22 s), e2e-takeoff (17 s), e2e-calibrate (75 s), e2e-studio (147 s), all exit 0 first time.

## 28. Q.2b — the merge choice, traced windows at a conflict, level notes (2026-10-17; not committed)

**No real CAD PDF has been tested.** Three small fixes; no other rule changed, and image input is unchanged. CLAUDE.md has the rules ("Merge choice, conflicts and level notes (step Q.2b)").

### 1. The merge choice (`snap.ts` `pdfAloneWins`)

- **Rule:** rule 8b compares the merged plan and the PDF's walls alone by PDF walls KEPT, then validator problems, then rooms; a full tie keeps the merge. The 70% guard (a plan keeping under 70% never beats one keeping all) follows from comparing walls first, so it is not a separate check.
- **"Kept"** (`PdfBuild.kept`): a PDF wall in the plan, or one a traced wall of its group stands in for. Counting only exact walls was ruled out because it would flip plan-free-end (15 exact + its nib traced, against 16 with the nib's real free end: a tie by problems today), and every existing fixture result had to stay.
- **Failing first:** the rule was first moved into `pdfAloneWins` with Q.2's logic unchanged (snapshot of all 35 fixtures identical). Then `test-pdf-poche.ts` section 10b was added: plan-free-end's complete reading, measured as `{ kept 16, problems 1, rooms 4 }`, against a merge `{ kept 4, problems 0, rooms 1 }`. It failed ("a merge keeping 4 of 16 walls with 0 problems loses…": Q.2's rule picked the 4-wall plan). Then the fix. No synthetic fixture reproduces a merge that keeps only 4 of 16 (poor tracings all go PDF-only already; dropping takes validator rounds on walls with no traced stand-in), so the test is on the tallies, with the complete reading's tally taken from the real build.
- **Node:** every fixture's snapshot unchanged after the fix (35 compared).
- **Chromium:** plan-chatgpt-poche changed, logged in §23. The merge kept 31 of 33 PDF walls (27 exact + 5 traced standing in for 4; 2 left out) with 1 problem and 8 rooms; the PDF alone keeps 33 with 1 problem and 8 rooms. It now reads 33 of 33 exact, 0 traced, PDF only, the same as Node.

### 2. A traced opening at a conflict (`snap.ts` `conflictAt`)

- **Rule:** a traced opening on an opening walls.ts reported as a conflict (a wall ends inside it) is removed, in the merge and in the whole-plan fallback. It is listed on the conflict (`traced`, present only when non-empty), and the review's line counts it: "… not read. 1 traced opening at the same place was removed too." (`li` `data-traced`).
- **Failing first in Chromium:** the e2e assertion was added and run on the unchanged source. It failed: "the traced window at the conflict removed and counted (Window 1 (1200 mm) conflicts with a wall ending inside it; not read. …)".
- **Node** has the same traced window (o1, clamped to y 2.01–3.20 beside the 1.4–2.6 conflict). Its snapshot changed only there: the opening is gone, traced 1 → 0, total 9 → 8, and `traced: ["o1"]` is on the conflict.
- **Assertion changed:** section 8's exact line, as stated, plus a new "0 traced" assertion.

### 3. Level notes (`analysePdf.ts` `withoutLevel`, in `pdfLabels`)

- **Rule:** a line that is a level note (starts with FFL / SSL / FL / LEVEL / LVL, dotted or not, or is a bare signed number) is no room label, and a trailing level note on a name's own line is stripped. PDF text only.
- **Fixture:** `plan-levels.pdf`, plan-filled with "FFL +0.150", "+0.000", "LEVEL 1", "SSL +0.100" under the names and "FL -0.020" on the Bathroom's own line (new generator option `levels`, default off). Regenerating left every older PDF byte-identical (md5) and every older truth entry identical.
- **Failing first** (section 11): the names were "Bathroom Fl -0.020", "Bedroom 1 / Ffl +0.150", "Living Room / Level 1 / Ssl +0.100". "+0.000" was already dropped as a dimension-like number.
- **Effect elsewhere:** plan-chatgpt-poche's room is now "Corridor / Living", in Node and Chromium. Its snapshot changed only in that name. The e2e row's name list changed as stated, and test-pdf-chatgpt-poche gained a "no level note in a room name" assertion.
- **Limit:** a room really named "Level …" or ending in a signed number loses that text.

### 4. Baseline

`test-plans-baseline.json`, plan-test-2.pdf: wallsExact 27 → 33, wallsTraced 5 → 0 (fix 1, the Chromium change above). Every other number is unchanged; plan-test.pdf is unchanged.

### 5. Verification

- `npm test`: exit 0. `npx tsc --noEmit`: clean.
- Cold build: dev server (pids 64182/64183) stopped, port 3000 free, `.next` deleted, `perl -e 'alarm 300; exec @ARGV' npm run build`: exit 0 in 12 s. Both greps after the build (dev hooks incl. `__background`, and CDN): `clean`.
- `npm run dev` restarted (pid 80412, `/studio` 200).
- Final sweep, one at a time, no source edited meanwhile, all exit 0 first time: e2e-pdf-import (100 s), e2e-snap (22 s), e2e-background (23 s), e2e-studio (152 s).
- Earlier, `e2e-pdf-import` failed once on purpose (fix 2's failing-first run) and once on plan-chatgpt-poche (§23), before the passing rerun.

## 29. H.1 — the review never calls a broken reading "exact" (2026-10-18; not committed)

**No real CAD PDF has been tested.** No wall or opening reading rule changed, no image-input behaviour changed, and no existing assertion changed except the ones stated below. CLAUDE.md has the rules ("The plan verdict (step H.1)").

### 1. The problem
A real run said "52 of 52 walls read exactly from the PDF (100%)" beside 38 free wall ends, 17 detached groups, 23 gaps not read, 12 windows rejected and a built model of one "room" made of disconnected blocks. The coverage line only says how many walls match lines; nothing judged the plan.

### 2. What was built
- `src/lib/pdf/verdict.ts` (pure): `planVerdict(plan, coverage)` → Good / Check / Not usable with reasons; `verdictText` writes "Not usable: the walls form 6 separate pieces (the largest holds 17% of the wall length), 12 free wall ends and no closed room." Thresholds in `RULES` with their reasons (70% largest-group share, 2 and 10 free ends); Not usable = largest group under 70%, or no room, or over 10 free ends; Good = one connected building, at most 2 free ends, a room, nothing rejected, no kept detached group; Check = anything else.
- `Coverage.refused` (snap.ts): PDF openings the model's rules turned away; counted with `conflicts` as "rejected openings". `freeEnds` moved from snap.ts to verdict.ts (same rule, 1 cm).
- Review screen: `VerdictBanner` first in the side panel; the walls line is now "N walls match lines in the PDF (X% of wall length); K walls are traced approximately…" and carries `coverageCaveat` whenever the verdict is not Good; on Not usable the button reads "Build anyway", the first click only shows the note, the second ("Confirm: build anyway") builds as before. The openings line still says "read exactly" (not in the brief; a rejected opening shows in the verdict).
- Image input and scanned PDFs have no Coverage, so no verdict.

### 3. Failing first
`scripts/test-pdf-verdict.ts` and the fixture `plan-strips.pdf` were written before `verdict.ts` existed; the run failed with MODULE_NOT_FOUND. The text it replaces was shown on the new fixture: "0 of 6 walls read exactly…" (the default build) and, for the PDF's-walls-alone build, "6 of 6 walls read exactly from the PDF (100% of wall length)" with 12 free ends and no room.

### 4. The fixture
`plan-strips.pdf`: six 3 m strips, 0.2 m thick, no two on one line (a first version put pairs on one line and walls.ts bridged them into 3 walls with an opening) and none within 0.6 m of another across. Generator option `strips`; regenerating left all 37 older PDFs byte-identical (md5) and `truth.json` unchanged: it is deliberately NOT in `truth.json`, because `test-pdf-budget`'s "every vector fixture's walls within 0.5 mm" loop (and the others like it) need walls kept as exact, which a no-building fixture does not have (the validator rounds send its walls back to the tracing). That loop's assertion is unchanged.

### 5. Recorded verdicts (Node, `test-pdf-verdict.ts`; 38 PDFs)
32 Good; 3 Check (plan-outbuilding: a separate shed, two pieces; plan-stem-in-window: an opening left out; plan-chatgpt-poche: a free end and an opening conflict, its known discrepancies); 1 Not usable (plan-strips); 2 with nothing to judge in Node (plan-outlined needs OCR for its scale; plan-scanned is a picture). None Not usable except plan-strips, which genuinely has no room. Chromium (`e2e-pdf-import`) agrees on every fixture (Good except the two Q2 ones, which are Check), plan-chatgpt-flat Good, plan-chatgpt-poche Check. Local files: plan-test.pdf Good, plan-test-2.pdf Check.

### 6. Baseline
`test-plans-baseline.json` gained a `verdict` field per file (plan-test.pdf `good`, plan-test-2.pdf `check`). **No number changed** (both rows unchanged: 16/0/10/0/1/9/0/0/5 and 33/0/13/0/2/12/0/0/8); `e2e-pdf-import` now also fails if a file's verdict gets worse.

### 7. Assertions changed, as stated
`e2e-pdf-import.ts`: the `COVERAGE` regex and `checkCoverage` read the new wording (`coverage-line-text`; `data-walls` for M), and every fixture's plan check is asserted (Good, or Check for the conflict and outbuilding ones, never Not usable, the caveat present exactly when not Good). New: the plan-strips flow at 1440 and 390 (verdict text, verdict first in the panel, "Build anyway", one click only asks, the second builds 6 walls). plan-chatgpt-flat/poche rows assert Good / Check.

### 8. Verification
- `npm test`: exit 0 (new `test-pdf-verdict.ts` last). `npx tsc --noEmit`: clean.
- Cold build: no dev server was running, `.next` deleted, `perl -e 'alarm 300; exec @ARGV' npm run build`: exit 0 in 14 s. Both greps after the build (dev hooks incl. `__background`, and CDN): `clean`. `.next` deleted again and `npm run dev` restarted (port 3000, this checkout).
- e2e-pdf-import: exit 0, first run. e2e-studio: exit 0, first run. e2e-calibrate (not asked for; it drives the review): exit 0.
- **One-off, logged:** e2e-calibrate's local `test-plans/` rows (plan-test.pdf, plan-test-2.pdf) report "FAILED … locator.click: Timeout 30000ms" — `localPlans` clicks "Use this scale" itself and then calls `buildAndOpen`, which clicks it again, and the button is gone. It reports soft (the suite still exits 0). Reproduced identically on a clean checkout of HEAD with all H.1 changes stashed, so it predates H.1 and is not fixed here.
- Limits: the thresholds are rules of thumb tested on synthetic fixtures only; pieces are counted by shared ends (a wall ending on another's middle without a split counts as free); the verdict says openings were left out, not whether the ones kept are right.

## 30. S.1 — walls drawn as one thick stroke (2026-10-18; not committed)

**No real CAD PDF has been read.** The first holdout file is now used up: this step was written after it failed on single-stroke walls, so it can no longer serve as an unseen test. Neither `~/holdout` nor `test-plans/` was opened for new files (the e2e still reads the two existing `test-plans/` files for its baseline, as before). Every rule below is a drawing convention proven on a new SYNTHETIC fixture. CLAUDE.md has the rules ("Walls drawn as one stroke (step S.1)").

### 1. Diagnosis (before any reader change, Node)
`plan-single-stroke.pdf` (the sample house, each wall one stroke on its centre line, 230 / 115 mm at 1:100, butt caps, broken at openings; line-leaf doors in all four hinge / side combinations; three-line windows; 12 thin treads on the south wall; the furniture set; ticked mm dimensions), and the same with round caps, square caps, and mixed (exterior walls as paired outlines drawn with a 1.5 pt pen, 53 mm at 1:100):
- butt / round / square, identical: **0 of 14 walls read.** Each wall is one line, and rule 3 needs a second face 0.05–0.6 m away to pair with, so no single stroke ever became a piece. What was read instead: 17 junk "walls" (the treads paired into overlapping 0.44 m slabs, furniture lines, a 0 m piece), 15 separate pieces, 27 free ends, no room, 14 "detached" groups. Verdict: "Not usable: the walls form 15 separate pieces (the largest holds 28% of the wall length), 27 free wall ends, no closed room and 4 openings the PDF draws were left out."
- mixed: the 9 heavy-pen outlined walls read (as pairs), none of the 5 strokes; the treads became 11 slabs joined to the south wall, splitting it; one 75.9 m² "room" with all four names; 11 free ends; Not usable.

### 2. The fix (`walls.ts`, header "Step S.1")
- A solid, axis-aligned, stroked segment 50–600 mm wide at scale (`WALL_RULES.stroke`) is a wall piece as it stands (`band`), thickness = width, its ends the geometry's (the cap is ignored). Bands go through the existing rules: merge on one line, bridge gaps as openings, rule 7 joints, furniture. Their two edges are lines for rule 3.
- Heavy-pen guard: a thick stroke with a same-width partner (1 mm) two widths to 0.6 m away, overlapping 60%, is a face; a band wholly inside a paired wall's footprint is dropped (an outline's ends). Without this a 0.5 mm-pen paired-line plan at 1:100 would read every face as a 50 mm wall.
- Rule 7c, treads (`furnitureOf`, after the islands): pairs of one axis, span and thickness whose bodies overlap are dropped, reported as "treads" (new `furniture` kind; review label "Stair treads or hatching"), joints redone. First tried at the selection stage: it then removed three of plan-chatgpt-poche's stair slabs that rule 7 used to report as islands, unreported — the snapshot caught it, so it moved after rule 7, where that file reads exactly as before.

### 3. Results (`scripts/test-pdf-stroke.ts`, in `npm test`, failing first: the L junction read nothing)
All four variants: 14 of 14 walls within 0.5 mm and thickness within 0.5 mm, all from the PDF; 9 of 9 openings with kind, class, jambs, hinge jamb and side; rooms Bedroom 1 and 2 14.64975625 m², Living Room 36.62136875 m², Bathroom 7.99475625 m² (hand-computed from the inside faces, 1e-6 m²); the stairs reported once as treads (2.42 × 1 m); verdict Good. Synthetic pages: L, T (to the centre line and to the face) and X junctions; 49 mm no wall, 50 and 600 mm walls, 610 mm none, a dashed wide stroke none; two 53 mm faces 0.23 m apart are one 0.23 m wall. In Node and Chromium, butt caps (and the mixed page) use rule 8 (the tracing breaks at the notches, the PDF's walls stand alone); round and square caps merge, and the PDF's openings replace the traced ones (the caps paint into each gap, so the tracing reads them 0.2 m narrow), with notes.

### 4. Older fixtures: frozen snapshot
`scripts/test-pdf-snapshot.ts` + `tests/fixtures/pdf/reading-snapshot.json`, frozen on H.1 (`94bca8d`) before any change: every fixture's VectorWalls and build. After S.1 all 38 match except **plan-single-line**, listed in `CHANGED`: its w-KM is one 0.1 m stroke, exactly this convention, so it is now read from the PDF (14 of 14 exact; it was 12 exact + 2 traced). plan-chatgpt-flat stays 16 of 16 walls and 10 of 10 openings; plan-chatgpt-poche is identical to the snapshot. Regenerating left every older PDF byte-identical (md5); `truth.json` gained the five new entries and lost plan-single-line's `tracedWalls`.

### 5. Assertions changed, as stated
- The traced-wall checks that used plan-single-line now use **`plan-traced-wall.pdf`** (new, option `pictureWalls`: w-KM drawn as an embedded black picture, no vector line), which reproduces plan-single-line's old reading exactly (12 exact, 2 traced, same notes): `test-pdf-walls.ts` (the section, renamed; plus a new block asserting plan-single-line is 14 of 14 exact), `test-pdf-openings.ts` (plan-traced-wall added to the exact-openings list; comments), `test-pdf-takeoffs.ts` (approximate rows), `test-pdf-conventions.ts` §8 (still merges), `e2e-pdf-import.ts` (PHONE list: plan-traced-wall and plan-single-stroke instead of plan-single-line; the traced screenshot).
- `test-pdf-verdict.ts`: EXPECTED gains the five new fixtures (all Good).
- `e2e-pdf-import.ts`: `PDF_ONLY_FILES` gains plan-single-stroke and plan-single-stroke-mixed (rule 8, as measured in both Node and Chromium).
- The openings line (item 5): now "N openings match features in the PDF (doors D, windows W, unclassified U); T traced approximately; K arcs not used." (`openingsLine`), with `openingsCaveat` beside it when the plan is not Good (`coverage-openings-text`, `coverage-openings-caveat`; `data-total` keeps the old M). Changed lines: `e2e-pdf-import.ts` `OPENINGS` regex (one group fewer; `data-total` asserted instead) and the plan-doors check's expected numbers; the plan-chatgpt-flat line ("10 openings match features in the PDF (doors 5, windows 4, unclassified 1); 0 traced approximately; 0 arcs not used.", no caveat) and the plan-chatgpt-poche line ("13 openings match features … 2 arcs not used.", caveat says Check); `e2e-calibrate.ts` plan-gaps (`/^7 openings match features in the PDF/`, `data-total` 7).
- `e2e-calibrate.ts`: a failed `test-plans/` row now fails the suite; `buildAndOpen` presses "Use this scale" only if it is still there (`localPlans` presses it first to read the review), which was H.1's logged one-off double click. Both rows now build (plan-test.pdf 9 rows 0 flagged; plan-test-2.pdf 12 carried).

### 6. Verification
- `npm test`: exit 0 (new `test-pdf-stroke.ts` and `test-pdf-snapshot.ts` last). `npx tsc --noEmit`: clean.
- Cold build: the dev server (this checkout, port 3000) stopped, `.next` deleted, `perl -e 'alarm 300; exec @ARGV' npm run build`: exit 0 in 11 s. Both greps after it: `clean`. `.next` deleted again, `npm run dev` restarted.
- e2e-calibrate, e2e-studio, e2e-snap, e2e-background: exit 0, first run.
- **One failure, logged before the rerun:** e2e-pdf-import's first run failed "plan-single-stroke.pdf: the tracing was used as before (no PDF-only line)". Not a flake: rule 8 rightly applies to the butt-capped files (section 3), and the e2e's list of rule-8 fixtures did not have them yet. Added (section 5); rerun exit 0. Baseline unchanged (plan-test.pdf 16/0/10/0/1/9/0/0/5 Good, plan-test-2.pdf 33/0/13/0/2/12/0/0/8 Check): no number better, none worse.
- Limits: diagonal strokes are not walls; two parallel single-stroke walls of one width overlapping at least two widths but under 0.6 m apart read as one wall's heavy-pen faces; a heavy-pen wall thinner than twice its pen reads as two thin walls; treads over 0.3 m apart pair into adjacent slabs that don't overlap and are not caught. Synthetic fixtures only.

## 31. Q.4a — arrowheads, two-reading scales, T-junction face breaks, flush jambs (2026-10-21; not committed)

**No real CAD PDF has been read in this step.** The four fixes come from a diagnosis of one real file (made with `scripts/q3-report.ts`); that file is now used up as a test and must not be used to prove these rules. No fresh holdout has been run. Every rule below is a drawing convention proven on a new SYNTHETIC fixture. (HANDOFF has no Q.3 section; the only Q.3 artefact is the diagnosis script.)

### 0. Prediction, written before any change (checked in §5)

- **Fix 1 (arrowheads).** plan-arrows: today both rows are measured "line length" between the arrowheads' BASES, short by the two arrowheads (2.5 + 2.5 and 3.5 + 3.5 text heights), and the scale is off by that ratio (both rows, so the scale band is "good" with a wrong value, or "check" once fix 2 is in). After: "between arrow tips", within 0.1 mm, scale good. Existing fixtures: only plan-chatgpt-poche has filled triangles (20), and their tips sit exactly at its dimension lines' ends, where ticks are measured today. So 10 of its 12 rows change their "how" from "between ticks" to "between arrow tips", with the same lengths (to float). Its scale, reading, build and verdict are unchanged, and so are its baseline numbers (12 dimensions, 0 flagged). Every other fixture: unchanged (no triangles).
- **Fix 2 (two readings).** plan-dims-disagree: "good" today (both readings within 5% of their median), "check" after with "Two readings disagree by 6.2%: …". Existing fixtures that drop from good to check: **none** (every fixture with a dimension scale has 9 or more readings; plan-no-dims has none). The image pipeline is unchanged.
- **Fix 3 (T breaks).** plan-t-breaks: today six 100 mm gaps (one per T: B, H, I, F, L, M) are listed beside the real 300 mm and 100 mm gaps. After: only the 300 mm gap and the 100 mm gap away from any T. Existing fixtures: unchanged. plan-chatgpt-flat keeps its 115 mm gap, because no wall is drawn there. plan-gaps keeps its 300 mm and 4600 mm gaps.
- **Fix 4 (flush jamb).** plan-flush-jamb: today the window flush with partition BI's face is refused ("must sit fully inside its wall"), so the verdict is Check. After: placed, every opening exact, verdict Good. Existing fixtures: unchanged, because none has a refused opening today.
- **Snapshot, verdicts and baseline.**
  - The snapshot of every older fixture: unchanged (it does not record a row's "how").
  - test-pdf-verdict: unchanged for older fixtures.
  - test-plans-baseline: unchanged (plan-test.pdf 16/0/10/0/1/9/0/0/5 Good, plan-test-2.pdf 33/0/13/0/2/12/0/0/8 Check).

### 1. Fixtures (all SYNTHETIC; new `make-pdf-fixtures.ts` options, all off by default)

Regenerating left all 43 older PDFs byte-identical (md5).

| Fixture | Option | What it draws | In truth.json |
| --- | --- | --- | --- |
| plan-arrows | `arrows` | The imperial house with only "10668 mm" and 28'-0", each drawn as two line pieces stopping at filled arrowheads 2.5 and 3.5 text heights long. Text sits in the line's gap. Extension lines are 5 pt (under the 7 pt text height) and set back 1.5 pt. | yes |
| plan-dims-disagree | `twoDims` | plan-filled with only the 10 m and 8 m dimensions, drawn 3% long and 3% short. | **no**: its median is 0.09% off, like plan-strips |
| plan-t-breaks | `faceLines` | Every wall outline as LINES minus the other walls' footprints, so a face breaks at each of the six Ts. Also a real 0.30 m gap on w-BI and a 0.10 m gap on w-CM. | yes |
| plan-flush-jamb | `flushJamb` | The imperial house with A–C as one wall and a 1.2 m window whose jamb is flush with w-BI's east face. | yes, w-AC split at B |

Older truth entries: all identical except plan-gaps, whose `dims[].spans` was corrected (latent bug, §23).

### 2. Failing first (`scripts/test-pdf-q4.ts`, `Q4_ONLY=n`, on the code before each fix)

1. **Arrowheads.**
   - Synthetic: `'ticks' !== 'arrows'` (a 20 pt arrowhead's 8 pt base passed as a tick).
   - plan-arrows: `28'-0"` measured "ticks" 203 pt, against 252 tip to tip (1659.5 mm short, ratio 1.2414). "10668 mm" measured "line length" 280 pt, against 315 (1185.3 mm short, ratio 1.1250).
   - The scale was "good", 0.040071 m/pt against the true 0.033867 (ratio 1.1832).
2. **Two readings.** `two readings 1.1% apart: check`, `'good' !== 'check'`. plan-dims-disagree was "good: 2 printed dimensions agree within 5%, and the title block's 1:100 agrees."
3. **T breaks.**
   - Synthetic: `[100]` for `[]`.
   - plan-t-breaks: gaps 100 × 6 (the six Ts), plus 300 and 100 (the real ones).
4. **Flush jamb.** `refused 1`: "Opening vo1 from the PDF left out: A window must sit fully inside its wall, clear of the walls at its ends. The traced opening o3 is kept instead." The verdict was Check. The rounded jamb sat at 0.0533 m against a span start of 0.05334 m: 0.04 mm out.

After the fixes, every section passes:
- **Arrows.** Both rows are "between arrow tips" with 0.00 mm error, and the scale is good and exact.
- **Two readings.** "Two readings disagree by 6.2%: …"
- **T breaks.** Only 100 and 300 mm are reported.
- **Flush jamb.** 10 of 10 openings and Good.

### 3. Prediction (§0) against the result

- Fix 1: **right.** plan-chatgpt-poche: 10 of 12 rows now "arrows", every length and the scale identical to 4 decimals. No other fixture has a filled triangle.
- Fix 2: **right.** No fixture changed status.
- Fix 3: **wrong on one fixture.** I predicted plan-chatgpt-flat would keep its 115 mm gap, repeating Q.1's description of it as "the break where the truth wants the missing wall".
  - It is not there. The gap is at x 6428–6543 mm on the y 2384.5 mm wall, centred on the 115 mm wall at x 6485.5 that meets it at a T, so it is a T break, and fix 3 rightly drops it.
  - Its snapshot changed only there (`gaps` [0.115] → [], `outOfRangeGaps` 1 → 0), and it is listed in `test-pdf-snapshot.ts` `CHANGED`.
  - Q.1's §4 sentence about that gap was wrong.
- Fix 4: **right.** No older fixture had a refused opening.
- Verdicts: **right.** Every older fixture is unchanged; the new ones are Good.
- Baseline: **right.** e2e: "no number worse than its baseline" for both files, and the numbers are equal (no better either):
  - plan-test.pdf: 16/0/10/0/1/9/0/0/5, Good.
  - plan-test-2.pdf: 33/0/13/0/2/12/0/0/8, Check.

### 4. Assertions and test data changed, as stated

- **`test-pdf-snapshot.ts`.** `CHANGED` gains plan-chatgpt-flat (the T break above). The snapshot was not re-frozen: the four new fixtures are listed as "not in the snapshot", and `test-pdf-q4.ts` covers them.
- **`test-pdf-verdict.ts`.** EXPECTED gains the four new fixtures, all Good.
- **`e2e-pdf-import.ts`.**
  - `checkGapsReview`'s messages now name the file they check instead of "plan-gaps:". It is also called for plan-t-breaks, and takes its screenshot for plan-gaps only.
  - New checks: plan-arrows' rows are "between arrow tips", and a plan-dims-disagree block asserts "check" with the reason.
  - The three truth fixtures go through every generic fixture check at 1440.
- **`package.json`.** `test-pdf-q4.ts` runs before the snapshot.
- **`truth.json`.** Three new entries; plan-gaps' `spans` corrected.
- No other assertion was changed.

### 5. Verification

- `npm test`: exit 0. `npx tsc --noEmit`: clean.
- Cold build: no dev server was running (`lsof -i :3000` empty), `.next` deleted, `perl -e 'alarm 300; exec @ARGV' npm run build`: exit 0 in 12 s. Both greps after the build (dev hooks incl. `__background`, and CDN): `clean`.
- `.next` deleted again and `npm run dev` started: pid 310, cwd this checkout, `/studio` 200.
- `e2e-pdf-import`:
  - First run: failed on plan-flush-jamb's model rows, a bug in the new fixture's truth, logged in §23 before the rerun.
  - Rerun after the generator fix: exit 0. No product source changed between the runs (only the generator, truth.json and docs).
- `e2e-calibrate` (16 s), `e2e-snap` (21 s), `e2e-background` (23 s), `e2e-studio` (150 s): all exit 0 first time, one at a time, no source edited meanwhile.

**The real file that exposed these four problems is now used up. No fresh holdout has been run.** Every rule here is proven on synthetic fixtures only; no real CAD PDF has been read to prove them.

## 32. W.1 — the PDF review off the main thread (2026-10-21; not committed)

X.1's crash was a runaway (`polylabel`) inside `buildPdfPlan`, which ran in the import page's render. X.1 fixed that one runaway; this step moves the whole review into a worker, so any other runaway can only stall that worker. No reading rule or result changed, and neither did image input.

### 1. What ran on the main thread before (measured in Node, warm, ms)

`page.tsx`'s review `useMemo` (re-run on every new scale value) ran `buildPdfPlan` (which runs `buildPlan`, `mergeVector` one to three times, `validatePlan`, `deriveRooms` and `nameRooms`) and then `planVerdict` (another `deriveRooms`). Every render of the tables ran `dimensionRows` and `modelRows`. Build model ran `buildPdfPlan` again, then `withPdfTakeoffs` (`modelRows`, `pdfTakeoffs`, `wallsHash`), `buildMapping` and `keepDrawing` (IndexedDB, async).

| file | buildPdfPlan | planVerdict | modelRows | takeoffs | dimensionRows | structured clone of analysis + pdf |
|---|---|---|---|---|---|---|
| plan-test.pdf (local) | 42.8 | 2.1 | 0.6 | 0.7 | 0.09 | 2.3 |
| plan-test-2.pdf (local) | 39.6 | 1.9 | 0.5 | 0.8 | 0.02 | 2.4 |
| plan-chatgpt-poche | 40.6 | 2.0 | 0.8 | 0.8 | 0.01 | 4.3 |
| plan-chatgpt-flat | 14.3 | 1.7 | 0.3 | 0.3 | 0.03 | 1.4 |
| plan-small-on-big | 3.6 | 0.6 | 0.3 | 0.4 | 0.01 | 3.1 |
| plan-filled | 2.7 | 0.5 | 0.2 | 0.3 | 0.01 | 2.1 |

Nothing was slow on these files. The risk was a runaway, which no time limit on the main thread can stop.

### 2. What was built

- `src/lib/pdf/review.ts` `reviewPdf`: the page's old computation, unchanged. With `carry` it also does the old `withPdfTakeoffs`, moved there verbatim. It also holds the TEST-ONLY `__runaway` loop.
- `src/workers/review.worker.ts`: one worker per job, with no pdf.js.
- `importFile.ts` `runReview`: a 60 s watchdog and `TOO_LONG`. Failures are a `JobError` in plain words. The worker can be injected (`WorkerLike`) for tests. The analysis is sent without its pixel bytes.
- `dimensions.ts` `withOverrides`: overrides laid on rows that were made without them.
- `page.tsx`:
  - the stage "Checking the reading" before the review screen;
  - a pending re-review on a new scale value, with the last review kept and Build disabled;
  - Build's vector build in the worker ("Building…");
  - "Start again" on a stall.
  - `buildFromAnalysis` (images, scanned pages) is untouched.
- The analysis and PDF workers keep their 180 s `STALL_MS`, because OCR on a big scan can be silent for over a minute.
- The sliver guard in `rooms.ts` stays.
- **Found on the way:** Turbopack copies every worker entry's own source verbatim into `.next/static/media` (`analyse.worker.….ts`, `pdf.worker.….ts`, `background.worker.….ts`, and now `review.worker.….ts`). The page loads the compiled `turbopack-worker` chunks, not these copies.
  - With the switch first written in the worker file, its compiled branch was dead, but the dev-hook grep still found `__runaway` in that copy. So the switch lives in `review.ts`.
  - These copies predate W.1 and are left as they are. They ship each worker's source, comments included.

### 3. Failing first

`scripts/e2e-pdf-watchdog.ts` was written before any worker code. It ran against the old main-thread code, with the same switch put temporarily in the review `useMemo`. It failed 6 s in:

`Error: the page's heartbeat stopped for 3.1 s during step "wait for the watchdog's message while the worker loops": its main thread is frozen`

On the new code it passes:
- the message came 60.3 s after the review worker started;
- 626 heartbeats arrived, with the longest gap 105 ms;
- a `page.evaluate` halfway through answered in 1 ms;
- the worker was terminated;
- Start again then read plan-filled as Good.

The first run on the new code failed on a bug in the test itself (section 23).

### 4. Tests

- **`scripts/test-review-worker.ts`** (new, in `npm test`, before the snapshot) runs the real worker module in a Node worker thread through `scripts/worker-thread.ts`. It checks:
  - **45 fixtures**, each reviewed and built through the thread. Each equals the old page code, kept in the test verbatim, apart from the creation time. 44 of them carry dimensions as takeoffs with an override.
  - `withOverrides` equals overrides passed to `modelRows` and `dimensionRows`.
  - The error paths:
    - a BlueprintError keeps its words;
    - a bug, a missing worker script, an unreadable reply, a wrong-shaped reply, and a bug's own message with `user: false` each give fixed sentences;
    - the bug's details go to the worker's console.
  - `cancel()` rejects with `Cancelled` and terminates the worker.
  - The runaway: about 70 heartbeats on the test's thread with the longest gap under 30 ms; a 1.5 s watchdog fires within 1.5 s and terminates the thread.
  - `REVIEW_STALL_MS` is 60 s, and `STALL_MS` is still 180 s.
- **`test-pdf-snapshot.ts`**: unchanged, and it passes. All 38 frozen fixtures read, build, judge and derive rooms exactly as frozen, and the same two are listed as changed.
- **`test-import-cycles.ts`**: 121 files, no cycles.
- **No existing assertion was changed.** Waits were not needed either: the review screen appears only once its review is in.

### 5. Limits

- Images and scanned pages still build on the page.
- A worker that runs out of memory still takes the tab.
- One review runs at a time.
- The e2e checks the 60 s watchdog at 1440 only.

### 6. Verification

- `npx tsc --noEmit`: clean. `npm test`: exit 0 on the final tree, with `test-review-worker.ts` included.
- **Cold build**, twice:
  - The dev server was stopped and `.next` deleted, then `perl -e 'alarm 300; exec @ARGV' npm run build`: exit 0 in 12.8 s.
  - The dev-hook grep, with `__reviewRunaway|__runaway` added, found `__runaway` in the media copy of `review.worker.ts` (§2). The switch was moved into `review.ts`.
  - Rebuilt cold: exit 0 in 13.2 s. Both greps then printed `clean`, and the compiled review chunks contain no `for(;;)`.
- `.next` deleted again and `npm run dev` restarted: pid 14750, cwd this checkout, `/studio` 200, nothing else driving port 3000.
- **Browser suites**, one at a time, `/studio` probed before each. Each exited 0 first time on that server, with no source edited meanwhile:
  - `e2e-pdf-watchdog` 68 s: message after 60.4 s, longest heartbeat gap 119 ms.
  - `e2e-pdf-import` 120 s. Per-file times are 1.0–1.8 s, as in earlier steps, and the test-plans rows are unchanged against the baseline. The longer total is not explained.
  - `e2e-studio` 154 s, `e2e-snap` 22 s, `e2e-background` 22 s, `e2e-calibrate` 16 s, `e2e-offline-ocr` 21 s.
- The one failure on the way, `e2e-pdf-watchdog`'s first run (a test bug), is logged in section 23.

## 33. C.1 — GitHub Actions on a clean machine (2026-10-21; not committed)

No product code and no assertion changed. New files: `.github/workflows/ci.yml` and `.nvmrc` (`24.14.0`, the Node the project is developed on; the repo had neither `.nvmrc` nor `engines`, so CI reads this file).

**Inputs `npm test` has outside git** (audited by grepping every script it runs for `test-plans`, `test-models`, home folders, `/tmp`, env vars, ports, `fetch`, `existsSync`):
- `scripts/test-hollow.ts`: plan 06 (`test-plans/06_real_listing_main_case.jpg`, gitignored, a real listing). Genuinely optional, and it already printed `SKIPPED … plan 06 was NOT checked`. Left as it is; CI's log will show that line, and the other four fixtures it checks are tracked.
- `scripts/test-pdf-walls.ts`: real tesseract on `plan-outlined.pdf` runs only if `public/tesseract/eng.traineddata.gz` exists. That file IS tracked (`.gitignore` only has `*.traineddata`, which does not match `.gz`), so it runs in CI; `test-ocr-assets.ts` fails if it goes missing.
- Everything else reads tracked files: `tests/fixtures/` (images, the PDFs, truth, snapshot, baseline, models), `public/tesseract/`, `public/pdfjs/`. Env vars (`CYCLE_ROOT`, `OCR_ROOT`, `UNITS_ROOT`, `SNAPSHOT_WRITE`, `PRINT_VERDICTS`, `Q4_ONLY`) are all optional overrides. No test needs a dev server, a port or the network.
- The repo-root `eng.traineddata` is gitignored and only `scale-report.ts` (not in `npm test`) uses it.

**Proof on a clean copy.** `git clone` of the local repo into a temp folder (no `node_modules`, no `.next`; HEAD was `1a2419d`, W.1 already committed), on macOS, Node 24.14.0: `npm ci` exit 0, `npm test` exit 0 (one `SKIPPED` line, plan 06), `npx tsc --noEmit` exit 0, `npm run build` exit 0 in 12 s, both greps `clean`, and `git status` clean afterwards (no test writes into the tree). Nothing needed fixing.
- **Not proven: Linux.** Docker's daemon was not running here and nothing was pushed, so the first real Linux run is the first push. The lockfile has the Linux x64 binaries (`@img/sharp-linux-x64`, `@napi-rs/canvas-linux-x64-gnu`, `@next/swc-linux-x64-gnu`, `@tailwindcss/oxide-linux-x64-gnu`, `lightningcss-linux-x64-gnu`). The PDF tests rasterise with `@napi-rs/canvas`, and the snapshot and "walls within 0.5 mm" tests read that raster, so a different rasteriser on Linux is the likeliest first failure. If it fails, fix the cause; do not loosen an assertion.
- `next build` fetches Marcellus and Figtree from Google Fonts (`next/font/google`) at build time. CI has network, so that works, but it is a build-time dependency on a third party.

**ci.yml.** `push` and `pull_request`; 15-minute limit; `concurrency` cancels older runs on the same ref; `actions/setup-node` with `node-version-file: .nvmrc` and the npm cache; steps `npm ci`, `npm test`, `npx tsc --noEmit`, `npm run lint` (`continue-on-error`), `npm run build`, then the two greps written as `if grep -rlE …; then exit 1; fi`, so a hit FAILS the step (the local `|| echo clean` form cannot fail).
- **Lint fails today: 25 errors, 926 warnings.** 19 errors are in vendored `public/tesseract/{worker.min,tesseract-core-lstm.wasm,tesseract-core-simd-lstm.wasm}.js` (`no-this-alias`, `no-require-imports`); 6 are `react-hooks` errors: `refs` ×2 in `PlanViewer.tsx`, `refs` ×2 in `PlanModel.tsx`, `set-state-in-effect` in `ItemPanel.tsx`, `immutability` in `ImportedItems.tsx` (these are the "historical lint errors" of section 17). That is why lint is non-blocking. To make it blocking: ignore `public/tesseract/**` in `eslint.config.mjs`, fix the six, then delete `continue-on-error`.

**The e2e workflow was NOT added.** On the same clean copy, with `npm run dev` on port 3100 (`E2E_URL`) and the Chromium already on this Mac, `e2e-pdf-import` (147 s), `e2e-studio` (175 s) and `e2e-pdf-watchdog` (67 s) each exited 0 on their first run, so nothing they need is missing from git (OCR assets and fonts are tracked or fetched; the `test-plans/` rows print "no .pdf files, nothing extra to read"). But that is one macOS run, not "reliable on a clean runner", and there is no way to show the latter from here:
- Nothing can run on a GitHub runner before a push.
- `e2e-pdf-import` compares against numbers recorded from Chromium on macOS, and section 23 shows Chromium's rasteriser changes the tracing (Q.2 lessons); Linux Chromium is a third rasteriser.
- Section 23's flake hunt found the suites' failures were product regressions, but it ran on this Mac only.
- To add it later: a `workflow_dispatch` job that does `npm ci`, `npx playwright install --with-deps chromium`, `npm run dev &`, a wait on `/studio`, then the three scripts, run on a branch three times green before it is made nightly. It needs no secrets, OCR files or fonts beyond what is in git.

**Badge for the README** (README text not edited): `[![CI](https://github.com/RachitMittal-20/Atrium-v2/actions/workflows/ci.yml/badge.svg)](https://github.com/RachitMittal-20/Atrium-v2/actions/workflows/ci.yml)`

### C.3 — the first Linux run (2026-10-21; not committed)

The first CI run failed at `scripts/test-import.ts`: "the committed table.zip is what writeFixtures writes" (Mac `81cbd438…`, runner `891d9422…`). Only `scripts/test-import.ts` and `scripts/test-pdf-snapshot.ts` changed; no product code, no other assertion.

**Cause: certain, a time zone.** fflate writes each zip entry's DOS timestamp with LOCAL-time getters (`getHours()` and friends, `fflate.module.js` ~line 1864), but `ZIP_MTIME` in `make-import-fixtures.ts` is `Date.UTC(2026, 0, 1)`. This Mac is in IST, so it writes 2026-01-01 05:30; a runner is in UTC and writes 00:00. Evidence, all reproduced (Docker, `node:24.14.0`, `linux/amd64`, `npm ci` from the lockfile):
- The inputs are identical on both: obj `1327443d…`, mtl `f047d36e…`, PNG `3ecee2a9…` (sharp 0.35.5, libvips 8.18.7, zlib-ng 2.3.3 on both), and fflate's deflate of the obj `3a69e8d2…`. So not the PNG encoder, the compression level, entry order or line endings.
- Linux (UTC) gives `891d9422…`, Mac (IST) `81cbd438…`. `TZ=UTC` on the Mac gives `891d9422…`; `TZ=Asia/Kolkata` in the Linux container gives `81cbd438…` (`TZ=America/New_York` gives a third, `4d3487a0…`).
- Consequence: M.1d's claim that the committed zip "never shows up in `git status` after an e2e run" holds only in the zone it was written in. Anyone in another zone who re-runs `writeFixtures` gets a diff. A one-line fix in the writer (`new Date(2026, 0, 1)`, which is local midnight in every zone) would make the bytes zone-independent, but it changes the committed file, so it was not done; the test no longer depends on it.

**The fix.** The byte-exact comparison is gone. `test-import.ts` now checks, on the committed `table.zip`: the importer's real reader (`unzipFiles`) opens it with no warnings; the entry names in order (`table/table.obj`, `table/table.mtl`, `table/textures/wood.png`); each entry's uncompressed SHA-256 equals the committed loose file; `table.obj` and `table.mtl` equal what `writeFixtures` produces byte for byte (text); `wood.png` equals it by its decoded pixels (the PNG bytes belong to sharp's encoder); and `pickModel` finds the model. "Writing twice gives identical bytes" stays. The new assertions were shown to fail on a deliberately wrong expected entry.

**Audit of every other test.** The only hash in `npm test` (and in the e2e suites) was that one. Nothing in `npm test` regenerates a PDF, glb or PNG and compares bytes to a committed file; `make-pdf-fixtures.ts` runs by hand, and its "byte-identical" check is a manual md5. Persist and takeoff tests pass a fixed `Date`. Left alone: `test-pdf-snapshot.ts`'s JSON comparison of everything the PDF says, and every other test.
- **The audit missed a platform dependence, found by running the whole suite on Linux.** `test-pdf-snapshot.ts` failed on `plan-against-wall.pdf` there. The built plan (walls, openings, rooms, verdict, counts) is identical; only `coverage.notes` differ, because that fixture's picture-trace is raster noise and Skia (`@napi-rs/canvas`) anti-aliases a little differently: the traced walls are numbered p19/p22 and "p15" / "p15+p16", and on Linux one traced opening has no wall, which adds "1 opening had no wall under them and was left out." The comparison (`stable()`, comparison only, the frozen file is untouched) now compares a traced wall's id as `p#` inside the notes and skips that one note, which counts traced openings only (`snap.ts`, `lost`). Everything else, including the other notes, is compared exactly. This does loosen the notes for traced items; it is the one place where the traced layer's identity is not stable across rasterisers (HANDOFF section 23 / Q.2 said the same of Chromium).
- **Caveat on that one:** it was reproduced under Docker on an arm64 Mac, which emulates x86-64 (Rosetta/QEMU lack some CPU features Skia may pick at run time). A real GitHub runner could differ again; the CI run is the proof.

**Verified.** On the Mac: `npm test`, `npx tsc --noEmit`. In a clean clone of HEAD plus the two changed files: `npm ci && npm test` exit 0 (one `SKIPPED` line, plan 06). In `node:24.14.0` `linux/amd64`: all of `npm test` exit 0 (it failed first at `test-import`, then, with only that fixed, at `test-pdf-snapshot`). **Not done:** nothing was committed or pushed, because the task said not to commit; `gh` is not installed, so the Actions result is not known. Branch for the run: `git switch -c ci-fix && git commit -am "…" && git push -u origin ci-fix`.


## 34. E.1 — project save and open, no dead menu items (2026-10-21; not committed)

No geometry, reading rule or existing assertion changed except the one stated below. CLAUDE.md has the rules (section "Project files").

**Dead menu items found (step 1).** The Export menu's GLB, OBJ, PDF, DXF and CSV were `aria-disabled` buttons saying "Coming soon". The Import menu's two items work. The tool rail has no dead tool (its "coming soon" tooltip is an unreachable fallback string). **Removed:** all five export items (none of those exports exists; the takeoff panel has its own CSV button). **Implemented:** "Save project…" under Export and "Open project…" under Import.

**What was added.** `src/lib/persist/projectFile.ts` (format, strict reader, size rule, base64, hash check), `planStorage.migrate` exported, `planStore.replacePlan` (one undo step, marks kept), `src/store/projectStore.ts` (unsaved baseline, save, open, sizes), `src/components/studio/ProjectDialog.tsx`, the TopBar items, a `key` on the studio panes so they refit after an open, `scripts/test-project-file.ts` (in `npm test`), `scripts/e2e-project-file.ts`.

**Existing assertion changed:** `e2e-studio.ts`, "menus": it expected five disabled "Coming soon" export items; it now expects the Export menu to hold exactly "Save project…" and no "Coming soon" text in the top bar.

**Decisions to know about.**
- The project file reuses the autosave's schema number and reader, so a future `SCHEMA_VERSION` bump and its `migrate` case cover both.
- A restored or freshly imported plan counts as unsaved (the baseline is the sample plan at app start), so Open asks. Chosen over silently replacing work that never reached a file; Undo takes it back either way.
- An asset whose bytes don't hash to its id makes the whole file damaged (not skipped), so a tampered model can't be stored under a trusted id.
- The takeoff in `e2e-project-file` is added through `__planStore` (test data); saving, opening, the file chooser and the download are real.

**Verified (2026-10-21, macOS, Node 24.14.0).** `npm test` exit 0 (new `test-project-file` included; it failed first with "Cannot find module projectFile" before the code existed), `npx tsc --noEmit` exit 0, cold build (dev server stopped, `.next` deleted, `perl -e 'alarm 300; exec @ARGV' npm run build`) exit 0 in 12 s, both greps clean, then `e2e-studio`, `e2e-import3d`, `e2e-background` and `e2e-project-file` (1440 and 390) all exit 0 against a fresh dev server.

**One-off failures on the way, all in the new e2e's own setup (test bugs, not product), each fixed before the green run:**
1. It assumed the built plan had exactly one takeoff; the PDF's printed dimensions are takeoffs too (11 of them), so it now looks for its own "North run".
2. It waited for `data-ok="true"` and read "Opening …" (the busy state is also ok); it now waits for the dialog's `data-mode="result"`.
3. The "Import it again" check ran in the 3D view, where the Drawing section is not rendered; it now switches to 2D first.
The only product-side surprise was that the cameras do not refit when the plan is replaced under a mounted editor, which is why the panes are remounted on open (`projectStore.epoch`).

**Not covered:** a real phone, Safari and Firefox; a project near 200 MB (the limit is tested from `file.size` only); the download's behaviour in a browser that blocks blob downloads.


## 35. D.1 — ready for a first public link (2026-10-21; not committed)

No reading rule, geometry, detection or existing assertion changed. Nothing was deployed. CLAUDE.md has the rules (section "First public link").

**What was found and done**
- **Fonts.** `next build` DID fetch Marcellus and Figtree from Google (`next/font/google`; section 33 noted it). They are now `src/app/fonts/{marcellus,figtree}-latin.woff2`, the exact files that build produced, loaded with `next/font/local`; the build runs with no network need and the look is unchanged (checked in screenshots). **Latin-extended subsets were not copied** (the Google build had them): characters above U+00FF fall back to Arial/Times. CI's CDN grep gained `fonts.googleapis|fonts.gstatic`.
- **Headers** (`next.config.ts`): `/tesseract/*` and `/pdfjs/*` immutable for a year. Checked with curl against `npm run start`: `.js` `application/javascript`, `.gz` `application/gzip` (no `Content-Encoding`), `.wasm` `application/wasm`, the PDF worker chunk under `/_next/static/chunks/` already `public, max-age=31536000, immutable` from Next. **Not checked on Vercel**; docs/DEPLOY.md lists the curl lines to run on the deployed link.
- **Bundle** (`npx tsx scripts/bundle-report.ts`, from Turbopack's `route-bundle-stats.json`; gzip is computed here): `/` 10 chunks 602 kB raw / 192 kB gzip; `/limits` 589 / 186; `/studio` 17 chunks 1915 / 565; `/studio/import` 19 chunks 1227 / 384. The PDF reader is one on-demand chunk of 1.6 MB raw / 489 kB gzip. All five routes are static (`○`).
- **docs/DEPLOY.md** has the exact Vercel steps and settings (Node 24.x must be set in the project; Vercel does not read `.nvmrc`), post-deploy curl checks, the cache table, sizes and rollback.
- **/limits**, **Report a problem**, the **first-run hint**, **error and not-found screens**, **metadata** and the **share image**: as in CLAUDE.md.

**Decisions to know about**
- One `src/app/studio/error.tsx` covers the studio and the nested import page; the landing page has no boundary of its own and there is no `global-error`.
- Report content: counts, verdict level and reasons, scale source and confidence, PDF page kind, warning codes, browser, screen, window, version, typed note. It deliberately leaves out scale VALUES, validator messages and PDF notes (free text can carry names). The studio's verdict judges the walls only (empty PDF coverage), so "Detached" and "refused openings" reasons never appear there.
- The "tested on synthetic drawings and a few real plans" sentence is the one the task asked for; section 26 and 27 say no real CAD PDF had been read at those steps and Q.4a read one real file. Check it is still the wording you want before sharing.
- The share image has no text (title and description are meta tags); `og:image` is absolute only on Vercel (`VERCEL_PROJECT_PRODUCTION_URL`), `http://localhost:3000` otherwise.
- **An existing guard needed an entry:** `scripts/units-allowlist.json` was empty; `/limits` states the default heights in metres (a static page cannot follow the units setting), so it now holds one entry with its reason. No assertion changed.

**Tests**
- `scripts/test-feedback.ts` (in `npm test`): a plan and a reading stuffed with a plan name, file name, room and model names, 6-digit coordinates, free-text warnings, notes and scale reasons go through the real collectors; the text contains none, has no decimal of two or more places and no "(x, y)" point, and does hold the counts, verdict, scale line, PDF line, warning codes, browser, screen and note. Shown to fail when a collector is made to copy the plan name.
- `scripts/test-error-screen.ts` (in `npm test`): a thrown Error gives the plain message and a Reload button, none of the error's text and no digest, and the 404 page. **It renders the boundary's component with react-dom/server; it does not mount a boundary** (no DOM library in the repo and none was added). The real boundary catching a real render error is only in `e2e-feedback`.
- `scripts/e2e-feedback.ts` (not in `npm test`; needs `npm run dev`) at 1440 mouse and 390 touch: footer and import links to /limits, the page's statements and title, the hint and sample button, no Report button when idle, the import report (text checked, file name absent, note typed, Copy compared with the real clipboard, Download compared byte for byte), the studio report (plan and room names absent), a real render error (a wall with no ends set through `__planStore`) showing the screen and Reload restoring the studio, the 404 page with status 404, dialogs inside the viewport and no sideways scroll at 390. Screenshots `/tmp/studio/feedback-*.png`.

**Failures on the way (all logged, none product-side except the first):**
1. `npm test`: `test-units-everywhere` found "2.7 m" in `/limits` (hard-coded unit text). Fixed with an allow-list entry, as that test prescribes.
2. `tsc` reported `.next/dev/types/validator.ts` errors after adding `layout.tsx` files: stale generated types from an earlier dev run; deleting `.next` and rebuilding cleared them.
3. `e2e-feedback` first runs: `/studio/import` title lacked "| Atrium" (a layout that sets a title replaces the root template; `studio/layout.tsx` now carries its own); the test expected "chosen from" before any scale was chosen; `setState({ plan: null })` threw inside a store subscriber instead of a render (test bug; a malformed wall is used); Chromium's own "Failed to load resource 404" console line for the 404 visit (now asserted as the only line, then removed).

**Verified (macOS, Node 24.14.0), on the final tree:** `npm test` exit 0 (`test-feedback` and `test-error-screen` included, after the allow-list entry); `npx tsc --noEmit` exit 0; cold build (dev server stopped, `.next` deleted, `perl -e 'alarm 300; exec @ARGV' npm run build`) compiled in 5.1 s, 13 s in all, every route static; the dev-hook grep (including `__background`, `__runaway`) and the CDN/Google-fonts grep both printed `clean`; `npm run start` header and content-type checks as above; then `npm run dev` restarted from this checkout (pid 77452, `.next` deleted first) and, one at a time, `e2e-feedback` exit 0 (1440 and 390), `e2e-studio` exit 0 (158 s), `e2e-pdf-import` exit 0 (130 s, no baseline row worse). `e2e-feedback` failed four times earlier for the reasons in the list above before its green run.

**Not covered / limits:** a real deployment; Vercel's own headers and content types; a real phone, Safari, Firefox (clipboard needs a secure context); a boundary around the landing page; no `global-error`.

## 36. R.2 — one judgement on the review screen (2026-10-23; not committed)
**Done:** (1) `shownWarnings` (`src/lib/pdf/warnings.ts`) hides the hollow-walls and low-confidence notes when the build is `pdfOnly`; the import page filters `analysis.warnings` through it. (2) "Choose a scale first." is now "Press Use this scale (or set it yourself) to continue." (3) Overlay check, below. (4) `scripts/test-import-warnings.ts` added to `npm test`; it failed first (module and new text missing).

**Changed assertions:** none existing. No test asserted the old hint or the warnings' visibility (grep of `scripts/` and docs found only this file's own mention). Reading rules, verdict and snapshot are untouched.

**Item 3, the green window boxes** (Playwright at 1440, `/tmp/studio/r2-plan-chatgpt-flat.png`, `r2-plan-filled.png`, script `/tmp/studio/r2-overlay.cjs`): `plan-chatgpt-flat.pdf` has two tilted boxes (1.54° and -82.55°) and two oversized ones (385 px and 92 px long, stroke 44 and 46 px against 8–10 px for the true small windows). `plan-filled.pdf`: all five exactly 0/90/180°, lengths 48–97 px. `PlanViewer.bar()` draws a straight `<line>` from `o.a` to `o.b` with stroke = wall thickness x 1.2, so the drawing is faithful: the traced `analysis.openings` carry the wrong endpoints/thickness. Data bug in the image pipeline, NOT fixed (as instructed). Neither fixture showed a hollow or low-confidence warning in Chromium, so the visible effect of (1) is covered by the Node test only.

**Verified (macOS, Node 24.14.0):** `npm test` exit 0; `npx tsc --noEmit` exit 0; cold build (dev stopped, `.next` deleted, `perl -e 'alarm 300; exec @ARGV' npm run build`) exit 0; dev-hook grep and CDN grep over `.next/static` both clean; dev restarted; `e2e-pdf-import` exit 0 and `e2e-studio` exit 0. No one-off failures.

**Not covered:** the page's use of `shownWarnings` is checked by a source-text assertion and tsc, not by a browser case with a hollow plan that is also pdfOnly (none exists among the fixtures); Linux CI not run here (the test uses only committed fixtures).

## 37. G.1 — Walk through walls (2026-10-23; not committed)
**How walking used collision before G.1:** each frame WalkControls called `getCollision(livePlan)` (memoised on `plan.walls` / `plan.openings`) and `moveWithCollision(c, pose, walkStep(...).delta)`. The rescue ran only when that returned a new build: below radius − 1 mm of clearance the camera went to `freePointNear(c, p, 2)` (rings 1 cm apart, 72 directions, freest point on the first ring with one), else to `startPose`, else the walk ended with NO_ROOM_NOTICE; velocity was zeroed and MOVED_NOTICE shown, then the eye height was recomputed.

**Done:** `moveWithCollision(…, { ghost })` (solids skipped, fence kept); `rescuePoint` (the old inline rescue, moved into `collision.ts` unchanged so Node can test it); `viewStore.ghost` / `setGhost` / `GHOST_KEY` / `GHOST_STATUS`, reset by `enterWalk` and `exitWalk`; WalkControls passes the flag, skips the rescue on a rebuild while ghost is on, and rescues at once when it turns off; the overlay toggle and status line. CLAUDE.md "Walk through walls (step G.1)" has the rules.

**Failing first:** `test-walk.ts` (m) was written before the option existed and failed with `(m) ghost through w-AB ended at {"x":2,"y":0.30000000000000004}` (stopped at the face + radius). Its first draft then aimed at (2, −2), outside the fence (y −1.1), and failed again for that reason; the target became (2, −0.9). That was a test error, not a flake.

**Tests added (npm test):** `test-walk.ts` (m) ghost through w-AB, a window and one move across a wall, no rebuild, solids unchanged; (n) 20,000 seeded ghost moves on the sample and fixtures 01–04, each ending exactly where it aimed, clamped to the fence (about 7,000 per plan would have been stopped by walls, about 1,300 end inside one); (o) `rescuePoint`: inside w-AB → 0.25 m into bedroom 1; d-bed1's doorway centre stays; 5 cm from its jamb → 0.15 m; corner joint A → (−0.3, 0), outside the building (the nearest clear point); bedroom 1's corner → 0.15 m diagonally; on w-AB's centre line → (2, 0.3), inside; far from walls stays; each clear, within 2 cm of a brute-force nearest clear point, inside the fence and able to move 0.3 m; a 6 m slab → the start pose; no room → null. `test-walk-input.ts`: the flag refused outside walk, off on every start and after exit, not in the payload; G unique.

**Changed assertions:** none. (a)–(l) call the mover with no option, exactly as before. In `e2e-walk.ts` the existing exit block (Escape / Exit, orbit back within 0.001 mm, same direction, fov, near, Move enabled) is unchanged but now runs AFTER the ghost section, inside a `leave()` helper that runs twice (after the ghost section, and after a second walk); it gained one assertion, that the toggle is disabled again.

**e2e-walk** (not in npm test): reduced motion is emulated for the ghost section (a real media query), because with smoothing a released key carried the camera about 0.1 m on, out of a 0.1 m wall. 1440 with G and W/S, 390 with taps and the joystick (gently, 14 px, to back in): through the wall (0.72 m / 0.77 m past where it had stopped), backed in (clearance −0.019 / −0.021 m), off → moved 0.22 / 0.23 m to clearance ≥ 0.2 m with the notice, eye unchanged; orbit camera back within 0.000000 mm both times; the next walk starts with it off. At 390 the toggle is ≥ 44 px and overlaps neither the joystick nor Exit. Screenshots `/tmp/studio/walk-ghost-on-1440.png` and `walk-ghost-390.png`: the toggle pressed, the status line and the hint; the camera stands inside an exterior wall facing out, so the frame shows only the ground grid outside the house. No wall is visible: they prove the UI state, not the passage (the numbers do).

**Verified (macOS, Node 24.14.0):** `npm test` exit 0; `npx tsc --noEmit` exit 0; cold build (dev stopped, `.next` deleted, `perl -e 'alarm 300; exec @ARGV' npm run build`) compiled in 4.8 s; dev-hook grep (incl. `__background`) and CDN grep clean; dev restarted from a fresh `.next`; `e2e-walk`, `e2e-feedback` and `e2e-studio` exit 0, each on its first run. No one-off failures.

**Limits:** the rescue can land outside the building when that is nearest (a corner joint, an exterior wall entered from outside); the fence (solids' box + 1 m) still holds with ghost on; the hint line does not mention G (the button's title and `aria-keyshortcuts` do); not tested on a real phone, Safari or Firefox; Linux CI not run here (the new tests use only committed fixtures and seeded randomness).

## 38. R.3 — the review overlay draws the built plan's openings (2026-10-23; not committed)
**Step 1, which data the overlay drew:** `PlanViewer` drew `analysis.openings`, the picture tracing's openings, never the PDF-read ones the model is built from. Numbers (Node, `buildPdfPlan` at the PDF's scale):
- `plan-chatgpt-flat.pdf` (`pdfOnly`, 57.1 px/m): 8 traced openings against 10 in the plan. Traced boxes: 384.7 px long at 1.55° (stroke 44.4), 91.8 px at -82.55° (stroke 45.6), one at -79.81° (stroke 36), one at -87.42° (stroke 18). The plan's openings are 51-91 px wide on walls 6.6-13.1 px thick.
- `plan-filled.pdf` (NOT `pdfOnly`: no traced wall or opening, but rule 8 does not fire since the merge already used every PDF wall; 80.8 px/m): 9 traced against 9 in the plan, all axis-aligned, but 96.0 vs 96.9 px, 80.0 vs 80.8 px, 19.2 vs 16.2 px stroke (1.2 x a traced thickness). That is up to about 11 mm off, so 1 mm fails.

**Done:** `src/lib/pdf/overlay.ts` (`openingBars`, `drawnFromPlan`); `PlanViewer` takes `exactOpenings` and draws those bars (stroke = the wall's thickness) instead of the traced ones; the page passes it when `drawnFromPlan(coverage)`. WalkOverlay's keyboard hint gains "G to walk through walls". CLAUDE.md has "Overlay boxes from the built plan (step R.3)"; R.2's "known data bug" line there now points to it.

**Decision to confirm:** you asked to switch on `coverage.pdfOnly`. plan-filled is not `pdfOnly` but the tests you asked for need its boxes exact, so `drawnFromPlan` is `!fellBack && (pdfOnly || no traced wall && no traced opening)`. Anything with a traced wall or opening (4 fixtures in e2e) still draws the tracing's boxes, as today. If you want strictly `pdfOnly`, plan-filled's boxes stay up to 11 mm off and its test cases must go.

**Tests:** `scripts/test-overlay-openings.ts` (in `npm test`) for plan-chatgpt-flat and plan-filled: angle within 0.01° of the wall, length = opening width and thickness = wall thickness, each within 1 mm; plan-traced-wall keeps the tracing. FAILING FIRST: the check run on the old source (traced boxes) gives 24 violations on plan-chatgpt-flat (22 on plan-filled); that control stays in the test. I wrote `overlay.ts` before the test, so the new code never ran red; I proved the test catches a regression by temporarily drawing 1.2 x thickness (20 violations), then reverted. `e2e-pdf-import` reads the rendered SVG (`data-openings-from`, `data-opening-id`, `data-px-per-m`) before Build model and compares each box with the plan the studio opens, at 1440 and 390: every fixture on the plan path (plan-filled and plan-chatgpt-flat at both sizes, many more at 1440), plus a 390 plan-chatgpt-flat block.
**Changed assertions:** none existing. New: the `readOverlay` / `checkOverlay` helpers and the 390 block in `e2e-pdf-import.ts`, and one clause on the plan-chatgpt-flat summary line.

**Screenshot `/tmp/studio/r3-overlay-1440.png`:** the overlay of plan-chatgpt-flat at 1440, taken before Build. The whole A3 sheet is fit, so the plan is small in the middle of a large page. The doors (blue) and windows (green) are short bars across the gaps, each as thick as its wall and none tilted; no long oblique bar like the old 385 px one. The orange dots are the tracing's free wall ends, a separate layer, unrelated to this fix. At this size the bars are hard to judge by eye, so the screenshot is supporting evidence and the assertions are the proof.

**Verified (macOS, Node 24.14.0):** `npm test` exit 0; `npx tsc --noEmit` exit 0; cold build (dev server stopped, `.next` deleted, `perl -e 'alarm 300; exec @ARGV' npm run build`) exit 0 in 14 s; dev-hook grep and CDN grep over `.next/static` both clean; dev server restarted (`.next` deleted first), then one at a time: `e2e-pdf-import` exit 0, `e2e-studio` exit 0, `e2e-walk` exit 0.
**One-off failure, logged:** the first `e2e-pdf-import` run died at its first step with `page.evaluate: ReferenceError: __name is not defined`. My new `readOverlay` had a named inner arrow (`const num = …`), the F.1 keepNames trap. Fixed by inlining it; the rerun passed.

**Not covered:** the keyboard walk hint at 390 px wide was not looked at: its `<p>` wraps as before and touch devices keep their own hint, but `e2e-walk` at 390 uses touch and checks neither text; no real phone, Safari or Firefox; Linux CI not run (the new test uses only committed fixtures); a build that keeps a traced wall or opening still shows the tracing's possibly wrong boxes.

## 39. 8.1 — the blueprint scene on the landing page (2026-10-23; not committed)
**Report first (before any code).** Landing first load was 10 chunks, 603 kB raw / 192 kB gzip (fresh `next build` of HEAD, `scripts/bundle-report.ts`). LandingTour pins one `h-svh` section with ScrollTrigger (`pin`, `scrub: true`, `start: "top top"`, `end: +=560%`, one timeline of arch clip-paths and text fades), reading Lenis through `scrollerProxy`. react-three-fiber and three.js were NOT on the landing page: no first-load chunk held `WebGLRenderer`, `react-three` or `useFrame`.

**Done.** CLAUDE.md "The blueprint scene on the landing page (step 8.1)" has the rules. New: `src/lib/landing/{blueprint,blueprintMeshes,timeline}.ts`, `src/components/landing/{BlueprintScene,BlueprintCanvas,BlueprintDrawings}.tsx`, `scripts/test-landing-scene.ts` (in `npm test`), `scripts/e2e-landing.ts`. Changed: `src/app/page.tsx` (the scene before the tour, `<main className="bg-iron">`), LandingTour's header comment only, `package.json` (the new test). No studio code, reading rule or existing assertion changed.

**Bundle.** `/` first load: 11 chunks, 609 kB raw / **194 kB gzip (+2 kB)**. On a production server (`next start`, Playwright): reduced motion fetches 11 JS files, 197 kB compressed; 3D mode 14 files, 448 kB. The three extra (2.8, 146 and 101 kB) are the scene code, three.js and react-three-fiber, fetched only after the browser chose 3D. No console errors in either. A first build gave 196 kB because BlueprintScene imported two constants from `blueprint.ts` and Turbopack shipped that module with geometry.ts and plan2d/openings.ts; they now live in `timeline.ts`.

**Failing first.** `test-landing-scene.ts` was written before `src/lib/landing` existed and stopped at "Cannot find module '../src/lib/landing/blueprint'".

**Tests.**
- `test-landing-scene.ts`: 14 extruded walls = the plan's 14, each vertex-identical to `buildWallMeshData`; 9 openings cut (both jambs on their wall, a lintel, a sill for windows); the sheet = `wallOutline` / `openingFrame` / `doorSwing` per wall, opening and door; the end-state picture has every wall and every opening's jambs, painted far to near; the camera fits the sheet box exactly at the start at three aspects and ends tilted over 40° and not nearer; the sources import the shared helpers and define none of their own.
- `e2e-landing.ts`, on the final tree. Pixel thresholds:
  - not blank: no colour (within 40 summed RGB) over 95% of the frame, and at least 3 colours with 0.5% each;
  - "differs": a pixel's RGB moved more than 60, summed; 50% must differ from 0% in at least 5% of pixels, and 100% in at least 15%.

  Measured:
  - 1440: dominant colour 53.6 / 57.9 / 72.7%; 50% vs 0% 32.6%, 100% vs 0% 51.1%.
  - 390: dominant colour 50.5 / 64.9 / 78.3%; 27.0% and 43.1%.
  - Hiding the DOM sheet under the canvas at 50% changed 0.0% of pixels at both widths.
  - Mid-fade: stage opacity 0.50, tour top 135 px (1440); 0.49 and 125 px (390). At the end the tour is pinned at 0 and the stage hidden.
  - Pixel ratio 1.50 on the 390 phone (device 3).
  - No renders at rest (600 ms) or after scrolling past.
  - Reduced motion: the end state differs from the sheet in 53.0% (1440) and 43.7% (390) of pixels. No WebGL: 52.9%. No canvas and no three.js or react-three-fiber fetched in either.
- **Frame times** (test-injected rAF loop during a scripted scroll through the build; headless Chromium, WebGL on SwiftShader, i.e. on the CPU):
  - 1440: median 16.7 ms, p95 33.3 ms, max 49.9 ms, none over 50 ms.
  - 390: median 16.7, p95 16.7, max 16.8 ms.
  - Reported, not asserted: they are not a phone's numbers.

**One-off failures, logged before fixing (none were flakes):**
1. e2e: the static runs' "3D chunk never fetched" check matched next/dynamic's 1.2 kB `BlueprintCanvas` loader stub, which is fetched in every mode. A dev-network comparison showed three.js and react-three-fiber arrive only in 3D mode, so the check now looks for those (test bug).
2. e2e at 390 reduced: the two steps differed in only 13.1% of pixels, against the 15% threshold. The screenshot showed a real bug: the end-state layer was transparent, so the plan showed through it. It now has an opaque ground (43.7% after). The threshold was not changed.
3. Screenshots, not a test: the headline was `text-3xl sm:text-5xl` = 54 / 96 px in this project's scale and ran over the plan, and the finished model sat under it. Now `text-2xl sm:text-4xl`, 3.6 m of paper above the plan, and the end camera aims `END_DROP` high.
4. Lint: reading `progress.current` during render (react-hooks/refs). The ref itself is passed now; new files lint clean.

**Verified (macOS, Node 24.14.0):**
- `npm test` exit 0.
- `npx tsc --noEmit` exit 0.
- Cold build exit 0 in 13 s (dev server stopped, `.next` deleted, `perl -e 'alarm 300; exec @ARGV' npm run build`; compiled in 4.9 s, every route static).
- Dev-hook grep (incl. `__background`) and CDN grep: both clean.
- Dev server restarted, then one at a time: `e2e-landing`, `e2e-feedback` and `e2e-studio` (181 s), all exit 0.

**Screenshots** (`/tmp/studio/`):
- `landing-scene-0-1440.png`: the cyanotype sheet with a 1 m grid on the dark ground. The plan (walls, gaps, four door swings, five windows) sits below the one-line headline and caption. The sheet is narrower than the screen, so dark bands show either side.
- `landing-scene-50-1440.png`: the sheet tilted, the walls about half risen. Door swings show on the floor and windows as holes. Here the model is still partly under the headline (the drop grows with the build).
- `landing-scene-100-1440.png`: the finished model from the south-south-east, every opening a hole, clear of the text. The sheet runs off the bottom-right corner.
- `landing-scene-390.png` (50%): the tilted sheet with low walls under a two-line headline; the sheet's left corner is cut off.
- `landing-scene-100-390.png`: the model spans almost the full width, with an empty band of dark ground below it.
- `landing-scene-reduced-*.png`: the flat end-state drawing (vellum and stone faces, cyanotype edges); at 390 it sits low, with empty ground under the caption.
- `landing-scene-handover-1440.png`: the mansion pinned at the top with its own headline.

**Decisions to confirm.**
- The mansion's h2 still reads "From one drawing, a whole house", so the headline appears twice: on the drawing (the page's h1) and on the photo after the hand-over. Change `landingScenes.ts` if you want the mansion to say something else.
- The caption "This is the studio's own sample plan. Scroll to raise its walls." is new copy.
- The static end state is a server-rendered axonometric SVG, not an image file, so it can never go stale against the plan.

**Not covered:** a real phone, Safari, Firefox; frame times on real hardware; Linux CI (the Node test uses only committed code and no fixtures); the Lighthouse pass (9.2).



## 40. N.1 — studio polish: a way back, first-run hint, empty states, OCR name noise (2026-10-24; not committed)

**What a visitor with an old autosave could do before.** `startPersistence` restores the autosave on every load and undo history is not saved, so the shipped sample was unreachable. The only "sample" was the import screen's "Try a sample plan", which runs `/samples/sample-plan.png` through the image import (a re-traced PNG, not `samplePlan`) and replaces the plan with no choice and no confirmation. Clearing site data was the only other way.

**Built.**
- **New plan** (Import menu, first item, `data-testid="new-plan"`): one dialog (`ProjectDialog` mode `new`) always asks, "Start from the sample plan" or "Empty plan". With unsaved changes (`isDirty()`) it says so and offers "Save first…". `projectStore.newPlan(kind)` is one `replacePlan` (one undo step, nothing marked Edited), sets the saved baseline and bumps `epoch`. The autosave sees an ordinary plan change. `src/data/emptyPlan.ts` is the empty plan.
- **First-run hint** (`StudioHints.tsx`, `hintStore.ts`, `src/lib/studioHint.ts`): shown for the untouched sample (compared by `planSignature`, so a sample that went through the autosave still counts) or an empty plan, until dismissed ("Got it", key `atrium.studioHint`, a view setting). It is an overlay at the bottom of `<main>`: click-through except its 44 px button, hidden while walking, so nothing moves when it goes.
- **Empty state** (`EmptyPlanCard`): no walls and the Select tool gives a card with "Import a floor plan" (link) and "Draw a wall" (Wall tool). The Rooms ("No closed rooms yet…") and Takeoff ("No takeoffs of your own yet…") one-liners already existed and were kept.
- **A real bug found by it:** `Scene3D.planBounds` of zero walls gave Infinity/NaN bounds and the tab froze when the 3D pane mounted on an empty plan. It now frames a 10 × 10 m patch, the same fallback the 2D plan has.
- **OCR name noise** (`cleanRoomLabels` in `nameRooms.ts`, called only from `buildFromAnalysis`, so images and scanned pages): drops labels under 55% confidence (`MIN_LABEL_CONFIDENCE`, now shared with `ocr.ts`), labels with more symbols and digits than letters, and labels of 3 letters or fewer unless a known short name (WC, Den, Bed, BR…); strips symbol-only words at either end ("| Safa" gives "Safa"). `nameRooms` itself and the PDF text path are unchanged.

**Decisions to confirm.**
- "Lal" has 3 letters, so "under 3 letters" alone would not drop it. The rule is "3 letters or fewer and not a known short name". A real 3-letter name not in `KNOWN_SHORT` is lost (the room keeps "Room N").
- The 55% rule was already applied per OCR line before `nameRooms`, so the noise labels passed it; the rule in `cleanRoomLabels` matters only for labels handed in with a lower confidence.
- "Safa / Carpet / Living Room" becomes "Safa / Carpet / Living Room": Safa and Carpet are real words, so they stay.

**Tests.** `scripts/test-name-noise.ts` (in `npm test`, failing first: the four live-site names came out as "Oo) / Primary Bedroom / Lal" and so on; it also caught my first version stripping the "/" in "Bath / Kitchen"). `scripts/test-new-plan.ts` (in `npm test`): one undo step, redo, autosave through the real `startPersistence` wiring, baseline, hint flag logic and dismissal. `scripts/e2e-newplan.ts` (not in `npm test`; dev server) at 1440 and 390. No existing assertion was changed.

**Not covered:** a real phone, Safari, Firefox; Escape back to Select from the Wall tool needs 2D canvas focus (the e2e uses the tool rail).

**One-off failures, logged before rerunning:**
1. `tsc` / `next build`: `e2e-newplan.ts` used the regex `s` flag, which this tsconfig target refuses (TS1501). Replaced with `[\s\S]`.
2. `e2e-newplan` first runs: the tab FROZE on "Empty plan" (the `Scene3D.planBounds` NaN above; fixed, the e2e now waits for the empty 3D scene to frame itself); then a test-only slip (Escape back to Select needs 2D canvas focus; the test uses the tool rail); then the Next dev badge covering a tap at 390 after a second reload (the test hides it again).
3. **(Fixed in section 41: G.1's "Walk through walls" button covered the model.)** **`e2e-import3d` FAILS at 390, and did before N.1.** The assertion is "390: a click on the model in 3D selects it" (`e2e-import3d.ts:284`; 1440 passes). It failed on four runs with N.1 on, with the two overlays removed, with `relative` also removed from `<main>`, and with every N.1 source change reverted to HEAD (the new files left unused), so N.1 did not cause it. Not diagnosed further; the uncommitted 8.1 landing files do not touch the studio, but the clean-HEAD run was not possible (a symlinked `node_modules` is refused by Turbopack in a worktree).

**Verified (macOS, Node 24.14.0):** `npm test` exit 0; `npx tsc --noEmit` exit 0; cold build (dev server stopped, `.next` deleted, `perl -e 'alarm 300; exec @ARGV' npm run build`) compiled in 5.1 s, every route static; dev-hook grep and CDN grep both clean; dev server restarted; then one at a time `e2e-newplan` exit 0 (26 s), `e2e-studio` exit 0 (159 s), `e2e-pdf-import` exit 0 (137 s), `e2e-import3d` exit 1 (see 3).

**Screenshots** (`/tmp/studio/`):
- `newplan-menu-1440.png`: the studio on the edited plan "My flat" with the Import menu open: New plan…, Floor plan image…, 3D model…, Open project…. The menu opens over the top of the right panel and hides part of its Summary.
- `hint-390.png`: the sample at 390 in 3D with the hint along the bottom of the 3D pane, three lines and a "Got it" button, above the Plan details bar. It covers a strip of ground under the model, not the model. (The first version of this shot was taken before the scene had drawn and showed an empty pane; the test now waits for the scene.)
- `empty-state-1440.png` and `-390.png`: a bare ground grid in 3D with the "This plan is empty" card in the middle (Import a floor plan filled, Draw a wall outlined); the panel says 0 walls, "No closed rooms yet…" and "No takeoffs of your own yet…". At 1440 the top bar still says "Saving…".

## 41. G.1-fix — the 390 tap on an imported model (2026-10-26; not committed)
**Symptom.** `e2e-import3d` failed at 390 (real touch) on "390: a click on the model in 3D selects it" (`e2e-import3d.ts:284`): `itemId` stayed null. 1440 passed. Section 40 item 3 showed N.1 did not cause it.

**Culprit: `4424991` (G.1, "feat(walk): add an optional walk-through-walls mode").** Found by checking out commits in a scratch clone with its own `npm ci` (no symlinked `node_modules`), with its own `next dev -p 3100` and `E2E_URL=http://localhost:3100 E2E_WIDTH=390 npx tsx scripts/e2e-import3d.ts`. Its parent `4371097` exits 0 (the whole 390 run, tools included). `4424991` fails on exactly this assertion. E.1 (`8bb5adf`) had passed in section 34, and nothing in between touches the studio.

**Cause: a test-visible product bug, not timing or a changed hit target.** G.1 added the "Walk through walls" button to WalkOverlay's top row, always shown and disabled outside walk. At 390 it sits beside Orbit | Walk at page y ≈ 100–144, x ≈ 136–285. The test lifts the cube to 3 m and taps the middle of its top face, at (172, 120). At that moment `document.elementsFromPoint` gave `button[data-testid=walk-ghost]` (disabled), then the row's `pointer-events-auto` div, then the canvas. The screenshot shows the button drawn over the cube. A disabled button swallows the tap, so it never reaches the canvas: on a phone, a model (or anything else) behind that button could not be tapped. At 1440 the 3D pane is wide and the model is not under the row.

**Fix** (`WalkOverlay.tsx`): below `sm` (640 px, the e2e's touch line) the button is `max-sm:hidden` while not walking. On a phone the disabled button did nothing and its tooltip can't show without hover. It appears the moment Walk starts, where 3D picking is off anyway. It stays in the DOM, so `e2e-walk`'s "disabled before Walk" still holds. From `sm` up nothing changed. No test was changed. CLAUDE.md's G.1 UI line says so.

**Verified (macOS, Node 24.14.0), first time, no one-off failures:** `npm test` exit 0; `npx tsc --noEmit` exit 0; cold build (dev server stopped, `.next` deleted, `perl -e 'alarm 300; exec @ARGV' npm run build`) compiled in 5.6 s, 14.7 s wall clock; dev-hook grep and CDN grep (fonts included) both clean; dev server restarted; then one at a time `e2e-import3d` exit 0 (1440 and 390, 169 s), `e2e-studio` exit 0 (182 s), `e2e-newplan` exit 0 (24 s), `e2e-walk` exit 0 (70 s; it uses this button at 390 mid-walk).

**Not covered:** a real phone. A model behind the Orbit | Walk toggle itself, or behind Exit while walking, is still covered at any width, as before G.1.

## 42. V.1 — the bird's-eye Top view and Recenter (steps 5.2 and 5.3, 2026-10-26; not committed)
**Report first: where the 3D controls sat, and what they covered (before any change).** Measured with `document.elementsFromPoint` over every wall's centre line (every 0.1 m at five heights, 2,770 points) and a 6 px grid over the convex hull of the plan's projected box, on the sample in the opening view (the coverage script is now part of `scripts/e2e-views.ts`):
- 1440 × 900, orbit: Orbit | Walk at x 91–206, y 67–111; the disabled "Walk through walls" at 215–367; footprint y 171–814. Walking: Exit 215–266, the toggle 272–424, the hint line at y 120. **0 of 2,770 wall points and 0 of 9,707 footprint points covered.**
- 390 × 844, orbit: Orbit 11–70, Walk 70–126 at y 111–155 (the ghost toggle hidden since G.1-fix); the first-run hint at y 642–716; footprint y 278–523. **0 of 2,770 and 0 of 1,452 covered.** Walking: Exit 135–186, the toggle 192–344 (y 111), the hint line at y 164, the joystick 16–112 × 612–708.
- So in the opening view nothing covered the plan. The tight spot was the 390 top row. e2e-import3d's lifted cube (3 m up at plan (2, 2)) projects to (172, 120), right of the toggle and inside the area the G.1 button used to cover.

**Done.** CLAUDE.md "Bird's-eye view and Recenter (step V.1)" has the rules.
- New: `src/lib/view/camera.ts` (`planBounds`, moved from Scene3D; `homeView`; `topView` with the control-strip inset), `src/components/three/ViewCamera.tsx` (replaces Scene3D's FitCamera: the opening fit, refit on resize, the GSAP glides, R), `scripts/test-views.ts` (in `npm test`) and `scripts/e2e-views.ts`.
- Changed:
  - `viewStore.ts`: `top`, `request`, `walkHome`, `setTop`, `recenter`, `chooseOrbit`, `RECENTER_KEY`. `mode` is still orbit | walk, so no existing assertion moved.
  - `WalkControls.tsx`: Recenter while walking means back to the start pose.
  - `WalkOverlay.tsx`: Orbit | Top | Walk, Recenter top-right, the column 4.5rem short of the right edge.
  - `Scene3D.tsx`: FitCamera out, ViewCamera in; the aria-label mentions R.
  - `math.ts`: `fitDistance` factored out of frameBox, with an optional vertical padding.
  - Comment-only: PlanCanvas, ImportedItems, e2e-helpers.
  - `package.json`: the new test.

**Failing first.** `test-views.ts` was written before `src/lib/view/camera.ts` existed and stopped at "Cannot find module '../src/lib/view/camera'". It checks the home view against a copy of the old FitCamera formula (to 1e-9 m) and frameBox against a copy of its old loop.

**What the runs found (each fixed in the product, none a flake):**
1. In development of `e2e-views` (before the final tree), Top at 1440 put the north wall under the toolbar row: 5 to 16 wall points under each of Orbit, Top, Walk and Walk through walls. The 1040 × 844 pane has nearly the plan's own 10:8 shape, so at 10 % padding the plan reached 38 px from the top. **Fix:** `topView`'s inset keeps the 60 px control strip clear at the top and bottom, with 10 % padding of what is left. After: 0 covered (1440: hull y 149–807; 390: y 270–554).
2. In development, Move "did not find the corner E in Top". From above, only the top end of a corner's vertical line shows (the rest is inside the walls), and the test aimed at its middle. That is the existing, correct rule. The test now aims at the top end, and the attempted special case in PushPullTool was reverted, so PushPullTool is unchanged.
3. In development at 390, Push/Pull on w-BC's top in Top changed nothing. The finger's 44 px reach picked the front door's jamb edge 0.5 m away (the 4.7b order). The test now uses w-AB, which has no openings.
4. **Logged before rerunning: `e2e-import3d` failed at 390 on its first run on the then-final tree,** at "390: selected again with a click" (`e2e-import3d.ts:319`, itemId null). A diagnostic copy showed that, after the Push/Pull drag's small orbit, the tap landed at (155.5, 132.2) on the camera group's own box: Walk then ended at x 154, where before V.1 the group ended near 129. Reproduced twice, so a product regression from adding Top, not a flake. **Fix:** below `sm` the three camera buttons stack in a column at the left edge (x 8–62, y 108–246), so the top band to their right is free again. `e2e-views` now hit-tests that whole band (x 130 to Recenter, every 4 px, all canvas). The rerun of `e2e-import3d` passed, both sizes.

**Changed assertions:** none existing. New tests only.

**Tests.**
- `scripts/test-views.ts` (in `npm test`):
  - home and top for the sample, a 40 × 2 m plan, plan-chatgpt-flat.pdf's plan (read in Node) and an empty plan, at 1440 × 900, 390 × 844 and the panes' 1040 × 844 and 390 × 624: every number finite, every corner in front of the camera and inside the padded frame, the limiting corner at exactly 1/1.1;
  - home equals the old FitCamera pose;
  - top within 0.01° of straight down, above the tallest wall, north up, and with the inset no corner in the 60 px strip; NaN, negative and oversized insets clamped;
  - frameBox's results unchanged;
  - the store: no plan, history, payload or selection change, and Top kept through a walk;
  - R is no tool, walking, ghost or typed-value key.
- `scripts/e2e-views.ts` (not in `npm test`; dev server), 1440 with mouse and keyboard, 390 with real CDP touch:
  - coverage in home and Top (0 covered at both sizes);
  - 44 px targets, Tab order Orbit → Top → Walk → Recenter, no overlaps (walking at 390 too: group, Exit, Walk through walls, Recenter, hint line, joystick);
  - the opening camera is the home view (1e-6 m);
  - Top (Enter at 1440, tap at 390) glides and lands within 1 mm: measured 0.0000 mm;
  - in Top: Select by a wall's top, Push/Pull a wall top (one undo step), Move the corner E (one undo step), with Top still on;
  - an upward orbit drag leaves Top;
  - Recenter by button and by R after an orbit drag: 0.0000 mm, still there 10 frames later;
  - Orbit from Top goes back;
  - walking from Top, Recenter returns to the start pose (1e-9) and Exit or Escape restores the Top camera within 0.000000 mm with Top pressed again; Orbit while walking restores it as exactly;
  - under reduced motion Recenter lands at once;
  - the empty plan: home, Top, Recenter, back;
  - the lifted cube at (172, 120) at 390 is tapped and selected (at 1440 clicked).

**Screenshots** (`/tmp/studio/`):
- `views-top-1440.png`: the sample from straight above, filling the pane below the toolbar row. Every wall top is a pale band, the floors show (oak in both bedrooms, stone in the living room and bathroom), and the four door leaves and five window frames read as dark shapes. Perspective from 15 m up shows a little of the walls' inner faces towards the edges. Top is pressed, with the gilt focus ring from the keyboard; Recenter (a crosshair) is at the top right. Nothing of the plan is under a control.
- `views-recenter-390.png`: the phone after Recenter. The three-quarter view of the house sits in the middle with empty ground above and below; Orbit (pressed), Top and Walk are stacked at the top left, and Recenter is alone at the top right.
- `views-walk-390.png`: walking at 390, inside the living room facing a door. The stacked group (Walk pressed) has Exit and Walk through walls beside it in the top row, the touch hint below the group, Recenter top right and the joystick bottom left. Nothing overlaps.

**Verified (macOS, Node 24.14.0), on the final tree:**
- `npm test` exit 0; `npx tsc --noEmit` exit 0; eslint clean on every changed file.
- Cold build: dev server stopped, `.next` deleted, `perl -e 'alarm 300; exec @ARGV' npm run build`; exit 0, compiled in 5.0 s, 14 s wall clock.
- Dev-hook grep (incl. `__background`) and CDN grep (fonts included): both clean. `/studio` first load 569 kB gzip (D.1 recorded 565); GSAP was already in every page through the root layout.
- Dev server restarted from a fresh `.next`, then one at a time: `e2e-views` exit 0 (45 s), `e2e-walk` exit 0 (59 s), `e2e-newplan` exit 0 (22 s), `e2e-studio` exit 0 (168 s), `e2e-import3d` exit 0 (154 s).
- The verification build ran after the e2e runs, so the dev server was restarted again afterwards.

**Decisions to confirm.**
- Top is always north-up, like the 2D plan, rather than keeping the current azimuth.
- Orbit from Top glides back to the camera from before Top (the home view if there is none), instead of staying top-down.
- Top is kept through a walk, so Exit returns to Top; the Orbit button while walking returns to Orbit with the same exact camera.
- Recenter in a walk is instant (a glide would pass through walls).
- Recenter is an icon-only button (crosshair, its name for screen readers, a tooltip), so it fits the corner at every width.
- At 390 the camera buttons are a column, not a row.
- Recenter frames the walls only, not imported models.

**Not covered:**
- A real phone, Safari, Firefox; Linux CI not run here (the new Node test uses committed fixtures only).
- The home view keeps no strip clear, since it is the opening pose. A plan that fills the pane's height when tilted could reach the top row, as before V.1.
- In Top, a corner near the middle of the view is hard to pick with Move: its line is a pixel or two long on screen and only its top tenth or so counts as visible.
- The walk hint line does not mention R (the button's tooltip and `aria-keyshortcuts` do).


## 43. L.2 — landing polish: no cropping, one headline, a preloader, photos on demand, a crossfade tour (step 8.4, 2026-10-26; not committed)
**Report first (before any change).** Production build (`next build`, `next start`), Playwright Chromium on SwiftShader, this Mac under load, so these are headless numbers, not a phone's. `scripts/landing-report.ts` (new):
- First-load JS: `/` 11 chunks, 609 kB raw / **194 kB gzip**.
- Photographs: 2560×1440 JPEGs of 1010, 1180, 893, 789 and 719 kB on the wire. **All five loaded before the first scroll, at both 1440 and 390: 4590 kB.** Native `loading="lazy"` did not help: the tour sits exactly one screen below the fold, inside the lazy-load distance.
- LCP (the h1, which is also FCP) at 1440 / 390, after a warm-up page: 472–548 ms / 80–188 ms (four runs); CLS 0. (A first, unwarmed run said 912 / 188 ms: it included the browser's own start-up.)
- Tour frame times through the whole pinned tour at 390 (touch) / 1440: 716 frames, median 16.7, p95 33.3, max 33.4, 0 over 50 ms / 509 frames, p95 50.1, max 116.6, 26 over 50 ms.

**Cropping (the cause).** `cameraAt` fitted only the model's bounding sphere at the end and interpolated in between, so the sheet (larger than the model, and rotated) ran off the screen; at the start the sheet touched the screen's edges exactly. Failing first: the new pixel test on the 8.1 page failed at 0% (37% of the outer ring was not ground at 1440), and `test-landing-scene.ts` failed on the missing `SHEET_FIT`. Now every frame is fitted: sheet corners and model box inside the view, sheet at 96%, model below the measured headline band from 25% of the build (CLAUDE.md "Landing polish").

**Done.** New: `scripts/landing-report.ts`. Changed: `src/lib/landing/{blueprint,blueprintMeshes,timeline}.ts`, `src/components/landing/{BlueprintScene,BlueprintCanvas,BlueprintDrawings,LandingTour}.tsx`, `src/data/landingScenes.ts` (the mansion's heading and caption), `src/app/globals.css` (the preloader), `scripts/{test-landing-scene,e2e-landing}.ts`, CLAUDE.md. No studio code, reading rule or other test changed.

**Changed assertions (each listed):**
1. `test-landing-scene.ts`: "the sheet fits the first frame exactly" (fit = 1 within 1e-9) is now "fits at `SHEET_FIT` (0.96) within 1e-4" (the first frame is a hair off vertical), and the aspect list gained 1280×720. Everything else in it is unchanged; the new block (41 values of b at three viewports) is added.
2. `e2e-landing.ts`: `headlineInFirstScreen` also asserts one h1 and the sentence once in the page's text; `runStatic` waits for the preloader to go before its first screenshot and asserts the outer ring is ground on both steps; `scrollTo` has an optional `maxStep` (defaults as before); `main()` can run one part (`E2E_ONLY`); the suite timeout went from 600 s to 1500 s. No threshold changed.

**After (production build, same method):**
- First-load JS: **195 kB gzip** (612 kB raw, +1 kB). JS on the wire before first scroll: 443 kB (was 442).
- Photos before first scroll: **1, 1010 kB** at both sizes (was 5, 4590 kB). With real scrolls: the lobby once the tour is near, the living room only once the scroll reaches the lobby, all five by the end of the tour.
- LCP = FCP (the h1) at 1440 / 390: 472–576 ms / 64–120 ms (five runs): the same as before. CLS 0.0000.
- Preloader (dev server, e2e): gone at 1144 ms with the canvas ready at 862 ms (1440), 1128 / 875 ms (390); no layout shift, the page height the same before and after.
- Tour frame times at 390: median 16.7, p95 16.7–16.8, max 33–67, 0 or 1 frame over 50 ms (six runs; e2e run: 2 over 50 ms, max 83). At 1440 the code path is unchanged and the numbers moved with the machine's load (15 to 68 frames over 50 ms in different runs), so no claim either way.
- Caption contrast against the picture: 7.7:1 (1440), 6.8:1 (390).

**What the runs found (each fixed; none a flake unless said):**
1. The new fit test on the 8.1 page failed first, as intended (above).
2. First fit run on the new code: a black frame round the 3D sheet at 0% and 100%. The page's SVG had gained a CSS `scale(0.96)`, and the canvas serialised the SVG with it into the texture, which then had transparent edges. Fixed, and a near-black-pixel assertion added.
3. The new CSS scale delayed first paint by about 130 ms at 1440 (bisected by building variants), and the preloader's compositor animations by about 170 ms more. Now the SVG's `viewBox` does the 0.96 and the preloader animates `width` and `visibility` only; FCP is back to the old numbers.
4. Tour at 390 with a plain crossfade had 5 to 11 frames over 50 ms (the old arch tour had 0): fades without `will-change: opacity` repainted a full-screen photo per frame. Added `will-change: opacity` to the layers under 640 px: 0 or 1.
5. The photo test saw the living room requested 60 px before the tour's pin: the test helper's wheel was counted twice by a moving scroll and overshot. Scrolls in that test are now in steps of 200 px, with checkpoints 400 px clear of a boundary. (Test bug.)
6. The blocked-chunk test blocked nothing on a production build (hashed chunk names). It now judges a script by whether it holds `WebGLRenderer`.
7. On a production server `e2e-landing`'s "three.js was fetched" check fails by design (it matches readable chunk names; the suite is dev-only, as CLAUDE.md says); I used production only for the parts that read no chunk name.
8. First full dev run: `1440 nowebgl: the sheet is not blank`. The no-WebGL context is not reduced motion, so the preloader was still fading when the screenshot was taken. The static runs now wait for it to go. (Test bug.)
9. A first `landing-report` run with the 1440 browser cold and a loaded machine made it look as if LCP had risen by 300 ms; the report now warms the browser first and I compared old and new builds back to back, three to four runs each.

**Verified (macOS, Node 24.14.0), on the final tree:**
- `npm test` exit 0; `npx tsc --noEmit` exit 0; eslint clean on the landing files.
- Cold build: dev server stopped, `.next` deleted, `perl -e 'alarm 300; exec @ARGV' npm run build`, exit 0 in 16 s (compiled in 5.2 s).
- Dev-hook grep (incl. `__background`) and CDN grep: both clean.
- Dev server started from a fresh `.next`, then one at a time: `e2e-landing` exit 0 (after the fix in 8; its first run failed), `e2e-feedback` exit 0, `e2e-studio` exit 0.

**Screenshots** (`/tmp/studio/`):
- `landing-final-0-1440.png`: the blueprint sheet as a cyanotype rectangle with a band of dark ground on each side and a few pixels above and below; the headline sits over its top margin and straddles the paper's left and right edges (legible on both).
- `landing-final-100-1440.png`: the finished model from the south-south-east, all four corners of the sheet visible, a band of ground round it, the headline clear above the model.
- `landing-final-0-390.png`: the sheet fills the width with a few pixels of ground each side, the headline above; the lower third of the screen is empty ground (the sheet's shape is nearly square).
- `landing-final-100-390.png`: the whole model and sheet in view, about three quarters of the screen's width, with a gap under the headline and about a quarter of the screen empty below it. This is the cost of keeping the whole sheet in view on a narrow screen.
- `landing-final-tour-390.png`: the mansion at the tour's start: "Every wall starts as a line on a plan" on three lines over the villa's door, the caption, Step inside, and the "Illustrative photographs" note below it, nothing overlapping.
- Also `landing-final-{0,100}-1280.png` and `landing-final-tour-1440.png`.

**Decisions to confirm.**
- "The first scene" for the preloader is the blueprint hero (its 3D canvas), not the mansion photo, which is below it; the mansion's photo is still eager and high priority as asked, though it is not on screen until the hand-over.
- The mansion's heading is three lines at 390 and covers the villa's door; a shorter line would cover less.
- At 390 the model ends smaller than in 8.1 because the whole sheet must fit.
- The photos themselves were not re-encoded ("visual result identical").

**Not covered:** a real phone, Safari, Firefox; Linux CI (the Node test uses only committed code); Lighthouse (9.2).


## 44. X.2 — exports: area schedule, takeoff report PDF, GLB and OBJ (roadmap 7.1, 7.3, 7.2; 2026-10-26; not committed)

**Library choice.** `pdfjs-dist` reads; for writing, pdf-lib 1.17.1 (MIT, read from its package.json) was already installed as a devDependency (it makes every PDF fixture). It moved to `dependencies`; no new package. About 206 kB gzip as one minified bundle, 174 kB gzip as the on-demand chunk Turbopack makes. jsPDF 4.2.1 (MIT, measured with `npm pack`) is about 110 kB gzip but would be a new package bringing fflate, fast-png and @babel/runtime, plus optional html2canvas, dompurify and canvg. pdf-lib won on: nothing new to install; the path from pdf-lib output to pdf.js text extraction in Node is already proven by the fixtures; and `drawSvgPath` takes y-down paths, as the plan is. The report uses the PDF standard fonts Helvetica and Helvetica-Bold, which are built into every reader, so nothing is embedded or fetched.

**What was built** (details in CLAUDE.md "Exports"):
- `src/lib/export/schedule.ts`: the rooms come from `deriveRooms`, the same source as the Summary and the room list. Openings are grouped by kind and size. Totals are summed from exact values. The CSV has two sections.
- `src/lib/export/report.ts`: an A4 landscape report, built with pdf-lib.
- `src/lib/export/model3d.ts`: GLB and OBJ through three's exporters.
- `src/components/studio/ExportDialog.tsx`: one dialog for the report, GLB and OBJ, plus the schedule's CSV download.
- `src/components/studio/SchedulePanel.tsx`: a collapsible section in the right panel.
- The Export menu holds exactly: Save project…, Area schedule (CSV), Report (PDF)…, 3D model (GLB)…, 3D model (OBJ)….

**Changed assertion (one).** `scripts/e2e-studio.ts`, the Export menu's item list: it was `["Save project…"]` and is now the five items above. Nothing else existing was changed.

**Failing first.** `scripts/test-exports.ts` was written before the modules. Its first run failed with `Cannot find module '../src/lib/export/schedule'`, which covers the schedule-equals-summary and GLB round-trip checks. Once the schedule existed, the GLB check failed twice before passing:
1. GLTFLoader strips ":" and "." from node names when it loads a file. The test now reads the names from the GLB's JSON chunk.
2. The floor triangles' area was 5.9e-6 m² off the Summary's 74.695 m². glTF positions are float32, about 7 significant digits, so a 1e-6 m² bound on the triangles cannot hold. The exact net areas now travel as extras and are checked to 1e-6 m²; the triangles are checked to 1e-6 relative.

**Logged one-off failure.** The first run of `e2e-export` timed out waiting for the CSV download at 1440. This was a test bug, not a flake: the suite pressed the menu item before it began listening for the download, so the download fired first and was missed. The suite now listens first, and it passed on every run after.

**Fixed after a screenshot.** The Schedule panel's openings table was wider than the 320 px panel at 1440, so its Count column was cut. The length unit now appears once, in the table's caption, and the cells show bare numbers.

**Bundle** (`scripts/bundle-report.ts`; the baseline was built from this tree with the three wiring files stashed):
- `/studio`: 1926 kB raw, 569 kB gzip before; 1935 kB raw, 571 kB gzip after. That is +9 kB raw, about +2 kB gzip, for the schedule panel, the dialog shell and the schedule maths.
- pdf-lib: an on-demand chunk of 421 kB raw, 174 kB gzip.
- GLTFExporter and OBJExporter: an on-demand chunk of 40 kB raw, 11.5 kB gzip.
- `/` 195 kB, `/limits` 187 kB, `/studio/import` 386 kB gzip: unchanged.

**Verified (macOS, Node 24.14.0), on the final tree:**
- `npm test` exit 0, with `test-exports` in it.
- `npx tsc --noEmit` exit 0.
- Cold build: dev server stopped, `.next` deleted, `perl -e 'alarm 300; exec @ARGV' npm run build`, exit 0 (compiled in 4.8 s).
- Dev-hook grep (including `__background`) and CDN grep: both clean.
- Dev server restarted, then one at a time: `e2e-export` (exit 0 after the test fix), `e2e-studio`, `e2e-takeoff` and `e2e-project-file`, each exit 0. These four ran before the last Schedule panel edit, and `e2e-export` was run again after it (exit 0). The cold build above is from after it.

**Screenshots** (`/tmp/studio/`):
- `export-menu-1440.png`: the Export menu open under its button with the five items, the 3D sample behind it, and the panel showing Takeoffs (2) in mm.
- `export-schedule-1440.png`: the right panel scrolled to Schedule.
  - Rooms: Bedroom 1 14.8 m² / 15400 mm, Living room 36.9 / 27300, Bathroom 8.1 / 11400, Bedroom 2 14.8 / 15400, Total 74.7 m² / 69500 mm.
  - "Openings, sizes in mm": three door rows (900, 800, 1000 × 2100) and two window rows (1200 and 600 × 1200 on a 900 sill), "Total: 4 doors, 5 windows" with 9.
  - The note and Download CSV below. Everything fits.
- `export-menu-390.png`: the same five items in a popover under the icon row, nothing clipped.
- `export-schedule-390.png`: the Plan details sheet open on the Schedule; both tables fit the 390 width.
- `export-dialog-390.png` and `-1440`: the Report dialog with what the file holds and the units (mm, m²), Cancel and Download, inside the viewport.
- A Node render of the sample report: page 1 has the title block, "Verdict: Good" with its two reasons, the scale source, the counts, and the plan drawing (walls black, door swings, window lines, room names and areas). Page 2 has the schedules and the takeoff table with Measured 3000 mm, Reference 3050 mm, Difference -50 mm, Flagged and Override 3100 mm side by side.

**Not covered:**
- a real phone, Safari, Firefox; Linux CI (the Node test reads only committed files and generates nothing time-dependent);
- opening the GLB or OBJ in Blender, SketchUp or another viewer: only three's own loader and a line count were used;
- printing the PDF on paper;
- the report's verdict judges the plan alone, because the import's coverage is not in the plan.
