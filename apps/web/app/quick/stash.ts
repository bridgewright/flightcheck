// What a signed-out visitor typed on /quick, held across the sign-in round
// trip. The company and role are the visitor's own words, so they go in a
// short-lived httpOnly cookie and never into a query string, a redirect
// target, or page metadata (the house rule the /p/ token routes exist to
// keep).
//
// Name, path, lifetime and the encoding live here rather than beside the
// reader and the writer, because they were duplicated: the action set the
// cookie with Path=/quick and cleared it with a bare delete(name), which
// serializes without a Path and so expires a DIFFERENT cookie. The stash
// survived a successful create and pre-filled the form on the visitor's next
// visit for the rest of its ten minutes.

export const QUICK_STASH_COOKIE = "fc_quick_stash";
export const QUICK_STASH_PATH = "/quick";
export const QUICK_STASH_MAX_AGE_S = 10 * 60;

/** Both fields are the visitor's free text; the worker refuses longer. */
export const QUICK_FIELD_MAX_CHARS = 120;

export interface QuickStash {
  company: string;
  role: string;
}

export const EMPTY_STASH: QuickStash = { company: "", role: "" };

export function encodeStash(stash: QuickStash): string {
  return encodeURIComponent(JSON.stringify(stash));
}

/**
 * The cookie value back into two strings, or empty ones.
 *
 * Everything here is attacker-controlled: the cookie is set by us but arrives
 * from the client, so a value that is not a percent-encoding, not JSON, not
 * an object, or carries something other than strings has to read as "no
 * stash" rather than throw on a public page. Length is re-imposed on the way
 * out for the same reason — the cap was applied when it went in, by code that
 * did not have to be the code that put this value there.
 */
export function decodeStash(value: string | undefined): QuickStash {
  if (value === undefined || value === "") return EMPTY_STASH;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(value));
  } catch {
    return EMPTY_STASH;
  }
  if (typeof parsed !== "object" || parsed === null) return EMPTY_STASH;
  const { company, role } = parsed as { company?: unknown; role?: unknown };
  if (typeof company !== "string" || typeof role !== "string") {
    return EMPTY_STASH;
  }
  return {
    company: company.slice(0, QUICK_FIELD_MAX_CHARS),
    role: role.slice(0, QUICK_FIELD_MAX_CHARS),
  };
}
