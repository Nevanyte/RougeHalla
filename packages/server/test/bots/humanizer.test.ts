// humanizer.ts (docs/BOTS.md 2.1-2.5, 3.7, 4, 9.1): when a bot clicks, what it clicks, and how often.
import { describe, expect, it } from "vitest";
import { mulberry32, WORLD_H, WORLD_W, type Vec2 } from "@raid/shared";
import { createHumanizer, HUMANIZER_RULES, type HumanizerImpl } from "../../src/bots/brain/humanizer";
import {
  PRIORITY, TIER_IDS, TIERS,
  type BrainContext, type Command, type Features, type Humanizer, type Intent, type IntentPriority, type IntentTiming,
  type Percept, type Stimulus, type StimulusKind, type TierParams, type TimedCommand,
} from "../../src/bots/brain/types";
import { InputQueue, enqueueClientMessage } from "../../src/sim/inputs";
import {
  brainConfig, container, ctx as makeCtx, features, fighter, mobView, percept, rngs, selfView, testMap,
} from "./fixtures";

const T0 = 100_000;
const NO_HESITATION = { p: 0, minMs: 0, maxMs: 0 };
const me = selfView();
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]): number => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));

interface Rig {
  readonly h: HumanizerImpl;
  /** A context at server time `now` over the rig's scene (override pieces of the percept per call). */
  at(now: number, over?: Partial<Percept>, engaged?: boolean): BrainContext;
}

function rig(tier: TierParams, opts: { seed?: number; scene?: Partial<Percept>; features?: Features } = {}): Rig {
  const cfg = brainConfig(tier.id, "hunter", { tier });
  const rng = rngs(opts.seed ?? 1);
  const h = createHumanizer({ tier, map: testMap(), features: opts.features });
  return {
    h,
    at: (now, over = {}, engaged = false) => makeCtx({ cfg, rng, engaged, p: percept({ now, ...opts.scene, ...over }) }),
  };
}

const stim = (kind: StimulusKind, at: number, over: Partial<Stimulus> = {}): Stimulus => ({ kind, at, subject: null, central: true, ...over });
const react = (s: Stimulus): IntentTiming => ({ kind: "react", stimulus: s });
const STEP: IntentTiming = { kind: "step" };

function move(to: Vec2, timing: IntentTiming, priority: IntentPriority = PRIORITY.goal): Intent {
  return { kind: "move", to, priority, timing, why: "test" };
}
function lock(target: string, timing: IntentTiming, priority: IntentPriority = PRIORITY.combat, at: Vec2 = { x: me.x + 200, y: me.y }): Intent {
  return { kind: "lock", target, at, priority, timing, why: "test" };
}
const ahead = (dx: number, dy = 0): Vec2 => ({ x: me.x + dx, y: me.y + dy });

/** Submit at `now`, release `after` ms later: the commands that came out. */
function once(r: Rig, intents: Intent[], now: number, after = 4000): readonly TimedCommand[] {
  r.h.submit(intents, r.at(now));
  return r.h.release(r.at(now + after));
}

const CORE = new Set(["move", "stop", "target", "swap", "pickup"]);
function assertAccepted(cmds: readonly TimedCommand[]): void {
  for (const c of cmds) {
    expect(["aim", "attack", "release"]).not.toContain(c.cmd.type);
    if (CORE.has(c.cmd.type)) expect(enqueueClientMessage(new InputQueue(), c.cmd.type, c.cmd.msg)).toBe(true);
  }
}

describe("reaction delay", () => {
  const expected = (id: keyof typeof TIERS) => TIERS[id].reaction.mu + TIERS[id].reaction.tau;

  it.each(TIER_IDS)("%s: the mean click delay is mu + tau within 10%, never under the floor, for a central stimulus", (id) => {
    const tier = { ...TIERS[id], hesitation: NO_HESITATION };
    const r = rig(tier);
    const delays: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const now = T0 + i * 5000;
      const out = once(r, [move(ahead(150), react(stim("newThreat", now)))], now);
      expect(out).toHaveLength(1);
      delays.push(out[0]!.at - now);
      assertAccepted(out);
    }
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(tier.reaction.floor);
    expect(Math.max(...delays)).toBeLessThanOrEqual(tier.reaction.cap);
    expect(mean(delays) / expected(id)).toBeGreaterThan(0.9);
    expect(mean(delays) / expected(id)).toBeLessThan(1.1);
    // The same samples are what the stats keep (the newest 256).
    expect(r.h.stats.reactions.newThreat).toEqual(delays.slice(-HUMANIZER_RULES.reactionSamples));
  });

  it("counts from the stimulus: one that is already old is answered at once", () => {
    const tier = { ...TIERS.normal, hesitation: NO_HESITATION };
    const r = rig(tier);
    const out = once(r, [move(ahead(150), react(stim("hpLoss", T0 - 5000)))], T0, 100);
    expect(out).toHaveLength(1);
    expect(out[0]!.at).toBe(T0);
  });

  it("a stimulus outside the attention centre takes peripheryMult longer; a new threat while fighting engagedMult more", () => {
    const tier = { ...TIERS.normal, hesitation: NO_HESITATION };
    const sample = (kind: StimulusKind, central: boolean, engaged: boolean): number => {
      const r = rig(tier, { seed: 7 });
      const ds: number[] = [];
      for (let i = 0; i < 700; i++) {
        const now = T0 + i * 5000;
        r.h.submit([move(ahead(150), react(stim(kind, now, { central })))], r.at(now, {}, engaged));
        ds.push(r.h.release(r.at(now + 4500))[0]!.at - now);
      }
      return mean(ds);
    };
    const base = sample("hpLoss", true, false);
    expect(sample("hpLoss", false, false) / base).toBeCloseTo(tier.attention.peripheryMult, 1);
    expect(sample("newThreat", true, true) / base).toBeCloseTo(tier.attention.engagedMult, 1);
    expect(sample("newThreat", true, false) / base).toBeCloseTo(1, 1);
    // Reading a text is slower than seeing a threat; the engaged multiplier is for threats only.
    expect(sample("announcement", true, true) / base).toBeCloseTo(HUMANIZER_RULES.readingMult, 1);
    expect(sample("chestUp", true, false) / base).toBeCloseTo(HUMANIZER_RULES.readingMult, 1);
  });

  it("the teleport is answered after the daze, not the reaction", () => {
    const tier = { ...TIERS.normal, hesitation: NO_HESITATION };
    const r = rig(tier);
    const ds: number[] = [];
    for (let i = 0; i < 800; i++) {
      const now = T0 + i * 5000;
      ds.push(once(r, [move(ahead(150), react(stim("teleport", now)))], now)[0]!.at - now);
    }
    expect(mean(ds) / (tier.daze.mu + tier.daze.tau)).toBeGreaterThan(0.9);
    expect(mean(ds) / (tier.daze.mu + tier.daze.tau)).toBeLessThan(1.1);
    expect(Math.min(...ds)).toBeGreaterThanOrEqual(tier.daze.floor);
  });
});

