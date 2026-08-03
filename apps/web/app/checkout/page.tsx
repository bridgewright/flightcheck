import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import PricingBlock from "@/components/landing/PricingBlock";
import Shell from "@/components/Shell";
import { resolveActivePackage } from "@/lib/active-package";
import { ACTIVE_PACKAGE_COOKIE, packageDisplayTitle } from "@/lib/home";
import { PolarConfigError, createCheckout } from "@/lib/polar";
import { PRICE_DISPLAY } from "@/lib/pricing";
import { LABEL, LINK, MUTED, PAGE_HEADING, PRIMARY_BUTTON } from "@/lib/ui";
import type { Viewer } from "@/lib/viewer";
import { getViewer } from "@/lib/viewer";
import type { PackageSummary } from "@/lib/worker";
import { listPackagesForUser } from "@/lib/worker";

// Hosted checkout only. This page's whole job is to create a Polar checkout
// session server-side and redirect the browser to Polar's hosted page —
// Polar is the merchant of record and renders the payment form.
// NO card fields in-app, ever: this app never sees a card number, and this
// comment is the acceptance criterion (tests/checkout-pages.test.ts pins it).
//
// ?pkg=<id> selects which OWNED package the payment unlocks; the id is only
// a hint resolved against the viewer's own packages (foreign or stale ids
// fall through to the active package). The {package_id, user_id} metadata
// rides on the checkout session so order.paid can find its way back.
//
// F-43: a confirm step runs BEFORE that redirect. The in-app unlock button
// used to go from "Unlock all sessions" straight to a card form, so a paying
// customer never saw an itemized list of what they were buying or the refund
// terms — the two things the checkout patterns worth copying put on the page,
// and the two things whose absence turns a surprise into a chargeback.
// ?go=1 is the confirmed request; everything about the Polar call below it is
// unchanged from the flow that took a real payment in v0.5.

export const dynamic = "force-dynamic";

// Transactional page tied to an account — noindex.
export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

function SignedOut() {
  return (
    <Shell viewer={null}>
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <h1 className={PAGE_HEADING}>
          Sign in to unlock your package.
        </h1>
        <Link href="/login?next=/checkout" className={PRIMARY_BUTTON}>
          Sign in
        </Link>
      </div>
    </Shell>
  );
}

// One calm shape for every way checkout can fail to open. Honest about the
// two facts that matter: nothing was charged, and nothing was lost.
function CheckoutUnavailable({
  viewer,
  reason,
}: {
  viewer: Viewer;
  reason: string;
}) {
  return (
    <Shell viewer={viewer}>
      <div className="mx-auto flex w-full max-w-md flex-col pt-4">
        <h1 className={PAGE_HEADING}>
          Checkout can&apos;t open right now.
        </h1>
        <p className={`${MUTED} mt-3`}>{reason}</p>
        <p className={`${MUTED} mt-2 text-sm`}>
          Nothing was charged. Your package and its reports are unchanged.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-4">
          <Link href="/home" className={PRIMARY_BUTTON}>
            Back to your sessions
          </Link>
          <Link href="/pricing" className={`${LINK} text-sm`}>
            Pricing
          </Link>
        </div>
      </div>
    </Shell>
  );
}

