// The juice on PlayerView and MobView: a walking fighter's body squashes and stretches (not the whole container, so the name and
// the bar stay true), kicks up dust, and takes its anticipation cues. The scene is fake (test/fakes.ts); the parts are found by
// their place in the container each view builds.
import { afterEach, describe, expect, it, vi } from "vitest";
import { WIRE_IDENTITY_MIRRORS } from "@raid/shared";
import type { MobState, PlayerState } from "@raid/shared/schema";
import { MobView } from "../src/render/MobView";
import { PlayerView } from "../src/render/PlayerView";
import { BODY_LIFT } from "../src/render/projection";
import { argsOf, fakeScene, type FakeObject } from "./fakes";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Stands in for the real clock, which the views read (their effects run on it): returns a handle to move it. */
function clock(start = 10000) {
  const c = { now: start };
  vi.spyOn(performance, "now").mockImplementation(() => c.now);
  return c;
}

const PLAYER_KID = { body: 5, held: 9, hpBar: 12, label: 13 } as const;
const MOB_KID = { body: 4, held: 6, hpBar: 8, label: 9 } as const;

function player(over: Partial<Record<keyof PlayerState, unknown>> = {}): PlayerState {
  return {
    name: "Ann", look: 0, x: 0, y: 0, facing: 0, hp: 1000, maxHp: 1000, barrier: 0, status: "alive", faction: "fire", weapon0: "sword",
    weapon1: "", slot: 0, drawStartedAt: 0, readyAt: 0, sig: 0, brand: 0, bounty: 0, immuneUntil: 0, ...WIRE_IDENTITY_MIRRORS, ...over,
  } as unknown as PlayerState;
}

function mob(over: Partial<Record<keyof MobState, unknown>> = {}): MobState {
  return {
    kind: "mob", name: "Grunt", x: 0, y: 0, facing: 0, hp: 300, maxHp: 300, status: "alive", faction: "sentenced", weapon0: "sword",
    weapon1: "", slot: 0, drawStartedAt: 0, readyAt: 0, sig: 0, brand: 0, ...over,
  } as unknown as MobState;
}

function dustSink() {
  const calls: Array<[number, number, number, number]> = [];
  return { calls, sink: { dust: (x: number, y: number, a: number, n: number) => { calls.push([x, y, a, n]); } } };
}

/** Walks along +x at 170 u/s for `ms` of render time; `step(x, t)` draws a frame. */
function walkFrames(step: (x: number, t: number) => void, x0: number, t0: number, ms: number, speed = 170): number {
  let x = x0;
  for (let t = 16; t <= ms; t += 16) {
    x += (speed * 16) / 1000;
    step(x, t0 + t);
  }
  return x;
}

