// The camp chest panel (ui/chestPanel.ts) on the chrome tests' fake DOM: it opens and closes by the local player's latest server
// position, shows the cards of the chest in reach, picks and skips by mouse or by keyboard (C, 1 2 3, 0, Esc) without taking a
// key it does not own, greys everything just before the chest expires, shows who took what from the state, lets a player pick
// once, and reports what the server refused. Time is a number the test moves.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHEST_GREY_MS, CHEST_OPTIONS, TILE, TILE_FLOOR, TILE_WALL, generateMap, mapFromTiles, skipText,
  type ClientMessages, type GameMap,
} from "@raid/shared";
import { SettingsStore } from "../src/settings";
import { PANEL_RANGE, type RewardSource } from "../src/ui/chestMath";
import {
  ChestPanel, NOT_CONFIRMED_SAY, PENDING_EXPIRE_MS, PICKED_HOLD_MS, RECONNECTING_SAY, REFUSED_HOLD_MS, chestKeyAction,
  type ChestPanelFrame, type ChestPanelMe,
} from "../src/ui/chestPanel";
import { campTitle } from "../src/ui/planning";
import { fake, installChromeDom, type FEl, type FakeDocument, type FakeWindow } from "./chromeDom";

afterEach(() => { vi.unstubAllGlobals(); });

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
}

const MAP: GameMap = generateMap(7);
const NAMES: Record<string, string> = { bob: "Bob", eve: "Eve" };

const chest = (over: Partial<RewardSource> = {}): RewardSource => ({
  kind: "reward", x: 500, y: 500, camp: 2, expiresAt: 15_000, options: ["pestilence", "whetstone", "swiftBoots"],
  takenBy: ["", "", ""], pickers: [], ...over,
});

interface Rig {
  panel: ChestPanel;
  doc: FakeDocument;
  win: FakeWindow;
  root: FEl;
  sent: Array<ClientMessages["choose"]>;
  chests: Map<string, RewardSource>;
  me: ChestPanelMe;
  store: SettingsStore;
  /** The local clock the panel's timers read (ms). */
  clock: { now: number; rtt: number; sending: boolean };
  /** Runs one frame at the estimated server time `serverNow`. */
  frame: (serverNow?: number, over?: Partial<ChestPanelFrame>) => void;
  cards: () => FEl[];
  skip: () => FEl;
  text: (cls: string) => string;
  state: () => string;
}

function setup(over: { map?: GameMap | null; chests?: Array<[string, RewardSource]> } = {}): Rig {
  const { doc, win } = installChromeDom();
  const store = new SettingsStore(memoryStorage());
  const sent: Array<ClientMessages["choose"]> = [];
  const clock = { now: 0, rtt: 100, sending: true };
  const chests = new Map<string, RewardSource>(over.chests ?? [["c1", chest()]]);
  const me: ChestPanelMe = { id: "me", x: 540, y: 500, alive: true, faction: "plague", build: {} };
  const panel = new ChestPanel({
    send: (m) => { sent.push(m); },
    canSend: () => clock.sending,
    rtt: () => clock.rtt,
    now: () => clock.now,
    settings: store,
    map: over.map === undefined ? MAP : over.map,
  });
  const root = fake(panel.element);
  const frame = (serverNow = 1000, extra: Partial<ChestPanelFrame> = {}): void => {
    panel.update({ active: true, serverNow, me, containers: chests, nameOf: (id) => NAMES[id], sight: null, ...extra });
  };
  return {
    panel, doc, win, root, sent, chests, me, store, clock, frame,
    cards: () => root.byClass("cp-card"),
    skip: () => root.byClass("cp-skip")[0]!,
    text: (cls) => root.byClass(cls)[0]!.textContent,
    state: () => root.byClass("cp-status")[0]!.textContent,
  };
}

