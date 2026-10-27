// The training room's practice console (ui/trainingConsole.ts, mounted by ui/trainingBar.ts): what it lists, the `train` messages its
// buttons send, how it hands the keyboard back to the game, and that a bar without a way to send has none. Run over the small DOM of
// test/uiDom.ts: a button is clicked with `fire`, a select is "chosen" by assigning its value and firing its change.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CARDS, MOB_TYPES, REGION_FACTIONS, TRAIN_CARD_COUNT_CHOICES, TRAIN_DEFAULT_CARD_COUNT, TRAIN_MAX_CARD_COUNT, cardLive, type TrainMessage,
} from "@raid/shared";
import { TrainingBar } from "../src/ui/trainingBar";
import {
  cardGroups, cardHint, cardLabel, mobTypeGroups, mobTypeLabel, TrainingConsole, trainMessages, zoneLabel,
} from "../src/ui/trainingConsole";
import { installUiDom, type UiEl } from "./uiDom";

type Handler = (event: object) => void;
const handlersOf = (node: UiEl, type: string): Handler[] => (node as unknown as { handlers: Map<string, Handler[]> }).handlers.get(type) ?? [];
function fire(node: UiEl, type: string, event: object = {}): void {
  for (const h of handlersOf(node, type)) h({ type, ...event });
}
/** A mouse click: `detail` is above 0 for a pointer, 0 for the keyboard. */
const mouseClick = (node: UiEl): void => fire(node, "click", { detail: 1 });
const keyClick = (node: UiEl): void => fire(node, "click", { detail: 0 });

const valueOf = (node: UiEl): string => (node as unknown as { value: string }).value;
function choose(node: UiEl, value: string): void {
  (node as unknown as { value: string }).value = value;
  fire(node, "change");
}

let ui: UiEl;
beforeEach(() => { ({ ui } = installUiDom()); });
afterEach(() => { vi.unstubAllGlobals(); });

/** A console in the page (the bar around it is TrainingBar's business, below) and the messages it sends. */
function mount(): { console: TrainingConsole; sent: TrainMessage[]; root: UiEl; opened: boolean[] } {
  const sent: TrainMessage[] = [];
  const opened: boolean[] = [];
  const c = new TrainingConsole((m) => sent.push(m), { onToggle: (o) => opened.push(o) });
  ui.append(c.root as unknown as UiEl);
  return { console: c, sent, root: c.root as unknown as UiEl, opened };
}

const btn = (root: UiEl, name: string): UiEl => root.byClass(`train-btn-${name}`)!;

