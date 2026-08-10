"use client";

import { usePathname } from "next/navigation";

import { routeCanvasClass } from "@/components/motion/route";

// The route-enter canvas (F-88, DECISIONS 063). Navigating used to swap the
// whole screen in one frame — click, pop, a new world with no thread back to
// the one just left. This template scopes the fix: it applies the canvas
// class under which app/globals.css dissolves the page's <main> in, on the
// entry vocabulary's own numbers. The chrome around <main> repaints identical
// pixels and holds still, which is what makes the change read as content
// arriving on a surface that never left.
//
// What this file deliberately is NOT:
//
//   Not the animation. The enter is a CSS rule, because CSS plays before
//   hydration, with JavaScript off, and under the reduced-motion backstop's
//   clamp — three readers a client-side animation would miss. The replay
//   trigger is React recreating <main> when the page component changes, not
//   this template's remount key: a root template only remounts when the
//   first segment changes (see node_modules/next/dist/docs on template.js),
//   so keying the animation off it would skip /sessions -> /sessions/[id].
//
//   Not a box. display: contents generates no box, so Shell's flex-1 <main>
//   and footer keep working against the body's flex column exactly as they
//   did before this file existed.
//
//   Not the exclusion. Which surface stays still (the session room, F-50) is
//   decided and tested in components/motion/route.ts; this file only asks.
//
// A client component solely for usePathname; children stream through as
// server-rendered payload untouched.

export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className={routeCanvasClass(pathname)} style={{ display: "contents" }}>
      {children}
    </div>
  );
}
