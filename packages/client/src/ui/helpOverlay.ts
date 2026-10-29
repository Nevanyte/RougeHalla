// The H help card: two pages. "Controls" is every control in one table (HELP_SECTIONS), drawn as keycaps; "Mechanics" is the glossary
// behind the cards' tags and the numbers (damage types, damage over time, on-hit, Offense and SO, card power and the PvP factor, what each
// faction's signature and each weapon is), read from shared/glossary.ts so a chip on a card and this page word a term the same way.
// It is a real overlay, but the game keeps running behind it, so it closes with H, Esc, its button or a click outside the card. The
// keys themselves are Chrome's, and so is the stylesheet (chrome.css).
import {
  DAMAGE_TYPE_LINE, FACTIONS, GLOSSARY, MAP_STYLERS, PVP_FMAX, SIGNATURE_TAGS, WEAPONS, WEAPON_TAGS, pvpFactor, tagLabel,
} from "@raid/shared";
import { factorText, weaponScalingText } from "./buildModel";
import { el } from "./dom";
import { renderGround } from "./groundLegend";
import { keycap } from "./keycap";

/** Where a control works. The card lists the current place first. */
export type HelpScope = "run" | "hub" | "anywhere" | "planning";

export interface HelpBinding {
  /** Key or mouse labels in order. A label with "click" in it is drawn as a mouse button. */
  keys: readonly string[];
  /** How several labels read: "+" together (a chord), "/" alternatives (the default), "" side by side. */
  join?: "+" | "/" | "";
  action: string;
}

export interface HelpSection {
  id: HelpScope;
  title: string;
  bindings: readonly HelpBinding[];
}

/** The controls as the scenes handle them (RaidScene.handleKey and its pointer handler, HubScene.handleKeyDown, Chrome). */
export const HELP_SECTIONS: readonly HelpSection[] = [
  {
    id: "run",
    title: "In a run and in practice",
    bindings: [
      { keys: ["W", "A", "S", "D"], action: "Move (arrow keys also work)" },
      { keys: ["Left-click"], action: "Attack cursor; hold to repeat. Wand locks an enemy." },
      { keys: ["Melee"], action: "Swing while moving; no melee attack windup" },
      { keys: ["Range guide"], action: "Soft outlines show your equipped weapon's reach" },
      { keys: ["Right-click"], action: "Move to a point on the ground" },
      { keys: ["1", "2"], action: "Select weapon slot" },
      { keys: ["Q"], action: "Swap weapon" },
      { keys: ["R"], action: "Drink potion: 40% HP over 5 s (small: 25%)" },
      { keys: ["Wind emblem"], action: "Walk over for 5 seconds of extra speed" },
      { keys: ["Plague body"], action: "Walk over bodies to raise, grow or revive your zombie" },
      { keys: ["F"], action: "Pick up the weapon in reach, or talk to a giver" },
      { keys: ["E"], action: "Cast your faction's Wish (5 min cooldown, 5 s in training)" },
      { keys: ["J"], action: "Show or hide the quest log" },
      { keys: ["Enter"], action: "Accept the quest offer open from F" },
      { keys: ["C"], action: "Chest panel: take the keyboard, or give it back" },
      { keys: ["1", "2", "3"], action: "Chest panel (after C): take that card" },
      { keys: ["0"], action: "Chest panel (after C): skip the chest" },
      { keys: ["Hold Tab"], action: "Vision map + ranked roster; click camps to plan your route" },
      { keys: ["Right-click"], action: "On the minimap: move there" },
      { keys: ["Hold left-click"], action: "On the minimap: peek there, release to snap back" },
      { keys: ["Minimap"], action: "Coral: enemy players; dots/counts: mobs; bright: vision" },
      { keys: ["Map clocks"], action: "Gold: chest seconds; blue: respawn seconds after loot" },
      { keys: ["Edge lights"], action: "Visible players: green far → yellow → red close" },
      { keys: ["Camp timers"], action: "Respawn and ward countdowns appear at cleared camps" },
      { keys: ["Camp clear"], action: "Potion stored; ward 2 min; respawn 3 min" },
      { keys: ["Vision"], action: "Walls block sight; your trail sees live enemies for 30 s" },
      { keys: ["Colosseum"], action: "Full arena vision while fighting inside the colosseum" },
      { keys: ["Stat icons"], action: "Green plus: health; blood drop: life steal" },
      { keys: ["Stat icons"], action: "Sword: Offense; sparkle: Soul Offence; bow: attack speed" },
      { keys: ["Stat icons"], action: "Shield: Defense; bubble: Soul Defense; boot: movement" },
      { keys: ["Esc"], action: "Leave practice (training only)" },
    ],
  },
  {
    id: "planning",
    title: "Planning, before the run",
    bindings: [
      { keys: ["1", "2"], action: "Pick the first or second spawn" },
      { keys: ["Click"], action: "On the map: add a route stop; on a stop: take it out" },
      { keys: ["Tab"], action: "Move between the options and buttons" },
      { keys: ["Arrow keys"], action: "Move between the map's markers" },
      { keys: ["Page Up", "Page Down"], action: "Jump to the previous or next zone's camps" },
      { keys: ["Enter"], action: "Press the focused button (Ready, a spawn, a camp)" },
      { keys: ["Delete"], action: "Take out the focused route stop" },
    ],
  },
  {
    id: "hub",
    title: "In the hub",
    bindings: [
      { keys: ["Hold Shift"], action: "Champions guide: show detailed abilities and scaling" },
      { keys: ["WASD", "Arrow keys"], action: "Walk" },
      { keys: ["Right-click"], action: "Walk to the spot (hold to keep steering)" },
      { keys: ["E"], action: "Use the station you stand at" },
      { keys: ["Left-click"], action: "Walk to a station and use it" },
    ],
  },
  {
    id: "anywhere",
    title: "Anywhere",
    bindings: [
      { keys: ["Alt", "Enter"], join: "+", action: "Toggle fullscreen" },
      { keys: ["H"], action: "Show or hide this help" },
      { keys: ["Esc"], action: "Close an open panel" },
    ],
  },
];

