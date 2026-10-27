// The BOTS_* environment of the server's fill bots (docs/BOTS.md 7.3): defaults, and parsing that never throws and never
// yields a value the fill code could not use.
import { describe, expect, it } from "vitest";
import { MAX_PLAYERS } from "@raid/shared";
import { loadConfig, parseMix } from "../src/config";
import { BOT_FILL_DEFAULTS, PERSONA_IDS, TIER_IDS } from "../src/bots/brain/types";

const bots = (env: Record<string, string>) => loadConfig(env).bots;

describe("the defaults", () => {
  it("an empty environment gives BOT_FILL_DEFAULTS", () => {
    expect(bots({})).toEqual(BOT_FILL_DEFAULTS);
    expect(bots({}).fillTo).toBe(6);
  });

  it("hands out its own mixes: a caller that edits them cannot change the defaults", () => {
    const b = bots({});
    expect(b.tierMix).not.toBe(BOT_FILL_DEFAULTS.tierMix);
    expect(b.personaMix).not.toBe(BOT_FILL_DEFAULTS.personaMix);
  });

  it("leaves the rest of the server config alone", () => {
    const c = loadConfig({ BOTS_FILL_TO: "3" });
    expect(c).toMatchObject({ minPlayers: loadConfig({}).minPlayers, mobs: true, latencyMs: 0 });
  });
});

describe("BOTS_FILL_TO", () => {
  it("is the target lobby size; 0 is off", () => {
    expect(bots({ BOTS_FILL_TO: "4" }).fillTo).toBe(4);
    expect(bots({ BOTS_FILL_TO: "0" }).fillTo).toBe(0);
  });

  it("is clamped to 0..MAX_PLAYERS", () => {
    expect(bots({ BOTS_FILL_TO: "100" }).fillTo).toBe(MAX_PLAYERS);
    expect(bots({ BOTS_FILL_TO: String(MAX_PLAYERS) }).fillTo).toBe(MAX_PLAYERS);
    expect(bots({ BOTS_FILL_TO: "-3" }).fillTo).toBe(0);
  });

  it("is a whole number of players", () => {
    expect(bots({ BOTS_FILL_TO: "3.6" }).fillTo).toBe(4);
    expect(bots({ BOTS_FILL_TO: "3.2" }).fillTo).toBe(3);
  });

  it("falls back to the default when it is not a number", () => {
    for (const bad of ["", "abc", "NaN", "Infinity", "six", "3 bots"]) {
      expect(bots({ BOTS_FILL_TO: bad }).fillTo, JSON.stringify(bad)).toBe(6);
    }
  });
});

describe("the timing numbers", () => {
  const cases = [
    ["BOTS_ARRIVAL_SECONDS", "arrivalSeconds", 12],
    ["BOTS_LATENCY_MS", "latencyMs", 30],
    ["BOTS_JITTER_MS", "jitterMs", 8],
  ] as const;

  for (const [name, key, fallback] of cases) {
    it(`${name}: a number is kept, a bad one is the default, a negative one is 0`, () => {
      expect(bots({ [name]: "5" })[key]).toBe(5);
      expect(bots({ [name]: "2.5" })[key]).toBe(2.5);
      expect(bots({ [name]: "0" })[key]).toBe(0);
      expect(bots({ [name]: "-4" })[key]).toBe(0);
      for (const bad of ["", "soon", "NaN", "Infinity"]) expect(bots({ [name]: bad })[key], JSON.stringify(bad)).toBe(fallback);
    });
  }
});

