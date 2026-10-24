// Achievements tab: every achievement with how far along it is, when it was unlocked, and what it grants.
import { ACHIEVEMENTS, cosmeticById, goalProgress, type AchievementDef, type ProfileDTO } from "@raid/shared";
import { formatNumber } from "../../net/profile";
import { el } from "../dom";
import type { HubPanel } from "./hubPanels";
import { swatch } from "./swatch";

interface Row {
  a: AchievementDef;
  root: HTMLElement;
  bar: HTMLElement;
  fill: HTMLElement;
  count: HTMLElement;
  when: HTMLElement;
}

/** The unlock time as a short date; an unusable number (the wire is untrusted) still reads as unlocked. */
function unlockedText(ms: unknown): string {
  const date = typeof ms === "number" && Number.isFinite(ms) ? new Date(ms) : null;
  return date && !Number.isNaN(date.getTime())
    ? `Unlocked ${date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`
    : "Unlocked";
}

export class AchievementsPanel implements HubPanel {
  readonly title = "Achievements";
  readonly root = el("div", "hub-tab hub-achievements");
  private readonly summary = el("div", "hub-ach-summary");
  private readonly rows: Row[] = [];

  constructor() {
    const list = el("div", "hub-list");
    for (const a of ACHIEVEMENTS) {
      const row = this.buildRow(a);
      this.rows.push(row);
      list.append(row.root);
    }
    this.root.append(this.summary, list);
  }

  render(profile: ProfileDTO): void {
    const snapshot = { stats: profile.stats, progress: profile.progress, gvLifetime: profile.gvLifetime };
    let unlocked = 0;
    for (const row of this.rows) {
      const done = Object.hasOwn(profile.achievements, row.a.id);
      const { have, need } = goalProgress(row.a.goal, snapshot);
      if (done) unlocked++;
      // An unlocked achievement is complete whatever the counters say now (they only grow, but trust the server's unlock).
      const shown = done ? need : have;
      row.root.classList.toggle("locked", !done);
      row.root.classList.toggle("done", done);
      row.fill.style.width = `${need > 0 ? Math.round((shown / need) * 100) : 100}%`;
      row.bar.setAttribute("aria-valuenow", String(shown));
      row.bar.setAttribute("aria-valuemax", String(need));
      row.count.textContent = `${formatNumber(shown)} / ${formatNumber(need)}`;
      row.when.textContent = done ? unlockedText(profile.achievements[row.a.id]) : "Locked";
    }
    this.summary.textContent = `${unlocked} of ${this.rows.length} unlocked`;
  }

  private buildRow(a: AchievementDef): Row {
    const root = el("div", "hub-row hub-ach");
    const main = el("div", "hub-row-main");
    main.append(el("div", "hub-row-name", a.name), el("div", "hub-row-sub", a.desc));
    const rewards = el("div", "hub-rewards");
    for (const id of a.reward) {
      const c = cosmeticById(id);
      if (!c) continue;
      const chip = el("span", "hub-reward");
      // A title's swatch is its name in its own colour, so adding the name again would read twice.
      chip.append(swatch(c, "sm"), ...(c.slot === "title" ? [] : [el("span", undefined, c.name)]));
      rewards.append(chip);
    }
    if (rewards.childElementCount > 0) main.append(rewards);

    const side = el("div", "hub-ach-side");
    const bar = el("div", "hub-bar");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", `${a.name} progress`);
    bar.setAttribute("aria-valuemin", "0");
    const fill = el("div", "hub-bar-fill");
    bar.append(fill);
    const count = el("span", "hub-ach-count");
    const when = el("span", "hub-ach-when");
    side.append(bar, count, when);
    root.append(main, side);
    return { a, root, bar, fill, count, when };
  }
}
