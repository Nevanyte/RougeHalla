// The quest dialog (ui/questDialog.ts) on the chrome tests' fake DOM: F at a giver opens it (the scene's key, tested through
// `open`), it shows the offer and Accept sends `questAccept` once, its keys (Enter or 1 accept, Esc or F close) are consumed only
// while it has the focus, and it closes by itself when the player walks out of reach, the offer closes, the run stops or the player
// is down. Time is a number the test moves.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QUEST_ACCEPT_RANGE, QUEST_REFUSAL, QUEST_REFUSALS, TILE, TILE_FLOOR, TILE_WALL, mapFromTiles, questDefById,
  type ClientMessages, type GameMap,
} from "@raid/shared";
import { SettingsStore } from "../src/settings";
import {
  ACCEPTED_HOLD_MS, ACCEPT_NOT_CONFIRMED_SAY, ACCEPT_PENDING_EXPIRE_MS, ACCEPT_RECONNECTING_SAY, ACCEPT_REFUSED_HOLD_MS,
  QUEST_DIALOG_CLICK_GUARD_MS, QuestDialog, type QuestDialogFrame, type QuestDialogMe,
} from "../src/ui/questDialog";
import { QUEST_DIALOG_CLOSE_RANGE, QUEST_DIALOG_HYSTERESIS, canTalk, questDialogKeyAction } from "../src/ui/questDialogMath";
import type { QuestStateLike } from "../src/ui/questModel";
import { fake, installChromeDom, type FEl, type FakeWindow } from "./chromeDom";

afterEach(() => { vi.unstubAllGlobals(); });

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
}

const GIVER = { x: 500, y: 500 };
const def = questDefById("cull-fire")!;

const offer = (over: Partial<QuestStateLike> = {}): QuestStateLike => ({
  id: "q1", def: def.id, x: GIVER.x, y: GIVER.y, status: "open", doneBy: "", expiresAt: 65_000, carrier: "",
  progress: new Map(), accepted: new Map(), ...over,
});

interface Rig {
  dialog: QuestDialog;
  win: FakeWindow;
  root: FEl;
  sent: Array<ClientMessages["questAccept"]>;
  quests: Map<string, QuestStateLike>;
  me: QuestDialogMe;
  clock: { now: number; sending: boolean };
  frame: (over?: Partial<QuestDialogFrame>) => void;
  text: (cls: string) => string;
  accept: () => FEl;
  closeButton: () => FEl;
  /** What a scene's own keydown listener (registered after the dialog's, in the bubbling phase) was shown. */
  scene: string[];
}

function setup(over: { map?: GameMap | null } = {}): Rig {
  const { win } = installChromeDom();
  const sent: Array<ClientMessages["questAccept"]> = [];
  const clock = { now: 1000, sending: true };
  const quests = new Map<string, QuestStateLike>([["q1", offer()]]);
  const me: QuestDialogMe = { id: "me", x: GIVER.x + 40, y: GIVER.y, alive: true };
  const dialog = new QuestDialog({
    send: (m) => { sent.push(m); },
    canSend: () => clock.sending,
    now: () => clock.now,
    settings: new SettingsStore(memoryStorage()),
  });
  const root = fake(dialog.element);
  const scene: string[] = [];
  win.addEventListener("keydown", (e: { code: string }) => scene.push(e.code));
  const sight = over.map === undefined ? null : over.map;
  const frame = (extra: Partial<QuestDialogFrame> = {}): void => {
    dialog.update({ active: true, serverNow: 5000, me, quests, sight, ...extra });
  };
  return {
    dialog, win, root, sent, quests, me, clock, frame, scene,
    text: (cls) => root.byClass(cls)[0]!.textContent,
    accept: () => root.byClass("qd-accept")[0]!,
    closeButton: () => root.byClass("qd-close")[0]!,
  };
}

/** The dialog open on q1 with a frame in hand, the way F at the giver leaves it. */
function opened(over: { map?: GameMap | null } = {}): Rig {
  const r = setup(over);
  r.frame();
  expect(r.dialog.open("q1")).toBe(true);
  return r;
}

const acceptedBy = (...ids: string[]): QuestStateLike => offer({ accepted: new Map(ids.map((id) => [id, true])) });

