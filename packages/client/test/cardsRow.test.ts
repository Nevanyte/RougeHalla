// The cards row (ui/cardsRow.ts) in the HUD plate: a chip per card held in catalog order with its title and, for a base card held
// more than once, its count; hidden while nothing is held or the player is not standing; a tooltip with the card's text and the
// glossary line of each tag, found by hit-testing the pointer (the row never takes it); and its place in the Hud.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CARDS, STAT_GLOSSARY, TAG_GLOSSARY, cardDef, tagLabel } from "@raid/shared";
import type { PlayerState, RaidState } from "@raid/shared/schema";
import { CARDS_LABEL, CARD_TIP_ON, CardsRow, cardTip, countTag } from "../src/ui/cardsRow";
import { Hud } from "../src/ui/hud";
import { FakeEl, fakeEvent, installFakeDom } from "./fakes";

const css = readFileSync(new URL("../src/ui/cardsRow.css", import.meta.url), "utf8");
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|\\n|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1]!;
}

beforeEach(() => { installFakeDom(); });
afterEach(() => { vi.unstubAllGlobals(); });

function setup() {
  const row = new CardsRow();
  const root = row.root as unknown as FakeEl;
  const [label, list] = root.children as FakeEl[];
  /** The chips on screen, in order. */
  const chips = (): FakeEl[] => list!.children as FakeEl[];
  const name = (chip: FakeEl): string => (chip.children[0] as FakeEl).textContent;
  const count = (chip: FakeEl): string => (chip.children[1] as FakeEl).textContent;
  const tip = (chip: FakeEl): string => (chip.children[2] as FakeEl).textContent;
  const names = (): string[] => chips().map(name);
  return { row, root, label: label!, list: list!, chips, name, count, tip, names };
}

describe("CardsRow", () => {
  it("is hidden as a whole while nothing is held, under a label", () => {
    const { root, label, chips } = setup();
    expect(root.hidden).toBe(true);
    expect(label.textContent).toBe(CARDS_LABEL);
    expect(chips()).toEqual([]);
  });

  it("shows a chip per card held in catalog order, and nothing for an id it does not know", () => {
    const { row, root, names } = setup();
    row.update({ wellspring: 1, haste2: 1, ad1: 1, fromTheFuture: 1 }, true);
    expect(root.hidden).toBe(false);
    expect(row.count).toBe(3);
    expect(row.shown).toBe(true);
    expect(names()).toEqual(CARDS.filter((c) => ["ad1", "haste2", "wellspring"].includes(c.id)).map((c) => c.title));
    expect(names()).toEqual(["Attack Damage I", "Haste II", "Wellspring"]);
  });

  it("marks a base card held more than once with its count, and no other", () => {
    const { row, chips, count } = setup();
    row.update({ haste2: 2, ad1: 1, wellspring: 1 }, true);
    expect(chips().map(count)).toEqual(["", "x2", ""]);
    expect(countTag(3)).toBe("x3");
  });

  it("reads a Map-like build (the synced MapSchema) as it does a record", () => {
    const { row, names } = setup();
    row.update(new Map([["haste2", 3], ["leech1", 1]]), true);
    expect(names()).toEqual(["Haste II", "Leech I"]);
  });

  it("follows the build: a count rising repaints, a card that goes away leaves, an emptied build hides the row", () => {
    const { row, root, chips, count, tip, names } = setup();
    row.update({ haste2: 1 }, true);
    expect(count(chips()[0]!)).toBe("");
    expect(tip(chips()[0]!)).not.toContain("x2");
    row.update({ haste2: 2, wellspring: 1 }, true);
    expect(names()).toEqual(["Haste II", "Wellspring"]);
    expect(count(chips()[0]!)).toBe("x2");
    expect(tip(chips()[0]!)).toContain("Haste II (Base, tier II, x2)");
    row.update({ wellspring: 1 }, true);
    expect(names()).toEqual(["Wellspring"]);
    row.update({}, true);
    expect(chips()).toEqual([]);
    expect(root.hidden).toBe(true);
  });

  it("is hidden for a player who is not standing, whatever they hold, and back when they are", () => {
    const { row, root } = setup();
    row.update({ haste2: 1 }, false);
    expect(root.hidden).toBe(true);
    row.update({ haste2: 1 }, true);
    expect(root.hidden).toBe(false);
    row.update(undefined, true);
    expect(root.hidden).toBe(true);
    row.update(null, true);
    expect(root.hidden).toBe(true);
  });

  it("touches the DOM only when something changed, and reuses a card's chip", () => {
    const { row, list, chips, count } = setup();
    row.update({ haste2: 2 }, true);
    const chip = chips()[0]!;
    (chip.children[1] as FakeEl).textContent = "poked";
    const children = list.children;
    for (let i = 0; i < 5; i++) row.update({ haste2: 2 }, true);
    expect(count(chip)).toBe("poked");
    expect(list.children).toBe(children);
    // A change rebuilds the list but the same chip comes back for the same card.
    row.update({ haste2: 3 }, true);
    expect(chips()[0]).toBe(chip);
    expect(count(chip)).toBe("x3");
  });

  it("tells the kind by the chip's class", () => {
    const { row, chips } = setup();
    row.update({ leech1: 1, bloodthirst: 1, wellspring: 1 }, true);
    expect(chips().map((c) => c.className)).toEqual(["cards-chip base", "cards-chip conditional", "cards-chip augment"]);
  });
});

