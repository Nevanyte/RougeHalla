// Wall time per phase of the active tick, for the room's slow-tick log. Off (null on the World) costs one null check a phase.
import type { SimSystem, World } from "./world";

export class TickProfile {
  private at = 0;
  readonly laps = new Map<string, number>();

  start(): void {
    this.at = performance.now();
  }

  lap(label: string): void {
    const now = performance.now();
    this.laps.set(label, (this.laps.get(label) ?? 0) + now - this.at);
    this.at = now;
  }

  clear(): void {
    this.laps.clear();
  }

  /** The laps of at least `minMs`, largest first, rounded to 0.1 ms. */
  top(minMs = 0.5): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of [...this.laps].sort((a, b) => b[1] - a[1])) if (v >= minMs) out[k] = Math.round(v * 10) / 10;
    return out;
  }
}

export function lap(world: World, label: string): void {
  world.profile?.lap(label);
}

/** Runs a system list, timing each entry under its function name when profiling. */
export function runTimed(world: World, list: readonly SimSystem[], dtMs: number, group: string): void {
  const p = world.profile;
  if (!p) {
    for (const sys of list) sys(world, dtMs);
    return;
  }
  list.forEach((sys, i) => {
    sys(world, dtMs);
    p.lap(`${group}:${sys.name || i}`);
  });
}