const cardName = (c: FEl): string => c.byClass("cp-name")[0]!.textContent;
const cardState = (c: FEl): string => c.byClass("cp-state")[0]!.textContent;
const cardRank = (c: FEl): string => c.byClass("cp-rank")[0]!.textContent;
const cardText = (c: FEl): string => c.byClass("cp-text")[0]!.textContent;

describe("when the panel is open", () => {
  it("is closed while no chest is up, and opens by itself when one is in reach", () => {
    const r = setup({ chests: [] });
    r.frame();
    expect(r.panel.isOpen).toBe(false);
    expect(r.root.hidden).toBe(true);
    r.chests.set("c1", chest());
    r.frame();
    expect(r.panel.isOpen).toBe(true);
    expect(r.panel.chestId).toBe("c1");
    expect(r.root.hidden).toBe(false);
  });

  it("follows the latest SERVER position: in reach inside the server's range less the slack, closed beyond it", () => {
    const r = setup();
    r.me.x = 500 + PANEL_RANGE;
    r.frame();
    expect(r.panel.isOpen).toBe(true);
    r.me.x = 500 + PANEL_RANGE + 1;
    r.frame();
    expect(r.panel.isOpen).toBe(false);
    r.me.x = 500;
    r.me.y = 500 - PANEL_RANGE - 20;
    r.frame();
    expect(r.panel.isOpen).toBe(false);
    r.me.y = 500 - 10;
    r.frame();
    expect(r.panel.isOpen).toBe(true);
  });

  it("shows no contents outside reach: nothing of the chest is read until the player is near", () => {
    const r = setup();
    r.me.x = 5000;
    r.frame();
    expect(r.panel.isOpen).toBe(false);
    expect(r.cards().every((c) => c.hidden || cardName(c) === "")).toBe(true);
    r.me.x = 540;
    r.frame();
    expect(r.cards().map(cardName)).toEqual(["Pestilence", "Whetstone", "Swift Boots"]);
  });

  it("closes when the chest expires, and when the player is down, or the run is not on", () => {
    const r = setup();
    r.frame(1000);
    expect(r.panel.isOpen).toBe(true);
    r.frame(15_000);
    expect(r.panel.isOpen).toBe(false);

    r.frame(1000);
    expect(r.panel.isOpen).toBe(true);
    r.me.alive = false;
    r.frame(1000);
    expect(r.panel.isOpen).toBe(false);
    r.me.alive = true;
    r.frame(1000, { active: false });
    expect(r.panel.isOpen).toBe(false);
    r.frame(1000);
    expect(r.panel.isOpen).toBe(true);
    r.frame(1000, { me: null });
    expect(r.panel.isOpen).toBe(false);
  });

  it("needs a clear line to the chest when it has the walls, like the server's pick", () => {
    const tiles = new Uint8Array(30 * 30).fill(TILE_FLOOR);
    for (let y = 0; y < 30; y++) tiles[y * 30 + 15] = TILE_WALL;
    const walls = mapFromTiles(30, 30, tiles);
    const r = setup({ chests: [["c1", chest({ x: 16.5 * TILE, y: 10 * TILE })]] });
    r.me.x = 14.5 * TILE;
    r.me.y = 10 * TILE;
    r.frame(1000, { sight: walls });
    expect(r.panel.isOpen).toBe(false);
    r.frame(1000, { sight: null });
    expect(r.panel.isOpen).toBe(true);
  });

  it("shows the nearest of two chests, and a chest the player has not picked at first", () => {
    const r = setup({
      chests: [["near", chest({ x: 520, y: 500, pickers: ["me"], takenBy: ["me", "", ""] })], ["far", chest({ x: 570, y: 500 })]],
    });
    r.frame();
    expect(r.panel.chestId).toBe("far");
    r.chests.set("near", chest({ x: 520, y: 500 }));
    r.frame();
    expect(r.panel.chestId).toBe("near");
  });
});

