# Performance and accessibility measurements (step A.1)

Numbers only. Date: 2026-10-26.

**Headless numbers are not a phone's.** Everything below was measured in headless Chromium on one Mac, with WebGL on SwiftShader (the CPU), against production builds (`next build`, `next start`) on localhost. Lighthouse's "mobile" profile only emulates a phone (screen size, 4x CPU slowdown and 4G-like throttling are simulated), and its simulated LCP is a model, not a stopwatch: on `/limits` a throttled Chromium measured LCP at 0.72 s while Lighthouse's simulated figure was 4.2 s. A busy machine moves a score by more than most changes here did (see "Two passes" below), so read these as a ranking and a direction, not as what a visitor gets.

| | |
|---|---|
| Machine | MacBook, Apple M1, 8 GB, macOS 27.0.1, with other apps running (Chrome, VS Code, a system update) |
| Software | Node 24.14.0, Lighthouse 13.5.0, axe-core 4.14.0, Playwright 1.63.0, Chromium 153.0.8010.12 (Chrome for Testing, headless), Next 16.3.4 (Turbopack) |
| Tool | `node scripts/lighthouse-report.ts [--runs 3] [--bases before=URL,after=URL]` (medians of the runs, from a fresh browser each time) |
| "before" | the committed tree (`472ea9f`), built and served separately on :3101 |
| "after" | the working tree with step A.1, on :3100 |

## Lighthouse, before and after, same load

Runs alternated between the two servers (route, profile, run, then each build in turn), three runs each, so any background load slowed both alike. Medians. Scores are 0 to 100.

| build | profile | route | perf | a11y | best-practices | SEO | FCP ms | LCP ms | TBT ms | transfer kB |
|---|---|---|---|---|---|---|---|---|---|---|
| before | mobile | / | 38 | 96 | 100 | 100 | 1376 | 9720 | 6347 | 1508 |
| after | mobile | / | 35 | 100 | 100 | 100 | 1500 | 14576 | 10699 | 738 |
| before | mobile | /limits | 79 | 95 | 100 | 100 | 768 | 4235 | 197 | 463 |
| after | mobile | /limits | 79 | 100 | 100 | 100 | 939 | 4139 | 181 | 463 |
| before | mobile | /studio/import | 74 | 95 | 100 | 100 | 844 | 5437 | 229 | 696 |
| after | mobile | /studio/import | 70 | 100 | 100 | 100 | 2305 | 5444 | 245 | 696 |
| before | mobile | /studio | 46 | 100 | 100 | 100 | 765 | 5050 | 7502 | 626 |
| after | mobile | /studio | 46 | 100 | 100 | 100 | 918 | 4923 | 9027 | 626 |
| before | desktop | / | 62 | 96 | 100 | 100 | 216 | 1764 | 754 | 1508 |
| after | desktop | / | 66 | 100 | 100 | 100 | 255 | 1157 | 723 | 738 |
| before | desktop | /limits | 99 | 95 | 100 | 100 | 210 | 895 | 0 | 463 |
| after | desktop | /limits | 99 | 100 | 100 | 100 | 264 | 891 | 0 | 463 |
| before | desktop | /studio/import | 98 | 95 | 100 | 100 | 289 | 1042 | 0 | 696 |
| after | desktop | /studio/import | 98 | 100 | 100 | 100 | 255 | 1033 | 0 | 696 |
| before | desktop | /studio | 75 | 100 | 100 | 100 | 214 | 1013 | 466 | 626 |
| after | desktop | /studio | 77 | 100 | 100 | 100 | 495 | 971 | 451 | 626 |

The mobile `/` and `/studio` rows are dominated by total blocking time, which is the WebGL context and the first three.js frames on SwiftShader: it ranged from 2.3 s to 10.7 s between runs of one build on this machine, so the mobile TBT, LCP and score differences on those two rows are noise. The landing page was therefore run again, five runs alternating, once the machine was quieter (load average 4 instead of about 10):

| build | profile | route | perf | a11y | FCP ms | LCP ms | TBT ms | transfer kB |
|---|---|---|---|---|---|---|---|---|
| before | mobile | / | 43 | 96 | 1369 | 9015 | 2331 | 1508 |
| after | mobile | / | 45 | 100 | 1366 | 5986 | 2323 | 738 |
| before | desktop | / | 66 | 96 | 290 | 1649 | 725 | 1508 |
| after | desktop | / | 73 | 100 | 263 | 1339 | 588 | 738 |

