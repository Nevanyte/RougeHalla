import { describe, expect, it } from "vitest";
import {
  classifyDuelEnd,
  histogramQuantile,
  packTiles,
  sanitizeClientPerf,
  telemetryObjectKey,
  unpackTiles,
  validateRunRecord,
  wilson95,
} from "../src/telemetry";
import { EXAMPLE_RUN } from "./fixtures/telemetryRun.example";

describe("telemetry contract", () => {
  it("wilson95 matches the textbook interval", () => {
    const c = wilson95(50, 100);
    expect(c.rate).toBe(0.5);
    expect(c.lo).toBeCloseTo(0.4038, 3);
    expect(c.hi).toBeCloseTo(0.5962, 3);
    expect(wilson95(0, 0)).toEqual({ n: 0, k: 0, rate: 0, lo: 0, hi: 1 });
    expect(wilson95(10, 10).hi).toBe(1);
  });

  it("tiles round-trip through base64 of every length", () => {
    for (let n = 0; n < 9; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 5) & 255);
      expect(Array.from(unpackTiles(packTiles(bytes)) ?? [])).toEqual(Array.from(bytes));
    }
    expect(unpackTiles("abc")).toBeNull();
    expect(Array.from(unpackTiles(EXAMPLE_RUN.players[0].tiles!)!)).toEqual([20, 30, 21, 30, 22, 30]);
  });

  it("classifies a segment's end with downs first", () => {
    const base = { downA: false, downB: false, quit: false, teleport: false, runEnd: false, gapExpired: false };
    expect(classifyDuelEnd({ ...base, downB: true, creditB: "pair" })).toEqual({ outcome: "kill", winner: 0 });
    expect(classifyDuelEnd({ ...base, downA: true, creditA: "mob", quit: true })).toEqual({ outcome: "thirdParty", winner: 1 });
    expect(classifyDuelEnd({ ...base, downA: true, creditA: "arena" })).toEqual({ outcome: "hazard", winner: 1 });
    expect(classifyDuelEnd({ ...base, downA: true, downB: true })).toEqual({ outcome: "trade", winner: -1 });
    expect(classifyDuelEnd({ ...base, gapExpired: true })).toEqual({ outcome: "disengage", winner: -1 });
    expect(classifyDuelEnd(base)).toBeNull();
  });

  it("validates the example and refuses a broken copy", () => {
    expect(validateRunRecord(EXAMPLE_RUN)).toBeNull();
    expect(validateRunRecord({ ...EXAMPLE_RUN, runId: "x" })).toBe("runId");
    expect(validateRunRecord(JSON.parse(JSON.stringify(EXAMPLE_RUN)))).toBeNull();
  });

  it("keys raw objects by build and UTC day", () => {
    expect(telemetryObjectKey("abc", Date.UTC(2026, 10, 2, 23, 59), EXAMPLE_RUN.runId)).toBe(
      `telemetry/v1/build=abc/date=2026-11-02/${EXAMPLE_RUN.runId}.json.gz`,
    );
    expect(telemetryObjectKey("../x", 0, EXAMPLE_RUN.runId)).toContain("build=unknown/");
  });

  it("clamps client perf and drops junk", () => {
    expect(sanitizeClientPerf({ v: 1, fpsP50: 1e9, rttP50: Number.NaN, ua: "netscape", extra: 1 })).toEqual({ v: 1, fpsP50: 1000 });
    expect(sanitizeClientPerf({ v: 2 })).toBeNull();
    expect(histogramQuantile([0, 10, 0, 0], 1, 0.5)).toBe(1.5);
    expect(histogramQuantile([0, 0], 1, 0.5)).toBeNull();
  });
});