describe("what it shows", () => {
  it("names the camp and counts down the 15 seconds, with a bar that drains", () => {
    const r = setup();
    r.frame(1000);
    expect(r.text("cp-title")).toBe(campTitle(MAP.camps[1]!));
    // 15 000 - (1000 + 50): the estimate runs RTT/2 behind the server.
    expect(r.text("cp-timer")).toBe("0:14");
    r.frame(8_000);
    expect(r.text("cp-timer")).toBe("0:07");
    r.frame(14_000);
    expect(r.text("cp-timer")).toBe("0:01");
    expect(r.root.byClass("cp-timer")[0]!.classes.has("urgent")).toBe(true);
    const progress = r.root.byClass("cp-bar")[0]!.style.props["--cp-progress"];
    expect(Number(progress)).toBeLessThan(0.1);
    r.frame(1000);
    expect(r.root.byClass("cp-timer")[0]!.classes.has("urgent")).toBe(false);
  });

  it("has a header without a camp for a chest the map does not know (camp 0, or no map)", () => {
    const r = setup({ chests: [["c1", chest({ camp: 0 })]] });
    r.frame();
    expect(r.text("cp-title")).toBe("Camp chest");
    const noMap = setup({ map: null });
    noMap.frame();
    expect(noMap.text("cp-title")).toBe("Camp chest");
  });

  it("shows each option's name, its words for the player's faction, its pool, and a Rank 2 badge only for a skill held at rank 1", () => {
    const r = setup();
    r.me.build = { whetstone: 1 };
    r.frame();
    const cards = r.cards();
    expect(cards.map(cardName)).toEqual(["Pestilence", "Whetstone", "Swift Boots"]);
    expect(cards.map(cardRank)).toEqual(["", "Rank 2", ""]);
    expect(cards.map((c) => c.byClass("cp-pool")[0]!.textContent)).toEqual(["Plague", "Neutral", "Neutral"]);
    expect(cardText(cards[1]!)).toMatch(/10%/);
    expect(cardText(cards[0]!)).not.toBe("");
    expect(cards.map((c) => c.disabled)).toEqual([false, false, false]);
    expect(r.skip().byClass("cp-skip-text")[0]!.textContent).toBe(skipText());
    expect(r.state()).toMatch(/One pick per chest/);
  });

  it("fills a chest with fewer options than the cards: the spare ones stay hidden", () => {
    const r = setup({ chests: [["c1", chest({ options: ["whetstone"], takenBy: [""] })]] });
    r.frame();
    expect(r.cards().map((c) => c.hidden)).toEqual([false, true, true]);
  });

  it("a maxed option is muted and cannot be picked, by click or key", () => {
    const r = setup();
    r.me.build = { swiftBoots: 2 };
    r.frame();
    const maxed = r.cards()[2]!;
    expect(maxed.disabled).toBe(true);
    expect(cardState(maxed)).toMatch(/Maxed/);
    expect(maxed.hasClass("maxed")).toBe(true);
    maxed.click();
    expect(r.sent).toEqual([]);
    expect(r.panel.pick(2)).toBe(false);
    r.panel.focus();
    r.win.press({ code: "Digit3" });
    expect(r.sent).toEqual([]);
    expect(r.state()).toBe("Option 3 is not available.");
  });

  it("greys an option another player took, from the state, and says who", () => {
    const r = setup();
    r.chests.set("c1", chest({ takenBy: ["", "bob", ""], pickers: ["bob"] }));
    r.frame();
    const taken = r.cards()[1]!;
    expect(taken.disabled).toBe(true);
    expect(taken.hasClass("taken")).toBe(true);
    expect(cardState(taken)).toBe("Taken by Bob");
    taken.click();
    expect(r.sent).toEqual([]);
    // The others stay open: taken options disappear for everyone, one by one.
    expect(r.cards().map((c) => c.disabled)).toEqual([false, true, false]);
    // A live update: someone takes another one.
    r.chests.set("c1", chest({ takenBy: ["eve", "bob", ""], pickers: ["bob", "eve"] }));
    r.frame();
    expect(r.cards().map((c) => c.disabled)).toEqual([true, true, false]);
    expect(cardState(r.cards()[0]!)).toBe("Taken by Eve");
  });

  it("a taker the room has no name for reads as another player", () => {
    const r = setup();
    r.chests.set("c1", chest({ takenBy: ["ghost", "", ""], pickers: ["ghost"] }));
    r.frame();
    expect(cardState(r.cards()[0]!)).toBe("Taken by another player");
  });

  it("says when nothing is left to take, and still lets the player skip", () => {
    const r = setup();
    r.chests.set("c1", chest({ takenBy: ["bob", "eve", "bob"], pickers: ["bob", "eve"] }));
    r.frame();
    expect(r.cards().every((c) => c.disabled)).toBe(true);
    expect(r.skip().disabled).toBe(false);
    expect(r.state()).toMatch(/Nothing left to take/);
  });

  it("does not rewrite the DOM for a frame that changes nothing", () => {
    const r = setup();
    r.frame(1000);
    const name = r.cards()[0]!.byClass("cp-name")[0]!;
    const writes = name.textWrites;
    const status = r.root.byClass("cp-status")[0]!;
    const statusWrites = status.textWrites;
    for (let i = 0; i < 10; i++) r.frame(1000 + i);
    expect(name.textWrites).toBe(writes);
    expect(status.textWrites).toBe(statusWrites);
  });
});

