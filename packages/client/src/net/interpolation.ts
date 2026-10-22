// Feeds authoritative patches into per-entity snapshot buffers and samples them in the past.
import { ServerClock, SnapshotBuffer } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";

export class EntityInterpolator {
  readonly clock = new ServerClock();
  private readonly buffers = new Map<string, SnapshotBuffer>();
  /** Newest patch seen since the last frame; the clock observes only that one (bursts after a stall would skew it). */
  private pending: { t: number; at: number } | null = null;

  /** Call from room.onStateChange (once per patch). */
  onPatch(state: RaidState, localNow: number): void {
    if (!state.players) return;
    const t = state.serverTime;
    if (!this.pending || t > this.pending.t) this.pending = { t, at: localNow };
    state.players.forEach((p, id) => {
      let buf = this.buffers.get(id);
      if (!buf) { buf = new SnapshotBuffer(); this.buffers.set(id, buf); }
      buf.push(t, p.x, p.y);
    });
    for (const id of this.buffers.keys()) {
      if (!state.players.has(id)) this.buffers.delete(id);
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
