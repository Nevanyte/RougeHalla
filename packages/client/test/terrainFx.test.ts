// The animated terrain overlays and particles (render/zoneArt/TerrainFx.ts): the plan (which tiles pulse, which emit, where the
// beams stand), the closed-form maths (pulses within the photosensitivity limits, particles bounded and periodic), the caps, and
// the gating by the juice settings, on a fake scene.
import { afterEach, describe, expect, it } from "vitest";
import {
  TERRAIN_BOG, TERRAIN_EMBER, TERRAIN_ICE, TERRAIN_LAVA, TERRAIN_LIGHT, TILE, TILE_FLOOR, TILE_LOW, TILE_WALL, ZONE_PROP, mapFromTiles,
  type GameMap,
} from "@raid/shared";
import { updateSettings, DEFAULT_SETTINGS } from "../src/settings";
import { resetReducedMotionCache } from "../src/render/juice";
import { CHUNK_TILES } from "../src/render/zoneArt/bake";
import {
  FX_BUCKETS, MAX_PULSE_HZ, MAX_PULSE_SWING, PARTICLE_CAP_PER_KIND, PARTICLE_CAP_TOTAL, PARTICLES_PER_EMITTER, PULSE, TerrainFx,
  bucketAlpha, emitterBudget, emittersInView, particleAt, planFx, type Emitter, type Particle, type ParticleKind,
} from "../src/render/zoneArt/TerrainFx";
import { TILE_H, TILE_W } from "../src/render/zoneArt/zoneStyle";
import { fakeScene, type FakeObject } from "./fakes";

afterEach(() => {
  updateSettings({ juice: DEFAULT_SETTINGS.juice, reducedMotion: DEFAULT_SETTINGS.reducedMotion });
  resetReducedMotionCache();
});

/** A w x h map with `fill` painting [x, y, w, h, tile, kind] rectangles over floor, a wall border and a fixed seed. */
function terrainMap(w: number, h: number, rects: ReadonlyArray<readonly [number, number, number, number, number, number]>, props: GameMap["props"] = []): GameMap {
  const tiles = new Uint8Array(w * h).fill(TILE_FLOOR);
  const terrain = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) { tiles[x] = TILE_WALL; tiles[(h - 1) * w + x] = TILE_WALL; }
  for (let y = 0; y < h; y++) { tiles[y * w] = TILE_WALL; tiles[y * w + w - 1] = TILE_WALL; }
  for (const [x0, y0, rw, rh, t, k] of rects) for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) { tiles[y * w + x] = t; terrain[y * w + x] = k; }
  const map = mapFromTiles(w, h, tiles, 11, terrain);
  map.props = props;
  return map;
}

describe("the pulse numbers", () => {
  it("never beat faster than 1.2 Hz or swing the alpha by more than 0.25 (photosensitivity)", () => {
    for (const [name, spec] of Object.entries(PULSE)) {
      expect(spec.hz, name).toBeLessThanOrEqual(MAX_PULSE_HZ);
      expect(spec.hz, name).toBeGreaterThan(0);
      expect(spec.hi - spec.lo, name).toBeLessThanOrEqual(MAX_PULSE_SWING + 1e-9);
      expect(spec.lo, name).toBeGreaterThanOrEqual(0);
      expect(spec.hi, name).toBeLessThanOrEqual(1);
    }
  });

  it("matches the design table (lava 0.15-0.30 at 0.6 Hz, ember 0.2-0.35 at 1.2 Hz, ice 0-0.25 at 0.4 Hz, light 0.25-0.4 at 0.3 Hz)", () => {
    expect(PULSE.lava).toEqual({ hz: 0.6, lo: 0.15, hi: 0.3 });
    expect(PULSE.ember).toEqual({ hz: 1.2, lo: 0.2, hi: 0.35 });
    expect(PULSE.ice).toEqual({ hz: 0.4, lo: 0, hi: 0.25 });
    expect(PULSE.light).toEqual({ hz: 0.3, lo: 0.25, hi: 0.4 });
  });
});