describe("picking by mouse", () => {
  it("a click on a card sends choose with the chest and the option index, nothing else", () => {
    const r = setup();
    r.frame();
    r.cards()[1]!.click();
    expect(r.sent).toEqual([{ chest: "c1", pick: 1 }]);
    expect(Object.keys(r.sent[0]!).sort()).toEqual(["chest", "pick"]);
    expect(r.panel.pickPending).toBe(true);
    expect(r.state()).toBe("Sending your pick...");
  });

  it("Skip sends pick -1", () => {
    const r = setup();
    r.frame();
    r.skip().click();
    expect(r.sent).toEqual([{ chest: "c1", pick: -1 }]);
  });

  it("while a pick is on its way, every card and Skip are shut, so a second click sends nothing", () => {
    const r = setup();
    r.frame();
    r.cards()[0]!.click();
    expect(r.cards().every((c) => c.disabled)).toBe(true);
    expect(r.skip().disabled).toBe(true);
    r.cards()[1]!.click();
    r.skip().click();
    expect(r.sent).toHaveLength(1);
  });

  it("a mouse click hands the keyboard back at once; Enter on a focused card leaves it where it was", () => {
    const r = setup();
    r.frame();
    const card = r.cards()[0]!;
    card.focus();
    expect(r.panel.focused).toBe(true);
    card.dispatch("click", { detail: 0 });
    expect(r.panel.focused).toBe(true);
    // A refusal puts the pick back on offer; then a real click.
    r.panel.noteToast("Already taken");
    r.frame();
    card.dispatch("click", { detail: 1 });
    expect(r.panel.focused).toBe(false);
  });

  it("never sends while the socket is reconnecting, and says so", () => {
    const r = setup();
    r.clock.sending = false;
    r.frame();
    r.cards()[0]!.click();
    r.skip().click();
    expect(r.sent).toEqual([]);
    expect(r.panel.pickPending).toBe(false);
    expect(r.state()).toBe(RECONNECTING_SAY);
    r.clock.sending = true;
    r.cards()[0]!.click();
    expect(r.sent).toHaveLength(1);
  });

  it("the right-click menu is not the browser's on a card or Skip", () => {
    const r = setup();
    r.frame();
    for (const b of [...r.cards(), r.skip()]) expect(b.dispatch("contextmenu").defaultPrevented).toBe(true);
  });
});

