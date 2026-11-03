// The route on the ground, the part that is not Phaser (render/groundRouteModel.ts): the dashes and camp rings a route is cut into,
// the walked-over rule (4 tiles for the line, a ring's radius and a tile and a half for a camp circle), a piece that stays gone,
// what a rebuilt route keeps, and the timing (200 ms chunks, a 1.2 s fade).
import { describe, expect, it } from "vitest";
import { TILE, Y_SCALE, type Vec2 } from "@raid/shared";
import { ROUTE_REACH } from "../src/ui/planningMath";
import {
  CHUNK_MS, ChunkClock, DASH_OFF, DASH_ON, FADE_MS, GROUND_DETECT, GroundRouteModel, MOB_PAD, RING_DETECT_EXTRA, SWEEP_MAX,
  WINDOW_STEP, campRings, campStops, fadeAlpha, legRanges, quantizeWindow, ringRadius, routeDashes, sweepSamples,
  type CampLike, type DashPiece, type RingPiece,
} from "../src/render/groundRouteModel";

const P = (x: number, y: number): Vec2 => ({ x, y });
const PERIOD = DASH_ON + DASH_OFF;
const camp = (x: number, y: number, r = 80, spots: Vec2[] = []): CampLike => ({ x, y, r, spots });
const dashes = (model: GroundRouteModel): DashPiece[] => model.all().filter((p): p is DashPiece => p.kind === "dash");
const rings = (model: GroundRouteModel): RingPiece[] => model.all().filter((p): p is RingPiece => p.kind === "ring");

/** A straight route along x from the origin, one stop at its end. */
const straight = (length: number): { points: Vec2[]; stops: Vec2[] } => ({ points: [P(0, 0), P(length, 0)], stops: [P(length, 0)] });

describe("the numbers", () => {
  it("detects a line piece at four tiles, a ring at its edge plus a tile and a half, and fades over six chunks of 200 ms", () => {
    expect(GROUND_DETECT).toBe(4 * TILE);
    expect(GROUND_DETECT).toBe(128);
    expect(RING_DETECT_EXTRA).toBe(1.5 * TILE);
    expect(CHUNK_MS).toBe(200);
    expect(FADE_MS).toBe(1200);
    expect(FADE_MS / CHUNK_MS).toBe(6);
  });
});

describe("fadeAlpha", () => {
  it("is 1 at the moment of the walk, a straight line down, and 0 from 1.2 s on", () => {
    expect(fadeAlpha(0)).toBe(1);
    expect(fadeAlpha(-50)).toBe(1);
    expect(fadeAlpha(FADE_MS / 2)).toBeCloseTo(0.5, 12);
    expect(fadeAlpha(FADE_MS)).toBe(0);
    expect(fadeAlpha(FADE_MS * 3)).toBe(0);
    expect(fadeAlpha(Infinity)).toBe(0);
    for (let age = 0; age < FADE_MS; age += 50) expect(fadeAlpha(age + 50)).toBeLessThan(fadeAlpha(age));
  });

  it("steps one sixth of the way each chunk", () => {
    for (let n = 0; n <= 6; n++) expect(fadeAlpha(n * CHUNK_MS)).toBeCloseTo(1 - n / 6, 12);
  });
});

describe("ChunkClock", () => {
  it("answers true on the first call and then once per 200 ms, however often it is asked", () => {
    const clock = new ChunkClock();
    expect(clock.due(1000)).toBe(true);
    let ticks = 0;
    for (let t = 1000; t < 3000; t += 16) if (clock.due(t)) ticks++;
    // A frame every 16 ms, a chunk every 200 ms: 2 s is ten chunks (the frame grid makes the gaps 208 ms, so nine or ten).
    expect(ticks).toBeGreaterThanOrEqual(9);
    expect(ticks).toBeLessThanOrEqual(10);
  });

  it("is not due inside a chunk and is due at its end", () => {
    const clock = new ChunkClock();
    expect(clock.due(0)).toBe(true);
    expect(clock.due(1)).toBe(false);
    expect(clock.due(199)).toBe(false);
    expect(clock.due(200)).toBe(true);
    expect(clock.due(399)).toBe(false);
    expect(clock.due(400)).toBe(true);
  });

  it("does not stall on a clock that went backwards, ignores a bad time, and starts again after reset()", () => {
    const clock = new ChunkClock();
    expect(clock.due(5000)).toBe(true);
    expect(clock.due(100)).toBe(true);
    expect(clock.due(Number.NaN)).toBe(false);
    expect(clock.due(150)).toBe(false);
    clock.reset();
    expect(clock.due(150)).toBe(true);
  });
});

