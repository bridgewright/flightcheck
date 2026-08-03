import Link from "next/link";
import { redirect } from "next/navigation";

import SessionRoom from "@/components/SessionRoom";
import {
  CAPABILITY_ENDED_MESSAGE,
  sessionCapability,
} from "@/lib/session-capability";
import { PRIMARY_BUTTON } from "@/lib/ui";
import { getViewer } from "@/lib/viewer";
import { authorizeViewerSession } from "@/lib/worker";

export const dynamic = "force-dynamic";

// S9 — the live interview room at its canonical, login-scoped address.
// Authorization is viewer ownership (the signed-in account must own the
// session's package); no capability token appears in the URL.
//
// F-12: nor in the RSC payload. The package access token used to ride along
// as a prop so the recording-upload route could authorize it — a permanent,
// package-wide capability serialized into the page, readable by anything
// that could read the payload, with no expiry and no way to revoke it. The
// upload route now authorizes the signed-in viewer like the other two
// privileged routes, so the room needs no credential at all and none is
// sent. tests/room-token-hygiene.test.ts is the gate that keeps it out.
//
// Entry is also gated on the session's own capability window (migration
// 006): an expired or revoked session does not open a room. Finishing one
// is deliberately never gated — see lib/session-capability.ts.
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
  if (sessionCapability(access.value.session) !== "active") {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-xl font-semibold">This session is closed</h1>
        <p className="mt-2 text-neutral-500">{CAPABILITY_ENDED_MESSAGE}</p>
        <Link href="/home" className={`${PRIMARY_BUTTON} mt-6 inline-block`}>
          Back to your sessions
        </Link>
      </main>
    );
  }
  return (
    <SessionRoom sessionId={id} reportHref={`/sessions/${id}`} />
  );
}
