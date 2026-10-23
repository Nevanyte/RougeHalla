// Post-raid summary: outcome, raid stats, what went in / came home / was lost, and the net change in stash value.
import type { ItemDTO, RaidResult } from "@raid/shared";
import { formatValue, itemValue, totalValue } from "../net/profile";
import { el, uiRoot } from "./dom";
import { describeItem } from "./inventory";

const TITLES: Record<RaidResult["outcome"], string> = {
  extracted: "EXTRACTED",
  died: "KILLED IN ACTION",
  mia: "MISSING IN ACTION",
};

const MINUS = "−";

function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function fmtNet(n: number): string {
  if (n > 0) return `+${formatValue(n)}`;
  if (n < 0) return `${MINUS}${formatValue(-n)}`;
  return "0";
}

/**
 * What the stash gained or lost across the raid: what came home minus what went in. One formula for every outcome
 * (`extracted` is empty unless extracted), so loot taken off the dead and brought-in items used up mid-raid don't skew it.
 */
export function netValue(r: RaidResult): number {
  return totalValue(r.extracted) - totalValue(r.broughtIn);
}

function itemList(items: readonly ItemDTO[]): HTMLElement {
  const list = el("div", "result-items");
  if (items.length === 0) {
    list.append(el("div", "result-none", "Nothing"));
    return list;
  }
  for (const it of items) {
    const d = describeItem(it.def);
    const row = el("div", "result-item");
    const swatch = el("span", "item-swatch");
    swatch.style.background = d.color;
    row.title = d.info ? `${d.name} — ${d.info}` : d.name;
    row.append(swatch, el("span", "item-name", d.name), el("span", "item-value", formatValue(itemValue(it.def))));
    list.append(row);
  }
  return list;
}

function column(title: string, cls: string, items: readonly ItemDTO[]): HTMLElement {
  const col = el("section", `result-col ${cls}`);
  col.append(el("h2", undefined, title), itemList(items), el("div", "result-total", `Total ${formatValue(totalValue(items))}`));
  return col;
}

export class ResultsScreen {
  private readonly root = el("div", "panel results");
  visible = false;

  constructor(private readonly handlers: { onContinue(): void }) {}

  show(r: RaidResult): void {
    const facts = [`Time in raid ${fmtDuration(r.durationSec)}`, `Kills ${r.kills}`];
    if (r.outcome !== "extracted" && r.killedBy) facts.push(`Killed by ${r.killedBy}`);

    const lists = el("div", "result-lists");
    lists.append(
      column("Brought in", "brought", r.broughtIn),
      column("Extracted (now in your stash)", "extracted", r.extracted),
      column("Lost", "lost", r.lost),
    );

    const net = netValue(r);
    const netLine = el("div", `result-net ${net > 0 ? "gain" : net < 0 ? "loss" : "even"}`);
    const detail = r.outcome === "extracted"
      ? `extracted ${formatValue(totalValue(r.extracted))} ${MINUS} brought in ${formatValue(totalValue(r.broughtIn))}`
      : `brought in ${formatValue(totalValue(r.broughtIn))}`;
    netLine.append(el("span", "result-net-label", "Net value"), el("span", "result-net-n", fmtNet(net)), el("span", "result-net-detail", detail));

    const btn = el("button", "btn primary", "Back to menu");
    btn.addEventListener("click", () => this.handlers.onContinue());

    this.root.replaceChildren(
      el("h1", `outcome-${r.outcome}`, TITLES[r.outcome]),
      el("p", "result-facts", facts.join(" · ")),
      lists,
      netLine,
      btn,
    );
    uiRoot().append(this.root);
    this.visible = true;
  }

  hide(): void {
    this.root.remove();
    this.visible = false;
  }
}
