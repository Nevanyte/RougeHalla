// The practice console of the training room (roguelike R4a/R5): a collapsed "Console" button in the training bar that opens a small
// panel to set how many copies of a card the player holds, spawn a practice camp, drop a card chest and clear it all. It only sends
// `train` messages (shared/messages.ts TrainMessage); the server applies them in a training room and drops them anywhere else, so
// nothing here decides an outcome. DOM only. The TrainingBar builds it for a training room alone, so an arena run never has one.
//
// It takes no key of the game's: nothing here listens for a game key, and Escape is the one key it handles (it hands the focus
// back to the game; the next Escape leaves training as ever). A select the mouse has just changed gives up its focus at once,
// because a focused select blocks the game's keys (RaidScene.isTyping) and Phaser's canvas never takes the focus back by itself.
// The panel is click-through like the rest of the bar: only the buttons and the selects take the pointer.
import {
  BASE_TITLES, CARDS, FACTIONS, MOB_TYPES, REGION_FACTIONS, TRAIN_CARD_COUNT_CHOICES, TRAIN_DEFAULT_CARD_COUNT, TRAIN_MAX_CARD_COUNT,
  cardDef, cardLive, isFactionId, tierRoman, type CardDef, type CardKind, type MobTypeDef, type TrainMessage,
} from "@raid/shared";
import { cardKindLabel } from "./chestMath";
import { el } from "./dom";
import "./trainingConsole.css";

export type SendTrain = (msg: TrainMessage) => void;

// ------------------------------------------------------------------------------------------------------ pure parts

export interface ConsoleGroup<T> { label: string; items: T[] }

/** A zone as the picker words it: "Demon Blood zone". */
export function zoneLabel(zone: string): string {
  return `${isFactionId(zone) ? FACTIONS[zone].displayName : zone} zone`;
}

/** The 20 mob types grouped by zone (zone order, each zone's three normals then its elite): the camp picker. */
export function mobTypeGroups(): Array<ConsoleGroup<MobTypeDef>> {
  return REGION_FACTIONS.map((zone) => ({ label: zoneLabel(zone), items: MOB_TYPES.filter((t) => t.zone === zone) }));
}

const CARD_GROUPS: ReadonlyArray<{ kind: CardKind; label: string }> = [
  { kind: "base", label: "Base cards" }, { kind: "conditional", label: "Conditional cards" }, { kind: "augment", label: "Augments" },
];

/** The 75 cards grouped by kind (base, conditional, augment), each in catalog order. */
export function cardGroups(): Array<ConsoleGroup<CardDef>> {
  return CARD_GROUPS.map(({ kind, label }) => ({ label, items: CARDS.filter((c) => c.kind === kind) }));
}

/** A mob type's option text: its name, "(elite)" for a zone's elite. */
export function mobTypeLabel(t: MobTypeDef): string {
  return t.elite ? `${t.name} (elite)` : t.name;
}

/** A card's option text: its title, "(not live yet)" while the server does not apply it. */
export function cardLabel(c: CardDef): string {
  return cardLive(c) ? c.title : `${c.title} (not live yet)`;
}

/** What holding `count` copies of the card does, in its own words; a card that does nothing yet says so. "" for an unknown id. */
export function cardHint(id: string, count: number): string {
  const def = cardDef(id);
  if (!def) return "";
  const head = `${def.title} (${cardKindLabel(def.kind)}, tier ${tierRoman(def.tier)})`;
  if (count <= 0) return `${head} taken off.`;
  const text = /[.!?]$/.test(def.text) ? def.text : `${def.text}.`;
  const copies = !def.unique && count > 1 ? ` Held x${count}.` : "";
  const needs = def.requires ? ` Needs a ${BASE_TITLES[def.requires]} card first.` : "";
  const note = cardLive(def) ? "" : " Not live yet: it is set but does nothing.";
  return `${head} ${text}${copies}${needs}${note}`;
}

/** The messages the buttons send, one function each so the shapes are in one place. */
export const trainMessages = {
  card: (id: string, count: number): TrainMessage => ({ cmd: "card", id, count }),
  camp: (id: string): TrainMessage => ({ cmd: "camp", id }),
  chest: (options?: readonly string[]): TrainMessage => (options && options.length > 0 ? { cmd: "chest", options: [...options] } : { cmd: "chest" }),
  clear: (): TrainMessage => ({ cmd: "clear" }),
} as const;

