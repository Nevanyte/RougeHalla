// The cards the player holds (PlayerState.build: card id -> count, from the camps' shared chests; shared/cards.ts), as a compact row
// in the HUD plate under the vitals: a chip per owned card in catalog order, its title and, for a base card held more than once,
// "x2". Pointing at a chip shows what the card does and the glossary line of each of its tags. The row never takes the pointer (a
// right-click move and a left-click lock under it must reach the canvas, and the aim keeps streaming), so the tooltip is found by
// hit-testing the pointer against the chips' rectangles, not by :hover. Hidden while nothing is held.
import { STAT_GLOSSARY, TAG_GLOSSARY, cardLive, ownedCards, tagLabel, tierRoman, type CardCounts, type CardDef } from "@raid/shared";
import { baseSummary } from "./buildModel";
import { cardKindLabel } from "./chestMath";
import "./cardsRow.css";
import { el } from "./dom";

/** The class that shows a chip's tooltip while the pointer is over it. */
export const CARD_TIP_ON = "tip-on";
export const CARDS_LABEL = "Cards";

/** "x2": the count on a chip of a base card held more than once. */
export function countTag(count: number): string {
  return `x${count}`;
}

/**
 * A card's tooltip, one line each:
 *   Haste II (Base, tier II, x2)
 *   +16% attack speed
 *   All your Haste cards: +41% attack speed (I, II x2)   a base card, once the player holds two or more cards of its base
 *   AD: Attack damage: adds ...                           the stat the Attack Damage and Ability Power cards add
 *   Damage over time: Damage that ticks ...               one line per tag
 *   Not live yet: it does nothing.                        only for a card whose machinery is not in
 */
export function cardTip(def: CardDef, count: number, build?: CardCounts | null): string {
  const lines = [
    `${def.title} (${cardKindLabel(def.kind)}, tier ${tierRoman(def.tier)}${count > 1 ? `, ${countTag(count)}` : ""})`,
    def.text,
  ];
  if (def.base !== undefined) {
    const summary = baseSummary(build, def.base);
    if (summary !== "") lines.push(summary);
    if (def.base === "ad" || def.base === "ap") lines.push(`${STAT_GLOSSARY[def.base].term}: ${STAT_GLOSSARY[def.base].text}`);
  }
  for (const tag of def.tags) lines.push(`${tagLabel(tag)}: ${TAG_GLOSSARY[tag].text}`);
  if (!cardLive(def)) lines.push("Not live yet: it does nothing.");
  return lines.join("\n");
}

interface Chip {
  root: HTMLElement;
  count: HTMLElement;
  tip: HTMLElement;
  /** The count and tooltip it was painted for. */
  shown: number;
  shownTip: string;
}

interface ChipRect { left: number; top: number; right: number; bottom: number }

/** The pointer is over the world (the canvas sits outside #ui), not over a panel of the interface. */
function isWorldTarget(target: EventTarget | null): boolean {
  const t = target as { closest?: (selector: string) => unknown } | null;
  return t !== null && !(typeof t.closest === "function" && t.closest("#ui"));
}

export class CardsRow {
  readonly root = el("div", "hud-cards");
  private readonly label = el("div", "cards-label", CARDS_LABEL);
  private readonly list = el("div", "cards-list");
  /** A chip per card id seen so far (made when first held, reused after). */
  private readonly made = new Map<string, Chip>();
  /** The chips on screen, in catalog order. */
  private shownChips: Chip[] = [];
  private held = 0;
  /** What the list shows now ("ad1:2,leech1:1"), so an unchanged frame touches nothing. */
  private sig = "";
  private tipAt = -1;
  private rects: Array<ChipRect | null> = [];
  private rectsDirty = true;
  /** Where the list was when the rectangles were read: the row moves when the plate above it grows or wraps. */
  private rectsKey = "";

  constructor() {
    this.root.append(this.label, this.list);
    this.root.hidden = true;
    if (typeof window !== "undefined") {
      window.addEventListener("pointermove", this.onPointerMove, { passive: true });
      window.addEventListener("pointerout", this.onPointerOut, { passive: true });
      window.addEventListener("blur", this.hideTip);
      window.addEventListener("keydown", this.onKey);
      window.addEventListener("resize", this.invalidate);
    }
  }

