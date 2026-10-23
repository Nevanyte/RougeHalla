import { describe, expect, it } from "vitest";
import {
  generateMap, isOutside, mulberry32, planZone, RAID_SECONDS, TILE, WORLD_H, WORLD_W, ZONE_DPS,
  ZONE_FINAL_RADIUS, ZONE_HOLD_FRACTION, ZONE_STAGES, ZONE_TIMELINE_FRACTION, zoneAt,
  zoneCircles, zoneDps, type GameMap, type ZoneCircle, type ZonePlan,
} from "../src/index";

const RAID_MS = RAID_SECONDS * 1000;
const STAGE_COUNT = ZONE_STAGES + 1;
const EPS = 1e-9;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** a ⊇ b, with float slack. */
const contains = (a: ZoneCircle, b: ZoneCircle) => a.r - b.r >= dist(a, b) - EPS;

function mapWith(extracts: Array<{ x: number; y: number }>): GameMap {
  const base = generateMap(1);
  return { ...base, extracts: extracts.map((e, i) => ({ id: `e${i}`, name: `e${i}`, x: e.x, y: e.y, r: 64 })) };
}

const maps = [1, 2, 3, 7, 42, 1234, 99999].map((seed) => generateMap(seed));

/** Every (map, rng seed) combination the property tests sweep. */
function* plans(raidMs = RAID_MS): Generator<{ map: GameMap; plan: ZonePlan; label: string }> {
  for (const map of maps) {
    for (let s = 0; s < 40; s++) {
      yield { map, plan: planZone(map, raidMs, mulberry32(s * 7919 + 1)), label: `map ${map.seed} rng ${s}` };
    }
  }
}

/** planZone with a random function whose first draw selects extract `index` of `m`, then follows rng(seed). */
function planZoneWithExtract(m: GameMap, index: number, seed: number): ZonePlan {
  const rng = mulberry32(seed + 1);
  let first = true;
  return planZone(m, RAID_MS, () => {
    if (first) { first = false; return (index + 0.5) / m.extracts.length; }
    return rng();
  });
}

