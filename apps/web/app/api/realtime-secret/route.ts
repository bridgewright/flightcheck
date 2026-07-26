import { NextResponse } from "next/server";

import { authorizeSession } from "@/lib/worker";

import { clientSecretRequestBody } from "../../../lib/realtime";

const OPENAI_CLIENT_SECRETS_URL =
  "https://api.openai.com/v1/realtime/client_secrets";

// Mints a short-lived OpenAI ephemeral client secret for one interview
// session. The real OPENAI_API_KEY is used only here, server-side; the
// browser receives the ek_... value, which is safe to expose (it expires and
// is scoped to the minted session). The interviewer instructions are
// re-fetched from the worker here — never accepted from the client — so the
// browser can neither read nor tamper with them.
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
  if (typeof body.token !== "string" || body.token === "") {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }
  // Capability check BEFORE any OpenAI call: the package access token is the
  // v0.1 security model, so the caller must hold the token of the package
  // that owns this session. authorizeSession also url-encodes the ids on the
  // worker paths and returns the session payload, instructions included.
  const access = await authorizeSession(body.token, body.sessionId);
  if (!access.ok) {
    return NextResponse.json(
      access.status === 403
        ? { error: "access denied" }
        : { error: "worker session lookup failed" },
      { status: access.status },
    );
  }
  const instructions = access.value.session.interviewer_instructions;
  if (typeof instructions !== "string" || instructions === "") {
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