describe("PlayerView juice", () => {
  function setup() {
    const c = clock();
    const { scene, ofKind } = fakeScene();
    const { calls, sink } = dustSink();
    const view = new PlayerView(scene, false, sink);
    const root = ofKind("container")[0]!;
    const kids = root.args[2] as FakeObject[];
    const p = player();
    return {
      c, view, root, calls, kids, body: kids[PLAYER_KID.body]!, held: kids[PLAYER_KID.held]!,
      // Real time (what the views' effects run on) moves with the render time being drawn.
      draw: (x: number, t: number) => { c.now = 10000 + t; view.update(x, 0, p, t, t); },
    };
  }

  it("leaves a standing fighter alone: the body is never moved or scaled", () => {
    const { body, held, root, draw } = setup();
    for (let t = 1000; t < 1500; t += 16) draw(100, t);
    expect(argsOf(body, "setScale")).toEqual([]);
    expect(argsOf(body, "setPosition")).toEqual([]);
    expect(argsOf(held, "setPosition")).toEqual([]);
    expect(root.state.scale).toBeUndefined();
  });

  it("stretches the body along a walk's start (not the container: name and bar keep their shape), with dust behind it", () => {
    const { body, root, calls, kids, draw } = setup();
    draw(0, 1000);
    walkFrames(draw, 0, 1000, 48);
    const [sx, sy] = argsOf(body, "setScale").at(-1) as [number, number];
    expect(sx).toBeGreaterThan(1);
    expect(sy).toBeLessThan(1);
    expect(root.state.scale).toBeUndefined();
    expect(argsOf(kids[PLAYER_KID.label]!, "setScale")).toEqual([]);
    expect(argsOf(kids[PLAYER_KID.hpBar]!, "setPosition")).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]![2]).toBeCloseTo(Math.PI, 6);
  });

  it("squashes it as the walk stops, with dust ahead of it, and comes to rest exactly", () => {
    const { body, calls, draw } = setup();
    draw(0, 1000);
    const x = walkFrames(draw, 0, 1000, 400);
    for (let t = 1416; t < 1650; t += 16) draw(x, t);
    expect(calls.map((c) => c[3])).toEqual([2, 3]);
    const scales = argsOf(body, "setScale");
    expect(scales.some(([sx, sy]) => (sx as number) < 1 && (sy as number) > 1)).toBe(true);
    for (let t = 2000; t < 2200; t += 16) draw(x, t);
    expect(argsOf(body, "setScale").at(-1)).toEqual([1, 1]);
    expect(argsOf(body, "setPosition").at(-1)).toEqual([0, -BODY_LIFT]);
  });

  it("does not take a frozen render clock (a hit-stop) for a stop", () => {
    const { calls, draw } = setup();
    draw(0, 1000);
    const x = walkFrames(draw, 0, 1000, 400);
    for (let i = 0; i < 6; i++) draw(x, 1400); // the world holds: same render time, same place
    walkFrames(draw, x, 1400, 200);
    expect(calls).toHaveLength(1);
  });

  it("winds its weapon back and moves the body on the cues FxView sends, and lets go on a cancel", () => {
    const { c, view, body, held, draw } = setup();
    draw(0, 1000);
    view.cues.windupStart(0, 400, c.now, "melee");
    draw(0, 1400);
    expect(argsOf(body, "setPosition").at(-1)![0] as number).toBeCloseTo(-3.5, 6);
    expect(held.state.rotation as number).toBeLessThan(-0.7);
    view.cues.windupEnd(c.now);
    draw(0, 3400);
    expect(held.state.rotation).toBe(0);
    expect(argsOf(body, "setPosition").at(-1)).toEqual([0, -BODY_LIFT]);
  });

  it("drops its cues when it is hidden (down), so none comes back with it", () => {
    const { c, view, held, draw } = setup();
    draw(0, 1000);
    view.cues.windupStart(0, 400, c.now, "melee");
    view.update(0, 0, player({ status: "dead" }), 1016, 1016);
    draw(0, 1500);
    expect(held.state.rotation).toBe(0);
  });
});

describe("MobView juice", () => {
  function setup() {
    const c = clock();
    const { scene, ofKind } = fakeScene();
    const { calls, sink } = dustSink();
    const view = new MobView(scene, sink);
    const root = ofKind("container")[0]!;
    const kids = root.args[2] as FakeObject[];
    const m = mob();
    return {
      view, root, calls, kids, body: kids[MOB_KID.body]!,
      draw: (x: number, t: number) => { c.now = 10000 + t; view.update(x, 0, m, t, t); },
    };
  }

  it("squashes a walking mob's body and raises dust, and leaves its root (fade and scale) alone", () => {
    const { body, root, calls, draw } = setup();
    draw(0, 1000);
    const x = walkFrames(draw, 0, 1000, 400);
    expect(argsOf(body, "setScale").length).toBeGreaterThan(0);
    for (let t = 1416; t < 1650; t += 16) draw(x, t);
    expect(calls.map((c) => c[3])).toEqual([2, 3]);
    expect(root.state.scale).toBeUndefined();
    expect(root.state.alpha).toBeUndefined();
  });

  it("works without a dust sink and takes cues", () => {
    clock();
    const { scene } = fakeScene();
    const view = new MobView(scene);
    view.update(0, 0, mob(), 1000, 1000);
    expect(() => {
      view.cues.launch(0, performance.now());
      view.cues.swing(0, performance.now());
      view.update(0, 0, mob(), 1016, 1016);
    }).not.toThrow();
  });

  it("is quiet while it fades out", () => {
    const { draw, view } = setup();
    draw(0, 1000);
    view.update(0, 0, mob({ status: "dead", hp: 0 }), 1000, 1000);
    expect(() => view.update(0, 0, mob({ status: "dead", hp: 0 }), 2000, 2000)).not.toThrow();
  });
});
