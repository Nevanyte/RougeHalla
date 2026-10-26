// The pure pieces of the public-link guards: token buckets, the new-profile window, the room cap, the passcode compare and
// the CORS decision. Every clock here is a number the test hands in.
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { corsOrigin } from "../src/guards/cors";
import { passcodeOk } from "../src/guards/passcode";
import { RoomCounter } from "../src/guards/roomCounter";
import { KeyedTokenBuckets, TokenBucket } from "../src/guards/tokenBucket";
import { NewProfileLimiter, SlidingWindowLimiter } from "../src/guards/windowLimiter";

describe("TokenBucket", () => {
  it("lets a full burst through at once, then refuses", () => {
    const b = new TokenBucket(5, 10, 1000);
    for (let i = 0; i < 5; i++) expect(b.take(1000), `order ${i}`).toBe(true);
    expect(b.take(1000)).toBe(false);
    expect(b.take(1000)).toBe(false);
  });

  it("refills at its rate and never past its capacity", () => {
    const b = new TokenBucket(5, 10, 0);
    for (let i = 0; i < 5; i++) b.take(0);
    expect(b.take(99)).toBe(false); // 0.99 of a token
    expect(b.take(100)).toBe(true); // one whole token at 10 a second
    expect(b.take(100)).toBe(false);
    // A long pause gives back the capacity and no more.
    for (let i = 0; i < 5; i++) expect(b.take(60_000)).toBe(true);
    expect(b.take(60_000)).toBe(false);
  });

  it("holds a steady rate over time: spending as fast as allowed for 10 s takes burst + rate * 10", () => {
    const b = new TokenBucket(30, 15, 0);
    let taken = 0;
    for (let t = 0; t <= 10_000; t += 5) if (b.take(t)) taken++;
    expect(taken).toBeGreaterThanOrEqual(30 + 15 * 10 - 1);
    expect(taken).toBeLessThanOrEqual(30 + 15 * 10 + 1);
  });

  it("a legit pace (10 a second for a minute, with an extra click now and then) is never refused", () => {
    const b = new TokenBucket(30, 15, 0);
    for (let t = 0; t < 60_000; t += 100) {
      expect(b.take(t), `move at ${t}`).toBe(true);
      if (t % 500 === 0) expect(b.take(t + 7), `click at ${t}`).toBe(true);
    }
  });

  it("a stall that delivers two seconds of a held button at once fits the burst", () => {
    const b = new TokenBucket(30, 15, 0);
    for (let i = 0; i < 20; i++) expect(b.take(5000)).toBe(true);
  });

  it("a script sending stop and target every tick is cut to the refill rate", () => {
    const b = new TokenBucket(30, 15, 0);
    let taken = 0;
    for (let t = 0; t < 20_000; t += 50) {
      if (b.take(t)) taken++; // stop
      if (b.take(t)) taken++; // target
    }
    // 40 a second offered; about 15 a second over the 20 s (plus the opening burst) gets through.
    expect(taken / 20).toBeLessThan(17);
    expect(taken / 20).toBeGreaterThan(14);
  });

  it("a clock that steps back mints nothing", () => {
    const b = new TokenBucket(2, 1, 10_000);
    b.take(10_000);
    b.take(10_000);
    expect(b.take(0)).toBe(false);
    expect(b.take(500)).toBe(false); // 0.5 s after the step back
    expect(b.take(1000)).toBe(true);
  });

  it("isFull is true only once everything spent has come back", () => {
    const b = new TokenBucket(3, 1, 0);
    expect(b.isFull(0)).toBe(true);
    b.take(0);
    expect(b.isFull(500)).toBe(false);
    expect(b.isFull(1000)).toBe(true);
  });
});

describe("KeyedTokenBuckets", () => {
  it("gives every key its own bucket", () => {
    const k = new KeyedTokenBuckets(2, 1);
    expect(k.take("a", 0)).toBe(true);
    expect(k.take("a", 0)).toBe(true);
    expect(k.take("a", 0)).toBe(false);
    expect(k.take("b", 0)).toBe(true);
  });

  it("forgets buckets that have refilled once the map grows past its limit", () => {
    const k = new KeyedTokenBuckets(1, 1, 4);
    for (const key of ["a", "b", "c", "d"]) k.take(key, 0);
    expect(k.size).toBe(4);
    k.take("e", 5000); // everything before has refilled: the sweep drops them
    expect(k.size).toBe(1);
  });

  it("keeps a bucket that is still spent when sweeping, and a refused key stays refused", () => {
    const k = new KeyedTokenBuckets(1, 0.1, 2); // a token takes 10 s
    k.take("a", 0);
    k.take("b", 9000);
    k.take("c", 9500); // sweep: "a" has refilled at 10 s? not yet at 9.5 s, so all three stay
    expect(k.size).toBe(3);
    expect(k.take("a", 9500)).toBe(false);
  });
});

