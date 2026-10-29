import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL_WEAPON_IDS, WEAPONS } from "@raid/shared";
import { weaponIcon, weaponIconSvg } from "../src/ui/weaponIcon";
import { asEl, installPlanningDom } from "./planningDom";

afterEach(() => vi.unstubAllGlobals());

describe("weapon icons from the game's drawing code", () => {
  it.each(ALL_WEAPON_IDS)("renders %s's current silhouette and palette as a self-contained SVG", weapon => {
    const svg = weaponIconSvg(weapon);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="-?\d+ -20 48 40">/);
    expect(svg).toMatch(/<(?:rect|path|circle|polygon) /);
    expect(svg).toContain(`#${WEAPONS[weapon].color.toString(16).padStart(6, "0")}`);
    expect(svg).toMatch(/<\/g><\/svg>$/);
    expect(svg).not.toMatch(/NaN|Infinity|undefined|<script|<image/);
  });

  it("gives every weapon a distinct silhouette without scene or canvas allocation", () => {
    expect(new Set(ALL_WEAPON_IDS.map(weaponIconSvg)).size).toBe(ALL_WEAPON_IDS.length);
    const dom = installPlanningDom();
    for (const weapon of ALL_WEAPON_IDS) {
      const icon = asEl(weaponIcon(weapon)); dom.ui.append(icon);
      expect(icon.tagName).toBe("SPAN"); expect(icon.children).toHaveLength(0);
      expect(icon.getAttribute("aria-hidden")).toBe("true");
      expect(icon.getAttribute("data-weapon")).toBe(weapon);
      expect(icon.style.props["--weapon-icon"]).toBe(`url("data:image/svg+xml,${encodeURIComponent(weaponIconSvg(weapon))}")`);
    }
    expect(dom.ui.find(node => node.tagName === "CANVAS")).toEqual([]);
  });
});
