// Builds the `fxs` message of a simulation step: that step's fx events plus the projectiles that left during it. The
// state patches carry no projectiles (`RaidState.projectiles` is in the full state only: an arrow costs about 60 bytes
// as a map entry that is added and deleted, against about 20 as a tuple in a batch that is sent anyway), so this is how
// a connected client learns of them. No Colyseus here: the Room sends what it returns, and the bandwidth bench and the
// wire tests call it too, so what they measure and check is what the Room sends.
import { packFx, type FxBatch, type FxEvent, type ProjectileKind, type ProjectileLaunch } from "@raid/shared";
import type { ProjectileState } from "@raid/shared/schema";

/** The part of the state's `projectiles` map that is read. */
interface ProjectileMap {
  forEach(cb: (p: ProjectileState, id: string) => void): void;
  has(id: string): boolean;
}

/** The parts of the state the roster is built from. */
interface RosterState {
  players: { keys(): Iterable<string> };
  mobs: { keys(): Iterable<string> };
  roster: { push(...ids: string[]): number };
}

export class FxChannel {
  /** Projectiles whose launch a batch already carried and that are still in the state. */
  private readonly announced = new Set<string>();
  /** Fighter id -> index in `state.roster`, for the entries already pushed. */
  private readonly rostered = new Map<string, number>();
  /** The same, for the entries a patch has carried: the only ones a batch may name by index (the client has them). */
  private readonly sent = new Map<string, number>();
  private fresh: string[] = [];

  /**
   * Appends every player and mob not yet in `state.roster`. Call it right before broadcasting the patch, and `rosterSent()`
   * right after: a batch only uses an entry once the patch that carries it has gone out, so a fighter that appeared in
   * this very tick is named by its id in the batches of this tick.
   */
  extendRoster(state: RosterState): void {
    const add = (id: string): void => {
      if (this.rostered.has(id)) return;
      this.rostered.set(id, state.roster.push(id) - 1);
      this.fresh.push(id);
    };
    for (const id of state.players.keys()) add(id);
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
  batch(fxs: readonly FxEvent[], t: number, projectiles: ProjectileMap): FxBatch | null {
    const launches: ProjectileLaunch[] = [];
    projectiles.forEach((p, id) => {
      if (this.announced.has(id)) return;
      launches.push({ id, kind: p.kind as ProjectileKind, x: p.x, y: p.y, vx: p.vx, vy: p.vy, t: p.t, range: p.range });
    });
    const batch = fxs.length > 0 || launches.length > 0 ? packFx(fxs, t, { announced: this.announced, launches, roster: this.sent }) : null;
    // After packing: a projEnd in this batch still needs the id as it was before this step.
    for (const l of launches) this.announced.add(l.id);
    for (const id of this.announced) if (!projectiles.has(id)) this.announced.delete(id);
    return batch;
  }
}