describe("legRanges", () => {
  it("splits the polyline at the stops, each leg from the stop before", () => {
    const pts = [P(0, 0), P(50, 0), P(100, 0), P(100, 80), P(100, 160)];
    expect(legRanges(pts, [P(100, 0), P(100, 160)])).toEqual([[0, 2], [2, 4]]);
    expect(legRanges(pts, [P(100, 160)])).toEqual([[0, 4]]);
    expect(legRanges(pts, [])).toEqual([[0, 4]]);
  });

  it("starts a route that has no start at its first stop, and keeps what is left after the last stop it can find", () => {
    const pts = [P(10, 10), P(60, 10), P(60, 90)];
    expect(legRanges(pts, [P(10, 10), P(60, 10)])).toEqual([[0, 1], [1, 2]]);
    expect(legRanges(pts, [P(999, 999)])).toEqual([[0, 2]]);
  });
});

describe("routeDashes", () => {
  it("cuts a straight leg into DASH_ON marks DASH_OFF apart, the first at its start", () => {
    const d = routeDashes(...Object.values(straight(360)) as [Vec2[], Vec2[]]);
    expect(d).toHaveLength(10);
    d.forEach((dash, k) => {
      expect(dash.pts).toHaveLength(4);
      [k * PERIOD, 0, k * PERIOD + DASH_ON, 0].forEach((v, i) => expect(dash.pts[i]).toBeCloseTo(v, 9));
      expect(dash.x).toBeCloseTo(k * PERIOD + DASH_ON / 2, 9);
      expect(dash.y).toBe(0);
      expect(dash.walkedAt).toBeNull();
    });
  });

  it("bends a dash round a corner", () => {
    const d = routeDashes([P(0, 0), P(40, 0), P(40, 40)], [P(40, 40)]);
    expect(d[0]!.pts).toEqual([0, 0, 22, 0]);
    // The second mark runs from arc 36 to 58: 4 along the first side, then 18 down the second.
    expect(d[1]!.pts).toHaveLength(6);
    [36, 0, 40, 0, 40, 18].forEach((v, i) => expect(d[1]!.pts[i]).toBeCloseTo(v, 9));
    expect(d[1]!.x).toBeCloseTo(40, 9);
    expect(d[1]!.y).toBeCloseTo(7, 9);
  });

  it("starts the pattern again at each stop, so a leg's dashes never depend on the legs before it", () => {
    const d = routeDashes([P(0, 0), P(100, 0), P(100, 100)], [P(100, 0), P(100, 100)]);
    // Leg one: dashes at 0, 36, 72 (to 94); leg two starts at (100, 0) with a fresh mark.
    expect(d.filter((x) => x.pts[0] === 100).map((x) => x.pts)[0]).toEqual([100, 0, 100, 22]);
    expect(d.map((x) => x.pts.slice(0, 2).map((v) => Math.round(v * 1e6) / 1e6))).toEqual([[0, 0], [36, 0], [72, 0], [100, 0], [100, 36], [100, 72]]);
  });

  it("is the same dashes when the first legs are dropped (a stop was reached): the minimap's slice of the polyline", () => {
    const full = [P(0, 0), P(100, 20), P(200, 0), P(200, 75), P(200, 150), P(350, 150), P(500, 150)];
    const stops = [full[2]!, full[4]!, full[6]!];
    const all = routeDashes(full, stops).map((d) => JSON.stringify(d.pts));
    const after = routeDashes(full.slice(2), stops.slice(1)).map((d) => JSON.stringify(d.pts));
    expect(after.length).toBeGreaterThan(5);
    for (const d of after) expect(all).toContain(d);
    const afterTwo = routeDashes(full.slice(4), stops.slice(2)).map((d) => JSON.stringify(d.pts));
    for (const d of afterTwo) expect(all).toContain(d);
  });

  it("makes nothing of a route with fewer than two points, and skips a point that is not a number", () => {
    expect(routeDashes([], [])).toEqual([]);
    expect(routeDashes([P(5, 5)], [P(5, 5)])).toEqual([]);
    const d = routeDashes([P(0, 0), P(Number.NaN, 4), P(100, 0)], [P(100, 0)]);
    expect(d.length).toBeGreaterThan(0);
    for (const dash of d) for (const n of dash.pts) expect(Number.isFinite(n)).toBe(true);
  });

  it("drops a sliver left at the end of a leg", () => {
    // 36 + 2: the next mark would start at 36 and last 2 units: too short to draw.
    const d = routeDashes([P(0, 0), P(38, 0)], [P(38, 0)]);
    expect(d).toHaveLength(1);
  });

  it("bounds each dash in projected pixels, flattened by Y_SCALE", () => {
    const [d] = routeDashes([P(0, 0), P(0, 100)], [P(0, 100)]);
    expect(d!.box.y).toBeLessThanOrEqual(0);
    // The dash is DASH_ON tall on the ground and DASH_ON * Y_SCALE on screen, plus a few pixels for its line and rim.
    expect(d!.box.h).toBeGreaterThanOrEqual(DASH_ON * Y_SCALE);
    expect(d!.box.h - DASH_ON * Y_SCALE).toBeLessThan(20);
  });
});

