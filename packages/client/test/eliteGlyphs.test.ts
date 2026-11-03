// The ten elites' map icons (ui/eliteGlyphs.ts): every elite type has its own glyph, told from the other nine by silhouette at the sizes
// the maps draw them, the k-th elite camp of a zone gets the zone's k-th elite, a camp that is painted alone or moved onto a layout slot
// keeps its glyph, an elite whose type is not known keeps the old crown, and the planning screen's SVG is the same shapes. The 2D context
// is a call recorder (test/fakes.ts); the silhouettes are rasterised here by hand.
import { describe, expect, it } from "vitest";
import { FACTION_IDS, MOB_TYPES, elitesOf, generateMap, isEliteCamp, mobTypeById, rollCampElites, type CampDef, type FactionId } from "@raid/shared";
import {
  ELITE_GLYPHS, ELITE_TYPE_IDS, GLYPH_FILL, GLYPH_INK, campEliteTypes, eliteGlyphOf, eliteGlyphSvg, noteEliteCamps, type EliteGlyph, type GlyphPart,
} from "../src/ui/eliteGlyphs";
import { COLOR_CROWN, COLOR_OUTLINE, paintCamps, paintMapBase, type CampMark, type PaintCtx } from "../src/ui/mapPainter";
import { argsOf, fakeObject, type FakeObject } from "./fakes";

const rec = (): FakeObject => fakeObject("ctx");
const ctxOf = (o: FakeObject): PaintCtx => o as unknown as PaintCtx;
const elites = MOB_TYPES.filter((t) => t.elite);

// ------------------------------------------------------------------------------------------------------------------ silhouettes

type Mask = readonly boolean[];

const inPoly = (poly: ReadonlyArray<readonly [number, number]>, x: number, y: number): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const inPart = (p: GlyphPart, x: number, y: number): boolean => ("disc" in p ? Math.hypot(x - p.disc[0], y - p.disc[1]) <= p.disc[2] : inPoly(p.poly, x, y));

/** The glyph as `n` x `n` pixels over its box (-1.1 to 1.1), a pixel on where it is gold (inside a gold part and no ink part), by 4 x 4 samples a pixel (on at half). */
function mask(glyph: EliteGlyph, n: number): Mask {
  const out: boolean[] = [];
  for (let py = 0; py < n; py++) {
    for (let px = 0; px < n; px++) {
      let on = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const x = -1.1 + ((px + (sx + 0.5) / 4) / n) * 2.2;
          const y = -1.1 + ((py + (sy + 0.5) / 4) / n) * 2.2;
          const gold = glyph.parts.some((p) => p.ink !== true && inPart(p, x, y));
          if (gold && !glyph.parts.some((p) => p.ink === true && inPart(p, x, y))) on++;
        }
      }
      out.push(on >= 8);
    }
  }
  return out;
}

const overlap = (a: Mask, b: Mask): number => {
  let both = 0, either = 0;
  a.forEach((v, i) => { if (v && b[i]) both++; if (v || b[i]) either++; });
  return either === 0 ? 0 : both / either;
};

