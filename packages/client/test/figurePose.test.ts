// The pose numbers behind the juice on a fighter's figure (render/figurePose.ts): pure, so every cue is driven by hand.
import { describe, expect, it } from "vitest";
import { Y_SCALE } from "@raid/shared";
import {
  BOW_LEAN_PX, BOW_SHAKE_PX, CAST_BACK_PX, EVENT_GAP_MS, FigurePose, HIT_MS, HIT_POP, LUNGE_MS, LUNGE_PX, MIN_MOVE_MS, RECOIL_MS,
  RECOIL_PX, SHOVE_PX, START_TAU_MS, SWEEP_ROT, WIND_BACK_PX, WIND_CROUCH_X, WIND_CROUCH_Y, WIND_FADE_MS, WIND_GRACE_MS, WIND_ROT,
  type Pose,
} from "../src/render/figurePose";

const REST: Pose = { ox: 0, oy: 0, sx: 1, sy: 1, rot: 0 };
const copy = (p: Pose): Pose => ({ ...p });

describe("a fighter at rest", () => {
  it("is posed exactly at rest, and the wand has no charge", () => {
    const f = new FigurePose();
    expect(copy(f.sample(1000, 1, -1, 0))).toEqual(REST);
    expect(f.charge).toBe(0);
  });
});

describe("anticipation over a windup", () => {
  it("draws back against the swing, crouches and winds the weapon back, peaking at the release", () => {
    const f = new FigurePose();
    f.windupStart(0, 500, 1000, "melee");
    const early = copy(f.sample(1100, 1, -1, 0));
    const mid = copy(f.sample(1250, 1, -1, 0));
    const peak = copy(f.sample(1500, 1, -1, 0));
    // Swinging along +x: the body goes toward -x, further the later it is.
    expect(early.ox).toBeLessThan(0);
    expect(mid.ox).toBeLessThan(early.ox);
    expect(peak.ox).toBeCloseTo(-WIND_BACK_PX, 9);
    expect(peak.oy).toBeCloseTo(0, 9);
    expect(peak.rot).toBeCloseTo(-WIND_ROT, 9);
    expect(peak.sx).toBeCloseTo(1 + WIND_CROUCH_X, 9);
    expect(peak.sy).toBeCloseTo(1 - WIND_CROUCH_Y, 9);
    expect(mid.rot).toBeGreaterThan(peak.rot);
  });

  it("draws back along the ground direction as the ground is drawn (squashed by Y_SCALE)", () => {
    const f = new FigurePose();
    f.windupStart(Math.PI / 2, 400, 0, "melee"); // south: down the screen
    const peak = f.sample(400, 1, -1, 0);
    expect(peak.ox).toBeCloseTo(0, 9);
    expect(peak.oy).toBeCloseTo(-WIND_BACK_PX * Y_SCALE, 9);
  });

  it("holds the peak, then lets go on its own a little after the windup ought to have ended (a lost fx)", () => {
    const f = new FigurePose();
    f.windupStart(0, 300, 0, "melee");
    expect(f.sample(300 + WIND_GRACE_MS, 1, -1, 0).ox).toBeCloseTo(-WIND_BACK_PX, 9);
    const letGo = f.sample(300 + WIND_GRACE_MS + WIND_FADE_MS, 1, -1, 0).ox;
    expect(letGo).toBeGreaterThan(-WIND_BACK_PX * 0.5);
    expect(f.sample(300 + WIND_GRACE_MS + 2000, 1, -1, 0)).toEqual(REST);
  });

  it("relaxes when the windup is cancelled (a stagger, a cancel fx, a death)", () => {
    const f = new FigurePose();
    f.windupStart(0, 500, 0, "melee");
    const wound = f.sample(250, 1, -1, 0).ox;
    f.windupEnd(250);
    expect(f.sample(250, 1, -1, 0).ox).toBeCloseTo(wound, 9);
    const after = f.sample(250 + WIND_FADE_MS, 1, -1, 0).ox;
    expect(after / wound).toBeCloseTo(Math.exp(-1), 6);
    expect(copy(f.sample(250 + 2000, 1, -1, 0))).toEqual(REST);
  });

  it("a wand draws back less, keeps its weapon straight and charges its glow up to 1", () => {
    const f = new FigurePose();
    f.windupStart(0, 600, 0, "wand");
    expect(f.sample(0, 1, -1, 0).ox).toBeCloseTo(0, 9);
    expect(f.charge).toBe(0);
    const half = f.sample(300, 1, -1, 0);
    expect(half.rot).toBe(0);
    expect(f.charge).toBeCloseTo(0.5, 9);
    expect(f.sample(600, 1, -1, 0).ox).toBeCloseTo(-CAST_BACK_PX, 9);
    expect(f.charge).toBeCloseTo(1, 9);
  });

  it("a melee windup charges nothing", () => {
    const f = new FigurePose();
    f.windupStart(0, 500, 0, "melee");
    f.sample(500, 1, -1, 0);
    expect(f.charge).toBe(0);
  });

  it("a new windup starts over", () => {
    const f = new FigurePose();
    f.windupStart(0, 500, 0, "melee");
    f.sample(500, 1, -1, 0);
    f.windupStart(Math.PI, 500, 600, "melee");
    expect(f.sample(600, 1, -1, 0).ox).toBeCloseTo(0, 9);
    expect(f.sample(1100, 1, -1, 0).ox).toBeCloseTo(WIND_BACK_PX, 9); // swinging toward -x: back is +x
  });
});

