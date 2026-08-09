import type { Metadata } from "next";

import {
  QUICK_SESSION_MINUTES,
  SESSION_MINUTES,
} from "@/components/landing/copy";
import Shell from "@/components/Shell";
import { PACKAGE_SESSIONS, PRICE_DISPLAY } from "@/lib/pricing";
import { getViewer } from "@/lib/viewer";
import { REFUND_WINDOW_DAYS, SUPPORT_EMAIL, supportMailto } from "../policy";
import { LegalPage, LegalSection } from "../shared";
import { publicMetadata } from "../../site";

// The refund policy of an honest-verdict product: technical failure is our
// fault and refundable; a verdict you dislike is the product doing its job.
// The 14-day window is DECISIONS 020; it renders from app/legal/policy.ts.

export const metadata: Metadata = publicMetadata({
  path: "/legal/refund",
  title: "Refund Policy: flightcheck",
  description:
    "Technical failure on our side is refundable. A verdict you did not like is not, and that is what makes the verdicts worth anything.",
});

export default async function RefundPage() {
  const viewer = await getViewer();
  return (
    <Shell viewer={viewer}>
      <LegalPage title="Refund Policy" updated="August 3, 2026">
        <LegalSection heading="Try before you pay">
          <p>
            A {QUICK_SESSION_MINUTES}-minute quick interview from a company
            name and a role is free: a real interviewer, a real conversation,
            no card. It is not scored. Registering the job description you are
            applying to and reading the rubric it compiles is also free, and
            that rubric is the bar you would be held to. What {PRICE_DISPLAY}
            buys is the {PACKAGE_SESSIONS} scored {SESSION_MINUTES}-minute
            sessions, so by the time you pay you have heard the interviewer
            and seen the bar.
          </p>
        </LegalSection>
        <LegalSection heading="What we refund">
          <p>
            If a technical failure on our side keeps you from using what you
            paid for (sessions that will not start, audio that will not
            record, scoring that never returns), tell us within{" "}
            {REFUND_WINDOW_DAYS} days of payment and we will fix it or refund
            you. Write to{" "}
            <a className="underline" href={supportMailto()}>
              {SUPPORT_EMAIL}
            </a>{" "}
            from your account address with roughly when it happened; refunds
            go back through our payment processor to your original payment
            method.
          </p>
        </LegalSection>
        <LegalSection heading="What we do not refund">
          <p>
            The verdict itself is never grounds for a refund. flightcheck
            exists to tell you the truth about whether you would pass, and
            &ldquo;Not yet ready&rdquo; is often that truth. If a disappointing
            verdict were refundable, you would have to wonder whether we
            soften them to keep the money, and then no verdict would be worth
            anything. Sessions you have used, and packages that reached the
            end of their validity window, are likewise not refundable.
          </p>
        </LegalSection>
      </LegalPage>
    </Shell>
  );
}
