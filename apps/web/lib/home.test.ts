import { describe, expect, it } from "vitest";

import {
  NAV_TABS,
  activeNavTab,
  checkoutHref,
  effectiveTotalSessions,
  exhaustedSessionsLine,
  expiryLine,
  expiryRemainingDays,
  formatOrderAmount,
  formatOrderDate,
  formatSessionDate,
  greetingName,
  isUnpaidTrial,
  journeyLegs,
  latestVerdict,
  nextSessionNumber,
  orderStatusLabel,
  packageDisplayTitle,
  packagePill,
  scoringStageLine,
  switchHref,
  unlockCtaLabel,
  verdictLine,
  verdictPhrase,
} from "@/lib/home";
import type { JourneySession } from "@/lib/home";
import type { DimensionScore, SessionReport, Verdict } from "@/lib/types";

function sessions(...pairs: [number, JourneySession["status"]][]): JourneySession[] {
  return pairs.map(([index, status]) => ({ index, status }));
}

function dimensionScore(key: string, score: number): DimensionScore {
  return {
    dimension_key: key,
    score,
    evidence_quotes: [],
    rationale: "",
    strengths: [],
    weaknesses: [],
  };
}

function report(verdict: Verdict, dimensionScores: DimensionScore[]): SessionReport {
  return {
    session_id: "sess-1",
    verdict,
    headline: "",
    eligibility: "scored",
    overall_score: 3.4,
    dimension_scores: dimensionScores,
    delivery_metrics: {
      wpm_overall: 140,
      wpm_timeline: [],
      silence_events: [],
      filler_count: 0,
      filler_rate_per_min: 0,
      f0_variance: null,
      avg_response_latency_s: null,
    },
    delivery_observations: [],
    strengths: [],
    gaps: [],
    next_drills: [],
    limits_note: "",
  };
}

describe("journeyLegs", () => {
  it("points the first leg at a fresh package's first session", () => {
    expect(journeyLegs([], 6)).toEqual([
      "next",
      "todo",
      "todo",
      "todo",
      "todo",
      "todo",
    ]);
  });

  it("fills a dot for every attempted session and points at the one to create", () => {
    const legs = journeyLegs(
      sessions([1, "scored"], [2, "scoring"], [3, "scored"]),
      6,
    );
    expect(legs).toEqual(["done", "done", "done", "next", "todo", "todo"]);
  });

  it("treats a planned session as the next leg, not an attempted one", () => {
    expect(journeyLegs(sessions([1, "scored"], [2, "planned"]), 6)).toEqual([
      "done",
      "next",
      "todo",
      "todo",
      "todo",
      "todo",
    ]);
  });

  it("points at a failed session because its slot is resumed", () => {
    expect(journeyLegs(sessions([1, "scored"], [2, "failed"]), 6)).toEqual([
      "done",
      "next",
      "todo",
      "todo",
      "todo",
      "todo",
    ]);
  });

  it("points at an insufficient session because its slot is resumed", () => {
    expect(journeyLegs(sessions([1, "scored"], [2, "insufficient"]), 6)).toEqual([
      "done",
      "next",
      "todo",
      "todo",
      "todo",
      "todo",
    ]);
  });

  it("fills the dot of an insufficient session that is not the resume target", () => {
    // The attempt happened -- only the evidence fell short -- so the leg is
    // "done" once a lower slot is the resume target, mirroring "failed".
    expect(
      journeyLegs(sessions([1, "failed"], [2, "insufficient"]), 6),
    ).toEqual(["next", "done", "todo", "todo", "todo", "todo"]);
  });

  it("still fills the dot of a failed session that is not the resume target", () => {
    // The planned slot at index 1 is resumed first, so the failed session at
    // index 2 reads as an attempt that happened.
    expect(journeyLegs(sessions([1, "planned"], [2, "failed"]), 4)).toEqual([
      "next",
      "done",
      "todo",
      "todo",
    ]);
  });

  it("leaves no next leg once the package is exhausted", () => {
    const legs = journeyLegs(
      sessions(
        [1, "scored"],
        [2, "scored"],
        [3, "scored"],
        [4, "scored"],
        [5, "scored"],
        [6, "scored"],
      ),
      6,
    );
    expect(legs).toEqual(["done", "done", "done", "done", "done", "done"]);
  });

  it("ignores sessions numbered beyond the package total", () => {
    expect(journeyLegs(sessions([1, "scored"], [9, "scored"]), 3)).toEqual([
      "done",
      "next",
      "todo",
    ]);
  });
});

