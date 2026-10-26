// The juice in FxView (render/FxView.ts): the cues it sends a fighter's figure on windups, swings, launches and blows, the
// impact dots, the dust and the move ripple, and the local player's hit-stop and shake triggers.
import { afterEach, describe, expect, it, vi } from "vitest";
import { Y_SCALE, type ProjectileLaunch, type TimedFx } from "@raid/shared";
import { FxView, type FxHost } from "../src/render/FxView";
import type { FigureCues } from "../src/render/figurePose";
import { resetReducedMotionCache } from "../src/render/juice";
import { argsOf, fakeScene } from "./fakes";

afterEach(() => {
  vi.unstubAllGlobals();
  resetReducedMotionCache();
});

type Call = [string, ...unknown[]];

function setup(over: Partial<FxHost> = {}) {
  const { scene, made, ofKind } = fakeScene();
  const cueLog: Record<string, Call[]> = {};
  const cuesFor = (id: string): FigureCues => {
    const log = (cueLog[id] ??= []);
    return {
      windupStart: (...a) => { log.push(["windupStart", ...a]); },
      windupEnd: (...a) => { log.push(["windupEnd", ...a]); },
      swing: (...a) => { log.push(["swing", ...a]); },
      launch: (...a) => { log.push(["launch", ...a]); },
      hit: (...a) => { log.push(["hit", ...a]); },
    };
  };
  const positions: Record<string, { x: number; y: number }> = { me: { x: 0, y: 0 }, foe: { x: 100, y: 0 }, mob: { x: 100, y: 50 } };
  const landed: number[] = [];
  const hurt: number[] = [];
  const near: Array<[number, number, number]> = [];
  const host: FxHost = {
    localId: "me",
    view: (id) => (positions[id] ? { flash: () => {}, cues: cuesFor(id) } : undefined),
    position: (id) => positions[id],
    name: () => undefined,
    projectileEnded: () => {},
    localLanded: (fx) => landed.push(fx.amount),
    localHurt: (fx) => hurt.push(fx.amount),
    nearestFighter: (x, y, within) => { near.push([x, y, within]); return "foe"; },
    ...over,
  };
  const fx = new FxView(scene, host);
  /** Enqueues `events` and updates once at render time `renderT` and real time `now`. */
  const play = (events: TimedFx[], renderT = 1000, now = 5000) => {
    for (const e of events) fx.enqueue(e);
    fx.update(renderT, now, true);
  };
  return { fx, made, ofKind, cueLog, positions, landed, hurt, near, play };
}

const hit = (id: string, by: string | null, amount = 50, t = 1000, extra: Partial<Extract<TimedFx, { kind: "hit" }>> = {}): TimedFx =>
  ({ kind: "hit", id, by, amount, weapon: "sword", t, ...extra });
const windup = (by: string, weapon: "sword" | "wand" | "axe", ms: number, a = 0.5, t = 1000): TimedFx => ({ kind: "windup", by, weapon, a, ms, t } as TimedFx);
const swing = (by: string, a = 0.5, t = 1000): TimedFx => ({ kind: "swing", by, weapon: "sword", x: 100, y: 0, a, t } as TimedFx);

