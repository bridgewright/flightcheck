import type { Metadata } from "next";

import Shell from "@/components/Shell";
import { PRICE_DISPLAY } from "@/lib/pricing";
import { getViewer } from "@/lib/viewer";
import { REFUND_WINDOW_DAYS, SUPPORT_EMAIL, supportMailto } from "../policy";
import { LegalPage, LegalSection } from "../shared";

// The refund policy of an honest-verdict product: technical failure is our
// fault and refundable; a verdict you dislike is the product doing its job.
// The 14-day window is DECISIONS 020; it renders from app/legal/policy.ts.

export const metadata: Metadata = { title: "Refund Policy — flightcheck" };

export default async function RefundPage() {
  const viewer = await getViewer();
  return (
    <Shell viewer={viewer}>
      <LegalPage title="Refund Policy" updated="August 3, 2026">
        <LegalSection heading="Try before you pay">
          <p>
            Your first package starts as a trial with a full session — real
            interviewer, real scoring, real report. That trial exists so that
            by the time you pay {PRICE_DISPLAY}, you already know exactly what
            you are buying.
          </p>
        </LegalSection>
        <LegalSection heading="What we refund">
          <p>
            If a technical failure on our side keeps you from using what you
            paid for — sessions that will not start, audio that will not
            record, scoring that never returns — tell us within{" "}
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
            soften them to keep the money — and then no verdict would be worth
            anything. Sessions you have used, and packages that reached the
            end of their validity window, are likewise not refundable.
          </p>
        </LegalSection>
      </LegalPage>
    </Shell>
  );
}
