import type { Metadata } from "next";

import PricingBlock from "@/components/landing/PricingBlock";
import { PRICING } from "@/components/landing/copy";
import Shell from "@/components/Shell";
import { PAGE_HEADING } from "@/lib/ui";
import { getViewer } from "@/lib/viewer";
import { publicMetadata } from "../site";

// The pricing page and the landing page's pricing block are the same
// component (F-43), so the offer a visitor reads and the offer they act on
// cannot drift: same itemized unlock list, same refund sentence directly
// above the button, same numbers out of lib/pricing.ts.

export const metadata: Metadata = publicMetadata({
  path: "/pricing",
  title: "Pricing: flightcheck",
  description:
    "One package per job description: six scored sessions, per-session " +
    "reports, and a final verdict. The first session is a free trial.",
});

export default async function PricingPage() {
  const viewer = await getViewer();
  return (
    <Shell viewer={viewer}>
      <div className="flex flex-col items-center pt-4">
        <h1 className={`${PAGE_HEADING} text-center`}>{PRICING.heading}</h1>
        <div className="mt-7">
          <PricingBlock />
        </div>
      </div>
    </Shell>
  );
}
