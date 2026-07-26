import { NextResponse } from "next/server";

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
  let body: { sessionId?: unknown };
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
  const sessionRes = await fetch(
    `${process.env.WORKER_URL}/api/sessions/${body.sessionId}`,
    {
      headers: { Authorization: `Bearer ${process.env.WORKER_API_TOKEN}` },
      cache: "no-store",
    },
  );
  if (!sessionRes.ok) {
    return NextResponse.json(
      { error: `worker session lookup failed (${sessionRes.status})` },
      { status: 502 },
    );
  }
  const session = (await sessionRes.json()) as {
    interviewer_instructions?: unknown;
  };
  const instructions = session.interviewer_instructions;
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
