// The passives the player holds (PlayerState.build, from the camps' shared chests; shared/skills.ts), as a compact row under
// the build strip's buff chips: a chip per skill with its zone's mark, its name and its rank (R1, R2). Pointing at a chip shows
// what it gives at that rank, what the second rank adds, and the matchup tags. Like the strip, the row never takes the pointer
// (a right-click move and a left-click lock under it must reach the canvas): the tooltip is found by hit-testing the pointer
// against the chips' rectangles, not by :hover. Hidden while nothing is held.
import { FACTIONS, SKILLS, SKILL_MAX_RANK, isFactionId, rankIn, skillText, type BuildRanks, type SkillDef } from "@raid/shared";
import { tagList } from "./buffTip";
import { poolName } from "./chestMath";
import { el } from "./dom";
import "./passivesRow.css";
import { setPoolGlyph } from "./poolGlyph";

/** The class that shows a chip's tooltip while the pointer is over it. */
export const PASSIVE_TIP_ON = "tip-on";
export const PASSIVES_LABEL = "Passives";

const zoneName = (zone: string): string => (isFactionId(zone) ? FACTIONS[zone].displayName : zone);

/** "R2": the rank on a chip. */
export function rankTag(rank: number): string {
  return `R${rank}`;
}

/**
 * A passive's tooltip, one line each:
 *   Whetstone (Neutral, rank 1 of 2)
 *   +6% damage                       what it gives at the rank held (for the player's faction)
 *   At rank 2: +10% damage           only at rank 1: what a second pick of it adds
 *   Works with: anyone
 *   Strong against: ...              only when it has tags
 *   (a caveat)                       only for a skill with a `note` (Quickdraw: windups end on 50 ms ticks)
 */
export function passiveTip(def: SkillDef, rank: number, faction?: string): string {
  const lines = [
    `${def.name} (${poolName(def.pool, zoneName)}, rank ${rank} of ${SKILL_MAX_RANK})`,
    skillText(def.id, rank, faction),
  ];
  if (rank < SKILL_MAX_RANK) lines.push(`At rank ${rank + 1}: ${skillText(def.id, rank + 1, faction)}`);
  lines.push(`Works with: ${def.worksWith.length > 0 ? tagList(def.worksWith) : "anyone"}`);
  if (def.counters.length > 0) lines.push(`Strong against: ${tagList(def.counters)}`);
  if (def.note) lines.push(def.note);
  return lines.join("\n");
}

interface Chip {
  root: HTMLElement;
  rank: HTMLElement;
  tip: HTMLElement;
  /** The rank and faction it was painted for; 0 = hidden. */
  shown: number;
  faction: string;
}

interface ChipRect { left: number; top: number; right: number; bottom: number }

/** The pointer is over the world (the canvas sits outside #ui), not over a panel of the interface. */
function isWorldTarget(target: EventTarget | null): boolean {
  const t = target as { closest?: (selector: string) => unknown } | null;
  return t !== null && !(typeof t.closest === "function" && t.closest("#ui"));
}

export class PassivesRow {
  readonly root = el("div", "hud-passives");
  private readonly label = el("div", "passive-label", PASSIVES_LABEL);
  private readonly list = el("div", "passive-list");
  private readonly chips: Chip[] = [];
  private held = 0;
  private tipAt = -1;
  private rects: Array<ChipRect | null> = [];
  private rectsDirty = true;
  /** Where the list was when the rectangles were read: the row moves when the buff strip above it grows or wraps. */
  private rectsKey = "";

  constructor() {
    for (const def of SKILLS) {
      const root = el("div", "passive-chip");
      const glyph = el("span", "passive-glyph");
      setPoolGlyph(glyph, def.pool);
      const rank = el("span", "passive-rank");
      const tip = el("div", "passive-tip");
      root.append(glyph, el("span", "passive-name", def.name), rank, tip);
      root.hidden = true;
      this.list.append(root);
      this.chips.push({ root, rank, tip, shown: 0, faction: "" });
    }
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

  /** How many passives the row shows. */
  get count(): number {
    return this.held;
  }

  /** The row is on screen. */
  get shown(): boolean {
    return !this.root.hidden;
  }

  /**
   * Call every frame. `build` is the player's PlayerState.build, `faction` their faction (a rank's text can differ by faction);
   * `visible` false (dead, in the lobby) hides the row. The DOM is touched only when a rank, the faction or the visibility changed.
   */
  update(build: BuildRanks | null | undefined, faction: string | undefined, visible: boolean): void {
    let count = 0;
    let changed = false;
    SKILLS.forEach((def, i) => {
      const chip = this.chips[i]!;
      const rank = visible ? rankIn(build, def.id) : 0;
      if (rank > 0) count++;
      if (rank === chip.shown && (rank === 0 || (faction ?? "") === chip.faction)) return;
      changed = true;
      chip.shown = rank;
      chip.faction = faction ?? "";
      chip.root.hidden = rank === 0;
      if (rank === 0) return;
      chip.rank.textContent = rankTag(rank);
      chip.tip.textContent = passiveTip(def, rank, faction);
    });
    if (!changed && count === this.held) return;
    this.held = count;
    this.root.hidden = count === 0;
    this.rectsDirty = true;
    if (this.tipAt >= 0 && (count === 0 || this.chips[this.tipAt]!.root.hidden)) this.hideTip();
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
      this.rects = this.chips.map((c) => {
        if (c.root.hidden) return null;
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
    if (this.tipAt >= 0) this.chips[this.tipAt]!.root.classList.toggle(PASSIVE_TIP_ON, false);
    this.tipAt = i;
    if (i >= 0) this.chips[i]!.root.classList.toggle(PASSIVE_TIP_ON, true);
  }
}
