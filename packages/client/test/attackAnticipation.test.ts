import { describe, expect, it } from "vitest";
import { AttackAnticipation, attackResponseWindowMs } from "../src/net/attackAnticipation";

describe("local attack anticipation", () => {
  it("keeps a high-RTT cue alive until the authoritative response window, without restarting held autos", () => {
    const attack = new AttackAnticipation();
    const windowMs = attackResponseWindowMs(280);
    expect(windowMs).toBe(710);
    const start = () => {};
    expect(attack.begin(1000, windowMs, start)).toBe(true);
    expect(attack.begin(1300, windowMs, start)).toBe(false); // repeated press while pending cannot duplicate the windup
    expect(attack.expire(1709)).toBe(false);
    expect(attack.pending).toBe(true);
    expect(attack.confirm(1500)).toBe(true); // authoritative own windup/swing takes over
    expect(attack.pending).toBe(false);
    expect(attack.begin(1799, windowMs, start)).toBe(false); // first FX arrived but has not reached render time yet
    attack.expire(1800);
    expect(attack.begin(1800, windowMs, start)).toBe(true); // the server's later held auto is not coalesced with this completed press
  });

  it("lets a rejected press expire and bounds response estimates on slow or invalid links", () => {
    const attack = new AttackAnticipation();
    expect(attackResponseWindowMs(-40)).toBe(250);
    expect(attackResponseWindowMs(Number.NaN)).toBe(250);
    expect(attackResponseWindowMs(900)).toBe(1500);
    expect(attack.begin(20, attackResponseWindowMs(400), () => {})).toBe(true);
    expect(attack.expire(969)).toBe(false);
    expect(attack.expire(970)).toBe(true); // no authoritative confirmation: refusal/loss lets the pose go
    expect(attack.pending).toBe(false);
    expect(attack.confirm(2000)).toBe(false); // a late FX cannot revive the local anticipation
    expect(attack.begin(2200, 250, () => {})).toBe(false); // but it still blocks duplicate anticipation until render can catch up
    attack.expire(2300);
    expect(attack.begin(2300, 250, () => {})).toBe(true);
  });

  it.each(["release", "move", "weapon switch", "cast", "death"]) ("cancels immediately on %s", () => {
    const attack = new AttackAnticipation();
    expect(attack.begin(0, 1000, () => {})).toBe(true);
    expect(attack.cancel()).toBe(true);
    expect(attack.pending).toBe(false);
    expect(attack.cancel()).toBe(false);
  });
});
