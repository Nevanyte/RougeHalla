// The ten elites' sprites in the world (render/eliteArt.ts): every elite type has an emblem of its own (two baked layers, one under the body
// disc and one over it), none is shared with another elite, a normal type has none, each fits its texture and stays clear of the hp bar's
// and the name's lane, and the hit flash is the same drawing in white. The Graphics is a call recorder (test/fakes.ts).
import { describe, expect, it } from "vitest";
import { MOB_TYPES, PLAYER_RADIUS } from "@raid/shared";
import {
  ELITE_ART, ELITE_ART_REGION, ELITE_FLASH, ELITE_LAYERS, drawEliteLayer, eliteArtKey, eliteArtOf, type EliteLayer,
} from "../src/render/eliteArt";
import { ELITE_TYPE_IDS } from "../src/ui/eliteGlyphs";
import { fakeObject, type Call, type FakeObject } from "./fakes";

const R = PLAYER_RADIUS * 1.1;
const elites = MOB_TYPES.filter((t) => t.elite);

const draw = (type: string, layer: EliteLayer, flash = false): Call[] => {
  const g = fakeObject("graphics");
  drawEliteLayer(g as never, eliteArtOf(type)!, layer, flash);
  return g.calls;
};

/** The box (x0, y0, x1, y1) the recorded shapes cover, by their coordinates and sizes, before any line width. */
function extent(calls: readonly Call[]): { x0: number; y0: number; x1: number; y1: number } {
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const take = (x: number, y: number, rx = 0, ry = rx): void => {
    box.x0 = Math.min(box.x0, x - rx); box.x1 = Math.max(box.x1, x + rx);
    box.y0 = Math.min(box.y0, y - ry); box.y1 = Math.max(box.y1, y + ry);
  };
  for (const [name, a] of calls) {
    const n = a as readonly number[];
    if (name === "moveTo" || name === "lineTo") take(n[0]!, n[1]!);
    else if (name === "lineBetween") { take(n[0]!, n[1]!); take(n[2]!, n[3]!); }
    else if (name === "fillCircle" || name === "strokeCircle") take(n[0]!, n[1]!, n[2]!);
    else if (name === "fillEllipse" || name === "strokeEllipse") take(n[0]!, n[1]!, n[2]! / 2, n[3]! / 2);
    else if (name === "fillRect") { take(n[0]!, n[1]!); take(n[0]! + n[2]!, n[1]! + n[3]!); }
  }
  return box;
}

