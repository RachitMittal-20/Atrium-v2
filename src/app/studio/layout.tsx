/*
 * src/app/studio/layout.tsx — gives /studio (and, nested, /studio/import) a page title (step D.1). The pages
 * are client components, which cannot export metadata, so this server layout does; it renders its children as they are.
 */
import type { Metadata } from "next";

// A layout that sets a title replaces the root's template, so this one carries its own, which /studio/import then uses.
export const metadata: Metadata = {
  title: { default: "Studio | Atrium", template: "%s | Atrium" },
  description: "Edit your floor plan in 2D and 3D, furnish it and walk through it.",
};

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return children;
}
