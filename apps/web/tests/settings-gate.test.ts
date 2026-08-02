import { describe, expect, it } from "vitest";

// The settings screen leans on two pieces of infrastructure it does not own:
// the proxy matcher (which redirects signed-out visitors to /login before the
// page renders) and the POST /auth/signout route (which its sign-out form
// posts to). Neither is exercised anywhere a settings regression would
// surface, so these tests pin both — if the matcher drops /settings or the
// signout route moves, this fails instead of the screen quietly ungating.

import { POST as signOut } from "@/app/auth/signout/route";
import { config as proxyConfig } from "@/proxy";

describe("settings screen infrastructure", () => {
  it("keeps /settings behind the auth proxy matcher", () => {
    expect(proxyConfig.matcher).toContain("/settings/:path*");
  });

  it("exposes the sign-out endpoint the settings form posts to", () => {
    expect(typeof signOut).toBe("function");
  });
});
