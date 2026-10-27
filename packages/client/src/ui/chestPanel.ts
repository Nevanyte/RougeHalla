// The camp chest panel (roguelike R5): a cleared camp's shared chest offers three cards for 15 seconds, one pick each, first
// come first served. The panel is a non-modal card docked at the right edge, off the fight's centre. It opens by itself
// while a live chest is within reach of the LATEST SERVER position of the local player (never the predicted one, so it never
// offers a pick the server would refuse for range), shows the chest's contents only then, and closes when the player walks
// away, the chest expires, or their pick is in.
//
// It never takes the canvas' clicks: the box is click-through and only the cards and the Skip button take the pointer (a left
// click elsewhere still locks a target, a right-click still walks; a click in the first CHEST_PANEL_CLICK_GUARD_MS after it
// opens is ignored, so a spam-clicking cursor cannot take a pick unseen). Keyboard: C focuses the panel, then 1 2 3 pick the
// cards and 0 skips; C or Esc hand the focus back, and so does a pick or skip sent by key or by Enter/Space on a focused card or
// Skip (the digits are the weapon slots again during the summary). The cards and Skip are out of the browser's Tab order until C: a stray Tab must not put the focus
// inside, where the digits and Esc would stop being the game's, and once inside, Tab walks the buttons (the hold-Tab map
// leaves it alone, ui/mapHold.ts). The digits are the panel's ONLY while it has focus, so the weapon keys work as ever otherwise. Every option greys out RTT/2 + CHEST_GREY_MS before the chest expires, and a pick the server refuses comes
// back as its `toast` (noteToast) into the status line. The server decides everything: this only sends `choose`.
import {
  CHEST_OPTIONS, CHEST_PANEL_CLICK_GUARD_MS, CHEST_SECONDS, isChestRefusal, skipText,
  type CampDef, type CardCounts, type CardOptionView, type ClientMessages, type GameMap,
} from "@raid/shared";
import { ORDER_EXPIRE_MS } from "../net/localMotion";
import { settings as appSettings, type Settings, type SettingsStore } from "../settings";
import {
  CHEST_FOCUS_KEY, DEFAULT_RTT_MS, cardTitleAttr, formatCountdown, isGreyed, kindLine, myPick, optionCards, pickReward, rarityFrame, readReward,
  stateText, statusText, tagChips, tierBadge, timeShare, trueServerNow, usableRtt, type OptionCard, type PanelTarget, type Reward,
  type RewardSource,
} from "./chestMath";
import { isTypingTarget } from "./chrome";
import "./chestPanel.css";
import { el, uiRoot } from "./dom";
import { keycap } from "./keycap";
import { campTitle } from "./planning";
import { setPoolGlyph } from "./poolGlyph";

/** How long the panel stays up with its result after the player's own pick shows in the state. */
export const PICKED_HOLD_MS = 2500;
/** How long a pick waits for the server's word (its state, or a refusal toast) before the panel lets go of it. */
export const PENDING_EXPIRE_MS = ORDER_EXPIRE_MS;
/** A refusal stays in the status line this long. */
export const REFUSED_HOLD_MS = 4000;
/** The countdown reads as urgent under this many seconds. */
export const URGENT_SECONDS = 5;
/** Said when a pick was sent and the server answered neither way. */
export const NOT_CONFIRMED_SAY = "The server did not confirm your pick. Check the chest and try again.";
export const RECONNECTING_SAY = "Reconnecting: that was not sent. Try again once you are back.";

/** What a key press asks of the panel. `index` is a card (0-based). */
export type ChestKeyAction = { kind: "toggle" } | { kind: "leave" } | { kind: "skip" } | { kind: "pick"; index: number };

/**
 * Which panel action a key press asks for. C works while the panel is up and no dialog of the page has the focus; Esc and
 * the digits count only while the panel itself has focus, so no other state loses a key it uses (1 and 2 pick the weapon slot,
 * Esc leaves practice). Physical keys (`code`), like the scenes' own shortcuts.
 */
