// Feeds authoritative patches into per-entity snapshot buffers and samples them in the past.
import { EXTRAPOLATE_MS, INTERP_DELAY_MS, RenderClock, ServerClock, SnapshotBuffer, type RenderClockOptions } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";

export interface InterpolatorOptions {
  /**
   * False draws everything a fixed INTERP_DELAY_MS behind a ServerClock that snaps on a late patch (the behaviour before the
   * adaptive delay), for comparing the two (netProbe) or as a fallback. Default true: the delay follows the network
   * (shared/interp.ts RenderClock) and render time never runs backwards.
   */
  adaptive?: boolean;
  /** Overrides of the adaptive delay's numbers (the probe's experiments). */
  render?: Partial<RenderClockOptions>;
  /**
   * Draw-ahead (net/remoteDraw.ts): the adaptive delay drops by EXTRAPOLATE_MS, so render time may run up to that far past the
   * newest sample. Default false: every caller that does not draw ahead keeps today's delay.
   */
  drawAhead?: boolean;
}

/** A player's walk hint (PlayerExtraState.walkDir, walkTicks) as of the patch at server time `t`. */
export interface WalkHintSample { t: number; dir: number; ticks: number }

/** What a patch's fighter carries that the interpolator reads. */
interface Pushed { x: number; y: number; displaceSeq?: number; extra?: { walkDir?: number; walkTicks?: number } }

export class EntityInterpolator {
  /** The estimated server clock (`now`, `synced`): the adaptive delay's clock, or the legacy one. */
  readonly clock: ServerClock;
  private readonly rc: RenderClock | null;
  private readonly buffers = new Map<string, SnapshotBuffer>();
  /** Legacy mode only: the newest patch seen since the last frame; the clock observes just that one (bursts after a stall would skew it). */
  private pending: { t: number; at: number } | null = null;
  /** Server time of a teleport whose patch hasn't arrived yet: that patch is a cut for everyone, however short the jump. */
  private cutAt = Infinity;
  /** The last `displaceSeq` seen per entity: a different one in a patch means the server moved it, so it is a cut, not a slide. */
  private readonly displaced = new Map<string, number>();
  /** Players' walk hints, from the newest patch that carried one (an older server sends none). */
  private readonly hints = new Map<string, WalkHintSample>();

  constructor(options: InterpolatorOptions = {}) {
    this.rc = options.adaptive === false ? null : new RenderClock({ ...options.render, ...(options.drawAhead ? { aheadMs: EXTRAPOLATE_MS } : {}) });
    this.clock = this.rc ? this.rc.clock : new ServerClock();
  }

  /** How far behind the estimated server clock remote fighters are drawn now (ms): fixed in legacy mode. */
  get delayMs(): number { return this.rc ? this.rc.delayMs : INTERP_DELAY_MS; }

  /** The delay the network asks for now, which `delayMs` is moving towards (ms). */
  get targetDelayMs(): number { return this.rc ? this.rc.targetMs : INTERP_DELAY_MS; }

  /** Whether render time may run EXTRAPOLATE_MS past the newest sample (the legacy delay never does). */
  get drawAhead(): boolean { return (this.rc?.aheadMs ?? 0) > 0; }

  /** Turns the draw-ahead's shorter delay on or off; render time reaches the new delay by slewing, never backwards. */
  setDrawAhead(on: boolean): void {
    this.rc?.setAheadMs(on ? EXTRAPOLATE_MS : 0);
  }

  /** A teleport fx arrived and its patch has not: everyone's next sample is a cut. */
  get cutPending(): boolean { return Number.isFinite(this.cutAt); }

  /** A `teleport` fx arrived. It is sent before the patch of its tick on the same socket, so that patch isn't here yet. */
  markCut(t: number): void {
    if (Number.isFinite(t)) this.cutAt = Math.min(this.cutAt, t);
  }

  /** Call from room.onStateChange (once per patch). */
  onPatch(state: RaidState, localNow: number): void {
    if (!state.players) return;
    const t = state.serverTime;
    if (this.rc) this.rc.onPatch(t, localNow);
    else if (!this.pending || t > this.pending.t) this.pending = { t, at: localNow };
    // At or after: a catch-up step can publish a later tick than the teleport's.
    const cut = t >= this.cutAt;
    if (cut) this.cutAt = Infinity;
    // Players and mobs share one id space (the server's combatants), so one set of buffers serves both.
    const push = (e: Pushed, id: string) => {
      let buf = this.buffers.get(id);
      if (!buf) { buf = new SnapshotBuffer(); this.buffers.set(id, buf); }
      // A blink or a pull (D24): the entity did not walk that far, so it must not be drawn sliding across. Only this entity is cut.
      const seq = e.displaceSeq ?? 0;
      const before = this.displaced.get(id);
      this.displaced.set(id, seq);
      buf.push(t, e.x, e.y, cut || (before !== undefined && before !== seq));
    };
    state.players.forEach((e: Pushed, id: string) => {
      push(e, id);
      const ticks = e.extra?.walkTicks;
      if (ticks === undefined) return;
      let h = this.hints.get(id);
      if (!h) { h = { t, dir: 0, ticks: 0 }; this.hints.set(id, h); }
      h.t = t;
      h.dir = e.extra?.walkDir ?? 0;
      h.ticks = ticks;
    });
    state.mobs?.forEach(push);
    for (const id of this.buffers.keys()) {
      if (!state.players.has(id) && !state.mobs?.has(id)) { this.buffers.delete(id); this.displaced.delete(id); this.hints.delete(id); }
    }
  }

  /** Call once per frame, before sampling. */
  renderTime(localNow: number): number {
    if (this.rc) return this.rc.renderTime(localNow);
    if (this.pending) {
      this.clock.observe(this.pending.t, this.pending.at);
      this.pending = null;
    }
    return this.clock.renderTime(localNow);
  }

  sample(id: string, renderTime: number, out: { x: number; y: number }): boolean {
    return this.buffers.get(id)?.sample(renderTime, out) ?? false;
  }

  /** The entity's snapshot buffer (the draw-ahead reads its newest step), if it has one. */
  buffer(id: string): SnapshotBuffer | undefined {
    return this.buffers.get(id);
  }

  /** A player's walk hint from the newest patch that carried one; undefined for a mob, or from a server that sends none. */
  hintOf(id: string): Readonly<WalkHintSample> | undefined {
    return this.hints.get(id);
  }
}
