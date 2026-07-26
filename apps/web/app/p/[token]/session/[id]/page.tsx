import SessionRoom from "../../../../../components/SessionRoom";

// Server component: looks up the session on the worker (server-side bearer
// token) to learn the package id and session index the client needs for the
// recording upload. Only those two fields are forwarded — the session plan
// and interviewer instructions in the worker payload never reach the
// browser.
export default async function SessionPage({
  params,
}: {
  params: Promise<{ token: string; id: string }>;
}) {
  const { token, id } = await params;
  const res = await fetch(`${process.env.WORKER_URL}/api/sessions/${id}`, {
    headers: { Authorization: `Bearer ${process.env.WORKER_API_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-xl font-semibold">Session unavailable</h1>
        <p className="mt-2 text-neutral-500">
          This session does not exist or the scoring service is unreachable
          (status {res.status}). Go back to your package page and start a
          new session.
        </p>
      </main>
    );
  }
  const session = (await res.json()) as {
    package_id: string;
    index: number;
  };
  return (
    <SessionRoom
      sessionId={id}
      packageId={session.package_id}
      sessionIndex={session.index}
      reportHref={`/p/${token}/report/${id}`}
    />
  );
}