describe("step and timed intents", () => {
  it.each(TIER_IDS)("%s: a planned step is clicked step.mu + step.tau after it is decided, never under the floor", (id) => {
    const tier = { ...TIERS[id], hesitation: NO_HESITATION };
    const r = rig(tier);
    const ds: number[] = [];
    for (let i = 0; i < 1500; i++) {
      const now = T0 + i * 5000;
      ds.push(once(r, [move(ahead(150), STEP)], now)[0]!.at - now);
    }
    expect(Math.min(...ds)).toBeGreaterThanOrEqual(tier.step.floor);
    expect(mean(ds) / (tier.step.mu + tier.step.tau)).toBeGreaterThan(0.9);
    expect(mean(ds) / (tier.step.mu + tier.step.tau)).toBeLessThan(1.1);
  });

  it.each(TIER_IDS)("%s: a timed intent lands at its due time with the tier's timing sigma", (id) => {
    const tier = TIERS[id];
    const r = rig(tier);
    const errs: number[] = [];
    for (let i = 0; i < 1500; i++) {
      const now = T0 + i * 5000;
      const due = now + 2500;
      errs.push(once(r, [move(ahead(150), { kind: "timed", due })], now)[0]!.at - due);
    }
    expect(Math.abs(mean(errs))).toBeLessThan(tier.timingSigmaMs * 0.12);
    expect(sd(errs) / tier.timingSigmaMs).toBeGreaterThan(0.88);
    expect(sd(errs) / tier.timingSigmaMs).toBeLessThan(1.12);
  });

  it("never clicks before the moment it decided", () => {
    const r = rig({ ...TIERS.hard, timingSigmaMs: 5000 });
    for (let i = 0; i < 200; i++) {
      const now = T0 + i * 40_000;
      const out = once(r, [move(ahead(150), { kind: "timed", due: now + 10 })], now, 30_000);
      expect(out).toHaveLength(1);
      expect(out[0]!.at).toBeGreaterThanOrEqual(now);
    }
  });
});

describe("hesitation", () => {
  it("adds one uniform pause to the decision, and counts it", () => {
    const base = { ...TIERS.normal, hesitation: NO_HESITATION };
    const always = { ...TIERS.normal, hesitation: { p: 1, minMs: 250, maxMs: 800 } };
    const a = rig(base, { seed: 4 });
    const b = rig(always, { seed: 4 });
    for (let i = 0; i < 300; i++) {
      const now = T0 + i * 5000;
      const s = react(stim("hpLoss", now));
      const plain = once(a, [move(ahead(150), s)], now)[0]!.at;
      const paused = once(b, [move(ahead(150), s)], now)[0]!.at;
      expect(paused - plain).toBeGreaterThanOrEqual(250 - 1e-6);
      expect(paused - plain).toBeLessThanOrEqual(800 + 1e-6);
    }
    expect(b.h.stats.hesitations).toBe(300);
    expect(a.h.stats.hesitations).toBe(0);
  });

  it.each(TIER_IDS)("%s: about hesitation.p of decisions pause, once each", (id) => {
    const tier = TIERS[id];
    const r = rig(tier, { seed: 9 });
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const now = T0 + i * 6000;
      // Two intents of one decision: a single pause between them, however many clicks.
      r.h.submit([move(ahead(150), react(stim("hpLoss", now))), { kind: "swap", slot: 1, priority: PRIORITY.combat, timing: react(stim("hpLoss", now)), why: "t" }], r.at(now));
      r.h.release(r.at(now + 5500));
    }
    expect(Math.abs(r.h.stats.hesitations / N - tier.hesitation.p)).toBeLessThan(0.02);
  });
});

