// The H help card: every control in one table (HELP_SECTIONS), drawn as keycaps. It is a real overlay, but the game keeps
// running behind it, so it closes with H, Esc, its button or a click outside the card. The keys themselves are Chrome's,
// and so is the stylesheet (chrome.css).
import { el } from "./dom";
import { renderGround } from "./groundLegend";
import { keycap } from "./keycap";

/** Where a control works. The card lists the current place first. */
export type HelpScope = "run" | "hub" | "anywhere";

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
      { keys: ["Right-click"], action: "Move (hold to keep steering)" },
      { keys: ["Left-click"], action: "Lock the nearest enemy and attack" },
      { keys: ["S"], action: "Stop" },
      { keys: ["1", "2"], action: "Select weapon slot" },
      { keys: ["Q"], action: "Swap weapon" },
      { keys: ["F"], action: "Pick up the weapon in reach" },
      { keys: ["D"], action: "Cast your faction's Wish (5 min cooldown, 5 s in training)" },
      { keys: ["Right-click"], action: "On the minimap: move there" },
      { keys: ["Hold left-click"], action: "On the minimap: peek there, release to snap back" },
      { keys: ["Esc"], action: "Leave practice (training only)" },
    ],
  },
  {
    id: "hub",
    title: "In the hub",
    bindings: [
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

/** Section ids in display order: where the player is first, the other place next, the general controls last. */
export function helpSectionOrder(context: HelpScope): HelpScope[] {
  const first: HelpScope = context === "hub" ? "hub" : "run";
  return [first, first === "hub" ? "run" : "hub", "anywhere"];
}

export function isMouseLabel(label: string): boolean {
  return /click/i.test(label);
}

export interface HelpOverlayOptions {
  /** Called when the card asks to close itself (its button, a click outside). */
  onClose?: () => void;
}

export class HelpOverlay {
  /** The scrim over the whole overlay; the card sits in it. Hidden while closed. */
  readonly element = el("div", "help-scrim");
  private readonly card = el("div", "help-card");
  private readonly closeButton = el("button", "help-close", "×");
  private readonly sections = new Map<HelpScope, HTMLElement>();
  /** The Ground legend (what each terrain kind does): always after the controls. */
  private readonly ground = renderGround();

  constructor(private readonly options: HelpOverlayOptions = {}) {
    const head = el("div", "help-head");
    const title = el("h2", "help-title", "Controls");
    title.id = "help-title";
    this.closeButton.type = "button";
    this.closeButton.setAttribute("aria-label", "Close help");
    this.closeButton.addEventListener("click", () => this.requestClose());
    head.append(title, this.closeButton);

    this.card.setAttribute("role", "dialog");
    this.card.setAttribute("aria-modal", "true");
    this.card.setAttribute("aria-labelledby", "help-title");
    this.card.tabIndex = -1;
    this.card.append(head);
    const body = el("div", "help-body");
    for (const section of HELP_SECTIONS) {
      const node = renderSection(section);
      this.sections.set(section.id, node);
      body.append(node);
    }
    body.append(this.ground);
    this.card.append(body, el("p", "help-foot", "Press H or Esc to close. Settings are behind the gear button."));

    this.element.append(this.card);
    this.element.hidden = true;
    // Only a press on the scrim itself, never on the card or anything in it.
    this.element.addEventListener("click", (e) => { if (e.target === this.element) this.requestClose(); });
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  /** `context`: where the player is, so those controls come first. */
  open(context: HelpScope = "run"): void {
    helpSectionOrder(context).forEach((id, i) => { this.sections.get(id)!.style.order = String(i); });
    this.ground.style.order = String(this.sections.size);
    this.element.hidden = false;
    this.card.focus();
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
