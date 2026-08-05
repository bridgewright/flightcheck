import { NextResponse } from "next/server";

import { sessionCapability } from "@/lib/session-capability";
import { getViewer } from "@/lib/viewer";
import {
  WorkerError,
  authorizeSession,
  authorizeViewerSession,
  incrementSecretMint,
} from "@/lib/worker";

import { clientSecretRequestBody } from "../../../lib/realtime";

const OPENAI_CLIENT_SECRETS_URL =
  "https://api.openai.com/v1/realtime/client_secrets";

// Mints a short-lived OpenAI ephemeral client secret for one interview
// session. The real OPENAI_API_KEY is used only here, server-side; the
// browser receives the ek_... value, which is safe to expose (it expires and
// is scoped to the minted session). The interviewer instructions are
// re-fetched from the worker here — never accepted from the client — so the
// browser can neither read nor tamper with them.
//
// Authorization runs BEFORE any OpenAI call, with one of two credentials:
// - Legacy capability: the package access token in the body (the v0.1
//   model). Still honored so token links keep working until F-10 retires
//   loose tokens.
// - Viewer ownership: no token, but a signed-in account that owns the
//   session's package — the canonical path for the id-routed session room.
export async function POST(request: Request) {
  let body: { sessionId?: unknown; token?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof body.sessionId !== "string" || body.sessionId === "") {
    return NextResponse.json(
      { error: "sessionId is required" },
      { status: 400 },
    );
  }
  const token = typeof body.token === "string" && body.token !== "" ? body.token : null;
  let instructions: string | undefined;
  // Capability state of the authorized session, checked below before any
  // OpenAI call. Set in both branches so revocation is a property of the
  // session rather than of whichever credential was used to reach it.
  let capability: ReturnType<typeof sessionCapability> = "active";
  if (token !== null) {
    const access = await authorizeSession(token, body.sessionId);
    if (!access.ok) {
      console.error(`realtime-secret: authorizeSession failed (status ${access.status})`);
      return NextResponse.json(
        access.status === 403
          ? { error: "access denied" }
          : { error: "worker session lookup failed" },
        { status: access.status },
      );
    }
    instructions = access.value.session.interviewer_instructions;
    capability = sessionCapability(access.value.session);
  } else {
    const viewer = await getViewer();
    if (!viewer) {
      return NextResponse.json({ error: "sign in first" }, { status: 401 });
    }
    const access = await authorizeViewerSession(viewer, body.sessionId);
    if (!access.ok) {
      console.error(`realtime-secret: authorizeViewerSession failed (status ${access.status})`);
      return NextResponse.json(
        access.status === 403
          ? { error: "access denied" }
          : { error: "worker session lookup failed" },
        { status: access.status },
      );
    }
    instructions = access.value.session.interviewer_instructions;
    capability = sessionCapability(access.value.session);
  }
  // F-12 entry gate (migration 006). Minting a secret is handing out access
  // to a live interview, so an expired or revoked session is refused here —
  // before OpenAI is called and before the mint counter moves. Finishing an
  // interview that already happened is deliberately NOT gated; see
  // lib/session-capability.ts.
  if (capability !== "active") {
    console.error(`realtime-secret: session capability is ${capability}`);
    return NextResponse.json({ error: "access denied" }, { status: 403 });
  }
  if (typeof instructions !== "string" || instructions === "") {
    console.error("realtime-secret: worker session payload has no interviewer instructions");
    return NextResponse.json(
      { error: "session has no interviewer instructions" },
      { status: 502 },
    );
  }
  // Per-session connection cap (v0.5): count this mint against the session
  // before OpenAI is called. Only an authorized caller reaches this line,
  // so the counter cannot be pumped anonymously.
  try {
    await incrementSecretMint(body.sessionId);
  } catch (err) {
    if (err instanceof WorkerError && err.status === 429) {
      return NextResponse.json(
        { error: "Too many connection attempts for this session." },
        { status: 429 },
      );
    }
    // F-66: the worker refuses to mint for a session past "planned" — the
    // interview already ended and no heartbeat would keep the room alive.
    // Forwarded with the code intact (the room keys its terminal screen on
    // it), never treated as a counter outage: minting here is how a dead
    // session used to get a live room and a doomed 409 heartbeat train.
    //
    // Matched on the worker's code rather than the bare status, because the
    // browser RELOADS on this answer: a different 409 wearing this label
    // would reload a tab whose page still renders a start card, and the
    // customer would sit in a loop. Any other 409 falls through to the
    // counter-outage path below and the mint proceeds, which is the standing
    // behaviour for a counter that cannot answer.
    if (
      err instanceof WorkerError &&
      err.status === 409 &&
      err.code === "session-not-live"
    ) {
      return NextResponse.json(
        { error: "This session has already ended.", code: "session-not-live" },
        { status: 409 },
      );
    }
    console.error("realtime-secret: secret-mint counter unavailable", err);
  }
  const mintRes = await fetch(OPENAI_CLIENT_SECRETS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(clientSecretRequestBody(instructions)),
  });
  if (!mintRes.ok) {
    // Status only — the OpenAI error body could quote request contents.
    console.error(`realtime-secret: OpenAI client_secrets mint failed (status ${mintRes.status})`);
    return NextResponse.json(
      { error: `secret mint failed (${mintRes.status})` },
      { status: 502 },
    );
  }
  const minted = (await mintRes.json()) as {
    value: string;
    expires_at: number;
  };
  return NextResponse.json({ value: minted.value, expiresAt: minted.expires_at });
}
