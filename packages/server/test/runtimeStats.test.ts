import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LoopDelayWindow, parseCgroupV1, parseCgroupV2, readCgroupCpu, SampleWindow } from "../src/runtimeStats";
import { TickStats } from "../src/rooms/tickPacer";

const STAT_V2 = "usage_usec 123\nuser_usec 100\nsystem_usec 23\nnr_periods 1000\nnr_throttled 250\nthrottled_usec 4500000\nnr_bursts 0\n";

describe("cgroup cpu parsing", () => {
  it("reads v2 quota, periods and throttling", () => {
    expect(parseCgroupV2("50000 100000\n", STAT_V2)).toEqual({
      version: 2, limitCpus: 0.5, periods: 1000, throttledPeriods: 250, throttledSeconds: 4.5, throttledPct: 25,
    });
  });
  it("treats max as unlimited and a stat without throttling fields as absent", () => {
    expect(parseCgroupV2("max 100000", STAT_V2)?.limitCpus).toBeNull();
    expect(parseCgroupV2("max 100000", "usage_usec 1\n")).toBeNull();
  });
  it("reads v1 with throttled_time in ns and -1 as unlimited", () => {
    const stat = "nr_periods 10\nnr_throttled 5\nthrottled_time 2000000000\n";
    expect(parseCgroupV1("100000", "100000", stat)).toMatchObject({ version: 1, limitCpus: 1, throttledPct: 50, throttledSeconds: 2 });
    expect(parseCgroupV1("-1", "100000", stat)?.limitCpus).toBeNull();
  });
  it("reads files from a root and gives null where there are none", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cg-"));
    expect(readCgroupCpu(dir)).toBeNull();
    fs.writeFileSync(path.join(dir, "cpu.max"), "100000 100000\n");
    fs.writeFileSync(path.join(dir, "cpu.stat"), STAT_V2);
    expect(readCgroupCpu(dir)?.limitCpus).toBe(1);
    fs.rmSync(dir, { recursive: true });
  });
});

describe("SampleWindow", () => {
  it("reports percentiles over the last size samples only", () => {
    const w = new SampleWindow(100);
    expect(w.snapshot()).toBeNull();
    for (let i = 0; i < 100; i++) w.add(1000);
    for (let i = 1; i <= 100; i++) w.add(i);
    expect(w.snapshot()).toEqual({ p50: 50, p95: 95, p99: 99, max: 100, samples: 100 });
  });
  it("is exposed on TickStats", () => {
    const t = new TickStats();
    expect(t.snapshot().workMs).toBeNull();
    t.noteWork(2);
    expect(t.snapshot().workMs?.max).toBe(2);
  });
});

describe("LoopDelayWindow", () => {
  it("reports lateness over the resolution, not the interval itself", async () => {
    const w = new LoopDelayWindow(10);
    await new Promise((r) => setTimeout(r, 150));
    const s = w.snapshot();
    w.disable();
    expect(s).not.toBeNull();
    expect(s!.p50).toBeLessThan(10);
    expect(s!.max).toBeGreaterThanOrEqual(s!.p50);
  });
});