describe("planZone", () => {
  const map = generateMap(1234);

  it("is deterministic for a given random function", () => {
    const a = planZone(map, RAID_MS, mulberry32(5));
    const b = planZone(map, RAID_MS, mulberry32(5));
    expect(a).toEqual(b);
  });

  it("uses only the random function it is given (no Math.random)", () => {
    const real = Math.random;
    Math.random = () => { throw new Error("planZone must not call Math.random"); };
    try {
      expect(() => planZone(map, RAID_MS, mulberry32(5))).not.toThrow();
    } finally {
      Math.random = real;
    }
  });

  it("different random streams give different zones", () => {
    const signatures = new Set<string>();
    for (let s = 0; s < 30; s++) {
      const plan = planZone(map, RAID_MS, mulberry32(s));
      signatures.add(JSON.stringify(zoneCircles(plan)));
    }
    expect(signatures.size).toBeGreaterThan(20);
  });

  it("ends on one of the map's extracts, with the final radius", () => {
    for (const { map: m, plan, label } of plans()) {
      const extract = m.extracts.find((e) => e.id === plan.extractId);
      expect(extract, label).toBeDefined();
      expect(plan.final, label).toEqual({ x: extract!.x, y: extract!.y, r: ZONE_FINAL_RADIUS });
      expect(plan.stages.at(-1)!.target, label).toEqual(plan.final);
    }
  });

  it("picks the extract uniformly from the random function", () => {
    const counts = new Map<string, number>();
    const rng = mulberry32(77);
    for (let i = 0; i < 3000; i++) {
      const id = planZone(map, RAID_MS, rng).extractId;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual(map.extracts.map((e) => e.id).sort());
    for (const n of counts.values()) expect(Math.abs(n - 3000 / map.extracts.length)).toBeLessThan(250);
  });

  it("the first random draw selects the extract; the ends of [0, 1) map to the first and last", () => {
    expect(planZone(map, RAID_MS, () => 0).extractId).toBe(map.extracts[0]!.id);
    expect(planZone(map, RAID_MS, () => 0.999999).extractId).toBe(map.extracts.at(-1)!.id);
    // A random function that returns exactly 1 must not index past the end.
    expect(planZone(map, RAID_MS, () => 1).extractId).toBe(map.extracts.at(-1)!.id);
  });

  it("throws for a map without extracts", () => {
    expect(() => planZone(mapWith([]), RAID_MS, mulberry32(1))).toThrow(RangeError);
  });

  it("starts on a circle that covers the whole map", () => {
    for (const m of maps) {
      const { start } = planZone(m, RAID_MS, mulberry32(1));
      const w = m.w * TILE;
      const h = m.h * TILE;
      expect(start.x).toBe(w / 2);
      expect(start.y).toBe(h / 2);
      expect(start.r).toBeCloseTo(Math.hypot(w, h) / 2 + TILE, 9);
      for (const corner of [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: 0, y: h }, { x: w, y: h }]) {
        expect(isOutside(start, corner.x, corner.y)).toBe(false);
      }
    }
  });

  it("builds ZONE_STAGES intermediate circles plus the final one", () => {
    const plan = planZone(map, RAID_MS, mulberry32(3));
    expect(plan.stages).toHaveLength(STAGE_COUNT);
    expect(zoneCircles(plan)).toHaveLength(ZONE_STAGES + 2);
    expect(zoneCircles(plan)[0]).toBe(plan.start);
  });

  it("radii fall strictly from the start circle to the final one", () => {
    const radii = zoneCircles(planZone(map, RAID_MS, mulberry32(3))).map((c) => c.r);
    for (let i = 1; i < radii.length; i++) expect(radii[i]!).toBeLessThan(radii[i - 1]!);
    expect(radii.at(-1)).toBe(ZONE_FINAL_RADIUS);
  });

  it("every circle fully contains the next, the start circle included", () => {
    let checked = 0;
    for (const { plan, label } of plans()) {
      const circles = zoneCircles(plan);
      for (let k = 0; k < circles.length - 1; k++) {
        const a = circles[k]!;
        const b = circles[k + 1]!;
        expect(a.r - b.r, `${label} circle ${k}`).toBeGreaterThanOrEqual(dist(a, b) - EPS);
        checked++;
      }
    }
    expect(checked).toBe(maps.length * 40 * (ZONE_STAGES + 1));
  });

  it("opens on a map-centred circle that holds every extract, so stage 1 reveals nothing", () => {
    for (const { map: m, plan, label } of plans()) {
      const first = zoneCircles(plan)[1]!;
      expect(first.x, label).toBeCloseTo(WORLD_W / 2, 9);
      expect(first.y, label).toBeCloseTo(WORLD_H / 2, 9);
      for (const e of m.extracts) {
        expect(contains(first, { x: e.x, y: e.y, r: ZONE_FINAL_RADIUS }), `${label} ${e.id}`).toBe(true);
      }
    }
  });

  it("every circle after the first still contains the final circle", () => {
    for (const { plan, label } of plans()) {
      const circles = zoneCircles(plan);
      const final = circles.at(-1)!;
      for (let k = 1; k < circles.length; k++) expect(contains(circles[k]!, final), `${label} circle ${k}`).toBe(true);
    }
  });

  it("keeps every centre inside the world, off the outer wall ring", () => {
    for (const { map: m, plan, label } of plans()) {
      for (const c of zoneCircles(plan)) {
        expect(c.x, label).toBeGreaterThanOrEqual(TILE - EPS);
        expect(c.x, label).toBeLessThanOrEqual(m.w * TILE - TILE + EPS);
        expect(c.y, label).toBeGreaterThanOrEqual(TILE - EPS);
        expect(c.y, label).toBeLessThanOrEqual(m.h * TILE - TILE + EPS);
      }
    }
  });

  it("holds for extracts at the extreme of what mapgen can place (far from the centre)", () => {
    const along = [12.5 * TILE, 51.5 * TILE];
    const depth = [3.5 * TILE, 60.5 * TILE];
    const sites: Array<{ x: number; y: number }> = [];
    for (const a of along) for (const d of depth) sites.push({ x: a, y: d }, { x: d, y: a });
    const m = mapWith(sites);
    sites.forEach((site, i) => {
      for (let s = 0; s < 40; s++) {
        const circles = zoneCircles(planZoneWithExtract(m, i, s));
        expect(circles.at(-1)).toMatchObject(site);
        for (let k = 0; k < circles.length - 1; k++) {
          expect(contains(circles[k]!, circles[k + 1]!), `site ${i} rng ${s} circle ${k}`).toBe(true);
        }
      }
    });
  });

  it("still nests the stage circles when an extract is too far out for the start circle to contain the walk", () => {
    const m = mapWith([{ x: TILE * 1.5, y: TILE * 1.5 }]);
    for (let s = 0; s < 40; s++) {
      const circles = zoneCircles(planZone(m, RAID_MS, mulberry32(s)));
      for (let k = 1; k < circles.length - 1; k++) expect(contains(circles[k]!, circles[k + 1]!)).toBe(true);
      for (const c of circles.slice(1)) {
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.x).toBeLessThanOrEqual(WORLD_W);
      }
    }
  });
});

