import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { deletionConfirmationMatches } from "@/lib/account";
import { createClient } from "@/lib/supabase/server";
import { WorkerError, deleteAccount } from "@/lib/worker";

// F-34: the customer deletes their own account. Until v0.6 this was an email
// to support; the destructive part is unchanged (one shared implementation in
// the worker's api/deletion.py), what changed is who can trigger it.
//
// POST on an action path rather than DELETE on the resource, for the same
// reason Phase 0 gave the worker endpoint a query parameter instead of a
// body: a DELETE carrying a body is accepted unevenly by proxies and
// clients. The typed confirmation has to ride in a body — it is the
// customer's own address, which has no business in a URL that access logs
// keep — so the method has to be one that carries bodies everywhere. Every
// other action route in this app is POST + JSON too.
//
// The order here is the safety property, not an implementation detail:
//
//   1. identity comes from the SESSION — never from the request body, so
//      there is no id to tamper with and no account but your own to delete;
//   2. the typed confirmation must match that identity;
//   3. the worker removes packages, sessions (reports and transcripts are
//      columns on them), orders, and the recording objects;
//   4. only then does the sign-in record go;
//   5. sign out.
//
// Steps 3 and 4 are ordered that way because the sign-in record is the
// customer's only way back. If the worker refuses — which it does, honestly,
// when a recording will not delete — the account is completely intact and
// they can retry. Removing the sign-in record first would strand them
// outside a live account with live data and no way to ask again.

interface DeleteBody {
  confirmEmail?: unknown;
}

const CONFIRMATION_MISMATCH =
  "That is not the address on this account, so nothing was deleted.";
const WORKER_UNREACHABLE =
  "We could not reach the service that holds your data, so nothing was deleted. Try again in a few minutes.";

/**
 * Removes the Supabase auth user. Returns whether it is actually gone.
 *
 * This runs with the service-role key because Supabase has no self-delete
 * for a normal user; the authorization is the caller's own session, checked
 * above, and the id is the session's own. Every failure mode answers false
 * rather than throwing: at this point the customer's data is already gone,
 * and a 500 here would tell them their deletion failed when it did not.
 */
async function removeSignInRecord(userId: string): Promise<boolean> {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error("account delete: service role credentials missing");
    return false;
  }
  try {
    const admin = createAdminClient(url, serviceRoleKey);
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      console.error("account delete: auth user removal failed", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("account delete: auth user removal threw", err);
    return false;
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as DeleteBody;
  const confirmEmail =
    typeof body.confirmEmail === "string" ? body.confirmEmail : "";
  // An account with no address on record can never match, so it can never
  // delete itself here. Support finishes those by hand rather than this
  // route inventing a way to prove intent.
  if (!deletionConfirmationMatches(user.email ?? null, confirmEmail)) {
    return NextResponse.json({ error: CONFIRMATION_MISMATCH }, { status: 400 });
  }

  try {
    await deleteAccount(user.id);
  } catch (err) {
    // One worker refusal is meant for the customer: the honest "nothing was
    // deleted, your account is unchanged" when a recording will not release.
    // It is passed through verbatim, matched on the machine-readable code so
    // no other worker message (a 401 about OUR bearer token, say) can ever
    // reach a browser by accident.
    if (
      err instanceof WorkerError &&
      err.status === 503 &&
      err.code === "recordings-not-deleted" &&
      err.detail
    ) {
      return NextResponse.json({ error: err.detail }, { status: 503 });
    }
    console.error("account delete: worker deletion failed", err);
    return NextResponse.json({ error: WORKER_UNREACHABLE }, { status: 502 });
  }

  const signInRecordRemoved = await removeSignInRecord(user.id);
  // Signed out either way. The data is gone, so what is left of the account
  // is a shell — leaving the customer inside it would be the misleading
  // outcome, not the honest one. The screen tells them which of the two
  // happened, and the false case comes with the support address.
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true, signInRecordRemoved });
}
