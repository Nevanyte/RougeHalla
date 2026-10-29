// Both bot drivers derive sight only from their own position and public camp wards, like the client.
import { VisionMemory, VISION_RADIUS, withGates, type GameMap, type Vec2 } from "@raid/shared";
import type { PerceptionInput } from "./perception";
import type { Percept } from "./types";

export class BotVision {
  private readonly memory: VisionMemory;
  private readonly locked: GameMap;
  private readonly wards = new Map<number, { memory: VisionMemory; end: number; map: GameMap }>();
  private enabled = false;
  private now = 0;

  constructor(private readonly map: GameMap) {
    this.memory = new VisionMemory(map.w, map.h);
    this.locked = withGates(map);
  }

  update(input: PerceptionInput, selfId: string): void {
    const state = input.state;
    this.now = state.serverTime;
    this.enabled = state.phase === "active" && !state.training;
    if (!this.enabled) { this.memory.clear(); this.wards.clear(); return; }
    // A reconnect may restore only this seat's private trail; never copy it into the brain's message stream.
    for (const message of input.privates ?? []) {
      if (message.type !== "vision") continue;
      const snapshot = message.msg as { seed?: number; w?: number; h?: number; cells?: unknown } | null;
      if (!snapshot || snapshot.seed !== this.map.seed || snapshot.w !== this.map.w || snapshot.h !== this.map.h || !Array.isArray(snapshot.cells)) continue;
      this.memory.clear();
      for (const cell of snapshot.cells) {
        if (!Array.isArray(cell)) continue;
        const [index, expiry] = cell;
        if (Number.isInteger(index) && index >= 0 && index < this.memory.expiresAt.length && Number.isFinite(expiry) && expiry > this.now)
          this.memory.expiresAt[index] = expiry;
      }
    }
    const sight = state.gatesLocked ? this.locked : this.map;
    const me = state.players.get(selfId);
    if (me?.status === "alive") this.memory.update(sight, { x: Math.fround(me.x), y: Math.fround(me.y) }, this.now);
    const seen = new Set<number>();
    for (let i = 0; state.camps && i < state.camps.length; i++) {
      const camp = state.camps[i], site = this.map.camps[i];
      if (!camp || !site || camp.wardOwner !== selfId || !(camp.wardExpiresAt! > this.now)) continue;
      seen.add(i);
      let ward = this.wards.get(i);
      if (!ward || ward.end !== camp.wardExpiresAt || ward.map !== sight) {
        ward = { memory: new VisionMemory(this.map.w, this.map.h), end: camp.wardExpiresAt!, map: sight };
        ward.memory.update(sight, site, this.now, ward.end - this.now, VISION_RADIUS);
        this.wards.set(i, ward);
      }
    }
    for (const index of this.wards.keys()) if (!seen.has(index)) this.wards.delete(index);
  }

  readonly canSee = (point: Vec2): boolean => {
    if (!this.enabled || this.memory.canSee(point, this.now)) return true;
    for (const ward of this.wards.values()) if (this.now < ward.end && ward.memory.canSee(point, this.now)) return true;
    return false;
  };

  /** The delay ring may interpolate across unseen terrain or retain a projectile after it leaves sight. */
  filter(percept: Percept): Percept {
    if (!this.enabled) return percept;
    const fighters = percept.fighters.filter(this.canSee), mobs = percept.mobs.filter(this.canSee);
    const ids = new Set([percept.self.id, ...fighters.map((f) => f.id), ...mobs.map((m) => m.id)]);
    return {
      ...percept, fighters, mobs,
      containers: percept.containers.filter(this.canSee), projectiles: percept.projectiles.filter(this.canSee),
      minimap: { ...percept.minimap, mobs: percept.minimap.mobs.filter(this.canSee) },
      events: percept.events.flatMap((event) => {
        if (event.at === null || this.canSee(event.at)) return [event];
        return event.kind === "death" ? [{ ...event, at: null, by: null }] : [];
      }),
      extras: {
        ...percept.extras,
        ...(percept.extras.fields ? { fields: percept.extras.fields.filter((f) => this.canSee(f) && (f.kind !== "trail" || this.canSee({ x: f.x2, y: f.y2 }))) } : {}),
        ...(percept.extras.chests ? { chests: percept.extras.chests.filter(this.canSee) } : {}),
        ...(percept.extras.effects ? { effects: Object.fromEntries(Object.entries(percept.extras.effects).filter(([id]) => ids.has(id))) } : {}),
      },
    };
  }
}