describe("bucketAlpha", () => {
  it("stays inside the pulse's range, times the flash scale, over a whole period", () => {
    for (const spec of Object.values(PULSE)) {
      for (let t = 0; t < 4000; t += 37) {
        for (let b = 0; b < FX_BUCKETS; b++) {
          const a = bucketAlpha(spec, t, b, 1);
          expect(a).toBeGreaterThanOrEqual(spec.lo - 1e-9);
          expect(a).toBeLessThanOrEqual(spec.hi + 1e-9);
          expect(bucketAlpha(spec, t, b, 0.5)).toBeCloseTo(a / 2, 9);
        }
      }
    }
  });

  it("is zero when the flash scale is zero, and holds still at the middle without motion", () => {
    const spec = PULSE.lava;
    expect(bucketAlpha(spec, 123, 2, 0)).toBe(0);
    const mid = (spec.lo + spec.hi) / 2;
    for (let t = 0; t < 3000; t += 250) expect(bucketAlpha(spec, t, 1, 1, 0)).toBeCloseTo(mid, 9);
  });

  it("puts the four buckets a quarter period apart, and repeats every period", () => {
    const spec = PULSE.lava;
    const at = (b: number) => bucketAlpha(spec, 100, b, 1);
    expect(new Set([0, 1, 2, 3].map((b) => at(b).toFixed(6))).size).toBe(4);
    const period = 1000 / spec.hz;
    expect(bucketAlpha(spec, 100 + period, 2, 1)).toBeCloseTo(bucketAlpha(spec, 100, 2, 1), 9);
  });
});