describe("the ten elite glyphs", () => {
  it("has one glyph for each of the ten elite types, two a zone, and none for a normal type", () => {
    expect(elites).toHaveLength(10);
    expect(ELITE_TYPE_IDS).toEqual(elites.map((t) => t.id));
    for (const zone of FACTION_IDS) expect(elitesOf(zone)).toHaveLength(2);
    expect(Object.keys(ELITE_GLYPHS).sort()).toEqual(elites.map((t) => t.id).sort());
    for (const t of elites) expect(eliteGlyphOf(t.id)?.id, t.id).toBe(t.id);
    for (const t of MOB_TYPES.filter((m) => !m.elite)) expect(eliteGlyphOf(t.id), t.id).toBeNull();
    for (const id of ["", "newElite", undefined, "toString", "constructor", "__proto__"]) expect(eliteGlyphOf(id), String(id)).toBeNull();
  });

  it("gives every elite a geometry of its own: no two glyphs share a single shape set", () => {
    const shapes = elites.map((t) => JSON.stringify(eliteGlyphOf(t.id)!.parts));
    expect(new Set(shapes).size).toBe(10);
  });

  it("keeps every shape inside the unit box with at least three corners (a disc: a positive radius) and a gold part to show", () => {
    for (const t of elites) {
      const glyph = eliteGlyphOf(t.id)!;
      expect(glyph.parts.some((p) => p.ink !== true), t.id).toBe(true);
      for (const p of glyph.parts) {
        if ("disc" in p) {
          const [x, y, r] = p.disc;
          expect(r, t.id).toBeGreaterThan(0);
          expect(Math.max(Math.abs(x) + r, Math.abs(y) + r), t.id).toBeLessThanOrEqual(1.1);
        } else {
          expect(p.poly.length, t.id).toBeGreaterThanOrEqual(3);
          for (const [x, y] of p.poly) expect(Math.max(Math.abs(x), Math.abs(y)), t.id).toBeLessThanOrEqual(1.1);
        }
      }
    }
  });

  it("tells all ten apart by silhouette at the sizes the maps draw them (8 to 14 px): no two share most of their pixels", () => {
    const worst: Array<[number, string]> = [];
    for (const size of [8, 10, 12, 14]) {
      const masks = elites.map((t) => mask(eliteGlyphOf(t.id)!, size));
      masks.forEach((m, i) => expect(m.filter(Boolean).length, `${elites[i]!.id} at ${size} px`).toBeGreaterThanOrEqual(size * 2));
      for (let i = 0; i < elites.length; i++) {
        for (let j = i + 1; j < elites.length; j++) worst.push([overlap(masks[i]!, masks[j]!), `${elites[i]!.id}/${elites[j]!.id} at ${size} px`]);
      }
    }
    worst.sort((a, b) => b[0] - a[0]);
    // Two glyphs that overlap on over 70% of their pixels would be one blob to a player.
    expect(worst[0]![0], worst[0]![1]).toBeLessThan(0.7);
  });
});

// ------------------------------------------------------------------------------------------------------------ which camp holds which

const camp = (zone: FactionId, x: number, y: number, eliteSpot = -1): CampMark => ({ zone, x, y, eliteSpot });

/** The calls a camp draws, without the painter's three set-up lines (line width, stroke colour, line join). */
const body = (g: FakeObject): FakeObject["calls"] => g.calls.slice(3);

describe("campEliteTypes (rollCampElites for a list of camps)", () => {
  it("is the zone's k-th elite for the zone's k-th elite camp, in camp order, and nothing for a camp without one", () => {
    const list = [camp("fire", 1, 1, 0), camp("frost", 2, 2, 0), camp("fire", 3, 3), camp("fire", 4, 4, 0), camp("frost", 5, 5, 0)];
    const [fire1, fire2] = elitesOf("fire");
    const [frost1, frost2] = elitesOf("frost");
    expect(campEliteTypes(list)).toEqual([fire1!.id, frost1!.id, "", fire2!.id, frost2!.id]);
    expect(campEliteTypes(list)).toEqual(rollCampElites(list));
  });

  it("takes the elite a camp says outright, then the one remembered for the map's own camp (a copy of it too), then the count of the list", () => {
    const map = generateMap(7);
    const eliteCamps = map.camps.filter(isEliteCamp);
    const lone = eliteCamps.find((c) => c.zone === "fire" && elitesOf("fire")[1]!.id === campEliteTypes(map.camps)[map.camps.indexOf(c)])!;
    // Alone and not remembered: the first of its zone (the count of a one-camp list).
    expect(campEliteTypes([{ ...lone, spots: undefined }])).toEqual([elitesOf("fire")[0]!.id]);
    noteEliteCamps(map.camps);
    expect(campEliteTypes([lone])).toEqual([elitesOf("fire")[1]!.id]);
    expect(campEliteTypes([{ ...lone, x: 3, y: 4 }])).toEqual([elitesOf("fire")[1]!.id]);
    expect(campEliteTypes([{ ...lone, elite: elitesOf("fire")[0]!.id }])).toEqual([elitesOf("fire")[0]!.id]);
    expect(campEliteTypes([{ ...lone, eliteSpot: -1 }])).toEqual([""]);
  });

  it("gives each of the ten elite camps of a real map its own elite: the two of a zone differ, all ten differ", () => {
    for (const seed of [1, 7, 31]) {
      const map = generateMap(seed);
      const types = campEliteTypes(map.camps).filter((t) => t !== "");
      expect(types).toHaveLength(10);
      expect(new Set(types).size).toBe(10);
      expect(types.every((t) => mobTypeById(t)?.elite === true)).toBe(true);
    }
  });
});

