// The quest dialog: F next to a quest giver opens its offer, and Accept sends `questAccept`. Nothing of an offer counts for a player
// until they have accepted it (kills, tokens, the parcel, the turn-in), so this is where a quest starts.
//
// A non-modal card docked at the left edge, off the fight's centre, modelled on the chest panel (ui/chestPanel.ts). The root and the
// box are click-through: only the two buttons take the pointer, so a left click elsewhere still locks a target and a right click
// still walks. Opening it takes the keyboard on purpose (the player asked): Enter or 1 accepts, Esc or F closes, and those keys
// are the dialog's ONLY while it has the focus (capturing, so the scene does not also read them), so the weapon digits and Esc are
// the game's again the moment a click hands the focus back. F with the dialog open and unfocused closes it too (the scene's key).
// It closes by itself when the player walks out of reach (the latest SERVER position, like the chest panel, so it never offers an
// accept the server would refuse for range), the offer closes, the run is not on, or the player is down. The server decides
// everything; a refusal comes back as its toast (noteToast) into the status line.
import { QUEST_REFUSALS, type ClientMessages, type GameMap } from "@raid/shared";
import { ORDER_EXPIRE_MS } from "../net/localMotion";
import { settings as appSettings, type Settings, type SettingsStore } from "../settings";
import { isTypingTarget } from "./chrome";
import { el, uiRoot } from "./dom";
import { keycap } from "./keycap";
import { QUEST_DIALOG_CLOSE_RANGE, canTalk, questDialogKeyAction } from "./questDialogMath";
import { questKindCss, questRows, type QuestCollection, type QuestRow, type QuestStateLike } from "./questModel";
import "./questDialog.css";

/** How long an accept waits for the server's word (the state listing the player, or a refusal toast) before the dialog lets go of it. */
export const ACCEPT_PENDING_EXPIRE_MS = ORDER_EXPIRE_MS;
/** A refusal stays in the status line this long. */
export const ACCEPT_REFUSED_HOLD_MS = 4000;
/** After the player's own accept shows in the state, the dialog stays this long with its result and then closes. */
export const ACCEPTED_HOLD_MS = 2500;
/** A mouse click in the first moments after the dialog opens is ignored: it was most likely meant for the canvas. */
export const QUEST_DIALOG_CLICK_GUARD_MS = 250;
export const ACCEPT_NOT_CONFIRMED_SAY = "The server did not confirm your accept. Check the quest and try again.";
export const ACCEPT_RECONNECTING_SAY = "Reconnecting: that was not sent. Try again once you are back.";

/** The local player, as the dialog reads them. `x`, `y`: the latest SERVER position. */
export interface QuestDialogMe {
  id: string;
  x: number;
  y: number;
  alive: boolean;
}

/** What the scene hands the dialog each frame. */
export interface QuestDialogFrame {
  /** The run is on: offers can only be accepted then. */
  active: boolean;
  /** The estimated server time now (the HUD's clock). */
  serverNow: number;
  me: QuestDialogMe | null;
  /** RaidState.quests: the public offers. */
  quests: QuestCollection;
  /** The walls the server checks an accept's line of sight against (gates included); null to skip the check. */
  sight: GameMap | null;
  /** Optional current stacks let the reward preview show how much remains before the fixed per-type cap. */
  feed?: number;
  mobStats?: Readonly<Record<string, number>> | Map<string, number>;
  /** The local player's callsign (a finished row names its finisher). */
  localName?: string;
}

export interface QuestDialogOptions {
  /** Sends a `questAccept` input. */
  send: (msg: ClientMessages["questAccept"]) => void;
  /** False while a send would be lost (the socket is reconnecting). Default: always. */
  canSend?: () => boolean;
  /** Local clock in ms (a test passes its own). Default: performance.now. */
  now?: () => number;
  /** The settings to follow (the text size); the app-wide store unless a test passes its own. */
  settings?: Pick<SettingsStore, "get" | "subscribe">;
}