describe("planFx", () => {
  it("puts every lava and ember tile in a group of its chunk, split over the four buckets", () => {
    const map = terrainMap(40, 40, [[3, 3, 12, 3, TILE_LOW, TERRAIN_LAVA], [20, 20, 10, 4, TILE_FLOOR, TERRAIN_EMBER]]);
    const plan = planFx(map);
    for (const [kind, count] of [["lava", 36], ["ember", 40]] as const) {
      const groups = plan.groups.filter((g) => g.kind === kind);
      expect(groups.reduce((n, g) => n + g.tiles.length, 0)).toBe(count);
      for (const g of groups) {
        expect(g.bucket).toBeGreaterThanOrEqual(0);
        expect(g.bucket).toBeLessThan(FX_BUCKETS);
        for (const i of g.tiles) {
          expect(Math.floor((i % map.w) / CHUNK_TILES)).toBe(g.cx);
          expect(Math.floor(Math.floor(i / map.w) / CHUNK_TILES)).toBe(g.cy);
        }
      }
      expect(new Set(groups.map((g) => g.bucket)).size).toBe(FX_BUCKETS);
    }
  });

  it("animates about half of the bog and a third of the ice, and no tile twice", () => {
    const map = terrainMap(60, 60, [[2, 2, 40, 20, TILE_FLOOR, TERRAIN_BOG], [2, 30, 40, 20, TILE_FLOOR, TERRAIN_ICE]]);
    const plan = planFx(map);
    const n = (kind: string) => plan.groups.filter((g) => g.kind === kind).reduce((a, g) => a + g.tiles.length, 0);
    expect(n("bog")).toBeGreaterThan(800 * 0.35);
    expect(n("bog")).toBeLessThan(800 * 0.65);
    expect(n("ice")).toBeGreaterThan(800 * 0.2);
    expect(n("ice")).toBeLessThan(800 * 0.45);
    const all = plan.groups.flatMap((g) => g.tiles);
    expect(new Set(all).size).toBe(all.length);
  });

  it("ignores hand-built maps with no terrain, and a LOW fence or crevasse (they have no overlay)", () => {
    expect(planFx(terrainMap(20, 20, [])).groups).toEqual([]);
    expect(planFx(terrainMap(20, 20, [[4, 4, 5, 1, TILE_LOW, 2], [4, 8, 5, 1, TILE_LOW, 3]])).groups).toEqual([]);
  });

  it("stands one beam per connected pool of light, over the pool's width, with its own bucket", () => {
    const map = terrainMap(40, 30, [[4, 4, 3, 3, TILE_FLOOR, TERRAIN_LIGHT], [20, 10, 3, 3, TILE_FLOOR, TERRAIN_LIGHT], [30, 20, 1, 1, TILE_FLOOR, TERRAIN_LIGHT]]);
    const plan = planFx(map);
    expect(plan.beams).toHaveLength(3);
    const big = plan.beams.find((b) => b.tx0 === 4)!;
    expect(big.tx1).toBe(6);
    expect(big.ty1).toBe(6);
    expect(big.x).toBeCloseTo(5.5 * TILE_W, 6);
    expect(big.w).toBeGreaterThan(2 * TILE_W);
    expect(big.w).toBeLessThanOrEqual(3 * TILE_W);
    expect(big.baseY).toBeLessThanOrEqual(7 * TILE_H);
    expect(new Set(plan.beams.map((b) => b.bucket)).size).toBe(3);
  });

  it("makes emitters from floor kinds and the three emitting props, props first, deterministic", () => {
    const props = [
      { kind: ZONE_PROP.ember_vent!, x: 9 * TILE + 16, y: 9 * TILE + 16, v: 0 },
      { kind: ZONE_PROP.bubble!, x: 12 * TILE + 16, y: 12 * TILE + 16, v: 0 },
      { kind: ZONE_PROP.frost_sparkle!, x: 14 * TILE + 16, y: 14 * TILE + 16, v: 0 },
      { kind: ZONE_PROP.banner!, x: 5 * TILE + 16, y: 5 * TILE + 16, v: 0 },
    ];
    const map = terrainMap(60, 40, [[20, 5, 20, 10, TILE_FLOOR, TERRAIN_EMBER], [20, 20, 20, 10, TILE_FLOOR, TERRAIN_BOG], [2, 20, 10, 10, TILE_FLOOR, TERRAIN_ICE], [45, 5, 9, 9, TILE_FLOOR, TERRAIN_LIGHT]], props);
    const plan = planFx(map);
    expect(plan.emitters.ember.length).toBeGreaterThan(5);
    expect(plan.emitters.spore.length).toBeGreaterThan(5);
    expect(plan.emitters.frost.length).toBeGreaterThan(3);
    expect(plan.emitters.mote.length).toBeGreaterThan(10);
    // The vent leads the embers: it ranks ahead of every tile.
    expect(plan.emitters.ember[0]).toMatchObject({ x: 9 * TILE + 16 });
    expect(plan.emitters.spore[0]).toMatchObject({ x: 12 * TILE + 16 });
    expect(plan.emitters.frost[0]).toMatchObject({ x: 14 * TILE + 16 });
    expect(JSON.stringify(planFx(map))).toBe(JSON.stringify(plan));
    for (const list of Object.values(plan.emitters)) for (const e of list) { expect(e.phase).toBeGreaterThanOrEqual(0); expect(e.phase).toBeLessThanOrEqual(1); }
  });
});

describe("particleAt", () => {
  const e: Emitter = { x: 500, y: 300, phase: 0.3 };
  const kinds: readonly ParticleKind[] = ["ember", "spore", "frost", "mote"];
  const out = (): Particle => ({ x: 0, y: 0, alpha: 0, r: 0 });

  it("stays near its emitter, bright between 0 and 1, with a positive size, at any time", () => {
    for (const k of kinds) {
      for (let t = 0; t < 9000; t += 123) {
        for (let i = 0; i < PARTICLES_PER_EMITTER; i++) {
          const p = particleAt(k, e, t, i, PARTICLES_PER_EMITTER, 1, out());
          const why = `${k} t=${t} i=${i}`;
          expect(Math.abs(p.x - e.x), why).toBeLessThan(16);
          expect(p.y, why).toBeLessThanOrEqual(e.y);
          expect(e.y - p.y, why).toBeLessThan(48);
          expect(p.alpha, why).toBeGreaterThanOrEqual(0);
          expect(p.alpha, why).toBeLessThanOrEqual(1);
          expect(p.r, why).toBeGreaterThan(0);
        }
      }
    }
  });

  it("is a closed-form function of time: periodic, and the three particles of an emitter are spread over its life", () => {
    for (const k of kinds) {
      const a = particleAt(k, e, 1000, 0, 3, 1, out());
      const b = particleAt(k, e, 1000, 1, 3, 1, out());
      expect(a.y === b.y && a.x === b.x).toBe(false);
      const again = particleAt(k, e, 1000, 0, 3, 1, out());
      expect(again).toEqual(a);
    }
  });

  it("stops moving (but may still fade) when drift is 0", () => {
    for (const k of ["ember", "spore", "mote"] as const) {
      const ys = new Set<number>();
      for (let t = 0; t < 3000; t += 100) ys.add(particleAt(k, e, t, 0, 3, 0, out()).y);
      expect(ys.size, k).toBe(1);
    }
  });

  it("rises: an ember is higher late in its life than early", () => {
    const early = particleAt("ember", { x: 0, y: 0, phase: 0 }, 0, 0, 3, 1, out());
    const late = particleAt("ember", { x: 0, y: 0, phase: 0 }, 1400, 0, 3, 1, out());
    expect(late.y).toBeLessThan(early.y);
  });
});

