// next.config.ts — Next.js settings for Atrium v2.
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
  // Landing photos and 3D assets in /public are large and rarely change,
  // so let browsers cache them for a day instead of revalidating every visit.
  async headers() {
    return ["/images/:path*", "/models/:path*", "/hdri/:path*"].map((source) => ({
      source,
      headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
    }));
  },
};

export default nextConfig;