describe("camp rings", () => {
  const camps = [camp(1000, 1000, 80, [P(1050, 1000)]), camp(2000, 1000, 100, [P(2020, 1000)])];

  it("puts a ring on a stop within ROUTE_REACH of a camp's centre, once per camp, in stop order", () => {
    expect(ROUTE_REACH).toBe(64);
    expect(campStops([P(1000, 1000)], camps)).toEqual([0]);
    expect(campStops([P(1000 + ROUTE_REACH, 1000)], camps)).toEqual([0]);
    expect(campStops([P(1000 + ROUTE_REACH + 1, 1000)], camps)).toEqual([]);
    expect(campStops([P(2000, 1060), P(1010, 1000), P(1000, 1000)], camps)).toEqual([1, 0]);
    expect(campStops([P(1500, 1000)], camps)).toEqual([]);
    expect(campStops([P(Number.NaN, 0)], camps)).toEqual([]);
  });

  it("picks the nearest camp when two are in reach", () => {
    expect(campStops([P(1030, 1000)], [camp(1000, 1000), camp(1060, 1000)])).toEqual([1]);
  });

  it("is centred on the camp, not on the stop, and encloses the clearing and every mob's rest spot", () => {
    const [ring] = campRings([P(1030, 1000)], camps);
    expect(ring).toMatchObject({ kind: "ring", camp: 0, x: 1000, y: 1000 });
    expect(ring!.radius).toBe(Math.max(80, 50 + MOB_PAD));
    expect(ring!.radius).toBeGreaterThanOrEqual(80);
    // A real camp: the clearing is 80 and the farthest rest spot 72 away.
    expect(ringRadius(camp(0, 0, 80, [P(72, 0), P(-30, 40)]))).toBe(92);
    expect(ringRadius(camp(0, 0, 100, [P(10, 0)]))).toBe(100);
    expect(ringRadius(camp(0, 0, 80, []))).toBe(80);
  });

  it("is detected from its edge plus a tile and a half", () => {
    const [ring] = campRings([P(1000, 1000)], camps);
    expect(ring!.detect).toBe(ring!.radius + 1.5 * TILE);
  });

  it("is flattened: its box is as wide as the circle and Y_SCALE as tall", () => {
    const [ring] = campRings([P(2000, 1000)], camps);
    expect(ring!.box.w).toBeGreaterThanOrEqual(200);
    expect(ring!.box.h).toBeLessThan(ring!.box.w);
    expect(ring!.box.y + ring!.box.h / 2).toBeCloseTo(1000 * Y_SCALE, 9);
  });
});