describe("the caps", () => {
  it("gives a kind at most 24 particles' worth of emitters and all kinds together at most 40", () => {
    expect(emitterBudget(0) * PARTICLES_PER_EMITTER).toBeLessThanOrEqual(PARTICLE_CAP_PER_KIND);
    let used = 0;
    for (let k = 0; k < 4; k++) {
      const room = emitterBudget(used);
      expect(room * PARTICLES_PER_EMITTER).toBeLessThanOrEqual(PARTICLE_CAP_PER_KIND);
      used += room * PARTICLES_PER_EMITTER;
      expect(used).toBeLessThanOrEqual(PARTICLE_CAP_TOTAL);
    }
    expect(emitterBudget(PARTICLE_CAP_TOTAL)).toBe(0);
    expect(emitterBudget(PARTICLE_CAP_TOTAL - 4)).toBe(1);
  });

  it("takes the first emitters in priority order that lie in view, up to the budget", () => {
    const list: Emitter[] = Array.from({ length: 30 }, (_, i) => ({ x: i * 10, y: 50, phase: 0 }));
    const out: Emitter[] = [];
    expect(emittersInView(list, 55, 0, 200, 100, 4, out).map((e) => e.x)).toEqual([60, 70, 80, 90]);
    expect(emittersInView(list, 0, 0, 1000, 10, 4, out)).toEqual([]);
    expect(emittersInView(list, 0, 0, 1000, 100, 99, out)).toHaveLength(30);
  });
});