describe("BOTS_TIER_MIX and BOTS_PERSONA_MIX", () => {
  it("read name:weight pairs as relative weights", () => {
    expect(bots({ BOTS_TIER_MIX: "easy:30,normal:45,hard:25" }).tierMix).toEqual({ easy: 30, normal: 45, hard: 25 });
    expect(bots({ BOTS_PERSONA_MIX: "farmer:1,hunter:3,opportunist:0,cautious:2" }).personaMix)
      .toEqual({ farmer: 1, hunter: 3, opportunist: 0, cautious: 2 });
  });

  it("give a name that is left out no share", () => {
    expect(bots({ BOTS_TIER_MIX: "hard:1" }).tierMix).toEqual({ easy: 0, normal: 0, hard: 1 });
    expect(bots({ BOTS_PERSONA_MIX: "hunter:2,cautious:1" }).personaMix).toEqual({ farmer: 0, hunter: 2, opportunist: 0, cautious: 1 });
  });

  it("ignore unknown names and keep the rest", () => {
    expect(bots({ BOTS_TIER_MIX: "godlike:50,easy:1,normal:1" }).tierMix).toEqual({ easy: 1, normal: 1, hard: 0 });
    expect(bots({ BOTS_PERSONA_MIX: "sweaty:9,farmer:2" }).personaMix).toEqual({ farmer: 2, hunter: 0, opportunist: 0, cautious: 0 });
  });

  it("ignore weights that are not numbers, and clamp negative ones to 0", () => {
    expect(bots({ BOTS_TIER_MIX: "easy:lots,normal:2,hard:-5" }).tierMix).toEqual({ easy: 0, normal: 2, hard: 0 });
    expect(bots({ BOTS_TIER_MIX: "easy:,normal:1" }).tierMix).toEqual({ easy: 0, normal: 1, hard: 0 });
    expect(bots({ BOTS_TIER_MIX: "easy:1:9,normal:1" }).tierMix).toEqual({ easy: 0, normal: 1, hard: 0 });
    expect(bots({ BOTS_TIER_MIX: "easy:Infinity,normal:1" }).tierMix).toEqual({ easy: 0, normal: 1, hard: 0 });
  });

  it("tolerate case, spaces, empty items and a name with no weight (weight 1); a repeated name keeps its last weight", () => {
    expect(bots({ BOTS_TIER_MIX: " Easy : 2 , ,NORMAL:1,," }).tierMix).toEqual({ easy: 2, normal: 1, hard: 0 });
    expect(bots({ BOTS_PERSONA_MIX: "hunter" }).personaMix).toEqual({ farmer: 0, hunter: 1, opportunist: 0, cautious: 0 });
    expect(bots({ BOTS_TIER_MIX: "easy:1,easy:4" }).tierMix).toEqual({ easy: 4, normal: 0, hard: 0 });
  });

  it("fall back to the default mix when nothing usable has weight", () => {
    for (const raw of ["", "  ", ",", "easy:0,normal:0,hard:0", "godlike:5", "easy:-1,normal:-2", "nonsense", "easy:x"]) {
      expect(bots({ BOTS_TIER_MIX: raw }).tierMix, JSON.stringify(raw)).toEqual(BOT_FILL_DEFAULTS.tierMix);
    }
    for (const raw of ["", "farmer:0", "robot:1", "hunter:-3"]) {
      expect(bots({ BOTS_PERSONA_MIX: raw }).personaMix, JSON.stringify(raw)).toEqual(BOT_FILL_DEFAULTS.personaMix);
    }
  });

  it("always cover every id, with finite weights of at least 0 and a positive total", () => {
    const raws = ["easy:1", "garbage", "hard:1e3,normal:0.5", "easy:-1,normal:1", "", "easy:0"];
    for (const raw of raws) {
      for (const [ids, mix] of [
        [TIER_IDS, bots({ BOTS_TIER_MIX: raw }).tierMix],
        [PERSONA_IDS, bots({ BOTS_PERSONA_MIX: raw }).personaMix],
      ] as const) {
        const m = mix as Record<string, number>;
        expect(Object.keys(m).sort(), JSON.stringify(raw)).toEqual([...ids].sort());
        for (const id of ids) expect(Number.isFinite(m[id]) && m[id]! >= 0, `${raw} ${id}`).toBe(true);
        expect(ids.reduce((sum, id) => sum + m[id]!, 0), JSON.stringify(raw)).toBeGreaterThan(0);
      }
    }
  });

  it("parseMix does not touch its fallback", () => {
    const fallback = { a: 1, b: 2 } as const;
    const out = parseMix("", ["a", "b"] as const, fallback);
    expect(out).toEqual(fallback);
    expect(out).not.toBe(fallback);
  });
});

describe("BOT_STATS_FILE", () => {
  it("unset is null: the manager puts the file next to the profile file", () => {
    expect(bots({}).statsFile).toBeNull();
    expect(bots({ BOT_STATS_FILE: "" }).statsFile).toBeNull();
    expect(bots({ BOT_STATS_FILE: "   " }).statsFile).toBeNull();
  });

  it('"off" is the empty path: learning is disabled', () => {
    expect(bots({ BOT_STATS_FILE: "off" }).statsFile).toBe("");
    expect(bots({ BOT_STATS_FILE: "OFF" }).statsFile).toBe("");
    expect(bots({ BOT_STATS_FILE: " off " }).statsFile).toBe("");
  });

  it("anything else is the path as given", () => {
    expect(bots({ BOT_STATS_FILE: "/var/raid/bots.json" }).statsFile).toBe("/var/raid/bots.json");
    expect(bots({ BOT_STATS_FILE: "data/offline.json" }).statsFile).toBe("data/offline.json");
  });
});

describe("BOTS_SEED", () => {
  it("unset is null: a crypto seed per room", () => {
    expect(bots({}).seed).toBeNull();
    expect(bots({ BOTS_SEED: "" }).seed).toBeNull();
  });

  it("a whole number is the seed, 0 included", () => {
    expect(bots({ BOTS_SEED: "42" }).seed).toBe(42);
    expect(bots({ BOTS_SEED: "0" }).seed).toBe(0);
    expect(bots({ BOTS_SEED: "4294967295" }).seed).toBe(4294967295);
  });

  it("is a 32-bit unsigned integer: a fraction is cut, a negative or huge one wraps", () => {
    expect(bots({ BOTS_SEED: "7.9" }).seed).toBe(7);
    expect(bots({ BOTS_SEED: "-1" }).seed).toBe(4294967295);
    expect(bots({ BOTS_SEED: "4294967296" }).seed).toBe(0);
  });

  it("is null when it is not a number", () => {
    for (const bad of ["abc", "NaN", "Infinity", "12ab"]) expect(bots({ BOTS_SEED: bad }).seed, JSON.stringify(bad)).toBeNull();
  });
});