describe("timeline", () => {
  const plan = planZone(generateMap(1234), RAID_MS, mulberry32(9));

  it("the stages share the first ZONE_TIMELINE_FRACTION of the raid, back to back", () => {
    expect(plan.raidMs).toBe(RAID_MS);
    expect(plan.timelineMs).toBeCloseTo(RAID_MS * ZONE_TIMELINE_FRACTION, 6);
    expect(plan.stages[0]!.holdStart).toBe(0);
    expect(plan.stages.at(-1)!.end).toBe(plan.timelineMs);
    for (let i = 1; i < plan.stages.length; i++) expect(plan.stages[i]!.holdStart).toBe(plan.stages[i - 1]!.end);
    for (const s of plan.stages) {
      expect(s.holdStart).toBeLessThan(s.shrinkStart);
      expect(s.shrinkStart).toBeLessThan(s.end);
    }
  });

  it("every stage holds for ZONE_HOLD_FRACTION of its length, then shrinks", () => {
    const length = plan.timelineMs / STAGE_COUNT;
    for (const s of plan.stages) {
      expect(s.end - s.holdStart).toBeCloseTo(length, 6);
      expect(s.shrinkStart - s.holdStart).toBeCloseTo(length * ZONE_HOLD_FRACTION, 6);
    }
  });

  it("is entirely within the raid, for any raid length", () => {
    for (const raidMs of [1, 1000, 20_000, 60_000, RAID_MS, 3_600_000]) {
      const p = planZone(generateMap(1234), raidMs, mulberry32(9));
      expect(p.timelineMs).toBeLessThanOrEqual(raidMs);
      expect(p.stages.at(-1)!.end).toBeLessThanOrEqual(raidMs);
      expect(p.stages[0]!.holdStart).toBeGreaterThanOrEqual(0);
    }
  });

  it("a raid of zero, negative or non-finite length is already at the final circle", () => {
    for (const raidMs of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const p = planZone(generateMap(1234), raidMs, mulberry32(9));
      const z = zoneAt(p, 0);
      expect(z).toMatchObject({ x: p.final.x, y: p.final.y, r: ZONE_FINAL_RADIUS, stage: STAGE_COUNT, shrinking: false });
      expect(zoneAt(p, 10_000).r).toBe(ZONE_FINAL_RADIUS);
    }
  });
});