## Two passes, one after the other, on a loaded machine

The first sequential pass (before any change; load not recorded) and the second (after all changes, load average about 10 from an unrelated system update) are not comparable, and are kept only to show why the runs above alternate. Medians of three.

| pass | route | mobile perf | mobile TBT ms | desktop perf | desktop TBT ms |
|---|---|---|---|---|---|
| first, before changes | / | 42 | 2793 | 69 | 498 |
| second, after changes | / | 38 | 8603 | 56 | 1791 |
| first, before changes | /studio | 47 | 2655 | 72 | 600 |
| second, after changes | /studio | 39 | 10407 | 59 | 3536 |
| first, before changes | /limits | 84 | 111 | 99 | 0 |
| second, after changes | /limits | 77 | 167 | 94 | 0 |

## Remaining failing audits (after)

- Performance, mobile and desktop `/` and `/studio`: total blocking time, speed index and largest contentful paint. The cost is main-thread script (about 0.6 s of WebGL context creation on SwiftShader, then the three.js frames); a GPU does not pay that. Not changed: removing the WebGL probe only moves the cost, and the scene's behaviour is the product.
- Performance, `/limits`, `/studio/import`: simulated LCP (4.1 s and 5.4 s mobile) and speed index. A text page: the simulation charges the heading for its web font; a throttled Chromium measured 0.72 s.
- Best practices: `valid-source-maps` (weight 0; the build emits one `.map` file, which Lighthouse reports as invalid); the category scores 100.
- Accessibility and SEO: none.

## Bytes, per change

| change | before | after |
|---|---|---|
| Landing photos, five files | 4,699,029 B (JPEG, 2560 × 1440) | 1,015,128 B (WebP, 1600 × 900, quality 78) |
| The first photo (the only one fetched before the first scroll) | 1,033,480 B | 244,766 B |
| Landing page transfer, Lighthouse total (mobile `/`) | 1508 kB | 738 kB |
| Open Graph image `src/app/opengraph-image.jpg` | 1200 × 630 JPEG | byte-identical, still a JPEG |
| Preloaded fonts | Marcellus 14.3 kB and Figtree 20.2 kB | Figtree only |
| First-load JS, gzip (`scripts/bundle-report.ts`) | `/` 195, `/limits` 187, `/studio` 571, `/studio/import` 386 kB (as recorded after step X.2) | the same four numbers |
| `Cache-Control` for `/images/*` | `public, max-age=86400` | `public, max-age=31536000, immutable` |
| `Cache-Control` for `/samples/*` | none (revalidated each visit) | `public, max-age=86400` |
| First photo `fetchPriority` | `high` | `low` |

## Accessibility: axe-core

Run by `scripts/e2e-a11y.ts` at 1440 and 390 on `/`, `/limits`, the 404, `/studio/import` (idle, and the review of plan-chatgpt-flat.pdf), the studio in 3D, 2D and split with a wall, a door, the Takeoff tool and a walk, and every dialog (Report a problem on both screens, New plan, Export report, Save project, Set scale).

| | critical | serious | moderate | minor |
|---|---|---|---|---|
| before (the committed tree) | 0 | 49 | 15 | 0 |
| after | 0 | 0 | 0 | 0 |

Before, by rule: color-contrast 46 (serious; muted text and the accent used as text, on every route), scrollable-region-focusable 2 (the import review's two tables, 390 only), target-size 1 (the zoom-out button under the first-run hint, 390 only), page-has-heading-one 15 (moderate; `/studio` had no h1, and the landing page's end-of-scroll state).

Lighthouse accessibility: 95 to 96 before on `/`, `/limits` and `/studio/import` (its one failing audit was color-contrast), 100 on every route and profile after.

## Browsers

`scripts/e2e-browsers.ts` (not in CI): WebKit 26.6 passed (landing in 3D mode, `/limits`, the sample plan to the studio, a vector PDF import, no console errors). Firefox 155 did not start in this session ("Could not find profile folder"), so nothing is known about it.
