// src/app/layout.tsx — root layout (temporary; replaced by the design-system layout in a later commit).
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Atrium", description: "Blueprint to editable 3D." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