export function chestKeyAction(code: string, s: { focused: boolean; foreign: boolean; shift: boolean }): ChestKeyAction | null {
  if (s.shift) return null;
  if (code === CHEST_FOCUS_KEY) return s.foreign ? null : { kind: "toggle" };
  if (!s.focused) return null;
  if (code === "Escape") return { kind: "leave" };
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  if (!digit) return null;
  const n = Number(digit[1]);
  if (n === 0) return { kind: "skip" };
  return n <= CHEST_OPTIONS ? { kind: "pick", index: n - 1 } : null;
}

/** The local player, as the panel reads them. `x`, `y`: the latest SERVER position. */
export interface ChestPanelMe {
  id: string;
  x: number;
  y: number;
  alive: boolean;
  build: CardCounts | null | undefined;
}

/** What the scene hands the panel each frame. */
export interface ChestPanelFrame {
  /** The run is on: chests only matter then. */
  active: boolean;
  /** The estimated server time now (the HUD's clock). */
  serverNow: number;
  me: ChestPanelMe | null;
  /** RaidState.containers: the panel picks out the reward chests. */
  containers: { forEach(cb: (c: RewardSource, id: string) => void): void };
  /** A player's name from their id, for "Taken by ...". */
  nameOf: (id: string) => string | undefined;
  /** The walls the server checks a pick's line of sight against (gates included); null to skip the check. */
  sight: GameMap | null;
}

export interface ChestPanelOptions {
  /** Sends a `choose` input. */
  send: (msg: ClientMessages["choose"]) => void;
  /** False while a send would be lost (the socket is reconnecting): a pick is then neither sent nor shown as sent. Default: always. */
  canSend?: () => boolean;
  /** Round trip in ms, for the grey-out margin and the clock (the scene hands the prediction's measured delay). Default: 100. */
  rtt?: () => number;
  /** Local clock in ms (a test passes its own). Default: performance.now. */
  now?: () => number;
  /** The settings to follow (the text size); the app-wide store unless a test passes its own. */
  settings?: Pick<SettingsStore, "get" | "subscribe">;
  /** The map's camps, for the header ("Fire camp 2 (elite)"). Also set later with setMap. */
  map?: GameMap | null;
}

interface Card {
  root: HTMLButtonElement;
  name: HTMLElement;
  /** The augment's rarity glyph before its name (empty for a base card and a conditional). */
  flair: HTMLElement;
  tier: HTMLElement;
  kind: HTMLElement;
  text: HTMLElement;
  /** The tag chips; a hover or a tap on one puts its glossary line in the status line. */
  tags: HTMLElement;
  state: HTMLElement;
  /** What the card shows now, so a frame that changes nothing writes nothing. */
  sig: string;
}

export class ChestPanel {
  /** The panel's root: put in #ui at construction, hidden while no chest is in reach. */
  readonly element = el("div", "chest-panel");
  private readonly box = el("div", "cp-box");
  private readonly head = el("div", "cp-head");
  private readonly headGlyph = el("span", "cp-glyph");
  private readonly title = el("span", "cp-title", "Camp chest");
  private readonly timer = el("span", "cp-timer");
  private readonly bar = el("div", "cp-bar");
  private readonly list = el("div", "cp-cards");
  private readonly skipButton = el("button", "cp-skip");
  private readonly skipLabel = el("span", "cp-skip-text", skipText());
  private readonly status = el("div", "cp-status");
  private readonly hintIdle = el("div", "cp-hint");
  private readonly hintFocus = el("div", "cp-hint cp-hint-keys");
  private readonly cards: Card[] = [];

  private readonly send: (msg: ClientMessages["choose"]) => void;
  private readonly canSend: () => boolean;
  private readonly rtt: () => number;
  private readonly now: () => number;
  private readonly settings: Pick<SettingsStore, "get" | "subscribe">;
  private map: GameMap | null;
  private readonly unsubscribers: Array<() => void> = [];

