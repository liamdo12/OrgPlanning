import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Occasion",
  description: "Toronto event-services marketplace",
};

/**
 * The two families the design system names.
 *
 * Loaded the way the prototype loads them (its own `preconnect` pair is at
 * lines 11–12): Instrument Serif for display, Plus Jakarta Sans at the four
 * weights the prototype actually uses, both `display=swap` so text is readable
 * before the files arrive.
 *
 * `next/font/google` would self-host these and drop the third-party request —
 * it downloads the files at build time, which this build cannot do offline.
 * That swap is a one-line change here and nothing else; until then the fallback
 * stacks in the token file are what a blocked request falls back to.
 */
const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={FONT_HREF} />
      </head>
      <body>{children}</body>
    </html>
  );
}
