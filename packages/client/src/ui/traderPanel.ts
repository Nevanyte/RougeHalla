import { TRADER_RANGE, MASK_MOVE, barterLabels, hasLineOfSight, parseStatTrade, type GameMap, type TraderLike } from "@raid/shared";
import { el, uiRoot } from "./dom";
import "./traderPanel.css";

interface PlayerLike {
  x: number; y: number; status: string; weapon0: string; weapon1: string; slot: number;
  tradeUsed?: boolean; tradeOffers?: { at(index: number): string | undefined }; potionSmall?: number;
}
export interface TraderPanelFrame {
  traders?: { forEach(cb: (value: TraderLike) => void): void };
  me?: PlayerLike; map: GameMap; serverNow?: number; canSee?: (point: TraderLike) => boolean;
}

export class TraderPanel {
  private readonly root = el("aside", "trader-panel");
  private readonly title = el("h3");
  private readonly description = el("p");
  private readonly choices = el("div", "trader-choices");
  private readonly close = el("button", "trader-close", "×");
  private buttons: HTMLButtonElement[] = [];
  private active = "";
  private dismissed = "";
  private key = "";
  private pendingUntil = 0;

  constructor(private readonly onTrade: (trader: string, pick: number) => void) {
    this.root.setAttribute("aria-label", "Wandering trader");
    this.close.type = "button"; this.close.title = "Close until you leave this trader";
    this.close.addEventListener("click", () => { this.dismissed = this.active; this.root.hidden = true; });
    this.root.append(this.close, this.title, this.description, this.choices);
    this.root.hidden = true; uiRoot().append(this.root);
  }

  update(frame: TraderPanelFrame): void {
    const p = frame.me;
    let nearest: TraderLike | undefined, distance = Infinity;
    if (p?.status === "alive") frame.traders?.forEach(t => {
      const d = Math.hypot(p.x - t.x, p.y - t.y);
      if (d <= TRADER_RANGE && d < distance && (!frame.canSee || frame.canSee(t)) && hasLineOfSight(frame.map, p, t, MASK_MOVE)) { nearest = t; distance = d; }
    });
    if (!nearest || !p) { this.active = ""; this.dismissed = ""; this.root.hidden = true; return; }
    const trader = nearest;
    this.active = trader.id;
    this.root.hidden = this.dismissed === trader.id;
    const held = p.slot === 1 ? p.weapon1 : p.weapon0;
    const offers = [0, 1, 2].map(i => parseStatTrade(p.tradeOffers?.at(i) ?? ""));
    const key = [trader.id, held, p.weapon0, p.weapon1, p.potionSmall, p.tradeUsed, ...offers.map(o => o?.label ?? ""), (frame.serverNow ?? 0) < this.pendingUntil].join("|");
    if (key === this.key) return;
    this.key = key;
    this.title.textContent = trader.name;
    this.description.textContent = trader.kind === "stats"
      ? p.tradeUsed ? "Your stat trade is complete for this run." : "Choose one permanent exchange for this run. These offers reflect your current stats."
      : "Trade the weapon in your hand, or exchange a small potion for a weapon. One trade every 5 seconds.";
    const labels = trader.kind === "stats" ? offers.map(o => o?.label ?? "Considering your build…") : barterLabels(held);
    this.choices.replaceChildren(); this.buttons = [];
    labels.forEach((label, i) => {
      const button = el("button", "trader-choice", label); button.type = "button";
      button.disabled = (frame.serverNow ?? 0) < this.pendingUntil || (trader.kind === "stats"
        ? p.tradeUsed || !offers[i]
        : i === 2 ? !(p.potionSmall && (!p.weapon0 || !p.weapon1)) : !held);
      button.addEventListener("click", () => {
        if (button.disabled) return;
        this.pendingUntil = (frame.serverNow ?? 0) + 700;
        this.buttons.forEach(b => { b.disabled = true; });
        this.onTrade(trader.id, i);
      });
      this.buttons.push(button); this.choices.append(button);
    });
  }

  destroy(): void { this.root.remove(); }
}