describe("SlidingWindowLimiter", () => {
  it("allows max events in any trailing window and says how long to wait", () => {
    const w = new SlidingWindowLimiter(3, 1000);
    for (const t of [0, 100, 200]) { expect(w.allows(t)).toBe(true); w.record(t); }
    expect(w.allows(300)).toBe(false);
    expect(w.retryAfterMs(300)).toBe(700);
    expect(w.allows(999)).toBe(false);
    expect(w.allows(1000)).toBe(true); // the first has left the window
    expect(w.retryAfterMs(1000)).toBe(0);
  });

  it("a max of 0 is no limit", () => {
    const w = new SlidingWindowLimiter(0, 1000);
    for (let i = 0; i < 100; i++) { expect(w.allows(i)).toBe(true); w.record(i); }
    expect(w.retryAfterMs(100)).toBe(0);
  });

  it("isEmpty once everything has aged out", () => {
    const w = new SlidingWindowLimiter(2, 1000);
    w.record(0);
    expect(w.isEmpty(500)).toBe(false);
    expect(w.isEmpty(1000)).toBe(true);
  });
});

describe("NewProfileLimiter", () => {
  const HOUR = 3_600_000;

  it("caps the whole server, whoever asks", () => {
    const l = new NewProfileLimiter(3, 10, HOUR);
    for (let i = 0; i < 3; i++) { expect(l.retryAfterMs(`ip${i}`, i)).toBe(0); l.record(`ip${i}`, i); }
    expect(l.retryAfterMs("another", 10)).toBeGreaterThan(0);
    expect(l.retryAfterMs("another", HOUR + 1)).toBe(0); // the first one has aged out
  });

  it("caps one address, and leaves the others alone", () => {
    const l = new NewProfileLimiter(100, 2, HOUR);
    l.record("home", 0);
    l.record("home", 10);
    expect(l.retryAfterMs("home", 20)).toBe(HOUR - 20);
    expect(l.retryAfterMs("elsewhere", 20)).toBe(0);
  });

  it("a refused attempt is never recorded, so asking again does not extend the wait", () => {
    const l = new NewProfileLimiter(1, 1, HOUR);
    l.record("a", 0);
    for (let t = 1; t < 50; t++) l.retryAfterMs("a", t);
    expect(l.retryAfterMs("a", HOUR)).toBe(0);
  });

  it("0 turns a cap off", () => {
    const l = new NewProfileLimiter(0, 0, HOUR);
    for (let i = 0; i < 200; i++) l.record("a", i);
    expect(l.retryAfterMs("a", 200)).toBe(0);
  });
});

describe("RoomCounter", () => {
  it("refuses a room past its mode's cap, and counts the modes apart", () => {
    const c = new RoomCounter({ arena: 2, training: 1 });
    expect(c.tryOpen("arena")).toBe(true);
    expect(c.tryOpen("arena")).toBe(true);
    expect(c.tryOpen("arena")).toBe(false);
    expect(c.tryOpen("training")).toBe(true);
    expect(c.tryOpen("training")).toBe(false);
    expect([c.count("arena"), c.count("training")]).toEqual([2, 1]);
  });

  it("a closed room frees its place, and closing more than were opened does not go below zero", () => {
    const c = new RoomCounter({ arena: 1, training: 1 });
    c.tryOpen("arena");
    c.close("arena");
    expect(c.tryOpen("arena")).toBe(true);
    c.close("arena");
    c.close("arena");
    expect(c.count("arena")).toBe(0);
  });

  it("a cap of 0 is no limit", () => {
    const c = new RoomCounter({ arena: 0, training: 0 });
    for (let i = 0; i < 50; i++) expect(c.tryOpen("arena")).toBe(true);
  });
});

describe("passcodeOk", () => {
  it("passes everyone when no passcode is set", () => {
    expect(passcodeOk(undefined, undefined)).toBe(true);
    expect(passcodeOk("anything", undefined)).toBe(true);
  });

  it("passes only the exact passcode when one is set", () => {
    expect(passcodeOk("open-sesame", "open-sesame")).toBe(true);
    for (const wrong of ["open-sesamE", "open-sesame ", "open", "", "open-sesame-and-more", undefined, null, 7, ["open-sesame"], {}]) {
      expect(passcodeOk(wrong, "open-sesame"), String(JSON.stringify(wrong))).toBe(false);
    }
  });
});