describe("the ten elite emblems", () => {
  it("has an emblem for each of the ten elite types (the ten the map glyphs are for), and none for a normal type or an id it does not know", () => {
    expect(Object.keys(ELITE_ART).sort()).toEqual(elites.map((t) => t.id).sort());
    expect([...ELITE_TYPE_IDS].sort()).toEqual(Object.keys(ELITE_ART).sort());
    for (const t of elites) expect(eliteArtOf(t.id)?.id, t.id).toBe(t.id);
    for (const t of MOB_TYPES.filter((m) => !m.elite)) expect(eliteArtOf(t.id), t.id).toBeNull();
    for (const id of ["", "newElite", undefined, "toString", "__proto__"]) expect(eliteArtOf(id), String(id)).toBeNull();
  });

  it("draws at least one layer for each type, and gives each layer of each type a texture key of its own (and the flash variant another)", () => {
    const keys = new Set<string>();
    for (const t of elites) {
      const art = eliteArtOf(t.id)!;
      expect(ELITE_LAYERS.some((l) => art[l] !== null), t.id).toBe(true);
      for (const layer of ELITE_LAYERS) {
        for (const flash of [false, true]) {
          const key = eliteArtKey(t.id, layer, flash);
          expect(keys.has(key), key).toBe(false);
          keys.add(key);
        }
      }
    }
    expect(keys.size).toBe(10 * 2 * 2);
  });

  it("draws ten different emblems: no two types make the same drawing on either layer", () => {
    for (const layer of ELITE_LAYERS) {
      const drawn = elites.map((t) => ({ id: t.id, json: JSON.stringify(draw(t.id, layer)) })).filter((d) => d.json !== "[]");
      expect(new Set(drawn.map((d) => d.json)).size, layer).toBe(drawn.length);
    }
    // And as wholes: every type's pair of layers is its own.
    expect(new Set(elites.map((t) => JSON.stringify([draw(t.id, "back"), draw(t.id, "front")]))).size).toBe(10);
  });

  it("makes a layer a type does not use draw nothing at all", () => {
    for (const t of elites) {
      const art = eliteArtOf(t.id)!;
      for (const layer of ELITE_LAYERS) expect(draw(t.id, layer).length > 0, `${t.id} ${layer}`).toBe(art[layer] !== null);
    }
  });

  it("fits every layer in its texture, with room for the dark edge, and keeps the head's emblem under the name", () => {
    const { x0, y0, x1, y1 } = ELITE_ART_REGION;
    // The name sits 18 px over the disc's top (MobView LABEL_Y), the hp bar 8: nothing may rise further than 14 px over the rim.
    const lane = -(R + 14);
    for (const t of elites) {
      for (const layer of ELITE_LAYERS) {
        const calls = draw(t.id, layer);
        if (calls.length === 0) continue;
        const box = extent(calls);
        expect(box.x0, `${t.id} ${layer}`).toBeGreaterThanOrEqual(x0 + 1.5);
        expect(box.x1, `${t.id} ${layer}`).toBeLessThanOrEqual(x1 - 1.5);
        expect(box.y0, `${t.id} ${layer}`).toBeGreaterThanOrEqual(y0 + 1.5);
        expect(box.y1, `${t.id} ${layer}`).toBeLessThanOrEqual(y1 - 1.5);
        expect(box.y0, `${t.id} ${layer} rises into the name's lane`).toBeGreaterThanOrEqual(lane);
      }
    }
  });

  it("stands out of the body disc: every emblem reaches past the rim on some side (or sits on it, a hood, a helm, boils)", () => {
    for (const t of elites) {
      const boxes = ELITE_LAYERS.map((l) => draw(t.id, l)).filter((c) => c.length > 0).map(extent);
      const reach = Math.max(...boxes.flatMap((b) => [-b.x0, b.x1, -b.y0, b.y1]));
      expect(reach, t.id).toBeGreaterThan(R + 1);
    }
  });

  it("flashes in white: the same drawing with every fill one colour, the dark edge kept", () => {
    for (const t of elites) {
      for (const layer of ELITE_LAYERS) {
        const normal = draw(t.id, layer);
        const flash = draw(t.id, layer, true);
        expect(flash.length, `${t.id} ${layer}`).toBe(normal.length);
        // The same calls in the same order, only the colours differ.
        expect(flash.map(([n]) => n)).toEqual(normal.map(([n]) => n));
        // The rope of a tail or a tail-like chain is edged with discs of the dark edge colour first; everything else is the flash colour.
        const fills = flash.filter(([n]) => n === "fillStyle").map(([, a]) => a[0]);
        for (const c of fills) expect([ELITE_FLASH, 0x1b1f24], `${t.id} ${layer}`).toContain(c);
        if (normal.length > 0) expect(fills.filter((c) => c === ELITE_FLASH).length, `${t.id} ${layer}`).toBeGreaterThan(0);
        if (normal.length > 0) expect(JSON.stringify(flash), `${t.id} ${layer}`).not.toBe(JSON.stringify(normal));
        // Geometry (everything but the colour calls) is untouched.
        const geometry = (calls: readonly Call[]): Call[] => calls.filter(([n]) => n !== "fillStyle" && n !== "lineStyle");
        expect(geometry(flash)).toEqual(geometry(normal));
      }
    }
    expect(ELITE_FLASH).toBe(0xffffff);
  });

  it("draws only what the baked-texture contract allows: filled and stroked shapes on the one Graphics, no text, no images", () => {
    const allowed = new Set([
      "fillStyle", "lineStyle", "beginPath", "moveTo", "lineTo", "closePath", "fillPath", "strokePath", "fillCircle", "strokeCircle",
      "fillEllipse", "strokeEllipse", "lineBetween", "fillRect",
    ]);
    for (const t of elites) for (const layer of ELITE_LAYERS) for (const [name] of draw(t.id, layer)) expect(allowed.has(name), `${t.id} ${layer} ${name}`).toBe(true);
  });
});

/** The recorder is a FakeObject: a type check that the helper above hands the drawing a Graphics-shaped thing. */
const _g: FakeObject = fakeObject("graphics");
void _g;
