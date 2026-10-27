import { describe, expect, it } from "vitest";
import { mulberry32, PROFILE_RE } from "@raid/shared";
import { BOT_ID_PREFIX } from "../../src/bots/brain/types";
import { botId, CALLSIGN_POOL, pickCallsign } from "../../src/bots/callsigns";

describe("callsign pool", () => {
  it("is about 64 names, each a valid profile name, none repeated in any casing", () => {
    expect(CALLSIGN_POOL.length).toBeGreaterThanOrEqual(60);
    expect(CALLSIGN_POOL.length).toBeLessThanOrEqual(70);
    for (const name of CALLSIGN_POOL) expect(PROFILE_RE.test(name), name).toBe(true);
    expect(new Set(CALLSIGN_POOL.map((n) => n.toLowerCase())).size).toBe(CALLSIGN_POOL.length);
  });

  it("leaves room for two appended digits within the profile name length", () => {
    for (const name of CALLSIGN_POOL) expect(PROFILE_RE.test(`${name}99`), name).toBe(true);
  });

  it("does not look like a bot", () => {
    for (const name of CALLSIGN_POOL) expect(/bot/i.test(name), name).toBe(false);
  });
});

describe("pickCallsign", () => {
  it("is deterministic from the rng", () => {
    const run = (seed: number): string[] => {
      const rng = mulberry32(seed);
      const used = new Set<string>();
      const out: string[] = [];
      for (let i = 0; i < 5; i++) {
        const name = pickCallsign(rng, (n) => used.has(n.toLowerCase()));
        used.add(name.toLowerCase());
        out.push(name);
      }
      return out;
    };
    expect(run(11)).toEqual(run(11));
    expect(run(11)).not.toEqual(run(12));
  });

  it("always returns a valid profile name from the pool", () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 200; i++) {
      const name = pickCallsign(rng, () => false);
      expect(PROFILE_RE.test(name)).toBe(true);
      expect(CALLSIGN_POOL).toContain(name);
    }
  });

  it("never returns a taken name, whatever the casing, until the pool is used up", () => {
    const rng = mulberry32(5);
    const used = new Set<string>();
    for (let i = 0; i < CALLSIGN_POOL.length; i++) {
      const name = pickCallsign(rng, (n) => used.has(n.toLowerCase()));
      expect(used.has(name.toLowerCase())).toBe(false);
      expect(CALLSIGN_POOL).toContain(name);
      used.add(name.toLowerCase());
    }
    expect(used.size).toBe(CALLSIGN_POOL.length);
  });

  it("skips a name taken in another casing", () => {
    // The room's set holds lower-case spellings and the predicate is an exact lookup: "Wren" must still be refused.
    const room = new Set(["wren", "kestrel_7"]);
    const exact = (n: string): boolean => room.has(n);
    for (let seed = 0; seed < 300; seed++) {
      const name = pickCallsign(mulberry32(seed), exact);
      expect(room.has(name.toLowerCase()), name).toBe(false);
    }
  });

  it("takes the one free name when only one is left", () => {
    const taken = (n: string): boolean => n.toLowerCase() !== "wren";
    for (let seed = 0; seed < 20; seed++) expect(pickCallsign(mulberry32(seed), taken)).toBe("Wren");
  });

  it("appends two digits when the whole pool is taken, and the result is a free valid name", () => {
    const pool = new Set(CALLSIGN_POOL.map((n) => n.toLowerCase()));
    const used = new Set<string>();
    const rng = mulberry32(9);
    for (let i = 0; i < 40; i++) {
      const name = pickCallsign(rng, (n) => pool.has(n.toLowerCase()) || used.has(n.toLowerCase()));
      expect(PROFILE_RE.test(name), name).toBe(true);
      expect(name).toMatch(/\d\d$/);
      expect(pool.has(name.toLowerCase())).toBe(false);
      expect(used.has(name.toLowerCase())).toBe(false);
      used.add(name.toLowerCase());
    }
  });

  it("is deterministic in the fallback too", () => {
    const all = (n: string): boolean => CALLSIGN_POOL.some((p) => p.toLowerCase() === n.toLowerCase());
    expect(pickCallsign(mulberry32(4), all)).toBe(pickCallsign(mulberry32(4), all));
  });

  it("still answers when every spelling is taken", () => {
    const name = pickCallsign(mulberry32(2), () => true);
    expect(PROFILE_RE.test(name)).toBe(true);
  });

  it("uses the whole pool over many draws", () => {
    const rng = mulberry32(21);
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(pickCallsign(rng, () => false));
    expect(seen.size).toBe(CALLSIGN_POOL.length);
  });
});

describe("botId", () => {
  it("is the bot prefix and the number", () => {
    expect(botId(0)).toBe(`${BOT_ID_PREFIX}0`);
    expect(botId(7)).toBe("bot~7");
  });

  it("can never be a Colyseus session id", () => {
    expect(botId(3)).toContain("~");
  });

  it("is unique per n", () => {
    expect(new Set([0, 1, 2, 3, 4, 5, 6, 7].map(botId)).size).toBe(8);
  });
});
