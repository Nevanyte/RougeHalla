// The passives row (ui/passivesRow.ts) under the build strip: a chip per skill held with its rank, hidden while nothing is held or
// the player is not standing, a tooltip that says what the rank gives and what the next adds, found by hit-testing the pointer
// (the row never takes it), and its place in the BuffsHud.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SKILLS, skillDef, skillText } from "@raid/shared";
import type { PlayerState, RaidState } from "@raid/shared/schema";
import { BuffsHud } from "../src/ui/buffsHud";
import { PASSIVES_LABEL, PASSIVE_TIP_ON, PassivesRow, passiveTip, rankTag } from "../src/ui/passivesRow";
import { FakeEl, fakeEvent, installFakeDom } from "./fakes";

const css = readFileSync(new URL("../src/ui/passivesRow.css", import.meta.url), "utf8");
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|\\n|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1]!;
}

beforeEach(() => { installFakeDom(); });
afterEach(() => { vi.unstubAllGlobals(); });

const index = (id: string): number => SKILLS.findIndex((s) => s.id === id);

function setup() {
  const row = new PassivesRow();
  const root = row.root as unknown as FakeEl;
  const [label, list] = root.children as FakeEl[];
  const chips = list!.children as FakeEl[];
  const part = (chip: FakeEl, i: number): FakeEl => chip.children[i] as FakeEl;
  const visible = (): string[] => SKILLS.filter((_, i) => !chips[i]!.hidden).map((s) => s.id);
  return { row, root, label: label!, chips, part, visible };
}

