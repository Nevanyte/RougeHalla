// The questBench harness is report-only and never fails CI by itself, so without this a rename in the quest runtime would
// leave it printing an empty report forever. The smoke test runs it end to end at the smallest size and fails when the
// quest runtime is not seen, no quest is offered, no row is produced or a lobby errors.
import { describe, expect, it } from "vitest";
import { cardDef, cardPower, CARDS, FACTION_IDS } from "@raid/shared";
import { PlayerState } from "@raid/shared/schema";
import {
  farmSecondsForGain, kaplanMeierMedian, marginalTimeToGain, runQuestBench, timeToGain, type PowerTimeline,
} from "../src/harness/questBench";
import { liveCardPower } from "../src/harness/questBenchPolicy";
import { buildQuestBenchReport, farmBaselineSummary } from "../src/harness/questBenchReport";
import { withNotLive } from "./support/notLive";

function timeline(over: Partial<PowerTimeline>): PowerTimeline {
  return {
    policy: "farm-only", faction: "fire", farmReference: true, duration: 10, seconds: [0, 5, 10], power: [0, 2, 4],
    end: "survived", censorAt: 10, kills: 0, ...over,
  };
}

describe("quest benchmark", () => {
  it("runs the smallest configuration end to end and reports real quest observations", () => {
    const observation = runQuestBench({ seeds: 1, players: 2, capSeconds: 20 });
    expect(observation.errors).toEqual([]);
    // 3 policies x 2 solo seats + the mixed lobby
    expect(observation.runs).toHaveLength(7);
    // Runtime detection: a rename of world.quests or of the synced offers makes these false and empty.
    expect(observation.runs.every((run) => run.questRuntime)).toBe(true);
    expect(observation.runs.every((run) => run.offers.length > 0)).toBe(true);
    expect(observation.runs.every((run) => run.ticks > 0 && run.timelines.length > 0)).toBe(true);
    const offered = new Set(observation.runs.flatMap((run) => run.offers.map((o) => o.name)));
    expect(offered.size).toBeGreaterThan(0);
    // Quest-taking policies pick up the offers they can see.
    expect(observation.runs.flatMap((run) => run.attempts).length).toBeGreaterThan(0);
    const report = buildQuestBenchReport(observation);
    expect(report).toContain("# QUESTBENCH");
    expect(report).not.toContain("(no quest observations)");
    expect(report).not.toContain("QUEST RUNTIME UNAVAILABLE");
    expect([...offered].some((name) => report.includes(`| ${name}`))).toBe(true);
    // The definitions a reader needs, so a saved report cannot be misread: the direction of the ratio, the target, the power rule.
    expect(report).toContain("BELOW 1");
    expect(report).toContain("1.0-1.35");
    expect(report).toContain("live card power");
    expect(report).toContain("Farm-only baseline");
    expect(report).toContain("Harness failures\n\nNone.");
  }, 90_000);

  it("rotates every faction through the solo seats of a five-seat configuration", () => {
    const observation = runQuestBench({ seeds: 1, players: 5, capSeconds: 1 });
    expect(observation.errors).toEqual([]);
    const solo = observation.runs.filter((run) => run.scenario !== "mixed-lobby");
    for (const policy of ["farm-only", "quest-greedy", "mixed"]) {
      const factions = new Set(solo.filter((run) => run.scenario === policy).flatMap((run) => run.timelines.map((t) => t.faction)));
      expect([...factions].sort()).toEqual([...FACTION_IDS].sort());
    }
  }, 60_000);

  it("interpolates farm time-to-gain and censors a run at its death, its stall or its end", () => {
    const t = timeline({});
    expect(farmSecondsForGain(t, 3)).toBe(7.5);
    expect(farmSecondsForGain(t, 5)).toBeNull();
    expect(timeToGain(t, 3)).toEqual({ t: 7.5, reached: true });
    expect(timeToGain(t, 5)).toEqual({ t: 10, reached: false });
    // A run that died at 4 s with the power it had flat afterwards reaches nothing it had not reached by then.
    const dead = timeline({ end: "died", censorAt: 4, power: [0, 2, 2], duration: 4, seconds: [0, 2, 4] });
    expect(timeToGain(dead, 1.5)).toEqual({ t: 1.5, reached: true });
    expect(timeToGain(dead, 3)).toEqual({ t: 4, reached: false });
  });

  it("takes the Kaplan-Meier median of censored times, null when it rests on too few runs", () => {
    const reached = (t: number) => ({ t, reached: true });
    const censored = (t: number) => ({ t, reached: false });
    expect(kaplanMeierMedian([reached(10), reached(20), reached(30)])).toBe(20);
    // Two of four died at 25 before reaching it: the plain median of the two that did would read 15, Kaplan-Meier 20.
    expect(kaplanMeierMedian([censored(25), censored(25), reached(10), reached(20)])).toBe(20);
    // Three of four died early: the one survivor's 20 s says nothing about the baseline.
    expect(kaplanMeierMedian([censored(5), censored(8), censored(9), reached(20)])).toBeNull();
    expect(kaplanMeierMedian([censored(5), censored(5)])).toBeNull();
    expect(kaplanMeierMedian([])).toBeNull();
  });

  it("measures the marginal farm time from the power the player already had", () => {
    const t = timeline({ seconds: [0, 5, 10], power: [0, 2, 4] });
    // Nothing before: the same as the plain time to gain.
    expect(marginalTimeToGain(t, 0, 3)).toEqual(timeToGain(t, 3));
    // From 2 (reached at 5 s) to 4 (reached at 10 s).
    expect(marginalTimeToGain(t, 2, 2)).toEqual({ t: 5, reached: true });
    // Never reached 6: censored at the end of the run, 5 s after it reached 2.
    expect(marginalTimeToGain(t, 2, 4)).toEqual({ t: 5, reached: false });
    // A run that never got as far as the quest's player is not at risk.
    expect(marginalTimeToGain(t, 5, 1)).toBeNull();
  });

  it("counts how the farm-only runs ended", () => {
    const summary = farmBaselineSummary([
      timeline({ end: "died", censorAt: 40, kills: 5 }),
      timeline({ end: "survived", censorAt: 300, kills: 40 }),
      timeline({ end: "stalled", censorAt: 120, kills: 10 }),
      timeline({ policy: "mixed", farmReference: false, end: "died", censorAt: 2 }),
    ]);
    expect(summary).toMatchObject({ runs: 3, survived: 1, died: 1, stalled: 1, medianEnd: 120, medianKills: 10 });
  });

  it("reads simulation build maps and leaves the cards that wait for a hook out of live power", () => {
    const live = CARDS.find((def) => def.ready === "a")!;
    const waiting = CARDS.find((def) => def.ready === "a" && def.id !== live.id)!;
    withNotLive([waiting.id], () => {
      expect(waiting.ready).toBe("b");
      expect(liveCardPower({ [waiting.id]: 3 })).toBe(0);
      const p = new PlayerState();
      p.build.set(live.id, 3);
      p.build.set(waiting.id, 3);
      expect(liveCardPower(p.build)).toBe(cardPower({ [live.id]: 3 }));
      expect(liveCardPower(p.build)).toBe(3 * cardDef(live.id)!.tier);
    });
  });
});