describe("what the console offers", () => {
  it("lists the 20 mob types by zone, in zone order, each zone's three normals and then its elite", () => {
    const groups = mobTypeGroups();
    expect(groups.map((g) => g.label)).toEqual(REGION_FACTIONS.map(zoneLabel));
    expect(groups.map((g) => g.items.length)).toEqual([4, 4, 4, 4, 4]);
    expect(groups.flatMap((g) => g.items.map((t) => t.id))).toEqual(MOB_TYPES.map((t) => t.id));
    for (const g of groups) expect(g.items.map((t) => t.elite)).toEqual([false, false, false, true]);
    expect(mobTypeLabel(MOB_TYPES[3]!)).toBe("Wyrmling (elite)");
    expect(mobTypeLabel(MOB_TYPES[0]!)).toBe("Ember Imp");
  });

  it("lists the 75 cards by kind: the 24 base cards, the 11 conditionals, the 40 augments, each once, in catalog order", () => {
    const groups = cardGroups();
    expect(groups.map((g) => g.label)).toEqual(["Base cards", "Conditional cards", "Augments"]);
    expect(groups.map((g) => g.items.length)).toEqual([24, 11, 40]);
    const ids = groups.flatMap((g) => g.items.map((c) => c.id));
    expect(ids).toHaveLength(75);
    expect(new Set(ids).size).toBe(75);
    expect(ids).toEqual(CARDS.map((c) => c.id));
    expect(groups.map((g) => g.items.every((c) => c.kind === (g.label === "Base cards" ? "base" : g.label === "Augments" ? "augment" : "conditional")))).toEqual([true, true, true]);
  });

  it("marks a card the server does not apply yet, and no other", () => {
    const rhythm = CARDS.find((c) => c.id === "rhythm")!;
    const haste = CARDS.find((c) => c.id === "haste2")!;
    expect(cardLive(rhythm)).toBe(false);
    expect(cardLabel(rhythm)).toBe("Rhythm (not live yet)");
    expect(cardLabel(haste)).toBe("Haste II");
    expect(CARDS.filter((c) => cardLabel(c).endsWith("(not live yet)")).map((c) => c.id)).toEqual(CARDS.filter((c) => !cardLive(c)).map((c) => c.id));
  });

  it("words a card from its own text, the copies held, what a conditional needs, and says when the server does not apply it yet", () => {
    expect(cardHint("haste2", 1)).toBe("Haste II (Base, tier II) +16% attack speed.");
    expect(cardHint("haste2", 3)).toBe("Haste II (Base, tier II) +16% attack speed. Held x3.");
    expect(cardHint("wellspring", 3)).not.toContain("Held"); // a one-per-player card is held once
    expect(cardHint("bloodthirst", 1)).toContain("Needs a Leech card first.");
    expect(cardHint("rhythm", 1)).toMatch(/Not live yet: it is set but does nothing\.$/);
    expect(cardHint("haste2", 0)).toBe("Haste II (Base, tier II) taken off.");
    expect(cardHint("nope", 1)).toBe("");
  });

  it("the count choices are the shared ones plus Remove", () => {
    const { root } = mount();
    const values = [...root.byClass("train-count")!.walk()].filter((n) => n.tag === "option").map(valueOf);
    expect(values).toEqual([...TRAIN_CARD_COUNT_CHOICES.map(String), "0"]);
    expect(Math.max(...TRAIN_CARD_COUNT_CHOICES)).toBe(TRAIN_MAX_CARD_COUNT);
  });
});

describe("the pickers", () => {
  it("the mob type picker holds the 20 types in five zone groups, each with its name and zone for a tooltip", () => {
    const { root } = mount();
    const select = root.byClass("train-mob")!;
    const groups = select.children.filter((c): c is UiEl => typeof c !== "string");
    expect(groups.map((g) => g.tag)).toEqual(Array(5).fill("optgroup"));
    expect(groups.map((g) => (g as unknown as { label: string }).label)).toEqual(REGION_FACTIONS.map(zoneLabel));
    const options = [...select.walk()].filter((n) => n.tag === "option");
    expect(options.map(valueOf)).toEqual(MOB_TYPES.map((t) => t.id));
    expect(options.map((o) => o.text)).toEqual(MOB_TYPES.map(mobTypeLabel));
    for (const [i, o] of options.entries()) {
      expect((o as unknown as { title: string }).title).toBe(`${MOB_TYPES[i]!.name} (${zoneLabel(MOB_TYPES[i]!.zone)})`);
    }
    expect(select.getAttribute("aria-label")).toBe("Mob type");
  });

  it("the card picker holds the 75 cards in three kind groups, with the card's words for a tooltip and the not live ones marked", () => {
    const { root } = mount();
    const select = root.byClass("train-card")!;
    const groups = select.children.filter((c): c is UiEl => typeof c !== "string");
    expect(groups.map((g) => (g as unknown as { label: string }).label)).toEqual(["Base cards", "Conditional cards", "Augments"]);
    const options = [...select.walk()].filter((n) => n.tag === "option");
    expect(options).toHaveLength(75);
    expect(options.map(valueOf)).toEqual(CARDS.map((c) => c.id));
    expect(options.map((o) => o.text)).toEqual(CARDS.map(cardLabel));
    const hereComesTheBoom = options.find((o) => valueOf(o) === "hereComesTheBoom")!;
    expect((hereComesTheBoom as unknown as { title: string }).title).toBe(cardHint("hereComesTheBoom", 1));
    expect(options.filter((o) => o.text.endsWith("(not live yet)")).map(valueOf).sort()).toEqual(CARDS.filter((c) => !cardLive(c)).map((c) => c.id).sort());
    expect(valueOf(select)).toBe("ad1"); // the first live card
    expect(select.getAttribute("aria-label")).toBe("Card");
  });

  it("every control has a name for a screen reader, and the panel and its toggle are tied together", () => {
    const { root } = mount();
    for (const cls of ["train-mob", "train-card", "train-count"]) expect(root.byClass(cls)!.getAttribute("aria-label"), cls).toBeTruthy();
    const toggle = root.byClass("train-toggle")!;
    const panel = root.byClass("train-panel")!;
    expect(toggle.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("role")).toBe("group");
    expect(panel.getAttribute("aria-label")).toBe("Practice console");
    for (const b of root.allByClass("train-btn")) expect((b as unknown as { type: string }).type, b.text).toBe("button");
    for (const b of root.allByClass("train-btn")) expect((b as unknown as { title: string }).title, b.text).not.toBe("");
  });
});