describe("refractory gap", () => {
  it.each(TIER_IDS)("%s: two independent decisions are at least refractoryMs apart", (id) => {
    const tier = TIERS[id];
    const r = rig(tier, { seed: 2 });
    let squeezed = 0;
    for (let i = 0; i < 600; i++) {
      const now = T0 + i * 8000;
      const a = react(stim("newThreat", now, { subject: "x" }));
      const b = react(stim("hpLoss", now));
      r.h.submit([move(ahead(150), a), { kind: "swap", slot: 1, priority: PRIORITY.combat, timing: b, why: "t" }], r.at(now));
      const out = r.h.release(r.at(now + 7500));
      expect(out).toHaveLength(2);
      const gap = out[1]!.at - out[0]!.at;
      expect(gap).toBeGreaterThanOrEqual(tier.refractoryMs - 1e-6);
      if (gap < tier.refractoryMs + 20) squeezed++;
    }
    // Two draws of the same distribution land within the gap often, so the rule was doing something.
    expect(squeezed).toBeGreaterThan(30);
  });

  it("the intents of one decision are not held apart by it, only by the minimum gap", () => {
    const tier = { ...TIERS.normal, hesitation: NO_HESITATION };
    expect(tier.minGapMs).toBeLessThan(tier.refractoryMs);
    const r = rig({ ...tier, targetScatter: { ...tier.targetScatter, sigma: 1, slipP: 0 } }, { scene: { fighters: [fighter({ id: "foe" })] } });
    const s = react(stim("newThreat", T0, { subject: "foe" }));
    const out = once(r, [
      lock("foe", s),
      { kind: "swap", slot: 1, priority: PRIORITY.combat, timing: s, why: "t" },
    ], T0);
    expect(out).toHaveLength(2);
    expect(out[1]!.at - out[0]!.at).toBe(tier.minGapMs);
  });

  it("is also kept against a decision that was already clicked", () => {
    const tier = { ...TIERS.hard, hesitation: NO_HESITATION };
    const r = rig(tier, { seed: 3 });
    let last = -Infinity;
    for (let i = 0; i < 400; i++) {
      const now = T0 + i * 40;
      r.h.submit([move(ahead(150 + (i % 5) * 40), react(stim("hpLoss", now, { subject: String(i) })))], r.at(now));
      for (const c of r.h.release(r.at(now + 1))) {
        expect(c.at - last).toBeGreaterThanOrEqual(tier.refractoryMs - 1e-6);
        last = c.at;
      }
    }
  });
});

describe("rate", () => {
  /** A noisy stream of every kind of intent in every timing, at every priority, every 50 ms for five minutes. */
  function fuzz(tier: TierParams, seed: number): { cmds: TimedCommand[]; h: Humanizer } {
    const r = rig(tier, {
      seed,
      scene: {
        fighters: [fighter({ id: "a" }), fighter({ id: "b", x: me.x + 90, y: me.y + 30 })],
        mobs: [mobView({ id: "m" })],
        containers: [container({ id: "c1", interactable: true }), container({ id: "c2", interactable: false })],
      },
    });
    const dice = mulberry32(seed + 100);
    const cmds: TimedCommand[] = [];
    const kinds: Intent["kind"][] = ["move", "move", "move", "lock", "swap", "pickup", "stop"];
    for (let now = T0; now < T0 + 300_000; now += 50) {
      const batch: Intent[] = [];
      const n = dice() < 0.6 ? 1 + Math.floor(dice() * 3) : 0;
      for (let i = 0; i < n; i++) {
        const kind = kinds[Math.floor(dice() * kinds.length)]!;
        const priority = Math.floor(dice() * 4) as IntentPriority;
        const t = dice();
        const timing: IntentTiming = t < 0.4
          ? react(stim(["newThreat", "hpLoss", "lowHp", "windupAtMe"][Math.floor(dice() * 4)] as StimulusKind, now - Math.floor(dice() * 200), { subject: String(Math.floor(dice() * 4)), central: dice() < 0.7 }))
          : t < 0.8 ? STEP : { kind: "timed", due: now + Math.floor(dice() * 600) };
        const base = { priority, timing, why: "fuzz" } as const;
        const far = dice() < 0.3;
        const to = far ? { x: me.x + (dice() < 0.5 ? 1 : -1) * (900 + dice() * 600), y: me.y + dice() * 400 } : ahead(dice() * 600 - 300, dice() * 400 - 200);
        batch.push(
          kind === "move" ? { kind, to, ...base }
            : kind === "lock" ? { kind, target: dice() < 0.5 ? "a" : "b", at: { x: me.x + 200, y: me.y }, ...base }
              : kind === "swap" ? { kind, slot: dice() < 0.5 ? 0 : 1, ...base }
                : kind === "pickup" ? { kind, container: dice() < 0.7 ? "c1" : "c2", ...base }
                  : { kind: "stop", ...base },
        );
      }
      r.h.submit(batch, r.at(now));
      cmds.push(...r.h.release(r.at(now)));
    }
    return { cmds, h: r.h };
  }

  it.each(TIER_IDS)("%s: never above apm + burst in any 60 s window, minGapMs between commands, every command acceptable", (id) => {
    const tier = TIERS[id];
    const { cmds, h } = fuzz(tier, 31);
    expect(cmds.length).toBeGreaterThan(100);
    let peak = 0;
    let lo = 0;
    for (let i = 0; i < cmds.length; i++) {
      if (i > 0) {
        expect(cmds[i]!.at - cmds[i - 1]!.at).toBeGreaterThanOrEqual(tier.minGapMs - 1e-6);
      }
      while (cmds[i]!.at - cmds[lo]!.at >= HUMANIZER_RULES.apmWindowMs) lo++;
      peak = Math.max(peak, i - lo + 1);
    }
    expect(peak).toBeLessThanOrEqual(tier.apm + tier.burst);
    // The test was pushing on the limit, not idling under it.
    expect(peak).toBeGreaterThan(tier.apm * 0.5);
    expect(h.stats.apmPeak).toBe(peak);
    expect(h.stats.throttled + h.stats.superseded).toBeGreaterThan(0);
    for (let i = 1; i < cmds.length; i++) expect(cmds[i]!.at - cmds[i - 1]!.at).toBeLessThan(1e7);
    let burst1s = 0;
    for (let i = 0, j = 0; i < cmds.length; i++) {
      while (cmds[i]!.at - cmds[j]!.at >= 1000) j++;
      burst1s = Math.max(burst1s, i - j + 1);
    }
    expect(burst1s).toBeLessThanOrEqual(100);
    assertAccepted(cmds);
    const total = Object.values(h.stats.commands).reduce((a, b) => a + b, 0);
    expect(total).toBe(cmds.length);
  });

  it("every command stays inside the contract: core types only, finite points in the world, real container ids", () => {
    const { cmds } = fuzz(TIERS.hard, 32);
    for (const c of cmds) {
      expect(["move", "stop", "target", "swap", "pickup"]).toContain(c.cmd.type);
      if (c.cmd.type === "move") {
        expect(c.cmd.msg.x).toBeGreaterThanOrEqual(0);
        expect(c.cmd.msg.x).toBeLessThanOrEqual(WORLD_W);
        expect(c.cmd.msg.y).toBeGreaterThanOrEqual(0);
        expect(c.cmd.msg.y).toBeLessThanOrEqual(WORLD_H);
      }
      if (c.cmd.type === "pickup") expect(c.cmd.msg.containerId).toBe("c1");
      if (c.cmd.type === "target") expect(["a", "b", "m"]).toContain(c.cmd.msg.id);
    }
  });

  it("a starved intent waits for a token and is dropped after 1.5 s; the most urgent goes first", () => {
    // One token, one every 10 s: the second intent of a pair cannot go in time.
    const tier = { ...TIERS.normal, apm: 6, burst: 1, minGapMs: 100, hesitation: NO_HESITATION };
    const r = rig(tier, { scene: { containers: [container({ id: "c1", interactable: true })] } });
    const s = react(stim("hpLoss", T0));
    r.h.submit([
      { kind: "swap", slot: 1, priority: PRIORITY.chore, timing: s, why: "t" },
      { kind: "pickup", container: "c1", priority: PRIORITY.reflex, timing: s, why: "t" },
    ], r.at(T0));
    const first = r.h.release(r.at(T0 + 1000));
    expect(first.map((c) => c.cmd.type)).toEqual(["pickup"]);
    expect(r.h.stats.throttled).toBe(0);
    expect(r.h.release(r.at(T0 + 1000 + 2000))).toEqual([]);
    expect(r.h.stats.throttled).toBe(1);
    // The token comes back later, but the swap is gone: nothing is sent then either.
    expect(r.h.release(r.at(T0 + 30_000))).toEqual([]);
  });

  it("under starvation reflex beats combat beats goal beats chore", () => {
    // One token every 5 s: of three intents due together only the most urgent goes, and the others starve.
    const tier = { ...TIERS.normal, apm: 12, burst: 1, minGapMs: 50, hesitation: NO_HESITATION };
    const { chore, goal, combat, reflex } = PRIORITY;
    // [swap, pickup, move priorities] -> the one that goes
    const cases: ReadonlyArray<readonly [IntentPriority, IntentPriority, IntentPriority, string]> = [
      [chore, goal, combat, "move"], [combat, chore, goal, "swap"], [goal, reflex, chore, "pickup"],
    ];
    for (const [ps, pp, pm, winner] of cases) {
      const r = rig(tier, { scene: { containers: [container({ id: "c1", interactable: true })] } });
      const s = react(stim("hpLoss", T0));
      r.h.submit([
        { kind: "swap", slot: 1, priority: ps, timing: s, why: "t" },
        { kind: "pickup", container: "c1", priority: pp, timing: s, why: "t" },
        move(ahead(100), s, pm),
      ], r.at(T0));
      expect(r.h.release(r.at(T0 + 12_000)).map((x) => x.cmd.type)).toEqual([winner]);
      expect(r.h.stats.throttled).toBe(2);
    }
  });
});

