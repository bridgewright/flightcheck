"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ERROR_TEXT, SECONDARY_BUTTON } from "@/lib/ui";

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
        className={`${SECONDARY_BUTTON} self-start`}
      >
        {pending ? "Retrying…" : "Retry compile"}
      </button>
      {error ? <p className={ERROR_TEXT}>{error}</p> : null}
    </div>
  );
}