describe("opening and closing", () => {
  it("is closed to begin with, and the toggle opens and closes it and says so", () => {
    const { root, console: c, opened } = mount();
    const toggle = root.byClass("train-toggle")!;
    const panel = root.byClass("train-panel")!;
    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.text).toBe("Console");
    keyClick(toggle);
    expect([panel.hidden, c.isOpen, toggle.getAttribute("aria-expanded"), opened]).toEqual([false, true, "true", [true]]);
    keyClick(toggle);
    expect([panel.hidden, c.isOpen, toggle.getAttribute("aria-expanded"), opened]).toEqual([true, false, "false", [true, false]]);
    c.setOpen(false); // already closed: nothing to report
    expect(opened).toEqual([true, false]);
  });
});

describe("the messages the buttons send", () => {
  it("Set card sends the picked card and copy count, 0 for Remove", () => {
    const { root, sent } = mount();
    mouseClick(btn(root, "card"));
    expect(sent).toEqual([{ cmd: "card", id: "ad1", count: TRAIN_DEFAULT_CARD_COUNT }]); // what the pickers say before anyone touches them
    choose(root.byClass("train-card")!, "haste2");
    choose(root.byClass("train-count")!, "3");
    mouseClick(btn(root, "card"));
    choose(root.byClass("train-count")!, "0");
    mouseClick(btn(root, "card"));
    expect(sent.slice(1)).toEqual([{ cmd: "card", id: "haste2", count: 3 }, { cmd: "card", id: "haste2", count: 0 }]);
  });

  it("a card that is held once is never sent with more than one copy (the server caps it the same way), but can still be removed", () => {
    const { root, sent } = mount();
    choose(root.byClass("train-card")!, "wellspring");
    choose(root.byClass("train-count")!, String(TRAIN_MAX_CARD_COUNT));
    mouseClick(btn(root, "card"));
    choose(root.byClass("train-count")!, "0");
    mouseClick(btn(root, "card"));
    expect(sent).toEqual([{ cmd: "card", id: "wellspring", count: 1 }, { cmd: "card", id: "wellspring", count: 0 }]);
  });

  it("Spawn camp sends the picked mob type, an elite's too", () => {
    const { root, sent } = mount();
    choose(root.byClass("train-mob")!, "rotMonk");
    mouseClick(btn(root, "camp"));
    choose(root.byClass("train-mob")!, "wyrmling");
    mouseClick(btn(root, "camp"));
    expect(sent).toEqual([{ cmd: "camp", id: "rotMonk" }, { cmd: "camp", id: "wyrmling" }]);
  });

  it("the chest buttons send the picked card as the only option, or nothing for the server's rolled three; Clear all sends clear", () => {
    const { root, sent } = mount();
    choose(root.byClass("train-card")!, "leech1");
    mouseClick(btn(root, "chest-pick"));
    mouseClick(btn(root, "chest-random"));
    mouseClick(btn(root, "clear"));
    expect(sent).toEqual([{ cmd: "chest", options: ["leech1"] }, { cmd: "chest" }, { cmd: "clear" }]);
    expect("options" in sent[1]!).toBe(false);
  });

  it("every message it can send is one the server's `train` accepts: a known command with known ids and counts", () => {
    const { root, sent } = mount();
    const cards = [...root.byClass("train-card")!.walk()].filter((n) => n.tag === "option").map(valueOf);
    for (const id of MOB_TYPES.map((t) => t.id)) {
      choose(root.byClass("train-mob")!, id);
      mouseClick(btn(root, "camp"));
    }
    for (const id of cards) {
      choose(root.byClass("train-card")!, id);
      for (const n of [...TRAIN_CARD_COUNT_CHOICES, 0]) { choose(root.byClass("train-count")!, String(n)); mouseClick(btn(root, "card")); }
      mouseClick(btn(root, "chest-pick"));
    }
    const mobs = new Set(MOB_TYPES.map((t) => t.id));
    const known = new Map(CARDS.map((c) => [c.id as string, c]));
    for (const m of sent) {
      if (m.cmd === "camp") expect(mobs.has(m.id as never)).toBe(true);
      else if (m.cmd === "card") {
        expect(known.has(m.id)).toBe(true);
        expect(m.count).toBeGreaterThanOrEqual(0);
        expect(m.count).toBeLessThanOrEqual(known.get(m.id)!.unique ? 1 : TRAIN_MAX_CARD_COUNT);
      } else if (m.cmd === "chest") { expect(m.options).toHaveLength(1); expect(known.has(m.options![0]!)).toBe(true); }
    }
    expect(sent.length).toBe(20 + 75 * (TRAIN_CARD_COUNT_CHOICES.length + 1 + 1));
  });

  it("the message builders are the one place that makes the shapes", () => {
    expect(trainMessages.card("haste2", 2)).toEqual({ cmd: "card", id: "haste2", count: 2 });
    expect(trainMessages.camp("wyrmling")).toEqual({ cmd: "camp", id: "wyrmling" });
    expect(trainMessages.chest()).toEqual({ cmd: "chest" });
    expect(trainMessages.chest([])).toEqual({ cmd: "chest" });
    expect(trainMessages.chest(["a", "b"])).toEqual({ cmd: "chest", options: ["a", "b"] });
    expect(trainMessages.clear()).toEqual({ cmd: "clear" });
  });
});