  private frame: ChestPanelFrame | null = null;
  private readonly rewards: Reward[] = [];
  /** The chest the panel shows, with this player's cards (what a key press or a click acts on). */
  private current: PanelTarget | null = null;
  private currentCards: OptionCard[] = [];
  private greyed = false;
  /** The glossary line of the tag chip under the pointer; the status line shows it while it has nothing urgent to say. */
  private gloss: string | null = null;
  /** A pick on its way: the chest, the option (-1 = skip) and the local time it was sent. */
  private pending: { chest: string; pick: number; at: number } | null = null;
  /** When the panel last opened (the local clock): a mouse click in its first moments is ignored. */
  private openedAt = -Infinity;
  /** The buttons are in the Tab order (C took the keyboard). */
  private tabbable = false;
  /** The server's refusal (or "not confirmed") to show, and since when. */
  private refused: string | null = null;
  private refusedAt = 0;
  /** When this player's pick first showed in each chest's state, and the chests whose summary has had its time. */
  private readonly pickedAt = new Map<string, number>();
  private readonly dismissed = new Set<string>();

  // What was last drawn.
  private shownId = "";
  private keyTitle = "";
  private keyTimer = "";
  private keyBar = -1;
  private keyStatus = "";
  private keyFocus: boolean | null = null;
  private keySkip = "";

  constructor(options: ChestPanelOptions) {
    this.send = options.send;
    this.canSend = options.canSend ?? (() => true);
    this.rtt = options.rtt ?? (() => DEFAULT_RTT_MS);
    this.now = options.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    this.settings = options.settings ?? appSettings;
    this.map = options.map ?? null;
    this.build();
    this.applySettings(this.settings.get());
    this.unsubscribers.push(this.settings.subscribe((s) => this.applySettings(s)));
    // Capturing, like the chrome's keys: a digit or Esc the panel uses must not also reach the scene (weapon slot, leave practice).
    window.addEventListener("keydown", this.onKeyDown, true);
    this.element.hidden = true;
    uiRoot().append(this.element);
  }

  /** The panel is up (a live chest is in reach). */
  get isOpen(): boolean {
    return !this.element.hidden;
  }

  /** The id of the chest shown, "" while closed. */
  get chestId(): string {
    return this.shownId;
  }

  /** The panel has the keyboard (C): 1 2 3 and 0 are its keys. */
  get focused(): boolean {
    const active = document.activeElement;
    return !!active && this.element.contains(active as Node);
  }

  /** A pick is on its way to the server. */
  get pickPending(): boolean {
    return this.pending !== null;
  }

  setMap(map: GameMap | null): void {
    this.map = map;
    this.keyTitle = "";
  }

  // ------------------------------------------------------------------------------------------------------------ building

  private build(): void {
    const root = this.element;
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", "Camp chest");
    root.tabIndex = -1;

    this.headGlyph.setAttribute("aria-hidden", "true");
    this.timer.setAttribute("role", "timer");
    this.timer.setAttribute("aria-live", "off");
    this.head.append(this.headGlyph, this.title, this.timer);
    this.bar.setAttribute("aria-hidden", "true");
    this.list.setAttribute("role", "group");
    this.list.setAttribute("aria-label", "Cards in the chest");

    this.skipButton.type = "button";
    this.skipButton.tabIndex = -1;
    this.skipButton.append(keycap("0", "cp-key"), this.skipLabel);
    this.skipButton.addEventListener("click", (e) => this.onButton(e, this.skipButton, () => this.skip()));
    this.skipButton.addEventListener("contextmenu", (e: Event) => e.preventDefault());
    this.skipButton.addEventListener("focusout", this.onFocusOut);

    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    this.hintIdle.append("Press ", keycap("C"), " to use the keyboard");
    this.hintFocus.append(keycap("1"), keycap("2"), keycap("3"), " pick ", keycap("0"), " skip ", keycap("C"), " or ", keycap("Esc"), " back");
    this.hintFocus.hidden = true;

    this.box.append(this.head, this.bar, this.list, this.skipButton, this.status, this.hintIdle, this.hintFocus);
    root.append(this.box);
    for (let i = 0; i < CHEST_OPTIONS; i++) this.addCard();
  }

