// Titles tab: every title, the owned ones to put on or take off, the rest with the price or the achievement behind them.
import { cosmeticsInSlot, isForSale, type ProfileDTO, type TitleCosmetic } from "@raid/shared";
import { formatNumber } from "../../net/profile";
import { el } from "../dom";
import { closetOf, describeError, earnedBy, equippedTitle, isEquipped, refocus, StatusLine, titleTag, type Closet } from "./hubUtil";
import type { HubActions, HubPanel } from "./hubPanels";
import { swatch } from "./swatch";

interface Row {
  c: TitleCosmetic;
  root: HTMLElement;
  sub: HTMLElement;
  btn: HTMLButtonElement;
}

export class TitlesPanel implements HubPanel {
  readonly title = "Titles";
  readonly root = el("div", "hub-tab hub-titles");
  private readonly status = new StatusLine();
  private readonly current = el("div", "hub-titles-current");
  private readonly rows: Row[] = [];
  private profile: ProfileDTO | null = null;
  private busy = false;

  constructor(private readonly actions: HubActions) {
    const list = el("div", "hub-list");
    for (const c of cosmeticsInSlot("title")) {
      if (c.slot !== "title") continue;
      const row = this.buildRow(c);
      this.rows.push(row);
      list.append(row.root);
    }
    this.root.append(this.status.root, this.current, list);
  }

  render(profile: ProfileDTO): void {
    this.profile = profile;
    this.paint();
  }

  onShow(): void {
    if (!this.busy) this.status.clear();
  }

  private buildRow(c: TitleCosmetic): Row {
    const root = el("div", "hub-row");
    const main = el("div", "hub-row-main");
    const sub = el("div", "hub-row-sub");
    main.append(swatch(c), sub);
    const btn = el("button", "btn small", "Equip");
    btn.addEventListener("click", () => this.onToggle(c));
    const side = el("div", "hub-row-side");
    side.append(btn);
    root.append(main, side);
    return { c, root, sub, btn };
  }

  private paint(): void {
    const profile = this.profile;
    if (!profile) return;
    const closet = closetOf(profile);
    const wearing = equippedTitle(profile);
    this.current.replaceChildren(el("span", undefined, "Worn title: "), wearing ? titleTag(wearing) : el("span", "hub-muted", "none"));
    for (const row of this.rows) this.paintRow(row, closet);
  }

  private paintRow(row: Row, closet: Closet): void {
    const { c } = row;
    const owned = closet.owned.has(c.id);
    const worn = isEquipped(closet, c);
    row.root.classList.toggle("locked", !owned);
    row.root.classList.toggle("equipped", worn);
    row.btn.hidden = !owned;
    row.btn.disabled = this.busy;
    row.btn.textContent = worn ? "Unequip" : "Equip";
    row.btn.setAttribute("aria-label", `${row.btn.textContent} ${c.text}`);
    if (owned) {
      row.sub.textContent = worn ? "Worn" : "Owned";
      return;
    }
    const source = earnedBy(c);
    if (isForSale(c)) row.sub.textContent = `${formatNumber(c.price ?? 0)} GV in the Shop${source ? ` · or earn: ${source.name} (${source.desc})` : ""}`;
    else if (source) row.sub.textContent = `Earn: ${source.name} (${source.desc})`;
    else row.sub.textContent = "Not for sale";
  }

  private onToggle(c: TitleCosmetic): void {
    if (this.busy || !this.profile) return;
    const worn = isEquipped(closetOf(this.profile), c);
    void this.change(worn ? null : c.id, worn ? `Took off ${c.text}` : `Wearing ${c.text}`);
  }

  private async change(id: string | null, done: string): Promise<void> {
    const focused = document.activeElement;
    this.busy = true;
    this.status.set("Saving…");
    this.paint();
    try {
      await this.actions.equip("title", id);
      this.status.set(done, "ok");
    } catch (err) {
      this.status.set(describeError(err), "error");
    } finally {
      this.busy = false;
      this.paint();
      refocus(focused);
    }
  }
}