describe("paintCamps and the elite's glyph", () => {
  const calls = (list: readonly CampMark[]): FakeObject["calls"] => { const g = rec(); paintCamps(ctxOf(g), list, 1, 2); return body(g); };

  it("paints the glyph of the zone's k-th elite for the k-th elite camp of the zone, and each glyph differs", () => {
    for (const zone of FACTION_IDS) {
      const [first, second] = elitesOf(zone);
      const list = [camp(zone, 100, 100, 0), camp(zone, 200, 100), camp(zone, 300, 100, 0)];
      // The list's calls are the three camps' own, the elite ones painted as if they named their elite.
      const expected = [
        ...calls([{ ...list[0]!, elite: first!.id }]), ...calls([list[1]!]), ...calls([{ ...list[2]!, elite: second!.id }]),
      ];
      expect(calls(list), zone).toEqual(expected);
      expect(JSON.stringify(calls([{ ...list[0]!, elite: first!.id }])), zone).not.toBe(JSON.stringify(calls([{ ...list[0]!, elite: second!.id }])));
    }
  });

  it("paints ten different glyphs for the ten elites, each over its zone's mark", () => {
    const seen = new Set<string>();
    for (const t of elites) {
      const g = rec();
      paintCamps(ctxOf(g), [{ ...camp(t.zone, 100, 100, 0), elite: t.id }], 1, 2);
      seen.add(JSON.stringify(body(g)));
      // The mark's fill, then the glyph's gold; ink only for the glyphs that have some.
      const fills = argsOf(g, "fillStyle=").map(([c]) => c);
      expect(fills[1], t.id).toBe(COLOR_CROWN);
      if (eliteGlyphOf(t.id)!.parts.some((p) => p.ink === true)) expect(fills[2], t.id).toBe(COLOR_OUTLINE);
      expect(argsOf(g, "arc"), t.id).toHaveLength(0);
    }
    expect(seen.size).toBe(10);
  });

  it("puts each glyph in a box just over its mark, centred on it, a little under half as wide as the mark's reach again", () => {
    for (const t of elites) {
      const g = rec();
      paintCamps(ctxOf(g), [{ ...camp(t.zone, 400, 600, 0), elite: t.id }], 1, 2);
      // The points of the paths drawn after the mark's own outline (its first stroke) are the glyph's.
      const first = g.calls.findIndex(([n]) => n === "stroke");
      const points = g.calls.slice(first + 1).filter(([n]) => n === "moveTo" || n === "lineTo").map(([, a]) => a as readonly number[]);
      expect(points.length, t.id).toBeGreaterThan(8);
      const r = 4.6 * 2;
      for (const [x, y] of points) {
        expect(y!, t.id).toBeLessThanOrEqual(600 - r + 0.1 * 0.78 * r);
        expect(Math.abs(x! - 400), t.id).toBeLessThanOrEqual(r * 0.78 * 1.1 + 0.01);
      }
      // Over the crown's own reach (1.97 r above the centre) but not out of the camp's slot (about 2.7 r).
      const top = Math.min(...points.map(([, y]) => y!));
      expect(600 - top, t.id).toBeGreaterThan(1.97 * r);
      expect(600 - top, t.id).toBeLessThan(2.8 * r);
    }
  });

  it("keeps the glyph of a camp that is painted alone or moved onto a layout slot (the minimap's way), once the map it belongs to has been painted", () => {
    const map = generateMap(7);
    paintMapBase(ctxOf(rec()), map, 208, 208, 208 / 2048);
    const all = rec();
    paintCamps(ctxOf(all), map.camps, 1, 1.6);
    // Each camp on its own, as a copy (`{ ...camp, x, y }`), draws exactly what it drew in the list.
    const apart: FakeObject["calls"] = [];
    for (const c of map.camps) {
      const one = rec();
      paintCamps(ctxOf(one), [{ ...c, x: c.x, y: c.y }], 1, 1.6);
      apart.push(...body(one));
    }
    expect(apart).toEqual(body(all));
  });

  it("falls back to the crown for an elite camp whose elite is an id this build does not know, and to nothing extra for a plain camp", () => {
    const g = rec();
    paintCamps(ctxOf(g), [{ ...camp("plague", 100, 100, 0), elite: "mysteryElite" }], 1, 2);
    expect(argsOf(g, "fillStyle=").map(([c]) => c)).toHaveLength(2);
    expect(argsOf(g, "moveTo")).toHaveLength(2);
    const plain = rec();
    paintCamps(ctxOf(plain), [{ ...camp("plague", 100, 100), elite: "wyrmling" }], 1, 2);
    expect(argsOf(plain, "fillStyle=")).toHaveLength(1);
  });

  it("dims a cleared elite camp's glyph with its mark", () => {
    const g = rec();
    g.globalAlpha = 1;
    g.calls.length = 0;
    paintCamps(ctxOf(g), [{ ...camp("frost", 100, 100, 0), elite: "glacialWarden" }], 1, 2, [2]);
    const dim = g.calls.findIndex(([n, a]) => n === "globalAlpha=" && (a[0] as number) < 1);
    const restore = g.calls.findIndex(([n, a]) => n === "globalAlpha=" && a[0] === 1);
    const gold = g.calls.findIndex(([n, a]) => n === "fillStyle=" && a[0] === COLOR_CROWN);
    expect(gold).toBeGreaterThan(dim);
    expect(gold).toBeLessThan(restore);
  });
});

