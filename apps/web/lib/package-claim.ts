// What opening a package link (/p/[token]) does, as a pure decision over
// who is looking and who owns the package. The page executes the outcome;
// this table IS the S15 policy:
//
//   login     — nobody signed in: authenticate first, then come back.
//   claim     — signed in, package unowned: first authed visitor binds it.
//   enter     — signed in and already the owner: straight through.
//   forbidden — signed in as a different account: hard 403, never a peek.
export type ClaimAction = "login" | "claim" | "enter" | "forbidden";

export function claimAction(
  viewerId: string | null,
  ownerId: string | null,
): ClaimAction {
  if (viewerId === null) return "login";
  if (ownerId === null) return "claim";
  return ownerId === viewerId ? "enter" : "forbidden";
}
