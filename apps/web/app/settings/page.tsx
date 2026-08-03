import Link from "next/link";

import { DELETION_TIMELINE_DAYS, deletionMailto } from "@/app/legal/policy";
import MicCheck from "@/components/MicCheck";
import OrderHistory from "@/components/OrderHistory";
import Shell from "@/components/Shell";
import { LABEL, PRIMARY_BUTTON } from "@/lib/ui";
import { getViewer } from "@/lib/viewer";

// S12. Deliberately small: account facts, the microphone check, one honest
// paragraph about recordings, the deletion intake, and sign-out. No profile
// editing, no theme toggle — those do not exist yet, and a settings page
// that hints at more than the product does would be lying. Deletion v0.5 is
// a manual mailto process and the copy says so plainly (self-serve is v0.6).

// The proxy matcher normally redirects signed-out visitors to /login before
// this renders (pinned in tests/settings-gate.test.ts). This is the fallback
// for when it does not, matching /home's convention.
function SignedOut() {
  return (
    <Shell viewer={null}>
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-balance">
          You need to sign in to manage your settings.
        </h1>
        <Link href="/login?next=/settings" className={PRIMARY_BUTTON}>
          Sign in
        </Link>
      </div>
    </Shell>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-neutral-200 pt-6 dark:border-neutral-800">
      <h2 className={LABEL}>{label}</h2>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

export default async function SettingsPage() {
  const viewer = await getViewer();
  if (!viewer) return <SignedOut />;

  return (
    <Shell viewer={viewer}>
      <div className="flex flex-col gap-8">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>

        <Section label="Account">
          <p className="text-sm">
            <span className="font-medium">{viewer.email ?? "No email on record"}</span>
          </p>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            You sign in with a magic link sent to this address. Passwordless, always.
          </p>
        </Section>

        <Section label="Order history">
          <OrderHistory userId={viewer.id} />
        </Section>

        <Section label="Audio check">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Your interviewer hears you through this microphone. Check it here before a
            session — speakers or headphones both work.
          </p>
          <MicCheck />
        </Section>

        <Section label="Data & recordings">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Your session recordings are kept in private storage, tied to your account.
            They exist so your delivery can be scored from the raw audio and so you can
            replay a session next to its report — nothing else. They are never public
            and never used outside your own reports.
          </p>
        </Section>

        <Section label="Delete account & data">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Deletion is a manual process right now: email us from your account
            address and within {DELETION_TIMELINE_DAYS} days we delete the
            account with every recording, transcript, report, and order
            attached to it — then confirm by reply. The email below arrives
            with the request prefilled.
          </p>
          <a
            href={deletionMailto(viewer.email)}
            className="self-start rounded-md border border-neutral-300 px-4 py-1.5 text-sm dark:border-neutral-700"
          >
            Request deletion by email
          </a>
        </Section>

        <Section label="Sign out">
          <form action="/auth/signout" method="POST">
            <button
              type="submit"
              className="rounded-md border border-neutral-300 px-4 py-1.5 text-sm dark:border-neutral-700"
            >
              Sign out
            </button>
          </form>
        </Section>
      </div>
    </Shell>
  );
}
