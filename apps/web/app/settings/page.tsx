import Link from "next/link";

import { deletionMailto } from "@/app/legal/policy";
import MicCheck from "@/components/MicCheck";
import OrderHistory from "@/components/OrderHistory";
import Shell from "@/components/Shell";
import { DIVIDER, LABEL, PAGE_HEADING, PRIMARY_BUTTON, SECONDARY_BUTTON, SUB_HEADING, SUBTLE } from "@/lib/ui";
import { getViewer } from "@/lib/viewer";

import DeleteAccountSection from "./delete-account";
import EmailChangeSection from "./email-change";

// S12. Deliberately small: account facts, the microphone check, one honest
// paragraph about recordings, the two account actions, and sign-out. No
// profile editing, no theme toggle — those do not exist yet, and a settings
// page that hints at more than the product does would be lying.
//
// v0.6 turns both account actions into real ones: deletion runs on the
// customer's own click (F-34) instead of an email to support, and the
// sign-in address can be changed (F-35). Both are client components because
// both need in-place state — a confirmation the user types, an outcome that
// is honestly conditional — and neither is a navigation.

// The proxy matcher normally redirects signed-out visitors to /login before
// this renders (pinned in tests/settings-gate.test.ts). This is the fallback
// for when it does not, matching /home's convention.
function SignedOut() {
  return (
    <Shell viewer={null}>
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <h1 className={`${PAGE_HEADING} text-balance`}>
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
    <section className={`border-t pt-6 ${DIVIDER}`}>
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
        <h1 className={PAGE_HEADING}>Settings</h1>

        <Section label="Account">
          <p className="text-fine">
            <span className={SUB_HEADING}>{viewer.email ?? "No email on record"}</span>
          </p>
          <p className={SUBTLE}>
            You sign in with a magic link sent to this address. Passwordless, always.
          </p>
        </Section>

        <Section label="Change sign-in email">
          <EmailChangeSection accountEmail={viewer.email} />
        </Section>

        <Section label="Order history">
          <OrderHistory userId={viewer.id} />
        </Section>

        <Section label="Audio check">
          <p className={SUBTLE}>
            Your interviewer hears you through this microphone. Check it here before a
            session. Speakers or headphones both work.
          </p>
          <MicCheck />
        </Section>

        <Section label="Data & recordings">
          <p className={SUBTLE}>
            Your session recordings are kept in private storage, tied to your account.
            They exist so your delivery can be scored from the raw audio and so you can
            replay a session next to its report. Nothing else. They are never public
            and never used outside your own reports.
          </p>
        </Section>

        <Section label="Delete account & data">
          <DeleteAccountSection
            accountEmail={viewer.email}
            supportHref={deletionMailto(viewer.email)}
          />
        </Section>

        <Section label="Sign out">
          <form action="/auth/signout" method="POST">
            <button
              type="submit"
              className={SECONDARY_BUTTON}
            >
              Sign out
            </button>
          </form>
        </Section>
      </div>
    </Shell>
  );
}