describe("dedupe and channels", () => {
  it("an equal intent keeps its scheduled time and sends one command", () => {
    const tier = TIERS.normal;
    const s = stim("newThreat", T0, { subject: "foe" });
    const control = rig(tier, { seed: 5 });
    const want = once(control, [move(ahead(150), react(s))], T0);

    const r = rig(tier, { seed: 5 });
    r.h.submit([move(ahead(150), react(s))], r.at(T0));
    // Tactics repeats itself every think, with the point jittering inside 6 u, and with a different stimulus.
    for (let k = 1; k <= 3; k++) r.h.submit([move(ahead(150 + k * 1.5, k), react(stim("hpLoss", T0 + 40 * k)))], r.at(T0 + 40 * k));
    const got = r.h.release(r.at(T0 + 4000));
    expect(got).toHaveLength(1);
    expect(got[0]!.at).toBe(want[0]!.at);
    expect(got[0]!.cmd).toEqual(want[0]!.cmd);
    expect(r.h.stats.superseded).toBe(0);
  });

  it("a different destination replaces it and takes the new decision's time", () => {
    const tier = { ...TIERS.normal, hesitation: NO_HESITATION };
    const r = rig(tier, { seed: 5 });
    r.h.submit([move(ahead(150), react(stim("newThreat", T0)))], r.at(T0));
    r.h.submit([move(ahead(-250, 90), react(stim("hpLoss", T0 + 50)))], r.at(T0 + 50));
    const got = r.h.release(r.at(T0 + 4000));
    expect(got).toHaveLength(1);
    expect(got[0]!.stimulus?.kind).toBe("hpLoss");
    expect(r.h.stats.superseded).toBe(1);
  });

  it("amending a step keeps its time: a destination that drifts every think does not restart the clock", () => {
    const tier = { ...TIERS.hard, hesitation: NO_HESITATION };
    const r = rig(tier, { seed: 6 });
    const first = rig(tier, { seed: 6 });
    const want = once(first, [move(ahead(150), STEP)], T0)[0]!.at;
    r.h.submit([move(ahead(150), STEP)], r.at(T0));
    for (let k = 1; k <= 3; k++) r.h.submit([move(ahead(150 + k * 30), STEP)], r.at(T0 + k * 5));
    const got = r.h.release(r.at(T0 + 4000));
    expect(got).toHaveLength(1);
    expect(got[0]!.at).toBe(want);
    expect(got[0]!.cmd.type === "move" && got[0]!.cmd.msg.x).toBeGreaterThan(me.x + 150 + 60);
    expect(r.h.stats.superseded).toBe(0);
  });

  it("does not send the same order again for 1.5 s, but does for a stimulus newer than the click", () => {
    const tier = { ...TIERS.hard, hesitation: NO_HESITATION };
    const r = rig(tier, { seed: 8 });
    const first = once(r, [move(ahead(150), STEP)], T0, 1000);
    expect(first).toHaveLength(1);
    const t1 = first[0]!.at;
    r.h.submit([move(ahead(152), STEP)], r.at(t1 + 200));
    expect(r.h.release(r.at(t1 + 1200))).toEqual([]);
    // The order did not take (orderFailed): answering it is allowed.
    r.h.submit([move(ahead(152), react(stim("orderFailed", t1 + 500)))], r.at(t1 + 520));
    expect(r.h.release(r.at(t1 + 2500))).toHaveLength(1);
    // Long enough since the click: tactics may repeat it.
    const t2 = r.h.stats.commands.move;
    r.h.submit([move(ahead(152), STEP)], r.at(t1 + 20_000));
    expect(r.h.release(r.at(t1 + 22_000))).toHaveLength(1);
    expect(r.h.stats.commands.move).toBe(t2 + 1);
  });

  it("the order channel holds one intent: a stop replaces a lock that has not gone out", () => {
    const tier = { ...TIERS.normal, hesitation: NO_HESITATION };
    const r = rig(tier, { scene: { fighters: [fighter({ id: "foe" })] } });
    r.h.submit([lock("foe", STEP)], r.at(T0));
    r.h.submit([{ kind: "stop", priority: PRIORITY.reflex, timing: STEP, why: "t" }], r.at(T0 + 10));
    const out = r.h.release(r.at(T0 + 4000));
    expect(out.map((c) => c.cmd.type)).toEqual(["stop"]);
  });

  it("different channels do not replace each other", () => {
    const tier = { ...TIERS.hard, hesitation: NO_HESITATION };
    const r = rig(tier, { scene: { containers: [container({ id: "c1", interactable: true })] } });
    r.h.submit([move(ahead(100), STEP), { kind: "swap", slot: 1, priority: PRIORITY.chore, timing: STEP, why: "t" }, { kind: "pickup", container: "c1", priority: PRIORITY.chore, timing: STEP, why: "t" }], r.at(T0));
    const out = r.h.release(r.at(T0 + 4000));
    expect(out.map((c) => c.cmd.type).sort()).toEqual(["move", "pickup", "swap"]);
  });
});