describe("the swing's lunge", () => {
  it("carries on from the wound-up pose, lunges toward the swing and sweeps the weapon through, then settles", () => {
    const f = new FigurePose();
    f.windupStart(0, 400, 0, "melee");
    const wound = copy(f.sample(400, 1, -1, 0));
    f.windupEnd(400); // FxView cancels the telegraph first,
    f.swing(0, 400); // then cues the swing
    const start = copy(f.sample(400, 1, -1, 0));
    expect(start.ox).toBeCloseTo(wound.ox, 9);
    expect(start.rot).toBeCloseTo(wound.rot, 9);
    expect(start.sx).toBeCloseTo(wound.sx, 9);
    const peak = copy(f.sample(400 + LUNGE_MS * 0.4, 1, -1, 0));
    expect(peak.ox).toBeCloseTo(LUNGE_PX, 9);
    expect(peak.rot).toBeCloseTo(SWEEP_ROT, 9);
    expect(peak.sx).toBeGreaterThan(1); // stretched along the lunge
    expect(peak.sy).toBeLessThan(1);
    const late = f.sample(400 + LUNGE_MS * 0.8, 1, -1, 0);
    expect(late.ox).toBeGreaterThan(0);
    expect(late.ox).toBeLessThan(LUNGE_PX);
    expect(copy(f.sample(400 + LUNGE_MS, 1, -1, 0))).toEqual(REST);
  });

  it("lunges the way the swing is aimed, which is not always the way it was wound up", () => {
    const f = new FigurePose();
    f.windupStart(0, 400, 0, "melee");
    f.swing(Math.PI, 400); // an attack on a locked target is aimed again when it lands
    const peak = f.sample(400 + LUNGE_MS * 0.4, 1, -1, 0);
    expect(peak.ox).toBeCloseTo(-LUNGE_PX, 9);
  });

  it("works without a windup before it (a lost fx)", () => {
    const f = new FigurePose();
    f.swing(Math.PI / 2, 0);
    expect(f.sample(0, 1, -1, 0)).toEqual(REST);
    const peak = f.sample(LUNGE_MS * 0.4, 1, -1, 0);
    expect(peak.oy).toBeCloseTo(LUNGE_PX * Y_SCALE, 9);
    expect(peak.sy).toBeGreaterThan(1);
    expect(peak.sx).toBeLessThan(1);
  });

  it("is over: the windup's own pose does not come back after the swing", () => {
    const f = new FigurePose();
    f.windupStart(0, 400, 0, "melee");
    f.swing(0, 400);
    expect(copy(f.sample(400 + LUNGE_MS + 1000, 1, -1, 0))).toEqual(REST);
  });
});

describe("the recoil of a launch", () => {
  it("kicks the shooter back against the shot and settles", () => {
    const f = new FigurePose();
    f.launch(0, 1000);
    expect(f.sample(1000, 1, -1, 0).ox).toBeCloseTo(0, 9);
    expect(f.sample(1000 + RECOIL_MS * 0.25, 1, -1, 0).ox).toBeCloseTo(-RECOIL_PX, 9);
    expect(f.sample(1000 + RECOIL_MS * 0.6, 1, -1, 0).ox).toBeLessThan(0);
    expect(copy(f.sample(1000 + RECOIL_MS, 1, -1, 0))).toEqual(REST);
  });

  it("carries on from a wand's gathering pose and ends its charge", () => {
    const f = new FigurePose();
    f.windupStart(0, 500, 0, "wand");
    f.sample(500, 1, -1, 0);
    expect(f.charge).toBeCloseTo(1, 9);
    f.launch(0, 500);
    expect(f.sample(500, 1, -1, 0).ox).toBeCloseTo(-CAST_BACK_PX, 9);
    expect(f.charge).toBe(0);
  });
});

