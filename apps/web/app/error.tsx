"use client";

import { PRIMARY_BUTTON } from "@/lib/ui";

// App-level error boundary. Honest copy, no blame-shifting: the failure is
// ours, reloading usually clears it, and nothing of the user's is lost.
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 px-6 py-24 text-center">
      <div className="text-lg">
        <span className="font-bold">flight</span>check
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-balance">
        Something broke on our side.
      </h1>
      <p className="max-w-md text-sm text-neutral-600 dark:text-neutral-400">
        Reload the page — your sessions and reports are safe. If this keeps
        happening, it is a bug on our end, not something you did.
      </p>
      <button type="button" onClick={reset} className={PRIMARY_BUTTON}>
        Reload
      </button>
    </main>
  );
}
