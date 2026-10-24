// The buff block under the vitals: one row per stat (stacks, the bonus they give, a bar toward the next combo and the combo
// reached), then the feed line that explains why mob rewards fall. It only reads the synced state and touches the DOM when
// a displayed value changes; Hud places `root` and calls update() every frame.
import {
  BUFF_LABELS, BUFF_STATS, buffRows, feedView, hasAnyStacks, lobbyMedianFeed, stacksOfPlayer, zeroStacks, type BuffRow,
} from "@raid/shared";
import type { PlayerState, RaidState } from "@raid/shared/schema";
import { STAT_COLOR } from "./buffTheme";
import { cssColor, el } from "./dom";

interface RowView {
  root: HTMLElement;
  stacks: HTMLElement;
  next: HTMLElement;
  bonus: HTMLElement;
  fill: HTMLElement;
  combo: HTMLElement;
  comboName: HTMLElement;
  comboText: HTMLElement;
  /** What the row shows now, so an unchanged frame touches nothing. */
  key: string;
}

export class BuffsHud {
  readonly root = el("div", "hud-buffs");
  private readonly rows: RowView[] = [];
  private readonly feed = el("div", "hud-feed");
  private rowsShown = true;
  private feedShown = true;
  private lastStacks = "";
  private lastFeed = "";
  /** A regional mob has been in the state: the feed line only means something where mobs pay out. */
  private mobsSeen = false;

  constructor() {
    for (const stat of BUFF_STATS) {
      const root = el("div", "buff");
      root.style.setProperty("--c", cssColor(STAT_COLOR[stat]));
      const line = el("div", "buff-row");
      const stacks = el("span", "buff-stacks");
      const next = el("span", "buff-next");
      const bonus = el("span", "buff-bonus");
      const fill = el("i", "buff-fill");
      const bar = el("span", "buff-bar");
      bar.append(fill);
      line.append(el("span", "buff-name", BUFF_LABELS[stat]), stacks, next, bonus, bar);
      const combo = el("div", "buff-combo");
      const comboName = el("span", "buff-combo-name");
      const comboText = el("span");
      combo.append(comboName, " ", comboText);
      combo.hidden = true;
      root.append(line, combo);
      this.root.append(root);
      this.rows.push({ root, stacks, next, bonus, fill, combo, comboName, comboText, key: "" });
    }
    this.root.append(this.feed);
    this.setRowsShown(false);
    this.setFeedShown(false);
  }

  update(state: RaidState, me: PlayerState | undefined): void {
    const alive = me?.status === "alive";
    const stacks = me ? stacksOfPlayer(me) : zeroStacks();
    const showRows = alive && hasAnyStacks(stacks);
    this.setRowsShown(showRows);
    if (showRows) {
      // A cheap gate before building the rows: the stacks to 0.01. paintRow still compares what is displayed.
      const gate = `${Math.round(stacks.hp * 100)}|${Math.round(stacks.attackSpeed * 100)}|${Math.round(stacks.moveSpeed * 100)}`;
      if (gate !== this.lastStacks) {
        this.lastStacks = gate;
        buffRows(stacks).forEach((row, i) => this.paintRow(this.rows[i]!, row));
      }
    } else {
      this.lastStacks = "";
    }

    if (!this.mobsSeen) this.mobsSeen = hasRegionalMobs(state);
    const showFeed = alive && this.mobsSeen && state.phase === "active";
    this.setFeedShown(showFeed);
    if (showFeed && me) {
      const line = feedView(me.kills, me.mobKills, lobbyMedianFeed(state.players.values())).line;
      if (line !== this.lastFeed) {
        this.lastFeed = line;
        this.feed.textContent = line;
      }
    }
  }

  destroy(): void {
    this.root.remove();
  }

  private paintRow(view: RowView, row: BuffRow): void {
    const pct = Math.round(row.progress * 100);
    const key = `${row.stacksText}|${row.bonusText}|${pct}|${row.combo?.id ?? ""}`;
    if (key === view.key) return;
    view.key = key;
    view.stacks.textContent = row.stacksText;
    view.next.textContent = row.next === null ? "" : `/${row.next}`;
    view.bonus.textContent = row.bonusText;
    view.fill.style.width = `${pct}%`;
    view.root.classList.toggle("idle", row.stacks === 0);
    view.root.classList.toggle("maxed", row.next === null);
    view.root.classList.toggle("combo", row.combo !== null);
    view.combo.hidden = row.combo === null;
    view.comboName.textContent = row.combo?.name ?? "";
    view.comboText.textContent = row.combo?.text ?? "";
  }

  private setRowsShown(shown: boolean): void {
    if (shown === this.rowsShown) return;
    this.rowsShown = shown;
    for (const row of this.rows) row.root.hidden = !shown;
  }

  private setFeedShown(shown: boolean): void {
    if (shown === this.feedShown) return;
    this.feedShown = shown;
    this.feed.hidden = !shown;
  }
}

function hasRegionalMobs(state: RaidState): boolean {
  for (const m of state.mobs.values()) if (m.kind === "mob" || m.kind === "elite") return true;
  return false;
}
