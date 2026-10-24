// Leaderboard tab: the month's top players by GV banked, with arrows to step through the months that have any.
import { MONTH_RE, cosmeticById, cssColor, monthKey, type LeaderboardResponse, type ProfileDTO } from "@raid/shared";
import { fetchLeaderboard, formatNumber } from "../../net/profile";
import { el } from "../dom";
import type { HubPanel } from "./hubPanels";

const ROWS = 20;

/** "October 2026". Anything that isn't a month key is shown as it came (as text, so it can't do harm). */
function monthLabel(month: string): string {
  if (!MONTH_RE.test(month)) return month;
  const [year, mon] = month.split("-").map(Number);
  return new Date(Date.UTC(year!, mon! - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export class LeaderboardPanel implements HubPanel {
  readonly title = "Leaderboard";
  readonly root = el("div", "hub-tab hub-leaderboard");
  private readonly older = el("button", "btn small", "◀");
  private readonly newer = el("button", "btn small", "▶");
  private readonly label = el("div", "hub-lb-month");
  private readonly list = el("ol", "hub-lb-list");
  private readonly note = el("div", "hub-empty");
  private readonly retry = el("button", "btn small", "Try again");
  private readonly you = el("div", "hub-lb-you");

  private profile: ProfileDTO | null = null;
  private month = monthKey(Date.now());
  private months: readonly string[] = [];
  private visible = false;
  private loading = false;
  /** Bumped by every request, so an answer that arrives after a newer click (or after closing) is dropped. */
  private seq = 0;

  constructor() {
    this.older.title = "Older month";
    this.older.setAttribute("aria-label", "Older month");
    this.newer.title = "Newer month";
    this.newer.setAttribute("aria-label", "Newer month");
    this.label.setAttribute("aria-live", "polite");
    const nav = el("div", "hub-lb-nav");
    nav.append(this.older, this.label, this.newer);
    this.older.addEventListener("click", () => this.step(this.olderMonth()));
    this.newer.addEventListener("click", () => this.step(this.newerMonth()));
    this.retry.addEventListener("click", () => void this.load(this.month));
    this.note.hidden = true;
    this.retry.hidden = true;
    this.you.hidden = true;
    this.root.append(nav, this.note, this.retry, this.list, this.you);
    this.paintNav();
  }

  render(profile: ProfileDTO): void {
    if (this.profile && this.profile.name !== profile.name) {
      this.month = monthKey(Date.now());
      this.months = [];
    }
    this.profile = profile;
  }

  onShow(): void {
    this.visible = true;
    void this.load(this.month);
  }

  onHide(): void {
    this.visible = false;
    this.seq++;
    this.loading = false;
  }

  /** The newest month before the one on screen. `months` is newest first. */
  private olderMonth(): string | undefined {
    return this.months.find((m) => m < this.month);
  }

  private newerMonth(): string | undefined {
    for (let i = this.months.length - 1; i >= 0; i--) if (this.months[i]! > this.month) return this.months[i];
    return undefined;
  }

  private step(month: string | undefined): void {
    if (month && !this.loading) void this.load(month);
  }

  private async load(month: string): Promise<void> {
    const profile = this.profile;
    if (!profile) return;
    const seq = ++this.seq;
    this.loading = true;
    this.month = month;
    this.showMessage("Loading…");
    this.paintNav();
    const res = await fetchLeaderboard(month, ROWS, profile.name);
    if (seq !== this.seq || !this.visible) return;
    this.loading = false;
    if (!res) {
      this.showMessage("The leaderboard can't be reached right now.", true);
      this.paintNav();
      return;
    }
    this.month = res.month;
    this.months = res.months;
    this.paintBoard(res, profile.name);
    this.paintNav();
  }

  private showMessage(text: string, canRetry = false): void {
    this.note.hidden = false;
    this.note.textContent = text;
    this.retry.hidden = !canRetry;
    this.list.replaceChildren();
    this.you.hidden = true;
  }

  private paintNav(): void {
    this.label.textContent = monthLabel(this.month);
    this.older.disabled = this.loading || this.olderMonth() === undefined;
    this.newer.disabled = this.loading || this.newerMonth() === undefined;
  }

  private paintBoard(res: LeaderboardResponse, me: string): void {
    const entries = res.entries.slice(0, ROWS);
    let meVisible = false;
    const rows = entries.map((e, i) => {
      const mine = e.name === me;
      if (mine) meVisible = true;
      const row = el("li", mine ? "hub-lb-row me" : "hub-lb-row");
      const who = el("span", "hub-lb-name");
      who.append(el("span", "hub-lb-callsign", e.name));
      const title = cosmeticById(e.title);
      if (title?.slot === "title") {
        const tag = el("span", "hub-title-tag", title.text);
        tag.style.color = cssColor(title.color);
        who.append(tag);
      }
      row.append(el("span", "hub-lb-rank", String(i + 1)), who, el("span", "hub-lb-gv", formatNumber(e.gv)));
      return row;
    });
    this.list.replaceChildren(...rows);

    this.note.hidden = rows.length > 0;
    this.note.textContent = `Nobody has banked GV in ${monthLabel(res.month)} yet. Win a run to take the first place.`;
    this.retry.hidden = true;

    const you = res.you;
    this.you.hidden = !you || meVisible;
    if (you && !meVisible) this.you.textContent = `You: #${formatNumber(you.rank)} · ${formatNumber(you.gv)} GV`;
  }
}
