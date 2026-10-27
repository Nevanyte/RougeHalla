// The training room's practice console (ui/trainingConsole.ts, mounted by ui/trainingBar.ts): what it lists, the `train` messages its
// buttons send, how it hands the keyboard back to the game, and that a bar without a way to send has none. Run over the small DOM of
// test/uiDom.ts: a button is clicked with `fire`, a select is "chosen" by assigning its value and firing its change.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buffText, MOB_TYPES, REGION_FACTIONS, skillLive, skillText, SKILLS, TRAIN_DEFAULT_RANK, TRAIN_DEFAULT_STACKS, TRAIN_MAX_STACKS,
  TRAIN_STACK_CHOICES, type TrainMessage,
} from "@raid/shared";
import { zoneLabel } from "../src/ui/buffTip";
import { TrainingBar } from "../src/ui/trainingBar";
import {
  buffHint, mobTypeGroups, mobTypeLabel, passiveHint, skillGroups, skillLabel, TrainingConsole, trainMessages,
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
function mount(faction?: string): { console: TrainingConsole; sent: TrainMessage[]; root: UiEl; opened: boolean[] } {
  const sent: TrainMessage[] = [];
  const opened: boolean[] = [];
  const c = new TrainingConsole((m) => sent.push(m), { faction: () => faction, onToggle: (o) => opened.push(o) });
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

  it("lists the 21 passives by pool: the five zones, then the neutrals, each once", () => {
    const groups = skillGroups();
    expect(groups.map((g) => g.label)).toEqual([...REGION_FACTIONS.map(zoneLabel), "Neutral"]);
    const ids = groups.flatMap((g) => g.items.map((s) => s.id));
    expect(ids).toHaveLength(21);
    expect(new Set(ids).size).toBe(21);
    expect([...ids].sort()).toEqual(SKILLS.map((s) => s.id).sort());
    const firebrand = SKILLS.find((s) => s.id === "firebrand")!;
    const whetstone = SKILLS.find((s) => s.id === "whetstone")!;
    expect(skillLive(firebrand)).toBe(false);
    expect(skillLabel(firebrand)).toBe("Firebrand (not live)");
    expect(skillLabel(whetstone)).toBe("Whetstone");
  });

  it("words a buff from buffText, and says so when the server does not apply it yet", () => {
    expect(buffHint("emberImp", 3)).toBe(`Ember Imp (${zoneLabel("fire")}) 3 stacks: ${buffText("emberImp", 3)}.`);
    expect(buffHint("emberImp", 1)).toContain("1 stack:");
    expect(buffHint("wyrmling", 6)).toContain("elite,");
    expect(buffHint("chainWarden", 3)).toMatch(/Not applied yet/);
    expect(buffHint("emberImp", 0)).toMatch(/taken off/);
    expect(buffHint("nope", 3)).toBe("");
  });

  it("words a passive from skillText for the player's faction, and says when it is set but does nothing", () => {
    expect(passiveHint("whetstone", 2)).toBe(`Whetstone (Neutral) rank 2: ${skillText("whetstone", 2)}.`);
    expect(passiveHint("pestilence", 1, "plague")).toContain("Execute starts at 60% HP");
    expect(passiveHint("pestilence", 1, "fire")).toContain("+8% damage to targets below 60% HP");
    expect(passiveHint("firebrand", 1, "fire")).toMatch(/Not live yet: it is set but does nothing/);
    expect(passiveHint("whetstone", 0)).toMatch(/taken off/);
    expect(passiveHint("nope", 1)).toBe("");
  });

  it("the stack and rank choices are the shared ones plus Remove", () => {
    const { root } = mount();
    const stacks = root.byClass("train-stacks")!;
    const values = [...stacks.walk()].filter((n) => n.tag === "option").map(valueOf);
    expect(values).toEqual([...TRAIN_STACK_CHOICES.map(String), "0"]);
    expect(Math.max(...TRAIN_STACK_CHOICES)).toBe(TRAIN_MAX_STACKS);
    const ranks = [...root.byClass("train-rank")!.walk()].filter((n) => n.tag === "option").map(valueOf);
    expect(ranks).toEqual(["1", "2", "0"]);
  });
});