describe("the hint line", () => {
  it("says what is picked now, and follows every change of a select", () => {
    const { root } = mount();
    const line = root.byClass("train-hint-card")!;
    expect(line.text).toBe(cardHint("ad1", TRAIN_DEFAULT_CARD_COUNT));
    choose(root.byClass("train-card")!, "bloodthirst");
    expect(line.text).toBe(cardHint("bloodthirst", 1));
    expect(line.text).toContain("Needs a Leech card first.");
    choose(root.byClass("train-card")!, "haste3");
    choose(root.byClass("train-count")!, "9");
    expect(line.text).toBe(cardHint("haste3", 9));
    expect(line.text).toContain("Held x9.");
    // A card held once reads the same at any count the picker shows: the line says what will be sent.
    choose(root.byClass("train-card")!, "wellspring");
    expect(line.text).toBe(cardHint("wellspring", 1));
    // The selects repeat the line as their tooltip.
    expect((root.byClass("train-card") as unknown as { title: string }).title).toBe(line.text);
    expect((root.byClass("train-count") as unknown as { title: string }).title).toBe(line.text);
  });
});

describe("the keyboard", () => {
  it("handles Escape inside the panel (focus back to the game, and the scene's own Escape is not reached) and no other key", () => {
    const { root } = mount();
    const panel = root.byClass("train-panel")!;
    const blur = vi.fn();
    vi.stubGlobal("document", Object.assign(Object.create(null), (globalThis as { document: object }).document, { activeElement: { blur } }));
    const escape = { key: "Escape", code: "Escape", stopPropagation: vi.fn(), preventDefault: vi.fn() };
    fire(panel, "keydown", escape);
    expect(escape.stopPropagation).toHaveBeenCalledTimes(1);
    expect(blur).toHaveBeenCalledTimes(1);
    // The game's keys (movement, swap, stop, pickup, the number row, space, enter) are left alone: never stopped, never blurred.
    for (const code of ["KeyQ", "KeyS", "KeyF", "KeyC", "Digit1", "Digit2", "Space", "Enter", "Tab", "ArrowDown"]) {
      const ev = { key: code, code, stopPropagation: vi.fn(), preventDefault: vi.fn() };
      fire(panel, "keydown", ev);
      expect(ev.stopPropagation, code).not.toHaveBeenCalled();
      expect(ev.preventDefault, code).not.toHaveBeenCalled();
    }
    expect(blur).toHaveBeenCalledTimes(1);
  });

  it("listens for no key anywhere else: not on the toggle, the root or the buttons", () => {
    const { root } = mount();
    for (const node of [root, root.byClass("train-toggle")!, ...root.allByClass("train-btn")]) {
      expect(handlersOf(node, "keydown"), node.className).toEqual([]);
      expect(handlersOf(node, "keyup"), node.className).toEqual([]);
    }
  });

  it("a select the mouse just changed lets go of the focus; one changed with the arrow keys keeps it", () => {
    const { root } = mount();
    const select = root.byClass("train-mob")!;
    const blur = vi.fn();
    (select as unknown as { blur: () => void }).blur = blur;
    fire(select, "pointerdown");
    choose(select, "bailiff");
    expect(blur).toHaveBeenCalledTimes(1);
    // The next change, with no pointer going down first, stays on the control.
    choose(select, "inquisitor");
    expect(blur).toHaveBeenCalledTimes(1);
    // A pointer that went down and then a key (the user changed their mind about the mouse): the key wins.
    fire(select, "pointerdown");
    fire(select, "keydown", { key: "ArrowDown" });
    choose(select, "executioner");
    expect(blur).toHaveBeenCalledTimes(1);
  });

  it("a button clicked with the mouse lets go of the focus (so Space or Enter never fires it again); a keyboard activation keeps it", () => {
    const { root } = mount();
    const b = btn(root, "clear");
    const blur = vi.fn();
    (b as unknown as { blur: () => void }).blur = blur;
    mouseClick(b);
    expect(blur).toHaveBeenCalledTimes(1);
    keyClick(b);
    expect(blur).toHaveBeenCalledTimes(1);
  });
});