function findQuest(quests: QuestCollection, id: string): QuestStateLike | undefined {
  let found: QuestStateLike | undefined;
  quests.forEach((quest, key) => { if (key === id || quest.id === id) found = quest; });
  return found;
}

export class QuestDialog {
  /** The dialog's root: put in #ui at construction, hidden until F opens an offer. */
  readonly element = el("div", "quest-dialog");
  private readonly box = el("div", "qd-box");
  private readonly head = el("div", "qd-head");
  private readonly title = el("span", "qd-title");
  private readonly kind = el("span", "qd-kind");
  private readonly timer = el("span", "qd-timer");
  private readonly giver = el("div", "qd-giver");
  private readonly brief = el("div", "qd-brief");
  private readonly objective = el("div", "qd-objective");
  private readonly reward = el("div", "qd-reward");
  private readonly progress = el("div", "qd-progress");
  private readonly badge = el("div", "qd-badge", "Accepted");
  private readonly status = el("div", "qd-status");
  private readonly acceptButton = el("button", "qd-accept");
  private readonly closeButton = el("button", "qd-close");
  private readonly hintIdle = el("div", "qd-hint");
  private readonly hintFocus = el("div", "qd-hint qd-hint-keys");

  private readonly send: (msg: ClientMessages["questAccept"]) => void;
  private readonly canSend: () => boolean;
  private readonly now: () => number;
  private readonly settings: Pick<SettingsStore, "get" | "subscribe">;
  private readonly unsubscribers: Array<() => void> = [];

  private frame: QuestDialogFrame | null = null;
  /** The offer shown, "" while closed. */
  private wanted = "";
  /** An accept on its way: the offer and the local time it was sent. */
  private pending: { quest: string; at: number } | null = null;
  private refused: string | null = null;
  private refusedAt = 0;
  private openedAt = -Infinity;
  /** When the player's own accept first showed in the state during this opening (it then closes ACCEPTED_HOLD_MS later); null if not seen. */
  private acceptedSeenAt: number | null = null;
  private wasAccepted = false;
  /** The buttons are in the Tab order (the dialog took the keyboard). */
  private tabbable = false;

  // What was last drawn.
  private keyBody = "";
  private keyTimer = "";
  private keyStatus = "";
  private keyFocus: boolean | null = null;
  private keyButtons = "";

  constructor(options: QuestDialogOptions) {
    this.send = options.send;
    this.canSend = options.canSend ?? (() => true);
    this.now = options.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    this.settings = options.settings ?? appSettings;
    this.build();
    this.applySettings(this.settings.get());
    this.unsubscribers.push(this.settings.subscribe((s) => this.applySettings(s)));
    // Capturing, like the chest panel's: Enter, a digit, Esc or F the dialog uses must not also reach the scene.
    window.addEventListener("keydown", this.onKeyDown, true);
    // A press anywhere outside hands the keyboard back to the game (Phaser may keep the browser from moving the focus itself).
    window.addEventListener("pointerdown", this.onPointerDown, true);
    this.element.hidden = true;
    uiRoot().append(this.element);
  }

  /** The dialog is up. */
  get isOpen(): boolean {
    return !this.element.hidden;
  }

  /** The id of the offer shown, "" while closed. */
  get questId(): string {
    return this.wanted;
  }

  /** The dialog has the keyboard: Enter, 1, Esc and F are its keys. */
  get focused(): boolean {
    const active = document.activeElement;
    return !!active && this.element.contains(active as Node);
  }

  /** An accept is on its way to the server. */
  get acceptPending(): boolean {
    return this.pending !== null;
  }

  // ------------------------------------------------------------------------------------------------------------ building