describe("the pickers", () => {
  it("the mob type picker holds the 20 types in five zone groups, each with its buff for a tooltip", () => {
    const { root } = mount();
    const select = root.byClass("train-mob")!;
    const groups = select.children.filter((c): c is UiEl => typeof c !== "string");
    expect(groups.map((g) => g.tag)).toEqual(Array(5).fill("optgroup"));
    expect(groups.map((g) => (g as unknown as { label: string }).label)).toEqual(REGION_FACTIONS.map(zoneLabel));
    const options = [...select.walk()].filter((n) => n.tag === "option");
    expect(options.map(valueOf)).toEqual(MOB_TYPES.map((t) => t.id));
    expect(options.map((o) => o.text)).toEqual(MOB_TYPES.map(mobTypeLabel));
    for (const [i, o] of options.entries()) {
      expect((o as unknown as { title: string }).title).toBe(buffHint(MOB_TYPES[i]!.id, TRAIN_DEFAULT_STACKS));
      expect((o as unknown as { title: string }).title).toContain(buffText(MOB_TYPES[i]!.id, TRAIN_DEFAULT_STACKS));
    }
    expect(select.getAttribute("aria-label")).toBe("Mob type");
  });

  it("the passive picker holds the 21 passives in six groups, with skillText for a tooltip and the not live ones marked", () => {
    const { root } = mount("holy");
    const select = root.byClass("train-skill")!;
    const groups = select.children.filter((c): c is UiEl => typeof c !== "string");
    expect(groups).toHaveLength(6);
    const options = [...select.walk()].filter((n) => n.tag === "option");
    expect(options).toHaveLength(21);
    expect(options.map((o) => o.text)).toEqual(skillGroups().flatMap((g) => g.items.map(skillLabel)));
    const lastRites = options.find((o) => valueOf(o) === "lastRites")!;
    expect((lastRites as unknown as { title: string }).title).toBe(passiveHint("lastRites", 1, "holy"));
    expect((lastRites as unknown as { title: string }).title).toContain(skillText("lastRites", 1, "holy"));
    expect(options.filter((o) => o.text.endsWith("(not live)")).map(valueOf).sort()).toEqual(
      SKILLS.filter((s) => !skillLive(s)).map((s) => s.id).sort(),
    );
  });

  it("every control has a name for a screen reader, and the panel and its toggle are tied together", () => {
    const { root } = mount();
    for (const cls of ["train-mob", "train-stacks", "train-skill", "train-rank"]) expect(root.byClass(cls)!.getAttribute("aria-label"), cls).toBeTruthy();
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
  it("Set buff sends the picked mob type and stack count", () => {
    const { root, sent } = mount();
    mouseClick(btn(root, "buff"));
    expect(sent).toEqual([{ cmd: "buff", id: MOB_TYPES[0]!.id, amount: TRAIN_DEFAULT_STACKS }]); // what the pickers say before anyone touches them
    choose(root.byClass("train-mob")!, "bailiff");
    choose(root.byClass("train-stacks")!, "6");
    mouseClick(btn(root, "buff"));
    choose(root.byClass("train-stacks")!, "0");
    mouseClick(btn(root, "buff"));
    expect(sent.slice(1)).toEqual([{ cmd: "buff", id: "bailiff", amount: 6 }, { cmd: "buff", id: "bailiff", amount: 0 }]);
  });

  it("Spawn camp sends the picked mob type, an elite's too", () => {
    const { root, sent } = mount();
    choose(root.byClass("train-mob")!, "rotMonk");
    mouseClick(btn(root, "camp"));
    choose(root.byClass("train-mob")!, "wyrmling");
    mouseClick(btn(root, "camp"));
    expect(sent).toEqual([{ cmd: "camp", id: "rotMonk" }, { cmd: "camp", id: "wyrmling" }]);
  });

  it("Set passive sends the picked skill and rank, 0 for Remove", () => {
    const { root, sent } = mount();
    mouseClick(btn(root, "passive"));
    expect(sent).toEqual([{ cmd: "passive", id: SKILLS.find(skillLive)!.id, rank: TRAIN_DEFAULT_RANK }]); // the first live one
    choose(root.byClass("train-skill")!, "thickHide");
    choose(root.byClass("train-rank")!, "2");
    mouseClick(btn(root, "passive"));
    choose(root.byClass("train-rank")!, "0");
    mouseClick(btn(root, "passive"));
    expect(sent.slice(1)).toEqual([{ cmd: "passive", id: "thickHide", rank: 2 }, { cmd: "passive", id: "thickHide", rank: 0 }]);
  });

  it("the chest buttons send the picked passive as the only option, or nothing for the server's random three; Clear all sends clear", () => {
    const { root, sent } = mount();
    choose(root.byClass("train-skill")!, "witness");
    mouseClick(btn(root, "chest-pick"));
    mouseClick(btn(root, "chest-random"));
    mouseClick(btn(root, "clear"));
    expect(sent).toEqual([{ cmd: "chest", options: ["witness"] }, { cmd: "chest" }, { cmd: "clear" }]);
    expect("options" in sent[1]!).toBe(false);
  });

  it("every message it can send is one the server's `train` accepts: a known command with known ids, ranks and amounts", () => {
    const { root, sent } = mount();
    const skills = [...root.byClass("train-skill")!.walk()].filter((n) => n.tag === "option").map(valueOf);
    for (const id of MOB_TYPES.map((t) => t.id)) {
      choose(root.byClass("train-mob")!, id);
      for (const n of [...TRAIN_STACK_CHOICES, 0]) { choose(root.byClass("train-stacks")!, String(n)); mouseClick(btn(root, "buff")); }
      mouseClick(btn(root, "camp"));
    }
    for (const id of skills) {
      choose(root.byClass("train-skill")!, id);
      for (const r of [0, 1, 2]) { choose(root.byClass("train-rank")!, String(r)); mouseClick(btn(root, "passive")); }
      mouseClick(btn(root, "chest-pick"));
    }
    const ids = new Set(MOB_TYPES.map((t) => t.id));
    const skillIds = new Set(SKILLS.map((s) => s.id));
    for (const m of sent) {
      if (m.cmd === "buff") { expect(ids.has(m.id as never)).toBe(true); expect(m.amount).toBeGreaterThanOrEqual(0); expect(m.amount).toBeLessThanOrEqual(TRAIN_MAX_STACKS); }
      else if (m.cmd === "camp") expect(ids.has(m.id as never)).toBe(true);
      else if (m.cmd === "passive") { expect(skillIds.has(m.id as never)).toBe(true); expect([0, 1, 2]).toContain(m.rank); }
      else if (m.cmd === "chest") { expect(m.options).toHaveLength(1); expect(skillIds.has(m.options![0] as never)).toBe(true); }
    }
    expect(sent.length).toBe(20 * (TRAIN_STACK_CHOICES.length + 2) + 21 * 4);
  });

  it("the message builders are the one place that makes the shapes", () => {
    expect(trainMessages.buff("emberImp", 3)).toEqual({ cmd: "buff", id: "emberImp", amount: 3 });
    expect(trainMessages.passive("whetstone", 1)).toEqual({ cmd: "passive", id: "whetstone", rank: 1 });
    expect(trainMessages.camp("wyrmling")).toEqual({ cmd: "camp", id: "wyrmling" });
    expect(trainMessages.chest()).toEqual({ cmd: "chest" });
    expect(trainMessages.chest([])).toEqual({ cmd: "chest" });
    expect(trainMessages.chest(["a", "b"])).toEqual({ cmd: "chest", options: ["a", "b"] });
    expect(trainMessages.clear()).toEqual({ cmd: "clear" });
  });
});

describe("the hint lines", () => {
  it("say what is picked now, and follow every change of a select, for the faction asked for", () => {
    const { root } = mount("plague");
    const buffLine = root.byClass("train-hint-buff")!;
    const skillLine = root.byClass("train-hint-skill")!;
    expect(buffLine.text).toBe(buffHint(MOB_TYPES[0]!.id, TRAIN_DEFAULT_STACKS));
    choose(root.byClass("train-mob")!, "chainWarden");
    expect(buffLine.text).toBe(buffHint("chainWarden", TRAIN_DEFAULT_STACKS));
    expect(buffLine.text).toMatch(/Not applied yet/);
    choose(root.byClass("train-stacks")!, "12");
    expect(buffLine.text).toBe(buffHint("chainWarden", 12));
    choose(root.byClass("train-skill")!, "pestilence");
    choose(root.byClass("train-rank")!, "2");
    expect(skillLine.text).toContain("Execute starts at 70% HP");
    // The select repeats the line as its tooltip.
    expect((root.byClass("train-skill") as unknown as { title: string }).title).toBe(skillLine.text);
    expect((root.byClass("train-mob") as unknown as { title: string }).title).toBe(buffLine.text);
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

  it("words the passives for the faction the bar is told of", () => {
    bar({ send: () => {}, faction: () => "plague" });
    choose(ui.byClass("train-skill")!, "pestilence");
    expect(ui.byClass("train-hint-skill")!.text).toContain("Execute starts at 60% HP");
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
