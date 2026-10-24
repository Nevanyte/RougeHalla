// Hub faction picker: one card per faction, in FACTION_IDS order. Self-contained on purpose: mount `element`, read
// `selected` when the run starts. The server validates the faction it is sent at join, so this only decides what to ask
// for; the last pick is remembered on this device.
import { BEATS, FACTIONS, FACTION_IDS, SIGNATURE_WEAPONS, WEAPONS, isFactionId, type FactionId } from "@raid/shared";
import { cssColor, el } from "./dom";

const PICK_KEY = "raid.faction";
const DEFAULT_FACTION: FactionId = FACTION_IDS[0]!;

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

export class FactionPicker {
  readonly element = el("div", "faction-picker");
  selected: FactionId;
  /** Called when the player picks a different faction (not for the remembered one restored at construction). */
  onChange?: (id: FactionId) => void;

  private readonly cards = new Map<FactionId, HTMLButtonElement>();

  constructor() {
    this.selected = savedFaction() ?? DEFAULT_FACTION;
    this.element.setAttribute("role", "group");
    this.element.setAttribute("aria-label", "Faction");

    const title = el("div", "faction-title");
    title.append(el("span", undefined, "Faction"), el("span", "faction-title-note", "Your starting weapon follows your pick"));
    this.element.append(title);

    for (const id of FACTION_IDS) {
      const card = this.buildCard(id);
      this.cards.set(id, card);
      this.element.append(card);
    }
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
    card.style.setProperty("--faction", cssColor(spec.color));

    const head = el("span", "faction-head");
    head.append(
      el("span", "faction-name", spec.displayName),
      el("span", "faction-role", spec.role),
      el("span", "faction-weapon", WEAPONS[SIGNATURE_WEAPONS[id]].name),
    );

    const signature = el("span", "faction-sig");
    signature.append(el("b", undefined, `${sig.name}. `), sig.text);

    const edge = el("span", "faction-edge");
    edge.append(
      el("span", "faction-beats", "Beats"), ` ${names(relatedTo(id, 0))}`,
      el("span", "faction-sep", "·"),
      el("span", "faction-loses", "Loses to"), ` ${names(relatedTo(id, 1))}`,
    );

    const detail = el("span", "faction-detail");
    detail.append(signature, edge);
    card.append(head, detail);
    card.addEventListener("click", () => this.select(id));
    return card;
  }

  private render(): void {
    for (const [id, card] of this.cards) {
      const on = id === this.selected;
      card.setAttribute("aria-pressed", String(on));
      card.classList.toggle("selected", on);
    }
  }
}
