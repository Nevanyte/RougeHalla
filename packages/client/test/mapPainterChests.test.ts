// The map painter's two additions for the camp chests (ui/mapPainter.ts): a cleared camp is dimmed and crossed out, an engaged one
// wears a flame, and a chest that is up is a gold blip with its seconds. With no state and no chest the painter makes exactly the
// calls it made before (the reference below is the old paintCamps, kept verbatim). The 2D context is a call recorder.
import { describe, expect, it } from "vitest";
import { FACTIONS, FACTION_IDS, type CampDef, type FactionId } from "@raid/shared";
import { cssColor } from "../src/ui/dom";
import {
  CAMP_CLEARED, CAMP_ENGAGED, CAMP_IDLE, COLOR_CHEST, COLOR_CROWN, COLOR_OUTLINE, SHAPE_POLYGON, ZONE_SHAPE, paintCamps, paintChests,
  zoneColor, type PaintCtx,
} from "../src/ui/mapPainter";
import { argsOf, fakeObject, names, type FakeObject } from "./fakes";

const rec = (): FakeObject => fakeObject("ctx");
const ctxOf = (o: FakeObject): PaintCtx => o as unknown as PaintCtx;
const K = 208 / 2048;

type CampPick = Pick<CampDef, "zone" | "x" | "y" | "eliteSpot">;
const camp = (zone: FactionId, x: number, y: number, eliteSpot = -1): CampPick => ({ zone, x, y, eliteSpot });

/** The camp painter as it was before the camp chests, verbatim (the polygons and crown are the painter's own). */
function referenceCamps(g: FakeObject, camps: readonly CampPick[], k: number, px: number): void {
  const CROWN: ReadonlyArray<readonly [number, number]> = [[-1, 0], [-1, -0.9], [-0.5, -0.4], [0, -1.1], [0.5, -0.4], [1, -0.9], [1, 0]];
  const poly = (p: ReadonlyArray<readonly [number, number]>, cx: number, cy: number, r: number): void => {
    p.forEach(([x, y], i) => { if (i === 0) g.moveTo(cx + x * r, cy + y * r); else g.lineTo(cx + x * r, cy + y * r); });
    g.closePath();
  };
  g.lineWidth = px;
  g.strokeStyle = COLOR_OUTLINE;
  g.lineJoin = "round";
  for (const c of camps) {
    const elite = c.eliteSpot >= 0;
    const r = (elite ? 4.6 : 3.4) * px;
    const cx = c.x * k;
    const cy = c.y * k;
    g.fillStyle = zoneColor(c.zone);
    g.beginPath();
    poly(SHAPE_POLYGON[ZONE_SHAPE[c.zone]], cx, cy, r);
    g.fill();
    g.stroke();
    if (elite) {
      g.fillStyle = COLOR_CROWN;
      g.beginPath();
      poly(CROWN, cx, cy - r * 1.05 - r * 0.15, r * 0.7);
      g.fill();
      g.stroke();
    }
  }
}

const SOME: CampPick[] = [camp("fire", 400, 300), camp("holy", 900, 1200, 0), camp("plague", 1500, 700), camp("frost", 200, 1800, 0), camp("sentenced", 1700, 1700)];

describe("paintCamps with no state", () => {
  it("makes exactly the calls it made before the chests, with no states, with none passed, and with every camp idle", () => {
    const old = rec();
    referenceCamps(old, SOME, K, 1.3);
    const plain = rec();
    paintCamps(ctxOf(plain), SOME, K, 1.3);
    const idle = rec();
    paintCamps(ctxOf(idle), SOME, K, 1.3, SOME.map(() => CAMP_IDLE));
    const short = rec();
    paintCamps(ctxOf(short), SOME, K, 1.3, []);
    expect(old.calls.length).toBeGreaterThan(40);
    expect(plain.calls).toEqual(old.calls);
    expect(idle.calls).toEqual(old.calls);
    expect(short.calls).toEqual(old.calls);
  });
});

