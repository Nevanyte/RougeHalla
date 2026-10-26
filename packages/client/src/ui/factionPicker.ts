// Hub faction picker: one radio card per faction, in FACTION_IDS order. Self-contained on purpose: mount `element`,
// read `selected` when the run starts. The server validates the faction it is sent at join, so this only decides what
// to ask for. A faction is asked for only after a deliberate pick, which is remembered on this device; until then
// `selected` is null and the join carries none (the server hands out its own default, and the run counts for no
// faction's titles).
import { BEATS, FACTIONS, FACTION_IDS, SIGNATURE_WEAPONS, WEAPONS, isFactionId, wishOf, type FactionId } from "@raid/shared";
import { cssColor, el } from "./dom";

const PICK_KEY = "raid.faction";
const NO_PICK_HINT = "No pick yet: the server will assign one";

/** Player-facing signature summaries (GAME_DESIGN 8.3). A Record, so a sixth faction cannot be added without one. */
const SIGNATURES: Readonly<Record<FactionId, { name: string; text: string }>> = {
  fire: { name: "Dragonslayer", text: "Burns its target and hits back hard on every swing the target makes. Punishes fast attackers." },
  sentenced: { name: "Marked", text: "Bonus damage ramps up every second of a fight. A target that swaps weapons resets it." },
  plague: { name: "Rat King", text: "Steady disease damage that turns into an execute once the target is under half health." },
  frost: { name: "Wall of Ice", text: "Anyone fighting it attacks slower, and moves slower up close." },
  holy: { name: "Radiant", text: "Heals from the damage it deals, more the lower its own health." },
};

function relatedTo(id: FactionId, side: 0 | 1): FactionId[] {
  return BEATS.filter((pair) => pair[side] === id).map((pair) => pair[1 - side]!);
}

const names = (ids: readonly FactionId[]): string => ids.map((f) => FACTIONS[f].displayName).join(", ");

// localStorage can throw (blocked site data); the pick then just isn't remembered.
function savedFaction(): FactionId | null {
  try {
    const v = localStorage.getItem(PICK_KEY);
    return isFactionId(v) ? v : null;
  } catch {
    return null;
  }
}

function saveFaction(id: FactionId): void {
  try {
    localStorage.setItem(PICK_KEY, id);
  } catch {
    // Ignored: see savedFaction.
  }
}

/**
 * The radio to move to for an arrow key: next/previous wrapping round, Home/End to the ends; null for any other key.
 * `from` is the focused radio's index.
 */
export function radioStep(count: number, from: number, key: string): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
    case "ArrowRight": return (from + 1) % count;
    case "ArrowUp":
    case "ArrowLeft": return (from - 1 + count) % count;
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}

/** Distinguishes the ids of two pickers on one page (the element ids below must be unique for aria-labelledby). */
let pickers = 0;

export class FactionPicker {
  readonly element = el("div", "faction-picker");
  /** The faction picked (now or on an earlier visit), or null when the player has not picked one yet. */
  selected: FactionId | null;
  /** Called when the player picks a different faction (not for the remembered one restored at construction). */
  onChange?: (id: FactionId) => void;

  private readonly cards = new Map<FactionId, HTMLButtonElement>();
  private readonly hint = el("div", "faction-hint", NO_PICK_HINT);
  private readonly noteId: string;
  private readonly hintId: string;
  private readonly ids: string;

  constructor() {
    this.ids = `faction-${pickers++}`;
    this.noteId = `${this.ids}-note`;
    this.hintId = `${this.ids}-hint`;
    this.selected = savedFaction();
    this.element.setAttribute("role", "radiogroup");
    this.element.setAttribute("aria-labelledby", `${this.ids}-title`);

    const title = el("div", "faction-title");
    const titleText = el("span", undefined, "Faction");
    titleText.id = `${this.ids}-title`;
    const note = el("span", "faction-title-note", "Your starting weapon follows your pick");
    note.id = this.noteId;
    title.append(titleText, note);
    this.hint.id = this.hintId;
    this.element.append(title, this.hint);

    for (const id of FACTION_IDS) {
      const card = this.buildCard(id);
      this.cards.set(id, card);
      this.element.append(card);
    }
    this.element.addEventListener("keydown", (e) => this.onKey(e));
    this.render();
  }

