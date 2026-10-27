// The map screens (ui/planning.ts) on the fake DOM: the lobby preview, the planning screen (the two dealt spawns, "taken" live,
// picks, Ready and its lock, the countdown, the route), the hold-Tab map, and the keyboard-only path through all of it.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FACTION_IDS, FACTIONS, PLAYER_SPEED, TILE, WORLD_H, WORLD_W, campMatchup, findPath, generateMap, isEliteCamp, spawnWalks, walkLength,
  type ClientMessages, type GameMap, type PlanMessage,
} from "@raid/shared";
import { DEFAULT_SETTINGS, SettingsStore } from "../src/settings";
import { counterBuffs } from "../src/ui/campInfo";
import { describeMatchup, formatEta } from "../src/ui/planningMath";
import { PlanningView, campTitle, planningModeFor, type PlanningFrame, type PlanningMode } from "../src/ui/planning";
import { MAX_WAYPOINTS } from "../src/ui/planningMath";
import { RouteState } from "../src/ui/route";
import { setView } from "../src/view/viewState";
import { computeLayout } from "../src/view/viewport";
import { argsOf } from "./fakes";
import { asEl, installPlanningDom, type PEl, type PlanningDom } from "./planningDom";

afterEach(() => { vi.unstubAllGlobals(); });
beforeEach(() => { setView(computeLayout({ cssW: 1280, cssH: 800, dpr: 1, hiDpi: true })); });

const MAP: GameMap = generateMap(7);
/** The side of the square the map is drawn into: the larger world side (minimapMath.mapSpan), not a literal. */
const SPAN = Math.max(WORLD_W, WORLD_H);

/** Two pool indexes in different zones (the server deals the same). */
function twoSpawns(): [number, number] {
  const a = 0;
  const b = MAP.spawnPool.findIndex((s) => s.zone !== MAP.spawnPool[a]!.zone);
  return [a, b];
}
const [SA, SB] = twoSpawns();

const plan = (over: Partial<PlanMessage> = {}): PlanMessage => ({
  endsAt: 12_000, spawns: [SA, SB], taken: [false, false], pick: -1, boons: [], boon: -1, ...over,
});

const frame = (over: Partial<PlanningFrame> = {}): PlanningFrame => ({
  mode: "planning", serverNow: 0, endsAt: 12_000, meReady: false,
  players: [{ faction: "plague", ready: false, me: true }, { faction: "holy", ready: false, me: false }, { faction: "fire", ready: true, me: false }],
  campTypes: [], local: null, ...over,
});

function memoryStorage() {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
}

function setup(over: { settings?: Partial<typeof DEFAULT_SETTINGS>; route?: RouteState } = {}) {
  const dom = installPlanningDom();
  const store = new SettingsStore(memoryStorage());
  if (over.settings) store.update(over.settings);
  const route = over.route ?? new RouteState(null, null);
  const sent: Array<ClientMessages["plan"]> = [];
  const view = new PlanningView({ map: MAP, route, send: (m) => { sent.push(m); }, settings: store });
  const root = asEl(view.element);
  const q = (cls: string): PEl => root.one(cls);
  const all = (cls: string): PEl[] => root.byClass(cls);
  /** Opens the planning screen with the deal. */
  const open = (p: PlanMessage | null = plan(), f: Partial<PlanningFrame> = {}): void => {
    view.setPlan(p);
    view.update(frame(f));
  };
  const spawnCards = (): PEl[] => all("pl-spawn");
  const spawnMarks = (): PEl[] => all("pl-spawnmark");
  /** The route canvas, placed at (100, 50) and 400 px wide, and a click at a world point on it. */
  const mapCanvas = q("pl-route");
  mapCanvas.rect = { left: 100, top: 50, width: 400, height: 400 };
  // A real context starts at an opacity of 1; the recorder has no properties of its own.
  mapCanvas.getContext().globalAlpha = 1;
  const clickWorld = (x: number, y: number): void => {
    mapCanvas.click({ clientX: 100 + (x / SPAN) * 400, clientY: 50 + (y / SPAN) * 400 });
  };
  const camp = (i: number): PEl => all("pl-camp")[i]!;
  return { dom, store, route, sent, view, root, q, all, open, spawnCards, spawnMarks, mapCanvas, clickWorld, camp };
}

/** A camp's position on the map that is reachable on foot: the camps are placed on floor tiles. */
const CAMP = MAP.camps[0]!;

describe("which screen shows when", () => {
  it("previews in the lobby, plans in planning, shows the map only while Tab is held in a run, and is hidden otherwise", () => {
    const m = (phase: string, held = false, training = false): PlanningMode => planningModeFor(phase, { training, held });
    expect(m("lobby")).toBe("preview");
    expect(m("planning")).toBe("planning");
    expect(m("active")).toBe("hidden");
    expect(m("active", true)).toBe("map");
    expect(m("ended")).toBe("hidden");
    expect(m("ended", true)).toBe("hidden");
    // Tab does nothing in planning (the screen has it) and practice never shows a map screen.
    expect(m("planning", true)).toBe("planning");
    for (const phase of ["lobby", "planning", "active", "ended"]) expect(m(phase, true, true)).toBe("hidden");
  });
});

describe("the overlay's shell", () => {
  it("lives in #ui, is hidden until a frame asks for it, and is a region, not a dialog (it is no Esc panel)", () => {
    const { dom, root, view } = setup();
    expect(root.parent).toBe(dom.ui);
    expect(root.hidden).toBe(true);
    expect(view.mode).toBe("hidden");
    expect(root.getAttribute("role")).toBe("region");
    expect(root.getAttribute("aria-modal")).toBeNull();
  });

  it("goes back to hidden, hands the keyboard back, and removes its window listener on destroy", () => {
    const { dom, root, view, open, spawnCards } = setup();
    open();
    expect(root.hidden).toBe(false);
    expect(dom.doc.activeElement).toBe(spawnCards()[0]);
    view.hide();
    expect(root.hidden).toBe(true);
    expect(dom.doc.activeElement).toBe(dom.doc.body);
    expect(dom.win.count("keydown")).toBe(1);
    view.destroy();
    expect(dom.win.count("keydown")).toBe(0);
    expect(root.removed).toBe(true);
  });
});

