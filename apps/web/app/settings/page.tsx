import Link from "next/link";

import { deletionMailto } from "@/app/legal/policy";
import MicCheck from "@/components/MicCheck";
import OrderHistory from "@/components/OrderHistory";
import RedeemCode from "@/components/redeem-code";
import Shell from "@/components/Shell";
import { DIVIDER, LABEL, PAGE_HEADING, PRIMARY_BUTTON, SECONDARY_BUTTON, SUB_HEADING, SUBTLE } from "@/lib/ui";
import { getViewer } from "@/lib/viewer";
import { getPackagesForUser } from "@/lib/worker";

import DeleteAccountSection from "./delete-account";

// S12. Deliberately small: account facts, the microphone check, one honest
// paragraph about recordings, the two account actions, and sign-out. No
// profile editing, no theme toggle — those do not exist yet, and a settings
// page that hints at more than the product does would be lying.
//
// v0.6 turned deletion into a real action: it runs on the customer's own
// click (F-34) instead of an email to support. It is a client component
// because it needs in-place state — a confirmation the user types — and is
// not a navigation.
//
// The v0.6 email-change section (F-35) came out with the email link
// (DECISIONS 036). Under Google sign-in the address on this account is
// Google's; a form that changed it here would leave the two disagreeing and
// still would not change how anyone signs in.

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
  const cbt = await getPackagesForUser(viewer.id).then((response) => response.cbt).catch(() => null);

  return (
    <Shell viewer={viewer}>
      <div className="flex flex-col gap-8">
        <h1 className={PAGE_HEADING}>Settings</h1>

        <Section label="Account">
          <p className="text-fine">
            <span className={SUB_HEADING}>{viewer.email ?? "No email on record"}</span>
          </p>
          <p className={SUBTLE}>
            You sign in with Google, so this is the address on that Google
            account. We never see a password. To use a different address, sign
            in with the Google account that holds it.
          </p>
        </Section>

        <Section label="Order history">
          <OrderHistory userId={viewer.id} />
        </Section>

        {cbt === null ? (
          <Section label="Beta access">
            <RedeemCode compact />
          </Section>
        ) : null}

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
