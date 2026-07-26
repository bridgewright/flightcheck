import Link from "next/link";

import PollRefresh from "@/components/PollRefresh";
import StartSessionButton from "@/components/StartSessionButton";
import type { PackageRow } from "@/lib/types";
import { getPackageByToken } from "@/lib/worker";

export const dynamic = "force-dynamic";

export default async function PackagePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let pkg: PackageRow;
  try {
    pkg = await getPackageByToken(token);
  } catch {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-16">
        <h1 className="text-2xl font-bold">Package not found</h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          This link does not match any interview package. Check the URL, or{" "}
          <Link href="/new" className="underline underline-offset-4">
            start a new one
          </Link>
          .
        </p>
      </main>
    );
  }

  if (pkg.status === "compiling") {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-16">
        <PollRefresh intervalMs={3000} />
        <h1 className="text-2xl font-bold">Compiling your rubric&hellip;</h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          We are reading the JD, researching how this role actually interviews, and
          compiling your rubric. This page refreshes itself — usually 1&ndash;2 minutes.
        </p>
      </main>
    );
  }

  if (pkg.status === "failed" || !pkg.rubric) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-16">
        <h1 className="text-2xl font-bold">We could not compile this package</h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          Rubric compilation failed — most often because the JD page could not be read.
          No charge, nothing saved.{" "}
          <Link href="/new" className="underline underline-offset-4">
            Try again
          </Link>{" "}
          with the JD pasted as text instead of a URL.
        </p>
      </main>
    );
  }

  const rubric = pkg.rubric;
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">{rubric.role_title}</h1>
        {rubric.company ? (
          <p className="text-neutral-600 dark:text-neutral-400">{rubric.company}</p>
        ) : null}
        <p className="text-lg">
          This role evaluates you on these {rubric.dimensions.length} dimensions.
        </p>
      </header>
      <ol className="flex flex-col gap-6">
        {rubric.dimensions.map((dimension) => (
          <li key={dimension.key} className="flex flex-col gap-2 border-b border-neutral-200 pb-6 dark:border-neutral-800">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-xl font-semibold">{dimension.name}</h2>
              <span className="text-sm text-neutral-500">
                {Math.round(dimension.weight * 100)}% of your score
              </span>
            </div>
            <ul className="list-disc pl-5 text-sm text-neutral-600 dark:text-neutral-400">
              {dimension.signals.map((signal) => (
                <li key={signal}>{signal}</li>
              ))}
            </ul>
            <p className="text-xs text-neutral-500">
              Sources:{" "}
              {dimension.citations.map((citation, i) => (
                <span key={citation.url}>
                  {i > 0 ? " · " : ""}
                  <a
                    href={citation.url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    {citation.title}
                  </a>
                </span>
              ))}
            </p>
          </li>
        ))}
      </ol>
      <StartSessionButton packageId={pkg.id} token={token} />
    </main>
  );
}