/** The copy counts the picker offers: the shared choices, and 0 for "remove". */
const COUNT_CHOICES: ReadonlyArray<{ value: number; text: string }> = [
  ...TRAIN_CARD_COUNT_CHOICES.map((n) => ({ value: n, text: `${n} ${n === 1 ? "copy" : "copies"}` })),
  { value: 0, text: "Remove" },
];

// ---------------------------------------------------------------------------------------------------------- the DOM

export interface ConsoleOptions {
  /** The panel opened or closed (the bar hides its tips while the panel is open). */
  onToggle?: (open: boolean) => void;
}

export class TrainingConsole {
  readonly root = el("div", "train-console");
  private readonly toggle = el("button", "btn small train-toggle");
  private readonly panel = el("div", "train-panel");
  private readonly mobSelect = el("select", "train-select train-mob");
  private readonly cardSelect = el("select", "train-select train-card");
  private readonly countSelect = el("select", "train-select train-count");
  private readonly cardHintLine = el("div", "train-hint train-hint-card");
  private opened = false;
  /** The selects the pointer went down on since their last change: that change is a mouse choice, and gives the focus back to the game. */
  private readonly pointerOn = new Set<HTMLSelectElement>();

  constructor(private readonly send: SendTrain, private readonly opts: ConsoleOptions = {}) {
    const panelId = "train-panel";
    this.panel.id = panelId;
    this.panel.setAttribute("role", "group");
    this.panel.setAttribute("aria-label", "Practice console");
    this.panel.hidden = true;

    this.toggle.type = "button";
    this.toggle.textContent = "Console";
    this.toggle.title = "Practice console: set cards, spawn a camp, drop a chest";
    this.toggle.setAttribute("aria-expanded", "false");
    this.toggle.setAttribute("aria-controls", panelId);
    this.toggle.addEventListener("click", (ev) => { this.setOpen(!this.opened); this.releaseFocus(ev, this.toggle); });

    this.fillMobTypes();
    this.fillCards();
    this.fillCounts();

    this.panel.append(
      this.title("Camps"),
      this.row("Mob type", this.mobSelect, this.button("train-btn-camp", "Spawn camp", "A practice camp of this mob type near you: it pays nothing", () => this.spawnCamp())),
      this.title("Cards and chests"),
      this.row("Card", this.cardSelect),
      this.row("Copies", this.countSelect, this.button("train-btn-card", "Set card", "Set how many copies of this card you hold", () => this.setCard())),
      this.cardHintLine,
      this.row(
        "Chest",
        this.button("train-btn-chest-pick", "With card", "Drop a card chest offering only the card picked above", () => this.dropChest(true)),
        this.button("train-btn-chest-random", "Random", "Drop a card chest with three rolled options", () => this.dropChest(false)),
      ),
      this.row("", this.button("train-btn-clear", "Clear all", "Remove every card, practice mob and chest", () => this.clear())),
    );

    for (const select of [this.mobSelect, this.cardSelect, this.countSelect]) this.wireSelect(select);
    this.panel.addEventListener("keydown", (ev) => this.onKeyDown(ev as KeyboardEvent));
    this.root.append(this.toggle, this.panel);
    this.refresh();
  }

  get isOpen(): boolean {
    return this.opened;
  }

  setOpen(open: boolean): void {
    if (open === this.opened) return;
    this.opened = open;
    this.panel.hidden = !open;
    this.toggle.setAttribute("aria-expanded", String(open));
    this.opts.onToggle?.(open);
  }

  /** Words the hint line (and the selects' tooltips) for what is picked now. Runs on every change of a select. */
  refresh(): void {
    const hint = cardHint(this.cardSelect.value, this.count());
    this.cardHintLine.textContent = hint;
    this.cardSelect.title = hint;
    this.countSelect.title = hint;
  }

  spawnCamp(): void {
    this.send(trainMessages.camp(this.mobSelect.value));
  }