  private build(): void {
    const root = this.element;
    // A region, not a dialog: the page treats focus inside a [role=dialog] as a modal's (J, C and F are not its keys then).
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", "Quest offer");
    root.tabIndex = -1;

    this.timer.setAttribute("role", "timer");
    this.timer.setAttribute("aria-live", "off");
    this.head.append(this.title, this.kind, this.timer);

    this.acceptButton.type = "button";
    this.acceptButton.tabIndex = -1;
    this.acceptButton.append(keycap("Enter", "qd-key"), el("span", "qd-accept-text", "Accept"));
    this.acceptButton.addEventListener("click", (e) => this.onButton(e, this.acceptButton, () => this.accept()));
    this.acceptButton.addEventListener("contextmenu", (e: Event) => e.preventDefault());
    this.acceptButton.addEventListener("focusout", this.onFocusOut);

    this.closeButton.type = "button";
    this.closeButton.tabIndex = -1;
    this.closeButton.append(keycap("Esc", "qd-key"), el("span", "qd-close-text", "Close"));
    this.closeButton.addEventListener("click", (e) => this.onButton(e, this.closeButton, () => { this.close(); return true; }));
    this.closeButton.addEventListener("contextmenu", (e: Event) => e.preventDefault());
    this.closeButton.addEventListener("focusout", this.onFocusOut);

    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    this.hintIdle.append("Press ", keycap("F"), " to close");
    this.hintFocus.append(keycap("Enter"), " or ", keycap("1"), " accept ", keycap("Esc"), " or ", keycap("F"), " close");
    this.hintFocus.hidden = true;
    this.badge.hidden = true;

    const buttons = el("div", "qd-buttons");
    buttons.append(this.acceptButton, this.badge, this.closeButton);
    this.box.append(this.head, this.giver, this.brief, this.objective, this.reward, this.progress, this.status, buttons, this.hintIdle, this.hintFocus);
    root.append(this.box);
  }

  private applySettings(s: Readonly<Settings>): void {
    this.element.style.setProperty("--qd-text", String(s.textScale));
  }

  /**
   * A click on Accept or Close (`act` says whether its order was sent). A mouse click hands the keyboard back at once (the digits go
   * on picking the weapon slot); a click in the first QUEST_DIALOG_CLICK_GUARD_MS after the dialog opened does nothing.
   */
  private onButton(e: Event, button: HTMLButtonElement, act: () => boolean): void {
    const pointer = Boolean((e as { detail?: number }).detail);
    if (pointer && this.now() - this.openedAt < QUEST_DIALOG_CLICK_GUARD_MS) {
      button.blur();
      return;
    }
    act();
    if (pointer) button.blur();
  }

  // --------------------------------------------------------------------------------------------------------- open and close

  /**
   * Opens the dialog on a public offer (F at its giver) and takes the keyboard. False, and nothing changes, when the latest frame
   * says the player could not talk to that giver now: the run is not on, the player is down, the offer is gone or closed, or the
   * giver is out of reach (QUEST_ACCEPT_RANGE and a clear line, `canTalk`).
   */
  open(questId: string): boolean {
    const f = this.frame;
    if (!f || !f.active || !f.me?.alive) return false;
    const quest = findQuest(f.quests, questId);
    if (!quest || quest.status !== "open" || !canTalk(f.sight, f.me, quest)) return false;
    if (this.wanted !== quest.id) this.resetSession();
    this.wanted = quest.id;
    this.openedAt = this.now();
    this.element.hidden = false;
    this.focus();
    this.refresh();
    return true;
  }

  /** Closes the dialog and hands the keyboard back. */
  close(): void {
    this.wanted = "";
    this.resetSession();
    if (this.element.hidden) return;
    this.element.hidden = true;
    this.keyFocus = null;
    this.keyBody = "";
    this.leave();
  }

  private resetSession(): void {
    this.pending = null;
    this.refused = null;
    this.acceptedSeenAt = null;
    this.wasAccepted = false;
  }

  /** Takes the keyboard: Enter, 1, Esc and F are the dialog's until it gives it back. False while closed. */
  focus(): boolean {
    if (this.element.hidden) return false;
    this.setTabbable(true);
    this.element.focus({ preventScroll: true });
    return true;
  }

