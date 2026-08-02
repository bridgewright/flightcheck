import { redirect } from "next/navigation";

import SessionRoom from "@/components/SessionRoom";
import { getViewer } from "@/lib/viewer";
import { authorizeViewerSession } from "@/lib/worker";

export const dynamic = "force-dynamic";

// S9 — the live interview room at its canonical, login-scoped address.
// Authorization is viewer ownership (the signed-in account must own the
// session's package); no capability token appears in the URL. The wrapper
// forwards only what the client needs — the session plan and interviewer
// instructions in the worker payload never reach the browser.
//
// The package access token still rides along as a prop (never a URL): the
// recording-upload sign route accepts only the legacy token credential this
// batch, and the interview must not fail at its very last step. Retiring
// the prop needs viewer auth on that route (F-10 territory).
//
// Renders chrome-less: an interview gets the whole screen, no navigation.
export default async function SessionRoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await getViewer();
  if (!viewer) {
    redirect(`/login?next=${encodeURIComponent(`/sessions/${id}/room`)}`);
  }
  const access = await authorizeViewerSession(viewer, id);
  if (!access.ok) {
    // Denial vs outage stay distinct. 403 covers unknown ids and foreign
    // sessions alike (authorizeViewerSession never reveals which); 502 is
    // the worker being unreachable — nothing about access can be concluded.
    if (access.status === 502) {
      return (
        <main className="mx-auto max-w-2xl p-8">
          <h1 className="text-xl font-semibold">The room is unavailable right now</h1>
          <p className="mt-2 text-neutral-500">
            The scoring service could not be reached. Nothing is lost —
            reload in a moment.
          </p>
        </main>
      );
    }
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-xl font-semibold">Session unavailable</h1>
        <p className="mt-2 text-neutral-500">
          This session does not exist or is not part of your account. Go back
          to your home and start a new session.
        </p>
      </main>
    );
  }
  return (
    <SessionRoom
      sessionId={id}
      packageId={access.value.session.package_id}
      sessionIndex={access.value.session.index}
      token={access.value.pkg.access_token}
      reportHref={`/sessions/${id}`}
    />
  );
}
