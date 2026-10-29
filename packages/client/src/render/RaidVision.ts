import type Phaser from "phaser";
import { VisionMemory, VISION_RADIUS, TILE, Y_SCALE, withGates, type GameMap, type Vec2, type VisionSnapshotMessage } from "@raid/shared";

export interface VisionCamp { wardOwner: string; wardExpiresAt: number }
/** Session-local live vision. Ward expiry never refreshes the personal trail. */
export class RaidVision {
  private map: GameMap | null = null;
  private lockedMap: GameMap | null = null;
  private memory: VisionMemory | null = null;
  private wards = new Map<number, { memory: VisionMemory; end: number; map: GameMap }>();
  private now = 0;
  private trackedTargetId = "";
  enabled = false;

  reset(map: GameMap | null = null): void {
    this.map = map;
    this.lockedMap = map ? withGates(map) : null;
    this.memory = map ? new VisionMemory(map.w, map.h) : null;
    this.wards.clear();
    this.enabled = false;
    this.trackedTargetId = "";
  }

  applySnapshot(snapshot: VisionSnapshotMessage): void {
    if (!this.map || !this.memory || snapshot.seed !== this.map.seed || snapshot.w !== this.map.w || snapshot.h !== this.map.h) return;
    this.memory.clear();
    for (const [index, expires] of snapshot.cells) {
      if (Number.isInteger(index) && index >= 0 && index < this.memory.expiresAt.length && Number.isFinite(expires) && expires > snapshot.at)
        this.memory.expiresAt[index] = expires;
    }
  }

  update(map: GameMap, locked: boolean, origin: Vec2 | undefined, alive: boolean, active: boolean,
    training: boolean, localId: string, camps: ArrayLike<VisionCamp>, now: number): void {
    if (map !== this.map) this.reset(map);
    this.now = now;
    this.enabled = active && !training;
    if (!this.enabled) { this.memory?.clear(); this.wards.clear(); return; }
    const sight = locked ? this.lockedMap! : map;
    if (origin && alive) this.memory!.update(sight, origin, now);
    const seen = new Set<number>();
    for (let i = 0; i < camps.length; i++) {
      const camp = camps[i], def = map.camps[i];
      if (!camp || !def || camp.wardOwner !== localId || !(camp.wardExpiresAt > now)) continue;
      seen.add(i);
      let ward = this.wards.get(i);
      if (!ward || ward.end !== camp.wardExpiresAt || ward.map !== sight) {
        ward = { memory: new VisionMemory(map.w, map.h), end: camp.wardExpiresAt, map: sight };
        ward.memory.update(sight, def, now, camp.wardExpiresAt - now, VISION_RADIUS);
        this.wards.set(i, ward);
      }
    }
    for (const i of this.wards.keys()) if (!seen.has(i)) this.wards.delete(i);
  }

  readonly canSee = (point: Vec2): boolean => {
    if (!this.enabled) return true;
    if (this.memory?.canSee(point, this.now)) return true;
    for (const ward of this.wards.values()) if (this.now < ward.end && ward.memory.canSee(point, this.now)) return true;
    return false;
  };

  /** Set the server-authorized hunted player. The exception is actor-only, never an area around that player. */
  setTrackedTarget(id: string): void {
    this.trackedTargetId = typeof id === "string" ? id : "";
  }

  /** Actor visibility includes the hunted rival while generic terrain and point queries retain normal fog rules. */
  canSeeActor(id: string, point: Vec2): boolean {
    return (this.enabled && id === this.trackedTargetId) || this.canSee(point);
  }
}

/** Common collection adapter prevents hidden actors leaking through a map or objective UI. */
export function visibleCollection<T extends Vec2>(source: { forEach(cb: (item: T, id: string) => void): void }, canSee: (point: Vec2) => boolean) {
  return { forEach(cb: (item: T, id: string) => void): void { source.forEach((item, id) => { if (canSee(item)) cb(item, id); }); } };
}

/** Unknown terrain remains legible for route planning; actors are culled separately. */
export class VisionFog {
  private readonly g: Phaser.GameObjects.Graphics;
  private last = -Infinity;
  constructor(scene: Phaser.Scene) { this.g = scene.add.graphics().setDepth(7e5); }
  update(vision: RaidVision, map: GameMap, now: number, camera: { worldView: { x: number; y: number; width: number; height: number } }): void {
    if (!vision.enabled) { this.g.clear(); return; }
    if (now - this.last < 100) return;
    this.last = now;
    const view = camera.worldView;
    const x0 = Math.max(0, Math.floor(view.x / TILE)), x1 = Math.min(map.w, Math.ceil((view.x + view.width) / TILE));
    const y0 = Math.max(0, Math.floor(view.y / Y_SCALE / TILE)), y1 = Math.min(map.h, Math.ceil((view.y + view.height) / Y_SCALE / TILE));
    this.g.clear().fillStyle(0x070d18, 0.62);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (!vision.canSee({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE })) this.g.fillRect(x * TILE, y * TILE * Y_SCALE, TILE + 0.2, TILE * Y_SCALE + 0.2);
    }
  }
  reset(): void { this.last = -Infinity; this.g.clear(); }
  destroy(): void { this.g.destroy(); }
}