// ----------------------------------------------------------------------------------------------------------- the Mechanics page

export type HelpPage = "controls" | "mechanics";

export interface MechanicsEntry {
  /** The term: "Damage over time", "Fire: Burn", "Sword". */
  term: string;
  text: string;
}

export interface MechanicsSection {
  id: "terms" | "power" | "signatures" | "weapons";
  title: string;
  /** One line before the entries. */
  intro?: string;
  entries: readonly MechanicsEntry[];
}

/**
 * The Mechanics page as data: the glossary terms (Offense, SO and every tag), what card power and the PvP factor are, what each faction's
 * signature is made of (SIGNATURE_TAGS) and what each weapon scales with and does (WEAPON_TAGS). Pure; the page draws it.
 */
export function mechanicsSections(): MechanicsSection[] {
  const power = (p: number): string => `${factorText(pvpFactor(p))} at power ${p}`;
  return [
    {
      id: "terms",
      title: "Damage and terms",
      intro: DAMAGE_TYPE_LINE,
      entries: GLOSSARY.map((g) => ({ term: g.term, text: g.text })),
    },
    {
      id: "power",
      title: "Cards, power and the PvP factor",
      entries: [
        {
          term: "Card power",
          text: "Your card power P is the sum of the tiers of the cards you hold, once per copy; live chest rewards are interactive augments. Mob stat stacks and quest rewards do not add power. P sets your PvP damage factor.",
        },
        {
          term: "PvP factor",
          text: `Your damage to other players is multiplied by ${power(0)}, ${power(2)}, ${power(6)}, ${power(10)}, and tops out at ${factorText(PVP_FMAX)}. Mobs, Wishes and the arena's burn are not scaled.`,
        },
        {
          term: "Normal mob rewards",
          text: "Each normal mob kill grants its type's fixed stat reward. Farmed stat stacks have no maximum. Normal camp clears give no chest. The HUD's Normal mob progress catalog lists every reward and your current total.",
        },
        {
          term: "Quest rewards",
          text: "Quests grant fixed mob stat stacks matching their reward and zone, plus their GV. Farmed stacks keep accumulating with every kill and quest.",
        },
        {
          term: "Chests",
          text: "An elite death drops an augment chest with three interactive augments, one pick each, first come first served. Each augment has a rule and may have a cost.",
        },
      ],
    },
    {
      id: "signatures",
      title: "Faction signatures",
      entries: SIGNATURE_TAGS.map((row) => ({
        term: `${FACTIONS[row.faction].displayName}: ${row.signature}`,
        text: row.faction === "sentenced"
          ? `Each landed weapon hit deals a share of the target's max health as true damage. Hits and weapon swaps raise the mark's tiers; later tiers tax attack speed, suppress damage and block executes. ${row.tags.map(tagLabel).join(", ")}.`
          : row.tags.map(tagLabel).join(", "),
      })),
    },
    {
      id: "weapons",
      title: "Weapons",
      intro: "Each point of a stat a weapon scales with adds that much damage a second at base attack speed.",
      entries: WEAPON_TAGS.map((row) => ({
        term: WEAPONS[row.weapon].name,
        text: `Scales with ${weaponScalingText(row.weapon)}. ${row.tags.map(tagLabel).join(", ")}. ${row.note}`,
      })),
    },
  ];
}

/** Section ids in display order: where the player is first (planning follows the run it leads into), the general controls last. */
export function helpSectionOrder(context: HelpScope): HelpScope[] {
  return context === "hub" ? ["hub", "run", "planning", "anywhere"] : ["run", "planning", "hub", "anywhere"];
}

export function isMouseLabel(label: string): boolean {
  return /click/i.test(label);
}

/** The Ground legend documents terrain that exists only on a styled map, so the card carries it only while the zone stylers are on. */
export function groundLegendVisible(): boolean {
  return MAP_STYLERS;
}

export interface HelpOverlayOptions {
  /** Called when the card asks to close itself (its button, a click outside). */
  onClose?: () => void;
  /** Whether the card carries the Ground legend. Defaults to `groundLegendVisible()`; a test passes it to cover both states. */
  ground?: boolean;
}