describe("a cleared camp", () => {
  it("is dimmed, drawn as the plain marker, then crossed out with a dark line under a light one", () => {
    const g = rec();
    paintCamps(ctxOf(g), [camp("fire", 400, 300)], K, 1, [CAMP_CLEARED]);
    const calls = g.calls;
    const dim = calls.findIndex(([n, a]) => n === "globalAlpha=" && (a[0] as number) < 1);
    const restore = calls.findIndex(([n, a]) => n === "globalAlpha=" && a[0] === 1);
    const fill = calls.findIndex(([n]) => n === "fill");
    expect(dim).toBeGreaterThanOrEqual(0);
    // The marker's fill is painted dim, the cross at full strength.
    expect(dim).toBeLessThan(fill);
    expect(restore).toBeGreaterThan(fill);
    const alpha = calls[dim]![1][0] as number;
    expect(alpha).toBeGreaterThan(0.2);
    expect(alpha).toBeLessThan(0.6);
    // Two strokes of two diagonals each: moveTo+lineTo per diagonal, after the marker's own outline.
    const after = calls.slice(restore);
    expect(after.filter(([n]) => n === "moveTo")).toHaveLength(2 * 2);
    expect(after.filter(([n]) => n === "lineTo")).toHaveLength(2 * 2);
    const strokeColors = after.filter(([n]) => n === "strokeStyle=").map(([, a]) => a[0]);
    expect(strokeColors[0]).toBe(COLOR_OUTLINE);
    expect(strokeColors[1]).toBe("#eceff1");
  });

  it("dims an elite's crown with its marker, and ends with the outline settings the next camp expects", () => {
    const g = rec();
    paintCamps(ctxOf(g), [camp("holy", 900, 1200, 0), camp("fire", 400, 300)], K, 1, [CAMP_CLEARED, CAMP_IDLE]);
    const alphas = g.calls.filter(([n]) => n === "globalAlpha=").map(([, a]) => a[0]);
    expect(alphas).toHaveLength(2);
    expect(alphas[1]).toBe(1);
    const crown = g.calls.findIndex(([n, a]) => n === "fillStyle=" && a[0] === COLOR_CROWN);
    const dim = g.calls.findIndex(([n]) => n === "globalAlpha=");
    const restore = g.calls.findIndex(([n, a]) => n === "globalAlpha=" && a[0] === 1);
    expect(crown).toBeGreaterThan(dim);
    expect(crown).toBeLessThan(restore);
    // The idle camp after it is drawn plainly: its own fill colour comes after the cross.
    const lastFill = argsOf(g, "fillStyle=").at(-1)![0];
    expect(lastFill).toBe(cssColor(FACTIONS.fire.color));
    expect(g.calls.at(-1)![0]).not.toBe("globalAlpha=");
  });

  it("only the cleared camp changes: the others in the list draw as they did", () => {
    const all = rec();
    paintCamps(ctxOf(all), SOME, K, 1, [CAMP_IDLE, CAMP_CLEARED, CAMP_IDLE, CAMP_IDLE, CAMP_IDLE]);
    const base = rec();
    paintCamps(ctxOf(base), SOME, K, 1);
    const perCamp = (g: FakeObject): number => g.calls.filter(([n]) => n === "fill").length;
    expect(perCamp(all)).toBe(perCamp(base));
    expect(all.calls.length).toBeGreaterThan(base.calls.length);
  });

  it("is told by dimming and a cross, whatever the zone's colour: every zone's cleared marker has the same cross", () => {
    const crosses = FACTION_IDS.map((zone) => {
      const g = rec();
      paintCamps(ctxOf(g), [camp(zone, 400, 300)], K, 1, [CAMP_CLEARED]);
      const i = g.calls.findIndex(([n, a]) => n === "globalAlpha=" && a[0] === 1);
      return JSON.stringify(g.calls.slice(i));
    });
    expect(new Set(crosses).size).toBe(1);
  });
});