describe("one pick per player", () => {
  it("shows a taken option as the player's own, stops offering, and says what they took", () => {
    const r = setup();
    r.me.build = { whetstone: 1 };
    r.chests.set("c1", chest({ takenBy: ["", "me", ""], pickers: ["me"] }));
    r.frame();
    expect(r.state()).toBe("You took Whetstone.");
    expect(r.cards().every((c) => c.disabled)).toBe(true);
    expect(r.skip().disabled).toBe(true);
    const mine = r.cards()[1]!;
    expect(mine.hasClass("mine")).toBe(true);
    expect(cardState(mine)).toBe("You took this");
    expect(r.panel.pick(0)).toBe(false);
    expect(r.panel.skip()).toBe(false);
    r.skip().click();
    expect(r.sent).toEqual([]);
  });

  it("says rank 2 once the skill is held at rank 2", () => {
    const r = setup();
    r.me.build = { whetstone: 2 };
    r.chests.set("c1", chest({ takenBy: ["", "me", ""], pickers: ["me"] }));
    r.frame();
    expect(r.state()).toBe("You took Whetstone (rank 2).");
    expect(cardRank(r.cards()[1]!)).toBe("Rank 2");
  });

  it("a skip counts as the pick: the summary says so and nothing is offered", () => {
    const r = setup();
    r.chests.set("c1", chest({ pickers: ["me"] }));
    r.frame();
    expect(r.state()).toBe("You skipped this chest.");
    expect(r.cards().every((c) => c.disabled)).toBe(true);
    expect(r.skip().disabled).toBe(true);
  });

  it("closes after the summary has had its time, and does not come back for that chest", () => {
    const r = setup();
    r.chests.set("c1", chest({ takenBy: ["me", "", ""], pickers: ["me"] }));
    r.frame();
    expect(r.panel.isOpen).toBe(true);
    r.clock.now += PICKED_HOLD_MS - 1;
    r.frame();
    expect(r.panel.isOpen).toBe(true);
    r.clock.now += 1;
    r.frame();
    expect(r.panel.isOpen).toBe(false);
    r.clock.now += 5000;
    r.frame();
    expect(r.panel.isOpen).toBe(false);
    // A second chest is its own: the panel opens for it.
    r.chests.set("c2", chest({ x: 500, y: 520 }));
    r.frame();
    expect(r.panel.chestId).toBe("c2");
    // And once the first is gone from the state, nothing is held against its id.
    r.chests.delete("c1");
    r.chests.delete("c2");
    r.frame();
    r.chests.set("c1", chest());
    r.frame();
    expect(r.panel.chestId).toBe("c1");
  });
});

describe("a pick the server refused", () => {
  it("shows its toast in the status line, opens the cards again and clears the pick on its way", () => {
    const r = setup();
    r.frame();
    r.cards()[0]!.click();
    expect(r.panel.noteToast("Already taken")).toBe(true);
    expect(r.panel.pickPending).toBe(false);
    expect(r.state()).toBe("Already taken.");
    r.chests.set("c1", chest({ takenBy: ["bob", "", ""], pickers: ["bob"] }));
    r.frame();
    expect(r.cards().map((c) => c.disabled)).toEqual([true, false, false]);
    r.cards()[1]!.click();
    expect(r.sent).toEqual([{ chest: "c1", pick: 0 }, { chest: "c1", pick: 1 }]);
  });

  it("takes a toast only while a pick waits (an F pickup's refusal is not its business)", () => {
    const r = setup();
    r.frame();
    expect(r.panel.noteToast("Too far away")).toBe(false);
    expect(r.state()).toMatch(/One pick per chest/);
  });

  it("lets the refusal go after a while", () => {
    const r = setup();
    r.frame();
    r.cards()[0]!.click();
    r.panel.noteToast("Can't reach that");
    r.frame();
    expect(r.state()).toBe("Can't reach that.");
    r.clock.now += REFUSED_HOLD_MS;
    r.frame();
    expect(r.state()).toMatch(/One pick per chest/);
  });

  it("lets go of a pick the server never answered, and says it was not confirmed", () => {
    const r = setup();
    r.frame();
    r.cards()[0]!.click();
    r.clock.now += PENDING_EXPIRE_MS - 1;
    r.frame();
    expect(r.panel.pickPending).toBe(true);
    r.clock.now += 1;
    r.frame();
    expect(r.panel.pickPending).toBe(false);
    expect(r.state()).toBe(NOT_CONFIRMED_SAY);
    expect(r.cards().every((c) => !c.disabled)).toBe(true);
  });

  it("a pick that went through clears the wait with no refusal", () => {
    const r = setup();
    r.frame();
    r.cards()[0]!.click();
    r.chests.set("c1", chest({ takenBy: ["me", "", ""], pickers: ["me"] }));
    r.frame();
    expect(r.panel.pickPending).toBe(false);
    expect(r.state()).toBe("You took Pestilence.");
  });
});