export class HelpOverlay {
  /** The scrim over the whole overlay; the card sits in it. Hidden while closed. */
  readonly element = el("div", "help-scrim");
  private readonly card = el("div", "help-card");
  private readonly closeButton = el("button", "help-close", "×");
  private readonly sections = new Map<HelpScope, HTMLElement>();
  /** The Ground legend (what each terrain kind does): after the controls, and only when the stylers are on (else null). */
  private readonly ground: HTMLElement | null;
  /** The two pages' bodies and the tabs that switch between them. */
  private readonly controlsPage = el("div", "help-body");
  private readonly mechanicsPage = el("div", "help-body help-mechanics");
  private readonly tabs = new Map<HelpPage, HTMLButtonElement>();
  private current: HelpPage = "controls";

  constructor(private readonly options: HelpOverlayOptions = {}) {
    const head = el("div", "help-head");
    const title = el("h2", "help-title", "Help");
    title.id = "help-title";
    this.closeButton.type = "button";
    this.closeButton.setAttribute("aria-label", "Close help");
    this.closeButton.addEventListener("click", () => this.requestClose());
    head.append(title, this.closeButton);
    const tabBar = el("div", "help-tabs");
    tabBar.setAttribute("role", "tablist");
    for (const [page, label] of [["controls", "Controls"], ["mechanics", "Mechanics"]] as const) {
      const tab = el("button", "help-tab", label);
      tab.type = "button";
      tab.setAttribute("role", "tab");
      tab.addEventListener("click", () => this.showPage(page));
      this.tabs.set(page, tab);
      tabBar.append(tab);
    }

    this.ground = (options.ground ?? groundLegendVisible()) ? renderGround() : null;
    this.card.setAttribute("role", "dialog");
    this.card.setAttribute("aria-modal", "true");
    this.card.setAttribute("aria-labelledby", "help-title");
    this.card.tabIndex = -1;
    this.card.append(head, tabBar);
    const body = this.controlsPage;
    for (const section of HELP_SECTIONS) {
      const node = renderSection(section);
      this.sections.set(section.id, node);
      body.append(node);
    }
    if (this.ground) body.append(this.ground);
    for (const section of mechanicsSections()) this.mechanicsPage.append(renderMechanics(section));
    this.card.append(body, this.mechanicsPage, el("p", "help-foot", "Press H or Esc to close. Settings are behind the gear button."));
    this.showPage("controls");

    this.element.append(this.card);
    this.element.hidden = true;
    // Only a press on the scrim itself, never on the card or anything in it.
    this.element.addEventListener("click", (e) => { if (e.target === this.element) this.requestClose(); });
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  /** The page showing now. */
  get page(): HelpPage {
    return this.current;
  }

  /** `context`: where the player is, so those controls come first. `page`: Controls (the default) or Mechanics. */
  open(context: HelpScope = "run", page: HelpPage = "controls"): void {
    helpSectionOrder(context).forEach((id, i) => { this.sections.get(id)!.style.order = String(i); });
    if (this.ground) this.ground.style.order = String(this.sections.size);
    this.showPage(page);
    this.element.hidden = false;
    this.card.focus();
  }

  /** Switches the card to a page; the tab of the page shown is the selected one. */
  showPage(page: HelpPage): void {
    this.current = page;
    this.controlsPage.hidden = page !== "controls";
    this.mechanicsPage.hidden = page !== "mechanics";
    for (const [id, tab] of this.tabs) {
      tab.setAttribute("aria-selected", String(id === page));
      tab.classList.toggle("active", id === page);
    }
  }

  close(): void {
    this.element.hidden = true;
  }

  /** Whether `node` is inside the card (so Chrome can tell its own focus from the page's). */
  contains(node: Node | null): boolean {
    return node !== null && this.element.contains(node);
  }

  private requestClose(): void {
    if (this.options.onClose) this.options.onClose();
    else this.close();
  }
}

function renderSection(section: HelpSection): HTMLElement {
  const node = el("section", "help-section");
  node.append(el("h3", "help-section-title", section.title));
  const list = el("dl", "help-list");
  for (const binding of section.bindings) {
    const keys = el("dt", "help-keys");
    binding.keys.forEach((label, i) => {
      const join = binding.join ?? "/";
      if (i > 0 && join !== "") keys.append(el("span", "help-join", join));
      keys.append(keycap(label, isMouseLabel(label) ? "mouse" : undefined));
    });
    list.append(keys, el("dd", "help-action", binding.action));
  }
  node.append(list);
  return node;
}

function renderMechanics(section: MechanicsSection): HTMLElement {
  const node = el("section", `help-mech-section help-mech-${section.id}`);
  node.append(el("h3", "help-section-title", section.title));
  if (section.intro) node.append(el("p", "help-mech-intro", section.intro));
  const list = el("dl", "help-mech-list");
  for (const entry of section.entries) list.append(el("dt", "help-mech-term", entry.term), el("dd", "help-mech-text", entry.text));
  node.append(list);
  return node;
}
