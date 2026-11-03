import { describe, expect, it } from "vitest";
import { SlowTickLog } from "../src/runtimeStats";
import { TickProfile } from "../src/sim/tickProfile";

describe("slow-tick log", () => {
  it("writes at most one line per gap and counts what it held back", () => {
    const lines: string[] = [];
    const log = new SlowTickLog((l) => lines.push(l), 1000);
    log.note(0, { wakeMs: 30 });
    log.note(500, { wakeMs: 40 });
    log.note(900, { wakeMs: 50 });
    log.note(1000, { wakeMs: 60 });
    expect(lines.map((l) => JSON.parse(l.replace("[slow-tick] ", "")))).toMatchObject([{ wakeMs: 30 }, { wakeMs: 60, suppressed: 2 }]);
    expect(log.recent.map((r) => r.wakeMs)).toEqual([30, 60]);
  });

  it("sums laps by label and lists the large ones largest first", () => {
    const p = new TickProfile();
    p.laps.set("vision", 3.04).set("inputs", 0.2).set("projectiles", 7.96);
    expect(p.top(0.5)).toEqual({ projectiles: 8, vision: 3 });
    expect(Object.keys(p.top(0.5))).toEqual(["projectiles", "vision"]);
  });
});