describe("greying at expiry", () => {
  it("greys every option, and Skip, at expiresAt - (RTT/2 + the margin) in the server's own time", () => {
    const r = setup();
    r.clock.rtt = 100;
    // The panel reads the server at the estimate + RTT/2: it greys when that reaches 15 000 - (50 + 50).
    const greyAtEstimate = 15_000 - 100 - CHEST_GREY_MS;
    r.frame(greyAtEstimate - 1);
    expect(r.cards().every((c) => !c.disabled)).toBe(true);
    expect(r.skip().disabled).toBe(false);
    r.frame(greyAtEstimate);
    expect(r.cards().every((c) => c.disabled && c.hasClass("greyed"))).toBe(true);
    expect(r.skip().disabled).toBe(true);
    expect(r.state()).toBe("This chest is about to vanish.");
    r.cards()[0]!.click();
    r.skip().click();
    expect(r.sent).toEqual([]);
  });

  it("a longer round trip greys it sooner", () => {
    const slow = setup();
    slow.clock.rtt = 400;
    slow.frame(15_000 - 400 - CHEST_GREY_MS);
    expect(slow.cards().every((c) => c.disabled)).toBe(true);
    const fast = setup();
    fast.clock.rtt = 20;
    fast.frame(15_000 - 400 - CHEST_GREY_MS);
    expect(fast.cards().every((c) => !c.disabled)).toBe(true);
  });

  it("an unknown round trip is a default one, not NaN", () => {
    const r = setup();
    r.clock.rtt = Number.NaN;
    r.frame(1000);
    expect(r.panel.isOpen).toBe(true);
    expect(r.text("cp-timer")).toBe("0:14");
  });

  it("a key press at that moment sends nothing either", () => {
    const r = setup();
    r.frame(15_000 - 100 - CHEST_GREY_MS);
    r.panel.focus();
    r.win.press({ code: "Digit1" });
    r.win.press({ code: "Digit0" });
    expect(r.sent).toEqual([]);
  });
});

