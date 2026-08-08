import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { candidateTurns, groupTurns } from "@/lib/transcript";
import type { TranscriptSegment } from "@/lib/types";

describe("turn grouping cross-language contract", () => {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "../../docs/contracts/turn-grouping.json"), "utf8")) as { cases: { name: string; segments: TranscriptSegment[]; expected_turns: unknown[]; expected_candidate_turns: unknown[] }[] };
  for (const testCase of fixture.cases) {
    it(testCase.name, () => {
      expect(groupTurns(testCase.segments)).toEqual(testCase.expected_turns);
      expect(candidateTurns(testCase.segments)).toEqual(testCase.expected_candidate_turns);
    });
  }
});
