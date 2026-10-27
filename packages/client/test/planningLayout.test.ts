// What fits on a map's small screens (ui/planningMath.ts): the chips of crowded camps hide, the zone names move off the
// camps, and Page Down jumps between zones. Pure, on hand-made camps (the scatters are 20 camps at least 9/96 of the size apart,
// a layout of the older 96 x 96 map, not the 40 of a zone-shapes one); the DOM side is in planning.test.ts.
import { describe, expect, it } from "vitest";
import {
  campBoxes, campMarkerPx, chipSizePx, crowdedChips, glyphScale, labelSizePx, placeLabels, zoneJump, type CampSpot, type PxBox,
} from "../src/ui/planningMath";

const meet = (a: PxBox, b: PxBox): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const camp = (x: number, y: number, elite = false, chars = 4): CampSpot => ({ x, y, elite, chars });

/** Twenty camps on a grid-ish scatter, a pseudo-random but fixed layout at least `gap` apart. */
function scatter(size: number, count: number, gap: number): CampSpot[] {
  let seed = 12345;
  const next = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const out: CampSpot[] = [];
  for (let tries = 0; out.length < count && tries < 10_000; tries++) {
    const x = 10 + next() * (size - 20);
    const y = 10 + next() * (size - 20);
    if (out.every((c) => Math.hypot(c.x - x, c.y - y) >= gap)) out.push(camp(x, y, out.length % 5 === 0, 3 + (out.length % 3)));
  }
  return out;
}

describe("sizes", () => {
  it("scales the marks with the map's side, within bounds (the number planning.ts writes as --pl-glyph)", () => {
    expect(glyphScale(640)).toBe(1);
    expect(glyphScale(100)).toBe(0.55);
    expect(glyphScale(4000)).toBe(1.25);
    expect(glyphScale(320)).toBe(0.55);
  });

  it("matches the stylesheet's marker sizes: 22 and 30 px at full size, never under 12 and 16", () => {
    expect(campMarkerPx(false, 1)).toBe(22);
    expect(campMarkerPx(true, 1)).toBe(30);
    expect(campMarkerPx(false, 0.55)).toBeCloseTo(12.1, 9);
    expect(campMarkerPx(false, 0.3)).toBe(12);
    expect(campMarkerPx(true, 0.3)).toBe(16);
  });

  it("makes a chip and a label wider for longer text and a larger text size", () => {
    expect(chipSizePx(5, 1, 1).w).toBeGreaterThan(chipSizePx(3, 1, 1).w);
    expect(chipSizePx(4, 1, 1.5).h).toBeGreaterThan(chipSizePx(4, 1, 1).h);
    expect(labelSizePx(11, 1, 1).w).toBeGreaterThan(labelSizePx(4, 1, 1).w);
  });
});

describe("crowdedChips", () => {
  it("leaves every chip when the camps are far apart", () => {
    expect(crowdedChips([camp(50, 50), camp(300, 50), camp(50, 300)], [], 1, 1)).toEqual([false, false, false]);
  });

  it("hides the chip that would sit on a neighbour's marker, and keeps the one that does not", () => {
    // The second camp is just under the first: the first's chip (under its marker) lands on the second's marker.
    const crowded = crowdedChips([camp(100, 100), camp(100, 118)], [], 1, 1);
    expect(crowded[0]).toBe(true);
    expect(crowded[1]).toBe(false);
  });

  it("places elites first, so an elite's chip stays when it meets an ordinary camp's", () => {
    const crowded = crowdedChips([camp(100, 100), camp(120, 100, true)], [], 1, 1);
    expect(crowded).toEqual([true, false]);
    const swapped = crowdedChips([camp(120, 100, true), camp(100, 100)], [], 1, 1);
    expect(swapped).toEqual([false, true]);
  });

  it("never lets a chip with no text take room, nor be crowded", () => {
    const crowded = crowdedChips([camp(100, 100, false, 0), camp(100, 112)], [], 1, 1);
    expect(crowded[0]).toBe(false);
    expect(crowded[1]).toBe(false);
  });

  it("hides a chip that would sit under one of the marks given (a dealt spawn)", () => {
    const chipBelow = { x: 80, y: 114, w: 40, h: 20 };
    expect(crowdedChips([camp(100, 100)], [chipBelow], 1, 1)).toEqual([true]);
    expect(crowdedChips([camp(100, 100)], [{ x: 300, y: 300, w: 10, h: 10 }], 1, 1)).toEqual([false]);
  });

  it("leaves no two shown chips, and no chip on a marker, whatever the layout, at any size", () => {
    for (const size of [150, 216, 300, 570, 780]) {
      const glyph = glyphScale(size);
      const camps = scatter(size, 20, size * (9 / 96));
      expect(camps.length).toBe(20);
      const crowded = crowdedChips(camps, [], glyph, 1);
      const markers = camps.map((c) => {
        const m = campMarkerPx(c.elite, glyph);
        return { x: c.x - m / 2, y: c.y - m / 2, w: m, h: m };
      });
      const shown: Array<{ i: number; box: PxBox }> = [];
      camps.forEach((c, i) => {
        if (crowded[i]) return;
        const { w, h } = chipSizePx(c.chars, glyph, 1);
        shown.push({ i, box: { x: c.x - w / 2, y: c.y + campMarkerPx(c.elite, glyph) / 2 + 1, w, h } });
      });
      for (const a of shown) {
        for (const b of shown) if (a.i < b.i) expect(meet(a.box, b.box)).toBe(false);
        markers.forEach((m, j) => { if (j !== a.i) expect(meet(a.box, m)).toBe(false); });
      }
      // The boxes the labels are kept off: a marker per camp and a chip per shown one.
      expect(campBoxes(camps, crowded, glyph, 1)).toHaveLength(20 + shown.length);
    }
  });

  it("hides more on a small map than on a large one", () => {
    const at = (size: number): number => {
      const camps = scatter(size, 20, size * (9 / 96));
      return crowdedChips(camps, [], glyphScale(size), 1).filter(Boolean).length;
    };
    expect(at(150)).toBeGreaterThanOrEqual(at(300));
    expect(at(300)).toBeGreaterThanOrEqual(at(780));
  });
});

