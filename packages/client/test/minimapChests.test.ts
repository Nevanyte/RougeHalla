// The minimap's two additions for the camp chests: a pulsing gold blip with the seconds left while a chest is up, and a cleared
// camp crossed out (one somebody fought at wears a small muted ring). The repaint rules: once a second while a chest drains, on a pulse step unless
// motion is reduced, and when a camp's state changes; with no chest and no state the minimap paints exactly what it painted
// before. DOM and canvas are the fakes of test/fakes.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TILE_FLOOR, WORLD_H, WORLD_W, mapFromTiles, type CampDef, type GameMap } from "@raid/shared";
import { Minimap } from "../src/ui/minimap";
import { COLOR_DISTURBED } from "../src/ui/mapPainter";
import { setView } from "../src/view/viewState";
import { computeLayout } from "../src/view/viewport";
import { argsOf, FakeEl, installFakeDom, type FakeObject } from "./fakes";

const SPAN = Math.max(WORLD_W, WORLD_H);
const BASE = { cssW: 1280, cssH: 800, dpr: 1, hiDpi: true };

const camp = (zone: CampDef["zone"], x: number, y: number, eliteSpot = -1): CampDef =>
  ({ id: `${zone}-1`, zone, x, y, r: 64, spots: [], eliteSpot, chest: { x, y }, area: 0, radius: 288 }) as CampDef;

function mapWithCamps(): GameMap {
  const map = mapFromTiles(8, 8, new Uint8Array(64).fill(TILE_FLOOR));
  map.camps = [camp("fire", 400, 300), camp("holy", 1200, 900, 0), camp("plague", 1700, 1500)];
  return map;
}

function setup(reduced = false) {
  const { ui } = installFakeDom();
  const state = { reduced };
  const minimap = new Minimap({}, { reducedMotion: () => state.reduced });
  minimap.setMap(mapWithCamps());
  const canvas = ui.children[0] as FakeEl;
  const ctx = canvas.getContext() as FakeObject;
  ctx.globalAlpha = 1;
  let now = 0;
  /** An update `ms` after the last one (default: past the repaint throttle). */
  const paint = (ms = 200): void => { now += ms; minimap.update(now, undefined, true); };
  const paints = (): number => argsOf(ctx, "drawImage").length;
  const k = (): number => canvas.width / SPAN;
  return { minimap, ctx, paint, paints, k, state, now: () => now };
}

