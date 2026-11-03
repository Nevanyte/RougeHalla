import { describe, expect, it } from "vitest";
import { parseProcStatCpu, SlowTickLog, StealSampler } from "../src/runtimeStats";
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

describe("worst slow ticks", () => {
  it("keeps the slowest wakes, slowest first, including suppressed ones", () => {
    const log = new SlowTickLog(() => {}, 1000);
    [30, 190, 40, 25, 172].forEach((ms, i) => log.note(i * 10, { wakeMs: ms }));
    expect(log.worst.map((r) => r.wakeMs)).toEqual([190, 172, 40, 30, 25]);
    for (let i = 0; i < 20; i++) log.note(100 + i, { wakeMs: 26 + i });
    expect(log.worst).toHaveLength(10);
    expect(log.worst[0]!.wakeMs).toBe(190);
    expect(log.worst[9]!.wakeMs).toBe(39);
  });
});

describe("cpu steal", () => {
  const stat = (steal: number, idle: number) => `cpu  100 0 50 ${idle} 0 0 0 ${steal} 0 0\ncpu0 1 2 3 4 5 6 7 8\n`;

  it("parses the aggregate cpu line", () => {
    expect(parseProcStatCpu(stat(30, 820))).toEqual({ stealS: 0.3, totalS: 10 });
    expect(parseProcStatCpu("nonsense")).toBeNull();
    expect(parseProcStatCpu(null)).toBeNull();
  });

  it("reports steal as a share of CPU time between samples", () => {
    let text = stat(0, 850);
    const s = new StealSampler(() => text);
    s.sample(0);
    expect(s.stealPct(1000, 0)).toBeNull();
    text = stat(25, 925);
    s.sample(1000);
    expect(s.stealPct(1000, 1000)).toBe(25);
    expect(s.stealSeconds()).toBe(0.25);
  });
});
