// The Wish icons (render/wishArt.ts): the pure silhouettes and the draw call's ready / not-ready look. The Graphics is fake.
import { describe, expect, it } from "vitest";
import { ABILITIES, ABILITY_IDS, type AbilityIcon } from "@raid/shared";
import { ICON_GREY, ICON_GREY_ALPHA, abilityIconPoints, drawAbilityIcon } from "../src/render/wishArt";
import { argsOf, fakeObject } from "./fakes";

const ICONS: readonly AbilityIcon[] = ["snowflake", "swarm", "scales", "flame", "cross"];

describe("abilityIconPoints", () => {
  it("covers every icon a Wish uses", () => {
    expect(new Set(ABILITY_IDS.map((id) => ABILITIES[id].icon))).toEqual(new Set(ICONS));
  });

  it("gives a closed outline of x, y pairs for each icon", () => {
    for (const icon of ICONS) {
      const pts = abilityIconPoints(icon, 20);
      expect(pts.length % 2).toBe(0);
      expect(pts.length).toBeGreaterThanOrEqual(6);
      expect(pts.every(Number.isFinite)).toBe(true);
    }
  });

  it("has the vertex counts of the shapes it names", () => {
    expect(abilityIconPoints("snowflake", 20)).toHaveLength(24); // a six-tipped star
    expect(abilityIconPoints("swarm", 20)).toHaveLength(12); // a hexagon
    expect(abilityIconPoints("cross", 20)).toHaveLength(24); // a plus: twelve corners
  });

  it("stays inside the box, centred on the origin", () => {
    for (const icon of ICONS) {
      const pts = abilityIconPoints(icon, 16);
      const xs = pts.filter((_, i) => i % 2 === 0);
      const ys = pts.filter((_, i) => i % 2 === 1);
      for (const v of pts) expect(Math.abs(v)).toBeLessThanOrEqual(8 + 1e-9);
      expect(Math.abs((Math.max(...xs) + Math.min(...xs)) / 2)).toBeLessThan(16 * 0.1);
      expect(Math.abs((Math.max(...ys) + Math.min(...ys)) / 2)).toBeLessThan(16 * 0.1);
    }
  });

  it("scales with the size", () => {
    for (const icon of ICONS) {
      const small = abilityIconPoints(icon, 10);
      const big = abilityIconPoints(icon, 30);
      big.forEach((v, i) => expect(v).toBeCloseTo(small[i]! * 3, 9));
    }
  });

  it("draws a different shape for each icon, and hands out a copy", () => {
    const shapes = ICONS.map((i) => abilityIconPoints(i, 20).join(","));
    expect(new Set(shapes).size).toBe(ICONS.length);
    const pts = abilityIconPoints("cross", 20);
    pts[0] = 999;
    expect(abilityIconPoints("cross", 20)[0]).not.toBe(999);
  });
});

describe("drawAbilityIcon", () => {
  const draw = (id: (typeof ABILITY_IDS)[number], ready: boolean) => {
    const g = fakeObject("graphics");
    drawAbilityIcon(g as never, ABILITIES[id], 5, -9, 10, ready);
    return g;
  };

  it("fills a ready icon in the ability's own colour at full strength", () => {
    for (const id of ABILITY_IDS) {
      const g = draw(id, true);
      const first = argsOf(g, "fillStyle")[0]!;
      expect(first[0]).toBe(ABILITIES[id].color);
      expect(first[1]).toBe(1);
    }
  });

  it("draws one that is not ready in grey at 0.6", () => {
    expect(ICON_GREY).toBe(0x607d8b);
    expect(ICON_GREY_ALPHA).toBe(0.6);
    for (const id of ABILITY_IDS) {
      const g = draw(id, false);
      const first = argsOf(g, "fillStyle")[0]!;
      expect(first[0]).toBe(ICON_GREY);
      expect(first[1]).toBe(0.6);
      // Nothing in the icon keeps the ability's colour when it is greyed out.
      expect(argsOf(g, "fillStyle").some((a) => a[0] === ABILITIES[id].color)).toBe(false);
    }
  });

  it("draws around the point it is given, in the local space of the Graphics", () => {
    const g = draw("lastStand", true);
    const moves = argsOf(g, "moveTo");
    const lines = argsOf(g, "lineTo");
    const pts = abilityIconPoints("cross", 10);
    expect(moves[0]).toEqual([5 + pts[0]!, -9 + pts[1]!]);
    expect(lines).toHaveLength(pts.length / 2 - 1);
    expect(argsOf(g, "fillPath")).toHaveLength(1);
    expect(argsOf(g, "clear")).toHaveLength(0); // the caller clears: the icon is redrawn only when it changes
  });

  it("adds the scales' two pans and the swarm's bees", () => {
    expect(argsOf(draw("trial", true), "fillPath")).toHaveLength(3);
    expect(argsOf(draw("swarm", true), "fillCircle")).toHaveLength(3);
  });
});
