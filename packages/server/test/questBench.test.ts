import { describe, expect, it } from "vitest";
import { BUFFS, buffPower } from "@raid/shared";
import { PlayerState } from "@raid/shared/schema";
import { farmSecondsForGain, runQuestBench, type PowerTimeline } from "../src/harness/questBench";
import { liveBuffPower } from "../src/harness/questBenchPolicy";
import { buildQuestBenchReport } from "../src/harness/questBenchReport";

describe("quest benchmark", () => {
  it("runs the quick configuration in process and reports real quest observations", () => {
    const observation = runQuestBench({ seeds: 1, players: 2, capSeconds: 20 });
    expect(observation.errors).toEqual([]);
    expect(observation.runs).toHaveLength(7);
    expect(observation.runs.every((run) => run.questRuntime)).toBe(true);
    expect(observation.runs.every((run) => run.offers.length > 0)).toBe(true);
    const report = buildQuestBenchReport(observation);
    expect(report).toContain("# QUESTBENCH");
    expect(report).toContain("done/attempts");
    expect(report).toContain("target is 1.0-1.35");
    expect(report).toContain("buffDef(id).needs");
    expect(report).toContain("Harness failures\n\nNone.");
  }, 60_000);

  it("interpolates farm time-to-gain and right-censors an early ending", () => {
    const timeline: PowerTimeline = {
      policy: "farm-only", farmReference: true, duration: 10, seconds: [0, 5, 10], power: [0, 2, 4],
    };
    expect(farmSecondsForGain(timeline, 3)).toBe(7.5);
    expect(farmSecondsForGain(timeline, 5)).toBeNull();
  });

  it("reads simulation buff maps and excludes status-dependent buffs from live power", () => {
    const conditional = BUFFS.find((def) => def.needs);
    const live = BUFFS.find((def) => !def.needs)!;
    expect(conditional).toBeDefined();
    expect(liveBuffPower({ [conditional!.id]: 3 })).toBe(0);
    const p = new PlayerState();
    p.buffs.set(live.id, 3);
    p.buffs.set(conditional!.id, 3);
    expect(liveBuffPower(p.buffs)).toBe(buffPower({ [live.id]: 3 }));
  });
});
