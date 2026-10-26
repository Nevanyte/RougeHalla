// How many rooms exist at once, per mode, for one process. A room counts from the moment its onCreate accepts it until
// onDispose, so a refused creation never counts and a disposal never gives back what was not taken.
import type { RoomMode } from "@raid/shared";

export class RoomCounter {
  private readonly counts: Record<RoomMode, number> = { arena: 0, training: 0 };

  /** `limits[mode]` of 0 means no limit. */
  constructor(private readonly limits: Readonly<Record<RoomMode, number>>) {}

  /** Counts a new room of `mode` and returns true, or returns false when the cap is reached. */
  tryOpen(mode: RoomMode): boolean {
    const max = this.limits[mode];
    if (max > 0 && this.counts[mode] >= max) return false;
    this.counts[mode]++;
    return true;
  }

  close(mode: RoomMode): void {
    if (this.counts[mode] > 0) this.counts[mode]--;
  }

  count(mode: RoomMode): number {
    return this.counts[mode];
  }
}
