import { combatReadability, FACTIONS, FISTS, isFactionId, isWeaponId, WEAPONS, type InvestedStatKey } from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { heldWeapon, inputKey } from "./buildHud";
import { buildGains, num, type BuildStatId } from "./buildModel";
import { combatIcon, STAT_ICON_COLORS } from "./combatIcons";
import { cssColor, el } from "./dom";
import { fullMapSize } from "./planningMath";
import "./mapRoster.css";

export interface MapRosterPlayer { id: string; player: PlayerState }
export interface MapRosterStat { key: InvestedStatKey; label: string; short: string; value: string }
export interface MapRosterRow {
  id: string; name: string; champion: string; alive: boolean; local: boolean; strength: number;
  weapons: readonly { name: string; color: number; active: boolean }[];
  stats: MapRosterStat[];
}

const GAIN_ID: Record<InvestedStatKey, BuildStatId> = {
  ad: "ad", ap: "ap", damage: "damage", health: "health", attackSpeed: "as", armor: "armor", mr: "mr", speed: "move", leech: "leech",
};
export const BUILD_STRENGTH_TIP = "Build strength combines gained stats and PvP growth. Includes mob rewards and current bonuses. Remaining health and matchups are not scored.";

/** Current synced kits are public in the Tab roster; actor positions still follow the map's vision rules. */
export function mapRosterRows(players: readonly MapRosterPlayer[], localId = ""): MapRosterRow[] {
  return players.map(({ id, player: p }) => {
    const read = combatReadability(p);
    const gains = buildGains({ faction: p.faction, build: p.build, wire: p, weapon: heldWeapon(p),
      hpFrac: p.maxHp > 0 ? p.hp / p.maxHp : 1, mobStats: p.mobStats, maxHp: p.maxHp, campClears: p.campClears });
    const byId = new Map(gains.map(s => [s.id, s]));
    const strength = (1 + read.investedStats.reduce((sum, stat) => sum + stat.score, 0)) * read.powerRatio;
    return {
      id, name: p.name, champion: isFactionId(p.faction) ? FACTIONS[p.faction].displayName : p.faction,
      alive: p.status === "alive", local: id === localId, strength,
      weapons: [p.weapon0, p.weapon1].map((id, index) => {
        const weapon = WEAPONS[isWeaponId(id) ? id : FISTS];
        return { name: weapon.name, color: weapon.color, active: p.slot === index };
      }),
      stats: read.investedStats.slice(0, 3).map(stat => ({ key: stat.key, label: stat.label, short: stat.short, value: byId.get(GAIN_ID[stat.key])!.value })),
    };
  }).sort((a, b) => b.strength - a.strength || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Reserve a left column while keeping the square map inside the overlay, including narrow windows. */
export function mapRosterLayout(uiW: number, uiH: number, textScale = 1): { roster: number; map: number } {
  const roster = Math.floor(Math.max(140, Math.min(320 * textScale, uiW * .36)));
  return { roster, map: Math.max(80, Math.min(fullMapSize(uiW, uiH), Math.floor(uiW - roster - 40))) };
}

export class MapRoster {
  readonly element = el("aside", "map-roster");
  private readonly list = el("ol", "map-roster-list");
  private signature = "";

  constructor() {
    this.element.hidden = true;
    this.element.setAttribute("aria-label", "Players, strongest build first");
    const title = el("h2", "map-roster-title", "Players");
    const order = el("span", "map-roster-order", "Build strength ↓"); order.title = BUILD_STRENGTH_TIP;
    const head = el("div", "map-roster-head"); head.append(title, order);
    this.list.setAttribute("aria-live", "off");
    this.element.append(head, this.list);
    for (const event of ["pointerdown", "mousedown", "touchstart", "click", "contextmenu", "wheel"])
      this.element.addEventListener(event, e => e.stopPropagation());
  }

  update(players: readonly MapRosterPlayer[], localId: string, shown: boolean): void {
    this.element.hidden = !shown;
    if (!shown) return;
    const signature = `${localId}|${players.map(({ id, player: p }) => `${id}:${p.name}:${p.status}:${p.weapon0}:${p.weapon1}:${p.slot}:${inputKey(p)}`).join("|")}`;
    if (signature === this.signature) return;
    this.signature = signature;
    this.list.replaceChildren(...mapRosterRows(players, localId).map((row, index) => this.renderRow(row, index)));
  }

  private renderRow(row: MapRosterRow, index: number): HTMLElement {
    const item = el("li", "map-roster-player");
    item.setAttribute("data-player-id", row.id);
    item.classList.toggle("local", row.local); item.classList.toggle("out", !row.alive);
    const name = el("strong", "map-roster-name", row.name);
    const identity = el("div", "map-roster-identity");
    identity.append(name, el("span", "map-roster-champion", `${row.champion}${row.local ? " · You" : ""}${row.alive ? "" : " · Out"}`));
    const strength = el("span", "map-roster-strength", num(row.strength));
    strength.title = BUILD_STRENGTH_TIP; strength.setAttribute("aria-label", `Build strength ${num(row.strength)}`);
    const head = el("div", "map-roster-player-head"); head.append(el("span", "map-roster-rank", String(index + 1)), identity, strength);
    const weapons = el("div", "map-roster-weapons");
    row.weapons.forEach((weapon, slot) => {
      const chip = el("span", "map-roster-weapon", `${slot + 1} ${weapon.name}`);
      chip.style.setProperty("--roster-weapon", cssColor(weapon.color));
      chip.classList.toggle("active", weapon.active);
      chip.title = `Slot ${slot + 1}: ${weapon.name}${weapon.active ? " (in hand)" : ""}`;
      weapons.append(chip);
    });
    const stats = el("div", "map-roster-stats");
    if (row.stats.length === 0) stats.append(el("span", "map-roster-fresh", "No stat gains yet"));
    for (const stat of row.stats) {
      const chip = el("span", "map-roster-stat");
      chip.style.color = cssColor(STAT_ICON_COLORS[stat.key]);
      chip.title = `${stat.label}: ${stat.value}`; chip.setAttribute("aria-label", chip.title);
      chip.append(combatIcon(stat.key), el("span", undefined, stat.short), el("strong", undefined, stat.value));
      stats.append(chip);
    }
    item.append(head, weapons, stats);
    return item;
  }

  destroy(): void { this.element.remove(); }
}
