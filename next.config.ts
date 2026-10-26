// next.config.ts — Next.js settings for Atrium v2.
import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

// The app version shown in "Report a problem" (src/lib/feedback/report.ts): package.json's version, plus the
// commit Vercel built from when there is one (step D.1).
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);

const DAY = "public, max-age=86400";
// Files whose names never change but whose bytes do not either (step D.1): a year, immutable. If one of them is
// ever replaced, give it a new name too (docs/DEPLOY.md), or visitors keep the old bytes for a year.
const FOREVER = "public, max-age=31536000, immutable";

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: commit ? `${version}+${commit}` : version },
  // tesseract.js ships a CDN default for its worker script. ocr.ts always overrides it with /tesseract/, but the
  // string would still sit in the bundle, so this loader blanks it (step O.1, guarded by test-ocr-assets.ts).
  turbopack: {
    rules: {
      "*.js": {
        condition: { path: /tesseract\.js\/src\/worker\/browser\/defaultOptions\.js$/ },
        loaders: ["./scripts/tesseract-default-options-loader.cjs"],
        as: "*.js",
      },
    },
  },
  async headers() {
    return [
      // 3D assets in /public are large and rarely change, so let browsers cache them for a day. (/samples is the import page's sample plan; /models and /hdri are
      // reserved for the deferred 8.x steps.)
      ...["/models/:path*", "/hdri/:path*", "/samples/:path*"].map((source) => ({ source, headers: [{ key: "Cache-Control", value: DAY }] })),
      // The landing photos (/images, WebP, step A.1), the OCR worker, cores and language data (about 11 MB, /tesseract/) and pdf.js's
      // image-decoder wasm (/pdfjs/). The hashed worker chunks under /_next/static already get a year and immutable from Next itself.
      ...["/images/:path*", "/tesseract/:path*", "/pdfjs/:path*"].map((source) => ({ source, headers: [{ key: "Cache-Control", value: FOREVER }] })),
    ];
  },
};

export default nextConfig;