describe("zoneAt", () => {
  const plan = planZone(generateMap(1234), RAID_MS, mulberry32(9));
  const circles = zoneCircles(plan);

  it("starts in the first hold on the start circle, heading for the first target", () => {
    const z = zoneAt(plan, 0);
    const s = plan.stages[0]!;
    expect(z).toEqual({
      x: plan.start.x, y: plan.start.y, r: plan.start.r,
      nextX: s.target.x, nextY: s.target.y, nextR: s.target.r,
      stage: 1, shrinking: false, changeAtElapsed: s.shrinkStart,
    });
  });

  it("before the raid (negative or NaN elapsed) is the same as the very start", () => {
    expect(zoneAt(plan, -1000)).toEqual(zoneAt(plan, 0));
    expect(zoneAt(plan, Number.NaN)).toEqual(zoneAt(plan, 0));
  });

  it("holds, then shrinks, in every stage", () => {
    plan.stages.forEach((s, i) => {
      const prev = circles[i]!;
      const hold = zoneAt(plan, (s.holdStart + s.shrinkStart) / 2);
      expect(hold).toMatchObject({
        x: prev.x, y: prev.y, r: prev.r, nextX: s.target.x, nextY: s.target.y, nextR: s.target.r,
        stage: i + 1, shrinking: false, changeAtElapsed: s.shrinkStart,
      });

      const mid = zoneAt(plan, (s.shrinkStart + s.end) / 2);
      expect(mid.shrinking).toBe(true);
      expect(mid.stage).toBe(i + 1);
      expect(mid.changeAtElapsed).toBe(s.end);
      expect(mid.x).toBeCloseTo((prev.x + s.target.x) / 2, 6);
      expect(mid.y).toBeCloseTo((prev.y + s.target.y) / 2, 6);
      expect(mid.r).toBeCloseTo((prev.r + s.target.r) / 2, 6);
      expect([mid.nextX, mid.nextY, mid.nextR]).toEqual([s.target.x, s.target.y, s.target.r]);
    });
  });

  it("stays on the final circle after the timeline, counting down to the end of the raid", () => {
    const f = plan.final;
    for (const t of [plan.timelineMs, plan.timelineMs + 1, RAID_MS - 1, RAID_MS, RAID_MS * 2]) {
      expect(zoneAt(plan, t)).toEqual({
        x: f.x, y: f.y, r: f.r, nextX: f.x, nextY: f.y, nextR: f.r,
        stage: STAGE_COUNT, shrinking: false, changeAtElapsed: RAID_MS,
      });
    }
  });

  it("the stage number runs 1..ZONE_STAGES + 1 and never goes back", () => {
    let last = 0;
    for (let t = 0; t <= RAID_MS; t += 250) {
      const { stage } = zoneAt(plan, t);
      expect(stage).toBeGreaterThanOrEqual(last);
      expect(stage).toBeGreaterThanOrEqual(1);
      expect(stage).toBeLessThanOrEqual(STAGE_COUNT);
      last = stage;
    }
    expect(last).toBe(STAGE_COUNT);
  });

  it("changeAtElapsed is always in the future, so the HUD countdown is never negative", () => {
    for (let t = 0; t < RAID_MS; t += 137) expect(zoneAt(plan, t).changeAtElapsed).toBeGreaterThan(t);
  });

  it("radii never grow, and the current circle always contains the next one", () => {
    for (const { plan: p, label } of plans()) {
      let lastR = Infinity;
      for (let t = 0; t <= RAID_MS; t += 1000) {
        const z = zoneAt(p, t);
        expect(z.r, `${label} t=${t}`).toBeLessThanOrEqual(lastR + EPS);
        lastR = z.r;
        expect(z.r - z.nextR, `${label} t=${t}`).toBeGreaterThanOrEqual(dist(z, { x: z.nextX, y: z.nextY }) - 1e-6);
      }
      expect(lastR).toBe(ZONE_FINAL_RADIUS);
    }
  });

  it("each moment's circle contains every later one (the safe area only shrinks)", () => {
    for (const { plan: p, label } of plans()) {
      let prev = zoneAt(p, 0);
      for (let t = 500; t <= RAID_MS; t += 500) {
        const cur = zoneAt(p, t);
        expect(contains(prev, cur), `${label} t=${t}`).toBe(true);
        prev = cur;
      }
    }
  });

  it("is continuous at every hold/shrink boundary", () => {
    for (const { plan: p, label } of plans()) {
      const boundaries = p.stages.flatMap((s) => [s.holdStart, s.shrinkStart, s.end]);
      for (const b of boundaries) {
        const before = zoneAt(p, b - 1e-6);
        const at = zoneAt(p, b);
        const after = zoneAt(p, b + 1e-6);
        for (const other of [before, after]) {
          expect(Math.abs(other.x - at.x), `${label} @${b}`).toBeLessThan(1e-3);
          expect(Math.abs(other.y - at.y), `${label} @${b}`).toBeLessThan(1e-3);
          expect(Math.abs(other.r - at.r), `${label} @${b}`).toBeLessThan(1e-3);
        }
      }
    }
  });

  it("never jumps: no step between close samples exceeds the fastest shrink speed", () => {
    for (const { plan: p, label } of plans()) {
      let maxSpeed = 0;
      let prevCircle = p.start;
      for (const s of p.stages) {
        const ms = s.end - s.shrinkStart;
        maxSpeed = Math.max(maxSpeed, dist(prevCircle, s.target) / ms, Math.abs(prevCircle.r - s.target.r) / ms);
        prevCircle = s.target;
      }
      // One assertion per plan: the sweep is large and a per-sample expect() dominates its run time.
      const dt = 50;
      const limit = maxSpeed * dt + 1e-6;
      let worst = 0;
      let prev = zoneAt(p, 0);
      for (let t = dt; t <= RAID_MS; t += dt) {
        const cur = zoneAt(p, t);
        worst = Math.max(worst, dist(prev, cur), Math.abs(prev.r - cur.r));
        prev = cur;
      }
      expect(worst, label).toBeLessThanOrEqual(limit);
    }
  });

  it("the target circles are the same ones zoneCircles lists, so the next-circle ring matches the plan", () => {
    const seen = new Set<string>();
    for (let t = 0; t <= RAID_MS; t += 500) {
      const z = zoneAt(plan, t);
      seen.add(`${z.nextX},${z.nextY},${z.nextR}`);
    }
    expect(seen).toEqual(new Set(circles.slice(1).map((c) => `${c.x},${c.y},${c.r}`)));
  });
});