  private addCard(): Card {
    const index = this.cards.length;
    const root = el("button", "cp-card");
    root.type = "button";
    root.tabIndex = -1;
    const name = el("span", "cp-name");
    const flair = el("span", "cp-flair");
    flair.setAttribute("aria-hidden", "true");
    const tier = el("span", "cp-tier");
    const kind = el("span", "cp-kind");
    const text = el("span", "cp-text");
    const tags = el("span", "cp-tags");
    // The card's own label already names the tags; the chips are for the pointer.
    tags.setAttribute("aria-hidden", "true");
    const state = el("span", "cp-state");
    const top = el("span", "cp-card-top");
    top.append(keycap(String(index + 1), "cp-key"), flair, name, tier);
    root.append(top, kind, text, tags, state);
    root.addEventListener("click", (e) => this.onButton(e, root, () => this.pick(index)));
    // A right-click is a walk order: on a card it must not open the browser's menu instead.
    root.addEventListener("contextmenu", (e: Event) => e.preventDefault());
    // Focus leaving the panel from a button (a Tab past the last one) takes the buttons out of the Tab order again.
    root.addEventListener("focusout", this.onFocusOut);
    root.hidden = true;
    const card: Card = { root, name, flair, tier, kind, text, tags, state, sig: "" };
    this.cards.push(card);
    this.list.append(root);
    return card;
  }

  private applySettings(s: Readonly<Settings>): void {
    this.element.style.setProperty("--cp-text", String(s.textScale));
  }

  /**
   * A click on a card or Skip (`act` says whether its order was sent). A mouse click hands the keyboard back at once (the digits
   * go on picking the weapon slot); so does the activation of a focused button by Enter or Space (detail 0) once its order is
   * sent, like a digit pick: the digits are the weapon slots again during the summary. An order that was not sent (a refused
   * or reconnecting pick) leaves the focus where the player put it. A mouse click in the first CHEST_PANEL_CLICK_GUARD_MS after
   * the panel opened does nothing: it is most likely a click meant for the canvas that the card, appearing under the cursor,
   * caught.
   */
  private onButton(e: Event, button: HTMLButtonElement, act: () => boolean): void {
    const pointer = Boolean((e as { detail?: number }).detail);
    if (pointer && this.now() - this.openedAt < CHEST_PANEL_CLICK_GUARD_MS) {
      button.blur();
      return;
    }
    const sent = act();
    if (pointer) button.blur();
    else if (sent) {
      this.leave();
      this.refresh();
    }
  }

  // ----------------------------------------------------------------------------------------------------------- the frame

  /** Call every frame. Writes only what changed. */
  update(frame: ChestPanelFrame): void {
    this.frame = frame;
    const now = this.now();
    const me = frame.me;
    const rtt = this.rttMs();
    const trueNow = trueServerNow(frame.serverNow, rtt);

    this.rewards.length = 0;
    frame.containers.forEach((c, id) => {
      const r = readReward(c, id);
      if (r) this.rewards.push(r);
    });
    this.forgetGone();

    let target: PanelTarget | null = null;
    if (frame.active && me?.alive) {
      const live = this.dismissed.size === 0 ? this.rewards : this.rewards.filter((r) => !this.dismissed.has(r.id));
      target = pickReward(live, me, me.id, trueNow, frame.sight, this.shownId || null);
    }
    if (!target || !me) {
      this.close();
      return;
    }
    const { reward, picked } = target;

    if (picked) {
      const first = this.pickedAt.get(reward.id);
      if (first === undefined) this.pickedAt.set(reward.id, now);
      else if (now - first >= PICKED_HOLD_MS) {
        // The result has been read: the chest stays in the world (its ring and timer), the panel does not come back for it.
        this.dismissed.add(reward.id);
        this.close();
        return;
      }
    }
    if (this.pending && (picked || this.pending.chest !== reward.id || now - this.pending.at >= PENDING_EXPIRE_MS)) {
      if (!picked && this.pending.chest === reward.id) this.noteRefused(NOT_CONFIRMED_SAY, now);
      this.pending = null;
    }
    if (this.refused !== null && now - this.refusedAt >= REFUSED_HOLD_MS) this.refused = null;

    this.current = target;
    this.greyed = isGreyed(reward.expiresAt, trueNow, rtt);
    this.render(target, me, trueNow, frame);
  }