describe("an engaged camp", () => {
  it("wears a small orange flame beside its marker, and is not dimmed or crossed", () => {
    const plain = rec();
    paintCamps(ctxOf(plain), [camp("plague", 400, 300)], K, 1);
    const g = rec();
    paintCamps(ctxOf(g), [camp("plague", 400, 300)], K, 1, [CAMP_ENGAGED]);
    expect(argsOf(g, "fillStyle=").map(([c]) => c)).toEqual([zoneColor("plague"), "#ff7043"]);
    expect(names(g).filter((n) => n === "fill")).toHaveLength(2);
    expect(g.calls.some(([n]) => n === "globalAlpha=")).toBe(false);
    // The flame is five points: a moveTo and four lineTos more than the plain marker.
    expect(names(g).filter((n) => n === "lineTo").length - names(plain).filter((n) => n === "lineTo").length).toBe(4);
  });
});

describe("paintChests", () => {
  const first = (over: Partial<{ x: number; y: number; left: number }> = {}) => ({ x: 800, y: 600, left: 9.2, ...over });

  it("draws nothing for no chests", () => {
    const g = rec();
    paintChests(ctxOf(g), [], K, 1);
    expect(g.calls).toEqual([]);
  });

  it("draws a ringed gold chest with the seconds left, rounded up, beside it", () => {
    const g = rec();
    paintChests(ctxOf(g), [first()], K, 1.4);
    const text = argsOf(g, "fillText");
    expect(text).toHaveLength(1);
    expect(text[0]![0]).toBe("10");
    expect(text[0]![1]).toBeCloseTo(800 * K);
    expect(text[0]![2] as number).toBeGreaterThan(600 * K);
    // The number is outlined first, so it reads on any tint.
    expect(argsOf(g, "strokeText")).toHaveLength(1);
    expect(argsOf(g, "fillStyle=").map(([c]) => c)).toContain(COLOR_CHEST);
    expect(argsOf(g, "arc").length).toBeGreaterThanOrEqual(2);
    expect(argsOf(g, "fillRect")).toHaveLength(2);
  });

  it("is not a camp marker: no zone polygon, no zone colour, no crown", () => {
    const g = rec();
    paintChests(ctxOf(g), [first()], K, 1);
    expect(names(g)).not.toContain("moveTo");
    expect(names(g)).not.toContain("lineTo");
    const fills = argsOf(g, "fillStyle=").map(([c]) => c);
    for (const zone of FACTION_IDS) expect(fills).not.toContain(cssColor(FACTIONS[zone].color));
  });

  it("counts a part of a second as a whole one and never shows a negative number", () => {
    const text = (left: number): unknown => {
      const g = rec();
      paintChests(ctxOf(g), [first({ left })], K, 1);
      return argsOf(g, "fillText")[0]![0];
    };
    expect(text(14.001)).toBe("15");
    expect(text(0.2)).toBe("1");
    expect(text(0)).toBe("0");
    expect(text(-4)).toBe("0");
  });

  it("breathes the outer ring with the pulse, and holds still at 0", () => {
    const ringAt = (pulse: number): number => {
      const g = rec();
      paintChests(ctxOf(g), [first()], K, 1, pulse);
      return argsOf(g, "arc")[0]![2] as number;
    };
    expect(ringAt(1)).toBeGreaterThan(ringAt(0));
    expect(ringAt(0)).toBeCloseTo(4.4);
  });

  it("draws every chest it is given, each with its own number", () => {
    const g = rec();
    paintChests(ctxOf(g), [first({ left: 3 }), first({ x: 1500, y: 900, left: 12 })], K, 1);
    expect(argsOf(g, "fillText").map(([t]) => t)).toEqual(["3", "12"]);
  });

  it("grows its text with the map's size, with a floor", () => {
    const size = (px: number): number => {
      const g = rec();
      paintChests(ctxOf(g), [first()], K, px);
      const font = g.calls.find(([n]) => n === "font=")![1][0] as string;
      return Number(/(\d+)px/.exec(font)![1]);
    };
    expect(size(0.5)).toBe(8);
    expect(size(1)).toBeGreaterThanOrEqual(8);
    expect(size(3)).toBeGreaterThan(size(1));
  });
});