describe("taking a blow", () => {
  it("is shoved away from the attacker and pops, and both die away", () => {
    const f = new FigurePose();
    f.hit(0, 1000);
    const first = copy(f.sample(1000, 1, -1, 0));
    expect(first.ox).toBeCloseTo(SHOVE_PX, 9);
    expect(first.sx).toBeCloseTo(1 + HIT_POP, 9);
    expect(first.sy).toBeCloseTo(1 + HIT_POP, 9);
    const later = f.sample(1000 + HIT_MS / 2, 1, -1, 0);
    expect(later.ox).toBeLessThan(first.ox);
    expect(later.ox).toBeGreaterThan(0);
    expect(copy(f.sample(1000 + HIT_MS, 1, -1, 0))).toEqual(REST);
  });

  it("pops in place when the direction is not known", () => {
    const f = new FigurePose();
    f.hit(null, 0);
    const p = f.sample(0, 1, -1, 0);
    expect(p.ox).toBe(0);
    expect(p.oy).toBe(0);
    expect(p.sx).toBeCloseTo(1 + HIT_POP, 9);
  });
});

describe("a bow's draw", () => {
  it("leans the archer back from the aim as the string comes back", () => {
    const f = new FigurePose();
    expect(f.sample(0, 1, 0.5, 0).ox).toBeCloseTo(-BOW_LEAN_PX * 0.25, 9);
    expect(f.sample(0, 1, 0.8, 0).ox).toBeCloseTo(-BOW_LEAN_PX * 0.64, 9);
  });

  it("trembles close to full draw and not before", () => {
    const f = new FigurePose();
    const calm = f.sample(0, 1, 0.8, 0).ox;
    expect(f.sample(777, 1, 0.8, 0).ox).toBe(calm);
    const xs = new Set<number>();
    for (let t = 0; t < 400; t += 7) xs.add(f.sample(t, 1, 1, 0).ox);
    const lean = -BOW_LEAN_PX;
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(lean - BOW_SHAKE_PX - 1e-9);
    expect(Math.max(...xs)).toBeLessThanOrEqual(lean + BOW_SHAKE_PX + 1e-9);
    expect(xs.size).toBeGreaterThan(10);
  });

  it("does nothing with no draw", () => {
    expect(new FigurePose().sample(0, 1, -1, 0)).toEqual(REST);
    expect(new FigurePose().sample(0, 1, 0, 0)).toEqual(REST);
  });
});

describe("the motion setting", () => {
  it("is exactly rest at 0, whatever is going on", () => {
    const f = new FigurePose();
    f.windupStart(0, 500, 0, "melee");
    f.hit(0, 100);
    expect(copy(f.sample(250, 0, 1, 0))).toEqual(REST);
  });

  it("still tracks the wand's charge (a glow, not a motion)", () => {
    const f = new FigurePose();
    f.windupStart(0, 500, 0, "wand");
    f.sample(500, 0, -1, 0);
    expect(f.charge).toBeCloseTo(1, 9);
  });

  it("halves every deviation at 0.5", () => {
    const a = new FigurePose();
    const b = new FigurePose();
    for (const f of [a, b]) f.windupStart(0, 400, 0, "melee");
    const full = a.sample(400, 1, -1, 0);
    const half = b.sample(400, 0.5, -1, 0);
    expect(half.ox).toBeCloseTo(full.ox / 2, 9);
    expect(half.rot).toBeCloseTo(full.rot / 2, 9);
    expect(half.sx - 1).toBeCloseTo((full.sx - 1) / 2, 9);
  });

  it("keeps the squash inside sane bounds however much is stacked", () => {
    const f = new FigurePose();
    f.windupStart(0, 100, 0, "melee");
    f.hit(0, 100);
    const p = f.sample(100, 2, -1, 0);
    expect(p.sx).toBeLessThanOrEqual(1.3);
    expect(p.sy).toBeGreaterThanOrEqual(0.75);
  });
});

/** Walks a fighter along +x at `speed` u/s for `ms`, one 16 ms frame at a time, from (x0, 0); returns the events seen. */
function walk(f: FigurePose, x0: number, speed: number, t0: number, ms: number, now0 = t0) {
  const events: string[] = [];
  let x = x0;
  for (let t = 0; t < ms; t += 16) {
    x += (speed * 16) / 1000;
    const e = f.track(x, 0, t0 + t + 16, now0 + t + 16);
    if (e) events.push(e);
  }
  return { events, x };
}