  /** How many different cards the row shows. */
  get count(): number {
    return this.held;
  }

  /** The row is on screen. */
  get shown(): boolean {
    return !this.root.hidden;
  }

  /**
   * Call every frame. `build` is the player's PlayerState.build; `visible` false (dead, in the lobby) hides the row. The DOM is
   * touched only when a card, a count or the visibility changed.
   */
  update(build: CardCounts | null | undefined, visible: boolean): void {
    const owned = visible ? ownedCards(build) : [];
    let sig = "";
    for (const o of owned) sig += `${o.def.id}:${o.count},`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.held = owned.length;
    this.shownChips = owned.map((o) => this.paint(o.def, o.count, build));
    this.list.replaceChildren(...this.shownChips.map((c) => c.root));
    this.root.hidden = owned.length === 0;
    this.rectsDirty = true;
    // paint() took the tooltip class off every chip: the next pointer move shows the one under the pointer again.
    this.tipAt = -1;
  }

  destroy(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener("pointermove", this.onPointerMove);
      window.removeEventListener("pointerout", this.onPointerOut);
      window.removeEventListener("blur", this.hideTip);
      window.removeEventListener("keydown", this.onKey);
      window.removeEventListener("resize", this.invalidate);
    }
    this.root.remove();
  }

  /** The chip of a card, made on first use; its count and tooltip are rewritten when either changed (a base's summary reads its other tiers). */
  private paint(def: CardDef, count: number, build: CardCounts | null | undefined): Chip {
    let chip = this.made.get(def.id);
    if (!chip) {
      const root = el("div", `cards-chip ${def.kind}`);
      const countEl = el("span", "cards-count");
      const tip = el("div", "cards-tip");
      root.append(el("span", "cards-name", def.title), countEl, tip);
      chip = { root, count: countEl, tip, shown: 0, shownTip: "" };
      this.made.set(def.id, chip);
    }
    if (chip.shown !== count) {
      chip.shown = count;
      chip.count.textContent = count > 1 ? countTag(count) : "";
    }
    const tip = cardTip(def, count, build);
    if (tip !== chip.shownTip) {
      chip.shownTip = tip;
      chip.tip.textContent = tip;
    }
    // A tooltip must not outlive its chip's place in the list: the class goes with the chip when it is rebuilt.
    chip.root.classList.toggle(CARD_TIP_ON, false);
    return chip;
  }

  // -------------------------------------------------------------------------------------------------------- the tooltip

  private readonly invalidate = (): void => {
    this.rectsDirty = true;
  };

  /** The chip under the client point, or -1. The rectangles are read again after a repaint, a resize, or when the list has moved or changed size. */
  private chipAt(x: number, y: number): number {
    const l = this.list.getBoundingClientRect();
    const key = `${l.left},${l.top},${l.width},${l.height}`;
    if (this.rectsDirty || key !== this.rectsKey) {
      this.rectsKey = key;
      this.rectsDirty = false;
      this.rects = this.shownChips.map((c) => {
        const r = c.root.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height };
      });
    }
    for (let i = 0; i < this.rects.length; i++) {
      const r = this.rects[i];
      if (r && x >= r.left && x < r.right && y >= r.top && y < r.bottom) return i;
    }
    return -1;
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.root.hidden || !isWorldTarget(e.target)) {
      if (this.tipAt >= 0) this.hideTip();
      return;
    }
    this.setTip(this.chipAt(e.clientX, e.clientY));
  };

  private readonly onPointerOut = (e: PointerEvent): void => {
    if (!e.relatedTarget) this.hideTip();
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.code === "Escape" || e.key === "Escape") this.hideTip();
  };

  private readonly hideTip = (): void => {
    this.setTip(-1);
  };

  private setTip(i: number): void {
    if (i === this.tipAt) return;
    if (this.tipAt >= 0) this.shownChips[this.tipAt]?.root.classList.toggle(CARD_TIP_ON, false);
    this.tipAt = i;
    if (i >= 0) this.shownChips[i]?.root.classList.toggle(CARD_TIP_ON, true);
  }
}