describe("opening", () => {
  it("is closed until F opens an offer in reach, and `open` needs a frame to judge by", () => {
    const r = setup();
    expect(r.dialog.open("q1")).toBe(false); // no frame yet
    r.frame();
    expect(r.dialog.isOpen).toBe(false);
    expect(r.root.hidden).toBe(true);
    expect(r.dialog.open("q1")).toBe(true);
    expect(r.dialog.isOpen).toBe(true);
    expect(r.dialog.questId).toBe("q1");
    expect(r.root.hidden).toBe(false);
  });

  it("refuses an offer the server would refuse a talk with: out of reach, behind a wall, down, not active, closed, unknown", () => {
    const r = setup();
    r.me.x = GIVER.x + QUEST_ACCEPT_RANGE + 1;
    r.frame();
    expect(r.dialog.open("q1"), "out of reach").toBe(false);
    r.me.x = GIVER.x + QUEST_ACCEPT_RANGE;
    r.frame();
    expect(r.dialog.open("q1"), "exactly in reach").toBe(true);
    r.dialog.close();

    r.me.x = GIVER.x + 40;
    r.me.alive = false;
    r.frame();
    expect(r.dialog.open("q1"), "down").toBe(false);
    r.me.alive = true;
    r.frame({ active: false });
    expect(r.dialog.open("q1"), "run not on").toBe(false);
    r.frame({ me: null });
    expect(r.dialog.open("q1"), "no player").toBe(false);
    r.quests.set("q1", offer({ status: "expired" }));
    r.frame();
    expect(r.dialog.open("q1"), "closed offer").toBe(false);
    r.quests.set("q1", offer());
    r.frame();
    expect(r.dialog.open("nope"), "unknown offer").toBe(false);
    expect(r.dialog.isOpen).toBe(false);

    const tiles = new Uint8Array(30 * 30).fill(TILE_FLOOR);
    for (let y = 0; y < 30; y++) tiles[y * 30 + 15] = TILE_WALL;
    const walls = mapFromTiles(30, 30, tiles);
    r.quests.set("q1", offer({ x: 16.5 * TILE, y: 10 * TILE }));
    r.me.x = 14.5 * TILE;
    r.me.y = 10 * TILE;
    r.frame({ sight: walls });
    expect(r.dialog.open("q1"), "behind a wall").toBe(false);
    r.frame({ sight: null });
    expect(r.dialog.open("q1"), "the same spot with no wall").toBe(true);
  });

  it("shows the offer: name, giver, kind, objective, reward (card and GV), time left and your progress", () => {
    const r = opened();
    expect(r.text("qd-title")).toBe(def.name);
    expect(r.text("qd-giver")).toBe(def.giver);
    expect(r.text("qd-kind")).toBe("kill");
    expect(r.text("qd-objective")).toBe("Kill 3 mobs in Fire");
    expect(r.text("qd-reward")).toBe("Reward: 10 Ember Imp stacks (+10% damage) and 10 GV");
    expect(r.text("qd-timer")).toBe("1:00");
    expect(r.text("qd-progress")).toMatch(/Not accepted yet/);
    expect(r.accept().hidden).toBe(false);
    expect(r.root.byClass("qd-badge")[0]!.hidden).toBe(true);
    r.frame({ serverNow: 35_000 });
    expect(r.text("qd-timer")).toBe("0:30");
  });

  it("is a region, never a dialog role: the page treats focus inside a [role=dialog] as a modal's, taking J and the like away", () => {
    const r = setup();
    expect(r.root.getAttribute("role")).toBe("region");
  });
});

