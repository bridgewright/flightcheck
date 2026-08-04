"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { NOTICE, PRIMARY_BUTTON } from "@/lib/ui";

export default function ReclaimSessionButton({
  sessionId,
  packageId,
}: {
  sessionId: string;
  packageId: string;
}) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);

  async function reclaim() {
    setWorking(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/reclaim`, {
        method: "POST",
      });
      if (!response.ok) throw new Error("reclaim refused");
      const start = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package_id: packageId }),
      });
      const started = (await start.json().catch(() => ({}))) as {
        session_id?: string;
      };
      if (!start.ok || !started.session_id) throw new Error("restart refused");
      router.push(`/sessions/${started.session_id}/room`);
    } catch {
      setWorking(false);
      setFailed(true);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={reclaim}
        disabled={working}
        className={`${PRIMARY_BUTTON} self-start`}
      >
        {working ? "Starting again…" : "Session dropped. Start again"}
      </button>
      {failed ? <p className={NOTICE}>Could not release the session. Try again.</p> : null}
    </div>
  );
}