  /** The round trip, as a usable number (a scene's estimate may be NaN before its first measure). */
  private rttMs(): number {
    return usableRtt(this.rtt());
  }

  /** Forgets what it kept for a chest that is gone. */
  private forgetGone(): void {
    if (this.pickedAt.size === 0 && this.dismissed.size === 0) return;
    const live = new Set(this.rewards.map((r) => r.id));
    for (const id of [...this.pickedAt.keys()]) if (!live.has(id)) this.pickedAt.delete(id);
    for (const id of [...this.dismissed]) if (!live.has(id)) this.dismissed.delete(id);
  }

  private close(): void {
    this.current = null;
    this.currentCards = [];
    this.greyed = false;
    this.pending = null;
    this.refused = null;
    if (this.element.hidden) return;
    this.element.hidden = true;
    this.shownId = "";
    this.keyFocus = null;
    this.leave();
  }

  private render(target: PanelTarget, me: ChestPanelMe, trueNow: number, frame: ChestPanelFrame): void {
    const { reward, picked } = target;
    if (this.element.hidden) {
      this.element.hidden = false;
      this.openedAt = this.now();
      this.keyTitle = "";
      this.keyStatus = "";
    }
    this.shownId = reward.id;

    const closed = picked || this.greyed || this.pending !== null;
    const cards = optionCards(reward, { myId: me.id, build: me.build, closed });
    this.currentCards = cards;
    while (this.cards.length < cards.length) this.addCard();
    this.cards.forEach((card, i) => this.paintCard(card, cards[i] ?? null, frame, i));

    // The header: the camp's zone and name.
    const camp: CampDef | undefined = this.map?.camps[reward.camp - 1];
    const title = camp ? campTitle(camp) : "Camp chest";
    const headKey = `${title}|${camp?.zone ?? ""}`;
    if (headKey !== this.keyTitle) {
      this.keyTitle = headKey;
      this.title.textContent = title;
      if (camp) setPoolGlyph(this.headGlyph, camp.zone);
      this.headGlyph.hidden = !camp;
    }

    const left = reward.expiresAt - trueNow;
    const text = formatCountdown(left);
    if (text !== this.keyTimer) {
      this.keyTimer = text;
      this.timer.textContent = text;
      this.timer.classList.toggle("urgent", left <= URGENT_SECONDS * 1000);
    }
    // Quantized to a half percent: a frame that moves the bar by less writes nothing.
    const share = Math.round(timeShare(reward.expiresAt, trueNow, CHEST_SECONDS * 1000) * 200) / 200;
    if (share !== this.keyBar) {
      this.keyBar = share;
      this.bar.style.setProperty("--cp-progress", String(share));
    }

    const mine = picked ? myPick(reward, me.id, me.build) : null;
    const idle = !picked && this.pending === null && this.refused === null && !this.greyed;
    const status = idle && this.gloss !== null ? this.gloss : statusText({
      picked: picked ? mine ?? "skip" : null,
      pending: this.pending !== null,
      refused: this.refused,
      greyed: this.greyed,
      anyPickable: cards.some((c) => c.pickable),
    });
    if (status !== this.keyStatus) {
      this.keyStatus = status;
      this.status.textContent = status;
    }

    const canSkip = !picked && !this.greyed && this.pending === null;
    const skipSig = `${canSkip}|${picked}`;
    if (skipSig !== this.keySkip) {
      this.keySkip = skipSig;
      this.skipButton.disabled = !canSkip;
      this.skipButton.setAttribute("aria-disabled", String(!canSkip));
      this.skipButton.classList.toggle("done", picked);
    }

    const focused = this.focused;
    if (focused !== this.keyFocus) {
      this.keyFocus = focused;
      this.element.classList.toggle("focused", focused);
      this.hintIdle.hidden = focused;
      this.hintFocus.hidden = !focused;
    }
  }

