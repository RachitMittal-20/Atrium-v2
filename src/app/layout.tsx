/*
 * src/app/layout.tsx — root layout for Atrium v2.
 *
 * Loads the two type families once via next/font/local and exposes them as CSS
 * variables that globals.css binds to --font-display / --font-sans. The woff2 files
 * in ./fonts are the latin subsets Google served for Marcellus and Figtree, kept in
 * the repo so `next build` fetches nothing from Google and the browser asks no one
 * but this site (step D.1). Wraps every page in SmoothScrollProvider (imported from
 * v1), the single GSAP-ticker clock that drives Lenis scrolling and ScrollTrigger.
 * Site-wide metadata (title template, description, Open Graph) is here; the image
 * is ./opengraph-image.jpg, made from a landing photo by scripts/make-og-image.ts.
 */
import type { Metadata } from "next";
import localFont from "next/font/local";
import { SmoothScrollProvider } from "@/components/motion/SmoothScrollProvider";
import "./globals.css";

// Display face: Roman inscriptional letterforms, echoing carved stone. Headlines only.
// adjustFontFallback matches what next/font/google generated, so text doesn't jump when the face loads.
// preload: false (step A.1): only Figtree is preloaded. It is the face of every route's first paint and of all the interface;
// Marcellus is headlines, loads when one is drawn (display: swap, with a metric-matched fallback so nothing shifts), and a
// second preload would compete with the first for the same early bandwidth.
const marcellus = localFont({ src: "./fonts/marcellus-latin.woff2", variable: "--font-marcellus", weight: "400", display: "swap", preload: false, adjustFontFallback: "Times New Roman" });

// Interface face: clean, humanist sans for body copy and all editor UI. One variable file covers 400 to 600.
const figtree = localFont({ src: "./fonts/figtree-latin.woff2", variable: "--font-figtree", weight: "400 600", display: "swap", adjustFontFallback: "Arial" });

const DESCRIPTION = "Turn a floor plan into an editable 3D model you can walk through. Files stay in your browser.";

export const metadata: Metadata = {
  // Absolute URLs for the share image: Vercel's production host when there is one, else the local server.
  metadataBase: new URL(process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000"),
  title: { default: "Atrium: floor plan to 3D", template: "%s | Atrium" },
  description: DESCRIPTION,
  openGraph: { title: "Atrium: floor plan to 3D", description: DESCRIPTION, siteName: "Atrium", type: "website" },
  twitter: { card: "summary_large_image", title: "Atrium: floor plan to 3D", description: DESCRIPTION },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: browser extensions often inject attributes on <html>.
    <html lang="en" className={`${marcellus.variable} ${figtree.variable} antialiased`} suppressHydrationWarning>
      <body>
        <SmoothScrollProvider>{children}</SmoothScrollProvider>
      </body>
    </html>
  );
}