describe("nextSessionNumber", () => {
  it("starts a fresh package at session 1", () => {
    expect(nextSessionNumber([], 6)).toBe(1);
  });

  it("creates the session after the highest existing index", () => {
    expect(nextSessionNumber(sessions([1, "scored"], [2, "scored"]), 6)).toBe(3);
  });

  it("resumes a planned session instead of creating a new one", () => {
    expect(nextSessionNumber(sessions([1, "scored"], [2, "planned"]), 6)).toBe(2);
  });

  it("resumes a failed session because its slot is preserved", () => {
    expect(nextSessionNumber(sessions([1, "failed"], [2, "scored"]), 6)).toBe(1);
  });

  it("resumes an insufficient session exactly like a failed one", () => {
    expect(
      nextSessionNumber(sessions([1, "insufficient"], [2, "scored"]), 6),
    ).toBe(1);
  });

  it("resumes the lowest resumable slot when several are open", () => {
    expect(
      nextSessionNumber(sessions([1, "scored"], [2, "failed"], [3, "planned"]), 6),
    ).toBe(2);
  });

  it("reports an exhausted package as null", () => {
    expect(
      nextSessionNumber(
        sessions(
          [1, "scored"],
          [2, "scored"],
          [3, "scored"],
          [4, "scored"],
          [5, "scored"],
          [6, "scored"],
        ),
        6,
      ),
    ).toBeNull();
  });

  it("reports null when the next index would exceed the package total", () => {
    expect(nextSessionNumber(sessions([1, "scored"], [3, "scored"]), 3)).toBeNull();
  });
});

describe("verdictLine", () => {
  it("has nothing to say before the first report", () => {
    expect(verdictLine(null)).toBeNull();
  });

  it("names the weakest dimension and the session's focus", () => {
    const line = verdictLine(
      report("not_ready", [
        dimensionScore("ownership-impact", 3.3),
        dimensionScore("communication-delivery", 2.5),
      ]),
      { "communication-delivery": "Communication Delivery" },
    );
    expect(line?.text).toBe(
      "Last verdict: Not yet ready. Communication Delivery 2.5 — the lowest of your 2 dimensions. This session focuses there.",
    );
    expect(line?.headline).toBe("Not yet ready.");
  });

  it("humanizes a dimension key when no rubric name is available", () => {
    const line = verdictLine(
      report("approaching", [
        dimensionScore("communication-delivery", 2.5),
        dimensionScore("ownership-impact", 4.0),
      ]),
    );
    expect(line?.text).toBe(
      "Last verdict: Approaching. Communication delivery 2.5 — the lowest of your 2 dimensions. This session focuses there.",
    );
  });

  it("drops the comparison when the rubric has a single dimension", () => {
    const line = verdictLine(report("ready", [dimensionScore("communication", 4.6)]));
    expect(line?.text).toBe(
      "Last verdict: Ready. Communication 4.6. This session focuses there.",
    );
  });

  it("falls back to the verdict alone when no dimension was scored", () => {
    const line = verdictLine(report("not_ready", []));
    expect(line?.text).toBe("Last verdict: Not yet ready.");
    expect(line?.detail).toBe("");
  });
});

describe("greetingName", () => {
  it("greets an unknown viewer without a name", () => {
    expect(greetingName(null)).toBe("Welcome back.");
  });

  it("uses the local part before the first dot", () => {
    expect(greetingName("tae.hyun@example.com")).toBe("Welcome back, tae.");
  });

  it("stops at the first digit", () => {
    expect(greetingName("thk119914@gmail.com")).toBe("Welcome back, thk.");
  });

  it("lowercases the name", () => {
    expect(greetingName("TAE@example.com")).toBe("Welcome back, tae.");
  });

  it("drops the name when nothing usable is left", () => {
    expect(greetingName("119914@gmail.com")).toBe("Welcome back.");
    expect(greetingName("@example.com")).toBe("Welcome back.");
    expect(greetingName("")).toBe("Welcome back.");
  });
});

