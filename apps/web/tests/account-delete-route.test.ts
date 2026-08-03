// DELETE /api/account — the web half of F-34 self-serve deletion.
//
// This route is the only place in the product that destroys data on a
// customer's own click, so the ordering it enforces is the whole point:
//
//   identity from the SESSION (never from the request body)
//     -> typed confirmation must match that identity
//       -> worker deletes packages, sessions, reports, transcripts, orders
//          and the recording objects
//         -> only then is the sign-in record removed
//           -> sign out
//
// Anything that fails before the worker step must leave everything intact,
// and a worker failure must leave the sign-in record alone so the customer
// can come back and retry. The worker client and Supabase are mocked; the
// deletion fan-out itself is covered by the scorer's test_api_deletion.py.
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getUser,
  signOut,
  deleteAccount,
  adminDeleteUser,
  createAdminClient,
  MockWorkerError,
} = vi.hoisted(() => {
  class MockWorkerError extends Error {
    readonly status: number;
    readonly code: string;
    readonly detail: string | null;

    constructor(status: number, code: string, detail: string | null) {
      super(`worker DELETE /api/account failed: ${status}`);
      this.name = "WorkerError";
      this.status = status;
      this.code = code;
      this.detail = detail;
    }
  }
  const adminDeleteUser = vi.fn();
  return {
    getUser: vi.fn(),
    signOut: vi.fn(),
    deleteAccount: vi.fn(),
    adminDeleteUser,
    createAdminClient: vi.fn(() => ({ auth: { admin: { deleteUser: adminDeleteUser } } })),
    MockWorkerError,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser, signOut } }),
}));
vi.mock("@/lib/worker", () => ({ WorkerError: MockWorkerError, deleteAccount }));
vi.mock("@supabase/supabase-js", () => ({ createClient: createAdminClient }));

import { DELETE } from "@/app/api/account/route";

const ACCOUNT = { id: "user-1", email: "person@example.com" };

function request(body?: unknown): Request {
  return new Request("http://web.test/api/account", {
    method: "DELETE",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  getUser.mockResolvedValue({ data: { user: ACCOUNT }, error: null });
  signOut.mockResolvedValue({ error: null });
  deleteAccount.mockResolvedValue(undefined);
  adminDeleteUser.mockResolvedValue({ error: null });
});

describe("DELETE /api/account", () => {
  it("deletes the data, then the sign-in record, then signs out", async () => {
    const response = await DELETE(request({ confirmEmail: ACCOUNT.email }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, signInRecordRemoved: true });
    expect(deleteAccount).toHaveBeenCalledExactlyOnceWith(ACCOUNT.id);
    expect(adminDeleteUser).toHaveBeenCalledExactlyOnceWith(ACCOUNT.id);
    expect(signOut).toHaveBeenCalledTimes(1);
    // Order matters: the sign-in record is the customer's only way back to
    // retry, so it must not go until the data is provably gone.
    expect(deleteAccount.mock.invocationCallOrder[0]).toBeLessThan(
      adminDeleteUser.mock.invocationCallOrder[0],
    );
  });

  it("takes the account id from the session, never from the request", async () => {
    await DELETE(request({ confirmEmail: ACCOUNT.email, userId: "someone-else" }));

    expect(deleteAccount).toHaveBeenCalledExactlyOnceWith(ACCOUNT.id);
    expect(adminDeleteUser).toHaveBeenCalledExactlyOnceWith(ACCOUNT.id);
  });

  it("refuses an anonymous caller before anything happens", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await DELETE(request({ confirmEmail: ACCOUNT.email }));

    expect(response.status).toBe(401);
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(adminDeleteUser).not.toHaveBeenCalled();
  });

  it("refuses when the typed confirmation does not match the account", async () => {
    const response = await DELETE(request({ confirmEmail: "someone@example.com" }));

    expect(response.status).toBe(400);
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("refuses a request with no confirmation at all", async () => {
    for (const body of [undefined, {}, { confirmEmail: "" }, { confirmEmail: 7 }]) {
      const response = await DELETE(request(body));
      expect(response.status).toBe(400);
    }
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("refuses when the account has no address to confirm against", async () => {
    // Nothing to type means nothing to prove intent with. Support finishes
    // these by hand rather than the route guessing.
    getUser.mockResolvedValue({ data: { user: { id: "user-1", email: null } }, error: null });

    const response = await DELETE(request({ confirmEmail: "" }));

    expect(response.status).toBe(400);
    expect(deleteAccount).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/account when the worker refuses", () => {
  it("passes the worker's honest 'nothing was deleted' through", async () => {
    deleteAccount.mockRejectedValue(
      new MockWorkerError(
        503,
        "recordings-not-deleted",
        "we could not delete your recordings just now, so nothing was deleted and your account is unchanged. Try again in a few minutes.",
      ),
    );

    const response = await DELETE(request({ confirmEmail: ACCOUNT.email }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toContain("nothing was deleted");
    // The account must survive completely: the customer's way back in is
    // the sign-in record, and their data is still there to delete.
    expect(adminDeleteUser).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("keeps the account intact on any other worker failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      deleteAccount.mockRejectedValue(new MockWorkerError(500, "unknown", null));

      const response = await DELETE(request({ confirmEmail: ACCOUNT.email }));

      expect(response.status).toBe(502);
      expect(adminDeleteUser).not.toHaveBeenCalled();
      expect(signOut).not.toHaveBeenCalled();
      expect(await response.text()).not.toContain("500");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("keeps the account intact when the worker is unreachable", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      deleteAccount.mockRejectedValue(new Error("fetch failed"));

      const response = await DELETE(request({ confirmEmail: ACCOUNT.email }));

      expect(response.status).toBe(502);
      expect(adminDeleteUser).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("DELETE /api/account when the sign-in record survives", () => {
  it("reports the truth and still signs the customer out", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      adminDeleteUser.mockResolvedValue({ error: { message: "admin unavailable" } });

      const response = await DELETE(request({ confirmEmail: ACCOUNT.email }));
      const body = await response.json();

      // The data IS gone — claiming otherwise would send the customer
      // chasing something that no longer exists. What survived is the
      // sign-in record, and the screen says exactly that.
      expect(response.status).toBe(200);
      expect(body).toEqual({ ok: true, signInRecordRemoved: false });
      // Signed out anyway: an account with no data behind it is a hollow
      // shell, and leaving them inside it is worse than showing the door.
      expect(signOut).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("survives the admin client throwing outright", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      adminDeleteUser.mockRejectedValue(new Error("network down"));

      const response = await DELETE(request({ confirmEmail: ACCOUNT.email }));

      expect(await response.json()).toEqual({ ok: true, signInRecordRemoved: false });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("does not claim removal when the service role key is missing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;

      const response = await DELETE(request({ confirmEmail: ACCOUNT.email }));

      expect(await response.json()).toEqual({ ok: true, signInRecordRemoved: false });
      expect(createAdminClient).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
