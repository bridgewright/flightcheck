import { companyMarkHost, faviconUrl } from "@/lib/company-mark";
import { getViewer } from "@/lib/viewer";
import { listPackagesForUser } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The employer's favicon, served from our own origin (F-54).
//
// Why a proxy at all, when an <img> could point straight at the employer:
// `img-src` is `'self' data: blob:`, and this product renders model output.
// Widening the policy to `https:` so a 16px icon can load would hand every
// future injected <img> a way to signal out, which is a bad trade for a
// decoration. Proxying keeps the policy exactly as tight as it is.
//
// Why this is not an open fetcher, which is the usual cost of a proxy: THE
// CALLER CANNOT NAME A HOST. The route takes a package id, reads that
// package's own stored jd_url, and vets it with the same rule the card used.
// A signed-in customer can therefore cause exactly one request per package
// they own, to a domain they themselves pasted, which the worker already
// fetched once at compile time.
//
// Everything that can go wrong ends as 404: no URL, a job board, a timeout, a
// redirect, a non-image, an oversized file. The card hides the element on
// error, so a failure is an absent mark rather than a broken one.

const FETCH_TIMEOUT_MS = 2_000;
const MAX_BYTES = 100_000;
const CACHE_SECONDS = 60 * 60 * 24;

function notFound(): Response {
  return new Response(null, { status: 404 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ packageId: string }> },
): Promise<Response> {
  const { packageId } = await params;
  const viewer = await getViewer();
  if (!viewer) return notFound();

  let jdUrl: string | null | undefined;
  try {
    const owned = await listPackagesForUser(viewer.id);
    const pkg = owned.find((candidate) => candidate.id === packageId);
    // A package this account does not own is indistinguishable from one that
    // does not exist, same as everywhere else in the product.
    if (!pkg) return notFound();
    jdUrl = pkg.jd_url;
  } catch {
    return notFound();
  }

  const host = companyMarkHost(jdUrl);
  if (host === null) return notFound();

  let upstream: Response;
  try {
    upstream = await fetch(faviconUrl(host), {
      // `manual` rather than following: a redirect is how a vetted host hands
      // the request to one that was never vetted.
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "image/*" },
      cache: "no-store",
    });
  } catch {
    return notFound();
  }
  if (!upstream.ok) return notFound();

  const type = upstream.headers.get("content-type") ?? "";
  // Some servers answer a missing favicon with 200 and an HTML error page.
  if (!type.startsWith("image/")) return notFound();

  const declared = Number(upstream.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) return notFound();
  const bytes = new Uint8Array(await upstream.arrayBuffer());
  // Checked again after reading: content-length is a claim, not a fact.
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return notFound();

  return new Response(bytes, {
    headers: {
      "content-type": type,
      "cache-control": `private, max-age=${CACHE_SECONDS}`,
      // The bytes come from a third party. Nothing may execute or frame them.
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
    },
  });
}