describe("formatSessionDate", () => {
  it("has nothing to show without a timestamp", () => {
    expect(formatSessionDate(null)).toBeNull();
  });

  it("formats a timestamp as a short absolute date", () => {
    expect(formatSessionDate("2026-07-30T21:41:00Z")).toBe("Jul 30");
  });

  it("ignores an unparseable timestamp", () => {
    expect(formatSessionDate("not a date")).toBeNull();
  });
});

describe("activeNavTab", () => {
  it("matches each section root exactly", () => {
    expect(activeNavTab("/home")).toBe("/home");
    expect(activeNavTab("/sessions")).toBe("/sessions");
    expect(activeNavTab("/progress")).toBe("/progress");
    expect(activeNavTab("/rubric")).toBe("/rubric");
  });

  it("keeps the section tab active on its detail pages", () => {
    expect(activeNavTab("/sessions/sess-1")).toBe("/sessions");
    expect(activeNavTab("/sessions/sess-1/room")).toBe("/sessions");
  });

  it("activates nothing on non-section pages", () => {
    expect(activeNavTab("/")).toBeNull();
    expect(activeNavTab("/packages")).toBeNull();
    expect(activeNavTab("/settings")).toBeNull();
    expect(activeNavTab(null)).toBeNull();
    expect(activeNavTab(undefined)).toBeNull();
  });

  it("requires a segment boundary, not a string prefix", () => {
    expect(activeNavTab("/homework")).toBeNull();
    expect(activeNavTab("/sessionsabc")).toBeNull();
  });

  it("covers exactly the four sections, Home first", () => {
    expect(NAV_TABS.map((tab) => tab.label)).toEqual([
      "Home",
      "Sessions",
      "Progress",
      "Role & Rubric",
    ]);
  });
});

describe("switchHref", () => {
  it("builds the /switch link with both parameters encoded", () => {
    expect(switchHref("pkg-1", "/home")).toBe("/switch?pkg=pkg-1&next=%2Fhome");
  });

  it("survives ids and paths with reserved characters", () => {
    expect(switchHref("pkg&1", "/home?pkg=x")).toBe(
      "/switch?pkg=pkg%261&next=%2Fhome%3Fpkg%3Dx",
    );
  });
});

function stageSession(
  index: number,
  status: JourneySession["status"],
  scoring_stage: string | null = null,
) {
  return { index, status, scoring_stage };
}

describe("scoringStageLine", () => {
  it("says nothing when no session is being scored", () => {
    expect(scoringStageLine([])).toBeNull();
    expect(
      scoringStageLine([stageSession(1, "scored"), stageSession(2, "planned")]),
    ).toBeNull();
  });

  it("names the session and the stage the worker reported", () => {
    expect(
      scoringStageLine([
        stageSession(1, "scored"),
        stageSession(2, "scoring", "content-judge"),
      ]),
    ).toBe("Session 02 is being scored — scoring content.");
  });

  it("translates every coarse worker stage", () => {
    const lines = [
      "download",
      "transcribe",
      "delivery-metrics",
      "content-judge",
      "delivery-judge",
      "compile",
    ].map((stage) => scoringStageLine([stageSession(3, "scoring", stage)]));
    expect(lines).toEqual([
      "Session 03 is being scored — fetching your recording.",
      "Session 03 is being scored — transcribing your answers.",
      "Session 03 is being scored — measuring delivery.",
      "Session 03 is being scored — scoring content.",
      "Session 03 is being scored — scoring delivery.",
      "Session 03 is being scored — writing your report.",
    ]);
  });

  it("stays generic when the stage is missing or unknown", () => {
    // Raw internal stage tokens must never leak into UI copy.
    expect(scoringStageLine([stageSession(2, "scoring")])).toBe(
      "Session 02 is being scored.",
    );
    expect(scoringStageLine([stageSession(2, "scoring", "some-new-stage")])).toBe(
      "Session 02 is being scored.",
    );
  });

  it("reports the newest scoring session when several exist", () => {
    expect(
      scoringStageLine([
        stageSession(1, "scoring", "transcribe"),
        stageSession(2, "scoring", "compile"),
      ]),
    ).toBe("Session 02 is being scored — writing your report.");
  });
});

function verdictSession(index: number, verdict: Verdict | null) {
  return { index, verdict };
}

