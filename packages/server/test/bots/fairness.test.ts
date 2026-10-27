// The fair-information contract, metamorphically (docs/BOTS.md 3.7): over 200 seeded scenarios, change only what a human
// at the bot's seat cannot see and require the Percepts to stay byte-identical; change what it can see and require them
// to move (so the comparison is not blind itself); and a fighter never on screen and never announced never shows up at all.
// The whole-brain version reuses fairnessKit.ts unchanged with a `run` that returns the brain's commands.
import { describe, expect, it } from "vitest";
import {
  assertBlind, buildScenario, cloneScenario, createNeverSeenTracker, firstDiff, IN_PROCESS, PERTURBATIONS, perturbed, runPerception,
  stableJson, type Perturbation, type Scenario,
} from "./fairnessKit";
import type { Percept } from "../../src/bots/brain/types";

const SEEDS = 200;
const NETWORK = { selfDelayMs: 0, worldDelayMs: 100 } as const;

const scenarios: Scenario[] = Array.from({ length: SEEDS }, (_, i) => buildScenario(i + 1));
const baselines = new Map<Scenario, Percept[]>();
const baseline = (s: Scenario): Percept[] => {
  let b = baselines.get(s);
  if (!b) baselines.set(s, (b = runPerception(s)));
  return b;
};
const inProcess = (s: Scenario): Percept[] => runPerception(s, IN_PROCESS);
const network = (s: Scenario): Percept[] => runPerception(s, NETWORK);

/** The scenario's own data (Maps included), to tell whether a perturbation changed anything at all. */
const raw = (s: Scenario): string => JSON.stringify(s.frames, (_k, v) => (v instanceof Map ? [...v] : v));
const memo = <T>(f: (s: Scenario) => T) => {
  const cache = new Map<Scenario, T>();
  return (s: Scenario): T => {
    if (!cache.has(s)) cache.set(s, f(s));
    return cache.get(s)!;
  };
};
const rawBase = memo(raw);
const baseJson = memo((s) => stableJson(baseline(s)));
const baseJsonNoTag = memo((s) => stableJson(baseline(s), true));

describe("percepts are blind to hidden information", () => {
  for (const p of PERTURBATIONS) {
    it(p.name, () => {
      let changed = 0;
      for (const s of scenarios) {
        const copy = perturbed(s, p, 0);
        const got = stableJson(inProcess(copy), p.tagOnly), want = p.tagOnly ? baseJsonNoTag(s) : baseJson(s);
        if (got !== want) throw new Error(`"${p.name}" changed what the bot sees (seed ${s.seed}) ${firstDiff(want, got)}`);
        if (raw(copy) !== rawBase(s)) changed++;
        // The network driver's delays (no simulated downlink), through the kit's own check.
        if (s.seed % 10 === 0) assertBlind(network, s, p, 1);
      }
      // Never vacuous: the perturbation really changed the scenario (the hidden ones only exist with status effects).
      expect(changed).toBeGreaterThanOrEqual(p.name.startsWith("hidden") ? SEEDS / 2 - 1 : SEEDS - 1);
    });
  }

  it("each scenario yields percepts with fighters, mobs, containers, projectiles and events to compare", () => {
    let fighters = 0, mobs = 0, containers = 0, projectiles = 0, events = 0, announcements = 0;
    for (const s of scenarios) {
      const ps = baseline(s);
      expect(ps.length).toBeGreaterThanOrEqual(6);
      for (const p of ps) {
        fighters += p.fighters.length;
        mobs += p.mobs.length;
        containers += p.containers.length;
        projectiles += p.projectiles.length;
        events += p.events.length;
        announcements += p.events.filter((e) => e.kind === "death" && e.at === null).length;
      }
    }
    expect(Math.min(fighters, mobs, containers, projectiles, events, announcements)).toBeGreaterThan(SEEDS / 2);
  });
});