describe("priority replacement", () => {
  const tier = { ...TIERS.normal, hesitation: NO_HESITATION };
  const later = (t: number): IntentTiming => ({ kind: "timed", due: t });
  const sent = (r: Rig, now: number): Vec2[] => r.h.release(r.at(now)).flatMap((c) => (c.cmd.type === "move" ? [{ x: c.cmd.msg.x, y: c.cmd.msg.y }] : []));

  it("a newer intent of lower priority does not replace a pending one inside 500 ms", () => {
    const r = rig({ ...tier, timingSigmaMs: 0 });
    r.h.submit([move(ahead(100), later(T0 + 3000), PRIORITY.combat)], r.at(T0));
    r.h.submit([move(ahead(-300), later(T0 + 3000), PRIORITY.chore)], r.at(T0 + 400));
    const p = sent(r, T0 + 5000);
    expect(p).toHaveLength(1);
    expect(p[0]!.x).toBeGreaterThan(me.x);
    expect(r.h.stats.superseded).toBe(0);
  });

  it("the same priority replaces, and so does a higher one", () => {
    const r = rig({ ...tier, timingSigmaMs: 0 });
    r.h.submit([move(ahead(100), later(T0 + 3000), PRIORITY.goal)], r.at(T0));
    r.h.submit([move(ahead(-300), later(T0 + 3001), PRIORITY.goal)], r.at(T0 + 10));
    r.h.submit([move(ahead(300, 200), later(T0 + 3002), PRIORITY.reflex)], r.at(T0 + 20));
    const p = sent(r, T0 + 5000);
    expect(p).toHaveLength(1);
    expect(p[0]!.x).toBeGreaterThan(me.x + 250);
    expect(r.h.stats.superseded).toBe(2);
  });

  it("a pending intent older than 500 ms is replaced by anything", () => {
    const r = rig({ ...tier, timingSigmaMs: 0 });
    r.h.submit([move(ahead(100), later(T0 + 3000), PRIORITY.reflex)], r.at(T0));
    r.h.submit([move(ahead(-300), later(T0 + 3000), PRIORITY.chore)], r.at(T0 + 501));
    const p = sent(r, T0 + 5000);
    expect(p).toHaveLength(1);
    expect(p[0]!.x).toBeLessThan(me.x);
  });

  it("an equal intent of higher priority raises the pending one's", () => {
    const r = rig({ ...tier, timingSigmaMs: 0 });
    r.h.submit([move(ahead(100), later(T0 + 3000), PRIORITY.chore)], r.at(T0));
    r.h.submit([move(ahead(101), later(T0 + 3000), PRIORITY.combat)], r.at(T0 + 10));
    r.h.submit([move(ahead(-300), later(T0 + 3000), PRIORITY.goal)], r.at(T0 + 20));
    const out = r.h.release(r.at(T0 + 5000));
    expect(out).toHaveLength(1);
    expect(out[0]!.priority).toBe(PRIORITY.combat);
    expect(out[0]!.cmd.type === "move" && out[0]!.cmd.msg.x).toBeGreaterThan(me.x);
  });
});

