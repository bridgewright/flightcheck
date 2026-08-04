// Which domain, if any, may stand for the employer on a package card (F-54).
//
// Pure and shared: the card asks it before rendering an image element, and the
// proxy route asks it again before making a request. One rule, two callers, no
// chance of the screen offering a mark the server refuses to fetch.
//
// The product knows a company NAME, from the compiled rubric, and a name is
// not a domain. Guessing one would put another company's mark beside a
// customer's interview, so the only domain this module will accept is one the
// customer themselves pasted.

/**
 * Hosts that publish jobs for other people.
 *
 * A JD URL is a link to a posting, and most postings live on a board or an
 * applicant-tracking system rather than on the employer's own site. Their
 * favicons are real and load fine, which is exactly the problem: a Greenhouse
 * icon beside "Ode with Anthropic" does not say "posted on Greenhouse", it
 * says the employer is Greenhouse. Name only is the honest answer there.
 *
 * Suffix matching, so `boards.greenhouse.io` and `job-boards.greenhouse.io`
 * are both covered. The list is deliberately short and deliberately
 * incomplete: an unknown board slips a wrong mark onto one card, which is a
 * visible, reportable mistake, while an over-broad rule silently suppresses
 * marks nobody will ever notice are missing.
 */
const JOB_BOARDS: readonly string[] = [
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "workday.com",
  "myworkdayjobs.com",
  "smartrecruiters.com",
  "jobvite.com",
  "icims.com",
  "bamboohr.com",
  "recruitee.com",
  "workable.com",
  "teamtailor.com",
  "breezy.hr",
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "wellfound.com",
  "angel.co",
  "ycombinator.com",
  "monster.com",
  "ziprecruiter.com",
  "dice.com",
  "seek.com.au",
  "saramin.co.kr",
  "jobkorea.co.kr",
  "wanted.co.kr",
  "rocketpunch.com",
  "programmers.co.kr",
  "jumpit.co.kr",
  "notion.site",
  "notion.so",
  "google.com",
  "docs.google.com",
];

function isJobBoard(host: string): boolean {
  return JOB_BOARDS.some(
    (board) => host === board || host.endsWith(`.${board}`),
  );
}

/**
 * A host that is safe to name as a fetch target: a real public domain, not an
 * address that points back inside our own network.
 *
 * The proxy never takes a host from its caller, so this is defence in depth
 * rather than the primary control. It is still worth having: the stored
 * jd_url came from a form, and "http://169.254.169.254/" pasted as a job link
 * is exactly the shape of an attempt.
 */
function isPubliclyAddressable(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host.endsWith(".local") || host.endsWith(".internal")) return false;
  // Any bare IP literal, v4 or v6. A favicon worth showing lives on a name.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (host.includes(":") || host.startsWith("[")) return false;
  // A dotted name with a plausible TLD, and nothing exotic.
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host);
}

/**
 * The host whose favicon may stand for this package's employer, or null.
 *
 * Null is the common answer and it is not a failure: most customers paste the
 * JD text rather than a link, and most links are to job boards.
 */
export function companyMarkHost(jdUrl: string | null | undefined): string | null {
  const raw = (jdUrl ?? "").trim();
  if (raw === "") return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // https only. An http favicon would be a mixed-content fetch from our own
  // server on behalf of a page served over TLS, and the padlock is a promise.
  if (url.protocol !== "https:") return null;
  // Credentials in the URL are never a legitimate job posting, and they would
  // be sent along by the fetch.
  if (url.username !== "" || url.password !== "") return null;
  const host = url.hostname.toLowerCase();
  if (!isPubliclyAddressable(host)) return null;
  if (isJobBoard(host)) return null;
  return host;
}

/** The favicon URL for a host. Fixed scheme, fixed path: the only thing that
 * varies is the host this module already vetted. */
export function faviconUrl(host: string): string {
  return `https://${host}/favicon.ico`;
}
