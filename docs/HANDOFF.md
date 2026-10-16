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
    - `pdfjs-dist` 6.4.299 (Apache-2.0). Dev only: `pdf-lib` 1.17.1 (MIT); `@napi-rs/canvas` comes in as pdf.js's optional dependency and is used only by the Node scripts.
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
- **Run before committing** (since 4.7c): `npm test`, `npx tsc --noEmit`, `perl -e 'alarm 300; exec @ARGV' npm run build` (this Mac has neither `timeout` nor `gtimeout`; since M.1d: a build that takes over five minutes means an import cycle or a hang, not a slow machine — a clean build is about 2 s. `npm test`'s `test-import-cycles.ts` catches the usual cause first), `grep -rlE "__studio3d|__pushPullDebug|__importDebug|__importPdf|__plan2d|__takeoffStore|__scene3d|__walkDebug|__background" .next/static || echo clean` and `grep -rlE "cdn\.jsdelivr|unpkg\.com|cdnjs" .next/static || echo clean` (both must print `clean`, run after the build), and with `npm run dev` on port 3000 from THIS checkout (`lsof -i :3000`, then the process's working directory): `npx tsx scripts/e2e-studio.ts`, `npx tsx scripts/e2e-walk.ts`, (since I.1a) `npx tsx scripts/e2e-import3d.ts` and (since M.1a) `npx tsx scripts/e2e-pdf-import.ts` (since M.2a) `npx tsx scripts/e2e-takeoff.ts`, (since U.1) `npx tsx scripts/e2e-units.ts` and (since M.2b) `npx tsx scripts/e2e-calibrate.ts`, (since O.1) `npx tsx scripts/e2e-offline-ocr.ts` (since M.2c) `npx tsx scripts/e2e-background.ts`, (since L.1) `npx tsx scripts/e2e-labels.ts` and (since P.1) `npx tsx scripts/e2e-snap.ts`, all exit 0. Before a sweep, check nothing else is driving port 3000 (`pgrep -fl "flake-hunt|scripts/e2e-"`): in M.2c a `flake-hunt` run started during F.1 was still running and sharing the server (section 23). `npm run build` needs a working `.next`: if it stalls with no output, see the flake-hunt item. Do not edit source files while an e2e runs: the dev server hot-reloads mid-test.
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
- Room list rounds each area to one decimal, so the rows can add to 0.1 less than the total. Fix with the schedules in 7.1.
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

- `buildPdfPlan` still runs on the import page's main thread (the review and Build model). This fix removes the one runaway found there, but another would still freeze or kill the tab; the watchdog covers workers only.
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