describe("PassivesRow", () => {
  it("is one hidden chip per catalog skill, in catalog order, under a label, and hidden as a whole", () => {
    const { root, label, chips, part, visible } = setup();
    expect(root.hidden).toBe(true);
    expect(label.textContent).toBe(PASSIVES_LABEL);
    expect(chips).toHaveLength(SKILLS.length);
    expect(chips.map((c) => part(c, 1).textContent)).toEqual(SKILLS.map((s) => s.name));
    expect(visible()).toEqual([]);
  });

  it("shows a chip per passive held, with its name and rank, and nothing for an id it does not know", () => {
    const { row, root, chips, part, visible } = setup();
    row.update({ whetstone: 1, pestilence: 2, fromTheFuture: 1 }, "plague", true);
    expect(root.hidden).toBe(false);
    expect(row.count).toBe(2);
    expect(visible()).toEqual(["pestilence", "whetstone"]);
    expect(part(chips[index("whetstone")]!, 2).textContent).toBe("R1");
    expect(part(chips[index("pestilence")]!, 2).textContent).toBe("R2");
  });

  it("reads a Map-like build (the synced MapSchema) as it does a record", () => {
    const { row, visible } = setup();
    row.update(new Map([["swiftBoots", 2], ["thickHide", 1]]), "fire", true);
    expect(visible()).toEqual(["swiftBoots", "thickHide"]);
  });

  it("follows the build: a rank rising to 2 repaints, one that goes away hides", () => {
    const { row, root, chips, part, visible } = setup();
    row.update({ whetstone: 1 }, "fire", true);
    const tip1 = part(chips[index("whetstone")]!, 3).textContent;
    expect(tip1).toContain("At rank 2:");
    row.update({ whetstone: 2 }, "fire", true);
    expect(part(chips[index("whetstone")]!, 2).textContent).toBe("R2");
    expect(part(chips[index("whetstone")]!, 3).textContent).not.toContain("At rank 2:");
    row.update({}, "fire", true);
    expect(visible()).toEqual([]);
    expect(root.hidden).toBe(true);
  });

  it("is hidden for a player who is not standing, whatever they hold, and back when they are", () => {
    const { row, root } = setup();
    row.update({ whetstone: 1 }, "fire", false);
    expect(root.hidden).toBe(true);
    row.update({ whetstone: 1 }, "fire", true);
    expect(root.hidden).toBe(false);
    row.update(undefined, undefined, true);
    expect(root.hidden).toBe(true);
    row.update(null, "fire", true);
    expect(root.hidden).toBe(true);
  });

  it("touches the DOM only when something changed", () => {
    const { row, chips, part } = setup();
    row.update({ whetstone: 1 }, "fire", true);
    const rank = part(chips[index("whetstone")]!, 2);
    const tip = part(chips[index("whetstone")]!, 3);
    rank.textContent = "poked";
    tip.textContent = "poked";
    for (let i = 0; i < 5; i++) row.update({ whetstone: 1 }, "fire", true);
    expect(rank.textContent).toBe("poked");
    expect(tip.textContent).toBe("poked");
    // The faction can change the wording of a rank: that does repaint.
    row.update({ whetstone: 1 }, "plague", true);
    expect(rank.textContent).toBe("R1");
  });

  it("marks each chip with its pool's shape (a zone's own marker, a disc for the neutral pool)", () => {
    const { chips, part } = setup();
    const clip = (id: string): string | undefined => (part(chips[index(id)]!, 0).style as { props: Record<string, string> }).props["clip-path"];
    const radius = (id: string): string | undefined => (part(chips[index(id)]!, 0).style as { props: Record<string, string> }).props["border-radius"];
    expect(clip("pestilence")).toMatch(/^polygon\(/);
    expect(radius("pestilence")).toBe("0");
    expect(clip("whetstone")).toBe("");
    expect(radius("whetstone")).toBe("50%");
    // Plague and Sentenced have different shapes: the zone is told by shape, not hue.
    expect(clip("pestilence")).not.toBe(clip("witness"));
  });
});

describe("passiveTip: Quickdraw's caveat", () => {
  it("says windups end on ticks, under the other lines, and only Quickdraw has one", () => {
    const tip = passiveTip(skillDef("quickdraw")!, 1);
    const lines = tip.split("\n");
    expect(lines.at(-1)).toBe(skillDef("quickdraw")!.note);
    expect(lines.at(-1)).toMatch(/50 ms tick/);
    expect(lines[1]).toBe("-8% windup time");
    for (const def of SKILLS) if (def.id !== "quickdraw") expect(def.note, def.id).toBeUndefined();
    // The cards (skillText) stay the rank's own line: the number is the rows', the caveat is the tooltip's.
    expect(skillText("quickdraw", 1)).toBe("-8% windup time");
  });
});

describe("passiveTip", () => {
  it("says the name, pool and rank, what the rank gives, what the next adds, and the matchup tags", () => {
    const tip = passiveTip(skillDef("whetstone")!, 1).split("\n");
    expect(tip[0]).toBe("Whetstone (Neutral, rank 1 of 2)");
    expect(tip[1]).toBe(skillText("whetstone", 1));
    expect(tip[2]).toBe(`At rank 2: ${skillText("whetstone", 2)}`);
    expect(tip[3]).toBe("Works with: anyone");
    expect(tip[4]).toBe("Strong against: anyone");
    expect(tip).toHaveLength(5);
  });

  it("has no next rank at the top, and lists what a skill is strong against", () => {
    const tip = passiveTip(skillDef("swiftBoots")!, 2).split("\n");
    expect(tip[0]).toBe("Swift Boots (Neutral, rank 2 of 2)");
    expect(tip.some((l) => l.startsWith("At rank"))).toBe(false);
    expect(tip.at(-1)).toBe("Strong against: kiters");
  });

  it("names a zone pool by its faction's name and words the rank for the player's faction", () => {
    const def = skillDef("pestilence")!;
    expect(passiveTip(def, 1, "plague").split("\n")[0]).toBe("Pestilence (Plague, rank 1 of 2)");
    expect(passiveTip(def, 1, "plague")).not.toBe(passiveTip(def, 1, "fire"));
    expect(passiveTip(skillDef("lastRites")!, 1).split("\n")[0]).toBe("Last Rites (Demon Blood, rank 1 of 2)");
  });

  it("is the rank as R1 / R2", () => {
    expect(rankTag(1)).toBe("R1");
    expect(rankTag(2)).toBe("R2");
  });
});

describe("the row never takes the pointer", () => {
  it("is click-through in the stylesheet, root to chip and tooltip, and nothing turns it back on", () => {
    for (const s of [".hud-passives", ".passive-list", ".passive-chip", ".passive-tip"]) expect(rule(s), s).toMatch(/pointer-events:\s*none/);
    expect(css).not.toMatch(/pointer-events:\s*auto/);
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/:hover/);
    expect(rule(".passive-chip.tip-on .passive-tip")).toMatch(/display:\s*block/);
  });

  it("puts no pointer handler on the row or a chip, and listens on the window, passively", () => {
    const dom = installFakeDom();
    const added: Array<{ type: string; options: unknown }> = [];
    const original = dom.win.addEventListener.bind(dom.win);
    dom.win.addEventListener = ((type: string, fn: (e: unknown) => void, options?: unknown) => {
      added.push({ type, options });
      original(type, fn);
    }) as typeof dom.win.addEventListener;
    const { row, root, chips } = setup();
    row.update({ whetstone: 1 }, "fire", true);
    expect(added.find((a) => a.type === "pointermove")?.options).toEqual({ passive: true });
    for (const type of ["pointerdown", "pointerup", "pointermove", "mousedown", "mouseup", "click", "contextmenu", "wheel", "touchstart"]) {
      for (const node of [root, ...chips]) expect(node.listenerCount(type), `${type} on ${node.className}`).toBe(0);
    }
  });

  it("shows the tooltip of the chip under the pointer (found by its rectangle) and hides it off the chips, on Escape and on blur", () => {
    const dom = installFakeDom();
    const { row, chips } = setup();
    row.update({ whetstone: 1, swiftBoots: 2 }, "fire", true);
    const a = chips[index("swiftBoots")]!;
    const b = chips[index("whetstone")]!;
    a.rect = { left: 10, top: 300, width: 80, height: 16 };
    b.rect = { left: 94, top: 300, width: 80, height: 16 };
    const canvas = { tagName: "CANVAS" };
    const panel = { tagName: "DIV", closest: (sel: string) => (sel === "#ui" ? {} : null) };
    const move = (x: number, y: number, target: unknown = canvas): void => {
      dom.win.dispatchEvent(fakeEvent("pointermove", { clientX: x, clientY: y, target }));
    };
    const on = (): string[] => SKILLS.filter((_, i) => chips[i]!.classes.has(PASSIVE_TIP_ON)).map((s) => s.id);
    move(50, 308);
    expect(on()).toEqual(["swiftBoots"]);
    move(120, 308);
    expect(on()).toEqual(["whetstone"]);
    move(120, 400);
    expect(on()).toEqual([]);
    move(50, 308);
    dom.win.dispatchEvent(fakeEvent("keydown", { code: "Escape", key: "Escape" }));
    expect(on()).toEqual([]);
    move(50, 308);
    dom.win.dispatchEvent(fakeEvent("blur"));
    expect(on()).toEqual([]);
    // Over a panel of the interface, no tooltip: the pointer is not on the world.
    move(50, 308, panel);
    expect(on()).toEqual([]);
    move(50, 308);
    expect(on()).toEqual(["swiftBoots"]);
    // A chip that goes away takes its tooltip with it.
    row.update({ whetstone: 1 }, "fire", true);
    expect(on()).toEqual([]);
  });

  it("reads the chips' rectangles again when the row has moved or grown (the buff strip above it wrapped), with no repaint or resize", () => {
    const dom = installFakeDom();
    const { row, root, chips } = setup();
    const list = (root.children as FakeEl[])[1]!;
    row.update({ whetstone: 1, swiftBoots: 2 }, "fire", true);
    const a = chips[index("swiftBoots")]!;
    const b = chips[index("whetstone")]!;
    list.rect = { left: 10, top: 300, width: 200, height: 16 };
    a.rect = { left: 10, top: 300, width: 80, height: 16 };
    b.rect = { left: 94, top: 300, width: 80, height: 16 };
    const canvas = { tagName: "CANVAS" };
    const move = (x: number, y: number): void => { dom.win.dispatchEvent(fakeEvent("pointermove", { clientX: x, clientY: y, target: canvas })); };
    const on = (): string[] => SKILLS.filter((_, i) => chips[i]!.classes.has(PASSIVE_TIP_ON)).map((s) => s.id);
    move(50, 308);
    expect(on()).toEqual(["swiftBoots"]);
    // The strip above gains a line: the whole row drops 22 px. Nothing was repainted and the window did not resize.
    list.rect = { left: 10, top: 322, width: 200, height: 16 };
    a.rect = { left: 10, top: 322, width: 80, height: 16 };
    b.rect = { left: 94, top: 322, width: 80, height: 16 };
    move(50, 308);
    expect(on(), "the old place is empty now").toEqual([]);
    move(50, 330);
    expect(on()).toEqual(["swiftBoots"]);
    move(120, 330);
    expect(on()).toEqual(["whetstone"]);
    // The row growing (a third chip wrapping it taller) is seen too.
    list.rect = { left: 10, top: 322, width: 200, height: 40 };
    b.rect = { left: 10, top: 344, width: 80, height: 16 };
    move(50, 350);
    expect(on()).toEqual(["whetstone"]);
  });

  it("never stops or cancels what it hears", () => {
    const dom = installFakeDom();
    const { row } = setup();
    row.update({ whetstone: 1 }, "fire", true);
    for (const type of ["pointermove", "pointerdown", "pointerup", "pointerout"]) {
      const e = fakeEvent(type, { clientX: 20, clientY: 20, target: { tagName: "CANVAS" }, relatedTarget: null });
      dom.win.dispatchEvent(e);
      expect(e.defaultPrevented, type).toBe(false);
      expect(e.propagationStopped, type).toBe(false);
    }
  });

  it("stops listening when destroyed", () => {
    const dom = installFakeDom();
    const { row, root } = setup();
    expect(dom.win.listenerCount("pointermove")).toBe(1);
    row.destroy();
    expect(dom.win.listenerCount("pointermove")).toBe(0);
    expect(root.removed).toBe(true);
  });
});

