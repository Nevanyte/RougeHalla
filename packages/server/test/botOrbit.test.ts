// The bot's orbit breaker (bots/BotClient.ts): a chase that goes nowhere makes it turn on someone else and avoid the
// first for a while. What is pinned here is when that avoidance ends early, and that a weapon detour does not count
// toward it. The brain is driven by hand over a fake room; nothing here touches a socket.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimedFx } from "@raid/shared";
import { BotClient, ORBIT_JITTER_MS, ORBIT_MIN_DISTANCE, ORBIT_MS } from "../src/bots/BotClient";

interface FakePlayer { x: number; y: number; status: string }
/** The private parts of the brain the test reaches into. */
interface Brain {
  room: unknown;
  avoidId: string | null;
  avoidUntil: number;
  chase: { id: string; best: number; since: number; limit: number } | null;
  pickEnemy(me: FakePlayer, now: number): { id: string } | null;
  onFx(fx: TimedFx): void;
  think(): void;
  grabWeapon(): boolean;
  fight(): void;
}

function brain(players: Record<string, Partial<FakePlayer>>): { b: Brain; players: Map<string, FakePlayer> } {
  const map = new Map<string, FakePlayer>();
  for (const [id, p] of Object.entries(players)) map.set(id, { x: 0, y: 0, status: "alive", ...p });
  const b = new BotClient() as unknown as Brain;
  b.room = { sessionId: "me", state: { phase: "active", serverTime: 0, raidStartedAt: 0, players: map } };
  return { b, players: map };
}

const hitOn = (id: string, by: string | null): TimedFx => ({ kind: "hit", id, by, amount: 10, weapon: "sword", t: 0 });

describe("an enemy the bot gave up chasing", () => {
  const NOW = 10_000;

  it("stays out of the choice while it is far, if someone else is there", () => {
    const { b, players } = brain({ me: {}, orbiter: { x: 300 }, other: { x: 500 } });
    b.avoidId = "orbiter";
    b.avoidUntil = NOW + 5000;
    expect(b.pickEnemy(players.get("me")!, NOW)?.id).toBe("other");
    expect(b.avoidId).toBe("orbiter");
  });

  it("is taken again the moment it comes within the fight distance", () => {
    const { b, players } = brain({ me: {}, orbiter: { x: ORBIT_MIN_DISTANCE - 1 }, other: { x: 500 } });
    b.avoidId = "orbiter";
    b.avoidUntil = NOW + 5000;
    expect(b.pickEnemy(players.get("me")!, NOW)?.id).toBe("orbiter");
    expect(b.avoidId).toBeNull();
    // And stays taken if it drifts back out: the avoidance is over, not paused.
    players.get("orbiter")!.x = 300;
    expect(b.pickEnemy(players.get("me")!, NOW + 50)?.id).toBe("orbiter");
  });

  it("is taken again once it hits the bot or has a hit blocked by it, and not for anyone else's blow", () => {
    const { b } = brain({ me: {}, orbiter: { x: 300 }, other: { x: 500 } });
    const avoid = () => { b.avoidId = "orbiter"; b.avoidUntil = NOW + 5000; };
    avoid();
    b.onFx(hitOn("other", "orbiter")); // it hit someone else
    b.onFx(hitOn("me", "other")); // someone else hit us
    b.onFx(hitOn("me", null)); // the arena did
    b.onFx(hitOn("orbiter", "me")); // we hit it
    expect(b.avoidId).toBe("orbiter");
    b.onFx(hitOn("me", "orbiter"));
    expect(b.avoidId).toBeNull();
    avoid();
    b.onFx({ kind: "block", id: "me", by: "orbiter", weapon: "sword", t: 0 });
    expect(b.avoidId).toBeNull();
  });
});

describe("the orbit timer during a weapon detour", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); });

  it("does not run while the bot walks off for a weapon, and runs again afterwards", () => {
    const { b } = brain({ me: {}, foe: { x: 400 } });
    let detour = true;
    b.grabWeapon = () => detour;
    b.fight = () => {};
    const thinkFor = (ms: number) => {
      for (let t = 0; t < ms; t += 50) { b.think(); vi.advanceTimersByTime(50); }
    };
    // Far longer than the longest orbit limit: without the reset the chase would be given up on mid-detour.
    thinkFor(ORBIT_MS + ORBIT_JITTER_MS + 3000);
    expect(b.avoidId).toBeNull();
    detour = false;
    // The same standoff after the detour is a chase going nowhere, and still breaks.
    thinkFor(ORBIT_MS + ORBIT_JITTER_MS + 200);
    expect(b.avoidId).toBe("foe");
  });
});