describe("corsOrigin", () => {
  it("open mode (dev) answers a wildcard to a request with no origin and echoes the origin of one that has it", () => {
    expect(corsOrigin(null, false, [])).toBe("*");
    expect(corsOrigin("http://localhost:5173", false, [])).toBe("http://localhost:5173");
  });

  it("same-origin mode answers no origin at all unless it is on the allowlist", () => {
    expect(corsOrigin(null, true, [])).toBeNull();
    expect(corsOrigin("https://evil.example", true, [])).toBeNull();
    expect(corsOrigin("https://evil.example", true, ["https://friend.example"])).toBeNull();
    expect(corsOrigin("https://friend.example", true, ["https://friend.example"])).toBe("https://friend.example");
    expect(corsOrigin("HTTPS://Friend.Example", true, ["https://friend.example"])).toBe("HTTPS://Friend.Example");
  });
});

describe("loadConfig: the guards", () => {
  it("dev defaults: no client, open CORS, no passcode; only the order budget is on", () => {
    const c = loadConfig({});
    expect(c.clientDir).toBeUndefined();
    expect(c.sameOriginOnly).toBe(false);
    expect(c.corsOrigins).toEqual([]);
    expect(c.passcode).toBeUndefined();
    expect([c.maxArenaRooms, c.maxTrainingRooms]).toEqual([0, 0]);
    expect([c.maxNewProfilesPerHour, c.maxNewProfilesPerIpPerHour]).toEqual([0, 0]);
    expect([c.shopBurst, c.shopPerSecond]).toEqual([0, 0]);
    expect([c.orderBurst, c.orderPerSecond]).toEqual([30, 15]);
  });

  it("hosting defaults (production, or a client served): the documented caps", () => {
    for (const env of [{ NODE_ENV: "production" }, { CLIENT_DIR: "dist" }]) {
      const c = loadConfig(env);
      expect([c.maxArenaRooms, c.maxTrainingRooms], JSON.stringify(env)).toEqual([4, 8]);
      expect([c.maxNewProfilesPerHour, c.maxNewProfilesPerIpPerHour]).toEqual([30, 10]);
      expect([c.shopBurst, c.shopPerSecond]).toEqual([6, 3]);
      expect([c.orderBurst, c.orderPerSecond]).toEqual([30, 15]);
    }
  });

  it("NODE_ENV=production or a client dir switches to same-origin hosting", () => {
    expect(loadConfig({ NODE_ENV: "production" }).sameOriginOnly).toBe(true);
    const c = loadConfig({ CLIENT_DIR: "dist" });
    expect(c.sameOriginOnly).toBe(true);
    expect(c.clientDir).toMatch(/dist$/);
    expect(loadConfig({ NODE_ENV: "development" }).sameOriginOnly).toBe(false);
  });

  it("reads the env knobs, with 0 meaning no limit and bad values falling back", () => {
    const c = loadConfig({
      PLAYTEST_PASSCODE: "pw", CORS_ORIGINS: " https://A.example/ , http://b.example:3000 ,,", MAX_ARENA_ROOMS: "0",
      MAX_TRAINING_ROOMS: "x", MAX_NEW_PROFILES_PER_HOUR: "5", MAX_NEW_PROFILES_PER_IP_PER_HOUR: "-3", ORDER_BURST: "50", ORDER_PER_SECOND: "0",
    });
    expect(c.passcode).toBe("pw");
    expect(c.corsOrigins).toEqual(["https://a.example", "http://b.example:3000"]);
    expect(c.maxArenaRooms).toBe(0);
    expect(c.maxTrainingRooms).toBe(0); // "x" is not a number: the dev default
    expect(c.maxNewProfilesPerHour).toBe(5);
    expect(c.maxNewProfilesPerIpPerHour).toBe(0); // negative: the dev default
    expect(loadConfig({ NODE_ENV: "production", MAX_TRAINING_ROOMS: "x", MAX_NEW_PROFILES_PER_IP_PER_HOUR: "-3" })).toMatchObject({ maxTrainingRooms: 8, maxNewProfilesPerIpPerHour: 10 });
    expect(c.orderBurst).toBe(50);
    expect(c.orderPerSecond).toBe(0);
    expect(loadConfig({ PLAYTEST_PASSCODE: "" }).passcode).toBeUndefined();
  });
});