// The confirm step (F-43). What unlocks, itemized, then the refund sentence,
// then the button — the same PricingBlock the landing and /pricing render, so
// the offer someone reads is the offer they are charged for, and the terms are
// where the hesitation is rather than three clicks away.
function ConfirmUnlock({
  viewer,
  pkg,
}: {
  viewer: Viewer;
  pkg: PackageSummary;
}) {
  return (
    <Shell viewer={viewer}>
      <div className="mx-auto flex w-full max-w-md flex-col items-start pt-4">
        <h1 className={PAGE_HEADING}>
          Unlock this package.
        </h1>
        <div className="mt-4">
          <div className={LABEL}>Job description</div>
          <p className="mt-1 font-medium">{packageDisplayTitle(pkg.role_title)}</p>
        </div>
        <p className={`${MUTED} mt-3 text-sm`}>
          The payment lifts the session quota on this same package. Your rubric,
          your reports, and the sessions you have already used stay where they
          are.
        </p>
        <div className="mt-7">
          <PricingBlock
            ctaLabel="Continue to payment"
            ctaHref={`/checkout?pkg=${encodeURIComponent(pkg.id)}&go=1`}
          />
        </div>
        <p className={`${MUTED} mt-5 text-sm`}>
          Payment is handled by our payment provider on their own page. This app
          never sees your card.
        </p>
      </div>
    </Shell>
  );
}

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ pkg?: string | string[]; go?: string | string[] }>;
}) {
  const viewer = await getViewer();
  if (!viewer) {
    return <SignedOut />;
  }

  const { pkg: pkgParam, go } = await searchParams;
  const cookieStore = await cookies();
  let packages: PackageSummary[];
  try {
    packages = await listPackagesForUser(viewer.id);
  } catch {
    return (
      <CheckoutUnavailable
        viewer={viewer}
        reason="The service that holds your packages is briefly unreachable. Try again in a moment."
      />
    );
  }
  const active = resolveActivePackage(
    packages,
    typeof pkgParam === "string" ? pkgParam : null,
    cookieStore.get(ACTIVE_PACKAGE_COOKIE)?.value ?? null,
  );

  if (!active) {
    return (
      <Shell viewer={viewer}>
        <div className="mx-auto flex w-full max-w-md flex-col pt-4">
          <h1 className={PAGE_HEADING}>
            Nothing to unlock yet.
          </h1>
          <p className={`${MUTED} mt-3`}>
            The {PRICE_DISPLAY} unlock applies to an existing package. Start
            with the job description you&apos;re applying to — your first
            session is a free trial.
          </p>
          <div className="mt-7">
            <Link href="/new" className={PRIMARY_BUTTON}>
              Start with a job description
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  if (active.paid_at) {
    return (
      <Shell viewer={viewer}>
        <div className="mx-auto flex w-full max-w-md flex-col pt-4">
          <h1 className={PAGE_HEADING}>
            This package is already unlocked.
          </h1>
          <p className={`${MUTED} mt-3`}>
            Every session it offers is available — there is nothing to pay for
            here.
          </p>
          <div className="mt-7">
            <Link href="/home" className={PRIMARY_BUTTON}>
              Back to your sessions
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  // Everything above this line describes a package that cannot be paid for.
  // Only a confirmed request goes on to create a checkout session, so an
  // accidental navigation, a prefetch, or a back button never opens one.
  if (go !== "1") {
    return <ConfirmUnlock viewer={viewer} pkg={active} />;
  }

  // The success URL must be absolute for Polar; derive it from the request
  // so the same build works on every deployment host.
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  const proto = requestHeaders.get("x-forwarded-proto") ?? "https";
  if (!host) {
    return (
      <CheckoutUnavailable
        viewer={viewer}
        reason="This request carried no host, so the return address for the payment page can't be built."
      />
    );
  }

  let checkoutUrl: string;
  try {
    const checkout = await createCheckout({
      packageId: active.id,
      userId: viewer.id,
      successUrl: `${proto}://${host}/checkout/success?pkg=${encodeURIComponent(active.id)}`,
    });
    checkoutUrl = checkout.url;
  } catch (err) {
    console.error("checkout: Polar session create failed", err);
    return (
      <CheckoutUnavailable
        viewer={viewer}
        reason={
          err instanceof PolarConfigError
            ? "Payments aren't switched on for this deployment yet."
            : "The payment provider didn't accept the request. Try again in a moment."
        }
      />
    );
  }
  // Off to Polar's hosted page — outside the try so the redirect signal is
  // never swallowed as a failure.
  redirect(checkoutUrl);
}