describe("short raids", () => {
  it("a 20 s raid still plays all stages and settles on the final circle", () => {
    for (const { plan, label } of plans(20_000)) {
      expect(plan.timelineMs, label).toBeCloseTo(17_000, 6);
      const circles = zoneCircles(plan);
      for (let k = 0; k < circles.length - 1; k++) expect(contains(circles[k]!, circles[k + 1]!), label).toBe(true);

      const stagesSeen = new Set<number>();
      let lastR = Infinity;
      for (let t = 0; t <= 20_000; t += 50) {
        const z = zoneAt(plan, t);
        stagesSeen.add(z.stage);
        expect(z.r, label).toBeLessThanOrEqual(lastR + EPS);
        lastR = z.r;
      }
      expect([...stagesSeen].sort()).toEqual(Array.from({ length: STAGE_COUNT }, (_, i) => i + 1));
      expect(zoneAt(plan, 17_000)).toMatchObject({ r: ZONE_FINAL_RADIUS, shrinking: false, changeAtElapsed: 20_000 });
      expect(lastR).toBe(ZONE_FINAL_RADIUS);
    }
  });
});

describe("zoneDps", () => {
  it("is harmless before the raid and ramps linearly with the stage", () => {
    expect(zoneDps(0)).toBe(0);
    expect(zoneDps(-3)).toBe(0);
    expect(zoneDps(Number.NaN)).toBe(0);
    expect(zoneDps(1)).toBe(ZONE_DPS);
    for (let s = 1; s <= STAGE_COUNT; s++) expect(zoneDps(s)).toBe(ZONE_DPS * s);
    for (let s = 2; s <= STAGE_COUNT; s++) expect(zoneDps(s)).toBeGreaterThan(zoneDps(s - 1));
  });
});

describe("isOutside", () => {
  const zone = { x: 100, y: 200, r: 50 };

  it("is true strictly beyond the radius; the edge is inside", () => {
    expect(isOutside(zone, 100, 200)).toBe(false);
    expect(isOutside(zone, 150, 200)).toBe(false);
    expect(isOutside(zone, 100, 150)).toBe(false);
    expect(isOutside(zone, 150.001, 200)).toBe(true);
    expect(isOutside(zone, 100, 250.001)).toBe(true);
    expect(isOutside(zone, 100 + 35, 200 + 35)).toBe(false); // 49.5
    expect(isOutside(zone, 100 + 36, 200 + 36)).toBe(true); // 50.9
  });

  it("accepts a synced ZoneState-shaped object", () => {
    const state = { x: 0, y: 0, r: 10, stage: 2, shrinking: true };
    expect(isOutside(state, 11, 0)).toBe(true);
  });

  it("a zero-radius zone (stage 0) only contains its own centre", () => {
    expect(isOutside({ x: 0, y: 0, r: 0 }, 0, 0)).toBe(false);
    expect(isOutside({ x: 0, y: 0, r: 0 }, 1, 0)).toBe(true);
  });
});
