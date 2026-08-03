"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// The "Retry compile" pill on failed-compile packages (home + packages).
// The server action arrives as a prop from the server component that owns
// the surface; on success the router refreshes so the package's "Compiling"
// wait state and its self-polling take over — the button stays disabled
// until that render lands rather than inviting a double retry.

export default function RetryCompileButton({
  packageId,
  action,
}: {
  packageId: string;
  action: (packageId: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setPending(true);
    setError(null);
    const result = await action(packageId);
    if (result.ok) {
      router.refresh();
      return;
    }
    setError(result.error ?? "The retry didn't start. Try again in a moment.");
    setPending(false);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={retry}
        disabled={pending}
        className="self-start rounded-md border border-neutral-300 px-4 py-1.5 text-sm disabled:cursor-wait disabled:opacity-50 dark:border-neutral-700"
      >
        {pending ? "Retrying…" : "Retry compile"}
      </button>
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}
