/*
 * src/app/layout.tsx — root layout for Atrium v2.
 *
 * Loads the two type families once via next/font and exposes them as CSS
 * variables that globals.css binds to --font-display / --font-sans.
 * Wraps every page in SmoothScrollProvider (imported from v1), the single
 * GSAP-ticker clock that drives Lenis scrolling and ScrollTrigger.
 */
import type { Metadata } from "next";
import { Marcellus, Figtree } from "next/font/google";
import { SmoothScrollProvider } from "@/components/motion/SmoothScrollProvider";
import "./globals.css";

// Display face: Roman inscriptional letterforms, echoing carved stone. Headlines only.
const marcellus = Marcellus({ variable: "--font-marcellus", subsets: ["latin"], weight: "400" });

// Interface face: clean, humanist sans for body copy and all editor UI.
const figtree = Figtree({ variable: "--font-figtree", subsets: ["latin"], weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "Atrium",
  description: "Turn a floor plan into an editable 3D model you can walk through.",
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