describe("the lobby preview", () => {
  it("shows the map read-only: the zones, every camp with its crown and matchup chip, who is here; and none of the planning controls", () => {
    const { root, view, all, q } = setup();
    view.update(frame({ mode: "preview" }));
    expect(root.hidden).toBe(false);
    expect(root.getAttribute("data-mode")).toBe("preview");
    expect(all("pl-camp")).toHaveLength(MAP.camps.length);
    expect(all("pl-camp").filter((c) => c.byClass("pl-crown").length > 0)).toHaveLength(MAP.camps.filter(isEliteCamp).length);
    for (const c of all("pl-camp")) expect(c.one("pl-chip").textContent).toMatch(/^(\+|~|!)\d+%$|^lose$/);
    expect(q("pl-title").textContent).toBe("Map preview");
    expect(q("pl-people").hidden).toBe(false);
    expect(all("pl-person")).toHaveLength(3);
    for (const hidden of ["pl-spawns", "pl-readyrow", "pl-routebox", "pl-bar", "pl-timer"]) expect(q(hidden).hidden).toBe(true);
  });

  it("takes no stop from a click on the map or on a camp, and sends nothing", () => {
    const { route, sent, view, clickWorld, camp } = setup();
    view.update(frame({ mode: "preview" }));
    clickWorld(CAMP.x, CAMP.y);
    camp(0).click();
    expect(route.waypoints).toHaveLength(0);
    expect(sent).toEqual([]);
  });

  it("reads a camp on hover or focus: its zone, elite crown, matchup and (once the room says it) its mob type and buff", () => {
    const { view, camp, q } = setup();
    view.update(frame({ mode: "preview" }));
    const i = MAP.camps.findIndex(isEliteCamp);
    camp(i).dispatch("mouseenter");
    expect(q("pl-info").textContent).toContain(campTitle(MAP.camps[i]!));
    expect(q("pl-info").textContent).toContain("elite");
    expect(q("pl-info").textContent).toContain("For Plague:");
    camp(i).dispatch("mouseleave");
    expect(q("pl-info").textContent).toMatch(/Planning starts when the lobby fills/);
    // A camp whose type the room names shows the type and its buff line.
    const zone = MAP.camps[i]!.zone;
    const types = MAP.camps.map(() => "");
    types[i] = { fire: "wyrmling", sentenced: "executioner", plague: "ratOgre", frost: "glacialWarden", holy: "bloodSaint" }[zone];
    view.update(frame({ mode: "preview", campTypes: types }));
    camp(i).dispatch("focus");
    expect(q("pl-info").textContent).toMatch(/[A-Z][a-z]+( [A-Z][a-z]+)?: /);
    expect(camp(i).getAttribute("aria-label")).toContain(zone === "fire" ? "Wyrmling" : zone === "holy" ? "Blood Saint" : "");
  });

  it("leaves the pointer to the world: the root is click-through and only its card takes it (planning.css)", () => {
    const css = readFileSync(new URL("../src/ui/planning.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.planning\[data-mode="preview"\]\s*\{[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/\.planning\[data-mode="preview"\] \.pl-body\s*\{[^}]*pointer-events:\s*auto/);
    expect(css).toMatch(/\.planning\[data-mode="map"\],\s*\n#ui > \.planning\[data-mode="map"\] \*\s*\{\s*pointer-events:\s*none/);
  });
});

describe("the planning screen: the deal", () => {
  it("shows both dealt spawns with their zone, the walk to the coliseum and the camps nearest them", () => {
    const { open, spawnCards, spawnMarks } = setup();
    open();
    const cards = spawnCards();
    expect(cards).toHaveLength(2);
    const walks = spawnWalks(MAP);
    [SA, SB].forEach((idx, i) => {
      const spawn = MAP.spawnPool[idx]!;
      const text = cards[i]!.textContent;
      expect(text).toContain(`${FACTIONS[spawn.zone].displayName} edge`);
      expect(text).toContain(`${formatEta(walks[idx]! / PLAYER_SPEED)} walk to the coliseum`);
      expect(text).toContain("Nearest camps");
      expect(cards[i]!.byClass("pl-near-item")).toHaveLength(2);
      for (const chip of cards[i]!.byClass("pl-chip")) expect(chip.textContent).toMatch(/^(\+|~|!)\d+%$|^lose$/);
      expect(cards[i]!.getAttribute("aria-label")).toContain(`Spawn ${i + 1}: ${FACTIONS[spawn.zone].displayName}`);
    });
    // The same two spawns are on the map, as numbered markers placed by percent of the map square.
    const marks = spawnMarks();
    expect(marks).toHaveLength(2);
    [SA, SB].forEach((idx, i) => {
      expect(marks[i]!.style.props["left"]).toBe(`${Math.round((MAP.spawnPool[idx]!.x / SPAN) * 10000) / 100}%`);
      expect(marks[i]!.textContent).toBe(String(i + 1));
    });
  });

  it("says it is waiting while no deal has arrived, and builds the options when it does", () => {
    const { view, q, spawnCards } = setup();
    view.update(frame());
    expect(q("pl-spawns").textContent).toContain("Waiting for your spawn options");
    expect(spawnCards()).toHaveLength(0);
    view.setPlan(plan());
    expect(spawnCards()).toHaveLength(2);
    expect(q("pl-spawns").textContent).not.toContain("Waiting");
  });

  it("shows another player's pick as taken at once, and as free again when it is let go", () => {
    const { open, view, spawnCards, spawnMarks, q } = setup();
    open();
    const badges = () => spawnCards().map((c) => c.one("pl-badge").textContent);
    expect(badges()).toEqual(["Free", "Free"]);
    view.setPlan(plan({ taken: [false, true] }));
    expect(badges()).toEqual(["Free", "Taken"]);
    const card = spawnCards()[1]!;
    expect(card.classList.contains("taken")).toBe(true);
    expect(card.getAttribute("aria-disabled")).toBe("true");
    expect(card.getAttribute("aria-label")).toContain("taken by another player");
    expect(spawnMarks()[1]!.classList.contains("taken")).toBe(true);
    expect(q("pl-status").textContent).toBe("Spawn 2 was taken by another player.");
    view.setPlan(plan({ taken: [false, false] }));
    expect(badges()).toEqual(["Free", "Free"]);
    expect(q("pl-status").textContent).toBe("Spawn 2 is free again.");
    expect(spawnCards()[1]!.getAttribute("aria-disabled")).toBe("false");
  });

  it("keeps the same buttons through a change, so a focused spawn card stays focused", () => {
    const { open, view, dom, spawnCards } = setup();
    open();
    const card = spawnCards()[0]!;
    card.focus();
    view.setPlan(plan({ taken: [false, true] }));
    view.setPlan(plan({ taken: [false, true], pick: 0 }));
    expect(spawnCards()[0]).toBe(card);
    expect(dom.doc.activeElement).toBe(card);
  });
});

describe("picking and Ready", () => {
  it("sends the pick as the index of the option, and shows it as yours at once", () => {
    const { open, sent, spawnCards, spawnMarks, view } = setup();
    open();
    spawnCards()[1]!.click();
    expect(sent).toEqual([{ spawn: 1 }]);
    expect(view.pick).toBe(1);
    expect(spawnCards()[1]!.one("pl-badge").textContent).toBe("Your pick");
    expect(spawnCards()[1]!.getAttribute("aria-pressed")).toBe("true");
    expect(spawnMarks()[1]!.classList.contains("picked")).toBe(true);
    spawnMarks()[0]!.click();
    expect(sent).toEqual([{ spawn: 1 }, { spawn: 0 }]);
    expect(view.pick).toBe(0);
  });

  it("follows the server's word: its resend confirms the pick, and a pick it refused falls back", () => {
    const { open, sent, spawnCards, view } = setup();
    open();
    spawnCards()[0]!.click();
    view.setPlan(plan({ pick: 0 }));
    expect(view.pick).toBe(0);
    expect(spawnCards()[0]!.one("pl-badge").textContent).toBe("Your pick");
    // Another player held spawn 2 in the same tick: the click is answered with taken, no pick.
    spawnCards()[1]!.click();
    view.setPlan(plan({ pick: -1, taken: [false, true] }));
    expect(view.pick).toBe(-1);
    expect(spawnCards()[1]!.one("pl-badge").textContent).toBe("Taken");
    expect(sent).toEqual([{ spawn: 0 }, { spawn: 1 }]);
  });

  it("sends nothing for an option someone else holds, nor for the one already yours", () => {
    const { open, sent, spawnCards, view, q } = setup();
    open(plan({ taken: [false, true] }));
    spawnCards()[1]!.click();
    expect(sent).toEqual([]);
    expect(q("pl-status").textContent).toBe("Spawn 2 is taken by another player.");
    view.setPlan(plan({ pick: 0, taken: [false, true] }));
    spawnCards()[0]!.click();
    expect(sent).toEqual([]);
  });

  it("Ready sends `ready: true` once, freezes the picks and says so", () => {
    const { open, sent, spawnCards, spawnMarks, q, view } = setup();
    open(plan({ pick: 0 }));
    const ready = q("pl-ready");
    expect(ready.textContent).toBe("Ready");
    expect(ready.disabled).toBe(false);
    ready.click();
    expect(sent).toEqual([{ ready: true }]);
    expect(view.ready).toBe(true);
    expect(ready.textContent).toBe("Ready ✓");
    expect(ready.disabled).toBe(true);
    expect(q("pl-status").textContent).toContain("picks are locked");
    ready.click();
    spawnCards()[1]!.click();
    spawnMarks()[1]!.click();
    expect(sent).toEqual([{ ready: true }]);
    expect(spawnCards()[1]!.getAttribute("aria-disabled")).toBe("true");
    expect(spawnCards()[0]!.getAttribute("aria-disabled")).toBe("false"); // yours is not disabled, it is pressed
    expect(view.pick).toBe(0);
  });

  it("shows Ready as pressed and the picks as locked when the state already says so (a reload, a reconnect)", () => {
    const { open, sent, spawnCards, q, view } = setup();
    open(plan({ pick: 1 }), { meReady: true });
    expect(view.ready).toBe(true);
    expect(q("pl-ready").disabled).toBe(true);
    spawnCards()[0]!.click();
    expect(sent).toEqual([]);
  });

  it("counts who is ready", () => {
    const { open, q } = setup();
    open();
    expect(q("pl-readycount").textContent).toBe("Ready 1/3");
  });
});

describe("the countdown", () => {
  it("follows the end time against the server clock, rounded up, and never goes below zero", () => {
    const { open, view, q } = setup();
    open();
    const timer = q("pl-timer");
    expect(timer.textContent).toBe("0:12");
    expect(timer.getAttribute("role")).toBe("timer");
    for (const [now, text] of [[1, "0:12"], [4_900, "0:08"], [11_001, "0:01"], [12_000, "0:00"], [30_000, "0:00"]] as const) {
      view.update(frame({ serverNow: now }));
      expect(timer.textContent).toBe(text);
    }
  });

  it("reads the end from the deal when the state has none yet, and moves the bar with it", () => {
    const { open, view, q } = setup();
    open(plan({ endsAt: 20_000 }), { endsAt: 0 });
    expect(q("pl-timer").textContent).toBe("0:20");
    expect(q("pl-bar").style.props["--pl-progress"]).toBe("1");
    view.update(frame({ endsAt: 0, serverNow: 10_000 }));
    expect(q("pl-timer").textContent).toBe("0:10");
    expect(q("pl-bar").style.props["--pl-progress"]).toBe("0.5");
  });

  it("a planning that ends sooner (everyone ready) just shows the new end", () => {
    const { open, view, q } = setup();
    open();
    view.update(frame({ endsAt: 6_000, serverNow: 1_000 }));
    expect(q("pl-timer").textContent).toBe("0:05");
  });
});

describe("who is here, and what counters them", () => {
  it("lists the players' factions, yours marked, with their readiness", () => {
    const { open, q } = setup();
    open();
    const people = q("pl-people");
    expect(people.textContent).toContain("Plague (you)");
    expect(people.textContent).toContain("Demon Blood");
    expect(people.textContent).toContain("Fire");
    const items = people.byClass("pl-person");
    expect(items.map((i) => i.classList.contains("ready"))).toEqual([false, false, true]);
    expect(items[0]!.classList.contains("me")).toBe(true);
  });

  it("names the buffs that counter the other factions present, with where they are won", () => {
    const { open, q } = setup();
    open();
    const hint = q("pl-hint");
    expect(hint.hidden).toBe(false);
    const want = counterBuffs(["holy", "fire"]);
    expect(want.length).toBeGreaterThan(0);
    for (const h of want) {
      expect(hint.textContent).toContain(`Against ${FACTIONS[h.faction].displayName}:`);
      for (const b of h.buffs) expect(hint.textContent).toContain(`${b.name} (${FACTIONS[b.zone].displayName})`);
    }
  });

  it("shows no hint when nobody else is here", () => {
    const { open, q } = setup();
    open(plan(), { players: [{ faction: "plague", ready: false, me: true }] });
    expect(q("pl-hint").hidden).toBe(true);
  });
});

describe("zone identity without hue", () => {
  it("the legend names the five zones, each with its own shape and its own pattern", () => {
    const { open, q } = setup();
    open();
    const items = q("pl-legend").byClass("pl-legend-item");
    expect(items.map((i) => i.one("pl-legend-name").textContent)).toEqual(["Fire", "Sentenced", "Plague", "Frost", "Demon Blood"]);
    expect(new Set(items.map((i) => i.one("pl-glyph").style.props["clip-path"])).size).toBe(5);
    const patterns = items.map((i) => i.className.split(" ").find((c) => c.startsWith("pattern-")));
    expect(new Set(patterns).size).toBe(5);
  });

  it("every camp marker carries its zone's shape, and an elite camp a crown", () => {
    const { open, all } = setup();
    open();
    const byZone = new Map<string, Set<string>>();
    all("pl-camp").forEach((c, i) => {
      const zone = MAP.camps[i]!.zone;
      const clip = c.one("pl-glyph").style.props["clip-path"]!;
      byZone.set(zone, (byZone.get(zone) ?? new Set()).add(clip));
      expect(c.byClass("pl-crown").length > 0).toBe(isEliteCamp(MAP.camps[i]!));
    });
    // One shape per zone, and no two zones share one.
    for (const shapes of byZone.values()) expect(shapes.size).toBe(1);
    expect(new Set([...byZone.values()].map((s) => [...s][0])).size).toBe(byZone.size);
  });

  it("labels the zones on the map and gives every camp a spoken name with its matchup", () => {
    const { open, all } = setup();
    open();
    expect(all("pl-zone")).toHaveLength(MAP.regions.length);
    all("pl-camp").forEach((c, i) => {
      const label = c.getAttribute("aria-label")!;
      expect(label).toContain(campTitle(MAP.camps[i]!));
      expect(label).toContain(describeMatchup(campMatchup("plague", MAP.camps[i]!)).words);
    });
  });

  it("paints the base with its patterns and the crates when it first shows", () => {
    const { open, q } = setup();
    open();
    const g = q("pl-base").getContext();
    expect(argsOf(g, "createPattern")).toHaveLength(5);
    // One outlined square per crate, and the crevasses' outlines on a map the zone stylers made (they stroke their runs too).
    expect(argsOf(g, "strokeRect").length).toBeGreaterThanOrEqual(MAP.crateSpots.length);
  });
});

describe("the route", () => {
  it("adds a stop where the map is clicked, and a numbered button for it; a click on the button takes it out", () => {
    const { open, route, clickWorld, all } = setup();
    open(plan({ pick: 0 }));
    clickWorld(CAMP.x, CAMP.y);
    expect(route.waypoints).toHaveLength(1);
    expect(route.waypoints[0]!.x).toBeCloseTo(CAMP.x, 0);
    expect(route.waypoints[0]!.y).toBeCloseTo(CAMP.y, 0);
    const stops = all("pl-stop");
    expect(stops).toHaveLength(1);
    expect(stops[0]!.textContent).toBe("1");
    expect(stops[0]!.style.props["left"]).toBe(`${Math.round((route.waypoints[0]!.x / SPAN) * 10000) / 100}%`);
    stops[0]!.click();
    expect(route.waypoints).toHaveLength(0);
    expect(all("pl-stop")).toHaveLength(0);
  });

  it("computes the route with the shared pathfinder from the picked spawn, and shows the walk", () => {
    const { open, route, clickWorld, q } = setup();
    open(plan({ pick: 0 }));
    const spawn = MAP.spawnPool[SA]!;
    expect(route.start).toEqual({ x: spawn.x, y: spawn.y });
    const other = MAP.camps[3]!;
    clickWorld(CAMP.x, CAMP.y);
    clickWorld(other.x, other.y);
    const planned = route.plan(MAP);
    const leg1 = findPath(MAP, spawn, route.waypoints[0]!);
    const leg2 = findPath(MAP, leg1[leg1.length - 1]!, route.waypoints[1]!);
    expect(planned.points).toEqual([{ x: spawn.x, y: spawn.y }, ...leg1, ...leg2]);
    const length = walkLength(spawn, [...leg1, ...leg2]);
    expect(planned.length).toBeCloseTo(length, 6);
    expect(planned.seconds).toBeCloseTo(length / PLAYER_SPEED, 6);
    expect(q("pl-route-text").textContent).toBe(`2 stops · ${formatEta(length / PLAYER_SPEED)} walk`);
    // The line is on the route canvas (a dashed polyline); the stops are buttons, not canvas rings.
    const g = q("pl-route").getContext();
    expect(argsOf(g, "setLineDash").some(([d]) => (d as number[]).length === 2)).toBe(true);
    expect(argsOf(g, "arc")).toHaveLength(0);
  });

  it("says the walk needs a spawn until one is picked, and starts it from the pick when it is", () => {
    const { open, route, clickWorld, q, view } = setup();
    open();
    clickWorld(CAMP.x, CAMP.y);
    expect(route.start).toBeNull();
    expect(q("pl-route-text").textContent).toBe("1 stop");
    expect(q("pl-route-note").textContent).toContain("Pick a spawn");
    view.setPlan(plan({ pick: 1 }));
    expect(route.start).toEqual({ x: MAP.spawnPool[SB]!.x, y: MAP.spawnPool[SB]!.y });
    expect(q("pl-route-text").textContent).toMatch(/^1 stop · \d+:\d\d walk$/);
    expect(q("pl-route-note").textContent).toBe("");
  });

  it("moves the start when another spawn is held", () => {
    const { open, route, spawnCards } = setup();
    open(plan({ pick: 0 }));
    spawnCards()[1]!.click();
    expect(route.start).toEqual({ x: MAP.spawnPool[SB]!.x, y: MAP.spawnPool[SB]!.y });
  });

  it("Undo takes out the last stop and Clear all of them; both rest while there are none", () => {
    const { open, route, clickWorld, q } = setup();
    open(plan({ pick: 0 }));
    expect(q("pl-undo").disabled).toBe(true);
    expect(q("pl-clear").disabled).toBe(true);
    expect(q("pl-route-text").textContent).toBe("No stops yet");
    clickWorld(CAMP.x, CAMP.y);
    clickWorld(MAP.camps[2]!.x, MAP.camps[2]!.y);
    clickWorld(MAP.camps[4]!.x, MAP.camps[4]!.y);
    expect(route.waypoints).toHaveLength(3);
    q("pl-undo").click();
    expect(route.waypoints).toHaveLength(2);
    q("pl-clear").click();
    expect(route.waypoints).toHaveLength(0);
    expect(q("pl-undo").disabled).toBe(true);
  });

  it("a click on a camp puts a stop on it, and a second click takes it out again", () => {
    const { open, route, camp } = setup();
    open(plan({ pick: 0 }));
    camp(1).click();
    expect(route.waypoints).toEqual([{ x: MAP.camps[1]!.x, y: MAP.camps[1]!.y }]);
    camp(1).click();
    expect(route.waypoints).toEqual([]);
  });

  it("holds MAX_WAYPOINTS stops and says so when it is full", () => {
    const { open, route, clickWorld, q } = setup();
    open(plan({ pick: 0 }));
    for (let i = 0; i < MAX_WAYPOINTS + 2; i++) clickWorld(CAMP.x + i, CAMP.y);
    expect(route.waypoints).toHaveLength(MAX_WAYPOINTS);
    expect(q("pl-status").textContent).toBe(`A route holds ${MAX_WAYPOINTS} stops.`);
    expect(q("pl-route-note").textContent).toContain(`${MAX_WAYPOINTS} stops`);
  });

  it("is kept when the screen is hidden and shown again, and cleared with the room", () => {
    const { open, route, clickWorld, view, all } = setup();
    open(plan({ pick: 0 }));
    clickWorld(CAMP.x, CAMP.y);
    view.hide();
    view.update(frame());
    expect(all("pl-stop")).toHaveLength(1);
    route.clear();
    expect(all("pl-stop")).toHaveLength(0);
  });
});

describe("start boons", () => {
  it("shows no boon box while none are dealt", () => {
    const { open, q } = setup();
    open();
    expect(q("pl-boons").hidden).toBe(true);
  });

  it("offers the two boons dealt, sends the pick as an index, and locks it with Ready", () => {
    const { open, sent, q } = setup();
    open(plan({ boons: ["quickStep", "ironSkin"] }));
    const cards = q("pl-boons").byClass("pl-boon");
    expect(cards.map((c) => c.textContent)).toEqual(["Quick Step", "Iron Skin"]);
    expect(q("pl-boons").hidden).toBe(false);
    cards[1]!.click();
    expect(sent).toEqual([{ boon: 1 }]);
    expect(cards[1]!.getAttribute("aria-pressed")).toBe("true");
    cards[1]!.click();
    expect(sent).toEqual([{ boon: 1 }]);
    q("pl-ready").click();
    cards[0]!.click();
    expect(sent).toEqual([{ boon: 1 }, { ready: true }]);
  });
});

describe("keyboard only", () => {
  it("starts with the first spawn under the keyboard, and Enter picks it", () => {
    const { dom, open, sent, spawnCards } = setup();
    open();
    expect(dom.doc.activeElement).toBe(spawnCards()[0]);
    dom.press("Enter");
    expect(sent).toEqual([{ spawn: 0 }]);
  });

  it("does not take the keyboard from something outside it, such as an open settings card", () => {
    const { dom, view, spawnCards } = setup();
    const other = asEl(document.createElement("button"));
    dom.ui.append(other);
    other.focus();
    view.setPlan(plan());
    view.update(frame());
    expect(dom.doc.activeElement).toBe(other);
    expect(spawnCards()[0]).toBeDefined();
  });

  it("keeps one marker in the tab order, and the arrow keys cycle the spawns, then the camps, then the stops, wrapping", () => {
    const { dom, open, route, all, spawnMarks } = setup();
    open(plan({ pick: 0 }));
    route.add({ x: CAMP.x, y: CAMP.y });
    const markers = [...spawnMarks(), ...all("pl-camp"), ...all("pl-stop")];
    expect(markers.length).toBe(2 + MAP.camps.length + 1);
    expect(markers.filter((m) => m.tabIndex === 0)).toHaveLength(1);
    spawnMarks()[0]!.focus();
    expect(spawnMarks()[0]!.tabIndex).toBe(0);
    for (let i = 1; i < markers.length; i++) {
      dom.press("ArrowRight");
      expect(dom.doc.activeElement).toBe(markers[i]);
      expect(markers.filter((m) => m.tabIndex === 0)).toEqual([markers[i]]);
    }
    dom.press("ArrowRight");
    expect(dom.doc.activeElement).toBe(markers[0]);
    dom.press("ArrowLeft");
    expect(dom.doc.activeElement).toBe(markers[markers.length - 1]);
    dom.press("Home");
    expect(dom.doc.activeElement).toBe(markers[0]);
    dom.press("End");
    expect(dom.doc.activeElement).toBe(markers[markers.length - 1]);
    dom.press("ArrowDown");
    expect(dom.doc.activeElement).toBe(markers[0]);
    dom.press("ArrowUp");
    expect(dom.doc.activeElement).toBe(markers[markers.length - 1]);
  });

  it("Enter on a spawn marker picks it, on a camp adds a stop (and removes it again), and arrow keys do not pick anything", () => {
    const { dom, open, sent, route, spawnMarks, camp } = setup();
    open();
    spawnMarks()[1]!.focus();
    dom.press("ArrowRight");
    expect(sent).toEqual([]);
    spawnMarks()[1]!.focus();
    dom.press("Enter");
    expect(sent).toEqual([{ spawn: 1 }]);
    camp(2).focus();
    dom.press("Enter");
    expect(route.waypoints).toHaveLength(1);
    dom.press("Enter");
    expect(route.waypoints).toHaveLength(0);
  });

  it("Delete on a stop takes it out and hands the keyboard to the stop that takes its place", () => {
    const { dom, open, route, all } = setup();
    open(plan({ pick: 0 }));
    route.add({ x: MAP.camps[0]!.x, y: MAP.camps[0]!.y });
    route.add({ x: MAP.camps[1]!.x, y: MAP.camps[1]!.y });
    route.add({ x: MAP.camps[2]!.x, y: MAP.camps[2]!.y });
    all("pl-stop")[1]!.focus();
    const e = dom.press("Delete");
    expect(e.defaultPrevented).toBe(true);
    expect(route.waypoints).toHaveLength(2);
    const stops = all("pl-stop");
    expect(stops).toHaveLength(2);
    expect(dom.doc.activeElement).toBe(stops[1]);
    // The last stop: focus falls back to the one before it, and then to a camp when none are left.
    dom.press("Backspace");
    expect(dom.doc.activeElement).toBe(all("pl-stop")[0]);
    dom.press("Delete");
    expect(route.waypoints).toHaveLength(0);
    expect(dom.doc.activeElement).toBe(all("pl-camp")[0]);
  });

  it("Delete on a camp or a spawn does nothing", () => {
    const { dom, open, route, camp } = setup();
    open(plan({ pick: 0 }));
    route.add({ x: CAMP.x, y: CAMP.y });
    camp(0).focus();
    const e = dom.press("Delete");
    expect(e.defaultPrevented).toBe(false);
    expect(route.waypoints).toHaveLength(1);
  });

  it("1 and 2 pick the spawns from anywhere on the screen, not while typing, not with a modifier", () => {
    const { dom, open, sent } = setup();
    open();
    dom.press("Digit2");
    expect(sent).toEqual([{ spawn: 1 }]);
    dom.press("Numpad1");
    expect(sent).toEqual([{ spawn: 1 }, { spawn: 0 }]);
    dom.press("Digit2", { ctrlKey: true });
    dom.press("Digit2", { shiftKey: true });
    dom.press("Digit2", { repeat: true });
    expect(sent).toHaveLength(2);
    // A text field has the keys: typing a 2 there picks nothing.
    const field = asEl(document.createElement("input"));
    dom.ui.append(field);
    field.focus();
    field.key("Digit2");
    expect(sent).toHaveLength(2);
  });

  it("Enter pressed anywhere but on the Ready button never readies you: Ready is a latch", () => {
    const { dom, open, sent, q, spawnMarks, camp } = setup();
    open();
    dom.press("Enter"); // on the first spawn card: a pick
    camp(0).focus();
    dom.press("Enter");
    spawnMarks()[0]!.focus();
    expect(sent.some((m) => m.ready)).toBe(false);
    q("pl-ready").focus();
    dom.press("Enter");
    expect(sent[sent.length - 1]).toEqual({ ready: true });
    expect(sent.filter((m) => m.ready)).toHaveLength(1);
  });

  it("Esc does nothing here: no message, no change of screen, no stop lost, and the key is left to whoever else wants it", () => {
    const { dom, open, sent, route, view, q } = setup();
    open(plan({ pick: 0 }));
    route.add({ x: CAMP.x, y: CAMP.y });
    const before = q("pl-route-text").textContent;
    const e = dom.press("Escape");
    expect(e.defaultPrevented).toBe(false);
    expect(e.propagationStopped).toBe(false);
    expect(sent).toEqual([]);
    expect(view.mode).toBe("planning");
    expect(view.element.hidden).toBe(false);
    expect(route.waypoints).toHaveLength(1);
    expect(q("pl-route-text").textContent).toBe(before);
    expect(view.ready).toBe(false);
  });

  it("every control is a real button reachable by Tab, named for a screen reader", () => {
    const { open, root, all } = setup();
    open();
    const buttons = root.find((e) => e.tagName === "BUTTON");
    expect(buttons.length).toBeGreaterThan(MAP.camps.length);
    for (const b of buttons) {
      expect(b.type).toBe("button");
      const name = b.getAttribute("aria-label") ?? b.textContent;
      expect(name.trim().length).toBeGreaterThan(0);
    }
    // Only the roving marker is in the tab order among the map's buttons; the cards and buttons keep the default.
    const marks = [...all("pl-spawnmark"), ...all("pl-camp")];
    expect(marks.filter((m) => m.tabIndex === 0)).toHaveLength(1);
  });
});

describe("the map held in a run", () => {
  it("shows the map alone: no side column, the camps, the route faint and where you stand", () => {
    const { view, route, q, root, all, open } = setup();
    open(plan({ pick: 0 }));
    expect(all("pl-spawnmark").every((m) => !m.hidden)).toBe(true);
    route.setStart({ x: MAP.spawnPool[SA]!.x, y: MAP.spawnPool[SA]!.y });
    route.add({ x: CAMP.x, y: CAMP.y });
    view.update(frame({ mode: "map", local: { x: 600, y: 700, alive: true } }));
    expect(root.getAttribute("data-mode")).toBe("map");
    expect(q("pl-side").hidden).toBe(true);
    expect(q("pl-head").hidden).toBe(true);
    // The camps stay (read-only, click-through); the dealt spawns and the stop buttons are for planning only.
    expect(q("pl-markers").hidden).toBe(false);
    expect(all("pl-camp")).toHaveLength(MAP.camps.length);
    expect(all("pl-spawnmark").every((m) => m.hidden)).toBe(true);
    expect(all("pl-stop")).toHaveLength(0);
    const g = q("pl-route").getContext();
    expect(argsOf(g, "setLineDash").some(([d]) => (d as number[]).length === 2)).toBe(true);
    // Rings for the stops, plus the player's dot.
    expect(argsOf(g, "arc")).toHaveLength(2);
    expect(argsOf(g, "globalAlpha=").some(([a]) => (a as number) < 1)).toBe(true);
  });

  it("draws only the stops still ahead as the player gets past them", () => {
    const { view, route, q } = setup();
    route.setStart({ x: MAP.spawnPool[SA]!.x, y: MAP.spawnPool[SA]!.y });
    route.add({ x: MAP.camps[0]!.x, y: MAP.camps[0]!.y });
    route.add({ x: MAP.camps[1]!.x, y: MAP.camps[1]!.y });
    view.update(frame({ mode: "map" }));
    const g = q("pl-route").getContext();
    expect(argsOf(g, "arc")).toHaveLength(2);
    // The recorder keeps every frame's calls: what the next frame adds is what it drew.
    const before = argsOf(g, "arc").length;
    route.advance({ x: MAP.camps[0]!.x + TILE, y: MAP.camps[0]!.y });
    view.update(frame({ mode: "map" }));
    expect(route.next).toBe(1);
    expect(argsOf(g, "arc").length - before).toBe(1);
  });

  it("is click-through (planning.css), and its buttons cannot be reached", () => {
    const css = readFileSync(new URL("../src/ui/planning.css", import.meta.url), "utf8");
    expect(css).toContain('#ui > .planning[data-mode="map"] * { pointer-events: none; }');
  });

  it("hides the route when Show route is off, but not while it is being drawn on the planning screen", () => {
    const { view, route, q, store, open } = setup({ settings: { showRoute: false } });
    route.setStart({ x: MAP.spawnPool[SA]!.x, y: MAP.spawnPool[SA]!.y });
    route.add({ x: CAMP.x, y: CAMP.y });
    view.update(frame({ mode: "map" }));
    const g = q("pl-route").getContext();
    expect(argsOf(g, "setLineDash")).toHaveLength(0);
    store.update({ showRoute: true });
    view.update(frame({ mode: "map" }));
    expect(argsOf(g, "setLineDash").length).toBeGreaterThan(0);
    store.update({ showRoute: false });
    open(plan({ pick: 0 }));
    expect(argsOf(g, "setLineDash").length).toBeGreaterThan(0);
  });
});

describe("text size and the view", () => {
  it("scales the screen's text with the setting, live", () => {
    const { root, store } = setup();
    expect(root.style.props["--pl-text"]).toBe("1");
    store.update({ textScale: 1.5 });
    expect(root.style.props["--pl-text"]).toBe("1.5");
    store.update({ textScale: 1.25 });
    expect(root.style.props["--pl-text"]).toBe("1.25");
  });

  it("sizes the map from the overlay and repaints the canvases when the window changes", () => {
    const { open, root, q } = setup();
    open();
    const size = () => Number.parseInt(root.style.props["--pl-size"]!, 10);
    const wide = size();
    const w0 = q("pl-base").width;
    expect(w0).toBeGreaterThan(0);
    // The overlay is laid out at one size and scaled to the stage: a sharper screen paints more pixels into the same box.
    setView(computeLayout({ cssW: 1920, cssH: 1080, dpr: 2, hiDpi: true }));
    expect(size()).toBe(wide);
    expect(q("pl-base").width).toBeGreaterThan(w0);
    expect(q("pl-route").width).toBe(q("pl-base").width);
    expect(q("pl-route").height).toBe(q("pl-base").height);
    // A narrow window: the map comes down to fit it, with a gutter.
    setView(computeLayout({ cssW: 480, cssH: 800, dpr: 1, hiDpi: true }));
    expect(size()).toBeLessThan(480);
    expect(size()).toBeLessThan(wide);
  });

  it("a larger text size leaves the map room: the map shrinks as the side column grows", () => {
    const { open, root, store } = setup();
    open();
    const normal = Number.parseInt(root.style.props["--pl-size"]!, 10);
    store.update({ textScale: 1.5 });
    expect(Number.parseInt(root.style.props["--pl-size"]!, 10)).toBeLessThanOrEqual(normal);
  });
});

describe("a 136 x 136 map on small screens", () => {
  const crowded = (all: (cls: string) => PEl[]): number => all("pl-camp").filter((c) => c.one("pl-chip").classList.contains("crowded")).length;

  it("hides the matchup chips that would sit on another mark, more of them on the small preview than on the planning map", () => {
    setView(computeLayout({ cssW: 1920, cssH: 1080, dpr: 1, hiDpi: true }));
    const planning = setup();
    planning.open();
    const onPlanning = crowded(planning.all);
    // A short, narrow window: the preview card's map comes down to its smallest.
    setView(computeLayout({ cssW: 640, cssH: 420, dpr: 1, hiDpi: true }));
    const preview = setup();
    preview.view.update(frame({ mode: "preview" }));
    const onPreview = crowded(preview.all);
    expect(onPreview).toBeGreaterThan(0);
    expect(onPreview).toBeGreaterThan(onPlanning);
    // Every chip is still in the page (its text reads on hover or focus); a crowded one is only hidden by its class.
    for (const c of preview.all("pl-camp")) expect(c.one("pl-chip").textContent).toMatch(/^(\+|~|!)\d+%$|^lose$/);
  });

  it("lays out again when the window changes, and keeps the chip classes through a faction change", () => {
    setView(computeLayout({ cssW: 640, cssH: 420, dpr: 1, hiDpi: true }));
    const { view, all } = setup();
    view.update(frame({ mode: "preview" }));
    const before = crowded(all);
    view.update(frame({ mode: "preview", players: [{ faction: "frost", ready: false, me: true }] }));
    // A faction change rewrites the chips (their widths follow their text), so the crowding is laid out again: with 40 camps
    // (136x136) a chip or two may change hands. WP6 owns the label rules for 40 camps.
    expect(Math.abs(crowded(all) - before)).toBeLessThanOrEqual(2);
    setView(computeLayout({ cssW: 1920, cssH: 1080, dpr: 1, hiDpi: true }));
    expect(crowded(all)).toBeLessThanOrEqual(before);
  });

  it("places every zone's name inside the map, by percent, from its pole or the nearest free spot", () => {
    const { open, all } = setup();
    open();
    const labels = all("pl-zone");
    expect(labels).toHaveLength(MAP.regions.length);
    for (const label of labels) {
      for (const prop of ["left", "top"]) {
        const v = Number.parseFloat(label.style.props[prop]!);
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThan(100);
      }
    }
    expect(new Set(labels.map((l) => `${l.style.props["left"]},${l.style.props["top"]}`)).size).toBe(labels.length);
  });
});

describe("Page Up and Page Down on the markers", () => {
  it("jump to the first camp of the next or previous zone, wrapping, and from a spawn to the first or the last zone", () => {
    const { dom, open, all, spawnMarks } = setup();
    open();
    const camps = all("pl-camp");
    const firstOfZone = (zone: string): number => MAP.camps.findIndex((c) => c.zone === zone);
    const zones = [...new Set(MAP.camps.map((c) => c.zone))];
    expect(zones.length).toBe(5);
    camps[0]!.focus();
    dom.press("PageDown");
    expect(dom.doc.activeElement).toBe(camps[firstOfZone(zones[1]!)]);
    dom.press("PageUp");
    expect(dom.doc.activeElement).toBe(camps[firstOfZone(zones[0]!)]);
    dom.press("PageUp");
    expect(dom.doc.activeElement).toBe(camps[firstOfZone(zones[4]!)]);
    dom.press("PageDown");
    expect(dom.doc.activeElement).toBe(camps[firstOfZone(zones[0]!)]);
    spawnMarks()[0]!.focus();
    dom.press("PageDown");
    expect(dom.doc.activeElement).toBe(camps[firstOfZone(zones[0]!)]);
    spawnMarks()[0]!.focus();
    dom.press("PageUp");
    expect(dom.doc.activeElement).toBe(camps[firstOfZone(zones[4]!)]);
  });
});

describe("reduced motion and the stylesheet", () => {
  const css = readFileSync(new URL("../src/ui/planning.css", import.meta.url), "utf8");

  it("stops the countdown bar's glide and every transition and animation under the reduced-motion switch and the OS setting", () => {
    expect(css).toMatch(/html\[data-reduced-motion\] \.planning \.pl-bar::after,\s*\nhtml\[data-reduced-motion\] \.planning \*\s*\{\s*transition:\s*none !important;\s*animation:\s*none !important/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*transition:\s*none !important;\s*animation:\s*none !important/);
  });

  it("uses no viewport units or size media queries (the overlay is scaled to the stage), only the overlay's own variables", () => {
    expect(css).not.toMatch(/\b\d+(\.\d+)?v[wh]\b/);
    expect(css).not.toMatch(/@media[^{]*(width|height)/);
    expect(css).toContain("var(--ui-w");
    expect(css).toContain("var(--pl-text");
  });

  it("sits under the chrome and its panels", () => {
    const z = Number(/#ui > \.planning \{[^}]*z-index:\s*(\d+)/.exec(css)![1]);
    const chrome = readFileSync(new URL("../src/ui/chrome.css", import.meta.url), "utf8");
    const chromeZ = Number(/#ui > \.chrome \{[^}]*z-index:\s*(\d+)/.exec(chrome)![1]);
    expect(z).toBeGreaterThan(0);
    expect(z).toBeLessThan(chromeZ);
  });

  it("draws every zone's pattern in the legend swatches", () => {
    for (const p of ["slash", "backslash", "dots", "grid", "bars"]) expect(css).toContain(`.pattern-${p} .pl-swatch`);
    expect(FACTION_IDS).toHaveLength(5);
  });
});
