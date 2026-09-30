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
- `/studio` is the editor route.
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
- OCR reads the deskewed but UNFILLED image; the hollow-wall fill also fills some letter strokes. In hollow mode, windows drawn as lines inside walls are filled as wall, so their openings are not detected.

## Known limitations
- The hollow fill cannot tell a wall whose gap is outside the accepted range from furniture drawn as long parallel lines. Both are just two long lines with white between them.
- Walls whose gap is more than 3x the commonest gap are missed. On a plan with lots of narrow line pairs (window lines, shelving), the commonest gap can be narrower than the real walls, and then real walls are skipped.
- Room-size labels give no scale for open-plan rooms, rooms bounded mostly by windows, or rooms whose edges are single thin lines. The label is measured against the walls around it, and those rooms don't have enough wall to measure against.
- OCR sometimes splits a size label into fragments, and then the size is not read.
- When no scale can be worked out, the fallback is the user clicking a wall and typing its length.