describe("latestVerdict", () => {
  it("has no verdict before any scored session", () => {
    expect(latestVerdict([])).toBeNull();
    expect(latestVerdict([verdictSession(1, null)])).toBeNull();
  });

  it("returns the newest session's verdict", () => {
    expect(
      latestVerdict([
        verdictSession(1, "not_ready"),
        verdictSession(2, "approaching"),
      ]),
    ).toBe("approaching");
  });

  it("skips newer sessions that carry no verdict yet", () => {
    expect(
      latestVerdict([
        verdictSession(1, "not_ready"),
        verdictSession(2, "approaching"),
        verdictSession(3, null),
      ]),
    ).toBe("approaching");
  });
});

describe("verdictPhrase", () => {
  it("speaks the three verdicts in the product's fixed words", () => {
    expect(verdictPhrase("not_ready")).toBe("Not yet ready");
    expect(verdictPhrase("approaching")).toBe("Approaching");
    expect(verdictPhrase("ready")).toBe("Ready");
  });
});

describe("packageDisplayTitle", () => {
  it("uses the role title when the package has one", () => {
    expect(packageDisplayTitle("Deployment Strategist")).toBe(
      "Deployment Strategist",
    );
  });

  it("falls back for packages without a title", () => {
    expect(packageDisplayTitle(null)).toBe("Untitled package");
    expect(packageDisplayTitle("")).toBe("Untitled package");
    expect(packageDisplayTitle("   ")).toBe("Untitled package");
  });
});

describe("packagePill", () => {
  it("shows the compile lifecycle before anything else", () => {
    expect(packagePill("compiling", 0, 6)).toEqual({
      label: "Compiling",
      tone: "wait",
    });
    expect(packagePill("failed", 0, 6)).toEqual({
      label: "Compile failed",
      tone: "bad",
    });
  });

  it("tracks session usage once the package is ready", () => {
    expect(packagePill("ready", 0, 6)).toEqual({
      label: "Not started",
      tone: "neutral",
    });
    expect(packagePill("ready", 3, 6)).toEqual({
      label: "In progress",
      tone: "neutral",
    });
    expect(packagePill("ready", 6, 6)).toEqual({
      label: "Complete",
      tone: "done",
    });
  });

  it("treats usage beyond the quota as complete, never in progress", () => {
    expect(packagePill("ready", 7, 6)).toEqual({
      label: "Complete",
      tone: "done",
    });
  });
});

describe("exhaustedSessionsLine", () => {
  it("counts the package's own quota, not a hardcoded six", () => {
    expect(exhaustedSessionsLine(6)).toBe(
      "All 6 sessions of this package are used.",
    );
    expect(exhaustedSessionsLine(4)).toBe(
      "All 4 sessions of this package are used.",
    );
  });
});

// --- v0.5 payments: effective quota, expiry, receipts --------------------

describe("effectiveTotalSessions", () => {
  it("caps an unpaid trial at the trial quota", () => {
    expect(
      effectiveTotalSessions({ is_trial: true, paid_at: null, total_sessions: 6 }),
    ).toBe(1);
  });

  it("returns the full quota once the trial is paid", () => {
    expect(
      effectiveTotalSessions({
        is_trial: true,
        paid_at: "2026-08-03T12:00:00Z",
        total_sessions: 6,
      }),
    ).toBe(6);
  });

  it("returns the package's own quota for a non-trial", () => {
    expect(
      effectiveTotalSessions({ is_trial: false, paid_at: null, total_sessions: 4 }),
    ).toBe(4);
  });

  it("treats rows from a pre-v0.5 worker (fields absent) as not trial", () => {
    expect(effectiveTotalSessions({ total_sessions: 6 })).toBe(6);
  });
});

describe("isUnpaidTrial", () => {
  it("is true only for a trial without a payment", () => {
    expect(isUnpaidTrial({ is_trial: true, paid_at: null })).toBe(true);
    expect(isUnpaidTrial({ is_trial: true, paid_at: "2026-08-03T12:00:00Z" })).toBe(false);
    expect(isUnpaidTrial({ is_trial: false, paid_at: null })).toBe(false);
    expect(isUnpaidTrial({})).toBe(false);
  });
});

describe("unlockCtaLabel", () => {
  it("names the full session count and the price from lib/pricing", () => {
    expect(unlockCtaLabel()).toBe("Unlock all 6 sessions — $49");
  });
});

describe("checkoutHref", () => {
  it("targets /checkout with the package id encoded", () => {
    expect(checkoutHref("pkg 1/x")).toBe("/checkout?pkg=pkg%201%2Fx");
  });
});