describe("anticipation cues", () => {
  it("tells a fighter's figure to wind back for as long as its telegraph lasts, a melee windup or a wand cast", () => {
    const { play, cueLog } = setup();
    play([windup("foe", "sword", 400, 1.25)]);
    expect(cueLog.foe).toEqual([["windupEnd", 5000], ["windupStart", 1.25, 400, 5000, "melee"]]);
    play([windup("me", "wand", 600, 0)]);
    expect(cueLog.me).toEqual([["windupEnd", 5000], ["windupStart", 0, 600, 5000, "wand"]]);
  });

  it("uses the telegraph's own (clamped) duration", () => {
    const { play, cueLog } = setup();
    play([windup("foe", "sword", 99999)]);
    expect(cueLog.foe![1]![2]).toBe(1000);
    play([windup("foe", "sword", 1)]);
    expect(cueLog.foe!.at(-1)![2]).toBe(40);
  });

  it("sends nothing for a windup it cannot draw", () => {
    const { play, cueLog } = setup();
    play([windup("ghost", "sword", 400), windup("foe", "sword", Number.NaN)]);
    expect(cueLog.ghost).toBeUndefined();
    expect(cueLog.foe?.filter(([n]) => n === "windupStart") ?? []).toEqual([]);
  });

  it("lets the pose go before the swing's lunge, which carries on from where it was", () => {
    const { play, cueLog } = setup();
    play([windup("foe", "sword", 400)], 1000, 5000);
    play([swing("foe", 0.75, 1400)], 1400, 5400);
    expect(cueLog.foe!.slice(-2)).toEqual([["windupEnd", 5400], ["swing", 0.75, 5400]]);
  });

  it("ends the pose when the windup is cancelled, staggered or the fighter dies", () => {
    const { play, cueLog } = setup();
    for (const e of [
      { kind: "cancel", id: "foe", t: 1000 }, { kind: "stagger", id: "foe", t: 1000 },
      { kind: "death", id: "foe", x: 1, y: 2, by: "me", t: 1000 },
    ] as TimedFx[]) {
      cueLog.foe = [];
      play([e]);
      expect(cueLog.foe).toContainEqual(["windupEnd", 5000]);
    }
  });

  it("ends the poses of everyone winding up on a teleport, and on a client-side cancel once render time reaches it", () => {
    const { fx, play, cueLog } = setup();
    play([windup("foe", "sword", 400), windup("mob", "sword", 400)]);
    cueLog.foe = [];
    cueLog.mob = [];
    play([{ kind: "teleport", t: 1100 }], 1100, 5100);
    expect(cueLog.foe).toContainEqual(["windupEnd", 5100]);
    expect(cueLog.mob).toContainEqual(["windupEnd", 5100]);
    cueLog.foe = [];
    fx.cancelWindups("foe", 1200);
    fx.update(1150, 5150, true);
    expect(cueLog.foe).toEqual([]);
    fx.update(1200, 5200, true);
    expect(cueLog.foe).toEqual([["windupEnd", 5200]]);
  });
});

describe("the shooter's recoil", () => {
  const launch = (over: Partial<ProjectileLaunch> = {}): ProjectileLaunch =>
    ({ id: "p1", kind: "arrow", x: 90, y: 4, vx: 0, vy: 900, t: 1000, range: 240, ...over });

  it("kicks back the fighter nearest the origin, along the shot, when render time reaches the launch", () => {
    const { fx, near, cueLog } = setup();
    fx.noteLaunch(launch());
    fx.update(900, 5000, true);
    expect(near).toEqual([]);
    fx.update(1000, 5100, true);
    expect(near).toEqual([[90, 4, expect.any(Number)]]);
    expect(near[0]![2]).toBeGreaterThanOrEqual(40);
    expect(cueLog.foe).toEqual([["launch", Math.PI / 2, 5100]]);
  });

  it("does nothing for no fighter near, no host support or a launch long past (one replayed after a stall or a join)", () => {
    const none = setup({ nearestFighter: () => undefined });
    none.fx.noteLaunch(launch());
    none.fx.update(1000, 5000, true);
    expect(none.cueLog.foe).toBeUndefined();
    const bare = setup({ nearestFighter: undefined });
    bare.fx.noteLaunch(launch());
    expect(() => bare.fx.update(1000, 5000, true)).not.toThrow();
    const late = setup();
    late.fx.noteLaunch(launch({ t: 1000 }));
    late.fx.update(1400, 5000, true);
    expect(late.near).toEqual([]);
    expect(late.cueLog.foe).toBeUndefined();
  });

  it("keeps a flood of launches (a stalled tab) from pushing a real fx out of the queue", () => {
    const { fx, landed } = setup();
    fx.enqueue(hit("foe", "me", 30, 1000));
    for (let i = 0; i < 1000; i++) fx.noteLaunch(launch({ id: `p${i}`, t: 900 + i }));
    fx.update(1000, 5000, true);
    expect(landed).toEqual([30]);
  });

  it("ignores a launch with no direction or time", () => {
    const { fx, near } = setup();
    fx.noteLaunch(launch({ vx: 0, vy: 0, t: 1000 }));
    fx.noteLaunch(launch({ t: Number.NaN }));
    fx.update(1000, 5000, true);
    expect(near.length).toBeLessThanOrEqual(1);
  });
});

