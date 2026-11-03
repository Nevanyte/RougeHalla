// The route on the ground (render/GroundRoute.ts), drawn into a fake scene (test/fakes.ts): where it sits in the depth order, what a
// dash and a camp circle are made of, that the drawing happens in chunks and a frame between two chunks only sets alphas, that a
// walked piece moves to a Graphics of its own that fades smoothly and is pooled, and that a hidden or edited route never shows
// again what the walk has taken away.
import { describe, expect, it } from "vitest";
import { Y_SCALE, type CampDef, type Vec2 } from "@raid/shared";
import {
  GROUND_ROUTE_COLOR, GROUND_ROUTE_DEPTH, GROUND_ROUTE_RIM, GroundRouteView, LINE_WIDTH, RIM_WIDTH, type GroundRouteFrame,
} from "../src/render/GroundRoute";
import { CHUNK_MS, DASH_ON, FADE_MS } from "../src/render/groundRouteModel";
import { WEAPON_RANGE_DEPTH } from "../src/render/WeaponRangeView";
import { COLOR_OUTLINE, COLOR_ROUTE } from "../src/ui/mapPainter";
import { cssColor } from "../src/ui/dom";
import { argsOf, fakeScene, names, type FakeObject } from "./fakes";

const P = (x: number, y: number): Vec2 => ({ x, y });
const LINE = { points: [P(0, 0), P(1000, 0)], stops: [P(1000, 0)] };
/** Dashes on LINE: one every 36 units from 0, the last (972 to 994) the 28th. */
const LINE_DASHES = 28;

const camp = (x: number, y: number, r = 80, spots: Vec2[] = []): CampDef =>
  ({ id: "fire-1", zone: "fire", x, y, r, spots, eliteSpot: -1, chest: { x, y }, area: 0, radius: 300 }) as CampDef;

function setup(options: { reduced?: boolean; camera?: Record<string, number> } = {}) {
  const sc = fakeScene(options.camera ? { cameras: { main: options.camera } } : {});
  const reduced = { on: options.reduced === true };
  const view = new GroundRouteView(sc.scene as never, { reducedMotion: () => reduced.on });
  const steady = sc.ofKind("graphics")[0]!;
  let t = 0;
  /** One frame `dt` ms after the last. */
  const frame = (over: Partial<GroundRouteFrame> = {}, dt = 16): void => { t += dt; view.update({ now: t, show: true, at: null, ...over }); };
  /** Frames of 16 ms until `ms` have passed. */
  const run = (ms: number, over: Partial<GroundRouteFrame> = {}): void => { const end = t + ms; while (t < end) frame(over); };
  const graphics = (): FakeObject[] => sc.ofKind("graphics");
  return { ...sc, view, steady, frame, run, reduced, graphics, now: () => t };
}

/** The ground x of each dash a Graphics strokes (one moveTo per dash and pass). */
const starts = (g: FakeObject): number[] => argsOf(g, "moveTo").map(([x]) => x as number);
/** Calls to a Graphics that are not an alpha set. */
const geometry = (g: FakeObject): number => g.calls.filter(([n]) => n !== "setAlpha").length;