describe("lock clicks through the humanizer", () => {
  const DOC = { easy: 0.074, normal: 0.012, hard: 0.002 };
  const analytic = (tier: TierParams): number => {
    const s = tier.targetScatter;
    const miss = (sg: number) => Math.exp(-(64 ** 2) / (2 * sg * sg));
    return (1 - s.slipP) * miss(s.sigma) + s.slipP * miss(s.sigma * s.slipMult);
  };

  // Expectation (BOTS.md 2.2): a 2D Gaussian misses the 64 u snap disc with chance exp(-64^2 / 2 sigma^2); a slip (slipP) is the
  // same at slipMult x sigma. Easy 0.96 x 4.8% + 0.04 x 71% = 7.5%, Normal 1.2%, Hard 0.2%.
  it.each(TIER_IDS)("%s: a lone static target is missed as the tier table says, and a miss sends nothing", (id) => {
    const tier = TIERS[id];
    const r = rig(tier, { seed: 13, scene: { fighters: [fighter({ id: "foe" })] } });
    const N = 12000;
    let sent = 0;
    for (let i = 0; i < N; i++) {
      const now = T0 + i * 4000;
      const out = once(r, [lock("foe", STEP)], now, 3000);
      expect(out.length).toBeLessThanOrEqual(1);
      if (out.length === 1) {
        sent++;
        expect(out[0]!.cmd).toEqual({ type: "target", msg: { id: "foe" } });
        expect(out[0]!.intent).toBe("lock");
      }
    }
    const rate = r.h.stats.clickMissed / N;
    expect(sent + r.h.stats.clickMissed).toBe(N);
    expect(r.h.stats.targetClicks).toBe(N);
    expect(r.h.stats.clickWrong).toBe(0);
    expect(Math.abs(rate - DOC[id])).toBeLessThan(0.015);
    expect(Math.abs(rate - analytic(tier))).toBeLessThan(0.01);
    expect(Math.abs(r.h.stats.lapses / N - tier.targetScatter.slipP)).toBeLessThan(0.01);
  });

  it("in a crowd a click can land on the neighbour: that is sent, and counted as wrong", () => {
    const tier = TIERS.normal;
    const r = rig(tier, {
      seed: 14,
      scene: { fighters: [fighter({ id: "a", x: me.x + 200, y: me.y }), fighter({ id: "b", x: me.x + 228, y: me.y })] },
    });
    const N = 4000;
    const ids: Record<string, number> = { a: 0, b: 0 };
    for (let i = 0; i < N; i++) {
      const out = once(r, [lock("a", STEP)], T0 + i * 4000, 3000);
      if (out[0] && out[0].cmd.type === "target") ids[out[0].cmd.msg.id]!++;
    }
    expect(ids.b).toBe(r.h.stats.clickWrong);
    expect(ids.b! / N).toBeGreaterThan(0.1);
    expect(ids.a! + ids.b! + r.h.stats.clickMissed).toBe(N);
  });

  it("a click on a target that has died or left the screen goes where it was and picks nobody", () => {
    const r = rig({ ...TIERS.hard, targetScatter: { ...TIERS.hard.targetScatter, sigma: 1, slipP: 0 } }, { scene: { fighters: [] } });
    const out = once(r, [lock("foe", STEP)], T0, 3000);
    expect(out).toEqual([]);
    expect(r.h.stats.clickMissed).toBe(1);
  });

  it("hands the misses over once, with the target and the click time, for the brain to notice", () => {
    const tier = { ...TIERS.easy, targetScatter: { ...TIERS.easy.targetScatter, sigma: 400, slipP: 0 }, hesitation: NO_HESITATION };
    const r = rig(tier, { seed: 2, scene: { fighters: [fighter({ id: "foe" })] } });
    expect(r.h.drainMisses()).toEqual([]);
    let missed = 0;
    for (let i = 0; i < 40; i++) {
      const before = r.h.stats.clickMissed;
      once(r, [lock("foe", STEP)], T0 + i * 4000, 3000);
      const m = r.h.drainMisses();
      expect(m.length).toBe(r.h.stats.clickMissed - before);
      for (const x of m) {
        expect(x.target).toBe("foe");
        expect(x.at).toBeGreaterThanOrEqual(T0 + i * 4000);
        missed++;
      }
    }
    expect(missed).toBeGreaterThan(20);
    expect(r.h.drainMisses()).toEqual([]);
  });

  it("clicks the fighter where the percept draws it, not where the intent last saw it", () => {
    const tier = { ...TIERS.hard, targetScatter: { ...TIERS.hard.targetScatter, sigma: 1, slipP: 0, lagS: 0 }, hesitation: NO_HESITATION };
    const r = rig(tier, { scene: { fighters: [fighter({ id: "foe", x: me.x + 400, y: me.y + 300 })] } });
    const out = once(r, [lock("foe", STEP)], T0, 3000);
    expect(out).toHaveLength(1);
  });

  it("a unit cast resolves like a lock and carries the fighter it meant", () => {
    const tier = { ...TIERS.hard, targetScatter: { ...TIERS.hard.targetScatter, sigma: 2, slipP: 0 }, hesitation: NO_HESITATION };
    const foe = fighter({ id: "foe" });
    const r = rig(tier, { scene: { fighters: [foe] } });
    const out = once(r, [{ kind: "cast", slot: "q", x: foe.x, y: foe.y, target: "foe", at: { x: foe.x, y: foe.y }, snapRadius: 40, priority: PRIORITY.combat, timing: STEP, why: "t" }], T0, 3000);
    expect(out).toHaveLength(1);
    expect(out[0]!.cmd.type).toBe("cast");
    expect(out[0]!.cmd.msg).toMatchObject({ slot: "q", id: "foe" });
  });

  it("a ground cast, plan and choose go through their own channels untouched", () => {
    const r = rig({ ...TIERS.hard, hesitation: NO_HESITATION });
    const out = [
      ...once(r, [
        { kind: "cast", slot: "wish", x: me.x + 100, y: me.y, priority: PRIORITY.combat, timing: STEP, why: "t" },
        { kind: "plan", msg: { spawn: 1, ready: true }, priority: PRIORITY.goal, timing: STEP, why: "t" },
      ], T0),
      // plan and choose share the menu channel: one pending intent between them.
      ...once(r, [{ kind: "choose", msg: { chest: "x", pick: 1 }, priority: PRIORITY.goal, timing: STEP, why: "t" }], T0 + 20_000),
    ];
    expect(out.map((c) => c.cmd.type).sort()).toEqual(["cast", "choose", "plan"]);
    expect(out.find((c) => c.cmd.type === "plan")!.cmd.msg).toEqual({ spawn: 1, ready: true });
    expect(out.find((c) => c.cmd.type === "choose")!.cmd.msg).toEqual({ chest: "x", pick: 1 });
    const cast = out.find((c) => c.cmd.type === "cast")!.cmd.msg as { slot: string; x: number; y: number };
    expect(cast.slot).toBe("wish");
    expect(Math.abs(cast.x - (me.x + 100))).toBeLessThan(100);
  });

  it("drops an intent whose message type the server does not list, when told the features", () => {
    const f = features();
    const r = rig({ ...TIERS.hard, hesitation: NO_HESITATION }, { features: f });
    const out = once(r, [
      { kind: "cast", slot: "q", x: me.x, y: me.y, priority: PRIORITY.combat, timing: STEP, why: "t" },
      { kind: "swap", slot: 1, priority: PRIORITY.combat, timing: STEP, why: "t" },
    ], T0);
    expect(out.map((c) => c.cmd.type)).toEqual(["swap"]);
    const wishes = rig({ ...TIERS.hard, hesitation: NO_HESITATION }, { features: features({ messageTypes: [...f.messageTypes, "cast"] }) });
    expect(once(wishes, [{ kind: "cast", slot: "q", x: me.x, y: me.y, priority: PRIORITY.combat, timing: STEP, why: "t" }], T0)).toHaveLength(1);
  });
});