describe("percepts do see what a human sees (the comparison is not blind itself)", () => {
  const visible: Perturbation[] = [
    {
      name: "an on-screen fighter's hp",
      apply(s) {
        for (const f of s.frames) {
          const p = f.state.players.get("p1")!;
          p.hp = p.hp > p.maxHp / 2 ? p.maxHp * 0.2 : p.maxHp * 0.9;
        }
      },
    },
    {
      name: "an on-screen fighter's weapon in hand",
      apply(s) {
        for (const f of s.frames) {
          const p = f.state.players.get("p2")!;
          const key = p.slot === 1 ? "weapon1" : "weapon0";
          p[key] = p[key] === "shield" ? "bow" : "shield";
        }
      },
    },
    {
      name: "an off-screen mob's minimap dot",
      apply(s) { for (const f of s.frames) f.state.mobs.get("fm1")!.x += 200; },
    },
    {
      name: "the name an off-screen death announces",
      apply(s) { for (const f of s.frames) f.state.players.get("f2")!.name = "Renamed"; },
    },
    {
      name: "a [BOT] tag on screen, compared with the tag kept",
      apply(s) { for (const f of s.frames) for (const id of s.roles.onscreenPlayers) f.state.players.get(id)!.bot = !f.state.players.get(id)!.bot; },
    },
  ];
  for (const p of visible) {
    it(p.name, () => {
      let moved = 0;
      for (const s of scenarios.slice(0, 40)) {
        const a = stableJson(baseline(s)), b = stableJson(inProcess(perturbed(s, p)));
        if (a !== b) moved++;
      }
      expect(moved).toBeGreaterThanOrEqual(38);
    });
  }

  it("assertBlind reports where a leak shows", () => {
    const s = scenarios[0]!;
    expect(() => assertBlind(inProcess, s, { name: "hp", apply: (x) => { for (const f of x.frames) f.state.players.get("p1")!.hp = 1; } }, 0, baseline(s)))
      .toThrow(/"hp" changed what the bot sees \(seed 1\) @\d+/);
    expect(firstDiff("abcdef", "abcxef")).toContain("@3");
  });
});

describe("a fighter never on screen and never announced never appears", () => {
  it("not by id, not by name, in any percept: far players, fighters in the margin band, hidden ones, far containers", () => {
    let percepts = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const s = buildScenario(seed, { quiet: true });
      const tracker = createNeverSeenTracker();
      const state = s.frames[0]!.state;
      for (const id of [...s.roles.farPlayers, ...s.roles.ringPlayers, ...s.roles.hidden]) tracker.watch(id, state.players.get(id)!.name);
      for (const id of s.roles.farContainers) tracker.watch(id, state.containers.get(id)!.label);
      for (const [i, p] of [...inProcess(s), ...network(s)].entries()) {
        tracker.scan(`seed ${seed} percept ${i}`, p);
        percepts++;
      }
      expect(tracker.hits).toEqual([]);
    }
    expect(percepts).toBeGreaterThan(600);
  });

  it("the tracker finds a watched id or name wherever it is, keys and Maps included", () => {
    const t = createNeverSeenTracker();
    t.watch("p1", "Zed");
    t.scan("a", { list: [{ id: "x" }, { by: "p1" }], effects: { Zed: 3 }, m: new Map([["k", new Set(["p1"])]]) });
    expect(t.hits).toEqual(["a.list.1.by = p1", "a.effects key Zed", "a.m.k[] = p1"]);
    const quiet = createNeverSeenTracker();
    quiet.watch("p1");
    const s = buildScenario(9, { quiet: true });
    for (const p of inProcess(s)) quiet.scan("percept", p);
    expect(quiet.hits.length).toBeGreaterThan(0);
  });

  it("perturbing a copy never touches the original scenario", () => {
    const s = scenarios[3]!;
    const before = raw(s);
    for (const p of PERTURBATIONS) perturbed(s, p, 7);
    const copy = cloneScenario(s);
    copy.frames[0]!.state.players.get("p1")!.hp = -1;
    expect(raw(s)).toBe(before);
  });
});