describe("in the training bar", () => {
  const bar = (opts: ConstructorParameters<typeof TrainingBar>[1]) => new TrainingBar(vi.fn(), opts);

  it("has no console without a way to send: the arena builds no bar at all, and a bar built bare has none either", () => {
    bar(undefined);
    expect(ui.byClass("train-console")).toBeUndefined();
    expect(ui.byClass("training-bar")).toBeDefined();
  });

  it("has the console between the tips and the leave button when it is given a way to send", () => {
    const sent: TrainMessage[] = [];
    bar({ send: (m) => sent.push(m) });
    const root = ui.byClass("training-bar")!;
    const parts = root.children.filter((c): c is UiEl => typeof c !== "string").map((c) => c.className);
    expect(parts).toEqual(["training-tips", "train-console", "btn training-leave"]);
    mouseClick(btn(ui, "clear"));
    expect(sent).toEqual([{ cmd: "clear" }]);
  });

  it("words the card it has picked in the bar's console", () => {
    bar({ send: () => {} });
    choose(ui.byClass("train-card")!, "pestilence");
    expect(ui.byClass("train-hint-card")!.text).toContain("Pestilence (Augment, tier II)");
  });

  it("hides the tips while the console is open and shows them again after, until their own time runs out", () => {
    const b = bar({ send: () => {} });
    const tips = ui.byClass("training-tips")!;
    b.update(0);
    expect(tips.hidden).toBe(false);
    keyClick(ui.byClass("train-toggle")!);
    expect(tips.hidden).toBe(true);
    b.update(100);
    expect(tips.hidden).toBe(true);
    keyClick(ui.byClass("train-toggle")!);
    expect(tips.hidden).toBe(false);
    // Closed after the tips' hold: they stay gone.
    keyClick(ui.byClass("train-toggle")!);
    b.update(30_000);
    keyClick(ui.byClass("train-toggle")!);
    expect(tips.hidden).toBe(true);
  });

  it("leaves training as it always did: the button fires once, and destroy takes the console away with the bar", () => {
    const onLeave = vi.fn();
    const b = new TrainingBar(onLeave, { send: () => {} });
    b.leave();
    b.leave();
    expect(onLeave).toHaveBeenCalledTimes(1);
    b.destroy();
    expect(ui.byClass("training-bar")).toBeUndefined();
    expect(ui.byClass("train-console")).toBeUndefined();
  });
});
