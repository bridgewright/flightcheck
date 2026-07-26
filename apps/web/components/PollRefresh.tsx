"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Re-fetches the current server component on an interval. Used by wait states
// ("compiling", "scoring") so status flips appear without a manual reload.
export default function PollRefresh({ intervalMs }: { intervalMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