  /** Picks `id`, remembers it and tells `onChange` when it differs from the current pick. */
  select(id: FactionId): void {
    if (id === this.selected) return;
    this.selected = id;
    saveFaction(id);
    this.render();
    this.onChange?.(id);
  }

  setDisabled(disabled: boolean): void {
    for (const card of this.cards.values()) card.disabled = disabled;
  }

  private buildCard(id: FactionId): HTMLButtonElement {
    const spec = FACTIONS[id];
    const sig = SIGNATURES[id];
    const card = el("button", "faction-card");
    card.type = "button";
    card.setAttribute("role", "radio");
    card.style.setProperty("--faction", cssColor(spec.color));

    // No aria-label: it would replace the card's text for a screen reader. The name labels the radio and the rest of the
    // card describes it, each part its own element so the reading has a break between them.
    const part = <E extends HTMLElement>(node: E, name: string): E => {
      node.id = `${this.ids}-${id}-${name}`;
      return node;
    };
    const nameEl = part(el("span", "faction-name", spec.displayName), "name");
    const roleEl = part(el("span", "faction-role", spec.role), "role");
    const weaponEl = part(el("span", "faction-weapon", WEAPONS[SIGNATURE_WEAPONS[id]].name), "weapon");
    const head = el("span", "faction-head");
    head.append(nameEl, roleEl, weaponEl);

    const signature = part(el("span", "faction-sig"), "sig");
    signature.append(el("b", undefined, `${sig.name}. `), sig.text);
    // The faction's Wish (key D in a run): styled like the signature line above it.
    const wishDef = wishOf(id);
    const wish = part(el("span", "faction-sig"), "wish");
    if (wishDef) wish.append(el("b", undefined, `Wish: ${wishDef.name}`), ` — ${wishDef.blurb}`);

    const beats = part(el("span"), "beats");
    beats.append(el("span", "faction-beats", "Beats"), ` ${names(relatedTo(id, 0))}`);
    const loses = part(el("span"), "loses");
    loses.append(el("span", "faction-loses", "Loses to"), ` ${names(relatedTo(id, 1))}`);
    const sep = el("span", "faction-sep", "·");
    sep.setAttribute("aria-hidden", "true");
    const edge = el("span", "faction-edge");
    edge.append(beats, sep, loses);

    const detail = el("span", "faction-detail");
    detail.append(signature);
    if (wishDef) detail.append(wish);
    detail.append(edge);
    card.append(head, detail);
    card.setAttribute("aria-labelledby", nameEl.id);
    card.setAttribute("aria-describedby", [roleEl, weaponEl, signature, ...(wishDef ? [wish] : []), beats, loses].map((n) => n.id).join(" "));
    card.addEventListener("click", () => this.select(id));
    return card;
  }

  /** Arrow keys move the pick along the radios (and focus with it), as radio buttons do. */
  private onKey(e: KeyboardEvent): void {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const ids = FACTION_IDS;
    const focused = ids.findIndex((id) => this.cards.get(id) === document.activeElement);
    if (focused < 0) return;
    const next = radioStep(ids.length, focused, e.key);
    if (next === null) return;
    e.preventDefault();
    const id = ids[next]!;
    this.cards.get(id)?.focus();
    this.select(id);
  }

  private render(): void {
    // One tab stop for the group, on the pick (or the first card while there is none); arrows move within it.
    const stop = this.selected ?? FACTION_IDS[0];
    for (const [id, card] of this.cards) {
      const on = id === this.selected;
      card.setAttribute("aria-checked", String(on));
      card.tabIndex = id === stop ? 0 : -1;
      card.classList.toggle("selected", on);
    }
    this.hint.hidden = this.selected !== null;
    this.element.setAttribute("aria-describedby", this.selected === null ? `${this.noteId} ${this.hintId}` : this.noteId);
  }
}
