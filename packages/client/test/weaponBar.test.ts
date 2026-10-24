import { describe, expect, it } from "vitest";
import { isExtension, nextCooldown } from "../src/ui/weaponBar";

describe("weapon bar cooldown length", () => {
  it("a fresh attack after the last cooldown ended starts a new cooldown", () => {
    // Patch at t = 5000; the previous cooldown ended at 4900; the new one ends at 5900.
    expect(isExtension(4900, 5900, 5000)).toBe(false);
    expect(nextCooldown(4900, 1000, 5900, 5000)).toBe(900);
    // First patch of a scene: no previous readyAt.
    expect(nextCooldown(0, 1, 5900, 5000)).toBe(900);
  });

  it("a readyAt pushed later mid-cooldown (a chill) extends the length instead of restarting it", () => {
    let readyAt = 5900;
    let cooldown = nextCooldown(0, 1, readyAt, 5000);
    let patchT = 5000;
    let maxFraction = 1;
    for (let i = 0; i < 20; i++) {
      patchT += 50;
      const pushed = readyAt + 30; // 0.6 of a tick
      expect(isExtension(readyAt, pushed, patchT)).toBe(true);
      cooldown = nextCooldown(readyAt, cooldown, pushed, patchT);
      readyAt = pushed;
      expect(cooldown).toBe(900 + 30 * (i + 1));
      // The fraction left at the patch keeps falling overall (it never snaps back to ~1, as a restart would).
      const fraction = (readyAt - patchT) / cooldown;
      expect(fraction).toBeLessThan(maxFraction);
      maxFraction = fraction;
    }
    expect(maxFraction).toBeLessThan(0.7);
  });

  it("a readyAt that moves earlier is a restart", () => {
    expect(isExtension(6000, 5500, 5100)).toBe(false);
    expect(nextCooldown(6000, 1000, 5500, 5100)).toBe(400);
  });

  it("never returns a length under 1 ms", () => {
    expect(nextCooldown(0, 1, 5000, 5000)).toBe(1);
  });
});