describe("sweepSamples", () => {
  it("is the new place for a step of a tile or less, and the first sighting", () => {
    expect(sweepSamples(null, P(10, 10))).toEqual([P(10, 10)]);
    expect(sweepSamples(P(0, 0), P(TILE, 0))).toEqual([P(TILE, 0)]);
  });

  it("fills a longer walk with points a tile apart, ending at the new place", () => {
    const s = sweepSamples(P(0, 0), P(160, 0));
    expect(s).toHaveLength(5);
    expect(s[4]).toEqual(P(160, 0));
    for (let i = 1; i < s.length; i++) expect(s[i]!.x - s[i - 1]!.x).toBeLessThanOrEqual(TILE + 1e-9);
  });

  it("does not fill a teleport", () => {
    expect(sweepSamples(P(0, 0), P(SWEEP_MAX + 1, 0))).toEqual([P(SWEEP_MAX + 1, 0)]);
  });
});

describe("quantizeWindow", () => {
  it("covers the view on every side, on a WINDOW_STEP grid", () => {
    for (const view of [{ x: 130, y: -10, w: 100, h: 50 }, { x: -500.5, y: 700, w: 1920, h: 1080 }, { x: 0, y: 0, w: 128, h: 128 }]) {
      const w = quantizeWindow(view);
      expect(w.x).toBeLessThanOrEqual(view.x - WINDOW_STEP + 1e-9);
      expect(w.y).toBeLessThanOrEqual(view.y - WINDOW_STEP + 1e-9);
      expect(w.x + w.w).toBeGreaterThanOrEqual(view.x + view.w + WINDOW_STEP - 1e-9);
      expect(w.y + w.h).toBeGreaterThanOrEqual(view.y + view.h + WINDOW_STEP - 1e-9);
      expect(Math.abs(w.x % WINDOW_STEP)).toBe(0);
      expect(Math.abs(w.w % WINDOW_STEP)).toBe(0);
    }
    expect(quantizeWindow({ x: 130, y: -10, w: 100, h: 50 })).toEqual({ x: 0, y: -256, w: 384, h: 512 });
  });

  it("stays the same while the view moves inside a step, so the layer is not redrawn for it", () => {
    const a = quantizeWindow({ x: 130, y: 200, w: 100, h: 100 });
    const b = quantizeWindow({ x: 140, y: 205, w: 100, h: 100 });
    expect(b).toEqual(a);
    expect(quantizeWindow({ x: 300, y: 200, w: 100, h: 100 })).not.toEqual(a);
  });
});

