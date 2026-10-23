# Architecture

Atrium is one Next.js app with no server code. Everything below runs in the browser. For the detail behind any line, see `CLAUDE.md` (rules per feature) and `docs/HANDOFF.md` (history).

## Data flow

```
 file (PDF, image, 3D model, .atrium.json)
   |
   v
 Web Workers
   analyse.worker     image  -> blueprint detection + OCR (tesseract.js)
   pdf.worker         PDF    -> lines, text, dimension matches, vector walls (pdf.js)
   review.worker      PDF    -> merge with tracing, verdict, model-vs-printed rows
   background.worker  PDF    -> draws the drawing under the 2D plan; builds the snap index
   |
   v
 Reading (review screen: scale, dimension tables, verdict, warnings)
   |  "Build model"
   v
 Plan  <-- planStore (Immer patches, undo/redo) <-- all edits: 2D, 3D, panels, Open project
   |
   +--> 2D plan (SVG)        src/components/plan2d
   +--> 3D scene (R3F)       src/components/three
   +--> rooms, areas         derived from walls on every wall edit
   +--> takeoffs             annotations stored in the Plan
   +--> walk collision       src/lib/walk, rebuilt from the live Plan
   +--> autosave / project   Plan only, never view settings
```

Imported 3D models and the drawing under the plan keep their bytes in IndexedDB; the Plan holds only a descriptor.

## Main modules

| Folder | What it holds |
|---|---|
| `src/types` | `Plan` and its parts (`plan.ts`), blueprint types, PDF types |
| `src/store` | Zustand stores. `planStore` is the Plan and its history; the rest (selection, tool, view, units, labels, takeoff, calibrate, import, project) are view or tool state and are never undoable |
| `src/lib/plan` | Pure plan rules: edits and snapping, validation, rooms, geometry, mesh builders, Push/Pull, calibration |
| `src/lib/plan2d` | 2D drawing maths: openings, measure, label building and layout |
| `src/lib/blueprint` | Image pipeline (imported from Atrium v1): vectorize, deskew, wall mask, scale, openings, OCR, `toPlan` |
| `src/lib/pdf` | PDF reader: extraction, walls, openings, scale, dimensions, merge with the tracing (`snap.ts`), verdict, review, overlay, snap index |
| `src/lib/walk` | Walkthrough collision and movement, pure |
| `src/lib/takeoff` | Takeoff geometry and table rows |
| `src/lib/units` | Length and area formatting and typed-length parsing |
| `src/lib/import` | 3D model loading, asset store (IndexedDB), part transforms |
| `src/lib/handles3d` | Pointer-to-3D maths and picking for the 3D tools |
| `src/lib/background`, `src/lib/persist`, `src/lib/feedback` | Drawing mapping and storage; autosave and project files; the "Report a problem" text |
| `src/workers` | The four workers above |
| `src/components` | `studio` (panels, top bar), `plan2d`, `three`, `landing`, `motion`, `feedback` |
| `src/app` | Routes: `/` landing, `/studio`, `/studio/import`, `/limits`, error and not-found screens |
| `scripts` | `test-*.ts` (run by `npm test`), `e2e-*.ts` (local browser suites), fixture makers and report tools |
| `tests/fixtures` | Images, synthetic PDFs, their truth files, the reading snapshot and baseline |

## Rules that keep it consistent

- **`Plan` is the source of truth.** The 3D scene, the 2D plan, room areas, takeoffs, collision and every export are derived views. Nothing is baked into geometry that can't be regenerated from it.
- **Metres internally.** Lengths are metres and areas m² everywhere in the Plan and in pure code. Pixels and PDF points are converted at the edge of the reader.
- **Units are display-only.** The one units setting (mm, m, ft-in; m², mm², sq ft) is a view setting stored in the browser, never in the Plan. Components format through `useUnitFormat` or `formatLength` and `formatArea`; a guard test fails on hard-coded unit text.
- **Round once, at display.** Rows are rounded on their own; totals are summed from unrounded values. A typed value is kept to 0.1 mm, and a field left untouched never changes the stored value.
- **One edit funnel.** Every plan change goes through `planStore`'s `edit()` (Immer patches); a drag or a Push/Pull is one transaction and so one undo step.
- **View state is never undoable or autosaved.** Selection, tools, camera mode, units, labels and drawing opacity live outside the Plan.
- **Nothing heavy on the page's thread, nothing third-party over the network.** Image analysis, PDF reading and the PDF review run in workers; fonts, OCR and pdf.js assets are served from the app's own origin.

## Known weak spots

- **Reader coverage.** No wide range of real CAD files has been read; the rules are proven on synthetic fixtures and a few generated or real plans. Diagonal and curved walls are not read, and neither are bi-fold, pocket, revolving or arched doors.
- **Heights are defaults.** A plan has none, so every wall, door and window gets a default until edited.
- **Lint is non-blocking in CI.** It reports 25 known errors, 19 in vendored `public/tesseract/*.js` and 6 `react-hooks` errors in `PlanViewer`, `PlanModel`, `ItemPanel` and `ImportedItems` (HANDOFF section 33).
- **Browser e2e suites are not in CI.** They need a dev server and Chromium, and their recorded numbers come from macOS Chromium.
- **Untested environments.** Real phones, Safari and Firefox, and the deployed site's cache headers have not been checked (HANDOFF sections 17, 33 and 35).
- **Autosave.** It is browser storage, last write wins across tabs, and there is no reset-to-sample item in the menus.
- **Walkthrough.** One floor, no stairs, doors do not open, windows are solid at every height, and furniture and imported models are not collision.
- **Fonts.** Only the Latin subsets are included; other characters in a room name fall back to a system font.
- **Landing page.** It has no error boundary of its own and there is no `global-error` page.
- **Platform differences in tracing.** The picture-trace layer varies a little between rasterisers (macOS, Linux, Chromium), so one snapshot comparison is looser for traced items (HANDOFF section 33).