describe("TerrainFx on a fake scene", () => {
  const map = terrainMap(40, 30, [
    [3, 3, 12, 3, TILE_LOW, TERRAIN_LAVA], [20, 3, 10, 4, TILE_FLOOR, TERRAIN_EMBER], [3, 14, 10, 6, TILE_FLOOR, TERRAIN_BOG],
    [20, 14, 3, 3, TILE_FLOOR, TERRAIN_LIGHT],
  ]);
  const wholeMap = { left: 0, top: 0, right: 40 * TILE, bottom: 30 * TILE };

  function build() {
    const { scene, made } = fakeScene();
    const fx = new TerrainFx(scene, map);
    return { fx, made: made.filter((o) => o.kind === "graphics") };
  }

  it("builds one Graphics per group, per beam and per kind that has emitters, all hidden until shown", () => {
    const { fx, made } = build();
    const plan = planFx(map);
    const kindsWithEmitters = Object.values(plan.emitters).filter((l) => l.length > 0).length;
    expect(made).toHaveLength(plan.groups.length + plan.beams.length + kindsWithEmitters);
    expect(fx.stats.overlayGraphics).toBe(plan.groups.length);
    expect(fx.stats.beams).toBe(1);
    for (const g of made) expect(g.state.visible).toBe(false);
  });

  it("draws each overlay once at build and never again: a frame only sets alpha and visibility", () => {
    const { fx, made } = build();
    const overlays = made.slice(0, fx.stats.overlayGraphics + fx.stats.beams);
    const drawing = (g: FakeObject): number => g.calls.filter(([n]) => !n.startsWith("set")).length;
    const before = overlays.map(drawing);
    expect(before.every((n) => n > 0)).toBe(true);
    for (let t = 0; t < 2000; t += 16) fx.update(t, wholeMap);
    expect(overlays.map(drawing)).toEqual(before);
    for (const g of overlays) {
      expect(g.clears).toBe(0);
      expect(g.state.visible).toBe(true);
    }
  });

  it("shows only the groups in view, and hides them again when the camera leaves", () => {
    const { fx, made } = build();
    fx.update(0, { left: 0, top: 0, right: 12 * TILE, bottom: 8 * TILE_H });
    const lavaView = made.slice(0, fx.stats.overlayGraphics).filter((g) => g.state.visible === true).length;
    expect(lavaView).toBeGreaterThan(0);
    expect(lavaView).toBeLessThan(fx.stats.overlayGraphics);
    fx.update(16, { left: 5000, top: 5000, right: 6000, bottom: 6000 });
    expect(made.slice(0, fx.stats.overlayGraphics).every((g) => g.state.visible === false)).toBe(true);
  });

  it("pulses each bucket out of step", () => {
    const { fx, made } = build();
    fx.update(300, wholeMap);
    const alphas = new Set(made.slice(0, fx.stats.overlayGraphics).map((g) => (g.state.alpha as number).toFixed(5)));
    expect(alphas.size).toBeGreaterThan(3);
  });

  it("draws particles only for emitters in view, and clears them when the view empties", () => {
    const { fx, made } = build();
    const particleGs = made.slice(fx.stats.overlayGraphics + fx.stats.beams);
    fx.update(500, wholeMap);
    expect(particleGs.some((g) => g.state.visible === true)).toBe(true);
    for (const g of particleGs.filter((g) => g.state.visible === true)) {
      const circles = g.calls.filter(([n]) => n === "fillCircle").length + g.calls.filter(([n]) => n === "lineBetween").length / 2;
      expect(circles).toBeLessThanOrEqual(PARTICLE_CAP_PER_KIND);
    }
    const total = particleGs.reduce((n, g) => n + g.calls.filter(([c]) => c === "fillCircle").length + g.calls.filter(([c]) => c === "lineBetween").length / 2, 0);
    expect(total).toBeLessThanOrEqual(PARTICLE_CAP_TOTAL);
    fx.update(516, { left: 9000, top: 9000, right: 9100, bottom: 9100 });
    expect(particleGs.every((g) => g.state.visible === false)).toBe(true);
  });

  it("shows nothing at juice 0 (the baked art only) and nothing when told to hide", () => {
    const { fx, made } = build();
    updateSettings({ juice: 0 });
    fx.update(100, wholeMap);
    expect(made.every((g) => g.state.visible !== true)).toBe(true);
    updateSettings({ juice: 1 });
    fx.update(200, wholeMap);
    expect(made.some((g) => g.state.visible === true)).toBe(true);
    fx.setVisible(false);
    expect(made.every((g) => g.state.visible !== true)).toBe(true);
    fx.update(300, wholeMap);
    expect(made.every((g) => g.state.visible !== true)).toBe(true);
    fx.setVisible(true);
    fx.update(400, wholeMap);
    expect(made.some((g) => g.state.visible === true)).toBe(true);
  });

  it("under reduced motion holds the overlays still at the middle of their range and draws no particle", () => {
    const { fx, made } = build();
    updateSettings({ reducedMotion: true });
    const overlays = made.slice(0, fx.stats.overlayGraphics);
    fx.update(0, wholeMap);
    const first = overlays.map((g) => g.state.alpha);
    fx.update(777, wholeMap);
    expect(overlays.map((g) => g.state.alpha)).toEqual(first);
    for (const g of overlays) expect(g.state.alpha as number).toBeGreaterThan(0);
    const particleGs = made.slice(fx.stats.overlayGraphics + fx.stats.beams);
    expect(particleGs.every((g) => g.state.visible !== true)).toBe(true);
  });

  it("destroys everything", () => {
    const { fx, made } = build();
    fx.destroy();
    expect(made.every((g) => g.calls.some(([n]) => n === "destroy"))).toBe(true);
  });
});
