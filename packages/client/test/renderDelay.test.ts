import { describe, expect, it } from "vitest";
import { INTERP_DELAY_MS, mulberry32, PATCH_MS } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { EntityInterpolator } from "../src/net/interpolation";

/** The bits of a RaidState the interpolator reads. */
function fakeState(t: number, players: Record<string, { x: number; y: number }>): RaidState {
  const map = (o: Record<string, { x: number; y: number }>) => ({
    forEach: (f: (v: { x: number; y: number }, k: string) => void) => { for (const [k, v] of Object.entries(o)) f(v, k); },
    has: (k: string) => k in o,
  });
  return { serverTime: t, players: map(players), mobs: map({}) } as unknown as RaidState;
}

/** A fighter walking +x at 170 u/s, patches every 50 ms with `base` + jitter of delay; frames at 144 Hz. */
function drive(it: EntityInterpolator, seconds: number, jitter: number, seed: number): { frozen: number; frames: number; backwards: number } {
  const rng = mulberry32(seed);
  const arrivals: Array<{ at: number; t: number }> = [];
  let last = 0;
  for (let i = 0; i < seconds * 20; i++) {
    const t = 1000 + i * PATCH_MS;
    let at = 500 + i * PATCH_MS + 15 - jitter * Math.log(1 - rng());
    if (at < last) at = last;
    last = at;
    arrivals.push({ at, t });
  }
  let k = 0;
  let prevR = NaN;
  let frozen = 0;
  let frames = 0;
  let backwards = 0;
  let prevX = NaN;
  const out = { x: 0, y: 0 };
  for (let now = arrivals[0]!.at; now < arrivals[arrivals.length - 1]!.at; now += 1000 / 144) {
    while (k < arrivals.length && arrivals[k]!.at <= now) {
      const { t, at } = arrivals[k]!;
      it.onPatch(fakeState(t, { a: { x: (t - 1000) * 0.17, y: 0 } }), at);
      k++;
    }
    const r = it.renderTime(now);
    if (now > 8000) {
      frames++;
      if (r < prevR) backwards++;
      it.sample("a", r, out);
      if (Math.abs(out.x - prevX) < 0.01) frozen++;
      prevX = out.x;
    }
    prevR = r;
  }
  return { frozen, frames, backwards };
}

describe("EntityInterpolator", () => {
  it("is adaptive by default: it trails the clock by the initial delay at first and the network's delay later", () => {
    const it = new EntityInterpolator();
    expect(it.delayMs).toBe(INTERP_DELAY_MS);
    drive(it, 20, 3, 1);
    // A steady stream: well under the fixed 100 ms, never under the lower bound.
    expect(it.delayMs).toBeLessThan(INTERP_DELAY_MS);
    expect(it.delayMs).toBeGreaterThanOrEqual(69);
    expect(it.targetDelayMs).toBeLessThan(INTERP_DELAY_MS);
  });

  it("`adaptive: false` keeps the fixed 100 ms behind a clock that snaps on late patches", () => {
    const it = new EntityInterpolator({ adaptive: false });
    it.onPatch(fakeState(5000, { a: { x: 1, y: 2 } }), 100);
    expect(it.renderTime(100)).toBe(5000 - INTERP_DELAY_MS);
    expect(it.delayMs).toBe(INTERP_DELAY_MS);
    // 60 ms late: the legacy clock snaps to it, so render time lands 60 ms behind where it would have been.
    it.onPatch(fakeState(5050, { a: { x: 1, y: 2 } }), 100 + 50 + 60);
    expect(it.renderTime(210)).toBe(5050 - INTERP_DELAY_MS);
  });

  it("draws the fighter moving smoothly under jitter: render time never runs backwards", () => {
    const adaptive = drive(new EntityInterpolator(), 40, 8, 5);
    const legacy = drive(new EntityInterpolator({ adaptive: false }), 40, 8, 5);
    expect(adaptive.backwards).toBe(0);
    expect(legacy.backwards).toBeGreaterThan(0);
    // Few frames where the fighter stands still although it walks (the buffer ran dry).
    expect(adaptive.frozen / adaptive.frames).toBeLessThan(0.01);
  });

  it("samples and cuts as before", () => {
    const it = new EntityInterpolator();
    const out = { x: 0, y: 0 };
    expect(it.sample("nobody", 0, out)).toBe(false);
    it.onPatch(fakeState(1000, { a: { x: 0, y: 0 } }), 0);
    it.markCut(1050);
    it.onPatch(fakeState(1050, { a: { x: 10, y: 0 } }), 50); // a cut: held until render time reaches it
    expect(it.sample("a", 1025, out)).toBe(true);
    expect(out.x).toBe(0);
    expect(it.sample("a", 1060, out)).toBe(true);
    expect(out.x).toBe(10);
  });
});