describe("placeLabels", () => {
  const everywhere = (): boolean => true;
  const wish = (x: number, y: number, inside: (x: number, y: number) => boolean = everywhere) => ({ x, y, w: 60, h: 14, inside });

  it("keeps a label where it wishes when the room is free", () => {
    expect(placeLabels([wish(100, 100)], [], 300)).toEqual([{ x: 100, y: 100 }]);
  });

  it("moves a label off an obstacle to the nearest free spot", () => {
    const obstacle = { x: 80, y: 90, w: 40, h: 24 };
    const [at] = placeLabels([wish(100, 100)], [obstacle], 300);
    expect(at).not.toEqual({ x: 100, y: 100 });
    expect(meet({ x: at!.x - 30, y: at!.y - 7, w: 60, h: 14 }, obstacle)).toBe(false);
    expect(Math.hypot(at!.x - 100, at!.y - 100)).toBeLessThanOrEqual(60);
  });

  it("keeps the whole label inside the map and inside its zone", () => {
    const zone = (x: number, y: number): boolean => x > 150;
    const [at] = placeLabels([wish(200, 100, zone)], [{ x: 170, y: 90, w: 60, h: 24 }], 300);
    expect(at!.x - 30).toBeGreaterThan(150);
    expect(at!.x + 30).toBeLessThanOrEqual(300);
    expect(at!.y - 7).toBeGreaterThanOrEqual(0);
  });

  it("keeps labels off each other", () => {
    const [a, b] = placeLabels([wish(100, 100), wish(100, 100)], [], 300);
    expect(meet({ x: a!.x - 30, y: a!.y - 7, w: 60, h: 14 }, { x: b!.x - 30, y: b!.y - 7, w: 60, h: 14 })).toBe(false);
  });

  it("falls back to the wish when nothing is free", () => {
    const wall = { x: 0, y: 0, w: 300, h: 300 };
    expect(placeLabels([wish(100, 100)], [wall], 300)).toEqual([{ x: 100, y: 100 }]);
  });
});

describe("zoneJump", () => {
  // spawn, spawn, fire x2, plague x2, holy, then a route stop.
  const zones = ["", "", "fire", "fire", "plague", "plague", "holy", ""];

  it("goes to the first marker of the next zone, and the previous one, wrapping", () => {
    expect(zoneJump(zones, 2, 1)).toBe(4);
    expect(zoneJump(zones, 3, 1)).toBe(4);
    expect(zoneJump(zones, 5, 1)).toBe(6);
    expect(zoneJump(zones, 6, 1)).toBe(2);
    expect(zoneJump(zones, 4, -1)).toBe(2);
    expect(zoneJump(zones, 2, -1)).toBe(6);
  });

  it("starts at the first zone going on and the last going back from a spawn or a stop", () => {
    expect(zoneJump(zones, 0, 1)).toBe(2);
    expect(zoneJump(zones, 0, -1)).toBe(6);
    expect(zoneJump(zones, 7, 1)).toBe(2);
    expect(zoneJump(zones, -1, 1)).toBe(2);
  });

  it("answers -1 when there is no camp to jump to", () => {
    expect(zoneJump(["", ""], 0, 1)).toBe(-1);
    expect(zoneJump([], 0, 1)).toBe(-1);
  });
});