describe("walking: start and stop", () => {
  it("calls a start within a frame or two of moving off, and a stop soon after it ends", () => {
    const f = new FigurePose();
    expect(f.track(0, 0, 0, 0)).toBeNull(); // the first sample only sets the baseline
    const go = walk(f, 0, 170, 0, 400);
    expect(go.events).toEqual(["start"]);
    expect(f.moveAngle).toBeCloseTo(0, 9);
    const halt = walk(f, go.x, 0, 400, 160, 400);
    expect(halt.events).toEqual(["stop"]);
  });

  it("starts a stretch along the walk and ends in a squash, both fading out", () => {
    const f = new FigurePose();
    f.track(0, 0, 0, 0);
    walk(f, 0, 170, 0, 32);
    // The start, a frame or two ago: stretched along x, thinner across.
    const stretch = copy(f.sample(32, 1, -1, 0));
    expect(stretch.sx).toBeGreaterThan(1);
    expect(stretch.sy).toBeLessThan(1);
    expect(copy(f.sample(32 + START_TAU_MS * 12, 1, -1, 0))).toEqual(REST);
  });

  it("squashes along the walk on a stop and swells across it", () => {
    const f = new FigurePose();
    f.track(0, 0, 0, 0);
    const go = walk(f, 0, 170, 0, 400);
    walk(f, go.x, 0, 400, 160, 400);
    const squash = f.sample(400 + 70, 1, -1, 0);
    expect(squash.sx).toBeLessThan(1);
    expect(squash.sy).toBeGreaterThan(1);
  });

  it("stretches along y for a walk down the screen", () => {
    const f = new FigurePose();
    f.track(0, 0, 0, 0);
    let y = 0;
    let started = false;
    for (let t = 16; t <= 64; t += 16) {
      y += 2.72;
      started = f.track(0, y, t, t) === "start" || started;
    }
    expect(started).toBe(true);
    expect(f.moveAngle).toBeCloseTo(Math.PI / 2, 9);
    const p = f.sample(64, 1, -1, 0);
    expect(p.sy).toBeGreaterThan(1);
    expect(p.sx).toBeLessThan(1);
  });

  it("does not call a stop for a stutter in the walk (it never got going)", () => {
    const f = new FigurePose();
    f.track(0, 0, 0, 0);
    const go = walk(f, 0, 170, 0, 48); // a stride or two (the stop is called ~50 ms after it happens, which counts as walking)
    const halt = walk(f, go.x, 0, 48, 160);
    expect(48 + 80).toBeLessThan(MIN_MOVE_MS);
    expect(go.events).toEqual(["start"]);
    expect(halt.events).toEqual([]);
  });

  it("hears nothing from a creep slower than a walk", () => {
    const f = new FigurePose();
    f.track(0, 0, 0, 0);
    expect(walk(f, 0, 30, 0, 2000).events).toEqual([]);
  });

  it("does not stop for a frozen render clock: a hit-stop holds the positions, not the walk", () => {
    const f = new FigurePose();
    f.track(0, 0, 0, 0);
    const go = walk(f, 0, 170, 0, 400);
    // Render time stands still for ~50 ms of frames: same t, same position.
    for (let i = 1; i <= 4; i++) expect(f.track(go.x, 0, 400, 400 + i * 16)).toBeNull();
    // It resumes (and catches up at twice the pace): the walk is still on.
    const rest = walk(f, go.x, 170, 400, 160, 464);
    expect(rest.events).toEqual([]);
  });

  it("restarts rather than measures across a jump (a teleport) or a long gap", () => {
    const f = new FigurePose();
    f.track(0, 0, 0, 0);
    walk(f, 0, 170, 0, 400);
    expect(f.track(2000, 900, 416, 416)).toBeNull(); // far further than a step
    expect(f.track(2000, 900, 416 + 1000, 1416)).toBeNull(); // a second later, standing
    // Starting to walk again afterwards calls a start again.
    expect(walk(f, 2000, 170, 1416, 80, 1416).events).toEqual(["start"]);
  });

  it("holds back a start that comes within EVENT_GAP_MS of a stop (a path that stutters)", () => {
    const f = new FigurePose();
    f.track(0, 0, 0, 0);
    const go = walk(f, 0, 170, 0, 400);
    let x = go.x;
    let t = 400;
    let stoppedAt = -1;
    while (stoppedAt < 0 && t < 800) {
      t += 16;
      if (f.track(x, 0, t, t) === "stop") stoppedAt = t;
    }
    expect(stoppedAt).toBeGreaterThan(0);
    const again: string[] = [];
    while (t < stoppedAt + EVENT_GAP_MS - 16) {
      t += 16;
      x += 2.72;
      const e = f.track(x, 0, t, t);
      if (e) again.push(e);
    }
    expect(again).toEqual([]);
  });

  it("forgets it all on reset (a fighter that left the screen)", () => {
    const f = new FigurePose();
    f.windupStart(0, 500, 0, "melee");
    f.hit(0, 0);
    f.track(0, 0, 0, 0);
    walk(f, 0, 170, 0, 100);
    f.reset();
    expect(copy(f.sample(50, 1, -1, 0))).toEqual(REST);
    // A fresh baseline: the first sample after a reset measures nothing.
    expect(f.track(500, 0, 5000, 5000)).toBeNull();
  });
});
