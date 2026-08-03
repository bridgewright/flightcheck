import { describe, expect, it } from "vitest";

import {
  asPreview,
  channelLabel,
  orderedDimensions,
  readRefusal,
  weightPercent,
} from "./preview-state";
import type { RubricPreviewDimension } from "@/lib/types";

// The rubric preview widget has no render harness (environment: node), so its
// judgment lives here as pure functions and is pinned here. Two things matter
// beyond arithmetic: a refusal always produces a sentence AND an action the
// visitor can take, and a refusal we do not recognise still does.

const dim = (key: string, weight: number, channel: "content" | "delivery" = "content"):
  RubricPreviewDimension => ({ key, name: key, weight, channel });

describe("weightPercent", () => {
  it("renders a weight as a whole percent", () => {
    expect(weightPercent(0.35)).toBe(35);
    expect(weightPercent(0.125)).toBe(13);
  });

  it("never renders a negative or over-full bar", () => {
    expect(weightPercent(-0.2)).toBe(0);
    expect(weightPercent(4)).toBe(100);
    expect(weightPercent(Number.NaN)).toBe(0);
  });
});

describe("orderedDimensions", () => {
  it("puts the heaviest dimension first — the bar should read at a glance", () => {
    const ordered = orderedDimensions([dim("a", 0.2), dim("b", 0.5), dim("c", 0.3)]);
    expect(ordered.map((d) => d.key)).toEqual(["b", "c", "a"]);
  });

  it("is stable for equal weights, so the same JD reads the same way twice", () => {
    const ordered = orderedDimensions([dim("a", 0.25), dim("b", 0.25), dim("c", 0.5)]);
    expect(ordered.map((d) => d.key)).toEqual(["c", "a", "b"]);
  });

  it("does not mutate what it was given", () => {
    const input = [dim("a", 0.2), dim("b", 0.8)];
    orderedDimensions(input);
    expect(input.map((d) => d.key)).toEqual(["a", "b"]);
  });
});

describe("channelLabel", () => {
  it("names the two channels in the product's own words", () => {
    expect(channelLabel("content")).toBe("What you say");
    expect(channelLabel("delivery")).toBe("How you say it");
  });
});

describe("asPreview", () => {
  const body = {
    role_title: "Forward Deployed Product Manager",
    company: "Acme",
    dimensions: [{ key: "a", name: "A", weight: 0.6, channel: "delivery" }],
  };

  it("accepts a well-formed bar", () => {
    expect(asPreview(body)).toEqual(body);
  });

  it("normalises a blank company to null", () => {
    expect(asPreview({ ...body, company: "  " })?.company).toBeNull();
    expect(asPreview({ ...body, company: undefined })?.company).toBeNull();
  });

  it("refuses anything that is not actually a bar", () => {
    // A 200 is not a promise that the shape is right — a proxy, a login wall,
    // or a future field rename all arrive as 200. Half a bar is the one
    // dishonest thing this widget could render, so it renders none.
    for (const bad of [
      null,
      "ok",
      {},
      { ...body, dimensions: [] },
      { ...body, role_title: 7 },
      { ...body, dimensions: [{ key: "a", name: "A", weight: "heavy", channel: "content" }] },
      { ...body, dimensions: [{ key: "a", name: "A", weight: 0.6, channel: "vibes" }] },
      { ...body, dimensions: [null] },
    ]) {
      expect(asPreview(bad)).toBeNull();
    }
  });
});

describe("readRefusal", () => {
  it("carries the server's sentence through unchanged", () => {
    const refusal = readRefusal({ error: "The preview is busy right now.", code: "preview-busy" });
    expect(refusal.message).toBe("The preview is busy right now.");
  });

  it("sends the visitor to sign-in when waiting would not help", () => {
    for (const code of ["preview-busy", "preview-ceiling", "preview-rate-limited"]) {
      expect(readRefusal({ error: "x", code }).action).toBe("sign-in");
    }
  });

  it("asks for an edit when the paste itself is the problem", () => {
    for (const code of ["preview-too-short", "preview-too-long"]) {
      expect(readRefusal({ error: "x", code }).action).toBe("edit");
    }
  });

  it("offers a retry only when retrying could actually work", () => {
    for (const code of ["preview-timeout", "preview-failed"]) {
      expect(readRefusal({ error: "x", code }).action).toBe("retry");
    }
  });

  it("still says something true when the body is not what we expected", () => {
    for (const body of [null, undefined, "gateway timeout", {}, { error: 7 }]) {
      const refusal = readRefusal(body);
      expect(refusal.message.length).toBeGreaterThan(0);
      expect(refusal.action).toBe("retry");
    }
  });

  it("never renders raw upstream text as if it were our copy", () => {
    // An HTML error page from a proxy must not end up in the widget.
    const refusal = readRefusal("<html><body>502 Bad Gateway</body></html>");
    expect(refusal.message).not.toContain("<html>");
  });

  it("does not mistake a prototype key for a refusal code", () => {
    // A bare `ACTIONS[code]` lookup resolves "constructor", "toString" and
    // friends up the prototype chain to a function — which reads as a KNOWN
    // code and hands the body's own sentence straight to the visitor. The
    // action it produced was not even one of the three the widget renders, so
    // the panel lost its button as well.
    for (const code of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      const refusal = readRefusal({ error: "upstream says whatever it likes", code });
      expect(refusal.message, code).not.toContain("upstream says");
      expect(["edit", "retry", "sign-in"], code).toContain(refusal.action);
    }
  });
});