// ------------------------------------------------------------------------------------------------------------------ as an SVG

describe("the planning screen's glyphs (inline SVG)", () => {
  const svgs = elites.map((t) => eliteGlyphSvg(eliteGlyphOf(t.id)!));

  it("draws the same shapes as the canvas: a polygon or circle per part, in the map painter's gold and dark, and ten different documents", () => {
    expect(new Set(svgs).size).toBe(10);
    elites.forEach((t, i) => {
      const glyph = eliteGlyphOf(t.id)!;
      const svg = svgs[i]!;
      expect(svg.startsWith("<svg xmlns="), t.id).toBe(true);
      const shapes = (svg.match(/<(polygon|circle) /g) ?? []).length;
      // Each gold part twice (the silhouette's outline, then its gold), each ink part once.
      expect(shapes, t.id).toBe(glyph.parts.reduce((n, p) => n + (p.ink === true ? 1 : 2), 0));
      expect(svg).toContain(GLYPH_FILL);
      expect(svg).toContain(GLYPH_INK);
    });
    expect(GLYPH_FILL).toBe(COLOR_CROWN);
    expect(GLYPH_INK).toBe(COLOR_OUTLINE);
  });

  it("is made once per glyph", () => {
    const glyph = eliteGlyphOf("archon")!;
    expect(eliteGlyphSvg(glyph)).toBe(eliteGlyphSvg(glyph));
  });
});

/** Compile-time: the glyph table is keyed by exactly the elite ids. */
const _keys: ReadonlyArray<keyof typeof ELITE_GLYPHS> = ELITE_TYPE_IDS as ReadonlyArray<keyof typeof ELITE_GLYPHS>;
void _keys;
void (null as unknown as CampDef);
