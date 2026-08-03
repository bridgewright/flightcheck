import Link from "next/link";
import { redirect } from "next/navigation";

import PollRefresh from "@/components/PollRefresh";
import { QUIET_LINK } from "@/lib/ui";
import { authorizeSession } from "@/lib/worker";

export const dynamic = "force-dynamic";

// Legacy stub (URL-model migration, this batch): reports live at
// /sessions/[id] now, where account ownership governs. Old token links keep
// working — the token still proves the holder may know this session exists,
// so the stub authorizes first and only then reveals the canonical URL.
// The redirect target enforces its own sign-in and ownership checks.

function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-2xl font-bold">Report not found</h1>
      <p className="text-ink-muted">
        This link does not match any session report. Check the URL, or{" "}
        <Link href="/new" className={QUIET_LINK}>
          start a new package
        </Link>
        .
      </p>
    </main>
  );
}

function WorkerUnreachable() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-16">
      <PollRefresh intervalMs={5000} />
      <h1 className="text-2xl font-bold">Can&apos;t reach the scoring service</h1>
      <p className="text-ink-muted">
        Your link is fine — the scoring service is briefly unreachable, most
        often during a restart window. This page retries automatically; leave
        it open.
      </p>
    </main>
  );
}

export default async function LegacyReportRedirect({
  params,
}: {
  params: Promise<{ token: string; id: string }>;
}) {
  const { token, id } = await params;
  const access = await authorizeSession(token, id);
  if (!access.ok) {
    return access.status === 502 ? <WorkerUnreachable /> : <NotFound />;
  }
  redirect(`/sessions/${id}`);
}
