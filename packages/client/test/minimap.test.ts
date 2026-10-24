// Minimap.setMobs (Phase 11): which mobs become dots, how they look, the cap, and when the map repaints. The DOM and the canvas
// are fake (test/fakes.ts): the canvas context records its calls and its fillStyle/strokeStyle assignments.
import { afterEach, describe, expect, it, vi } from "vitest";
import { FACTIONS, WORLD_H, WORLD_W, mapFromTiles, TILE_FLOOR, type FactionId } from "@raid/shared";
import { Minimap, type MinimapMob } from "../src/ui/minimap";
import { cssColor } from "../src/ui/dom";
import { argsOf, FakeEl, installFakeDom, type FakeObject } from "./fakes";

/** The backing canvas is SIZE (150) css pixels at a device pixel ratio of 1. */
const K = 150 / Math.max(WORLD_W, WORLD_H);

function setup() {
  const { ui } = installFakeDom();
  const map = new Minimap();
  map.setMap(mapFromTiles(8, 8, new Uint8Array(64).fill(TILE_FLOOR)));
  const canvas = ui.children[0] as FakeEl;
  const ctx = canvas.getContext() as FakeObject;
  let now = 0;
  /** One update 200 ms after the last (past the repaint throttle). */
  const paint = (): void => { now += 200; map.update(now, undefined, true); };
  const arcs = () => argsOf(ctx, "arc");
  const paints = () => argsOf(ctx, "drawImage").length;
  return { map, ctx, paint, arcs, paints, now: () => now };
}

const mob = (over: Partial<MinimapMob> = {}): MinimapMob => ({ x: 400, y: 300, kind: "mob", status: "alive", faction: "fire", ...over });

afterEach(() => { vi.unstubAllGlobals(); });

describe("Minimap.setMobs", () => {
  it("draws a dot per living regional mob and skips dummies, the dead and unknown kinds", () => {
    const { map, paint, arcs } = setup();
    map.setMobs([
      mob({ x: 100, y: 200 }), mob({ kind: "elite", x: 300, y: 400 }),
      mob({ kind: "dummy" }), mob({ status: "dead" }), mob({ kind: "elite", status: "dead" }), mob({ kind: "crate" }),
    ]);
    paint();
    expect(arcs().map(([x, y]) => [x, y])).toEqual([[Math.round(100 * K), Math.round(200 * K)], [Math.round(300 * K), Math.round(400 * K)]]);
  });

  it("colours a dot by its faction and gives an elite a bigger one with a gold rim", () => {
    const { map, ctx, paint, arcs } = setup();
    map.setMobs([mob({ faction: "frost" }), mob({ kind: "elite", faction: "holy" })]);
    paint();
    const [small, big] = arcs();
    expect(big![2]).toBeGreaterThan(small![2] as number);
    const fills = ctx.calls.filter(([n]) => n === "fillStyle=").map(([, a]) => a[0]);
    expect(fills).toEqual([cssColor(FACTIONS.frost.color as number), cssColor(FACTIONS.holy.color as number)]);
    // Only the elite is outlined (in gold), and a mob of an unknown faction still gets a (neutral) dot.
    const strokes = ctx.calls.filter(([n]) => n === "strokeStyle=").map(([, a]) => a[0]);
    expect(strokes).toEqual(["#ffd54f"]);
    map.setMobs([mob({ faction: "from-newer-content" as FactionId })]);
    paint();
    expect(arcs()).toHaveLength(3);
  });

  it("caps the dots at 128", () => {
    const { map, paint, arcs } = setup();
    map.setMobs(Array.from({ length: 200 }, (_, i) => mob({ x: i * 10, y: i * 5 })));
    paint();
    expect(arcs()).toHaveLength(128);
    // The cap counts dots, not mobs offered: skipped ones do not use it up.
    map.setMobs([...Array.from({ length: 100 }, () => mob({ status: "dead" })), ...Array.from({ length: 128 }, () => mob())]);
    paint();
    expect(arcs().length).toBe(128 + 128);
  });

  it("repaints only when a dot appears, moves a pixel or goes, and not within the throttle", () => {
    const { map, paint, paints, ctx, now } = setup();
    expect(paints()).toBe(0);
    map.setMobs([mob()]);
    paint();
    expect(paints()).toBe(1);
    map.setMobs([mob()]);
    paint();
    expect(paints()).toBe(1); // the same dots: nothing to redraw
    map.setMobs([mob({ x: 400 + 1 / K })]); // a pixel to the right
    paint();
    expect(paints()).toBe(2);
    map.setMobs([mob({ x: 400 + 1 / K, status: "dead" })]); // it died: the dot goes
    paint();
    expect(paints()).toBe(3);
    expect(argsOf(ctx, "arc")).toHaveLength(2);
    map.setMobs([mob({ x: 5 })]);
    map.update(now() + 50, undefined, true); // 50 ms after the last update: held back
    expect(paints()).toBe(3);
  });

  it("paints nothing before a map is set", () => {
    const { ui } = installFakeDom();
    const m = new Minimap();
    m.setMobs([mob()]);
    m.update(1000, undefined, true);
    expect(((ui.children[0] as FakeEl).getContext() as FakeObject).calls).toEqual([]);
  });
});
