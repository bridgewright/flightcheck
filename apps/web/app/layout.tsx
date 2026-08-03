import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import { SITE_URL } from "./site";

// Two families, and the division between them is the design system's rather
// than a preference: Newsreader carries display type and the verdict, Geist
// carries UI, body, tables, and every number that has to line up in a column.
//
// Newsreader is a low-contrast text serif drawn for screens, which is what a
// calm serif-adjacent editorial language asks for. It is loaded through
// next/font so it is self-hosted and preloaded, with no render-blocking
// request to a third party and no layout shift when it arrives.

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  // The two weights the type steps actually use. Naming them keeps the
  // download to what ships rather than the whole variable range.
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  // Every relative og:image resolves against this. Without it Next falls back
  // to localhost, and the statically prerendered routes ship a card nobody
  // outside the developer's machine can load.
  metadataBase: new URL(SITE_URL),
  title: "flightcheck: know if you'd pass",
  description:
    "JD-specific mock interviews with honest verdicts for non-native English speakers.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