  /** Hands the keyboard back to the game. */
  leave(): void {
    const active = document.activeElement as { blur?: () => void } | null;
    if (active && this.element.contains(active as Node)) active.blur?.();
    this.setTabbable(false);
  }

  // ----------------------------------------------------------------------------------------------------------- the frame

  /** Call every frame. Writes only what changed. */
  update(frame: QuestDialogFrame): void {
    this.frame = frame;
    if (this.wanted === "") return;
    const me = frame.me;
    const quest = findQuest(frame.quests, this.wanted);
    // Out of reach (past the hysteresis), a closed offer, a stopped run, a fighter that is down: the dialog has nothing to say.
    if (!frame.active || !me?.alive || !quest || quest.status !== "open" || !canTalk(frame.sight, me, quest, QUEST_DIALOG_CLOSE_RANGE)) {
      this.close();
      return;
    }
    const row = this.rowOf(quest, frame);
    // A row closed by the clock (the offer lapsed a frame before the server said so) has nothing to accept either.
    if (!row || row.closed) { this.close(); return; }
    const now = this.now();
    if (row.accepted) {
      if (!this.wasAccepted) {
        // The accept just showed in the state. One this dialog sent holds the result for a moment, then closes; reopening an
        // offer that was already accepted (nothing pending, nothing seen before) just stays.
        if (this.pending !== null) this.acceptedSeenAt = now;
        this.wasAccepted = true;
      }
      this.pending = null;
      this.refused = null;
      if (this.acceptedSeenAt !== null && now - this.acceptedSeenAt >= ACCEPTED_HOLD_MS) { this.close(); return; }
    } else {
      this.wasAccepted = false;
      if (this.pending && (this.pending.quest !== quest.id || now - this.pending.at >= ACCEPT_PENDING_EXPIRE_MS)) {
        if (this.pending.quest === quest.id) this.noteRefused(ACCEPT_NOT_CONFIRMED_SAY, now);
        this.pending = null;
      }
    }
    if (this.refused !== null && now - this.refusedAt >= ACCEPT_REFUSED_HOLD_MS) this.refused = null;
    this.render(row);
  }

  private rowOf(quest: QuestStateLike, frame: QuestDialogFrame): QuestRow | undefined {
    const me = frame.me;
    if (!me) return undefined;
    return questRows({ forEach: (cb) => cb(quest, quest.id) }, me.id, frame.serverNow, frame.localName ?? "", false, frame.feed, frame.mobStats)[0];
  }

  private render(row: QuestRow): void {
    const body = `${row.id}|${row.objective}|${row.reward}|${row.progress}|${row.accepted}|${row.ready}`;
    if (body !== this.keyBody) {
      this.keyBody = body;
      this.element.style.setProperty("--qd-color", questKindCss(row.def.kind));
      this.title.textContent = row.def.name;
      this.kind.textContent = row.def.kind;
      this.giver.textContent = row.def.giver;
      this.brief.textContent = row.def.text;
      this.objective.textContent = row.objective;
      this.reward.textContent = `Reward: ${row.reward}`;
      this.progress.textContent = row.accepted ? `Your progress ${row.progress}` : "Not accepted yet: nothing counts until you accept.";
      this.progress.classList.toggle("off", !row.accepted);
      this.element.classList.toggle("accepted", row.accepted);
    }
    if (row.time !== this.keyTimer) {
      this.keyTimer = row.time;
      this.timer.textContent = row.time;
    }

    const status = this.pending !== null ? "Accepting..." : this.refused !== null ? this.refused : row.accepted
      ? row.ready ? `Return to ${row.def.giver} to turn it in.` : "Quest accepted. It counts from now."
      : "Accept it to start. Only accepted offers count.";
    if (status !== this.keyStatus) {
      this.keyStatus = status;
      this.status.textContent = status;
      this.status.classList.toggle("refused", this.refused !== null && this.pending === null);
    }

    const canAccept = !row.accepted && this.pending === null;
    const buttons = `${row.accepted}|${canAccept}`;
    if (buttons !== this.keyButtons) {
      this.keyButtons = buttons;
      this.acceptButton.hidden = row.accepted;
      this.badge.hidden = !row.accepted;
      this.acceptButton.disabled = !canAccept;
      this.acceptButton.setAttribute("aria-disabled", String(!canAccept));
    }

    const focused = this.focused;
    if (focused !== this.keyFocus) {
      this.keyFocus = focused;
      this.element.classList.toggle("focused", focused);
      this.hintIdle.hidden = focused;
      this.hintFocus.hidden = !focused;
    }
  }

