// FigureJuice (render/FigureJuice.ts): the pose on the display objects, the dust on a walk's start and stop, and that a fighter
// at rest costs no calls at all. The parts are fake game objects (test/fakes.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import { PLAYER_RADIUS } from "@raid/shared";
import { FigureJuice, type DustSink, type PosePart } from "../src/render/FigureJuice";
import { WIND_BACK_PX, WIND_CROUCH_Y, WIND_ROT } from "../src/render/figurePose";
import { resetReducedMotionCache } from "../src/render/juice";
import { BODY_LIFT } from "../src/render/projection";
import { argsOf, fakeObject } from "./fakes";

afterEach(() => {
  vi.unstubAllGlobals();
  resetReducedMotionCache();
});

const PIVOT = -BODY_LIFT + PLAYER_RADIUS;

function setup(withDust = true) {
  const body = fakeObject("arc");
  const ring = fakeObject("graphics");
  const held = fakeObject("graphics");
  const aura = fakeObject("graphics");
  const parts: PosePart[] = [
    { obj: body as never, y0: -BODY_LIFT, scaled: true },
    { obj: ring as never, y0: 0, scaled: true },
    { obj: held as never, y0: -BODY_LIFT, scaled: false },
    { obj: aura as never, y0: 0, scaled: false },
  ];
  const art = { pull: -1, poseRot: 0, charge: -1, setCharge(c: number) { this.charge = c; } };
  const dust: Array<[number, number, number, number]> = [];
  const puffs: DustSink = { dust: (x, y, a, n) => { dust.push([x, y, a, n]); } };
  const fig = new FigureJuice(parts, art as never, withDust ? puffs : undefined);
  return { fig, body, ring, held, aura, art, dust };
}