describe("cardTip", () => {
  it("says the title, kind and tier, the card's text, and the glossary line of each tag", () => {
    const lines = cardTip(cardDef("hereComesTheBoom")!, 1).split("\n");
    expect(lines[0]).toBe("Here Comes the Boom (Augment, tier III)");
    expect(lines[1]).toBe(cardDef("hereComesTheBoom")!.text);
    expect(lines.slice(2)).toEqual(cardDef("hereComesTheBoom")!.tags.map((t) => `${tagLabel(t)}: ${TAG_GLOSSARY[t].text}`));
    expect(lines).toContain("Damage over time: " + TAG_GLOSSARY.dot.text);
    expect(lines).toContain("Returned: " + TAG_GLOSSARY.returned.text);
  });

  it("adds the count for a base card held more than once, and has no tag lines for a card with no tags", () => {
    expect(cardTip(cardDef("haste2")!, 1)).toBe("Haste II (Base, tier II)\n+16% attack speed");
    expect(cardTip(cardDef("haste2")!, 2).split("\n")[0]).toBe("Haste II (Base, tier II, x2)");
  });

  it("shows the faction-specific Plague Cruel Wounds rule in the owned-card tooltip", () => {
    const tip = cardTip(cardDef("cruelWounds")!, 1, undefined, "plague");
    expect(tip).toContain("+20% critical strike chance");
    expect(tip).toContain("bonus damage equal to half your current critical strike chance");
    expect(tip).toContain("cannot crit");
  });

  it("says when a card's machinery is not in yet (a phase b card), and says nothing for a live one", () => {
    const waiting = { ...cardDef("rhythm")!, ready: "b" as const };
    expect(cardTip(waiting, 1).split("\n").at(-1)).toBe("Not live yet: it does nothing.");
    expect(cardTip({ ...cardDef("rhythm")!, ready: "a" as const }, 1)).not.toContain("Not live yet");
    expect(cardTip(cardDef("haste2")!, 1)).not.toContain("Not live yet");
  });

  it("sums a base's cards in the tooltip of any of them, once two or more are held, and names AD and AP for their cards", () => {
    const build = { ad1: 2, ad2: 1, ad3: 1, haste1: 1 };
    const lines = cardTip(cardDef("ad2")!, 1, build).split("\n");
    expect(lines).toContain("All your Attack Damage cards: +78 attack damage (I x2, II, III)");
    expect(lines).toContain("AD: " + STAT_GLOSSARY.ad.text);
    expect(cardTip(cardDef("haste1")!, 1, build)).not.toContain("All your");
    expect(cardTip(cardDef("haste1")!, 1, { haste1: 1, haste3: 1 })).toContain("All your Haste cards: +34% attack speed (I, III)");
    expect(cardTip(cardDef("ap1")!, 1, { ap1: 1 }).split("\n")).toContain("AP: " + STAT_GLOSSARY.ap.text);
    // An augment has no base to sum.
    expect(cardTip(cardDef("wellspring")!, 1, build)).not.toContain("All your");
  });

  it("repaints a chip's tooltip when another tier of its base arrives, though its own count did not change", () => {
    const { row, chips, tip } = setup();
    row.update({ ad1: 1 }, true);
    expect(tip(chips()[0]!)).not.toContain("All your");
    row.update({ ad1: 1, ad2: 1 }, true);
    expect(tip(chips()[0]!)).toContain("All your Attack Damage cards: +33 attack damage (I, II)");
  });
});