describe("GroundRouteView: the look", () => {
  it("is one Graphics at the ground depth: over the floor and the camp outlines, under the ground fields, the weapon range and every actor", () => {
    const { steady, graphics } = setup();
    expect(graphics()).toHaveLength(1);
    expect(steady.state.depth).toBe(GROUND_ROUTE_DEPTH);
    expect(GROUND_ROUTE_DEPTH).toBeGreaterThan(-4.8e5);
    expect(GROUND_ROUTE_DEPTH).toBeLessThan(-3e5);
    expect(GROUND_ROUTE_DEPTH).toBeLessThan(WEAPON_RANGE_DEPTH);
    expect(GROUND_ROUTE_DEPTH).toBeLessThan(0);
    expect(steady.state.visible).toBe(false);
  });

  it("uses the minimap route's colours, so the two read as one route", () => {
    expect(cssColor(GROUND_ROUTE_COLOR)).toBe(COLOR_ROUTE);
    expect(cssColor(GROUND_ROUTE_RIM)).toBe(COLOR_OUTLINE);
  });

  it("strokes each dash twice, a dark rim wider than the cyan line, flattened by Y_SCALE", () => {
    const { view, steady, frame } = setup();
    view.setRoute({ points: [P(100, 0), P(100, 360)], stops: [P(100, 360)] });
    frame();
    expect(steady.state.visible).toBe(true);
    const lines = argsOf(steady, "lineStyle");
    expect(lines.map((l) => l[0])).toEqual([RIM_WIDTH, LINE_WIDTH]);
    expect(RIM_WIDTH).toBeGreaterThan(LINE_WIDTH);
    expect(lines[0]![1]).toBe(GROUND_ROUTE_RIM);
    expect(lines[1]![1]).toBe(GROUND_ROUTE_COLOR);
    expect(argsOf(steady, "moveTo")).toHaveLength(20);
    expect(argsOf(steady, "strokePath")).toHaveLength(20);
    const [x, y] = argsOf(steady, "moveTo")[0]!;
    expect([x, y]).toEqual([100, 0]);
    const [lx, ly] = argsOf(steady, "lineTo")[0]!;
    expect(lx).toBe(100);
    expect(ly as number).toBeCloseTo(DASH_ON * Y_SCALE, 9);
  });

  it("draws a cyan circle round a stop on a camp, centred on the camp, flattened, enclosing its spots", () => {
    const { view, steady, frame } = setup();
    view.setCamps([camp(500, 500, 80, [P(540, 500), P(470, 540)])]);
    view.setRoute({ points: [P(0, 500), P(500, 500)], stops: [P(500, 500)] });
    frame();
    const radius = 80;
    expect(argsOf(steady, "fillEllipse")).toEqual([[500, 500 * Y_SCALE, 2 * radius, 2 * radius * Y_SCALE]]);
    expect(argsOf(steady, "strokeEllipse")).toEqual([
      [500, 500 * Y_SCALE, 2 * radius, 2 * radius * Y_SCALE], [500, 500 * Y_SCALE, 2 * radius, 2 * radius * Y_SCALE],
    ]);
    const tint = argsOf(steady, "fillStyle")[0]!;
    expect(tint[0]).toBe(GROUND_ROUTE_COLOR);
    expect(tint[1] as number).toBeLessThanOrEqual(0.15);
  });

  it("makes no circle for a stop that is not on a camp", () => {
    const { view, steady, frame } = setup();
    view.setCamps([camp(500, 500)]);
    view.setRoute({ points: [P(0, 500), P(300, 500)], stops: [P(300, 500)] });
    frame();
    expect(argsOf(steady, "strokeEllipse")).toHaveLength(0);
    expect(argsOf(steady, "moveTo").length).toBeGreaterThan(0);
  });

  it("draws nothing for no route, and clears what it had when the route goes", () => {
    const { view, steady, frame } = setup();
    frame();
    expect(argsOf(steady, "moveTo")).toHaveLength(0);
    view.setRoute(LINE);
    frame();
    expect(starts(steady)).toHaveLength(LINE_DASHES * 2);
    view.setRoute(null);
    frame();
    expect(starts(steady)).toHaveLength(0);
    view.setRoute({ points: [], stops: [] });
    frame();
    expect(starts(steady)).toHaveLength(0);
  });
});

describe("GroundRouteView: shown and hidden", () => {
  it("follows the frame's show flag, and a hidden route draws nothing", () => {
    const { view, steady, frame } = setup();
    view.setRoute(LINE);
    frame({ show: false });
    expect(steady.state.visible).toBe(false);
    expect(argsOf(steady, "lineStyle")).toHaveLength(0);
    expect(steady.clears).toBe(0);
    frame({ show: true });
    expect(steady.state.visible).toBe(true);
    expect(starts(steady)).toHaveLength(LINE_DASHES * 2);
    frame({ show: false });
    expect(steady.state.visible).toBe(false);
  });

  it("still follows the walk while hidden, and comes back without what was walked over", () => {
    const { view, steady, frame, run, graphics } = setup();
    view.setRoute(LINE);
    run(CHUNK_MS * 2, { show: false, at: P(0, 0) });
    expect(graphics()).toHaveLength(1);
    frame({ show: true, at: P(0, 0) });
    expect(starts(steady)).toHaveLength((LINE_DASHES - 4) * 2);
    expect(Math.min(...starts(steady))).toBeGreaterThanOrEqual(144 - 1e-9);
    // Nothing was drawn to fade while it was hidden.
    expect(graphics()).toHaveLength(1);
  });

  it("walks nothing for a player it has no place for (dead, not placed)", () => {
    const { view, steady, run } = setup();
    view.setRoute(LINE);
    run(CHUNK_MS * 3, { at: null });
    expect(starts(steady)).toHaveLength(LINE_DASHES * 2);
  });
});

