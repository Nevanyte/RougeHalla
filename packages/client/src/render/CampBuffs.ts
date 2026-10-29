import Phaser from "phaser";
import { mobStatReward, mobTypeById, type GameMap } from "@raid/shared";
import type { InvestedStatKey } from "@raid/shared";
import type { MobState } from "@raid/shared/schema";
import { drawCombatIcon, STAT_ICON_COLORS } from "../ui/combatIcons";
import { projX, projY } from "./projection";

type CampRuntime = { type?: string; elite?: string; state?: number };
type MobPosition = Pick<MobState, "camp" | "kind" | "status" | "type" | "x" | "y">;
interface Badge { root: Phaser.GameObjects.Container; signature: string }
const LABEL_WIDTH = 164;

/** One cached marker per living, visible camp group; normal mob stats and elite augment drops are shown together. */
export class CampBuffs {
  private readonly badges = new Map<number, Badge>();
  constructor(private readonly scene: Phaser.Scene) {}

  update(
    map: GameMap,
    camps: ArrayLike<CampRuntime> | undefined,
    active: boolean,
    canSee: (p: { x: number; y: number }) => boolean = () => true,
    mobs?: Iterable<MobPosition>,
  ): void {
    const grouped = new Map<number, MobPosition[]>();
    if (mobs) for (const mob of mobs) {
      if (mob.status !== "alive" || mob.camp <= 0 || !canSee(mob)) continue;
      const group = grouped.get(mob.camp - 1) ?? [];
      group.push(mob);
      grouped.set(mob.camp - 1, group);
    }
    for (const [i, badge] of this.badges) if (!active || i >= map.camps.length) badge.root.setVisible(false);
    if (!active) return;

    for (let i = 0; i < map.camps.length; i++) {
      const camp = camps?.[i];
      const live = grouped.get(i) ?? [];
      const types = [...new Set(live.map(mob => mob.type).filter(Boolean))];
      const rewards = types.map(type => ({ type: mobTypeById(type), stat: mobStatReward(type) }));
      if (!camp || camp.state === undefined || camp.state === 2 || live.length === 0 || rewards.length === 0) {
        this.badges.get(i)?.root.setVisible(false);
        continue;
      }
      const rows: Array<{ icon: InvestedStatKey; text: string }> = [];
      for (const reward of rewards) {
        if (reward.stat) rows.push({ icon: mobRewardIcon(reward.stat.effect.stat), text: `${reward.stat.name}: ${reward.stat.text}` });
        else if (reward.type?.elite) rows.push({ icon: "ap", text: `${reward.type.name}: drops an Augment chest` });
      }
      if (rows.length === 0) { this.badges.get(i)?.root.setVisible(false); continue; }
      const wording = rows.map(row => row.text).join("\n");
      const signature = rows.map(row => `${row.icon}|${row.text}`).join(";");
      let badge = this.badges.get(i);
      if (!badge) {
        badge = { root: this.scene.add.container(0, 0), signature: "" };
        this.badges.set(i, badge);
      }
      if (badge.signature !== signature) this.draw(badge, signature, rows);
      badge.root.setVisible(true);
      const center = live.reduce((sum, mob) => ({ x: sum.x + mob.x / live.length, y: sum.y + mob.y / live.length }), { x: 0, y: 0 });
      const highestY = Math.min(...live.map(mob => mob.y));
      // Leave the mob label line clear: the full reward text sits above the highest visible live mob.
      badge.root.setPosition(projX(center.x), projY(highestY) - 47 - 44);
      badge.root.setDepth(highestY - 1);
      badge.root.setName(wording.replaceAll("\n", "; "));
    }
  }

  reset(): void { for (const b of this.badges.values()) b.root.setVisible(false); }
  destroy(): void { for (const b of this.badges.values()) b.root.destroy(); this.badges.clear(); }

  private draw(badge: Badge, signature: string, rows: readonly { icon: InvestedStatKey; text: string }[]): void {
    const root = badge.root;
    root.removeAll(true);
    const iconWidth = rows.length * 22 + 12;
    const back = this.scene.add.graphics();
    back.fillStyle(0x101820, 0.96).fillRoundedRect(-iconWidth / 2, -12, iconWidth, 24, 6);
    back.lineStyle(1, 0xd7e6f3, 0.9).strokeRoundedRect(-iconWidth / 2, -12, iconWidth, 24, 6);
    rows.forEach((row, i) => {
      const icon = row.icon;
      const color = icon === "damage" ? 0xffd36a : STAT_ICON_COLORS[icon];
      drawCombatIcon(back, icon, (i - (rows.length - 1) / 2) * 22, 0, 18, color);
    });
    back.setName(rows.map(r => r.text).join("; "));
    const label = this.scene.add.text(0, -15, rows.map(r => r.text).join("\n"), {
      fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#f5f7fa", align: "center",
      wordWrap: { width: LABEL_WIDTH, useAdvancedWrap: true }, backgroundColor: "#101820eF", padding: { x: 5, y: 3 },
    }).setOrigin(0.5, 1);
    label.setName(rows.map(r => r.text).join("; "));
    root.add([back, label]);
    badge.signature = signature;
  }
}

export function mobRewardIcon(stat: string): InvestedStatKey {
  switch (stat) {
    case "ad": return "ad";
    case "ap": return "ap";
    case "damage": return "damage";
    case "maxHp": return "health";
    case "attackSpeed": return "attackSpeed";
    case "armor": return "armor";
    case "shield": return "mr";
    case "moveSpeed": return "speed";
    case "lifesteal": return "leech";
    default: return "damage";
  }
}
