import { NextResponse } from "next/server";

import { getViewer } from "@/lib/viewer";
import { authorizeSession, authorizeViewerSession } from "@/lib/worker";

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
  }
  if (typeof instructions !== "string" || instructions === "") {
    console.error("realtime-secret: worker session payload has no interviewer instructions");
    return NextResponse.json(
      { error: "session has no interviewer instructions" },
      { status: 502 },
    );
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