describe("the lock's re-send rule", () => {
  const tier = { ...TIERS.hard, hesitation: NO_HESITATION, targetScatter: { ...TIERS.hard.targetScatter, sigma: 1, slipP: 0 } };
  const foe = fighter({ id: "foe" });

  it("tactics emits the lock every think while the target is not locked: never two for one target 300 ms apart", () => {
    const r = rig(tier, { scene: { fighters: [foe] } });
    const sent: number[] = [];
    for (let now = T0; now < T0 + 10_000; now += 50) {
      if ((now - T0) % 100 === 0) r.h.submit([lock("foe", STEP)], r.at(now));
      for (const c of r.h.release(r.at(now))) if (c.cmd.type === "target") sent.push(c.at);
    }
    expect(sent.length).toBeGreaterThan(10);
    for (let i = 1; i < sent.length; i++) expect(sent[i]! - sent[i - 1]!).toBeGreaterThanOrEqual(HUMANIZER_RULES.lockResendMs);
  });

  it("sends none once the server shows the lock", () => {
    const r = rig(tier, { scene: { fighters: [foe] } });
    const locked = { self: selfView({ attackTarget: "foe" }) };
    r.h.submit([lock("foe", STEP)], r.at(T0, locked));
    expect(r.h.release(r.at(T0 + 3000, locked))).toEqual([]);
    // Pending when the lock appears: dropped at the click.
    r.h.submit([lock("foe", STEP)], r.at(T0 + 10_000));
    expect(r.h.release(r.at(T0 + 13_000, locked))).toEqual([]);
    expect(r.h.stats.targetClicks).toBe(0);
  });

  it("locks another fighter even while one is locked", () => {
    const r = rig(tier, { scene: { fighters: [foe, fighter({ id: "other", x: me.x + 300, y: me.y + 100 })] } });
    const locked = { self: selfView({ attackTarget: "foe" }) };
    r.h.submit([lock("other", STEP, PRIORITY.combat, { x: me.x + 300, y: me.y + 100 })], r.at(T0, locked));
    const out = r.h.release(r.at(T0 + 3000, locked));
    expect(out).toHaveLength(1);
    expect(out[0]!.cmd).toEqual({ type: "target", msg: { id: "other" } });
  });

  it("does not trust the HUD for a moment after its own order: a lock that a move has since dropped is sent", () => {
    const r = rig(tier, { scene: { fighters: [foe] } });
    const locked = { self: selfView({ attackTarget: "foe" }) };
    const m = once(r, [move(ahead(-100), STEP, PRIORITY.reflex)], T0, 2000);
    expect(m).toHaveLength(1);
    const t = m[0]!.at;
    r.h.submit([lock("foe", STEP)], r.at(t + 20, locked));
    expect(r.h.release(r.at(t + 200, locked)).map((c) => c.cmd.type)).toEqual(["target"]);
  });
});

describe("a person who is down clicks nothing", () => {
  it("drops what was pending when the bot is no longer alive", () => {
    const r = rig({ ...TIERS.hard, hesitation: NO_HESITATION });
    r.h.submit([move(ahead(100), STEP)], r.at(T0));
    expect(r.h.release(r.at(T0 + 3000, { self: selfView({ status: "dead" }) }))).toEqual([]);
    expect(r.h.release(r.at(T0 + 6000))).toEqual([]);
  });
});

