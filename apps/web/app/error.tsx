"use client";

import { MAIN_READING, PAGE_HEADING, PRIMARY_BUTTON, SUBTLE } from "@/lib/ui";

// App-level error boundary. Honest copy, no blame-shifting: the failure is
// ours, reloading usually clears it, and nothing of the user's is lost.
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className={`${MAIN_READING} flex min-h-dvh flex-col items-center justify-center gap-4 text-center`}>
      <div className="text-section">
        <span>flight</span>check
      </div>
      <h1 className={`${PAGE_HEADING} text-balance`}>
        Something broke on our side.
      </h1>
      <p className={`${SUBTLE} max-w-md`}>
        Reload the page. Your sessions and reports are safe. If this keeps
        happening, it is a bug on our end, not something you did.
      </p>
      <button type="button" onClick={reset} className={PRIMARY_BUTTON}>
        Reload
      </button>
    </main>
  );
}
