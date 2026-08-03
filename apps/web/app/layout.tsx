import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SITE_URL } from "./site";

// One family and its mono companion. The reference this design follows uses a
// grotesque throughout with a semi-mono for labels and buttons, so Geist
// carries everything a reader sees and Geist Mono carries the small uppercase
// labels and the CTA text.
//
// A text serif (Newsreader) carried display type for one day and was removed
// on 2026-08-04, after the reference turned out to use no serif anywhere.
//
// Loaded through next/font so both are self-hosted and preloaded, with no
// render-blocking request to a third party and no shift when they arrive.

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
