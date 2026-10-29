// The build strip in the HUD plate (ui/buildHud.ts): nine cells under the cards row, fed by the synced mirrors and build, hidden while
// the player does not stand, touching the DOM only when a cell changed; and click-through, its tooltips found by hit-testing the pointer.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeMirrors, type StatMirrors } from "@raid/shared";
import type { PlayerState, RaidState } from "@raid/shared/schema";
import { BUILD_LABEL, BUILD_TIP_ON, BuildHud, heldWeapon, inputKey, statsOf, type BuildSource } from "../src/ui/buildHud";
import { BUILD_STAT_IDS } from "../src/ui/buildModel";
import { Hud } from "../src/ui/hud";
import { FakeEl, fakeEvent, installFakeDom } from "./fakes";

const css = readFileSync(new URL("../src/ui/buildHud.css", import.meta.url), "utf8");
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|\\n|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1]!;
}

beforeEach(() => { installFakeDom(); });
afterEach(() => { vi.unstubAllGlobals(); });

const IDENTITY: StatMirrors = { asMult: 1, windupMult: 1, speedMult: 1, armorBonus: 0, shieldBonus: 0, adBonus: 0, apBonus: 0 };
const me = (over: Partial<Omit<BuildSource, "build">> & { build?: Record<string, number>; m?: Partial<StatMirrors> } = {}): BuildSource => {
  const { m, ...rest } = over;
  return {
    faction: "plague", build: {}, weapon0: "sword", weapon1: "", slot: 0, hp: 100, maxHp: 100, sentence: 0, ...encodeMirrors({ ...IDENTITY, ...m }), ...rest,
  } as unknown as BuildSource;
};

function setup() {
  const strip = new BuildHud();
  const root = strip.root as unknown as FakeEl;
  const [label, grid] = root.children as FakeEl[];
  const cells = (): FakeEl[] => grid!.children as FakeEl[];
  const part = (cell: FakeEl, i: number): string => (cell.children[i] as FakeEl).textContent;
  const values = (): Record<string, string> => Object.fromEntries(cells().map((c, i) => [BUILD_STAT_IDS[i], part(c, 1)]));
  return { strip, root, label: label!, grid: grid!, cells, part, values };
}