  /** Repaints from the frame in hand, right after something changed here (a click, a key), instead of waiting for the next frame. */
  private refresh(): void {
    const f = this.frame;
    if (!f || this.wanted === "" || !f.me) return;
    const quest = findQuest(f.quests, this.wanted);
    const row = quest ? this.rowOf(quest, f) : undefined;
    if (row) this.render(row);
  }

  // ---------------------------------------------------------------------------------------------------------------- accept

  /** Sends the accept for the offer shown. True when the order was sent. */
  accept(): boolean {
    const f = this.frame;
    if (this.wanted === "" || !f?.me) return false;
    const quest = findQuest(f.quests, this.wanted);
    if (!quest || quest.accepted?.get(f.me.id) === true || this.pending !== null) return false;
    const now = this.now();
    if (!this.canSend()) {
      this.noteRefused(ACCEPT_RECONNECTING_SAY, now);
      this.refresh();
      return false;
    }
    this.refused = null;
    this.pending = { quest: quest.id, at: now };
    this.send({ quest: quest.id });
    this.refresh();
    return true;
  }

  /**
   * The server's `toast` text, while an accept waits for its answer: one of the shared QUEST_REFUSALS ("Too far away", "That quest
   * is over"). Any other toast (a GV line, a kill, "Quest accepted: ...") is not a refusal. True when it was ours.
   */
  noteToast(text: string): boolean {
    if (!this.pending || !QUEST_REFUSALS.includes(text)) return false;
    this.pending = null;
    this.noteRefused(text, this.now());
    this.refresh();
    return true;
  }

  private noteRefused(text: string, now: number): void {
    this.refused = text;
    this.refusedAt = now;
  }

  // ---------------------------------------------------------------------------------------------------------- the keyboard

  /** The accept and close buttons are in the Tab order only while the dialog has the keyboard: -1 otherwise. */
  private setTabbable(on: boolean): void {
    if (on === this.tabbable) return;
    this.tabbable = on;
    const index = on ? 0 : -1;
    this.acceptButton.tabIndex = index;
    this.closeButton.tabIndex = index;
  }

  private readonly onFocusOut = (e: Event): void => {
    const to = (e as { relatedTarget?: unknown }).relatedTarget as Node | null | undefined;
    if (!to || !this.element.contains(to)) this.setTabbable(false);
  };

  private readonly onPointerDown = (e: Event): void => {
    if (this.element.hidden || !this.focused) return;
    const target = e.target as Node | null;
    if (!target || !this.element.contains(target)) this.leave();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.tabbable && !this.focused) this.setTabbable(false);
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || this.element.hidden) return;
    if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
    const action = questDialogKeyAction(e.code, { focused: this.focused, shift: e.shiftKey });
    if (!action) return;
    // The key is spent: the scene behind must not also read it.
    e.preventDefault();
    e.stopImmediatePropagation();
    if (action.kind === "close") {
      this.close();
      return;
    }
    // The keyboard goes back to the game at once once the accept is sent, like a chest pick; the card stays up with its result.
    if (this.accept()) this.leave();
  };

  destroy(): void {
    window.removeEventListener("keydown", this.onKeyDown, true);
    window.removeEventListener("pointerdown", this.onPointerDown, true);
    for (const off of this.unsubscribers.splice(0)) off();
    this.leave();
    this.element.remove();
  }
}
