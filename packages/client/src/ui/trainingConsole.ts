// The practice console of the training room (roguelike R4a/R5): a collapsed "Console" button in the training bar that opens a small
// panel to set a mob type's buff, set a passive's rank, spawn a practice camp, drop a skill chest and clear it all. It only sends
// `train` messages (shared/messages.ts TrainMessage); the server applies them in a training room and drops them anywhere else, so
// nothing here decides an outcome. DOM only. The TrainingBar builds it for a training room alone, so an arena run never has one.
//
// It takes no key of the game's: nothing here listens for a game key, and Escape is the one key it handles (it hands the focus
// back to the game; the next Escape leaves training as ever). A select the mouse has just changed gives up its focus at once,
// because a focused select blocks the game's keys (RaidScene.isTyping) and Phaser's canvas never takes the focus back by itself.
// The panel is click-through like the rest of the bar: only the buttons and the selects take the pointer.
import {
  buffDef, buffText, MOB_TYPES, REGION_FACTIONS, skillDef, skillLive, skillText, SKILLS, TRAIN_DEFAULT_RANK, TRAIN_DEFAULT_STACKS,
  TRAIN_MAX_STACKS, TRAIN_STACK_CHOICES, type MobTypeDef, type SkillDef, type TrainMessage,
} from "@raid/shared";
import { zoneLabel } from "./buffTip";
import { el } from "./dom";
import "./trainingConsole.css";

export type SendTrain = (msg: TrainMessage) => void;

// ------------------------------------------------------------------------------------------------------ pure parts

export interface ConsoleGroup<T> { label: string; items: T[] }

/** The 20 mob types grouped by zone (zone order, each zone's three normals then its elite): the buff and camp picker. */
export function mobTypeGroups(): Array<ConsoleGroup<MobTypeDef>> {
  return REGION_FACTIONS.map((zone) => ({ label: zoneLabel(zone), items: MOB_TYPES.filter((t) => t.zone === zone) }));
}

/** The 21 passives grouped by the pool that offers them (the five zones, then the neutrals). */
export function skillGroups(): Array<ConsoleGroup<SkillDef>> {
  const groups: Array<ConsoleGroup<SkillDef>> = REGION_FACTIONS.map((zone) => ({
    label: zoneLabel(zone), items: SKILLS.filter((s) => s.pool === zone),
  }));
  groups.push({ label: "Neutral", items: SKILLS.filter((s) => s.pool === "neutral") });
  return groups;
}

/** A mob type's option text: its name, "(elite)" for a zone's elite. */
export function mobTypeLabel(t: MobTypeDef): string {
  return t.elite ? `${t.name} (elite)` : t.name;
}

/** A passive's option text: its name, "(not live)" while the server does not apply it. */
export function skillLabel(s: SkillDef): string {
  return skillLive(s) ? s.name : `${s.name} (not live)`;
}

/** What setting `stacks` of the mob type's buff does, in the buff's own words; the pending ones say so. "" for an unknown id. */
export function buffHint(id: string, stacks: number): string {
  const def = buffDef(id);
  if (!def) return "";
  const head = `${def.name} (${def.elite ? "elite, " : ""}${zoneLabel(def.zone)})`;
  const body = stacks > 0 ? `${stacks} stack${stacks === 1 ? "" : "s"}: ${buffText(id, stacks)}` : "taken off";
  const note = def.needs === "status" ? " Not applied yet: the status system is coming." : "";
  return `${head} ${body}.${note}`;
}

/** What rank `rank` of the passive does, for the player's faction; "not live" ones say they are set but do nothing. */
export function passiveHint(id: string, rank: number, faction?: string): string {
  const def = skillDef(id);
  if (!def) return "";
  const pool = def.pool === "neutral" ? "Neutral" : zoneLabel(def.pool);
  const body = rank > 0 ? `rank ${rank}: ${skillText(id, rank, faction)}` : "taken off";
  const note = skillLive(def) ? "" : " Not live yet: it is set but does nothing.";
  return `${def.name} (${pool}) ${body}.${note}`;
}

/** The messages the buttons send, one function each so the shapes are in one place. */
export const trainMessages = {
  buff: (id: string, amount: number): TrainMessage => ({ cmd: "buff", id, amount }),
  passive: (id: string, rank: number): TrainMessage => ({ cmd: "passive", id, rank }),
  camp: (id: string): TrainMessage => ({ cmd: "camp", id }),
  chest: (options?: readonly string[]): TrainMessage => (options && options.length > 0 ? { cmd: "chest", options: [...options] } : { cmd: "chest" }),
  clear: (): TrainMessage => ({ cmd: "clear" }),
} as const;

/** The ranks the picker offers: 1 and 2 and 0 for "remove". */
const RANK_CHOICES: ReadonlyArray<{ value: number; text: string }> = [
  { value: 1, text: "Rank 1" }, { value: 2, text: "Rank 2" }, { value: 0, text: "Remove" },
];

/** The stack counts the picker offers: the shared choices, and 0 for "remove". */
const STACK_CHOICES: ReadonlyArray<{ value: number; text: string }> = [
  ...TRAIN_STACK_CHOICES.map((n) => ({ value: n, text: `${n} stack${n === 1 ? "" : "s"}` })),
  { value: 0, text: "Remove" },
];

// ---------------------------------------------------------------------------------------------------------- the DOM

export interface ConsoleOptions {
  /** The local player's faction (a passive's line is worded for it: Pestilence reads differently for Plague). */
  faction?: () => string | undefined;
  /** The panel opened or closed (the bar hides its tips while the panel is open). */
  onToggle?: (open: boolean) => void;
}

