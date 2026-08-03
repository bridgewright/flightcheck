import type { Metadata } from "next";

import Shell from "@/components/Shell";
import {
  EXPIRY_DAYS,
  PACKAGE_SESSIONS,
  PRICE_DISPLAY,
  TRIAL_SESSIONS,
} from "@/lib/pricing";
import { getViewer } from "@/lib/viewer";
import { REFUND_WINDOW_DAYS, SUPPORT_EMAIL, supportMailto } from "../policy";
import { LegalPage, LegalSection } from "../shared";
import { publicMetadata } from "../../site";

// Terms of service in the product's own register: what you are buying, what
// we promise, what we refuse to promise. Every commercial number renders
// from lib/pricing.ts — nothing here is allowed to drift from the price the
// checkout charges.

export const metadata: Metadata = publicMetadata({
  path: "/legal/terms",
  title: "Terms of Service — flightcheck",
  description:
    "What you are buying, what we promise, and what we refuse to promise — including why an honest verdict is never grounds for a refund.",
});

export default async function TermsPage() {
  const viewer = await getViewer();
  return (
    <Shell viewer={viewer}>
      <LegalPage title="Terms of Service" updated="August 3, 2026">
        <LegalSection heading="What flightcheck is">
          <p>
            flightcheck runs live, spoken mock interviews against a specific job
            description you paste in, then scores what you said and how you said
            it. It is practice and assessment, not a placement service: we never
            promise you will pass a real interview, and we are not affiliated
            with any employer you are applying to.
          </p>
        </LegalSection>
        <LegalSection heading="What you are buying">
          <p>
            One package is tied to one job description. Your first package
            starts as a trial with {TRIAL_SESSIONS} full session so you can
            judge the product before paying. Paying {PRICE_DISPLAY} unlocks
            that same package to {PACKAGE_SESSIONS} sessions of about 20
            minutes each, usable for {EXPIRY_DAYS} days from payment. After
            those {EXPIRY_DAYS} days you can no longer start new sessions on
            the package, but every report, transcript, and recording you
            already earned stays viewable in your account.
          </p>
          <p>
            Payment is handled by our payment processor as merchant of record,
            on their hosted checkout page. We never see or store your card
            details.
          </p>
        </LegalSection>
        <LegalSection heading="The verdict is honest — that is the product">
          <p>
            Our verdicts are &ldquo;Not yet ready&rdquo;, &ldquo;Approaching&rdquo;,
            and &ldquo;Ready&rdquo;, and they mean what they say. We calibrate
            them against the bar of the role you pasted, not against what would
            feel encouraging. A verdict you disagree with — including a
            &ldquo;Not yet ready&rdquo; on your final session — is the product
            working as designed, and is not grounds for a refund (see the{" "}
            <a className="underline" href="/legal/refund">
              refund policy
            </a>
            ). If a session fails for technical reasons, that is on us: the
            refund policy covers it within {REFUND_WINDOW_DAYS} days.
          </p>
        </LegalSection>
        <LegalSection heading="Your part">
          <p>
            You need a browser with a working microphone, and sessions are
            conducted in English. Keep your sign-in link to yourself — anyone
            holding it can use your sessions. Use this hosted service for your
            own interview preparation; do not probe it, scrape it, or resell
            access to it. That restriction covers the hosted service only:
            flightcheck&apos;s source code is published separately under the
            MIT license, and nothing here takes away the rights that license
            grants you over the code — including running, modifying, and
            selling your own copy.
          </p>
        </LegalSection>
        <LegalSection heading="Changes and contact">
          <p>
            If we change these terms, the date above changes with them, and
            material changes get an email. Questions go to{" "}
            <a className="underline" href={supportMailto()}>
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        </LegalSection>
      </LegalPage>
    </Shell>
  );
}
