# Atrium v2

Turn a floor-plan image into an editable 3D model you can walk through, furnish and export.

## Run locally

```bash
npm install
npm run dev   # http://localhost:3000
```

Deploys to Vercel's free tier as a single Next.js app — no separate backend (OCR runs in the browser with tesseract.js).

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Scaffold, v1 module import, design tokens, landing photo tour | Done |
| 2 | Editable `Plan` data model (walls, openings, rooms, items), undo/redo | Next |
| 3 | Blueprint → Plan pipeline with a review screen | |
| 4 | 2D + 3D editor | |
| 5 | Orbit, walkthrough, bird's-eye, panorama, recenter | |
| 6 | Furniture and finishes catalog | |
| 7 | Schedules and exports (GLB, OBJ, PDF, DXF, CSV) | |
| 8 | Landing: blueprint table and construction 3D scenes | |
| 9 | Polish, mobile, deploy | |

Blueprint detection, OCR and the smooth-scroll provider are reused from [Atrium v1](https://github.com/RachitMittal-20/Atrium).

Landing photos are AI-generated and serve as demo placeholders.
