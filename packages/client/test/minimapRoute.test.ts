// The minimap's camp markers and the faint route (the planning phase's additions to ui/minimap.ts): a shape per zone with a
// crown on an elite, drawn under the mob dots; the route and its next stop only when asked and only while "Show route" is on;
// a changed route repaints, an unchanged one does not. The 2D context is a call recorder (test/fakes.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FACTIONS, generateMap, isEliteCamp, type GameMap } from "@raid/shared";
import { Minimap, type MinimapMob } from "../src/ui/minimap";
import { cssColor } from "../src/ui/dom";
import { setView } from "../src/view/viewState";
import { computeLayout } from "../src/view/viewport";
import { argsOf, installFakeDom, names, type FakeEl, type FakeObject } from "./fakes";

const MAP: GameMap = generateMap(7);

beforeEach(() => { setView(computeLayout({ cssW: 1280, cssH: 800, dpr: 1, hiDpi: true })); });
afterEach(() => { vi.unstubAllGlobals(); });

function setup(map: GameMap = MAP) {
  const { ui } = installFakeDom();
  const minimap = new Minimap();
  minimap.setMap(map);
  const canvas = ui.children[0] as FakeEl;
  const ctx = canvas.getContext() as FakeObject;
  // A real context starts at an opacity of 1; the recorder has no properties of its own.
  ctx.globalAlpha = 1;
  let now = 0;
  const paint = (): void => { now += 200; minimap.update(now, undefined, true); };
  const paints = (): number => argsOf(ctx, "drawImage").length;
  return { minimap, canvas, ctx, paint, paints, k: () => canvas.width / 2048 };
}

const mob = (over: Partial<MinimapMob> = {}): MinimapMob => ({ x: 400, y: 300, kind: "mob", status: "alive", faction: "fire", ...over });

describe("camp markers", () => {
  it("draws every camp as its zone's shape in its zone's colour, an elite with a gold crown, and no arcs", () => {
    const { paint, ctx } = setup();
    paint();
    const fills = argsOf(ctx, "fillStyle=").map(([c]) => c);
    const elites = MAP.camps.filter(isEliteCamp).length;
    for (const zone of ["fire", "sentenced", "plague", "frost", "holy"] as const) expect(fills).toContain(cssColor(FACTIONS[zone].color));
    expect(fills.filter((c) => c === "#ffd54f")).toHaveLength(elites);
    // Shapes are paths, not arcs: the mob dots stay the minimap's only circles.
    expect(argsOf(ctx, "arc")).toHaveLength(0);
    expect(names(ctx).filter((n) => n === "closePath")).toHaveLength(MAP.camps.length + elites);
  });

  it("draws the camps under the mob dots and the player", () => {
    const { minimap, paint, ctx } = setup();
    minimap.setMobs([mob()]);
    paint();
    const calls = names(ctx);
    expect(calls.lastIndexOf("closePath")).toBeLessThan(calls.indexOf("arc"));
  });

  it("shows no camps on a map without any (a hand-built one)", () => {
    const { paint, ctx } = setup({ ...MAP, camps: [] });
    paint();
    expect(names(ctx)).not.toContain("closePath");
  });

  it("scales the marks with the minimap, and keeps an elite bigger than a plain camp", () => {
    const small = setup();
    small.paint();
    const spread = (ctx: FakeObject): number => {
      const xs = argsOf(ctx, "lineTo").map(([x]) => x as number);
      return Math.max(...xs) - Math.min(...xs);
    };
    const smallSpread = spread(small.ctx);
    vi.unstubAllGlobals();
    setView(computeLayout({ cssW: 2560, cssH: 1440, dpr: 2, hiDpi: true }));
    const big = setup();
    big.paint();
    expect(spread(big.ctx)).toBeGreaterThan(smallSpread);
  });
});

describe("the route", () => {
  const points = [{ x: 200, y: 300 }, { x: 600, y: 300 }, { x: 600, y: 800 }];
  const stops = [{ x: 600, y: 300 }, { x: 600, y: 800 }];

  it("draws the polyline dashed, the faint way, with a ring per stop and the next one bigger", () => {
    const { minimap, paint, ctx } = setup();
    minimap.setRoute({ points, stops, next: 0 });
    paint();
    expect(argsOf(ctx, "setLineDash").some(([d]) => (d as number[]).length === 2)).toBe(true);
    // The recorder's own seed (1), then the faint route's opacity, then back.
    expect(argsOf(ctx, "globalAlpha=").map(([a]) => a)).toEqual([1, 0.6, 1]);
    const arcs = argsOf(ctx, "arc");
    expect(arcs).toHaveLength(2);
    expect(arcs[0]![2] as number).toBeGreaterThan(arcs[1]![2] as number);
  });

  it("draws nothing for a cleared or empty route", () => {
    const { minimap, paint, ctx } = setup();
    minimap.setRoute({ points: [], stops: [], next: 0 });
    paint();
    minimap.setRoute(null);
    paint();
    expect(argsOf(ctx, "setLineDash")).toHaveLength(0);
    expect(argsOf(ctx, "arc")).toHaveLength(0);
  });

  it("follows the Show route setting: hidden when off, back when on, repainted at once", () => {
    const { minimap, paint, ctx, paints } = setup();
    minimap.setRoute({ points, stops, next: 0 });
    minimap.setShowRoute(false);
    paint();
    expect(argsOf(ctx, "setLineDash")).toHaveLength(0);
    const before = paints();
    minimap.setShowRoute(true);
    paint();
    expect(paints()).toBe(before + 1);
    expect(argsOf(ctx, "setLineDash").length).toBeGreaterThan(0);
  });

  it("repaints when the route or its next stop changes and not when it is handed over unchanged", () => {
    const { minimap, paint, paints } = setup();
    minimap.setRoute({ points, stops, next: 0 });
    paint();
    expect(paints()).toBe(1);
    minimap.setRoute({ points: [...points], stops: [...stops], next: 0 });
    paint();
    expect(paints()).toBe(1);
    minimap.setRoute({ points, stops, next: 1 });
    paint();
    expect(paints()).toBe(2);
    minimap.setRoute({ points: points.slice(1), stops: stops.slice(1), next: 0 });
    paint();
    expect(paints()).toBe(3);
    minimap.setRoute(null);
    paint();
    expect(paints()).toBe(4);
  });

  it("a route handed over while hidden does not repaint a map that shows nothing new", () => {
    const { minimap, paint, paints } = setup();
    minimap.setShowRoute(false);
    paint();
    const before = paints();
    minimap.setRoute({ points, stops, next: 0 });
    paint();
    expect(paints()).toBe(before);
  });
});
