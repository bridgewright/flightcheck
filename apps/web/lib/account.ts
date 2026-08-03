// Pure logic behind the two irreversible actions on /settings: deleting the
// account (F-34) and changing the sign-in address (F-35). JSX-free and free
// of any server-only import, so vitest exercises it directly and the client
// components that render the forms may import it too.

/**
 * Everything the account deletion removes, in the customer's words. This is
 * a promise, not a summary — it mirrors services/scorer/api/deletion.py's
 * fan-out (packages, sessions with their reports and transcripts, orders,
 * and the recording objects). If that grows, this grows with it.
 */
export const ACCOUNT_DELETION_REMOVES: readonly string[] = [
  "Your interview packages and the rubrics compiled for them",
  "Every session, with its report and transcript",
  "Every recording, deleted from private storage",
  "Your order history",
  "Your sign-in record",
] as const;

function normalized(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Whether the typed confirmation matches the account's own address.
 *
 * Case and whitespace are forgiven — autofill and mobile keyboards
 * capitalise, and making people retype proves nothing about intent. An
 * account with no address on record can never match, so the delete button
 * stays disarmed rather than arming on an empty box.
 */
export function deletionConfirmationMatches(
  accountEmail: string | null,
  typed: string,
): boolean {
  const account = normalized(accountEmail);
  if (account === "") return false;
  return normalized(typed) === account;
}

// Deliberately loose: a local part, one @, a dotted domain, no whitespace.
// The real validation is the confirmation link — an address that does not
// exist simply never confirms — so this only catches obvious typos before
// they cost a round trip.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export type NewEmailCheck =
  | { ok: true; email: string }
  | { ok: false; message: string };

/**
 * Checks a requested sign-in address before it is sent to Supabase.
 *
 * The address is trimmed but NOT lowercased: the local part is the mailbox
 * owner's to capitalise. Comparison against the current address is
 * case-insensitive, because for that question the two are the same mailbox.
 */
export function validateNewEmail(
  currentEmail: string | null,
  requested: string,
): NewEmailCheck {
  const email = requested.trim();
  if (email === "") {
    return { ok: false, message: "Enter the address you want to sign in with." };
  }
  if (!EMAIL_SHAPE.test(email)) {
    return { ok: false, message: "That does not look like an email address." };
  }
  if (normalized(email) === normalized(currentEmail) && normalized(email) !== "") {
    return { ok: false, message: "That is already your sign-in address." };
  }
  return { ok: true, email };
}

/** The shape of a Supabase auth error, narrowed to what we branch on. */
export interface AuthErrorLike {
  status?: number;
  code?: string;
  message?: string;
}

export interface EmailChangeOutcome {
  kind: "pending" | "error";
  message: string;
}

const IN_USE_CODES = new Set(["email_exists", "user_already_exists"]);

function isAddressInUse(error: AuthErrorLike): boolean {
  if (error.code !== undefined && IN_USE_CODES.has(error.code)) return true;
  const message = (error.message ?? "").toLowerCase();
  return message.includes("already registered") || message.includes("already been registered");
}

/**
 * What to tell the user after `supabase.auth.updateUser({ email })` answers.
 *
 * Two honesty constraints shape this:
 *
 * 1. Success is not success. Supabase emails a confirmation link and the new
 *    address does not become the sign-in address until that link is opened.
 *    A green "Email changed" here is a lie the user discovers at their next
 *    sign-in, so the message says what is actually true right now.
 * 2. An address already attached to another account gets the SAME answer as
 *    an available one. Anything else turns this box into an existence oracle
 *    for every address on the internet. The wording is conditional ("if that
 *    address is available"), which is true in both cases rather than a
 *    comforting fiction in one of them.
 *
 * A rate limit and an unexpected failure stay honest the other way: nothing
 * was sent, so the message does not claim anything was.
 */
export function emailChangeOutcome(
  currentEmail: string | null,
  requested: string,
  error: AuthErrorLike | null,
): EmailChangeOutcome {
  if (error !== null && !isAddressInUse(error)) {
    if (error.status === 429) {
      return {
        kind: "error",
        message:
          "Too many attempts on this address. Wait a minute, then try again.",
      };
    }
    if (error.status !== undefined || error.code !== undefined || error.message) {
      return {
        kind: "error",
        message: "We could not start the change. Try again in a moment.",
      };
    }
  }
  // "every link we send", not "that link": with Supabase's secure email
  // change turned on, the CURRENT address gets a confirmation too and both
  // must be opened. Wording that covers both configurations is the only kind
  // that is true whatever the project setting happens to be.
  const tail = currentEmail
    ? `You still sign in with ${currentEmail} until you open every link we send.`
    : "Your sign-in address does not change until you open every link we send.";
  return {
    kind: "pending",
    message: `If that address is available, a confirmation link is on its way to ${requested}. ${tail}`,
  };
}
