import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PRODUCT_TOML = fileURLToPath(new URL("../../../services/scorer/config/product.toml", import.meta.url));
const REALTIME_TS = fileURLToPath(new URL("../lib/realtime.ts", import.meta.url));
const WEBROOM_SERVER = fileURLToPath(new URL("../../../services/scorer/src/scorer/webroom/server.py", import.meta.url));

function tomlTable(source: string, table: string): Record<string, string | number> {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.trim() === `[${table}]`);
  if (start === -1) throw new Error(`no [${table}] table in product.toml`);
  const values: Record<string, string | number> = {};
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) break;
    const match = /^([A-Za-z0-9_]+)\s*=\s*(?:"([^"]+)"|(\d+))\s*$/.exec(trimmed);
    if (match) values[match[1]] = match[2] ?? Number(match[3]);
  }
  return values;
}

function required(source: string, pattern: RegExp, name: string): string {
  const match = pattern.exec(source);
  if (!match) throw new Error(`${name} stopped matching its source — the VAD SSOT gate stopped guarding it`);
  return match[1];
}

describe("VAD and interviewer model single source", () => {
  const productSource = readFileSync(PRODUCT_TOML, "utf-8");
  const realtime = readFileSync(REALTIME_TS, "utf-8");
  const server = readFileSync(WEBROOM_SERVER, "utf-8");
  const session = tomlTable(productSource, "session");
  const models = tomlTable(productSource, "models");

  it("matches silence duration across config, client, and harness", () => {
    expect(Number(required(realtime, /silence_duration_ms:\s*(\d+)/, "silence_duration_ms"))).toBe(session.silence_duration_ms);
    expect(Number(required(server, /^SILENCE_MS\s*=\s*(\d+)$/m, "SILENCE_MS"))).toBe(session.silence_duration_ms);
  });

  it("matches prefix padding between client and harness", () => {
    expect(Number(required(realtime, /prefix_padding_ms:\s*(\d+)/, "prefix_padding_ms"))).toBe(
      Number(required(server, /^PREFIX_PADDING_MS\s*=\s*(\d+)$/m, "PREFIX_PADDING_MS")),
    );
  });

  it("matches the configured interviewer model in the client", () => {
    expect(required(realtime, /model:\s*"(gpt-realtime[^"\n]*)"/, "interviewer model")).toBe(models.interviewer);
  });
});
