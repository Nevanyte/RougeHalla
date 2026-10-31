import type { Vec2 } from "@raid/shared";

/** Smooth the camera's small prediction corrections without delaying teleports or a minimap peek. */
export class CameraFollow {
  private at: Vec2 | null = null;
  private last = 0;
  private peeking = false;

  reset(): void { this.at = null; this.last = 0; this.peeking = false; }

  update(target: Vec2, now: number, peek = false): Vec2 {
    const dt = now - this.last;
    this.last = now;
    const cut = !this.at || peek || this.peeking || dt < 0 || dt > 250
      || Math.hypot(target.x - this.at.x, target.y - this.at.y) > 256;
    this.peeking = peek;
    if (cut) this.at = { x: target.x, y: target.y };
    else {
      // The local fighter is already predicted, so the camera only needs to absorb tiny reconciliation noise. A shorter
      // time constant cuts steady walking lag without letting alternating 2 u corrections visibly shake the camera.
      const alpha = 1 - Math.exp(-dt / 35);
      this.at!.x += (target.x - this.at!.x) * alpha;
      this.at!.y += (target.y - this.at!.y) * alpha;
    }
    return this.at!;
  }
}
