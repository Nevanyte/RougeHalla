import type Phaser from "phaser";
import { Y_SCALE, type GameMap } from "@raid/shared";
import type { VisionCamp } from "./RaidVision";
import { projX, projY } from "./projection";

interface Beacon { g: Phaser.GameObjects.Graphics; text: Phaser.GameObjects.Text; seconds: number; owner: string }
/** Public camp beacons show ward ownership and expiry without exposing any actor positions. */
export class CampWards {
  private readonly beacons = new Map<number, Beacon>();
  constructor(private readonly scene: Phaser.Scene) {}
  update(map: GameMap, camps: ArrayLike<VisionCamp>, now: number, localId: string, active: boolean): void {
    const seen = new Set<number>();
    if (active) for (let i = 0; i < camps.length; i++) {
      const camp = camps[i], def = map.camps[i];
      if (!camp || !def || !camp.wardOwner || !(now < camp.wardExpiresAt)) continue;
      seen.add(i);
      let beacon = this.beacons.get(i);
      if (beacon && beacon.owner !== camp.wardOwner) { beacon.g.destroy(); beacon.text.destroy(); this.beacons.delete(i); beacon = undefined; }
      if (!beacon) {
        const color = camp.wardOwner === localId ? 0x66e4ef : 0x9aa9bd;
        const g = this.scene.add.graphics().setPosition(projX(def.x), projY(def.y)).setDepth(750000);
        g.lineStyle(2, color, 0.7).strokeEllipse(0, 0, 46, 46 * Y_SCALE);
        g.lineStyle(2, color, 0.9).lineBetween(0, 0, 0, -28);
        g.fillStyle(color, 0.9).fillTriangle(0, -42, -7, -30, 7, -30);
        const text = this.scene.add.text(projX(def.x), projY(def.y) - 48, "", {
          fontFamily: "system-ui, sans-serif", fontSize: "11px", color: camp.wardOwner === localId ? "#66e4ef" : "#b9c6d7", stroke: "#08101d", strokeThickness: 3,
        }).setOrigin(0.5, 1).setDepth(750001);
        beacon = {g,text,seconds:-1,owner:camp.wardOwner}; this.beacons.set(i, beacon);
      }
      const seconds = Math.ceil((camp.wardExpiresAt - now) / 1000);
      if (beacon.seconds !== seconds) { beacon.text.setText(`${camp.wardOwner === localId ? "YOUR WARD" : "WARD"} ${seconds}s`); beacon.seconds = seconds; }
    }
    for (const [i, beacon] of this.beacons) if (!seen.has(i)) { beacon.g.destroy(); beacon.text.destroy(); this.beacons.delete(i); }
  }
  reset(): void { for (const beacon of this.beacons.values()) { beacon.g.destroy(); beacon.text.destroy(); } this.beacons.clear(); }
  destroy(): void { this.reset(); }
}
