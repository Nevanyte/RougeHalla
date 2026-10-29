// The gained-stat strip: nine compact cells showing bonuses from the synced stat mirrors, mob rewards, and build (ui/buildModel.ts, pure).
// It excludes faction baselines and power/PvP totals. Like the cards row it is
// click-through all the way down (a right-click move and a left-click lock under it must reach the canvas), so its tooltips are found
// by hit-testing the pointer against the cells' rectangles (rectTips.ts), not by :hover. Hidden while the player does not stand.
import { isWeaponId, type WeaponId } from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { HUD_GAIN_IDS, buildGains, statLine, type BuildStat, type BuildStatId } from "./buildModel";
import "./buildHud.css";
import { el } from "./dom";
import { RectTips } from "./rectTips";
import { combatIcon, STAT_ICON_COLORS } from "./combatIcons";
import type { InvestedStatKey } from "@raid/shared";

/** The class that shows a cell's tooltip while the pointer is over it. */
export const BUILD_TIP_ON = "tip-on";
export const BUILD_LABEL = "Gained";

interface Cell {
  root: HTMLElement;
  label: HTMLElement;
  value: HTMLElement;
  tip: HTMLElement;
}

/** The part of a player the strip reads: the synced PlayerState, or a test's plain object. */
export type BuildSource = Pick<PlayerState, "faction" | "build" | "asMult" | "windupMult" | "speedMult" | "armorBonus" | "shieldBonus" | "adBonus" | "apBonus"
  | "weapon0" | "weapon1" | "slot" | "hp" | "maxHp" | "sentence" | "mobStats"> & { campClears?: number };

/** The weapon in hand by id: "fists" for an empty slot or an id from newer server content. */
export function heldWeapon(me: Pick<BuildSource, "weapon0" | "weapon1" | "slot">): WeaponId {
  const id = me.slot === 1 ? me.weapon1 : me.weapon0;
  return isWeaponId(id) ? id : "fists";
}

/**
 * Everything the cells are computed from, as one string, so a frame that changed nothing skips the work: the faction, the weapon in
 * hand, the mirrors' wire values, whether the hp is under half (Bloodthirst) and the cards held.
 */
export function inputKey(me: BuildSource): string {
  let cards = "";
  const forEach = (me.build as { forEach?: unknown } | null | undefined)?.forEach;
  if (typeof forEach === "function") (me.build as unknown as { forEach(cb: (count: number, id: string) => void): void }).forEach((count, id) => { cards += `${id}:${count},`; });
  else if (me.build) for (const [id, count] of Object.entries(me.build as unknown as Record<string, number>)) cards += `${id}:${count},`;
  const low = me.maxHp > 0 && me.hp / me.maxHp < 0.5;
  let mobStats = "";
  const entries = (me.mobStats as { entries?: () => IterableIterator<[string, number]> } | undefined)?.entries;
  if (typeof entries === "function") for (const [id, count] of entries.call(me.mobStats)) mobStats += `${id}:${count},`;
  else if (me.mobStats) for (const [id, count] of Object.entries(me.mobStats as unknown as Record<string, number>)) mobStats += `${id}:${count},`;
  return `${me.faction}|${me.maxHp}|${me.sentence}|${heldWeapon(me)}|${me.asMult}|${me.windupMult}|${me.speedMult}|${me.armorBonus}|${me.shieldBonus}|${me.adBonus}|${me.apBonus}|${me.campClears ?? 0}|${low ? "L" : ""}|${cards}|${mobStats}`;
}

/** The strip's cells for a player. */
export function statsOf(me: BuildSource): BuildStat[] {
  return buildGains({
    faction: me.faction, build: me.build, wire: me, weapon: heldWeapon(me), hpFrac: me.maxHp > 0 ? me.hp / me.maxHp : 1, mobStats: me.mobStats, maxHp: me.maxHp, campClears: me.campClears,
  });
}