export class TrainingConsole {
  readonly root = el("div", "train-console");
  private readonly toggle = el("button", "btn small train-toggle");
  private readonly panel = el("div", "train-panel");
  private readonly mobSelect = el("select", "train-select train-mob");
  private readonly stacksSelect = el("select", "train-select train-stacks");
  private readonly buffHintLine = el("div", "train-hint train-hint-buff");
  private readonly skillSelect = el("select", "train-select train-skill");
  private readonly rankSelect = el("select", "train-select train-rank");
  private readonly skillHintLine = el("div", "train-hint train-hint-skill");
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
    this.toggle.title = "Practice console: set buffs and passives, spawn a camp, drop a chest";
    this.toggle.setAttribute("aria-expanded", "false");
    this.toggle.setAttribute("aria-controls", panelId);
    this.toggle.addEventListener("click", (ev) => { this.setOpen(!this.opened); this.releaseFocus(ev, this.toggle); });

    this.fillMobTypes();
    this.fillStacks();
    this.fillSkills();
    this.fillRanks();

    this.panel.append(
      this.title("Buffs and camps"),
      this.row("Mob type", this.mobSelect),
      this.row("Stacks", this.stacksSelect, this.button("train-btn-buff", "Set buff", "Set this many stacks of the mob type's buff", () => this.setBuff())),
      this.row("", this.button("train-btn-camp", "Spawn camp", "A practice camp of this mob type near you: it pays nothing", () => this.spawnCamp())),
      this.buffHintLine,
      this.title("Passives and chests"),
      this.row("Passive", this.skillSelect),
      this.row("Rank", this.rankSelect, this.button("train-btn-passive", "Set passive", "Set this passive's rank on your build", () => this.setPassive())),
      this.skillHintLine,
      this.row(
        "Chest",
        this.button("train-btn-chest-pick", "With passive", "Drop a skill chest offering only the passive picked above", () => this.dropChest(true)),
        this.button("train-btn-chest-random", "Random", "Drop a skill chest with three random live options for your faction", () => this.dropChest(false)),
      ),
      this.row("", this.button("train-btn-clear", "Clear all", "Remove every buff, passive, practice mob and chest", () => this.clear())),
    );

    for (const select of [this.mobSelect, this.stacksSelect, this.skillSelect, this.rankSelect]) this.wireSelect(select);
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

  /** Words the two hint lines (and the selects' tooltips) for what is picked now. Runs on every change of a select. */
  refresh(): void {
    const mob = this.mobSelect.value;
    const stacks = this.stacks();
    const buff = buffHint(mob, stacks);
    this.buffHintLine.textContent = buff;
    this.mobSelect.title = buff;
    this.stacksSelect.title = buff;
    const skill = this.skillSelect.value;
    const passive = passiveHint(skill, this.rank(), this.opts.faction?.());
    this.skillHintLine.textContent = passive;
    this.skillSelect.title = passive;
    this.rankSelect.title = passive;
  }

  setBuff(): void {
    this.send(trainMessages.buff(this.mobSelect.value, this.stacks()));
  }

  spawnCamp(): void {
    this.send(trainMessages.camp(this.mobSelect.value));
  }

  setPassive(): void {
    this.send(trainMessages.passive(this.skillSelect.value, this.rank()));
  }

  /** `withPassive`: offer only the picked passive; else the server rolls three. */
  dropChest(withPassive: boolean): void {
    this.send(trainMessages.chest(withPassive ? [this.skillSelect.value] : undefined));
  }

  clear(): void {
    this.send(trainMessages.clear());
  }

  destroy(): void {
    this.root.remove();
  }

  // -------------------------------------------------------------------------------------------------------- building

  private stacks(): number {
    const n = Number(this.stacksSelect.value);
    return Number.isFinite(n) ? Math.min(TRAIN_MAX_STACKS, Math.max(0, n)) : TRAIN_DEFAULT_STACKS;
  }

  private rank(): number {
    const n = Number(this.rankSelect.value);
    return n === 0 || n === 1 || n === 2 ? n : TRAIN_DEFAULT_RANK;
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
      for (const t of g.items) group.append(this.option(t.id, mobTypeLabel(t), buffHint(t.id, TRAIN_DEFAULT_STACKS)));
      this.mobSelect.append(group);
    }
    this.mobSelect.value = MOB_TYPES[0]!.id;
    this.mobSelect.setAttribute("aria-label", "Mob type");
  }

  private fillStacks(): void {
    for (const c of STACK_CHOICES) this.stacksSelect.append(this.option(String(c.value), c.text, ""));
    this.stacksSelect.value = String(TRAIN_DEFAULT_STACKS);
    this.stacksSelect.setAttribute("aria-label", "Stacks");
  }

  private fillSkills(): void {
    const faction = (): string | undefined => this.opts.faction?.();
    for (const g of skillGroups()) {
      const group = el("optgroup");
      group.label = g.label;
      for (const s of g.items) group.append(this.option(s.id, skillLabel(s), passiveHint(s.id, 1, faction())));
      this.skillSelect.append(group);
    }
    // The first live passive (the ones before it are catalog data the sim does not apply yet).
    this.skillSelect.value = (SKILLS.find(skillLive) ?? SKILLS[0]!).id;
    this.skillSelect.setAttribute("aria-label", "Passive");
  }

  private fillRanks(): void {
    for (const c of RANK_CHOICES) this.rankSelect.append(this.option(String(c.value), c.text, ""));
    this.rankSelect.value = String(TRAIN_DEFAULT_RANK);
    this.rankSelect.setAttribute("aria-label", "Rank");
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
