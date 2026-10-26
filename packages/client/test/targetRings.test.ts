// TargetRings (render/TargetRings.ts): the lock ring's pulse when it lands on a new fighter, its breathing and the flash ring.
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetReducedMotionCache } from "../src/render/juice";
import { LOCK_BREATH_SCALE, LOCK_PULSE_FROM, LOCK_PULSE_MS, TargetRings } from "../src/render/TargetRings";
import { fakeScene } from "./fakes";

afterEach(() => {
  vi.unstubAllGlobals();
  resetReducedMotionCache();
});

function setup() {
  const { scene, ofKind } = fakeScene();
  const rings = new TargetRings(scene);
  const [hover, lock, flash] = ofKind("graphics");
  return { rings, hover: hover!, lock: lock!, flash: flash! };
}

const at = (x: number, y: number) => ({ x, y });
const scaleOf = (g: { state: Record<string, unknown> }) => (g.state.scale ?? 1) as number;

describe("the lock ring's pulse", () => {
  it("lands on a new lock big and bright, and settles to its own size in LOCK_PULSE_MS", () => {
    const { rings, lock, flash } = setup();
    rings.update(null, at(100, 100), "foe", 1000);
    expect(scaleOf(lock)).toBeGreaterThanOrEqual(LOCK_PULSE_FROM);
    expect(flash.state.visible).toBe(true);
    expect(flash.state.alpha).toBeCloseTo(1, 9);
    expect(scaleOf(flash)).toBe(scaleOf(lock));
    rings.update(null, at(100, 100), "foe", 1000 + LOCK_PULSE_MS / 2);
    expect(scaleOf(lock)).toBeLessThan(LOCK_PULSE_FROM);
    expect(scaleOf(lock)).toBeGreaterThan(1 + LOCK_BREATH_SCALE);
    expect(flash.state.alpha).toBeLessThan(1);
    rings.update(null, at(100, 100), "foe", 1000 + LOCK_PULSE_MS);
    expect(scaleOf(lock)).toBeLessThanOrEqual(1 + LOCK_BREATH_SCALE + 1e-9);
    expect(flash.state.visible).toBe(false);
  });

  it("does not pulse again for the same fighter, however often the ring is updated or moved", () => {
    const { rings, lock, flash } = setup();
    rings.update(null, at(100, 100), "foe", 1000);
    rings.update(null, at(120, 100), "foe", 1500);
    expect(scaleOf(lock)).toBeLessThanOrEqual(1 + LOCK_BREATH_SCALE + 1e-9);
    expect(flash.state.visible).toBe(false);
  });

  it("pulses when the lock moves to another fighter, and when it comes back after being dropped", () => {
    const { rings, lock, flash } = setup();
    rings.update(null, at(100, 100), "foe", 1000);
    rings.update(null, at(100, 100), "foe", 2000);
    rings.update(null, at(200, 100), "other", 2016);
    expect(scaleOf(lock)).toBeGreaterThan(1.5);
    expect(flash.state.visible).toBe(true);
    rings.update(null, at(200, 100), "other", 3000);
    rings.update(null, null, "", 3016);
    expect(lock.state.visible).toBe(false);
    expect(flash.state.visible).toBe(false);
    rings.update(null, at(200, 100), "other", 4000);
    expect(scaleOf(lock)).toBeGreaterThan(1.5);
  });

  it("sits on the fighter it marks, the flash ring with it", () => {
    const { rings, lock, flash } = setup();
    rings.update(null, at(100, 50), "foe", 1000);
    expect(lock.state.position).toEqual([100, 40]);
    expect(flash.state.position).toEqual([100, 40]);
    expect(flash.state.depth).toBeGreaterThan(lock.state.depth as number);
  });

  it("breathes: the ring swells and fades slowly and stays near its size", () => {
    const { rings, lock } = setup();
    rings.update(null, at(0, 0), "foe", 0);
    const scales = new Set<number>();
    const alphas = new Set<number>();
    for (let t = 1000; t < 4000; t += 100) {
      rings.update(null, at(0, 0), "foe", t);
      scales.add(scaleOf(lock));
      alphas.add(lock.state.alpha as number);
    }
    expect(Math.min(...scales)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...scales)).toBeLessThanOrEqual(1 + LOCK_BREATH_SCALE + 1e-9);
    expect(Math.max(...scales)).toBeGreaterThan(1 + LOCK_BREATH_SCALE / 2);
    expect(Math.min(...alphas)).toBeGreaterThanOrEqual(0.8 - 1e-9);
    expect(Math.max(...alphas)).toBeLessThanOrEqual(1);
  });

  it("under reduced motion the ring does not scale (no pulse, no breathing), but the flash ring still shows", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { rings, lock, flash } = setup();
    rings.update(null, at(0, 0), "foe", 1000);
    expect(scaleOf(lock)).toBe(1);
    expect(flash.state.visible).toBe(true);
    expect(scaleOf(flash)).toBe(1);
    rings.update(null, at(0, 0), "foe", 1090);
    expect(scaleOf(lock)).toBe(1);
  });

  it("keeps working for callers that give no id (no pulse, the ring just sits)", () => {
    const { rings, lock, flash } = setup();
    rings.update(null, at(0, 0));
    expect(lock.state.visible).toBe(true);
    expect(flash.state.visible).toBe(false);
  });

  it("still hides and shows the hover ring on its own", () => {
    const { rings, hover } = setup();
    rings.update(at(10, 10), null, "", 0);
    expect(hover.state.visible).toBe(true);
    rings.update(null, null, "", 16);
    expect(hover.state.visible).toBe(false);
  });
});