export class BuildHud {
  readonly root = el("div", "hud-build");
  private readonly label = el("div", "build-label", BUILD_LABEL);
  private readonly grid = el("div", "build-grid");
  private readonly cells = new Map<BuildStatId, Cell>();
  private readonly order: Cell[] = [];
  /** What the cells are computed from now (inputKey), and what they show, so an unchanged frame computes and touches nothing. */
  private inputs = "";
  private sig = "";
  private readonly tips: RectTips;

  constructor() {
    for (const id of HUD_GAIN_IDS) {
      const label = el("span", "build-name");
      const iconKey = BUILD_ICONS[id];
      if (iconKey) {
        label.style.color = `#${STAT_ICON_COLORS[iconKey].toString(16).padStart(6, "0")}`;
        label.append(combatIcon(iconKey));
      }
      const value = el("span", "build-value");
      const tip = el("div", "build-tip");
      const root = el("div", `build-cell build-${id}`);
      root.append(label, value, tip);
      const cell = { root, label, value, tip };
      this.cells.set(id, cell);
      this.order.push(cell);
      this.grid.append(root);
    }
    this.root.append(this.label, this.grid);
    this.root.hidden = true;
    this.tips = new RectTips({
      container: () => this.grid,
      items: () => this.order.map((c) => c.root),
      active: () => !this.root.hidden,
      onChange: (i) => this.showTip(i),
    });
  }

  /** The strip is on screen. */
  get shown(): boolean {
    return !this.root.hidden;
  }

  /** Call every frame. `me` undefined or `visible` false (dead, in the lobby) hides the strip. The DOM is touched only when a cell changed. */
  update(me: BuildSource | undefined, visible: boolean): void {
    if (!me || !visible) {
      if (!this.root.hidden) {
        this.root.hidden = true;
        this.inputs = "";
        this.sig = "";
        this.tips.hide();
      }
      return;
    }
    const inputs = inputKey(me);
    if (!this.root.hidden && inputs === this.inputs) return;
    this.inputs = inputs;
    const label = me.faction === "sentenced" ? `${BUILD_LABEL} · Sentence: ${Math.max(0, Math.min(5, me.sentence))}/5` : BUILD_LABEL;
    if (this.label.textContent !== label) this.label.textContent = label;
    const stats = statsOf(me);
    const sig = stats.map((s) => `${s.id}=${s.value}${s.dim ? "-" : ""}|${s.tip}`).join(";");
    if (this.root.hidden) this.root.hidden = false;
    if (sig === this.sig) return;
    this.sig = sig;
    for (const s of stats) {
      const cell = this.cells.get(s.id)!;
      const iconKey = BUILD_ICONS[s.id];
      if (iconKey) {
        const label = FULL_BUILD_LABELS[s.id];
        cell.label.setAttribute("aria-hidden", "true");
        cell.root.setAttribute("aria-label", `${label} ${s.value}. ${s.tip}`);
      } else cell.label.textContent = s.label;
      cell.value.textContent = s.value;
      cell.tip.textContent = iconKey ? `${FULL_BUILD_LABELS[s.id]}. ${s.tip}` : s.tip;
      cell.root.classList.toggle("dim", s.dim);
      if (!iconKey) cell.root.setAttribute("aria-label", `${statLine(s)}. ${s.tip}`);
    }
    // Tips are rewritten, so the one on show (if any) is shown again by the next pointer move.
    this.tips.reset();
    this.showTip(-1);
  }

  destroy(): void {
    this.tips.destroy();
    this.root.remove();
  }

  private showTip(i: number): void {
    this.order.forEach((c, k) => c.root.classList.toggle(BUILD_TIP_ON, k === i));
  }
}

const BUILD_ICONS: Partial<Record<BuildStatId, InvestedStatKey>> = {
  ad: "ad", ap: "ap", damage: "damage", armor: "armor", mr: "mr", as: "attackSpeed", move: "speed", leech: "leech", health: "health",
};
const FULL_BUILD_LABELS: Partial<Record<BuildStatId, string>> = {
  ad: "Attack damage", ap: "Ability power", damage: "Damage gained", armor: "Armor gained", mr: "Magic resistance gained",
  as: "Attack speed", move: "Move speed", leech: "Life steal", health: "Health gained",
};