describe("GroundRouteView: chunks", () => {
  it("redraws the steady layer only when something changed, never for a frame in between", () => {
    const { view, steady, frame, run } = setup();
    view.setRoute(LINE);
    frame();
    expect(steady.clears).toBe(1);
    const calls = steady.calls.length;
    run(1000);
    expect(steady.clears).toBe(1);
    expect(steady.calls).toHaveLength(calls);
  });

  it("checks the walk and redraws once per 200 ms chunk: a player on the line is taken in at the next chunk, not the next frame", () => {
    const { view, steady, frame, run, now } = setup();
    view.setRoute(LINE);
    frame({ at: P(900, 900) });
    const first = now();
    // The player steps onto the line one frame later; the chunk is 200 ms after the first.
    run(CHUNK_MS - 40, { at: P(0, 0) });
    expect(now()).toBeLessThan(first + CHUNK_MS);
    expect(steady.clears).toBe(1);
    expect(starts(steady)).toHaveLength(LINE_DASHES * 2);
    run(CHUNK_MS, { at: P(0, 0) });
    expect(steady.clears).toBe(2);
    expect(starts(steady)).toHaveLength((LINE_DASHES - 4) * 2);
  });

  it("redraws in a new place only when the camera has moved a step, and draws only the camera's window", () => {
    const camera = { scrollX: 0, scrollY: 0, width: 400, height: 300, zoom: 1 };
    const { view, steady, frame, run } = setup({ camera });
    view.setRoute({ points: [P(0, 0), P(3000, 0)], stops: [P(3000, 0)] });
    frame();
    // The window is the camera's box (96 each side) snapped out to 128 and grown by one more step: x from -256 to 640.
    expect(starts(steady)).toHaveLength(18 * 2);
    expect(Math.max(...starts(steady))).toBeLessThan(640);
    camera.scrollX = 10;
    run(CHUNK_MS * 2);
    expect(steady.clears).toBe(1);
    camera.scrollX = 2000;
    run(CHUNK_MS * 2);
    expect(steady.clears).toBe(2);
    expect(Math.min(...starts(steady))).toBeGreaterThan(1500);
    expect(Math.max(...starts(steady))).toBeLessThan(2900);
    expect(starts(steady).length).toBeLessThan(60);
  });
});

describe("GroundRouteView: walking over the route", () => {
  it("takes the walked dashes out of the steady layer and draws them once into a Graphics of their own", () => {
    const { view, steady, frame, graphics } = setup();
    view.setRoute(LINE);
    frame({ at: P(0, 0) });
    expect(starts(steady)).toHaveLength((LINE_DASHES - 4) * 2);
    expect(graphics()).toHaveLength(2);
    const cohort = graphics()[1]!;
    expect(cohort.state.depth).toBe(GROUND_ROUTE_DEPTH);
    expect(cohort.state.visible).toBe(true);
    expect(cohort.state.alpha).toBe(1);
    expect(starts(cohort)).toHaveLength(8);
    expect(Math.max(...starts(cohort))).toBeLessThan(128);
  });

  it("fades it smoothly over 1.2 s by setting its alpha each frame, with no geometry drawn", () => {
    const { view, steady, frame, run, graphics, now } = setup();
    view.setRoute(LINE);
    frame({ at: P(0, 0) });
    const cohort = graphics()[1]!;
    const born = now();
    const drawn = geometry(cohort);
    const steadyCalls = steady.calls.length;
    const seen: number[] = [];
    while (now() - born < FADE_MS - 100) {
      frame({ at: P(0, 0) });
      if (cohort.state.visible) seen.push(cohort.state.alpha as number);
    }
    // One alpha per frame, falling in a straight line to nothing: no step is bigger than a frame's share of the fade.
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!).toBeLessThanOrEqual(seen[i - 1]!);
      expect(seen[i - 1]! - seen[i]!).toBeLessThan(0.05);
    }
    expect(cohort.state.alpha as number).toBeCloseTo(1 - (now() - born) / FADE_MS, 2);
    expect(geometry(cohort)).toBe(drawn);
    expect(steady.calls).toHaveLength(steadyCalls);
    run(300, { at: P(0, 0) });
  });

  it("lets the Graphics go when the fade is over, and reuses it for the next walk", () => {
    const { view, frame, run, graphics, now } = setup();
    view.setRoute(LINE);
    frame({ at: P(0, 0) });
    const cohort = graphics()[1]!;
    const born = now();
    run(FADE_MS + CHUNK_MS * 2, { at: P(0, 0) });
    expect(now() - born).toBeGreaterThan(FADE_MS);
    expect(cohort.state.visible).toBe(false);
    expect(argsOf(cohort, "moveTo")).toHaveLength(0);
    // Walk on to the next stretch: the same Graphics comes back for it.
    run(CHUNK_MS * 2, { at: P(300, 0) });
    expect(graphics()).toHaveLength(2);
    expect(cohort.state.visible).toBe(true);
    expect(starts(cohort).length).toBeGreaterThan(0);
  });

  it("keeps up to six chunks of walked dashes fading at once while the player walks on, and no more", () => {
    const { view, frame, graphics, now } = setup();
    view.setRoute({ points: [P(0, 0), P(8000, 0)], stops: [P(8000, 0)] });
    // 170 u/s: 34 units a chunk. Walk 4 seconds.
    const start = now();
    while (now() - start < 4000) frame({ at: P(((now() - start) / 1000) * 170 + 16, 0) });
    expect(graphics().length).toBeLessThanOrEqual(1 + 8);
    expect(graphics().length).toBeGreaterThan(3);
    const live = graphics().slice(1).filter((g) => g.state.visible === true);
    expect(live.length).toBeLessThanOrEqual(FADE_MS / CHUNK_MS + 1);
    for (const g of live) expect(g.state.alpha as number).toBeGreaterThan(0);
  });

  it("goes at the next chunk, without a fade, under reduced motion", () => {
    const { view, steady, frame, graphics } = setup({ reduced: true });
    view.setRoute(LINE);
    frame({ at: P(0, 0) });
    expect(starts(steady)).toHaveLength((LINE_DASHES - 4) * 2);
    expect(graphics()).toHaveLength(1);
  });

  it("fades a camp circle once the player is in its reach, with the dashes round it", () => {
    const { view, steady, frame, graphics } = setup();
    view.setCamps([camp(500, 0, 80)]);
    view.setRoute({ points: [P(0, 0), P(500, 0)], stops: [P(500, 0)] });
    frame({ at: P(0, 0) });
    expect(argsOf(steady, "strokeEllipse")).toHaveLength(2);
    expect(argsOf(graphics()[1] ?? steady, "strokeEllipse")).toHaveLength(0);
    // 128 from the centre: the circle (80 + 48) is reached.
    frame({ at: P(500 - 100, 0) }, CHUNK_MS);
    expect(argsOf(steady, "strokeEllipse")).toHaveLength(0);
    const cohorts = graphics().slice(1);
    expect(cohorts.some((g) => argsOf(g, "strokeEllipse").length === 2)).toBe(true);
  });
});

