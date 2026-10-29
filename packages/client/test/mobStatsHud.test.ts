import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { MOB_STAT_REWARDS } from "@raid/shared";
import { MobStatsHud } from "../src/ui/mobStatsHud";
import { FakeEl, installFakeDom } from "./fakes";

beforeEach(() => { installFakeDom(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("MobStatsHud", () => {
  it("shows a labeled empty state and keeps the whole catalog available", () => {
    const hud = new MobStatsHud();
    hud.update({ mobStats: new Map() } as never, true);
    expect(hud.root.hidden).toBe(false);
    expect(((hud.root.children[0] as unknown as FakeEl).children[0] as FakeEl).textContent).toBe("No normal-mob bonuses yet");
    const rows = (hud.root.children[1] as unknown as FakeEl).children[1] as unknown as FakeEl;
    expect(rows.children.filter((n) => n instanceof FakeEl && n.className === "mob-stat-row")).toHaveLength(MOB_STAT_REWARDS.length);
  });

  it("renders actual uncapped counts and accumulated totals", () => {
    const hud = new MobStatsHud();
    hud.update({ mobStats: new Map([["rotMonk", 0], ["emberImp", 6]]) } as never, true);
    const list = (hud.root.children[1] as unknown as FakeEl).children[1] as unknown as FakeEl;
    const ember = list.children.find((n) => n instanceof FakeEl && n.getAttribute("data-mob-id") === "emberImp") as unknown as FakeEl;
    expect(ember.getAttribute("aria-label")).toContain("6 stacks");
    expect(ember.getAttribute("aria-label")).not.toMatch(/maximum|cap/i);
    expect((ember.children[0] as FakeEl).textContent).toBe("Ember Imp ×6");
    expect((ember.children[1] as FakeEl).textContent).toBe("+1% damage per kill");
    expect((ember.children[2] as FakeEl).textContent).toBe("+6% damage");
    hud.update({ mobStats: new Map([["rotMonk", 100], ["emberImp", 100]]) } as never, true);
    expect((ember.children[0] as FakeEl).textContent).toBe("Ember Imp ×100");
    expect((ember.children[2] as FakeEl).textContent).toBe("+100% damage");
    expect(((hud.root.children[0] as unknown as FakeEl).children[0] as FakeEl).textContent).toContain("×100");
    expect(((hud.root.children[0] as unknown as FakeEl).children[0] as FakeEl).textContent).not.toMatch(/MAX|\/10/);
    const rot = list.children.find((n) => n instanceof FakeEl && n.getAttribute("data-mob-id") === "rotMonk") as unknown as FakeEl;
    expect((rot.children[2] as FakeEl).textContent).toBe("+25% lifesteal");
  });

  it("hides progress for a dead or missing player", () => {
    const hud = new MobStatsHud();
    hud.update({ mobStats: new Map() } as never, true);
    hud.update(undefined, true);
    expect(hud.root.hidden).toBe(true);
    hud.update({ mobStats: new Map() } as never, false);
    expect(hud.root.hidden).toBe(true);
  });

  it("lets the native details summary and catalog scroll receive pointer input without making the HUD root interactive", () => {
    const css = readFileSync(new URL("../src/ui/mobStatsHud.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.hud-mob-stats\s*\{[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/\.mob-stats-catalog\s*>\s*summary\s*\{[^}]*pointer-events:\s*auto/);
    expect(css).toMatch(/\.mob-stats-list\s*\{[^}]*pointer-events:\s*auto/);
    expect(css).not.toMatch(/\.mob-stat-row[^}]*pointer-events:\s*auto/);
  });
});