describe("GroundRouteModel: walking over the line", () => {
  it("fades a dash once the player is within four tiles of it, and not before", () => {
    const m = new GroundRouteModel();
    m.setRoute(straight(1000), null);
    const reached = m.step(P(0, 0), 1000);
    // Dash midpoints sit at 11, 47, 83, 119, 155...: the first four are within 128 of the origin.
    expect(reached).toHaveLength(4);
    expect(reached.every((p) => p.kind === "dash" && p.x <= 128)).toBe(true);
    expect(reached.every((p) => p.walkedAt === 1000)).toBe(true);
    expect(dashes(m).filter((d) => d.walkedAt === null).every((d) => d.x > 128)).toBe(true);
  });

  it("measures four tiles to the dash's middle", () => {
    const m = new GroundRouteModel();
    m.setRoute({ points: [P(0, 0), P(0, 400)], stops: [P(0, 400)] }, null);
    // Dash k's middle is at y = 36k + 11. A player 128 away from one (and further from the rest) just reaches it.
    const reached = m.step(P(128 + 1e-6, 36 * 5 + 11), 0);
    expect(reached).toHaveLength(0);
    expect(m.step(P(128 - 1e-6, 36 * 5 + 11), 0).length).toBeGreaterThan(0);
  });

  it("reaches a piece at most once and never gives it back: it stays gone when the player walks away", () => {
    const m = new GroundRouteModel();
    m.setRoute(straight(1000), null);
    m.step(P(0, 0), 1000);
    expect(m.step(P(0, 0), 1200)).toEqual([]);
    expect(m.step(P(900, 0), 1400).length).toBeGreaterThan(0);
    const walked = dashes(m).filter((d) => d.walkedAt !== null);
    expect(walked.some((d) => d.walkedAt === 1000)).toBe(true);
    m.step(P(5000, 5000), 3000);
    expect(dashes(m).filter((d) => d.walkedAt === 1000)).toHaveLength(4);
    expect(m.pristine(null).every((p) => p.walkedAt === null)).toBe(true);
    expect(m.pristine(null).some((p) => p.kind === "dash" && p.x < 128)).toBe(false);
  });

  it("does not step over a piece in a fast move: the path between two chunks is swept", () => {
    // 400 units in one chunk (a dash or a knockback): every piece within four tiles of the way is reached.
    const far = new GroundRouteModel();
    far.setRoute({ points: [P(0, 0), P(1000, 0)], stops: [P(1000, 0)] }, null);
    far.step(P(0, 500), 0);
    far.step(P(400, 500), 200);
    // A line 500 units from the path is out of reach throughout.
    expect(far.pristine(null)).toHaveLength(far.size);
    const near = new GroundRouteModel();
    near.setRoute({ points: [P(0, 0), P(1000, 0)], stops: [P(1000, 0)] }, null);
    near.step(P(0, 100), 0);
    near.step(P(400, 100), 200);
    const left = dashes(near).filter((d) => d.walkedAt === null);
    expect(left.length).toBeGreaterThan(0);
    // 100 away from the line, so a dash is reached from 128 - 100 = ~77 either side of the player's x: all those up to 400 + 77.
    expect(left.every((d) => d.x > 400 + Math.sqrt(128 ** 2 - 100 ** 2) - 1e-6)).toBe(true);
    expect(dashes(near).filter((d) => d.walkedAt !== null && d.x > 400 + Math.sqrt(128 ** 2 - 100 ** 2) + 1e-6)).toHaveLength(0);
    expect(dashes(near).filter((d) => d.walkedAt !== null && d.x > 300)).not.toHaveLength(0);
  });

  it("does not sweep a teleport (the run's cut to the spawn)", () => {
    const m = new GroundRouteModel();
    m.setRoute(straight(4000), null);
    m.step(P(0, 2000), 0);
    m.step(P(3000, 0), 100);
    const walked = dashes(m).filter((d) => d.walkedAt !== null);
    expect(walked.length).toBeGreaterThan(0);
    expect(walked.every((d) => Math.abs(d.x - 3000) <= 128)).toBe(true);
  });

  it("forgets where the player was when it has no place for them (dead, not placed), so nothing is swept from a stale spot", () => {
    const m = new GroundRouteModel();
    m.setRoute(straight(4000), null);
    m.step(P(0, 2000), 0);
    expect(m.step(null, 100)).toEqual([]);
    expect(m.step(P(Number.NaN, 0), 150)).toEqual([]);
    m.step(P(1000, 2000), 200);
    expect(dashes(m).filter((d) => d.walkedAt !== null)).toHaveLength(0);
  });

  it("culls the untouched pieces to a box (projected pixels) and leaves the walked ones out", () => {
    const m = new GroundRouteModel();
    m.setRoute(straight(1000), null);
    const win = { x: 0, y: -50, w: 300, h: 100 };
    // Dashes start at 36k; a dash's box is padded by 6, so it meets x < 300 for k up to 8.
    expect(m.pristine(win)).toHaveLength(9);
    expect(m.pristine(null)).toHaveLength(m.size);
    m.step(P(0, 0), 0);
    expect(m.pristine(win)).toHaveLength(5);
    expect(m.pristine({ x: 5000, y: 5000, w: 10, h: 10 })).toHaveLength(0);
  });
});