describe("BuildHud", () => {
  it("is hidden as a whole until a standing player is given, under a label", () => {
    const { root, label, cells } = setup();
    expect(root.hidden).toBe(true);
    expect(label.textContent).toBe(BUILD_LABEL);
    expect(cells()).toHaveLength(9);
  });

  it("shows the nine cells for a fresh player: PvP x0.77 at power 0", () => {
    const { strip, root, values, cells, part } = setup();
    strip.update(me(), true);
    expect(root.hidden).toBe(false);
    expect(strip.shown).toBe(true);
    expect(values()).toEqual({ ad: "+0", ap: "+0", armor: "190", mr: "0", as: "0%", move: "0%", leech: "0%", power: "0", pvp: "x0.77" });
    expect(cells().map((c) => part(c, 0))).toEqual(["AD", "AP", "Armor", "MR", "Atk speed", "Move", "Leech", "Power", "PvP"]);
    expect(part(cells()[8]!, 2)).toBe("Your damage to players. Your card power sets this factor; it scales hits against players only.");
    expect(cells().every((c) => c.classes.has("dim"))).toBe(true);
  });

  it("includes fractional lifesteal from fixed normal-mob stacks in build totals", () => {
    const { strip, values, cells, part } = setup();
    strip.update(me({ mobStats: new Map([["rotMonk", 6]]) as never }), true);
    expect(values().leech).toBe("2%");
    expect(part(cells()[6]!, 2)).toContain("normal-mob kills");
  });

  it("shows Sentence stacks only for the Sentenced build and refreshes them when they change", () => {
    const { strip, label } = setup();
    strip.update(me({ faction: "sentenced", sentence: 2 }), true);
    expect(label.textContent).toBe("Build · Sentence: 2/5");
    strip.update(me({ faction: "sentenced", sentence: 3 }), true);
    expect(label.textContent).toBe("Build · Sentence: 3/5");
    strip.update(me({ faction: "fire", sentence: 3 }), true);
    expect(label.textContent).toBe(BUILD_LABEL);
  });

  it("follows the build and the mirrors", () => {
    const { strip, values, cells } = setup();
    strip.update(me({ build: { ad2: 1, haste1: 1 }, m: { adBonus: 21, asMult: 1.09, speedMult: 1.06 } }), true);
    expect(values()).toMatchObject({ ad: "+21", as: "+9%", move: "+6%", power: "3", pvp: "x1.65" });
    expect(cells()[0]!.classes.has("dim")).toBe(false);
    expect(cells()[1]!.classes.has("dim")).toBe(true);
    strip.update(me({ build: { ad2: 1, haste1: 1, armor1: 1 }, m: { adBonus: 21, armorBonus: 15 } }), true);
    expect(values()).toMatchObject({ armor: "205", power: "4" });
  });

  it("reads the held weapon: the tooltips of AD and AP change with the slot in hand", () => {
    const { strip, cells, part } = setup();
    strip.update(me({ weapon0: "sword", weapon1: "wand", slot: 0 }), true);
    expect(part(cells()[1]!, 2)).toContain("Your Sword");
    strip.update(me({ weapon0: "sword", weapon1: "wand", slot: 1 }), true);
    expect(part(cells()[1]!, 2)).toContain("Your Wand turns each point into 1 damage a second");
    strip.update(me({ weapon0: "", weapon1: "", slot: 0 }), true);
    expect(part(cells()[0]!, 2)).toContain("Your Fists turns each point into 0.6");
    expect(heldWeapon({ weapon0: "", weapon1: "bow", slot: 0 })).toBe("fists");
    expect(heldWeapon({ weapon0: "fromTheFuture", weapon1: "", slot: 0 })).toBe("fists");
    expect(statsOf(me()).length).toBe(9);
  });

  it("hides for a player who does not stand or is missing, and comes back", () => {
    const { strip, root } = setup();
    strip.update(me(), false);
    expect(root.hidden).toBe(true);
    strip.update(me(), true);
    expect(root.hidden).toBe(false);
    strip.update(undefined, true);
    expect(root.hidden).toBe(true);
  });

  it("touches the DOM only when something changed", () => {
    const { strip, cells, part } = setup();
    strip.update(me({ build: { ad1: 1 } }), true);
    const value = cells()[7]!.children[1] as FakeEl;
    value.textContent = "poked";
    for (let i = 0; i < 5; i++) strip.update(me({ build: { ad1: 1 } }), true);
    expect(part(cells()[7]!, 1)).toBe("poked");
    strip.update(me({ build: { ad1: 2 } }), true);
    expect(part(cells()[7]!, 1)).toBe("2");
  });

  it("computes nothing for a frame whose inputs did not change (the build map, the mirrors, the weapon, the half-hp mark)", () => {
    const { strip, cells, part } = setup();
    strip.update(me({ build: { ad1: 1 } }), true);
    expect(inputKey(me({ build: { ad1: 1 } }))).toBe(inputKey(me({ build: { ad1: 1 } })));
    // A Map build (the schema) keys the same as a record.
    expect(inputKey({ ...me({ build: { ad1: 1 } }), build: new Map([["ad1", 1]]) } as unknown as BuildSource)).toBe(inputKey(me({ build: { ad1: 1 } })));
    for (const other of [me({ build: { ad1: 2 } }), me({ build: { ad1: 1 }, weapon0: "bow" }), me({ build: { ad1: 1 }, m: { adBonus: 12 } }), me({ build: { ad1: 1 }, hp: 40 }), me({ build: { ad1: 1 }, faction: "fire" })]) {
      expect(inputKey(other)).not.toBe(inputKey(me({ build: { ad1: 1 } })));
    }
    (cells()[0]!.children[1] as FakeEl).textContent = "poked";
    strip.update(me({ build: { ad1: 1 } }), true);
    expect(part(cells()[0]!, 1)).toBe("poked"); // not recomputed
    strip.update(me({ build: { ad1: 1 }, m: { adBonus: 12 } }), true);
    expect(part(cells()[0]!, 1)).toBe("+12");
  });

  it("gives each cell an accessible label with the number and the tooltip", () => {
    const { strip, cells } = setup();
    strip.update(me({ build: { ad1: 1 }, m: { adBonus: 12 } }), true);
    expect(cells()[0]!.getAttribute("aria-label")).toMatch(/^AD \+12\. /);
  });
});