describe("GroundRouteView: a rebuilt route", () => {
  it("does not bring back what the walk took, when the route is edited on the map", () => {
    const { view, steady, frame, run } = setup();
    view.setRoute(LINE);
    run(CHUNK_MS, { at: P(0, 0) });
    view.setRoute({ points: [P(0, 0), P(1000, 0), P(1000, 400)], stops: [P(1000, 0), P(1000, 400)] }, P(0, 0));
    frame({ at: P(0, 0) });
    expect(Math.min(...starts(steady))).toBeGreaterThanOrEqual(144 - 1e-9);
  });

  it("does not show the stretch the player stands on when the edit makes it new", () => {
    const { view, steady, frame } = setup();
    view.setRoute({ points: [P(0, 0), P(0, 2000)], stops: [P(0, 2000)] });
    frame({ at: P(500, 500) });
    // A new route whose first leg runs across the place the player stands on.
    view.setRoute({ points: [P(0, 500), P(1000, 500)], stops: [P(1000, 500)] }, P(500, 500));
    frame({ at: P(500, 500) });
    const xs = starts(steady);
    expect(xs.length).toBeGreaterThan(0);
    expect(xs.every((x) => Math.abs(x - 500) > 100)).toBe(true);
  });

  it("keeps a fading piece fading when the route under it is rebuilt without it (a stop was reached)", () => {
    const { view, steady, frame, run, graphics } = setup();
    view.setRoute(LINE);
    frame({ at: P(0, 0) });
    const cohort = graphics()[1]!;
    run(CHUNK_MS, { at: P(0, 0) });
    const alpha = cohort.state.alpha as number;
    expect(alpha).toBeLessThan(1);
    view.setRoute(null);
    frame({ at: P(0, 0) });
    expect(starts(steady)).toHaveLength(0);
    expect(cohort.state.visible).toBe(true);
    expect(cohort.state.alpha as number).toBeLessThan(alpha);
  });

  it("starts again for a new run", () => {
    const { view, steady, frame, graphics } = setup();
    view.setRoute(LINE);
    frame({ at: P(0, 0) });
    expect(starts(steady)).toHaveLength((LINE_DASHES - 4) * 2);
    view.reset();
    expect(argsOf(steady, "moveTo")).toHaveLength(0);
    expect(argsOf(graphics()[1]!, "moveTo")).toHaveLength(0);
    expect(graphics()[1]!.state.visible).toBe(false);
    view.setRoute(LINE);
    frame();
    expect(starts(steady)).toHaveLength(LINE_DASHES * 2);
  });
});

describe("GroundRouteView: names, one frame at a time", () => {
  it("destroys everything it made", () => {
    const { view, frame, graphics } = setup();
    view.setRoute(LINE);
    frame({ at: P(0, 0) });
    const all = graphics();
    expect(all).toHaveLength(2);
    view.destroy();
    for (const g of all) expect(names(g)).toContain("destroy");
    // Late calls are harmless.
    expect(() => frame()).not.toThrow();
  });
});
