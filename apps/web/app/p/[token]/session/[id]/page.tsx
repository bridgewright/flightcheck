import { redirect } from "next/navigation";

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
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-xl font-semibold">Session unavailable</h1>
        <p className="mt-2 text-neutral-500">
          This session does not exist, is not part of this package, or the
          scoring service is unreachable. Go back to your home and start a
          new session.
        </p>
      </main>
    );
  }
  redirect(`/sessions/${encodeURIComponent(id)}/room`);
}
