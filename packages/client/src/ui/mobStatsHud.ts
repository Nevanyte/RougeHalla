// Uncapped normal-mob progression: owned types stay compact; the expandable catalog shows each type's current count and cumulative reward.
import { MOB_STAT_REWARDS, mobStatCount, mobStatText, REGION_FACTIONS, FACTIONS } from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { el } from "./dom";
import "./mobStatsHud.css";

export class MobStatsHud {
  readonly root = el("section", "hud-mob-stats");
  private readonly summary = el("div", "mob-stats-owned");
  private readonly details = el("details", "mob-stats-catalog");
  private readonly list = el("div", "mob-stats-list");
  private sig = "";

  constructor() {
    const title = el("summary", "mob-stats-summary", "Normal mob progress");
    this.details.append(title, this.list);
    this.root.append(this.summary, this.details);
    this.root.hidden = true;
    for (const zone of REGION_FACTIONS) {
      const heading = el("div", "mob-stats-zone", `${FACTIONS[zone].displayName} zone`);
      this.list.append(heading);
      for (const reward of MOB_STAT_REWARDS.filter((r) => r.zone === zone)) this.list.append(this.makeRow(reward.id, reward.name, reward.text));
    }
  }

  update(me: Pick<PlayerState, "mobStats"> | undefined, visible: boolean): void {
    if (!me || !visible) { this.root.hidden = true; this.sig = ""; return; }
    this.root.hidden = false;
    const sig = MOB_STAT_REWARDS.map((r) => `${r.id}:${mobStatCount(me.mobStats, r.id)}`).join("|");
    if (sig === this.sig) return;
    this.sig = sig;
    const owned = MOB_STAT_REWARDS.filter((r) => mobStatCount(me.mobStats, r.id) > 0);
    this.summary.replaceChildren(...(owned.length ? owned.map((r) => {
      const count = mobStatCount(me.mobStats, r.id);
      const chip = el("span", "mob-stat-chip", `${r.name} ×${count}`);
      chip.title = `${r.text}. Total earned: ${mobStatText(r.id, count)}.`;
      chip.setAttribute("aria-label", chip.title);
      return chip;
    }) : [el("span", "mob-stats-empty", "No normal-mob bonuses yet") ]));
    for (const row of Array.from(this.list.children)) {
      const id = row.getAttribute("data-mob-id");
      if (!id) continue;
      const reward = MOB_STAT_REWARDS.find((r) => r.id === id)!;
      const count = mobStatCount(me.mobStats, id);
      const label = row.children[0] as HTMLElement;
      const total = row.children[2] as HTMLElement;
      label.textContent = `${reward.name} ×${count}`;
      total.textContent = count ? mobStatText(id, count) : "0 earned";
      row.setAttribute("aria-label", `${reward.name}: ${count} stacks, ${reward.text}, total earned ${count ? mobStatText(id, count) : "none"}`);
    }
  }

  destroy(): void { this.root.remove(); }

  private makeRow(id: string, name: string, rewardText: string): HTMLElement {
    const row = el("div", "mob-stat-row");
    row.setAttribute("data-mob-id", id);
    row.setAttribute("role", "group");
    const label = el("span", "mob-stat-name", `${name} ×0`);
    const perKill = el("span", "mob-stat-per-kill", rewardText);
    const total = el("span", "mob-stat-total", "0 earned");
    row.append(label, perKill, total);
    row.title = `${rewardText}. Each kill adds another stack; totals can keep growing.`;
    return row;
  }
}
