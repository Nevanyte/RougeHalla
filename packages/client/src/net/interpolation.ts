// Feeds authoritative patches into per-entity snapshot buffers and samples them in the past.
import { ServerClock, SnapshotBuffer } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";

export class EntityInterpolator {
  readonly clock = new ServerClock();
  private readonly buffers = new Map<string, SnapshotBuffer>();
  /** Newest patch seen since the last frame; the clock observes only that one (bursts after a stall would skew it). */
  private pending: { t: number; at: number } | null = null;
  /** Server time of a teleport whose patch hasn't arrived yet: that patch is a cut for everyone, however short the jump. */
  private cutAt = Infinity;

  /** A `teleport` fx arrived. It is sent before the patch of its tick on the same socket, so that patch isn't here yet. */
  markCut(t: number): void {
    if (Number.isFinite(t)) this.cutAt = Math.min(this.cutAt, t);
  }

  /** Call from room.onStateChange (once per patch). */
  onPatch(state: RaidState, localNow: number): void {
    if (!state.players) return;
    const t = state.serverTime;
    if (!this.pending || t > this.pending.t) this.pending = { t, at: localNow };
    // At or after: a catch-up step can publish a later tick than the teleport's.
    const cut = t >= this.cutAt;
    if (cut) this.cutAt = Infinity;
    // Players and mobs share one id space (the server's combatants), so one set of buffers serves both.
    const push = (e: { x: number; y: number }, id: string) => {
      let buf = this.buffers.get(id);
      if (!buf) { buf = new SnapshotBuffer(); this.buffers.set(id, buf); }
      buf.push(t, e.x, e.y, cut);
    };
    state.players.forEach(push);
    state.mobs?.forEach(push);
    for (const id of this.buffers.keys()) {
      if (!state.players.has(id) && !state.mobs?.has(id)) this.buffers.delete(id);
    }
  }

  /** Call once per frame, before sampling. */
  renderTime(localNow: number): number {
    if (this.pending) {
      this.clock.observe(this.pending.t, this.pending.at);
      this.pending = null;
    }
    return this.clock.renderTime(localNow);
  }

  sample(id: string, renderTime: number, out: { x: number; y: number }): boolean {
    return this.buffers.get(id)?.sample(renderTime, out) ?? false;
  }
}
