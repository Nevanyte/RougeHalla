// The zone palettes (render/zoneArt/palette.ts): the contrast ratios of the design table (part D 7.2) are pinned as floors, the
// floors stay dark in every zone, and the colour maths behind it.
import { describe, expect, it } from "vitest";
import { REGION_FACTIONS } from "@raid/shared";
import {
  TERRAIN_PALETTE, ZONE_PALETTE, contrastRatio, darken, isZoneKey, lighten, lightness, mix, relativeLuminance, rgb,
} from "../src/render/zoneArt/palette";

describe("colour maths", () => {
  it("measures black and white at the extremes of WCAG luminance and contrast", () => {
    expect(relativeLuminance(0x000000)).toBe(0);
    expect(relativeLuminance(0xffffff)).toBeCloseTo(1, 6);
    expect(contrastRatio(0x000000, 0xffffff)).toBeCloseTo(21, 4);
    expect(contrastRatio(0xffffff, 0x000000)).toBeCloseTo(21, 4);
    expect(contrastRatio(0x336699, 0x336699)).toBe(1);
  });

  it("puts L* at 0 for black and 100 for white", () => {
    expect(lightness(0x000000)).toBeCloseTo(0, 6);
    expect(lightness(0xffffff)).toBeCloseTo(100, 4);
  });

  it("mixes channel by channel, clamped to a byte", () => {
    expect(mix(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(mix(0x102030, 0x102030, 0.7)).toBe(0x102030);
    expect(mix(0xff0000, 0x0000ff, 0)).toBe(0xff0000);
    expect(mix(0xff0000, 0x0000ff, 1)).toBe(0x0000ff);
    expect(lighten(0x000000, 1)).toBe(0xffffff);
    expect(darken(0xffffff, 1)).toBe(0x000000);
    expect(rgb(300, -5, 128.4)).toBe(0xff0080);
  });

  it("knows the five zone keys and nothing else", () => {
    for (const f of REGION_FACTIONS) expect(isZoneKey(f)).toBe(true);
    for (const id of ["none", "coliseum", "", "toString"]) expect(isZoneKey(id)).toBe(false);
  });
});

describe("the zone palettes", () => {
  it("has a palette for each faction region", () => {
    expect(Object.keys(ZONE_PALETTE).sort()).toEqual([...REGION_FACTIONS].sort());
  });

  // The design's table (D 7.2): contrast of each colour against its zone's floor. Pinned as floors, not exact values, so a
  // retune may only improve readability.
  const TABLE: ReadonlyArray<readonly [string, number, number, number]> = [
    ["Scorch wall top", ZONE_PALETTE.fire.wallTop, ZONE_PALETTE.fire.floor, 1.85],
    ["Scorch lava body", TERRAIN_PALETTE.lava.body, ZONE_PALETTE.fire.floor, 4.76],
    ["Scorch ember glow", TERRAIN_PALETTE.ember.glow, ZONE_PALETTE.fire.floor, 6.32],
    ["Gallows wall top", ZONE_PALETTE.sentenced.wallTop, ZONE_PALETTE.sentenced.floor, 2.76],
    ["Gallows fence highlight", TERRAIN_PALETTE.fence.highlight, ZONE_PALETTE.sentenced.floor, 3.63],
    ["Warren wall top", ZONE_PALETTE.plague.wallTop, ZONE_PALETTE.plague.floor, 2.99],
    ["Warren bog body", TERRAIN_PALETTE.bog.body, ZONE_PALETTE.plague.floor, 1.77],
    ["Warren bog surface", TERRAIN_PALETTE.bog.surface, ZONE_PALETTE.plague.floor, 6.27],
    ["Rime wall top", ZONE_PALETTE.frost.wallTop, ZONE_PALETTE.frost.floor, 7.64],
    ["Rime ice", TERRAIN_PALETTE.ice.body, ZONE_PALETTE.frost.floor, 5.11],
    ["Rime crevasse", TERRAIN_PALETTE.crevasse.body, ZONE_PALETTE.frost.floor, 1.96],
    ["Sanctum wall top", ZONE_PALETTE.holy.wallTop, ZONE_PALETTE.holy.floor, 7.44],
    ["Sanctum light beam", TERRAIN_PALETTE.light.beam, ZONE_PALETTE.holy.floor, 8.76],
    ["Sanctum gold", ZONE_PALETTE.holy.accent, ZONE_PALETTE.holy.floor, 4.71],
  ];

  it.each(TABLE)("%s keeps at least the table's contrast against its floor", (_name, color, floor, min) => {
    expect(contrastRatio(color, floor)).toBeGreaterThanOrEqual(min - 0.005);
  });

  it("keeps every floor dark (L* 15 to 35), alternate tint included, so fighters keep their contrast", () => {
    for (const f of REGION_FACTIONS) {
      for (const c of [ZONE_PALETTE[f].floor, ZONE_PALETTE[f].floorAlt]) {
        expect(lightness(c)).toBeGreaterThanOrEqual(15);
        expect(lightness(c)).toBeLessThanOrEqual(35);
      }
    }
  });

  it("keeps the alternate floor tint a quiet step from the floor, not a pattern of its own", () => {
    for (const f of REGION_FACTIONS) expect(contrastRatio(ZONE_PALETTE[f].floor, ZONE_PALETTE[f].floorAlt)).toBeLessThan(1.35);
  });

  it("lights every wall top against its floor, and every wall front darker than its top", () => {
    for (const f of REGION_FACTIONS) {
      const p = ZONE_PALETTE[f];
      expect(contrastRatio(p.wallTop, p.floor)).toBeGreaterThanOrEqual(1.8);
      expect(relativeLuminance(p.wallFront)).toBeLessThan(relativeLuminance(p.wallTop));
    }
  });

  it("gives each hazard at least 1.5x the floor's luminance, or the other way round for the crevasse (it is a hole)", () => {
    const L = relativeLuminance;
    const lighter = (c: number, f: number) => (L(c) + 0.05) / (L(f) + 0.05);
    expect(lighter(TERRAIN_PALETTE.lava.body, ZONE_PALETTE.fire.floor)).toBeGreaterThanOrEqual(1.5);
    expect(lighter(TERRAIN_PALETTE.ember.glow, ZONE_PALETTE.fire.floor)).toBeGreaterThanOrEqual(1.5);
    expect(lighter(TERRAIN_PALETTE.bog.surface, ZONE_PALETTE.plague.floor)).toBeGreaterThanOrEqual(1.5);
    expect(lighter(TERRAIN_PALETTE.ice.body, ZONE_PALETTE.frost.floor)).toBeGreaterThanOrEqual(1.5);
    expect(lighter(TERRAIN_PALETTE.light.beam, ZONE_PALETTE.holy.floor)).toBeGreaterThanOrEqual(1.5);
    expect(lighter(ZONE_PALETTE.frost.floor, TERRAIN_PALETTE.crevasse.body)).toBeGreaterThanOrEqual(1.5);
  });

  it("tells lava (bright) from bog (dark) by luminance, for colour-blind players", () => {
    const lava = lightness(TERRAIN_PALETTE.lava.body);
    const bog = lightness(TERRAIN_PALETTE.bog.body);
    expect(lava).toBeGreaterThan(bog + 20);
  });
});