describe("accepting", () => {
  it("sends `questAccept` once for the offer shown, and shows it as sending", () => {
    const r = opened();
    r.clock.now += 1000;
    r.accept().click();
    expect(r.sent).toEqual([{ quest: "q1" }]);
    expect(r.dialog.acceptPending).toBe(true);
    expect(r.text("qd-status")).toBe("Accepting...");
    expect(r.accept().disabled).toBe(true);
    r.accept().click();
    expect(r.sent).toHaveLength(1);
  });

  it("shows Accepted with your progress once the state lists the player, then closes after the hold", () => {
    const r = opened();
    r.clock.now += 1000;
    r.accept().click();
    r.quests.set("q1", acceptedBy("me"));
    r.quests.get("q1")!.progress = new Map([["me", 1]]);
    r.frame();
    expect(r.dialog.acceptPending).toBe(false);
    expect(r.accept().hidden).toBe(true);
    expect(r.root.byClass("qd-badge")[0]!.hidden).toBe(false);
    expect(r.root.byClass("qd-badge")[0]!.textContent).toBe("Accepted");
    expect(r.text("qd-progress")).toBe("Your progress 1 / 3");
    expect(r.text("qd-status")).toMatch(/counts from now/);
    r.clock.now += ACCEPTED_HOLD_MS - 1;
    r.frame();
    expect(r.dialog.isOpen).toBe(true);
    r.clock.now += 1;
    r.frame();
    expect(r.dialog.isOpen).toBe(false);
  });

  it("reopens an offer already accepted showing Accepted and the progress, and stays up", () => {
    const r = setup();
    r.quests.set("q1", acceptedBy("me"));
    r.quests.get("q1")!.progress = new Map([["me", 2]]);
    r.frame();
    expect(r.dialog.open("q1")).toBe(true);
    expect(r.accept().hidden).toBe(true);
    expect(r.root.byClass("qd-badge")[0]!.hidden).toBe(false);
    expect(r.text("qd-progress")).toBe("Your progress 2 / 3");
    r.clock.now += 60_000;
    r.frame();
    expect(r.dialog.isOpen).toBe(true);
    // Accepting is not offered again, by key either.
    r.win.press({ code: "Enter" });
    expect(r.sent).toEqual([]);
  });

  it("only another player's accept is not yours: the button stays", () => {
    const r = opened();
    r.quests.set("q1", acceptedBy("remote"));
    r.frame();
    expect(r.accept().hidden).toBe(false);
    expect(r.accept().disabled).toBe(false);
  });

  it("shows the server's refusal of a pending accept in the status line, and not any other toast", () => {
    const r = opened();
    expect(r.dialog.noteToast(QUEST_REFUSAL.far), "nothing pending").toBe(false);
    r.clock.now += 1000;
    r.accept().click();
    expect(r.dialog.noteToast("+5 GV (quest)")).toBe(false);
    expect(r.dialog.noteToast("Quest accepted: Cinder Cull")).toBe(false);
    expect(r.dialog.acceptPending).toBe(true);
    expect(r.dialog.noteToast(QUEST_REFUSAL.far)).toBe(true);
    expect(r.dialog.acceptPending).toBe(false);
    expect(r.text("qd-status")).toBe(QUEST_REFUSAL.far);
    expect(r.accept().disabled).toBe(false); // it may try again
    r.clock.now += ACCEPT_REFUSED_HOLD_MS;
    r.frame();
    expect(r.text("qd-status")).toMatch(/Accept it to start/);
    for (const text of QUEST_REFUSALS) {
      r.accept().click();
      expect(r.dialog.noteToast(text), text).toBe(true);
    }
  });

  it("lets go of an accept the server never answered, and says so", () => {
    const r = opened();
    r.clock.now += 1000;
    r.accept().click();
    r.clock.now += ACCEPT_PENDING_EXPIRE_MS;
    r.frame();
    expect(r.dialog.acceptPending).toBe(false);
    expect(r.text("qd-status")).toBe(ACCEPT_NOT_CONFIRMED_SAY);
  });

  it("does not send while the socket reconnects, and says so", () => {
    const r = opened();
    r.clock.now += 1000;
    r.clock.sending = false;
    r.accept().click();
    expect(r.sent).toEqual([]);
    expect(r.dialog.acceptPending).toBe(false);
    expect(r.text("qd-status")).toBe(ACCEPT_RECONNECTING_SAY);
  });

  it("ignores a mouse click in its first moments (meant for the canvas), and takes a keyboard activation (detail 0) at once", () => {
    const r = opened();
    r.clock.now += QUEST_DIALOG_CLICK_GUARD_MS - 1;
    r.accept().dispatch("click", { detail: 1 });
    expect(r.sent).toEqual([]);
    r.clock.now += 1;
    r.accept().dispatch("click", { detail: 1 });
    expect(r.sent).toEqual([{ quest: "q1" }]);
    const key = opened();
    key.accept().dispatch("click", { detail: 0 }); // Enter or Space on a focused button: no guard
    expect(key.sent).toEqual([{ quest: "q1" }]);
  });
});