  setCard(): void {
    this.send(trainMessages.card(this.cardSelect.value, this.count()));
  }

  /** `withCard`: offer only the picked card; else the server rolls three. */
  dropChest(withCard: boolean): void {
    this.send(trainMessages.chest(withCard ? [this.cardSelect.value] : undefined));
  }

  clear(): void {
    this.send(trainMessages.clear());
  }

  destroy(): void {
    this.root.remove();
  }

  // -------------------------------------------------------------------------------------------------------- building

  /** The copies to set: the picker's, clamped to the shared range, and at most 1 for a card that is held once (the server caps it the same way). */
  private count(): number {
    const n = Number(this.countSelect.value);
    const copies = Number.isFinite(n) ? Math.min(TRAIN_MAX_CARD_COUNT, Math.max(0, Math.floor(n))) : TRAIN_DEFAULT_CARD_COUNT;
    return cardDef(this.cardSelect.value)?.unique ? Math.min(1, copies) : copies;
  }

  private title(text: string): HTMLElement {
    return el("div", "train-title", text);
  }

  private row(label: string, ...controls: HTMLElement[]): HTMLElement {
    const row = el("div", "train-row");
    const name = el("span", "train-label", label);
    row.append(name, ...controls);
    return row;
  }

  private button(cls: string, text: string, tip: string, act: () => void): HTMLButtonElement {
    const b = el("button", `btn small train-btn ${cls}`, text);
    b.type = "button";
    b.title = tip;
    b.addEventListener("click", (ev) => { act(); this.releaseFocus(ev, b); });
    return b;
  }

  /** A mouse click (detail above 0) hands the focus back to the game; a keyboard activation keeps it where the user is. */
  private releaseFocus(ev: Event, control: HTMLElement): void {
    if (((ev as MouseEvent).detail ?? 0) > 0) control.blur?.();
  }

  private option(value: string, text: string, title: string): HTMLOptionElement {
    const o = el("option", undefined, text);
    o.value = value;
    o.title = title;
    return o;
  }

  private fillMobTypes(): void {
    for (const g of mobTypeGroups()) {
      const group = el("optgroup");
      group.label = g.label;
      for (const t of g.items) group.append(this.option(t.id, mobTypeLabel(t), `${t.name} (${zoneLabel(t.zone)})`));
      this.mobSelect.append(group);
    }
    this.mobSelect.value = MOB_TYPES[0]!.id;
    this.mobSelect.setAttribute("aria-label", "Mob type");
  }

  private fillCards(): void {
    for (const g of cardGroups()) {
      const group = el("optgroup");
      group.label = g.label;
      for (const c of g.items) group.append(this.option(c.id, cardLabel(c), cardHint(c.id, 1)));
      this.cardSelect.append(group);
    }
    // The first live card (the ones after it in the list may be catalog data the sim does not apply yet).
    this.cardSelect.value = (CARDS.find(cardLive) ?? CARDS[0]!).id;
    this.cardSelect.setAttribute("aria-label", "Card");
  }

  private fillCounts(): void {
    for (const c of COUNT_CHOICES) this.countSelect.append(this.option(String(c.value), c.text, ""));
    this.countSelect.value = String(TRAIN_DEFAULT_CARD_COUNT);
    this.countSelect.setAttribute("aria-label", "Copies");
  }

  private wireSelect(select: HTMLSelectElement): void {
    select.addEventListener("pointerdown", () => { this.pointerOn.add(select); });
    select.addEventListener("keydown", () => { this.pointerOn.delete(select); });
    select.addEventListener("change", () => {
      this.refresh();
      // Chosen with the mouse: the game's keys must work again at once. Chosen with the arrow keys: stay, the user is on the control.
      if (this.pointerOn.delete(select)) select.blur?.();
    });
  }

  /** Escape inside the panel hands the focus back to the game and stops there (the scene would otherwise leave training). */
  private onKeyDown(ev: KeyboardEvent): void {
    if (ev.key !== "Escape" && ev.code !== "Escape") return;
    ev.stopPropagation();
    ev.preventDefault?.();
    const active = (typeof document !== "undefined" ? document.activeElement : null) as HTMLElement | null;
    active?.blur?.();
  }
}
