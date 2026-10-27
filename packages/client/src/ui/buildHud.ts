// The build strip (BALANCE_CONTRACT 9): under the cards row in the HUD plate, nine small cells that say what the cards and the weapon in
// hand add up to: AD, AP, armor, magic resist, attack speed, move, leech, card power P and the PvP factor it earns ("PvP x1.39"). The
// numbers come from the synced stat mirrors and the build (ui/buildModel.ts, pure); this only lays them out. Like the cards row it is
// click-through all the way down (a right-click move and a left-click lock under it must reach the canvas), so its tooltips are found
// by hit-testing the pointer against the cells' rectangles (rectTips.ts), not by :hover. Hidden while the player does not stand.
import { isWeaponId, type WeaponId } from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { BUILD_STAT_IDS, buildStats, statLine, type BuildStat, type BuildStatId } from "./buildModel";
import "./buildHud.css";
import { el } from "./dom";
import { RectTips } from "./rectTips";

/** The class that shows a cell's tooltip while the pointer is over it. */
export const BUILD_TIP_ON = "tip-on";
export const BUILD_LABEL = "Build";

interface Cell {
  root: HTMLElement;
  label: HTMLElement;
  value: HTMLElement;
  tip: HTMLElement;
}

/** The part of a player the strip reads: the synced PlayerState, or a test's plain object. */
export type BuildSource = Pick<PlayerState, "faction" | "build" | "asMult" | "windupMult" | "speedMult" | "armorBonus" | "shieldBonus" | "adBonus" | "apBonus"
  | "weapon0" | "weapon1" | "slot" | "hp" | "maxHp">;

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
  return `${me.faction}|${heldWeapon(me)}|${me.asMult}|${me.windupMult}|${me.speedMult}|${me.armorBonus}|${me.shieldBonus}|${me.adBonus}|${me.apBonus}|${low ? "L" : ""}|${cards}`;
}

/** The strip's cells for a player. */
export function statsOf(me: BuildSource): BuildStat[] {
  return buildStats({
    faction: me.faction, build: me.build, wire: me, weapon: heldWeapon(me), hpFrac: me.maxHp > 0 ? me.hp / me.maxHp : 1,
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
    for (const id of BUILD_STAT_IDS) {
      const label = el("span", "build-name");
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
    const stats = statsOf(me);
    const sig = stats.map((s) => `${s.id}=${s.value}${s.dim ? "-" : ""}|${s.tip}`).join(";");
    if (this.root.hidden) this.root.hidden = false;
    if (sig === this.sig) return;
    this.sig = sig;
    for (const s of stats) {
      const cell = this.cells.get(s.id)!;
      cell.label.textContent = s.label;
      cell.value.textContent = s.value;
      cell.tip.textContent = s.tip;
      cell.root.classList.toggle("dim", s.dim);
      cell.root.setAttribute("aria-label", `${statLine(s)}. ${s.tip}`);
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
