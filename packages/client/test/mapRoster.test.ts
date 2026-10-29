import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FACTIONS, mapFromTiles } from "@raid/shared";
import { PlayerState } from "@raid/shared/schema";
import { MapRoster, mapRosterLayout, mapRosterRows } from "../src/ui/mapRoster";
import { PlanningView, type PlanningFrame } from "../src/ui/planning";
import { RouteState } from "../src/ui/route";
import { setView } from "../src/view/viewState";
import { computeLayout } from "../src/view/viewport";
import { asEl, installPlanningDom } from "./planningDom";

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => setView(computeLayout({ cssW: 1280, cssH: 800, dpr: 1, hiDpi: true })));

function player(name: string, over: Partial<PlayerState> = {}): PlayerState {
  const p = new PlayerState();
  Object.assign(p, { name, faction: "fire", status: "alive", hp: FACTIONS.fire.hp, maxHp: FACTIONS.fire.hp, ...over });
  return p;
}

describe("Tab roster model", () => {
  it("ranks uncapped farming above a small card build, with deterministic name/id ties", () => {
    const farmer = player("Farmer", { adBonus: 2400 });
    const card = player("Card", { adBonus: 120 }); card.build.set("ad1", 1);
    const a = player("Alpha"), z = player("Zulu");
    const rows = mapRosterRows([{ id: "z", player: z }, { id: "card", player: card }, { id: "a2", player: a }, { id: "farm", player: farmer }, { id: "a1", player: a }]);
    expect(rows.map(r => r.id)).toEqual(["farm", "card", "a1", "a2", "z"]);
    expect(rows[0]!.strength).toBeGreaterThan(rows[1]!.strength);
    expect(rows[1]!.strength).toBeGreaterThan(1);
  });

  it("uses the HUD's gain values for the three largest normalized stat investments", () => {
    const p = player("Built", { adBonus: 480, apBonus: 120, asMult: 1270, armorBonus: 150, maxHp: FACTIONS.fire.hp * 1.18 });
    const row = mapRosterRows([{ id: "p", player: p }], "p")[0]!;
    expect(row.stats.map(s => s.key)).toEqual(["ad", "attackSpeed", "health"]);
    expect(row.stats[0]).toMatchObject({ label: "Offense", value: "+48" });
    expect(row.stats[1]).toMatchObject({ label: "Attack Speed", value: "+27%" });
    expect(row.stats[2]!.value).toMatch(/^\+\d/);
    expect(row.local).toBe(true);
    expect(row.champion).toBe(FACTIONS.fire.displayName);
  });

  it("shows both weapon slots, uses the game's Fists fallback, and excludes remaining HP from strength", () => {
    const p = player("Armed", { weapon0: "bow", weapon1: "wand", slot: 1 });
    const before = mapRosterRows([{ id: "p", player: p }])[0]!;
    expect(before.weapons.map(w => [w.name, w.active])).toEqual([["Bow", false], ["Wand", true]]);
    p.hp = 1; p.status = "dead";
    const after = mapRosterRows([{ id: "p", player: p }])[0]!;
    expect(after.strength).toBe(before.strength); expect(after.alive).toBe(false);
    p.weapon0 = ""; p.weapon1 = "";
    expect(mapRosterRows([{ id: "p", player: p }])[0]!.weapons.map(w => w.name)).toEqual(["Fists", "Fists"]);
  });

  it.each([320, 480, 600, 1280, 1920])("fits the roster left of the map in a %ipx overlay", width => {
    const layout = mapRosterLayout(width, 800, 1.5);
    expect(layout.roster).toBeGreaterThanOrEqual(140);
    expect(layout.map).toBeGreaterThanOrEqual(80);
    expect(layout.roster + layout.map + 40).toBeLessThanOrEqual(width);
  });
});

