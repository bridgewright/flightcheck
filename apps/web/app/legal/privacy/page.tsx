import type { Metadata } from "next";

import Shell from "@/components/Shell";
import { getViewer } from "@/lib/viewer";
import {
  DELETION_TIMELINE_DAYS,
  SUPPORT_EMAIL,
  supportMailto,
} from "../policy";
import { LegalPage, LegalSection } from "../shared";
import { publicMetadata } from "../../site";

// Privacy policy in plain words: exactly what we hold, why we hold it, and
// how to make us delete it. The retention promise here is the same one the
// settings page and the session room's recording disclosure make — one
// policy, stated three places, drifting in none.

export const metadata: Metadata = publicMetadata({
  path: "/legal/privacy",
  title: "Privacy Policy: flightcheck",
  description:
    "Exactly what we hold, why we hold it, and how to make us delete it. Recordings exist because delivery is scored from raw audio.",
});

export default async function PrivacyPage() {
  const viewer = await getViewer();
  return (
    <Shell viewer={viewer}>
      <LegalPage title="Privacy Policy" updated="August 3, 2026">
        <LegalSection heading="What we collect">
          <p>
            Your email address (it is how you sign in; we use magic links, no
            passwords), the job description and any resume or profile text you
            paste in, the audio recordings of your sessions, the transcripts
            made from them, the reports we score from both, and your order
            history. That is the whole list. We do not run advertising
            trackers, and we do not collect anything a mock interview does not
            need.
          </p>
        </LegalSection>
        <LegalSection heading="Why recordings exist and how long we keep them">
          <p>
            Delivery scoring works on the raw audio, because pace, hesitation,
            and pronunciation are gone once speech becomes text. Replay next
            to the report is how you hear what the report describes. So
            recordings, transcripts, and reports are kept in private storage,
            tied to your account, for as long as the account exists. They are
            never public, never shared with other users, and never used
            outside producing and showing your own results.
          </p>
        </LegalSection>
        <LegalSection heading="We do not sell your data">
          <p>
            Not to advertisers, not to data brokers, not to employers, not to
            anyone. Your interview practice is between you and your
            interviewer.
          </p>
        </LegalSection>
        <LegalSection heading="Who processes it for us">
          <p>
            Running the product means a few subprocessors touch your data on
            our behalf: hosting and database providers store it, a payment
            processor (as merchant of record) handles checkout so we never see
            card details, AI model providers process session audio and
            transcripts to conduct and score your sessions, and an
            error-monitoring service receives crash reports from our servers
            and, when something fails in your browser, from your browser:
            record identifiers and stack traces, with its personal-data
            collection switched off, so no recording, transcript, or report
            content reaches it. Each receives only what its job requires.
          </p>
        </LegalSection>
        <LegalSection heading="Deleting your account and data">
          <p>
            You can delete your account yourself, from the{" "}
            <a className="underline" href="/settings">
              settings page
            </a>
            . It happens immediately and it cannot be undone: the account goes
            with every recording, transcript, report, and order attached to it.
            If something goes wrong on our side we tell you that nothing was
            deleted rather than leaving you half-removed, so you can try again.
            If you would rather we did it, or you can no longer sign in, email{" "}
            <a className="underline" href={supportMailto()}>
              {SUPPORT_EMAIL}
            </a>{" "}
            from your account address and we do it within{" "}
            {DELETION_TIMELINE_DAYS} days.
          </p>
        </LegalSection>
        <LegalSection heading="Changes and contact">
          <p>
            If this policy changes, the date above changes with it, and
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