describe("GroundRouteModel: a camp circle", () => {
  const camps = [camp(500, 0, 80)];

  it("fades once the player is inside its radius plus a tile and a half, and not a unit sooner", () => {
    const m = new GroundRouteModel();
    m.setCamps(camps);
    m.setRoute(straight(500), null);
    expect(rings(m)).toHaveLength(1);
    const detect = 80 + 48;
    expect(m.step(P(500 - detect - 1, 0), 0).filter((p) => p.kind === "ring")).toEqual([]);
    const reached = m.step(P(500 - detect + 1, 0), 200);
    expect(reached.filter((p) => p.kind === "ring")).toHaveLength(1);
    expect(rings(m)[0]!.walkedAt).toBe(200);
  });

  it("is reached from any side, not only along the line", () => {
    const m = new GroundRouteModel();
    m.setCamps(camps);
    m.setRoute(straight(500), null);
    m.step(P(500, 100), 0);
    expect(rings(m)[0]!.walkedAt).toBe(0);
  });

  it("makes no ring for a stop that is not on a camp", () => {
    const m = new GroundRouteModel();
    m.setCamps(camps);
    m.setRoute({ points: [P(0, 0), P(300, 0)], stops: [P(300, 0)] }, null);
    expect(rings(m)).toHaveLength(0);
  });

  it("stays gone once walked", () => {
    const m = new GroundRouteModel();
    m.setCamps(camps);
    m.setRoute(straight(500), null);
    m.step(P(500, 0), 0);
    m.step(P(4000, 4000), 500);
    expect(m.pristine(null).some((p) => p.kind === "ring")).toBe(false);
  });
});