describe("Tab roster DOM and lifecycle", () => {
  it("renders live sorted rows, two weapon icons and three stat icons, retaining unchanged DOM", () => {
    const dom = installPlanningDom(), roster = new MapRoster(); dom.ui.append(asEl(roster.element));
    const strong = player("Strong", { weapon0: "sword", weapon1: "wand", adBonus: 480, apBonus: 360, asMult: 1180 });
    const weak = player("Weak");
    const players = [{ id: "weak", player: weak }, { id: "strong", player: strong }];
    roster.update(players, "strong", true);
    const first = dom.ui.byClass("map-roster-player")[0]!;
    expect(first.getAttribute("data-player-id")).toBe("strong"); expect(first.classList.contains("local")).toBe(true);
    const weaponSlots = first.byClass("map-roster-weapon");
    expect(weaponSlots.map(w => w.getAttribute("aria-label"))).toEqual(["Slot 1: Sword · Equipped", "Slot 2: Wand"]);
    expect(weaponSlots.map(w => w.title)).toEqual(["Slot 1: Sword · Equipped", "Slot 2: Wand"]);
    expect(weaponSlots.every(w => w.getAttribute("role") === "img")).toBe(true);
    expect(weaponSlots.map(w => w.classList.contains("active"))).toEqual([true, false]);
    expect(first.byClass("weapon-icon").map(w => w.getAttribute("data-weapon"))).toEqual(["sword", "wand"]);
    expect(first.byClass("map-roster-weapon-equipped")).toHaveLength(1);
    expect(weaponSlots.every(w => !/Sword|Wand/.test(w.textContent))).toBe(true);
    expect(first.byClass("map-roster-stat")).toHaveLength(3);
    expect(first.byClass("combat-icon")).toHaveLength(3);
    roster.update(players, "strong", true);
    expect(dom.ui.byClass("map-roster-player")[0]).toBe(first);
    weak.adBonus = 2400; weak.weapon1 = "bow"; weak.status = "dead";
    roster.update(players, "strong", true);
    expect(dom.ui.byClass("map-roster-player")[0]!.getAttribute("data-player-id")).toBe("weak");
    expect(dom.ui.byClass("map-roster-player")[0]!.allText).toContain("Out");
    expect(dom.ui.byClass("map-roster-player")[0]!.byClass("map-roster-weapon")[1]!.getAttribute("aria-label")).toBe("Slot 2: Bow");
    strong.slot = 1;
    roster.update(players, "strong", true);
    const switched = dom.ui.byClass("map-roster-player").find(row => row.getAttribute("data-player-id") === "strong")!;
    expect(switched.byClass("map-roster-weapon").map(w => w.classList.contains("active"))).toEqual([false, true]);
    expect(switched.byClass("map-roster-weapon").map(w => w.getAttribute("aria-label"))).toEqual(["Slot 1: Sword", "Slot 2: Wand · Equipped"]);
    expect(switched.byClass("map-roster-weapon-equipped")[0]!.parent).toBe(switched.byClass("map-roster-weapon")[1]);
    roster.update(players, "strong", false); expect(asEl(roster.element).hidden).toBe(true);
    roster.destroy(); expect(dom.ui.byClass("map-roster")).toHaveLength(0);
  });

  it("keeps two accessible Fists icons for empty or unknown slots, with only the equipped slot marked", () => {
    const dom = installPlanningDom(), roster = new MapRoster(); dom.ui.append(asEl(roster.element));
    roster.update([{ id: "me", player: player("You", { weapon0: "future-weapon", weapon1: "", slot: 1 }) }], "me", true);
    expect(dom.ui.byClass("weapon-icon").map(w => w.getAttribute("data-weapon"))).toEqual(["fists", "fists"]);
    expect(dom.ui.byClass("map-roster-weapon").map(w => w.getAttribute("aria-label"))).toEqual(["Slot 1: Fists", "Slot 2: Fists · Equipped"]);
    expect(dom.ui.byClass("map-roster-weapon-equipped")).toHaveLength(1);
    roster.destroy();
  });

  it("mounts left of the held map and hides immediately on release, lobby and planning", () => {
    const dom = installPlanningDom();
    const view = new PlanningView({ map: mapFromTiles(24, 24, new Uint8Array(24 * 24)), route: new RouteState(null, null), send: vi.fn() });
    const p = player("You");
    const frame: PlanningFrame = { mode: "map", serverNow: 1000, endsAt: 0, meReady: false, players: [], campTypes: [], local: null, localId: "me", roster: [{ id: "me", player: p }] };
    view.update(frame);
    const roster = dom.ui.one("map-roster"), body = dom.ui.one("pl-body");
    expect(roster.hidden).toBe(false);
    expect(body.children.indexOf(roster)).toBeLessThan(body.children.indexOf(dom.ui.one("pl-mapcol")));
    view.hide(); expect(roster.hidden).toBe(true);
    view.update({ ...frame, mode: "preview" }); expect(roster.hidden).toBe(true);
    view.update({ ...frame, mode: "planning" }); expect(roster.hidden).toBe(true);
    view.update(frame); expect(roster.hidden).toBe(false);
    view.destroy(); expect(dom.ui.byClass("map-roster")).toHaveLength(0);
  });
});
