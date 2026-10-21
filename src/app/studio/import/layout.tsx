/*
 * src/app/studio/import/layout.tsx — the page title for /studio/import (step D.1); see ../layout.tsx.
 */
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Import a floor plan", description: "Read a floor plan from a PDF or an image, in your browser. Files never leave it." };

export default function ImportLayout({ children }: { children: React.ReactNode }) {
  return children;
}