describe("expiryRemainingDays", () => {
  const now = new Date("2026-08-03T12:00:00Z");

  it("is null when the package carries no expiry", () => {
    expect(
      expiryRemainingDays({ paid_at: "2026-08-01T00:00:00Z", expires_at: null }, now),
    ).toBeNull();
    expect(expiryRemainingDays({ paid_at: "2026-08-01T00:00:00Z" }, now)).toBeNull();
  });

  it("is null while unpaid — the window starts at payment, trials show no line", () => {
    expect(
      expiryRemainingDays(
        { is_trial: true, paid_at: null, expires_at: "2026-09-02T12:00:00Z" },
        now,
      ),
    ).toBeNull();
  });

  it("counts whole days remaining, rounding partial days up", () => {
    expect(
      expiryRemainingDays(
        { paid_at: "2026-08-03T12:00:00Z", expires_at: "2026-09-02T12:00:00Z" },
        now,
      ),
    ).toBe(30);
    expect(
      expiryRemainingDays(
        { paid_at: "2026-07-05T11:00:00Z", expires_at: "2026-08-04T11:00:00Z" },
        now,
      ),
    ).toBe(1);
  });

  it("goes to zero and below once expired", () => {
    expect(
      expiryRemainingDays(
        { paid_at: "2026-07-02T12:00:00Z", expires_at: "2026-08-01T12:00:00Z" },
        now,
      ),
    ).toBe(-2);
  });

  it("is null for an unparseable expiry date", () => {
    expect(
      expiryRemainingDays({ paid_at: "2026-08-01T00:00:00Z", expires_at: "soon" }, now),
    ).toBeNull();
  });
});

describe("expiryLine", () => {
  const now = new Date("2026-08-03T12:00:00Z");

  it("is null when no expiry applies", () => {
    expect(expiryLine({ is_trial: true, paid_at: null }, now)).toBeNull();
    expect(expiryLine({ paid_at: "2026-08-01T00:00:00Z", expires_at: null }, now)).toBeNull();
  });

  it("counts down the remaining days, singular and plural", () => {
    expect(
      expiryLine(
        { paid_at: "2026-08-03T12:00:00Z", expires_at: "2026-09-02T12:00:00Z" },
        now,
      ),
    ).toBe("30 days left on this package.");
    expect(
      expiryLine(
        { paid_at: "2026-07-05T11:00:00Z", expires_at: "2026-08-04T11:00:00Z" },
        now,
      ),
    ).toBe("1 day left on this package.");
  });

  it("says expired honestly once the window has passed", () => {
    expect(
      expiryLine(
        { paid_at: "2026-07-02T12:00:00Z", expires_at: "2026-08-01T12:00:00Z" },
        now,
      ),
    ).toBe(
      "This package has expired — reports stay available, but new sessions can't start.",
    );
  });
});

describe("formatOrderAmount", () => {
  it("renders minor units as the currency's display amount", () => {
    expect(formatOrderAmount(4900, "usd")).toBe("$49.00");
    expect(formatOrderAmount(4900, "USD")).toBe("$49.00");
  });

  it("renders a bare decimal when the currency is unknown", () => {
    expect(formatOrderAmount(1234, null)).toBe("12.34");
  });

  it("falls back without crashing on a malformed currency code", () => {
    expect(formatOrderAmount(4900, "not-a-code")).toBe("49.00 NOT-A-CODE");
  });

  it("shows an honest dash when the amount is unknown", () => {
    expect(formatOrderAmount(null, "usd")).toBe("—");
  });
});

describe("formatOrderDate", () => {
  it("renders an absolute date with the year — receipts outlive seasons", () => {
    expect(formatOrderDate("2026-08-03T12:00:00Z")).toBe("Aug 3, 2026");
  });

  it("is null for missing or unparseable dates", () => {
    expect(formatOrderDate(null)).toBeNull();
    expect(formatOrderDate("someday")).toBeNull();
  });
});

describe("orderStatusLabel", () => {
  it("capitalizes the worker's status word and dashes the unknown", () => {
    expect(orderStatusLabel("paid")).toBe("Paid");
    expect(orderStatusLabel("refunded")).toBe("Refunded");
    expect(orderStatusLabel(null)).toBe("—");
    expect(orderStatusLabel("")).toBe("—");
  });
});
