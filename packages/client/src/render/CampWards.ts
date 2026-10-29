import type Phaser from "phaser";
import { Y_SCALE, type GameMap } from "@raid/shared";
import type { VisionCamp } from "./RaidVision";
import { projX, projY } from "./projection";

interface Beacon { g: Phaser.GameObjects.Graphics; text: Phaser.GameObjects.Text; seconds: number; owner: string }
interface CampTimer { text: Phaser.GameObjects.Text; value: string }
/** Public camp beacons show ward ownership and expiry without exposing any actor positions. */
export class CampWards {
  private readonly beacons = new Map<number, Beacon>();
  private readonly timers = new Map<number, CampTimer>();
  constructor(private readonly scene: Phaser.Scene) {}
  update(map: GameMap, camps: ArrayLike<VisionCamp & { state?: number; respawnAt?: number }>, now: number, localId: string, active: boolean): void {
    const seen = new Set<number>();
    const timersSeen = new Set<number>();
    if (active) for (let i = 0; i < camps.length; i++) {
      const camp = camps[i], def = map.camps[i];
      if (!camp || !def) continue;
      let label = "";
      if (camp.state === 2 && camp.respawnAt && camp.respawnAt > now) label = `RESPAWN ${Math.ceil((camp.respawnAt - now) / 1000)}s`;
      else if (camp.state === 2 && camp.respawnAt && camp.respawnAt <= now) label = "RESPAWN READY";
      if (!label) continue;
      timersSeen.add(i);
      let timer = this.timers.get(i);
      if (!timer) {
        const text = this.scene.add.text(Math.round(projX(def.x)), Math.round(projY(def.y)) + 32, "", {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "11px", color: "#e5edf7",
          stroke: "#08101d", strokeThickness: 3, fixedWidth: 128, align: "center",
        }).setOrigin(0.5, 0).setDepth(750001);
        timer = { text, value: "" };
        this.timers.set(i, timer);
      }
      if (timer.value !== label) { timer.text.setText(label); timer.value = label; }
    }
    for (const [i, timer] of this.timers) {
      if (!timersSeen.has(i)) { timer.text.destroy(); this.timers.delete(i); }
    }
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
        const text = this.scene.add.text(Math.round(projX(def.x)), Math.round(projY(def.y) - 48), "", {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "11px", color: camp.wardOwner === localId ? "#66e4ef" : "#b9c6d7", stroke: "#08101d", strokeThickness: 3, fixedWidth: 116, align: "center",
        }).setOrigin(0.5, 1).setDepth(750001);
        beacon = {g,text,seconds:-1,owner:camp.wardOwner}; this.beacons.set(i, beacon);
      }
      const seconds = Math.ceil((camp.wardExpiresAt - now) / 1000);
      if (beacon.seconds !== seconds) { beacon.text.setText(`${camp.wardOwner === localId ? "YOUR WARD" : "WARD"} ${seconds}s`); beacon.seconds = seconds; }
    }
    for (const [i, beacon] of this.beacons) if (!seen.has(i)) { beacon.g.destroy(); beacon.text.destroy(); this.beacons.delete(i); }
  }
  reset(): void {
    for (const beacon of this.beacons.values()) { beacon.g.destroy(); beacon.text.destroy(); }
    this.beacons.clear();
    for (const timer of this.timers.values()) timer.text.destroy();
    this.timers.clear();
  }
  destroy(): void { this.reset(); }
}
