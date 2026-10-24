// Builds the `fxs` message of a simulation step: that step's fx events plus the projectiles that left during it. The
// synced state has no projectiles (an arrow costs about 60 bytes as a map entry that is added and deleted, against about 20
// as a tuple in a batch that is sent anyway, and the schema encoder never lets go of a deleted entry of a map it does not
// walk), so this is how a connected client learns of them, and `inFlight` how one that joins or reconnects does. No
// Colyseus here: the Room sends what it returns, and the bandwidth bench and the wire tests call it too, so what they
// measure and check is what the Room sends.
import { packFx, type FxBatch, type FxEvent, type ProjectileLaunch } from "@raid/shared";

/** The projectiles in flight, as `world.projectiles` holds them: all that is read from each is how it left. */
export type FlyingProjectiles = ReadonlyMap<string, { readonly launch: ProjectileLaunch }>;

/** The parts of the state the roster is built from. */
interface RosterState {
  players: { entries(): Iterable<[string, { status: string }]> };
  mobs: { keys(): Iterable<string> };
  roster: { push(...ids: string[]): number };
}

export class FxChannel {
  /** Projectiles whose launch a batch already carried and that are still flying. */
  private readonly announced = new Set<string>();
  /** Fighter id -> index in `state.roster`, for the entries already pushed. */
  private readonly rostered = new Map<string, number>();
  /** The same, for the entries a patch has carried: the only ones a batch may name by index (the client has them). */
  private readonly sent = new Map<string, number>();
  private fresh: string[] = [];

  /**
   * Appends every player in the run and every mob not yet in `state.roster`. Call it right before broadcasting the patch,
   * and `rosterSent()` right after: a batch only uses an entry once the patch that carries it has gone out, so a fighter
   * that appeared in this very tick is named by its id in the batches of this tick.
   *
   * A player still in the lobby is left out: no fx names one (the lobby runs no combat), it turns `alive` in the very step
   * the run starts, and so is rostered right after that step, before any fx can name it. Every entry is for good, so
   * rostering lobby players would let a client that joins and leaves over and over grow the roster (and every joiner's
   * full state) without bound.
   */
  extendRoster(state: RosterState): void {
    const add = (id: string): void => {
      if (this.rostered.has(id)) return;
      this.rostered.set(id, state.roster.push(id) - 1);
      this.fresh.push(id);
    };
    for (const [id, p] of state.players.entries()) if (p.status !== "lobby") add(id);
    for (const id of state.mobs.keys()) add(id);
  }

  rosterSent(): void {
    for (const id of this.fresh) this.sent.set(id, this.rostered.get(id)!);
    this.fresh = [];
  }

  /**
   * The batch for one step, or null when there is nothing to send. Call it once per step, right after the step, in order:
   * a projectile is announced in the first batch after it left and its `projEnd` (always a later batch, or the same one
   * for a projectile that was loosed and stopped within the step, which then carries its own start) refers to that.
   */
  batch(fxs: readonly FxEvent[], t: number, projectiles: FlyingProjectiles): FxBatch | null {
    const launches: ProjectileLaunch[] = [];
    for (const [id, p] of projectiles) {
      if (!this.announced.has(id)) launches.push(p.launch);
    }
    const batch = fxs.length > 0 || launches.length > 0 ? packFx(fxs, t, { announced: this.announced, launches, roster: this.sent }) : null;
    // After packing: a projEnd in this batch still needs the id as it was before this step.
    for (const l of launches) this.announced.add(l.id);
    for (const id of this.announced) if (!projectiles.has(id)) this.announced.delete(id);
    return batch;
  }

  /**
   * Every projectile in flight at server time `t`, as a batch with no events: what a client that joins or reconnects is
   * sent (the synced state has none), to be read like any other batch. Sent while the client is still joining, core queues
   * it behind the full state and ahead of every later batch, so the launches and ends that follow it are consistent with
   * it; a launch that comes twice (the client's first batch also carried it) is harmless. It does not touch what the
   * channel has announced to everyone else. `back` is how long each has flown: at most a ball's whole flight, under 600 ms.
   */
  inFlight(projectiles: FlyingProjectiles, t: number): FxBatch {
    return packFx([], t, { launches: [...projectiles.values()].map((p) => p.launch) });
  }
}
