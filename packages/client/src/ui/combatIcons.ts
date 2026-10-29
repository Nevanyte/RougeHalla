import type Phaser from "phaser";
import type { InvestedStatKey } from "@raid/shared";
import { el } from "./dom";
import "./combatIcons.css";

export type CombatIconKey = InvestedStatKey | "physical" | "magic" | "true";
type Shape = { fill?: number[][]; lines?: number[][] };
const sword: Shape = { fill: [[5, 16, 16, 3, 21, 3, 21, 8, 8, 19]], lines: [[4, 13, 12, 21], [8, 17, 3, 22]] };
const shield: Shape = { lines: [[12, 2, 21, 6, 20, 15, 16, 20, 12, 23, 8, 20, 4, 15, 3, 6, 12, 2], [12, 6, 12, 18]] };
const plus: Shape = { lines: [[12, 4, 12, 20], [4, 12, 20, 12]] };
const sparkle: Shape = { fill: [[12, 1, 15, 9, 23, 12, 15, 15, 12, 23, 9, 15, 1, 12, 9, 9]] };
const bow: Shape = { lines: [[6, 2, 13, 5, 17, 12, 13, 19, 6, 22, 6, 2], [2, 12, 23, 12], [19, 8, 23, 12, 19, 16]] };
const boot: Shape = { fill: [[6, 2, 13, 2, 13, 12, 21, 16, 22, 21, 3, 21, 3, 16, 6, 13]] };
const drop: Shape = { fill: [[12, 1, 20, 12, 21, 17, 18, 22, 6, 22, 3, 17, 4, 12]] };
const genericDamage: Shape = { fill: [...(sword.fill ?? []), ...(sparkle.fill ?? [])], lines: sword.lines };
const bubbleShield: Shape = {
  lines: [[12, 2, 16, 3, 20, 6, 22, 10, 22, 14, 20, 18, 16, 21, 12, 22, 8, 21, 4, 18, 2, 14, 2, 10, 4, 6, 8, 3, 12, 2], [12, 6, 19, 9, 18, 15, 15, 18, 12, 20, 9, 18, 6, 15, 5, 9, 12, 6]],
};
const GLYPHS: Record<CombatIconKey, Shape> = {
  ad: sword, ap: sparkle, damage: genericDamage, health: plus, attackSpeed: bow, armor: shield, mr: bubbleShield, speed: boot, leech: drop,
  physical: sword, magic: sparkle, true: { lines: [[12, 2, 21, 12, 12, 22, 3, 12, 12, 2], [7, 12, 11, 16, 17, 8]] },
};
export const STAT_ICON_COLORS: Record<InvestedStatKey, number> = {
  ad: 0xffb074, ap: 0xc4a0ff, damage: 0xffd36a, health: 0x62d889, attackSpeed: 0xffdc78,
  armor: 0xd5e0e8, mr: 0x75cfff, speed: 0x80d6ff, leech: 0xf05260,
};
export const STAT_LABELS: Record<InvestedStatKey, string> = {
  ad: "Attack damage", ap: "Ability power", damage: "Damage", health: "Health", attackSpeed: "Attack speed",
  armor: "Armor", mr: "Magic resistance", speed: "Move speed", leech: "Life steal",
};
const DAMAGE_LABELS = { physical: "Physical damage", magic: "Magic damage", true: "True damage" } as const;

function points(coords: number[]): string {
  return Array.from({ length: coords.length / 2 }, (_, i) => `${coords[i * 2]},${coords[i * 2 + 1]}`).join(" ");
}

export function combatIconSvg(id: CombatIconKey): string {
  const shape = GLYPHS[id];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${(shape.fill ?? []).map(p => `<polygon fill="white" points="${points(p)}"/>`).join("")}${(shape.lines ?? []).map(p => `<polyline fill="none" points="${points(p)}"/>`).join("")}</g></svg>`;
}

export function combatIcon(id: CombatIconKey): HTMLElement {
  const node = el("span", "combat-icon");
  node.setAttribute("aria-hidden", "true");
  node.style.setProperty("--combat-icon", `url("data:image/svg+xml,${encodeURIComponent(combatIconSvg(id))}")`);
  return node;
}

export function iconLabel(id: CombatIconKey): string {
  return id in STAT_LABELS ? STAT_LABELS[id as InvestedStatKey] : DAMAGE_LABELS[id as keyof typeof DAMAGE_LABELS];
}

/** Draw the catalog silhouette directly into Phaser graphics; no generated text or texture. */
export function drawCombatIcon(g: Phaser.GameObjects.Graphics, id: CombatIconKey, x: number, y: number, size: number, color: number): void {
  const shape = GLYPHS[id];
  const scale = size / 24;
  g.fillStyle(color, 1).lineStyle(1.8 * scale, color, 1);
  for (const [filled, paths] of [[true, shape.fill ?? []], [false, shape.lines ?? []]] as const) {
    for (const path of paths) {
      g.beginPath().moveTo(x + (path[0]! - 12) * scale, y + (path[1]! - 12) * scale);
      for (let i = 2; i < path.length; i += 2) g.lineTo(x + (path[i]! - 12) * scale, y + (path[i + 1]! - 12) * scale);
      if (filled) g.closePath().fillPath();
      g.strokePath();
    }
  }
}
