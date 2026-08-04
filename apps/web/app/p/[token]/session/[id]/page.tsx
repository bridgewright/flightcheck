import { redirect } from "next/navigation";

import { MAIN_READING, PAGE_HEADING } from "@/lib/ui";
import { authorizeSession } from "@/lib/worker";

// Legacy address. The session room lives at /sessions/[id]/room now; this
// route survives only so old links keep working until F-10 retires loose
// tokens. It still authorizes the token against the session BEFORE
// redirecting — a redirect that skipped the check would let any token
// holder confirm which session ids exist.
export default async function LegacySessionPage({
  params,
}: {
  params: Promise<{ token: string; id: string }>;
}) {
  const { token, id } = await params;
  const access = await authorizeSession(token, id);
  if (!access.ok) {
    return (
      <main className={`${MAIN_READING} flex min-h-dvh flex-col justify-center`}>
        <h1 className={PAGE_HEADING}>Session unavailable</h1>
        <p className="mt-2 text-ink-faint">
          This session does not exist, is not part of this package, or the
          scoring service is unreachable. Go back to your home and start a
          new session.
        </p>
      </main>
    );
  }
  redirect(`/sessions/${encodeURIComponent(id)}/room`);
}