describe("the row never takes the pointer", () => {
  it("is click-through in the stylesheet, root to chip and tooltip, and nothing turns it back on", () => {
    for (const s of [".hud-cards", ".cards-list", ".cards-chip", ".cards-tip"]) expect(rule(s), s).toMatch(/pointer-events:\s*none/);
    expect(css).not.toMatch(/pointer-events:\s*auto/);
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/:hover/);
    expect(rule(".cards-chip.tip-on .cards-tip")).toMatch(/display:\s*block/);
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
    row.update({ haste2: 1 }, true);
    expect(added.find((a) => a.type === "pointermove")?.options).toEqual({ passive: true });
    for (const type of ["pointerdown", "pointerup", "pointermove", "mousedown", "mouseup", "click", "contextmenu", "wheel", "touchstart"]) {
      for (const node of [root, ...chips()]) expect(node.listenerCount(type), `${type} on ${node.className}`).toBe(0);
    }
  });

  it("shows the tooltip of the chip under the pointer (found by its rectangle) and hides it off the chips, on Escape and on blur", () => {
    const dom = installFakeDom();
    const { row, chips } = setup();
    row.update({ haste2: 1, wellspring: 1 }, true);
    const [a, b] = chips() as [FakeEl, FakeEl];
    a.rect = { left: 10, top: 300, width: 80, height: 16 };
    b.rect = { left: 94, top: 300, width: 80, height: 16 };
    const canvas = { tagName: "CANVAS" };
    const panel = { tagName: "DIV", closest: (sel: string) => (sel === "#ui" ? {} : null) };
    const move = (x: number, y: number, target: unknown = canvas): void => {
      dom.win.dispatchEvent(fakeEvent("pointermove", { clientX: x, clientY: y, target }));
    };
    const on = (): number[] => chips().flatMap((c, i) => (c.classes.has(CARD_TIP_ON) ? [i] : []));
    move(50, 308);
    expect(on()).toEqual([0]);
    move(120, 308);
    expect(on()).toEqual([1]);
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
    expect(on()).toEqual([0]);
    // The row rebuilding (a card was picked up) takes the tooltip with it; the next pointer move brings it back where it belongs.
    row.update({ haste2: 2, wellspring: 1 }, true);
    expect(on()).toEqual([]);
    move(50, 308);
    expect(on()).toEqual([0]);
  });

  it("reads the chips' rectangles again when the row has moved or grown (the plate above it wrapped), with no repaint or resize", () => {
    const dom = installFakeDom();
    const { row, list, chips } = setup();
    row.update({ haste2: 1, wellspring: 1 }, true);
    const [a, b] = chips() as [FakeEl, FakeEl];
    list.rect = { left: 10, top: 300, width: 200, height: 16 };
    a.rect = { left: 10, top: 300, width: 80, height: 16 };
    b.rect = { left: 94, top: 300, width: 80, height: 16 };
    const canvas = { tagName: "CANVAS" };
    const move = (x: number, y: number): void => { dom.win.dispatchEvent(fakeEvent("pointermove", { clientX: x, clientY: y, target: canvas })); };
    const on = (): number[] => chips().flatMap((c, i) => (c.classes.has(CARD_TIP_ON) ? [i] : []));
    move(50, 308);
    expect(on()).toEqual([0]);
    // The plate above gains a line: the whole row drops 22 px. Nothing was repainted and the window did not resize.
    list.rect = { left: 10, top: 322, width: 200, height: 16 };
    a.rect = { left: 10, top: 322, width: 80, height: 16 };
    b.rect = { left: 94, top: 322, width: 80, height: 16 };
    move(50, 308);
    expect(on(), "the old place is empty now").toEqual([]);
    move(50, 330);
    expect(on()).toEqual([0]);
    move(120, 330);
    expect(on()).toEqual([1]);
  });

  it("never stops or cancels what it hears", () => {
    const dom = installFakeDom();
    const { row } = setup();
    row.update({ haste2: 1 }, true);
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

describe("in the Hud", () => {
  const me = (build: Record<string, number>, status = "alive"): PlayerState =>
    ({ status, name: "Me", faction: "plague", hp: 100, maxHp: 100, bounty: 0, barrier: 0, kills: 0, mobKills: 0, gv: 0, build, immuneUntil: 0 }) as unknown as PlayerState;
  const run = (): RaidState =>
    ({ phase: "active", mobs: new Map(), players: new Map(), minPlayers: 2, startedWith: 2, lobbyEndsAt: 0, planEndsAt: 0, winner: "", patienceEndsAt: 0, suddenDeathAt: 0 }) as unknown as RaidState;
  const cardsOf = (hud: Hud): FakeEl => ((hud as unknown as { root: FakeEl }).root.children as FakeEl[]).find((c) => c.className === "hud-cards")!;

  it("sits under the vitals, shows with the player's cards, and goes when they do or when the player is down", () => {
    const hud = new Hud();
    const cards = cardsOf(hud);
    const classes = ((hud as unknown as { root: FakeEl }).root.children as FakeEl[]).map((c) => c.className);
    expect(classes.indexOf("hud-cards")).toBe(classes.indexOf("hud-vitals") + 1);
    expect(cards.hidden).toBe(true);
    hud.update(run(), me({ haste2: 1 }), 0);
    expect(cards.hidden).toBe(false);
    hud.update(run(), me({}), 0);
    expect(cards.hidden).toBe(true);
    hud.update(run(), me({ haste2: 1 }, "dead"), 0);
    expect(cards.hidden).toBe(true);
  });

  it("takes its listeners with it when the HUD is destroyed (the cards row's and the build strip's)", () => {
    const dom = installFakeDom();
    const hud = new Hud();
    expect(dom.win.listenerCount("pointermove")).toBe(2);
    hud.destroy();
    expect(dom.win.listenerCount("pointermove")).toBe(0);
  });
});
