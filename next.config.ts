// next.config.ts — Next.js settings for Atrium v2.
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
