// The private `plan` message a room sends during planning (spawns dealt, which are taken, your picks), held until the scene is
// there to read it. Like the `fxs` inbox (fxInbox.ts), but a plan message replaces the one before it: the server resends the
// whole deal on every change, so only the newest matters, and a deal that arrives before RaidScene.create is never lost.
import type { PlanMessage } from "@raid/shared";

const isOption = (v: unknown): v is 0 | 1 => v === 0 || v === 1;

/**
 * A message from the wire as a PlanMessage, or null when it is not one. The server is trusted, but a message from a newer or
 * older build must not throw inside a frame.
 */
export function sanitizePlan(raw: unknown): PlanMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  const spawns = m.spawns;
  const taken = m.taken;
  if (!Array.isArray(spawns) || spawns.length !== 2 || !spawns.every((s) => typeof s === "number" && Number.isInteger(s))) return null;
  if (!Array.isArray(taken) || taken.length !== 2) return null;
  if (typeof m.endsAt !== "number" || !Number.isFinite(m.endsAt)) return null;
  const pick = m.pick === 0 || m.pick === 1 ? m.pick : -1;
  const boon = m.boon === 0 || m.boon === 1 ? m.boon : -1;
  const boons = Array.isArray(m.boons) ? m.boons.filter((b): b is string => typeof b === "string") : [];
  return {
    endsAt: m.endsAt,
    spawns: [spawns[0] as number, spawns[1] as number],
    taken: [taken[0] === true, taken[1] === true],
    pick: isOption(pick) ? pick : -1,
    boons,
    boon: isOption(boon) ? boon : -1,
  };
}

export class PlanInbox {
  private latest: PlanMessage | null = null;
  private sink: ((plan: PlanMessage) => void) | null = null;

  /** The room's `plan` handler. A message that does not parse is ignored. */
  readonly push = (raw: unknown): void => {
    const plan = sanitizePlan(raw);
    if (!plan) return;
    this.latest = plan;
    this.sink?.(plan);
  };

  /** The newest message so far, or null. */
  get current(): PlanMessage | null {
    return this.latest;
  }

  /**
   * Hands `sink` the newest message held (if any) and every later one as it arrives. Returns the function that stops it. The
   * message is kept, so a scene that starts again on the same room reads the deal it missed.
   */
  attach(sink: (plan: PlanMessage) => void): () => void {
    this.sink = sink;
    if (this.latest) sink(this.latest);
    return () => {
      if (this.sink === sink) this.sink = null;
    };
  }
}