describe("pickup and the keys", () => {
  const tier = { ...TIERS.hard, hesitation: NO_HESITATION };

  it("F is pressed only while the percept says the container is interactable", () => {
    const pk = (id: string): Intent => ({ kind: "pickup", container: id, priority: PRIORITY.goal, timing: STEP, why: "t" });
    const r = rig(tier, { scene: { containers: [container({ id: "near", interactable: true }), container({ id: "far", interactable: false })] } });
    expect(once(r, [pk("far")], T0)).toEqual([]);
    expect(once(r, [pk("missing")], T0 + 10_000)).toEqual([]);
    const ok = once(r, [pk("near")], T0 + 20_000);
    expect(ok.map((c) => c.cmd)).toEqual([{ type: "pickup", msg: { containerId: "near" } }]);
    assertAccepted(ok);
    // A dropped press costs no token or gap.
    expect(r.h.stats.commands.pickup).toBe(1);
  });

  it("a destination that is not a number is never clicked", () => {
    const r = rig(tier);
    expect(once(r, [move({ x: Number.NaN, y: me.y }, STEP)], T0)).toEqual([]);
    expect(r.h.stats.commands.move).toBe(0);
  });

  it("swap and stop are plain keys", () => {
    const r = rig(tier);
    const out = once(r, [
      { kind: "swap", slot: 1, priority: PRIORITY.goal, timing: STEP, why: "t" },
      { kind: "stop", priority: PRIORITY.goal, timing: STEP, why: "t" },
    ], T0);
    expect(out.map((c) => c.cmd).sort((a, b) => a.type.localeCompare(b.type))).toEqual([{ type: "stop", msg: {} }, { type: "swap", msg: { slot: 1 } }]);
    assertAccepted(out);
  });
});

describe("walks to the edge of the screen", () => {
  it.each(TIER_IDS)("%s: an off-screen destination is clicked on the screen edge or on the minimap, never in between", (id) => {
    const tier = { ...TIERS[id], hesitation: NO_HESITATION };
    const r = rig(tier, { seed: 15 });
    // Toward the map's middle (the default self is the seed-7 map's first spawn, near one side of the 136x136 map), where the
    // screen's edge is floor.
    const dir = me.x > WORLD_W / 2 ? -1 : 1;
    const to = { x: me.x + dir * 1500, y: me.y + 200 };
    const N = 3000;
    let edge = 0;
    for (let i = 0; i < N; i++) {
      const c = once(r, [move(to, STEP)], T0 + i * 4000, 3000)[0]!;
      expect(c.cmd.type).toBe("move");
      const m = c.cmd.msg as Vec2;
      const onScreen = Math.abs(m.x - me.x) <= 800 && Math.abs(m.y - me.y) <= 562.5;
      if (onScreen) {
        edge++;
        expect(dir * (m.x - me.x)).toBeGreaterThan(600);
      } else {
        expect(Math.hypot(m.x - to.x, m.y - to.y)).toBeLessThan(tier.minimapSigma * 6);
      }
      assertAccepted([c]);
    }
    expect(Math.abs(edge / N - tier.edgeClickP)).toBeLessThan(0.04);
  });
});

describe("stats", () => {
  it("keeps the last 256 delays per stimulus kind and counts every command by type", () => {
    const r = rig({ ...TIERS.hard, hesitation: NO_HESITATION }, { seed: 16 });
    for (let i = 0; i < 700; i++) {
      const now = T0 + i * 3000;
      once(r, [move(ahead(100 + (i % 7) * 30), react(stim(i % 2 ? "hpLoss" : "lowHp", now)))], now, 2500);
    }
    expect(r.h.stats.reactions.hpLoss).toHaveLength(HUMANIZER_RULES.reactionSamples);
    expect(r.h.stats.reactions.lowHp).toHaveLength(HUMANIZER_RULES.reactionSamples);
    expect(r.h.stats.reactions.newThreat).toBeUndefined();
    expect(r.h.stats.commands.move).toBe(700);
    expect(r.h.stats.commands.target).toBe(0);
    for (const t of ["move", "stop", "target", "swap", "pickup", "cast", "plan", "choose"] as const) expect(r.h.stats.commands[t]).toBeGreaterThanOrEqual(0);
  });

  it("stamps the stimulus a command answered, and none for a step or a timed intent", () => {
    const r = rig({ ...TIERS.hard, hesitation: NO_HESITATION });
    const s = stim("hpLoss", T0);
    const a = once(r, [move(ahead(100), react(s))], T0);
    expect(a[0]!.stimulus).toEqual(s);
    const b = once(r, [move(ahead(-200), STEP)], T0 + 20_000);
    expect(b[0]!.stimulus).toBeNull();
    expect(b[0]!.priority).toBe(PRIORITY.goal);
  });
});

describe("determinism", () => {
  const script = (seed: number) => {
    const r = rig(TIERS.normal, { seed, scene: { fighters: [fighter({ id: "foe" }), fighter({ id: "foe2", x: me.x + 230, y: me.y + 20 })] } });
    const out: TimedCommand[] = [];
    for (let now = T0; now < T0 + 60_000; now += 50) {
      if ((now - T0) % 400 === 0) {
        const k = (now - T0) / 400;
        r.h.submit([
          k % 3 === 0 ? lock("foe", react(stim("newThreat", now, { subject: "foe" }))) : move(ahead((k * 37) % 500 - 250, (k * 91) % 300 - 150), STEP),
        ], r.at(now));
      }
      out.push(...r.h.release(r.at(now)));
    }
    return { out, stats: JSON.parse(JSON.stringify(r.h.stats)) };
  };

  it("replays exactly from the same seed and differs from another", () => {
    const a = script(21);
    expect(a.out.length).toBeGreaterThan(20);
    expect(script(21)).toEqual(a);
    expect(script(22).out).not.toEqual(a.out);
  });

  it("draws only from the motor and lapse streams, leaving the decide stream untouched", () => {
    const r = rig(TIERS.normal, { seed: 3 });
    const probe = rngs(3).decide;
    const c = r.at(T0);
    for (let i = 0; i < 20; i++) {
      r.h.submit([move(ahead(100 + i * 10), react(stim("hpLoss", T0 + i * 1000)))], r.at(T0 + i * 1000));
      r.h.release(r.at(T0 + i * 1000 + 900));
    }
    expect(c.rng.decide()).toBe(probe());
  });
});
