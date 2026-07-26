import { authorizeSession } from "@/lib/worker";

import SessionRoom from "../../../../../components/SessionRoom";

// Server component: authorizes the session against the URL's package access
// token (the v0.1 security model) and learns the package id and session
// index the client needs for the recording upload. Only those two fields —
// plus the token the client must echo back on its privileged calls — are
// forwarded; the session plan and interviewer instructions in the worker
// payload never reach the browser.
export default async function SessionPage({
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
          scoring service is unreachable. Go back to your package page and
          start a new session.
        </p>
      </main>
    );
  }
  return (
    <SessionRoom
      sessionId={id}
      packageId={access.value.session.package_id}
      sessionIndex={access.value.session.index}
      token={token}
      reportHref={`/p/${token}/report/${id}`}
    />
  );
}