describe("FigureJuice", () => {
  it("makes no call on any part for a fighter at rest", () => {
    const { fig, body, ring, held, aura, art } = setup();
    for (let i = 0; i < 5; i++) fig.frame(100, 100, 0, 1000 + i * 16, 5000 + i * 16);
    for (const part of [body, ring, held, aura]) expect(part.calls).toEqual([]);
    expect(art.poseRot).toBe(0);
    expect(art.charge).toBe(0);
  });

  it("poses a wound-up fighter: the disc and its rings move and squash, the weapon and aura only follow and the weapon turns back", () => {
    const { fig, body, ring, held, aura, art } = setup();
    fig.pose.windupStart(0, 400, 0, "melee");
    fig.frame(100, 100, 0, 1000, 400);
    const sy = 1 - WIND_CROUCH_Y;
    const ox = -WIND_BACK_PX;
    // A disc (rest y = -BODY_LIFT) squashes about the bottom of the body disc.
    expect(argsOf(body, "setPosition")).toHaveLength(1);
    const [bx, by] = argsOf(body, "setPosition")[0] as [number, number];
    expect(bx).toBeCloseTo(ox, 9);
    expect(by).toBeCloseTo(PIVOT * (1 - sy) - BODY_LIFT * sy, 9);
    expect(argsOf(body, "setScale")[0]![1]).toBeCloseTo(sy, 9);
    // A graphics drawn round the body from its own origin gets the matching shift, so it stays round the disc.
    const [, ry] = argsOf(ring, "setPosition")[0] as [number, number];
    expect(ry + -BODY_LIFT * sy).toBeCloseTo(by, 9);
    // The weapon does not scale (it turns on its own axis): it moves to where the disc's centre went, and turns.
    expect(argsOf(held, "setScale")).toEqual([]);
    const [hx, hy] = argsOf(held, "setPosition")[0] as [number, number];
    expect(hx).toBeCloseTo(ox, 9);
    expect(hy).toBeCloseTo(by, 9);
    expect(art.poseRot).toBeCloseTo(-WIND_ROT, 9);
    // The aura layer (origin 0, drawn round the body) follows without scaling.
    expect(argsOf(aura, "setScale")).toEqual([]);
    const [, ay] = argsOf(aura, "setPosition")[0] as [number, number];
    expect(ay - BODY_LIFT).toBeCloseTo(by, 9);
  });

  it("does not touch the parts again while the pose stands", () => {
    const { fig, body } = setup();
    fig.pose.windupStart(0, 400, 0, "melee");
    fig.frame(0, 0, 0, 1000, 400);
    fig.frame(0, 0, 0, 1016, 400); // the peak holds: the pose has not moved
    const n = body.calls.length;
    fig.frame(0, 0, 0, 1032, 400);
    expect(body.calls.length).toBe(n);
  });

  it("settles exactly back onto rest, once", () => {
    const { fig, body, held } = setup();
    fig.pose.hit(0, 0);
    fig.frame(0, 0, 0, 1000, 0);
    expect(argsOf(body, "setPosition").length).toBeGreaterThan(0);
    fig.frame(0, 0, 0, 1016, 1000); // long after: the hit is over
    expect(argsOf(body, "setPosition").pop()).toEqual([0, -BODY_LIFT]);
    expect(argsOf(body, "setScale").pop()).toEqual([1, 1]);
    expect(argsOf(held, "setPosition").pop()).toEqual([0, -BODY_LIFT]);
    const n = body.calls.length;
    fig.frame(0, 0, 0, 1032, 1016);
    expect(body.calls.length).toBe(n);
  });

  it("hands the weapon art the turn, the bow's draw to lean on, and the wand's charge", () => {
    const { fig, art } = setup();
    fig.pose.windupStart(0, 400, 0, "wand");
    fig.frame(0, 0, 0, 1000, 200);
    expect(art.charge).toBeCloseTo(0.5, 9);
    fig.pose.windupEnd(200);
    art.pull = 0.8;
    fig.frame(0, 0, 0, 1016, 10000);
    expect(art.charge).toBe(0);
  });

  it("kicks up dust behind a walk's start and rolls it on ahead of its stop", () => {
    const { fig, dust } = setup();
    fig.frame(0, 0, 0, 0, 0);
    let x = 0;
    let t = 0;
    for (; t < 400; t += 16) {
      x += 2.72;
      fig.frame(x, 0, 0, t + 16, t + 16);
    }
    expect(dust).toHaveLength(1);
    expect(dust[0]![2]).toBeCloseTo(Math.PI, 9); // behind a walk toward +x
    expect(dust[0]![3]).toBe(2);
    for (let i = 0; i < 12; i++) fig.frame(x, 0, 0, t + 16 * (i + 1), t + 16 * (i + 1));
    expect(dust).toHaveLength(2);
    expect(dust[1]![2]).toBeCloseTo(0, 9);
    expect(dust[1]![3]).toBe(3);
    expect(dust[1]![0]).toBeCloseTo(x, 9);
  });

  it("raises no dust and strikes no pose under reduced motion, and copes without a dust sink", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { fig, dust, body } = setup();
    fig.frame(0, 0, 0, 0, 0);
    let x = 0;
    for (let t = 0; t < 400; t += 16) {
      x += 2.72;
      fig.frame(x, 0, 0, t + 16, t + 16);
    }
    expect(dust).toEqual([]);
    expect(body.calls).toEqual([]);
    vi.unstubAllGlobals();
    resetReducedMotionCache();
    const bare = setup(false);
    bare.fig.frame(0, 0, 0, 0, 0);
    expect(() => { for (let t = 16; t < 400; t += 16) bare.fig.frame(t * 0.17, 0, 0, t, t); }).not.toThrow();
  });

  it("drops its cues on reset", () => {
    const { fig, held } = setup();
    fig.pose.windupStart(0, 400, 0, "melee");
    fig.frame(0, 0, 0, 1000, 400);
    fig.reset();
    fig.frame(0, 0, 0, 1016, 400);
    expect(argsOf(held, "setPosition").pop()).toEqual([0, -BODY_LIFT]);
  });
});