describe("in the BuffsHud", () => {
  const me = (build: Record<string, number>, buffs: Record<string, number> = {}, status = "alive"): PlayerState =>
    ({ status, kills: 0, mobKills: 0, buffs, build, faction: "plague" }) as unknown as PlayerState;
  const run = (): RaidState => ({ phase: "active", mobs: new Map([["m", { kind: "mob" }]]), players: new Map() }) as unknown as RaidState;

  it("sits after the buff chips, shows with the passives alone, and goes when they do", () => {
    const hud = new BuffsHud();
    const root = hud.root as unknown as FakeEl;
    const [strip, passives] = root.children as FakeEl[];
    expect(passives).toBe(hud.passives.root as unknown as FakeEl);
    hud.update(run(), me({ whetstone: 1 }));
    expect(root.hidden).toBe(false);
    expect(passives!.hidden).toBe(false);
    expect(strip!.hidden).toBe(true);
    hud.update(run(), me({}));
    expect(passives!.hidden).toBe(true);
    // A player who is down shows no passives.
    hud.update(run(), me({ whetstone: 1 }, {}, "dead"));
    expect(passives!.hidden).toBe(true);
  });

  it("shows beside the buffs", () => {
    const hud = new BuffsHud();
    hud.update(run(), me({ whetstone: 2 }, { emberImp: 1.1 }));
    const [strip, passives] = (hud.root as unknown as FakeEl).children as FakeEl[];
    expect([strip!.hidden, passives!.hidden]).toEqual([false, false]);
  });

  it("takes its listeners with it when the HUD is destroyed", () => {
    const dom = installFakeDom();
    const hud = new BuffsHud();
    expect(dom.win.listenerCount("pointermove")).toBe(2);
    hud.destroy();
    expect(dom.win.listenerCount("pointermove")).toBe(0);
  });
});