  private paintCard(card: Card, data: OptionCard | null, frame: ChestPanelFrame, index: number): void {
    if (!data) {
      if (!card.root.hidden) card.root.hidden = true;
      card.sig = "";
      return;
    }
    const { view, state } = data;
    const taker = state.kind === "taken" ? frame.nameOf(state.by) ?? "" : "";
    const sending = this.pending?.pick === index;
    const sig = `${data.id}|${view?.why.text ?? ""}|${view?.blocked?.text ?? ""}|${state.kind}|${taker}|${data.pickable}|${this.greyed}|${sending}`;
    if (sig === card.sig) return;
    card.sig = sig;
    card.root.hidden = false;
    const name = view?.title ?? "Unknown card";
    const badge = tierBadge(view);
    const kind = kindLine(view);
    const stateLine = sending ? "Sending..." : stateText(state, () => taker || undefined);
    card.name.textContent = name;
    const rarity = rarityFrame(view);
    card.flair.textContent = rarity === "gold" ? "\u2726" : rarity === "silver" ? "\u25C6" : rarity === "plain" ? "\u25C7" : "";
    card.flair.hidden = rarity === null;
    card.tier.textContent = badge;
    card.tier.hidden = badge === "";
    card.kind.textContent = kind;
    card.text.textContent = view?.text ?? "";
    this.paintTags(card, view);
    card.state.textContent = stateLine;
    card.state.hidden = stateLine === "";
    card.root.className = `cp-card ${state.kind}${rarity === null ? "" : ` rarity-${rarity}`}${data.pickable ? "" : " off"}${this.greyed ? " greyed" : ""}${sending ? " sending" : ""}`;
    card.root.disabled = !data.pickable;
    card.root.setAttribute("aria-disabled", String(!data.pickable));
    const label = [`${index + 1}. ${name}`, badge && `Tier ${badge}`, kind, view?.text, stateLine].filter(Boolean).join(". ");
    card.root.setAttribute("aria-label", label);
    card.root.title = cardTitleAttr(view, stateLine);
  }

  /**
   * The card's tag chips. A hover (mouse) or a tap on one shows its glossary line in the status line; a tap on a chip does not pick the
   * card (it is part of the card's button, so the click is stopped here). A chip leaves nothing behind when its card is repainted.
   */
  private paintTags(card: Card, view: CardOptionView | null): void {
    const chips = tagChips(view).map((t) => {
      const chip = el("span", `cp-tag tag-${t.tag}`, t.label);
      chip.addEventListener("pointerenter", () => this.setGloss(t.gloss));
      chip.addEventListener("pointerleave", () => this.setGloss(null));
      chip.addEventListener("click", (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
        this.setGloss(t.gloss);
      });
      return chip;
    });
    card.tags.replaceChildren(...chips);
    card.tags.hidden = chips.length === 0;
    // A repainted card drops the chip the gloss was for (render() writes the status line right after the cards).
    this.gloss = null;
  }

  /** The glossary line a tag chip is showing in the status line now (null: none). */
  private setGloss(text: string | null): void {
    if (text === this.gloss) return;
    this.gloss = text;
    this.refresh();
  }

  // -------------------------------------------------------------------------------------------------------------- picks

  /** Takes card `index` (0-based). True when the order was sent. */
  pick(index: number): boolean {
    const card = this.currentCards[index];
    if (!this.current || !card?.pickable) return false;
    return this.choose(this.current.reward.id, index);
  }

  /** Skips the chest (a skip is this player's pick). True when the order was sent. */
  skip(): boolean {
    const t = this.current;
    if (!t || t.picked || this.greyed || this.pending !== null) return false;
    return this.choose(t.reward.id, -1);
  }

