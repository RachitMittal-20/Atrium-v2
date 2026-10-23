# Deploying Atrium to Vercel (step D.1)

Atrium is one Next.js app with no server code: every route is prerendered static content (`next build` marks `/`, `/limits`, `/studio`, `/studio/import` and `/_not-found` as `○ Static`), there are no API routes, no database and no secrets, and the browser asks no host but its own origin. Vercel's free (Hobby) tier is enough. **Live at https://atrium-v2-ashen.vercel.app/ (first deployed 2026-10-21)**; these are the steps that were followed.

## Before the first deploy

On a clean checkout of the branch you will deploy:

```
npm ci
npm test
npx tsc --noEmit
perl -e 'alarm 300; exec @ARGV' npm run build      # about 15 s; over 5 minutes means an import cycle or a hang
grep -rlE "__studio3d|__pushPullDebug|__importDebug|__importPdf|__plan2d|__takeoffStore|__scene3d|__walkDebug|__background|__reviewRunaway|__runaway" .next/static || echo clean
grep -rlE "cdn\.jsdelivr|unpkg\.com|cdnjs|fonts\.googleapis|fonts\.gstatic" .next/static || echo clean
```

Both greps must print `clean` (CI runs the same two and fails on a hit). The build fetches nothing from the network: the two fonts are in `src/app/fonts/` and loaded with `next/font/local`.

## Vercel project

1. Push the repo to GitHub (the CI workflow `.github/workflows/ci.yml` runs on the push; wait for it to be green).
2. vercel.com → **Add New… → Project** → import the GitHub repo.
3. Settings to check on the import screen (all are the defaults unless noted):

   | Setting | Value |
   |---|---|
   | Framework preset | Next.js (detected) |
   | Root directory | `./` |
   | Install command | `npm ci` (set it: the default is chosen from the lockfile, but be explicit) |
   | Build command | `next build` (default) |
   | Output directory | default (leave empty) |
   | **Node.js version** | **24.x**, under Project → Settings → General. Vercel does not read `.nvmrc`; the project is developed on Node 24.14.0. |
   | Environment variables | none required |

4. **Deploy.** The first build takes about a minute.
5. Settings → Environment Variables → leave "Automatically expose System Environment Variables" ON (it is by default). The app reads two of them at build time: `VERCEL_PROJECT_PRODUCTION_URL` (so the share image gets an absolute address, `metadataBase` in `src/app/layout.tsx`) and `VERCEL_GIT_COMMIT_SHA` (so "Report a problem" says which build the report is from, `next.config.ts`).
6. For a custom domain: Settings → Domains. Redeploy afterwards so the share image's address uses it.
7. Keep Preview deployments on; each pull request gets its own link.

## What to check on the deployed link

Replace `$URL` with the production address.

```
curl -sI $URL/tesseract/tesseract-core-simd-lstm.wasm.js | grep -iE "cache-control|content-type"   # public, max-age=31536000, immutable; application/javascript
curl -sI $URL/tesseract/eng.traineddata.gz               | grep -iE "cache-control|content-type"   # same cache line; application/gzip, with NO content-encoding header
curl -sI $URL/pdfjs/wasm/jbig2.wasm                      | grep -iE "cache-control|content-type"   # same cache line; application/wasm
curl -s  $URL/ | grep -o 'og:image" content="[^"]*'                                                # https://<your host>/opengraph-image.jpg?...
curl -sI $URL/no-such-page | head -1                                                               # HTTP/2 404
```

Then in a browser, with DevTools → Network open and "Disable cache" off:

- `/studio/import`: drop `tests/fixtures/pdf/plan-filled.pdf`, build, open in the studio. Every request should be to your own host (no `fonts.googleapis.com`, no CDN).
- Import an image so OCR runs; `/tesseract/*` is fetched once, and a second import (or a reload) serves them from cache.
- `/limits`, the import page's "Report a problem" and the studio's "Report a problem" open and show text; nothing is sent.

## Cache headers (`next.config.ts`)

| Path | Cache-Control | Why |
|---|---|---|
| `/_next/static/*` (hashed chunks, the PDF and OCR worker chunks, fonts) | `public, max-age=31536000, immutable` | Set by Next itself; the file name changes with its content. |
| `/tesseract/*` (about 11 MB: worker, two cores, English data, licences) | `public, max-age=31536000, immutable` | Big and never changes. |
| `/pdfjs/*` (pdf.js image-decoder wasm) | `public, max-age=31536000, immutable` | Same. |
| `/images/*`, `/models/*`, `/hdri/*` | `public, max-age=86400` | Landing photos; a day. |

**These files keep their names.** If you ever replace one (a new tesseract.js, a new pdf.js), give the new file a NEW NAME (and change `src/lib/blueprint/ocrAssets.ts` or `src/lib/pdf/open.ts` to match); otherwise returning visitors keep the old bytes for a year. Content types come from the file extension. Checked here on `npm run start` (not on Vercel; the curl checks above are how to confirm Vercel serves the same): `.wasm` is `application/wasm`, `.js` is `application/javascript`, `.gz` is `application/gzip` with no `Content-Encoding`, which matters because tesseract.js gunzips the data itself.

## Bundle sizes (production build on this Mac, 2026-10-21)

First-load JavaScript per route, from `.next/diagnostics/route-bundle-stats.json` (`npx tsx scripts/bundle-report.ts` prints it after a build):

| Route | Chunks | Raw | Gzip |
|---|---|---|---|
| `/` | 10 | 602 kB | 192 kB |
| `/limits` | 9 | 589 kB | 186 kB |
| `/studio` | 17 | 1915 kB | 565 kB |
| `/studio/import` | 19 | 1227 kB | 384 kB |

Loaded later, only when used: the PDF reader (pdf.js, a single 1.6 MB raw / 489 kB gzip chunk, in a Web Worker), the review, analysis and background workers, tesseract (`/tesseract/`, about 11 MB, only when OCR runs), and 3D model loaders (one chunk each). The landing page's photos are 5 JPEGs in `public/images/` (4.5 MB in total).

## Limits of the free tier to know about

Hobby projects are for non-commercial use and have monthly bandwidth and build-minute limits; the biggest transfers are the landing photos (4.5 MB) and, per OCR user, 11 MB of `/tesseract/` once (cached for a year after). Read Vercel's current limits page before sharing widely. There is no function usage because nothing runs on the server.

## Rolling back

Vercel → Deployments → the last good deployment → **Promote to Production** (instant; no rebuild).