describe("the keyboard", () => {
  it("takes the focus on open; Enter, 1 and the numpad 1 accept, and the keys are spent", () => {
    for (const code of ["Enter", "NumpadEnter", "Digit1", "Numpad1"]) {
      const r = opened();
      expect(r.dialog.focused).toBe(true);
      const e = r.win.press({ code });
      expect(e.defaultPrevented, code).toBe(true);
      expect(r.scene, `${code} never reaches the scene`).toEqual([]);
      expect(r.sent, code).toEqual([{ quest: "q1" }]);
      // The keyboard goes back to the game at once; the card stays up with its result.
      expect(r.dialog.focused, code).toBe(false);
      expect(r.dialog.isOpen, code).toBe(true);
      expect(r.dialog.acceptPending, code).toBe(true);
    }
  });

  it("closes on Esc and on F, and spends them, so the scene does not read F as a fresh open", () => {
    for (const code of ["Escape", "KeyF"]) {
      const r = opened();
      const e = r.win.press({ code });
      expect(e.defaultPrevented, code).toBe(true);
      expect(r.scene, code).toEqual([]);
      expect(r.dialog.isOpen, code).toBe(false);
      expect(r.dialog.focused, code).toBe(false);
      expect(r.sent, code).toEqual([]);
    }
  });

  it("does not take a key it does not own: other keys, shift, a held key, a modifier chord, a text field", () => {
    const r = opened();
    for (const code of ["KeyS", "Digit2", "Digit3", "KeyD", "KeyQ", "KeyJ", "KeyC", "Tab", "Space"]) {
      const e = r.win.press({ code });
      expect(e.defaultPrevented, code).toBe(false);
    }
    expect(r.win.press({ code: "Enter", shiftKey: true }).defaultPrevented).toBe(false);
    expect(r.win.press({ code: "Enter", repeat: true }).defaultPrevented).toBe(false);
    expect(r.win.press({ code: "Enter", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(r.win.press({ code: "Digit1", metaKey: true }).defaultPrevented).toBe(false);
    expect(r.win.press({ code: "Escape", altKey: true }).defaultPrevented).toBe(false);
    expect(r.sent).toEqual([]);
    expect(r.dialog.isOpen).toBe(true);
  });

  it("leaves the digits, Enter, Esc and F to the game while it is open but not focused", () => {
    const r = opened();
    r.dialog.leave();
    expect(r.dialog.focused).toBe(false);
    for (const code of ["Digit1", "Digit2", "Numpad1", "Enter", "Escape", "KeyF"]) {
      const e = r.win.press({ code });
      expect(e.defaultPrevented, code).toBe(false);
    }
    expect(r.scene).toEqual(["Digit1", "Digit2", "Numpad1", "Enter", "Escape", "KeyF"]);
    expect(r.sent).toEqual([]);
    expect(r.dialog.isOpen).toBe(true);
  });

  it("owns no key at all while closed", () => {
    const r = setup();
    r.frame();
    for (const code of ["Digit1", "Enter", "Escape", "KeyF"]) expect(r.win.press({ code }).defaultPrevented, code).toBe(false);
    expect(r.scene).toEqual(["Digit1", "Enter", "Escape", "KeyF"]);
  });

  it("has the pure key map: accept on Enter or 1, close on Esc or F, nothing when unfocused or shifted", () => {
    const on = { focused: true, shift: false };
    expect(["Enter", "NumpadEnter", "Digit1", "Numpad1"].map((c) => questDialogKeyAction(c, on)?.kind)).toEqual(["accept", "accept", "accept", "accept"]);
    expect(["Escape", "KeyF"].map((c) => questDialogKeyAction(c, on)?.kind)).toEqual(["close", "close"]);
    expect(questDialogKeyAction("Digit2", on)).toBeNull();
    for (const code of ["Enter", "Digit1", "Escape", "KeyF"]) {
      expect(questDialogKeyAction(code, { focused: false, shift: false }), code).toBeNull();
      expect(questDialogKeyAction(code, { focused: true, shift: true }), code).toBeNull();
    }
  });

  it("puts the buttons in the Tab order only while it has the keyboard", () => {
    const r = opened();
    expect(r.accept().tabIndex).toBe(0);
    expect(r.closeButton().tabIndex).toBe(0);
    r.dialog.leave();
    expect(r.accept().tabIndex).toBe(-1);
    expect(r.closeButton().tabIndex).toBe(-1);
  });

  it("the Close button closes", () => {
    const r = opened();
    r.clock.now += 1000;
    r.closeButton().click();
    expect(r.dialog.isOpen).toBe(false);
  });
});

describe("closing by itself", () => {
  it("closes when the player walks out past the hysteresis, and not before", () => {
    expect(QUEST_DIALOG_CLOSE_RANGE).toBe(QUEST_ACCEPT_RANGE + QUEST_DIALOG_HYSTERESIS);
    const r = opened();
    r.me.x = GIVER.x + QUEST_ACCEPT_RANGE + 2; // past the open range, inside the hysteresis
    r.frame();
    expect(r.dialog.isOpen).toBe(true);
    r.me.x = GIVER.x + QUEST_DIALOG_CLOSE_RANGE + 1;
    r.frame();
    expect(r.dialog.isOpen).toBe(false);
    expect(r.root.hidden).toBe(true);
    expect(r.dialog.focused).toBe(false);
  });

  it("closes when the offer is done, expired, or gone, the run is not on, or the player is down", () => {
    const cases: Array<[string, (r: Rig) => void]> = [
      ["done", (r) => { r.quests.set("q1", offer({ status: "done", doneBy: "Bravo" })); }],
      ["expired", (r) => { r.quests.set("q1", offer({ status: "expired" })); }],
      ["gone", (r) => { r.quests.delete("q1"); }],
      ["lapsed by the clock", () => {}],
      ["the run stopped", () => {}],
      ["down", (r) => { r.me.alive = false; }],
    ];
    for (const [label, change] of cases) {
      const r = opened();
      change(r);
      r.frame(label === "the run stopped" ? { active: false } : label === "lapsed by the clock" ? { serverNow: 66_000 } : {});
      expect(r.dialog.isOpen, label).toBe(false);
      expect(r.dialog.questId, label).toBe("");
    }
    const none = opened();
    none.frame({ me: null });
    expect(none.dialog.isOpen, "no player").toBe(false);
  });

  it("closes when a wall comes between (the collision map the server checks)", () => {
    const r = opened();
    const tiles = new Uint8Array(30 * 30).fill(TILE_FLOOR);
    for (let y = 0; y < 30; y++) tiles[y * 30 + 15] = TILE_WALL;
    r.quests.set("q1", offer({ x: 16.5 * TILE, y: 10 * TILE }));
    r.me.x = 14.5 * TILE;
    r.me.y = 10 * TILE;
    r.frame({ sight: mapFromTiles(30, 30, tiles) });
    expect(r.dialog.isOpen).toBe(false);
  });

  it("keeps nothing of a closed offer: a new opening starts clean", () => {
    const r = opened();
    r.clock.now += 1000;
    r.accept().click();
    r.dialog.noteToast(QUEST_REFUSAL.far);
    r.dialog.close();
    r.frame();
    expect(r.dialog.open("q1")).toBe(true);
    expect(r.dialog.acceptPending).toBe(false);
    expect(r.text("qd-status")).toMatch(/Accept it to start/);
  });
});

describe("the pure reach rule", () => {
  it("is the server's: within the range and a clear line", () => {
    const a = { x: 100, y: 100 };
    expect(canTalk(null, a, { x: 100 + QUEST_ACCEPT_RANGE, y: 100 })).toBe(true);
    expect(canTalk(null, a, { x: 100 + QUEST_ACCEPT_RANGE + 0.5, y: 100 })).toBe(false);
    expect(canTalk(null, a, { x: 100 + QUEST_DIALOG_CLOSE_RANGE, y: 100 }, QUEST_DIALOG_CLOSE_RANGE)).toBe(true);
    const tiles = new Uint8Array(8 * 8).fill(TILE_FLOOR);
    for (let y = 0; y < 8; y++) tiles[y * 8 + 1] = TILE_WALL;
    expect(canTalk(mapFromTiles(8, 8, tiles), { x: 16, y: 32 }, { x: 72, y: 32 })).toBe(false);
    expect(canTalk(mapFromTiles(8, 8, new Uint8Array(64).fill(TILE_FLOOR)), { x: 16, y: 32 }, { x: 72, y: 32 })).toBe(true);
  });
});

describe("tearing down", () => {
  it("stops listening and takes its root out", () => {
    const r = opened();
    expect(r.win.keydownListeners).toBeGreaterThanOrEqual(2);
    const before = r.win.keydownListeners;
    r.dialog.destroy();
    expect(r.win.keydownListeners).toBe(before - 1);
    expect(r.root.removed).toBe(true);
    expect(r.win.press({ code: "Digit1" }).defaultPrevented).toBe(false);
  });
});

describe("the stylesheet and the script", () => {
  const css = readFileSync(new URL("../src/ui/questDialog.css", import.meta.url), "utf8");
  const source = readFileSync(new URL("../src/ui/questDialog.ts", import.meta.url), "utf8");
  const scene = readFileSync(new URL("../src/scenes/RaidScene.ts", import.meta.url), "utf8");

  const rule = (selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&");
    const m = new RegExp(`(?:^|\\n|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    if (!m) throw new Error(`no rule for ${selector}`);
    return m[1]!;
  };

  it("is click-through at the root (past index.html's #ui > * rule) and in the box, and only the buttons take the pointer", () => {
    expect(rule("#ui > .quest-dialog")).toMatch(/pointer-events:\s*none/);
    for (const s of [".qd-box", ".qd-head", ".qd-buttons", ".qd-status", ".qd-hint"]) expect(rule(s), s).toMatch(/pointer-events:\s*none/);
    expect(rule(".qd-accept, .qd-close")).toMatch(/pointer-events:\s*auto/);
    expect(css.match(/pointer-events:\s*auto/g) ?? []).toHaveLength(1);
  });

  it("is not a modal: no scrim, no full-screen box, no fixed position", () => {
    expect(css).not.toMatch(/position:\s*fixed/);
    expect(css).not.toMatch(/inset:\s*0\b/);
    expect(css).not.toMatch(/scrim|backdrop/);
    expect(rule("#ui > .quest-dialog")).toMatch(/position:\s*absolute/);
  });

  it("sits under the map screens and the quest log, over the chest panel", () => {
    const z = (text: string, selector: string): number => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&");
      const m = new RegExp(`${escaped}\\s*\\{[^}]*z-index:\\s*(\\d+)`).exec(text);
      return Number(m?.[1]);
    };
    const chest = readFileSync(new URL("../src/ui/chestPanel.css", import.meta.url), "utf8");
    const planning = readFileSync(new URL("../src/ui/planning.css", import.meta.url), "utf8");
    const log = readFileSync(new URL("../src/ui/questLog.css", import.meta.url), "utf8");
    const mine = z(css, "#ui > .quest-dialog");
    expect(mine).toBeGreaterThan(z(chest, "#ui > .chest-panel"));
    expect(mine).toBeLessThan(z(planning, "#ui > .planning"));
    expect(mine).toBeLessThan(z(log, "#ui > .quest-log"));
  });

  it("registers its keys capturing and releases them, and handles no pointer events but its buttons' clicks", () => {
    expect(source).toContain('window.addEventListener("keydown", this.onKeyDown, true)');
    expect(source).toContain('window.removeEventListener("keydown", this.onKeyDown, true)');
    expect(source).not.toMatch(/setPointerCapture|stopPropagation\(\)/);
  });

  it("is what the scene's F opens: F closes an open dialog, else takes the nearest pickup or opens the giver's offer", () => {
    expect(scene).toContain('else if (e.code === "KeyF") this.interact()');
    expect(scene).toMatch(/private interact\(\): void \{[\s\S]*questDialog\?\.isOpen[\s\S]*questDialog\.close\(\)[\s\S]*"pickup"[\s\S]*questDialog\?\.open\(/);
    expect(scene).toContain('sendInput(this.room, "questAccept", msg)');
    expect(scene).toContain("pickInteraction(");
  });

  it("sends a pickup for a quest item of an unaccepted offer (the server's refusal toast) and hints it on the weapon bar", () => {
    expect(scene).toContain('if (it.kind === "pickup" || it.kind === "blocked") sendInput(this.room, "pickup", { containerId: it.container.id })');
    expect(scene).toContain("questAcceptFirstText(blocked.def)");
    expect(scene).toContain("const focus = this.nearest ?? this.blockedItem");
  });
});