describe("the keyboard", () => {
  it("C takes the keyboard while the panel is up, and C or Esc give it back", () => {
    const r = setup();
    r.frame();
    expect(r.panel.focused).toBe(false);
    const c = r.win.press({ code: "KeyC" });
    expect(c.defaultPrevented).toBe(true);
    expect(r.panel.focused).toBe(true);
    expect(r.root.classes.has("focused")).toBe(true);
    r.win.press({ code: "KeyC" });
    expect(r.panel.focused).toBe(false);
    expect(r.root.classes.has("focused")).toBe(false);
    r.win.press({ code: "KeyC" });
    expect(r.panel.focused).toBe(true);
    const esc = r.win.press({ code: "Escape" });
    expect(esc.propagationStopped).toBe(true);
    expect(r.panel.focused).toBe(false);
  });

  it("1 2 3 pick the cards and 0 skips, on the number row and the numpad, while the panel has the keyboard", () => {
    for (const [code, want] of [
      ["Digit1", { chest: "c1", pick: 0 }], ["Digit2", { chest: "c1", pick: 1 }], ["Digit3", { chest: "c1", pick: 2 }],
      ["Numpad2", { chest: "c1", pick: 1 }], ["Digit0", { chest: "c1", pick: -1 }], ["Numpad0", { chest: "c1", pick: -1 }],
    ] as const) {
      const r = setup();
      r.frame();
      r.win.press({ code: "KeyC" });
      const e = r.win.press({ code });
      expect(r.sent, code).toEqual([want]);
      expect(e.defaultPrevented, code).toBe(true);
      expect(e.propagationStopped, code).toBe(true);
      vi.unstubAllGlobals();
    }
  });

  it("the digits belong to the weapon slots until C: nothing is taken, nothing is stopped", () => {
    const r = setup();
    r.frame();
    const scene: string[] = [];
    r.win.addEventListener("keydown", (e: { code: string }) => scene.push(e.code));
    for (const code of ["Digit1", "Digit2", "Digit3", "Digit0", "Escape", "KeyQ", "KeyS", "KeyF"]) {
      const e = r.win.press({ code });
      expect(e.defaultPrevented, code).toBe(false);
      expect(e.propagationStopped, code).toBe(false);
    }
    expect(scene).toEqual(["Digit1", "Digit2", "Digit3", "Digit0", "Escape", "KeyQ", "KeyS", "KeyF"]);
    expect(r.sent).toEqual([]);
  });

  it("while it has the keyboard it keeps only its own keys: the others still reach the scene", () => {
    const r = setup();
    r.frame();
    r.win.press({ code: "KeyC" });
    const scene: string[] = [];
    r.win.addEventListener("keydown", (e: { code: string }) => scene.push(e.code));
    for (const code of ["KeyQ", "KeyS", "KeyF", "Digit4", "Digit9", "KeyW"]) {
      const e = r.win.press({ code });
      expect(e.propagationStopped, code).toBe(false);
    }
    expect(scene).toEqual(["KeyQ", "KeyS", "KeyF", "Digit4", "Digit9", "KeyW"]);
    // Its own never reach it.
    r.win.press({ code: "Digit2" });
    r.win.press({ code: "Escape" });
    expect(scene).toHaveLength(6);
  });

  it("does nothing while the panel is closed: C and Esc are the scene's", () => {
    const r = setup({ chests: [] });
    r.frame();
    for (const code of ["KeyC", "Digit1", "Escape"]) {
      const e = r.win.press({ code });
      expect(e.defaultPrevented, code).toBe(false);
      expect(e.propagationStopped, code).toBe(false);
    }
    expect(r.panel.focus()).toBe(false);
  });

  it("ignores C while one of the page's dialogs has the focus (the help card, the settings card), and while typing", () => {
    const r = setup();
    r.frame();
    const card = fake(r.doc.createElement("div"));
    // A real DOM answers closest(); the fake DOM of these tests does not, so this one says it is inside a dialog.
    (card as unknown as { closest(s: string): unknown }).closest = (s) => (s === '[role="dialog"]' ? {} : null);
    card.focus();
    expect(r.win.press({ code: "KeyC" }).defaultPrevented).toBe(false);
    expect(r.panel.focused).toBe(false);
    const field = fake(r.doc.createElement("input"));
    field.type = "text";
    field.focus();
    expect(r.win.press({ code: "KeyC", target: field }).defaultPrevented).toBe(false);
    r.doc.activeElement = r.doc.body;
    expect(r.win.press({ code: "KeyC" }).defaultPrevented).toBe(true);
  });

  it("a button left focused by an earlier click does not take C away: the key moves the focus to the panel", () => {
    const r = setup();
    r.frame();
    const other = fake(r.doc.createElement("button"));
    other.focus();
    expect(r.win.press({ code: "KeyC" }).defaultPrevented).toBe(true);
    expect(r.panel.focused).toBe(true);
    r.win.press({ code: "KeyC" });
    expect(r.panel.focused).toBe(false);
  });

  it("takes no key with a modifier or a repeat", () => {
    const r = setup();
    r.frame();
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }]) {
      expect(r.win.press({ code: "KeyC", ...init }).defaultPrevented, JSON.stringify(init)).toBe(false);
    }
    r.win.press({ code: "KeyC" });
    r.win.press({ code: "Digit1", repeat: true });
    r.win.press({ code: "Digit1", ctrlKey: true });
    expect(r.sent).toEqual([]);
  });

  it("closing the panel gives the keyboard back", () => {
    const r = setup();
    r.frame();
    r.win.press({ code: "KeyC" });
    expect(r.panel.focused).toBe(true);
    r.me.x = 5000;
    r.frame();
    expect(r.panel.isOpen).toBe(false);
    expect(r.panel.focused).toBe(false);
    expect(r.doc.activeElement).toBe(r.doc.body);
  });

  it("says why a key did nothing, and still keeps the digit from swapping the weapon", () => {
    const r = setup();
    r.chests.set("c1", chest({ takenBy: ["bob", "", ""], pickers: ["bob"] }));
    r.frame();
    r.panel.focus();
    const e = r.win.press({ code: "Digit1" });
    expect(e.propagationStopped).toBe(true);
    expect(r.sent).toEqual([]);
    expect(r.state()).toBe("Option 1 is not available.");
    r.win.press({ code: "Digit2" });
    expect(r.sent).toEqual([{ chest: "c1", pick: 1 }]);
  });

  it("the focus keys are what chestKeyAction says (a table)", () => {
    const f = { focused: true, foreign: false, shift: false };
    expect(chestKeyAction("KeyC", { ...f, focused: false })).toEqual({ kind: "toggle" });
    expect(chestKeyAction("KeyC", f)).toEqual({ kind: "toggle" });
    expect(chestKeyAction("KeyC", { ...f, foreign: true })).toBeNull();
    expect(chestKeyAction("KeyC", { ...f, shift: true })).toBeNull();
    expect(chestKeyAction("Escape", f)).toEqual({ kind: "leave" });
    expect(chestKeyAction("Escape", { ...f, focused: false })).toBeNull();
    expect(chestKeyAction("Digit1", { ...f, focused: false })).toBeNull();
    for (let n = 1; n <= CHEST_OPTIONS; n++) expect(chestKeyAction(`Digit${n}`, f)).toEqual({ kind: "pick", index: n - 1 });
    expect(chestKeyAction("Numpad3", f)).toEqual({ kind: "pick", index: 2 });
    expect(chestKeyAction("Digit0", f)).toEqual({ kind: "skip" });
    expect(chestKeyAction("Digit4", f)).toBeNull();
    expect(chestKeyAction("KeyA", f)).toBeNull();
  });
});

describe("settings", () => {
  it("follows the text size", () => {
    const r = setup();
    expect(r.root.style.props["--cp-text"]).toBe("1");
    r.store.update({ textScale: 1.5 });
    expect(r.root.style.props["--cp-text"]).toBe("1.5");
    r.store.update({ textScale: 1.25 });
    expect(r.root.style.props["--cp-text"]).toBe("1.25");
  });

  it("stops listening when destroyed: no key, no setting", () => {
    const r = setup();
    r.frame();
    r.panel.destroy();
    expect(r.root.removed).toBe(true);
    expect(r.win.keydownListeners).toBe(0);
    r.store.update({ textScale: 1.5 });
    expect(r.root.style.props["--cp-text"]).toBe("1");
    expect(r.win.press({ code: "KeyC" }).defaultPrevented).toBe(false);
  });
});