describe("blows", () => {
  it("shoves the victim away from the attacker and bursts impact dots on it", () => {
    const { play, cueLog, ofKind } = setup();
    play([hit("foe", "me")]);
    expect(cueLog.foe).toEqual([["hit", 0, 5000]]); // the attacker is at x 0, the victim at x 100: pushed toward +x
    expect(ofKind("graphics")).toHaveLength(1);
  });

  it("pops in place when the attacker is not drawn or stands on the victim", () => {
    const { play, cueLog, positions } = setup();
    positions.me = { x: 100, y: 0 };
    play([hit("foe", "me")]);
    play([hit("foe", "ghost")]);
    expect(cueLog.foe!.map(([, away]) => away)).toEqual([null, null]);
  });

  it("makes nothing of damage over time, a backlash, the arena's damage or a blow of nothing", () => {
    const { play, cueLog, ofKind, landed, hurt } = setup();
    play([
      hit("foe", "me", 20, 1000, { sig: "burn" }), hit("foe", "me", 20, 1000, { sig: "disease" }), hit("foe", "me", 20, 1000, { sig: "mark" }),
      hit("me", "me", 20, 1000, { sig: "backlash" }), hit("foe", null), hit("foe", "me", 0),
    ]);
    expect(cueLog.foe ?? []).toEqual([]);
    expect(cueLog.me ?? []).toEqual([]);
    expect(ofKind("graphics")).toHaveLength(1); // only the backlash's flame
    expect(landed).toEqual([]);
    expect(hurt).toEqual([]);
  });

  it("lets the screen know of the local player's blows, landed or taken", () => {
    const { play, landed, hurt } = setup();
    play([hit("foe", "me", 30), hit("me", "foe", 70), hit("mob", "foe", 5)]);
    expect(landed).toEqual([30]);
    expect(hurt).toEqual([70]);
  });

  it("keeps the screen out of it for a blow played long after it happened (a stalled tab)", () => {
    const { fx, landed, hurt } = setup();
    fx.enqueue(hit("foe", "me", 30, 1000));
    fx.enqueue(hit("me", "foe", 30, 1000));
    fx.update(1000 + 800, 5000, true);
    expect(landed).toEqual([]);
    expect(hurt).toEqual([]);
    fx.enqueue(hit("foe", "me", 30, 2000));
    fx.update(2100, 5100, true);
    expect(landed).toEqual([30]);
  });

  it("treats every blow as fresh while the clock is not synced", () => {
    const { fx, landed } = setup();
    fx.enqueue(hit("foe", "me", 30, 1000));
    fx.update(99999, 5000, false);
    expect(landed).toEqual([30]);
  });

  it("caps the dots on screen at once, and frees them as they finish", () => {
    const { fx, ofKind, play } = setup();
    play(Array.from({ length: 60 }, () => hit("foe", "me", 10)));
    expect(ofKind("graphics")).toHaveLength(20);
    fx.update(1000, 5000 + 250, true); // all over
    play([hit("foe", "me", 10)], 1050, 5300);
    expect(ofKind("graphics")).toHaveLength(20); // the finished ones were reused
  });

  it("bursts weapon-coloured and white dots that fly out and die away, round a fading white bloom", () => {
    const { play, fx, ofKind } = setup();
    play([hit("foe", "me", 60, 1000, { weapon: "sword" })]);
    const g = ofKind("graphics")[0]!;
    fx.update(1000, 5000 + 20, true);
    const dotsEarly = argsOf(g, "fillCircle");
    expect(dotsEarly).toHaveLength(6); // the bloom and five dots
    expect(g.state.position).toEqual([100, 0 * Y_SCALE - 14]);
    fx.update(1000, 5000 + 150, true);
    const dotsLate = argsOf(g, "fillCircle");
    expect(dotsLate).toHaveLength(5); // the bloom is gone before the dots are
    const reach = (c: unknown[]) => Math.hypot(c[0] as number, (c[1] as number) / Y_SCALE);
    expect(reach(dotsLate[0]!)).toBeGreaterThan(reach(dotsEarly[1]!));
    expect(dotsLate[0]![2]).toBeLessThan(dotsEarly[1]![2] as number);
    fx.update(1000, 5000 + 400, true);
    expect(g.state.visible).toBe(false);
  });

  it("fans the dots out the way the blow went, and all round when the way is not known", () => {
    const { play, fx, ofKind, positions } = setup();
    play([hit("foe", "me", 60)]);
    fx.update(1000, 5000 + 100, true);
    const ahead = argsOf(ofKind("graphics")[0]!, "fillCircle").filter((c) => (c[0] as number) !== 0);
    expect(ahead.every((c) => (c[0] as number) > 0)).toBe(true); // all on the far side of the victim from the attacker
    positions.me = { x: 100, y: 0 };
    play([hit("foe", "me", 60)], 1100, 6000);
    fx.update(1100, 6100, true);
    const all = argsOf(ofKind("graphics")[1]!, "fillCircle");
    expect(all.some((c) => (c[0] as number) < 0)).toBe(true);
    expect(all.some((c) => (c[0] as number) > 0)).toBe(true);
  });

  it("flies no dots under reduced motion, only the bloom", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { play, fx, ofKind } = setup();
    play([hit("foe", "me", 60)]);
    const g = ofKind("graphics")[0]!;
    fx.update(1000, 5000 + 40, true);
    expect(argsOf(g, "fillCircle")).toEqual([[0, 0, expect.any(Number)]]);
    fx.update(1000, 5000 + 150, true);
    expect(argsOf(g, "fillCircle")).toEqual([]);
  });
});

