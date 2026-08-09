import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import Shell from "@/components/Shell";
import { ALARM_NOTICE, FIELD, LINK, PAGE_HEADING, PRIMARY_BUTTON, SUBTLE } from "@/lib/ui";
import { getViewer } from "@/lib/viewer";
import { publicMetadata } from "../site";
import { quickStart } from "./actions";

const QUICK_STASH_COOKIE = "fc_quick_stash";

export const metadata: Metadata = publicMetadata({
  path: "/quick",
  title: "Five-minute quick interview: flightcheck",
  description: "A free, unscored five-minute interview from a company and role.",
});

function readStash(value: string | undefined): { company: string; role: string } {
  if (!value) return { company: "", role: "" };
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      const item = parsed as { company?: unknown; role?: unknown };
      if (typeof item.company === "string" && typeof item.role === "string") {
        return { company: item.company.slice(0, 120), role: item.role.slice(0, 120) };
      }
    }
  } catch {}
  return { company: "", role: "" };
}

const ERRORS: Record<string, React.ReactNode> = {
  invalid: "Enter a company and role, using no more than 120 characters for each.",
  "rate-limit": "Too many attempts just now. Try again in a moment.",
  "package-locked": "Unlock or remove your current job-description package before starting a quick interview.",
  "quick-cap": (
    <>You&apos;ve used your free quick interviews. <Link href="/new" className={LINK}>Register a job description to continue</Link>.</>
  ),
};

export default async function QuickPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [viewer, params, store] = await Promise.all([getViewer(), searchParams, cookies()]);
  const stash = readStash(store.get(QUICK_STASH_COOKIE)?.value);
  const error = params.error ? ERRORS[params.error] : null;
  return (
    <Shell viewer={viewer}>
      <div className="flex flex-col gap-7 pt-4">
        <h1 className={PAGE_HEADING}>Try a five-minute interview</h1>
        <p className={SUBTLE}>
          This is five minutes of questions from the company and role alone. It is not scored and does not use research or a rubric. The full product interviews against the real job description.
        </p>
        {error ? <div className={ALARM_NOTICE}>{error}</div> : null}
        <form action={quickStart} className="flex flex-col gap-5">
          <label className="flex flex-col gap-1 text-fine">
            Company
            <input name="company" defaultValue={stash.company} maxLength={120} required className={FIELD} />
          </label>
          <label className="flex flex-col gap-1 text-fine">
            Role
            <input name="role" defaultValue={stash.role} maxLength={120} required className={FIELD} />
          </label>
          <button type="submit" className={`${PRIMARY_BUTTON} self-start`}>Start the quick interview</button>
        </form>
      </div>
    </Shell>
  );
}
