"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { GenerateStudyResult } from "@/app/study/actions";
import { ERROR_TEXT } from "@/lib/ui";

export default function GenerateStudyButton({ packageId, label, className, action }: {
  packageId: string;
  label: string;
  className: string;
  action: (previous: GenerateStudyResult, formData: FormData) => Promise<GenerateStudyResult>;
}) {
  const router = useRouter();
  const [state, submit, pending] = useActionState(action, { ok: false });
  useEffect(() => { if (state.ok) router.refresh(); }, [router, state.ok]);
  return <form action={submit} className="flex flex-col items-start gap-2">
    <input type="hidden" name="packageId" value={packageId} />
    <button className={className} disabled={pending}>{pending ? "Building…" : label}</button>
    {!state.ok && state.error ? <p className={ERROR_TEXT}>{state.error}</p> : null}
  </form>;
}
