// Shop tab: every cosmetic, grouped by kind, with its price or the achievement that grants it. Buying takes two clicks
// (Buy, then Confirm within a few seconds) so a stray click can't spend GV. The server decides; the cards only show
// the profile it last sent.
import { COSMETICS, cosmeticsInSlot, isForSale, type Cosmetic, type ProfileDTO } from "@raid/shared";
import { describeError, earnedBy, isEquipped, isGold, closetOf, refocus, sectionHeading, StatusLine, type Closet } from "./hubUtil";
import { formatNumber } from "../../net/profile";
import { el } from "../dom";
import type { HubActions, HubPanel } from "./hubPanels";
import { swatch } from "./swatch";

/** How long a Buy button stays on "Confirm" before it falls back. */
const CONFIRM_MS = 3000;

const GROUPS: ReadonlyArray<{ label: string; items: readonly Cosmetic[] }> = [
  { label: "Colours", items: cosmeticsInSlot("skin") },
  { label: "Outlines", items: cosmeticsInSlot("outline") },
  { label: "Trails", items: cosmeticsInSlot("trail") },
  { label: "Titles", items: cosmeticsInSlot("title") },
  { label: "Golden looks", items: COSMETICS.filter(isGold) },
];

interface Card {
  c: Cosmetic;
  root: HTMLElement;
  tag: HTMLElement;
  price: HTMLElement;
  earn: HTMLElement;
  buy: HTMLButtonElement;
}

export class ShopPanel implements HubPanel {
  readonly title = "Shop";
  readonly root = el("div", "hub-tab hub-shop");
  private readonly status = new StatusLine();
  private readonly cards: Card[] = [];
  private profile: ProfileDTO | null = null;
  /** The card whose Buy button reads "Confirm", until the timer or another click ends it. */
  private armedId: string | null = null;
  private armTimer: ReturnType<typeof setTimeout> | null = null;
  /** The cosmetic being bought right now. Every Buy button is off while one is, so two requests never overlap. */
  private pendingId: string | null = null;

  constructor(private readonly actions: HubActions) {
    this.root.append(this.status.root);
    for (const group of GROUPS) {
      const section = el("section", "hub-section");
      const grid = el("div", "hub-grid");
      for (const c of group.items) {
        const card = this.buildCard(c);
        this.cards.push(card);
        grid.append(card.root);
      }
      section.append(sectionHeading(group.label), grid);
      this.root.append(section);
    }
  }

  render(profile: ProfileDTO): void {
    this.profile = profile;
    this.paint();
  }

  onShow(): void {
    if (!this.pendingId) this.status.clear();
  }

  onHide(): void {
    this.disarm();
  }

  private buildCard(c: Cosmetic): Card {
    const root = el("div", "hub-card");
    const sw = el("div", "hub-card-sw");
    sw.append(swatch(c));
    // A title's swatch already is its name.
    if (c.slot === "title") root.append(sw);
    else root.append(sw, el("div", "hub-card-name", c.name));

    const tag = el("span", "hub-tag");
    const price = el("span", "hub-price");
    const earn = el("span", "hub-earn");
    const buy = el("button", "btn small", "Buy");
    buy.addEventListener("click", () => this.onBuy(c));

    const foot = el("div", "hub-card-foot");
    foot.append(tag, price, earn, buy);
    root.append(foot);
    return { c, root, tag, price, earn, buy };
  }

  private paint(): void {
    const profile = this.profile;
    if (!profile) return;
    const closet = closetOf(profile);
    // An armed Buy that can no longer be bought (bought elsewhere, balance dropped) would confirm into a refusal.
    const armed = this.cards.find((card) => card.c.id === this.armedId);
    if (armed && !this.canBuy(armed.c, closet, profile.gv)) this.disarm(false);
    for (const card of this.cards) this.paintCard(card, closet, profile.gv);
  }

  /**
   * Golden looks are both sold and granted by an achievement, so a priced card also says how to get the item for free
   * (desc in full: the player is about to spend GV on it). An unsold card keeps the short form, desc in the tooltip.
   */
  private paintEarn(card: Card, owned: boolean, sale: boolean): void {
    const source = earnedBy(card.c);
    card.earn.hidden = owned || (sale && !source);
    card.earn.title = "";
    if (!source) {
      card.earn.textContent = "Not for sale";
    } else if (sale) {
      card.earn.textContent = `Or earn: ${source.name} (${source.desc})`;
    } else {
      card.earn.textContent = `Earn: ${source.name}`;
      card.earn.title = source.desc;
    }
  }

  private canBuy(c: Cosmetic, closet: Closet, gv: number): boolean {
    return !closet.owned.has(c.id) && isForSale(c) && gv >= (c.price ?? 0);
  }

  private paintCard(card: Card, closet: Closet, gv: number): void {
    const { c } = card;
    const owned = closet.owned.has(c.id);
    const sale = !owned && isForSale(c);
    card.root.classList.toggle("owned", owned);
    card.root.classList.toggle("equipped", isEquipped(closet, c));

    card.tag.hidden = !owned;
    card.tag.textContent = isEquipped(closet, c) ? "Owned · Equipped" : "Owned";
    card.price.hidden = !sale;
    card.buy.hidden = !sale;
    this.paintEarn(card, owned, sale);
    card.root.title = "";
    if (!sale) return;

    const price = c.price ?? 0;
    const missing = price - gv;
    const armed = this.armedId === c.id;
    card.price.textContent = `${formatNumber(price)} GV`;
    card.price.classList.toggle("short", missing > 0);
    card.buy.textContent = this.pendingId === c.id ? "Buying…" : armed ? "Confirm" : "Buy";
    card.buy.classList.toggle("primary", armed);
    card.buy.disabled = this.pendingId !== null || missing > 0;
    const tip = missing > 0
      ? `Need ${formatNumber(missing)} more GV`
      : armed ? `Click again to spend ${formatNumber(price)} GV` : `Buy ${c.name} for ${formatNumber(price)} GV`;
    card.buy.title = tip;
    card.buy.setAttribute("aria-label", `${card.buy.textContent} ${c.name}`);
    // Some browsers show no tooltip on a disabled button, so the card carries it as well.
    card.root.title = tip;
  }

  private onBuy(c: Cosmetic): void {
    if (this.pendingId || !this.profile) return;
    if (this.armedId !== c.id) {
      this.arm(c.id);
      return;
    }
    this.disarm(false);
    void this.buy(c);
  }

  private arm(id: string): void {
    this.disarm(false);
    this.armedId = id;
    this.armTimer = setTimeout(() => this.disarm(), CONFIRM_MS);
    this.paint();
  }

  private disarm(repaint = true): void {
    if (this.armTimer) clearTimeout(this.armTimer);
    this.armTimer = null;
    this.armedId = null;
    if (repaint) this.paint();
  }

  private async buy(c: Cosmetic): Promise<void> {
    const focused = document.activeElement;
    this.pendingId = c.id;
    this.status.set(`Buying ${c.name}…`);
    this.paint();
    try {
      await this.actions.purchase(c.id);
      const where = c.slot === "title" ? "the Titles tab" : "the Wardrobe";
      this.status.set(`Bought ${c.name} for ${formatNumber(c.price ?? 0)} GV. Equip it from ${where}.`, "ok");
    } catch (err) {
      this.status.set(describeError(err), "error");
    } finally {
      this.pendingId = null;
      this.paint();
      refocus(focused);
    }
  }
}