beforeEach(() => { setView(computeLayout(BASE)); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("chest blips", () => {
  it("draws a blip at each chest with its seconds, rounded up, and none before any chest is set", () => {
    const { minimap, ctx, paint, k } = setup();
    paint();
    expect(argsOf(ctx, "fillText")).toHaveLength(0);
    minimap.setChests([{ x: 800, y: 600, left: 9.2 }, { x: 1500, y: 400, left: 14.9 }]);
    paint();
    const text = argsOf(ctx, "fillText");
    expect(text.map(([t]) => t)).toEqual(["10", "15"]);
    expect(text[0]![1]).toBeCloseTo(800 * k());
    expect(text[1]![1]).toBeCloseTo(1500 * k());
  });

  it("repaints once a second while a chest drains, not every update", () => {
    const { minimap, paint, paints } = setup(true);
    minimap.setChests([{ x: 800, y: 600, left: 9.9 }]);
    paint();
    const first = paints();
    // 9.9 -> 9.4: still "10": nothing changed on screen.
    minimap.setChests([{ x: 800, y: 600, left: 9.4 }]);
    paint();
    expect(paints()).toBe(first);
    minimap.setChests([{ x: 800, y: 600, left: 8.9 }]);
    paint();
    expect(paints()).toBe(first + 1);
  });

  it("pulses: a change of the pulse step repaints while a chest is up, and a still screen does not", () => {
    const { minimap, paint, paints, ctx } = setup(false);
    minimap.setChests([{ x: 800, y: 600, left: 12 }]);
    paint(200);
    const first = paints();
    paint(1);
    // The update came 1 ms later: inside the throttle, so it does not even look.
    expect(paints()).toBe(first);
    const rings = new Set<number>();
    for (let i = 0; i < 12; i++) {
      paint(160);
      rings.add(argsOf(ctx, "arc").at(-2)![2] as number);
    }
    expect(paints()).toBeGreaterThan(first + 4);
    expect(rings.size).toBeGreaterThan(2);
  });

  it("holds still under reduced motion: the pulse never repaints it, and the ring stays one size", () => {
    const { minimap, paint, paints, ctx } = setup(true);
    minimap.setChests([{ x: 800, y: 600, left: 12 }]);
    paint();
    const first = paints();
    for (let i = 0; i < 12; i++) paint(160);
    expect(paints()).toBe(first);
    const radii = new Set(argsOf(ctx, "arc").map(([, , r]) => r));
    // The chest's outer ring, its disc, and the player-less map: only the blip's two sizes ever.
    expect(radii.size).toBeLessThanOrEqual(2);
  });

  it("follows the setting while open: motion back on, the pulse is back", () => {
    const { minimap, paint, paints, state } = setup(true);
    minimap.setChests([{ x: 800, y: 600, left: 12 }]);
    paint();
    const first = paints();
    for (let i = 0; i < 6; i++) paint(160);
    expect(paints()).toBe(first);
    state.reduced = false;
    for (let i = 0; i < 6; i++) paint(160);
    expect(paints()).toBeGreaterThan(first + 2);
  });

  it("goes when the chest does: an empty list repaints without blips", () => {
    const { minimap, ctx, paint } = setup(true);
    minimap.setChests([{ x: 800, y: 600, left: 12 }]);
    paint();
    expect(argsOf(ctx, "fillText")).toHaveLength(1);
    minimap.setChests([]);
    paint();
    expect(argsOf(ctx, "fillText")).toHaveLength(1);
    const before = argsOf(ctx, "drawImage").length;
    paint();
    expect(argsOf(ctx, "drawImage").length).toBe(before);
  });

  it("draws at most 32, and keeps a drawn blip off the camps' own marks (they are separate calls)", () => {
    const { minimap, ctx, paint } = setup(true);
    minimap.setChests(Array.from({ length: 40 }, (_, i) => ({ x: 100 + i * 40, y: 700, left: 5 })));
    paint();
    expect(argsOf(ctx, "fillText")).toHaveLength(32);
  });

  it("draws the blips over the camps and under the player", () => {
    const { minimap, ctx, paint } = setup(true);
    minimap.setChests([{ x: 800, y: 600, left: 5 }]);
    paint();
    const order = ctx.calls.map(([n]) => n);
    const lastCampFill = order.lastIndexOf("fill", order.indexOf("fillText"));
    expect(order.indexOf("fillText")).toBeGreaterThan(lastCampFill);
  });
});

describe("camp states", () => {
  it("crosses out a cleared camp and repaints when the state changes", () => {
    const { minimap, ctx, paint, paints } = setup();
    paint();
    const idleAlpha = ctx.calls.filter(([n]) => n === "globalAlpha=").length;
    const first = paints();
    minimap.setCampStates([0, 0, 0]);
    paint();
    expect(paints()).toBe(first);
    minimap.setCampStates([2, 0, 0]);
    paint();
    expect(paints()).toBe(first + 1);
    expect(ctx.calls.filter(([n]) => n === "globalAlpha=").length).toBeGreaterThan(idleAlpha);
    // The cross is two light diagonals: four more moveTo/lineTo pairs than the idle paint.
    const cleared = argsOf(ctx, "lineTo").length;
    minimap.setCampStates([0, 0, 0]);
    paint();
    expect(paints()).toBe(first + 2);
    const idleAgain = ctx.calls.filter(([n]) => n === "lineTo").length - cleared;
    expect(idleAgain).toBeLessThan(cleared);
  });

  it("shows the muted ring of a camp that has been fought at, and ignores a state it does not know", () => {
    const { minimap, ctx, paint, paints } = setup();
    paint();
    const first = paints();
    minimap.setCampStates([1, 0, 0]);
    paint();
    expect(argsOf(ctx, "strokeStyle=").some(([c]) => c === COLOR_DISTURBED)).toBe(true);
    minimap.setCampStates([1, 9, -3]);
    paint();
    // 9 and -3 read as idle, the same as [1, 0, 0]: no repaint.
    expect(paints()).toBe(first + 1);
  });

  it("is told every frame without a cost: the same states repaint nothing", () => {
    const { minimap, paint, paints } = setup();
    minimap.setCampStates([2, 1, 0]);
    paint();
    const first = paints();
    for (let i = 0; i < 6; i++) {
      minimap.setCampStates([2, 1, 0]);
      paint();
    }
    expect(paints()).toBe(first);
  });
});

describe("with no chest and no state", () => {
  it("paints exactly what it painted before: setting nothing and setting empty and idle are the same calls", () => {
    const a = setup();
    a.paint();
    const b = setup();
    b.minimap.setChests([]);
    b.minimap.setCampStates([0, 0, 0]);
    b.paint();
    const c = setup();
    c.minimap.setCampStates([]);
    c.paint();
    // The static layer is a canvas of its own in each setup: compared by position, not identity.
    const plain = (x: FakeObject): unknown[] => x.calls.map(([n, args]) => [n, args.map((v) => (typeof v === "object" ? "[object]" : v))]);
    expect(a.ctx.calls.length).toBeGreaterThan(30);
    expect(plain(b.ctx)).toEqual(plain(a.ctx));
    expect(plain(c.ctx)).toEqual(plain(a.ctx));
  });
});