describe("the strip never takes the pointer", () => {
  it("is click-through in the stylesheet, root to cell and tooltip, and nothing turns it back on", () => {
    for (const s of [".hud-build", ".build-grid", ".build-cell", ".build-tip"]) expect(rule(s), s).toMatch(/pointer-events:\s*none/);
    expect(css).not.toMatch(/pointer-events:\s*auto/);
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/:hover/);
    expect(rule(".build-cell.tip-on .build-tip")).toMatch(/display:\s*block/);
  });

  it("puts no pointer handler on the strip or a cell", () => {
    const { strip, root, cells } = setup();
    strip.update(me(), true);
    for (const type of ["pointerdown", "pointerup", "pointermove", "mousedown", "mouseup", "click", "contextmenu", "wheel", "touchstart"]) {
      for (const node of [root, ...cells()]) expect(node.listenerCount(type), `${type} on ${node.className}`).toBe(0);
    }
  });

  it("shows the tooltip of the cell under the pointer (found by its rectangle) and hides it off the cells, over a panel and on Escape", () => {
    const dom = installFakeDom();
    const { strip, grid, cells } = setup();
    strip.update(me(), true);
    grid.rect = { left: 10, top: 400, width: 240, height: 48 };
    cells().forEach((c, i) => { c.rect = { left: 10 + (i % 3) * 80, top: 400 + Math.floor(i / 3) * 16, width: 76, height: 15 }; });
    const canvas = { tagName: "CANVAS" };
    const panel = { tagName: "DIV", closest: (sel: string) => (sel === "#ui" ? {} : null) };
    const move = (x: number, y: number, target: unknown = canvas): void => {
      dom.win.dispatchEvent(fakeEvent("pointermove", { clientX: x, clientY: y, target }));
    };
    const on = (): number[] => cells().flatMap((c, i) => (c.classes.has(BUILD_TIP_ON) ? [i] : []));
    move(20, 405);
    expect(on()).toEqual([0]);
    move(100, 421);
    expect(on()).toEqual([4]);
    move(100, 600);
    expect(on()).toEqual([]);
    move(20, 405, panel);
    expect(on()).toEqual([]);
    move(20, 405);
    dom.win.dispatchEvent(fakeEvent("keydown", { code: "Escape", key: "Escape" }));
    expect(on()).toEqual([]);
  });

  it("stops listening when destroyed", () => {
    const dom = installFakeDom();
    const { strip, root } = setup();
    expect(dom.win.listenerCount("pointermove")).toBe(1);
    strip.destroy();
    expect(dom.win.listenerCount("pointermove")).toBe(0);
    expect(root.removed).toBe(true);
  });
});

describe("in the Hud", () => {
  const player = (over: Record<string, unknown> = {}): PlayerState =>
    ({
      status: "alive", name: "Me", faction: "plague", hp: 100, maxHp: 100, bounty: 0, barrier: 0, kills: 0, mobKills: 0, gv: 0, build: { ad2: 1 },
      immuneUntil: 0, weapon0: "sword", weapon1: "", slot: 0, ...encodeMirrors({ ...IDENTITY, adBonus: 21 }), ...over,
    }) as unknown as PlayerState;
  const run = (): RaidState =>
    ({ phase: "active", mobs: new Map(), players: new Map(), minPlayers: 2, startedWith: 2, lobbyEndsAt: 0, planEndsAt: 0, winner: "", patienceEndsAt: 0, suddenDeathAt: 0 }) as unknown as RaidState;
  const stripOf = (hud: Hud): FakeEl => ((hud as unknown as { root: FakeEl }).root.children as FakeEl[]).find((c) => c.className === "hud-build")!;
  const pvpValue = (strip: FakeEl): string => (((strip.children[1] as FakeEl).children[8] as FakeEl).children[1] as FakeEl).textContent;

  it("sits right under the cards row, shows for a standing player and goes when they are down", () => {
    const hud = new Hud();
    const classes = ((hud as unknown as { root: FakeEl }).root.children as FakeEl[]).map((c) => c.className);
    expect(classes.indexOf("hud-build")).toBe(classes.indexOf("hud-cards") + 1);
    const strip = stripOf(hud);
    expect(strip.hidden).toBe(true);
    hud.update(run(), player(), 0);
    expect(strip.hidden).toBe(false);
    expect(pvpValue(strip)).toBe("x1.40");
    hud.update(run(), player({ status: "dead" }), 0);
    expect(strip.hidden).toBe(true);
  });
});
