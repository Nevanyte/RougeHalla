// The z-index ladder inside #ui. The planning screen dims the whole world at about 84% opacity, so the connection banner and the
// toasts (a dropped socket, a server error) must sit above it, and still under the chrome's buttons and its cards.
//   HUD and the rest (auto, the build tooltip 5)  <  map screens (10)  <  banner and toasts  <=  chrome (20)  <  settings card (60)  <  help card (70)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string): string => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
const style = read("style.css");
const planningCss = read("ui/planning.css");
const chromeCss = read("ui/chrome.css");
const buffsCss = read("ui/buffsHud.css");
const loadingCss = read("ui/loading.css");

/** The z-index of the rule whose selector is exactly `selector` in `css` (a missing rule or a missing z-index fails loudly). */
function z(css: string, selector: string): number {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&");
  const rule = new RegExp(`(?:^|\\n|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!rule) throw new Error(`no rule for ${selector}`);
  const value = /z-index:\s*(-?\d+)/.exec(rule[1]!);
  if (!value) throw new Error(`${selector} has no z-index`);
  return Number(value[1]);
}

describe("the z-index ladder", () => {
  const planning = z(planningCss, "#ui > .planning");
  const banner = z(style, ".banner");
  const toasts = z(style, ".toasts");
  const chrome = z(chromeCss, "#ui > .chrome");

  it("puts the connection banner above the planning screen, so a dropped connection shows during planning", () => {
    expect(banner).toBeGreaterThan(planning);
  });

  it("puts the toasts above the planning screen too, so a server error shows during planning", () => {
    expect(toasts).toBeGreaterThan(planning);
  });

  it("keeps both at or under the chrome, so its buttons and cards are never covered by a toast", () => {
    expect(banner).toBeLessThanOrEqual(chrome);
    expect(toasts).toBeLessThanOrEqual(chrome);
    expect(banner).toBeLessThan(z(chromeCss, "#ui > .settings-panel"));
    expect(toasts).toBeLessThan(z(chromeCss, "#ui > .help-scrim"));
  });

  it("keeps the rest of the ladder in order: the build tooltip under the planning screen, which is under the chrome, its cards and the boot screen", () => {
    expect(z(buffsCss, ".buff-tip")).toBeLessThan(planning);
    expect(planning).toBeLessThan(chrome);
    expect(chrome).toBeLessThan(z(chromeCss, "#ui > .settings-panel"));
    expect(z(chromeCss, "#ui > .settings-panel")).toBeLessThan(z(chromeCss, "#ui > .help-scrim"));
    expect(z(chromeCss, "#ui > .help-scrim")).toBeLessThan(z(loadingCss, "#boot"));
  });

  it("states the ladder next to the rule, so the next layer knows where it goes", () => {
    expect(style).toMatch(/z-index ladder[\s\S]{0,400}planning/);
  });
});