describe("GroundRouteModel: a rebuilt route", () => {
  const camps = [camp(1000, 0, 80)];

  it("keeps what was walked when the first legs are dropped (a stop was reached)", () => {
    const m = new GroundRouteModel();
    m.setCamps(camps);
    const full = [P(0, 0), P(300, 0), P(300, 400), P(1000, 400), P(1000, 0)];
    const stops = [full[1]!, full[2]!, full[4]!];
    m.setRoute({ points: full, stops }, null);
    m.step(P(300, 200), 1000);
    const marked = dashes(m).filter((d) => d.walkedAt === 1000).map((d) => JSON.stringify(d.pts));
    expect(marked.length).toBeGreaterThan(2);
    // RouteAhead after the first stop: the polyline from that stop on, and the stops still ahead.
    m.setRoute({ points: full.slice(1), stops: stops.slice(1) }, P(300, 200));
    const still = dashes(m).filter((d) => d.walkedAt === 1000).map((d) => JSON.stringify(d.pts));
    expect(still).toHaveLength(marked.length);
    for (const d of still) expect(marked).toContain(d);
    // The first leg's dashes are out of the data now; the rest kept their walk and nothing new was walked.
    expect(dashes(m).every((d) => d.pts[0]! >= 300 - 1e-9)).toBe(true);
    expect(dashes(m).filter((d) => d.walkedAt === null).length).toBeGreaterThan(10);
  });

  it("keeps a ring's walk while the stop stays, and a stretch the walk has not reached stays fresh", () => {
    const m = new GroundRouteModel();
    m.setCamps(camps);
    m.setRoute({ points: [P(0, 0), P(1000, 0)], stops: [P(1000, 0)] }, null);
    m.step(P(1000, 0), 50);
    expect(rings(m)[0]!.walkedAt).toBe(50);
    m.setRoute({ points: [P(0, 0), P(1000, 0), P(1000, 1000)], stops: [P(1000, 0), P(1000, 1000)] }, P(1000, 0));
    expect(rings(m)[0]!.walkedAt).toBe(50);
    expect(dashes(m).some((d) => d.walkedAt === null && d.pts[1]! > 500)).toBe(true);
  });

  it("does not bring back a stretch the player is standing on when the route is edited there", () => {
    const m = new GroundRouteModel();
    m.setRoute(straight(1000), null);
    m.step(P(500, 0), 1000);
    // The edit adds a leg that runs back across the place the player stands on: new dashes, none of them from the old route.
    const edited = { points: [P(0, 0), P(1000, 0), P(1000, 300), P(500, 300), P(500, 20)], stops: [P(1000, 0), P(1000, 300), P(500, 20)] };
    m.setRoute(edited, P(500, 0));
    const underFoot = dashes(m).filter((d) => Math.hypot(d.x - 500, d.y - 0) <= GROUND_DETECT);
    expect(underFoot.length).toBeGreaterThan(0);
    expect(underFoot.every((d) => d.walkedAt !== null)).toBe(true);
    expect(m.pristine(null).some((p) => p.kind === "dash" && Math.hypot(p.x - 500, p.y - 0) <= GROUND_DETECT)).toBe(false);
    // Further along the new leg, out of reach, the line is fresh.
    expect(dashes(m).some((d) => d.walkedAt === null && d.x > 500 && d.pts[1]! > 100)).toBe(true);
  });

  it("starts a new stretch fresh when the player is not on it, even where the player has walked before", () => {
    const m = new GroundRouteModel();
    m.setRoute({ points: [P(0, 0), P(0, 1000)], stops: [P(0, 1000)] }, null);
    m.step(P(0, 500), 0);
    m.setRoute({ points: [P(300, 600), P(300, 0)], stops: [P(300, 0)] }, P(3000, 3000));
    expect(dashes(m).every((d) => d.walkedAt === null)).toBe(true);
  });

  it("gives a ring that comes back fresh, and a ring made under the player's feet none", () => {
    const m = new GroundRouteModel();
    m.setCamps(camps);
    m.setRoute({ points: [P(0, 0), P(1000, 0)], stops: [P(1000, 0)] }, null);
    m.step(P(1000, 0), 0);
    expect(rings(m)[0]!.walkedAt).toBe(0);
    m.setRoute({ points: [P(0, 0), P(300, 0)], stops: [P(300, 0)] }, P(1000, 0));
    expect(rings(m)).toHaveLength(0);
    // Back on the route while the player is a long way off: a ring to look at again.
    m.setRoute({ points: [P(0, 0), P(1000, 0)], stops: [P(1000, 0)] }, P(2000, 2000));
    expect(rings(m)[0]!.walkedAt).toBeNull();
    // Or while the player stands in it: gone at once.
    m.setRoute(null, null);
    m.setRoute({ points: [P(0, 0), P(1000, 0)], stops: [P(1000, 0)] }, P(1010, 0));
    expect(rings(m)[0]!.walkedAt).toBe(-Infinity);
    expect(m.pristine(null).some((p) => p.kind === "ring")).toBe(false);
  });

  it("holds a fading piece's start time through a rebuild, so its fade does not begin again", () => {
    const m = new GroundRouteModel();
    m.setRoute(straight(1000), null);
    m.step(P(0, 0), 400);
    const before = dashes(m).map((d) => d.walkedAt);
    m.setRoute({ points: [P(0, 0), P(1000, 0), P(1000, 500)], stops: [P(1000, 0), P(1000, 500)] }, P(0, 0));
    const after = dashes(m).slice(0, before.length).map((d) => d.walkedAt);
    expect(after).toEqual(before);
    expect(after.filter((t) => t === 400)).toHaveLength(4);
  });

  it("clears with a null or an empty route", () => {
    const m = new GroundRouteModel();
    m.setRoute(straight(500), null);
    expect(m.size).toBeGreaterThan(0);
    m.setRoute(null, null);
    expect(m.size).toBe(0);
    m.setRoute(straight(500), null);
    m.clear();
    expect(m.size).toBe(0);
  });
});