  private choose(chest: string, pick: number): boolean {
    const now = this.now();
    if (!this.canSend()) {
      this.noteRefused(RECONNECTING_SAY, now);
      this.refresh();
      return false;
    }
    this.refused = null;
    this.pending = { chest, pick, at: now };
    this.send({ chest, pick });
    this.refresh();
    return true;
  }

  /**
   * The server's `toast` text, while a pick waits for its answer: one of the chest's refusals ("Already taken", "Too far away";
   * shared CHEST_REFUSALS). Any other toast (a GV line, a kill) is not the answer to the pick. True when it was ours.
   */
  noteToast(text: string): boolean {
    const p = this.pending;
    if (!p || !isChestRefusal(text)) return false;
    this.pending = null;
    this.noteRefused(text, this.now());
    this.refresh();
    return true;
  }

  private noteRefused(text: string, now: number): void {
    this.refused = text;
    this.refusedAt = now;
  }

  /** Repaints from the frame in hand, right after something changed here (a click), instead of waiting for the next frame. */
  private refresh(): void {
    if (this.frame && this.current) {
      const f = this.frame;
      const me = f.me;
      if (me) this.render(this.current, me, trueServerNow(f.serverNow, this.rttMs()), f);
    }
  }

  // ---------------------------------------------------------------------------------------------------------- the keyboard

  /** Takes the keyboard (C): the digits and Esc are the panel's until it gives it back. False while the panel is closed. */
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

  /** The cards and Skip are in the Tab order only while the panel has the keyboard (C): -1 otherwise. */
  private setTabbable(on: boolean): void {
    if (on === this.tabbable) return;
    this.tabbable = on;
    const index = on ? 0 : -1;
    for (const card of this.cards) card.root.tabIndex = index;
    this.skipButton.tabIndex = index;
  }

  private readonly onFocusOut = (e: Event): void => {
    const to = (e as { relatedTarget?: unknown }).relatedTarget as Node | null | undefined;
    if (!to || !this.element.contains(to)) this.setTabbable(false);
  };

  /**
   * The page's focus is inside one of its dialogs (the help card, the settings card): C is not the panel's then. A button left
   * focused after a click is not one (clicking the fullscreen button must not take C away).
   */
  private foreignFocus(): boolean {
    const active = document.activeElement as { closest?: (selector: string) => unknown } | null;
    if (!active || this.element.contains(active as unknown as Node)) return false;
    return typeof active.closest === "function" && active.closest('[role="dialog"]') !== null;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    // Whatever key this is (a Tab included, which this capturing listener sees before the browser moves the focus): with the
    // keyboard not in the panel (a click on the canvas took it away from the panel itself), its buttons are not in the Tab order.
    if (this.tabbable && !this.focused) this.setTabbable(false);
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || this.element.hidden) return;
    if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
    const action = chestKeyAction(e.code, { focused: this.focused, foreign: this.foreignFocus(), shift: e.shiftKey });
    if (!action) return;
    // The key is spent: the scene behind must not also read it.
    e.preventDefault();
    e.stopImmediatePropagation();
    switch (action.kind) {
      case "toggle":
        if (this.focused) this.leave();
        else this.focus();
        break;
      case "leave":
        this.leave();
        break;
      // A pick or a skip that was sent hands the keyboard back at once, like a mouse click: the digits are the weapon slots
      // again while the summary shows (a refusal costs one C to try again).
      case "skip":
        if (this.skip()) this.leave();
        else this.say("You can't skip this chest now.");
        break;
      case "pick":
        if (this.pick(action.index)) this.leave();
        else this.say(`Option ${action.index + 1} is not available.`);
        break;
    }
    this.refresh();
  };

  private say(text: string): void {
    this.noteRefused(text, this.now());
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKeyDown, true);
    for (const off of this.unsubscribers.splice(0)) off();
    this.leave();
    this.element.remove();
  }
}
