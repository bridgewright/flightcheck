// Pure logic behind the one irreversible action on /settings: deleting the
// account (F-34). JSX-free and free of any server-only import, so vitest
// exercises it directly and the client component that renders the form may
// import it too.
//
// It also held the sign-in-address change (F-35) until DECISIONS 036 made
// Google the only door — the address is the Google account's now, so there
// is nothing here to change.

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
