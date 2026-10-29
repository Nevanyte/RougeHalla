// The practice console of the training room: a collapsed "Console" button that opens a small panel to set mob-stat stacks and
// interactive augments, spawn a practice camp, drop an augment chest and clear it all. It only sends
// `train` messages (shared/messages.ts TrainMessage); the server applies them in a training room and drops them anywhere else, so
// nothing here decides an outcome. DOM only. The TrainingBar builds it for a training room alone, so an arena run never has one.
//
// It takes no key of the game's: nothing here listens for a game key, and Escape is the one key it handles (it hands the focus
// back to the game; the next Escape leaves training as ever). A select the mouse has just changed gives up its focus at once,
// because a focused select blocks the game's keys (RaidScene.isTyping) and Phaser's canvas never takes the focus back by itself.
// The panel is click-through like the rest of the bar: only the buttons and the selects take the pointer.
import {
  BASE_TITLES, CARDS, FACTIONS, MOB_ROLE_DEFS, MOB_TYPES, REGION_FACTIONS, TRAIN_CARD_COUNT_CHOICES, TRAIN_DEFAULT_CARD_COUNT,
  TRAIN_MAX_CARD_COUNT, TRAIN_MOB_STAT_CHOICES, WEAPONS, cardDef, cardLive, isFactionId, isInteractiveAugment, mobStatReward, tagLabel, tierRoman,
  type CardDef, type CardKind, type MobTypeDef, type TrainMessage,
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

/** The 30 mob types grouped by zone (zone order, each zone's four normals then its two elites): the camp picker. */
export function mobTypeGroups(): Array<ConsoleGroup<MobTypeDef>> {
  return REGION_FACTIONS.map((zone) => ({ label: zoneLabel(zone), items: MOB_TYPES.filter((t) => t.zone === zone) }));
}

const CARD_GROUPS: ReadonlyArray<{ kind: CardKind; label: string }> = [
  { kind: "augment", label: "Interactive augments" },
];

/** The interactive augments offered by training chests, in catalog order. */
export function cardGroups(): Array<ConsoleGroup<CardDef>> {
  return CARD_GROUPS.map(({ kind, label }) => ({ label, items: CARDS.filter((c) => c.kind === kind && isInteractiveAugment(c)) }));
}

/** A mob type's option text: its name, "elite" for a zone's elite, its role and the weapon it carries ("Ember Imp (swarm, axe)"). */
export function mobTypeLabel(t: MobTypeDef): string {
  const role = MOB_ROLE_DEFS[t.role].label.toLowerCase();
  return `${t.name} (${t.elite ? "elite, " : ""}${role}, ${WEAPONS[t.weapon].name.toLowerCase()})`;
}

/** What a mob type is, for its option's tooltip: the zone, the role's line and the weapon a kill drops. */
export function mobTypeHint(t: MobTypeDef): string {
  const weapon = WEAPONS[t.weapon].name.toLowerCase();
  const reward = mobStatReward(t.id);
  return `${t.name}, ${t.elite ? "an elite of the " : "a mob of the "}${zoneLabel(t.zone)}. ${MOB_ROLE_DEFS[t.role].blurb} Carries ${/^[aeiou]/.test(weapon) ? "an" : "a"} ${weapon}, which a kill can drop.${reward ? ` Each kill grants ${reward.text}; capped at 10 per type.` : " Elite death drops an augment chest and grants no fixed mob stat."}`;
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
  const tags = def.tags.length > 0 ? ` Tags: ${def.tags.map(tagLabel).join(", ")} (H, Mechanics page).` : "";
  const note = cardLive(def) ? "" : " Not live yet: it is set but does nothing.";
  return `${head} ${text}${copies}${needs}${tags}${note}`;
}

/** The messages the buttons send, one function each so the shapes are in one place. */
export const trainMessages = {
  card: (id: string, count: number): TrainMessage => ({ cmd: "card", id, count }),
  stat: (id: string, count: number): TrainMessage => ({ cmd: "stat", id, count }),
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
  private readonly statCountSelect = el("select", "train-select train-stat-count");
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
    this.toggle.title = "Practice console: set mob-stat stacks and augments, spawn a camp, drop an augment chest";
    this.toggle.setAttribute("aria-expanded", "false");
    this.toggle.setAttribute("aria-controls", panelId);
    this.toggle.addEventListener("click", (ev) => { this.setOpen(!this.opened); this.releaseFocus(ev, this.toggle); });

    this.fillMobTypes();
    this.fillCards();
    this.fillCounts();
    for (const n of TRAIN_MOB_STAT_CHOICES) this.statCountSelect.append(this.option(String(n), `${n} ${n === 1 ? "kill" : "kills"}`, `Set this mob type to ${n} kill stacks`));
    this.statCountSelect.append(this.option("0", "Remove", "Remove this mob type's training stacks"));
    this.statCountSelect.value = "1";
    this.statCountSelect.setAttribute("aria-label", "Mob stat kill stacks");

    this.panel.append(
      this.title("Camps"),
      this.row("Mob type", this.mobSelect, this.button("train-btn-camp", "Spawn camp", "A practice camp: normal kills grant fixed stats; an elite death drops an augment chest. Camp clears do not drop chests", () => this.spawnCamp())),
      this.row("Kill stacks", this.statCountSelect, this.button("train-btn-stat", "Set stacks", "Set the selected normal mob's fixed stat stacks (0 to 10)", () => this.setStat())),
      this.title("Cards and chests"),
      this.row("Card", this.cardSelect),
      this.row("Copies", this.countSelect, this.button("train-btn-card", "Set card", "Set how many copies of this card you hold", () => this.setCard())),
      this.cardHintLine,
      this.row(
        "Chest",
        this.button("train-btn-chest-pick", "With augment", "Drop an augment chest offering only the augment picked above", () => this.dropChest(true)),
        this.button("train-btn-chest-random", "Random", "Drop an augment chest with three rolled options", () => this.dropChest(false)),
      ),
      this.row("", this.button("train-btn-clear", "Clear all", "Remove every card, practice mob and chest", () => this.clear())),
    );

    for (const select of [this.mobSelect, this.cardSelect, this.countSelect, this.statCountSelect]) this.wireSelect(select);
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

  setStat(): void { this.send(trainMessages.stat(this.mobSelect.value, Number(this.statCountSelect.value))); }

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
      for (const t of g.items) group.append(this.option(t.id, mobTypeLabel(t), mobTypeHint(t)));
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
    this.cardSelect.value = cardGroups()[0]!.items[0]?.id ?? "";
    this.cardSelect.setAttribute("aria-label", "Interactive augment");
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