describe("dust", () => {
  it("puffs n grey circles at the feet, drifting and fading, and frees them", () => {
    const { fx, ofKind } = setup();
    fx.dust(10, 20, 0, 3, 5000);
    fx.update(1000, 5000, true);
    const gs = ofKind("graphics");
    expect(gs).toHaveLength(3);
    for (const g of gs) expect(argsOf(g, "fillCircle")).toHaveLength(1);
    fx.update(1000, 5000 + 150, true);
    const mid = gs[0]!.state.alpha as number;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(0.6);
    expect(gs[0]!.state.scale as number).toBeGreaterThan(0.7);
    fx.update(1000, 5000 + 800, true);
    for (const g of gs) expect(g.state.visible).toBe(false);
  });

  it("keeps a crowd cheap: no more than 24 at once", () => {
    const { fx, ofKind } = setup();
    for (let i = 0; i < 20; i++) fx.dust(0, 0, 0, 3, 5000);
    expect(ofKind("graphics")).toHaveLength(24);
  });

  it("is not made under reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { fx, made } = setup();
    fx.dust(0, 0, 0, 3, 5000);
    expect(made).toEqual([]);
  });
});

describe("the move ripple", () => {
  it("spreads from the ordered point as a ring while it fades out", () => {
    const { fx, ofKind } = setup();
    fx.ripple(40, 100, 5000);
    fx.update(1000, 5000, true);
    const g = ofKind("graphics")[0]!;
    expect(argsOf(g, "strokeEllipse")).toHaveLength(1);
    expect(g.state.position).toEqual([40, 100 * Y_SCALE]);
    const early = g.state.scale as number;
    const earlyAlpha = g.state.alpha as number;
    fx.update(1000, 5000 + 200, true);
    expect(g.state.scale as number).toBeGreaterThan(early);
    expect(g.state.alpha as number).toBeLessThan(earlyAlpha);
    fx.update(1000, 5000 + 500, true);
    expect(g.state.visible).toBe(false);
  });

  it("only fades under reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { fx, ofKind } = setup();
    fx.ripple(0, 0, 5000);
    fx.update(1000, 5000 + 200, true);
    const g = ofKind("graphics")[0]!;
    expect(g.state.scale).toBe(1);
    expect(g.state.alpha as number).toBeGreaterThan(0);
    expect(g.state.alpha as number).toBeLessThan(0.9);
  });

  it("is not made once the view is destroyed", () => {
    const { fx, made } = setup();
    fx.destroy();
    fx.ripple(0, 0, 5000);
    fx.dust(0, 0, 0, 2, 5000);
    expect(made).toEqual([]);
  });
});
