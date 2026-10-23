# Atrium v2

[![CI](https://github.com/RachitMittal-20/Atrium-v2/actions/workflows/ci.yml/badge.svg)](https://github.com/RachitMittal-20/Atrium-v2/actions/workflows/ci.yml)

**Live demo:** https://atrium-v2-ashen.vercel.app/

Demo video: coming soon

Atrium turns a floor plan, a vector PDF or an image, into an editable 3D model in the browser; your files never leave it.

## What it does

- **Import a PDF or an image.** From a vector PDF the walls come from the drawing's own lines and the scale from its printed dimensions. From an image the walls are traced and the scale comes from a printed scale or room-size labels (read by OCR in the browser). If no scale can be worked out, you type the length of one wall.
- **Dimension check.** The review lists each printed dimension it could match, what the model measures at the scale in use, and whether they agree. You can override a flagged row with a typed value.
- **Plan verdict.** Before you build, the review judges the plan it would make as Good, Check or Not usable, with the reasons.
- **Edit in 2D and 3D.** Draw walls, place doors and windows, drag walls and wall ends, type exact lengths, undo and redo. In 3D, Push/Pull changes wall height, thickness and door and window faces, and Move slides openings and drags corners.
- **Quantity takeoffs.** Measure lengths and areas on the plan (with cutouts), in mm, m or ft-in, with a CSV download. Takeoff points can snap to the original PDF drawing, and "Set scale" recalibrates the plan.
- **Walkthrough.** Walk through the model with keyboard or touch, stopped by walls. An optional "Walk through walls" mode turns that off.
- **Import 3D models.** GLB, glTF, OBJ, FBX, DAE, STL, 3DS or a .zip of them; move, rotate and scale them, and hide, delete or move their parts. The model files stay in your browser's storage.
- **Save project and Open project.** One `.atrium.json` file holds the plan, takeoffs and, optionally, imported models and the drawing under the plan.

## Honest limits

The full text is in [`src/app/limits/page.tsx`](src/app/limits/page.tsx), shown at `/limits` in the app.

- The reader has been tested on synthetic drawings and a few real plans, not on a wide range of real CAD files. Expect surprises.
- Diagonal and curved walls are mostly missed or only roughly traced, and openings in them are not read.
- Scans and photos with no dimensions have no scale unless you type one wall's length.
- Sliding, bi-fold, pocket, revolving and arched doors, and double doors drawn in thin lines, can be missed or read as something else.
- Furniture, stairs and hatching drawn as lines can be mistaken for walls. The review lists what it left out, but it can be wrong.
- Heights are defaults: walls 2.7 m, doors 2.1 m, windows 1.2 m on a 0.9 m sill, until you change them.
- One floor at a time.
- There is no furniture or finishes catalog. You can import your own 3D models; the walkthrough passes through them.
- Not tested on a real phone, Safari or Firefox.

## What is interesting technically

- **One `Plan` is the source of truth.** Walls, openings, rooms, items and options live in a single object. The 2D plan, the 3D scene, room areas, takeoffs and project files are derived from it; nothing is baked into a mesh that can't be regenerated.
- **Patch-based undo.** Every edit goes through one Immer funnel in [`planStore.ts`](src/store/planStore.ts), and history stores patches rather than whole plans. A drag re-applies the whole drag after a rollback on every pointer move, so it is one undo step.
- **A PDF reader built on general drawing conventions.** Walls are found by pairing parallel face lines, filled rectangles or single thick strokes; scale comes from dimension text matched to the line it measures; swing arcs give door sides and hinges. Each rule is written for a drawing convention and proven on its own synthetic fixture, not tuned to one file.
- **Workers with a watchdog.** Image analysis, PDF reading, the PDF review and background rendering run in Web Workers. A worker that goes silent is stopped and the page shows a plain message while the tab stays responsive.
- **Tests that are written to fail first.** New rules start with a fixture that reproduces the failure. Guard tests check for hard-coded unit text, import cycles and third-party URLs. CI also greps the production bundle for dev-only hooks and CDN addresses.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the data flow and the module map.

## Run it locally

You need the Node version in [`.nvmrc`](.nvmrc) (24.14.0).

```bash
npm ci
npm run dev    # http://localhost:3000
npm test
```

## Tests

- **CI** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on every push and pull request on Ubuntu: `npm ci`, `npm test`, `npx tsc --noEmit`, `npm run lint` (non-blocking: it reports known errors), `npm run build`, then a grep of the production bundle for dev-only hooks and one for CDN URLs. Either grep finding something fails the job.
- **`npm test`** is a chain of `tsx` scripts in `scripts/test-*.ts` (pure logic, the PDF reader on fixtures, stores, project files, guards).
- **Browser suites run locally only.** The `scripts/e2e-*.ts` suites need `npm run dev` and Playwright's Chromium. They are not in CI because their numbers were recorded from Chromium on macOS and they have not been shown reliable on a clean runner. `scripts/flake-hunt.ts` repeats them to look for flakes.
- The dev-only hooks the e2e suites read exist only in development, so they cannot run against `npm run start`.

## Tech stack

Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind 4, React Three Fiber and drei on three.js, GSAP with ScrollTrigger and Lenis (landing page), Zustand with Immer, pdf.js (`pdfjs-dist`), tesseract.js. One Next.js app, no server code, deployed on Vercel's free tier.

## Credits

Every direct dependency, its version and its licence are listed in [`THIRD_PARTY.md`](THIRD_PARTY.md).

- **Fonts:** Marcellus and Figtree (Google Fonts), self-hosted in `src/app/fonts/`.
- **tesseract.js** 5.1.1 and tesseract.js-core, with the English `best_int` language data, served from `public/tesseract/`. Licences are listed in [`public/tesseract/LICENSES.md`](public/tesseract/LICENSES.md).
- **pdf.js**, whose image-decoder WebAssembly is served from `public/pdfjs/wasm/` with its licences beside it.
- **three.js** with react-three-fiber and drei.
- Blueprint detection and the smooth-scroll provider come from [Atrium v1](https://github.com/RachitMittal-20/Atrium).
- **Landing page photographs:** AI-generated images, illustrative, not Atrium output.
