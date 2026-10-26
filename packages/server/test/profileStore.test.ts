import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACHIEVEMENTS, COSMETICS, COSMETIC_SLOTS, GOLD_FACTIONS, GOLD_WEAPONS, LEADERBOARD_DEFAULT_LIMIT, LEADERBOARD_MAX_LIMIT,
  mulberry32, type RunOutcome,
} from "@raid/shared";
import {
  InvalidProfileNameError, JsonProfileStore, ProfileFileError, ProfileForbiddenError, ProfileLockedError, UnknownProfileError,
  type Clock, type ProfileRecord,
} from "../src/persistence/ProfileStore";

const dirs: string[] = [];
const stores: JsonProfileStore[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-profiles-"));
  dirs.push(dir);
  return dir;
}

let dir: string;
let file: string;
/** What the injected clock says; tests move it to cross a month. */
let now: number;
const OCT = "2026-10";

function open(f: string, clock: Clock = () => now): JsonProfileStore {
  // A restart here is a second store on the file while the first object is still around; a stopped process lets go of its lock.
  fs.rmSync(`${path.resolve(f)}.lock`, { force: true });
  const store = new JsonProfileStore(f, { clock });
  stores.push(store);
  return store;
}

beforeEach(() => {
  dir = tmpDir();
  file = path.join(dir, "stash.json");
  now = Date.UTC(2026, 9, 20, 12);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  // Let any write still in flight finish before the directory goes away.
  await Promise.allSettled(stores.splice(0).map((s) => s.close()));
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const readFile = (f = file) => JSON.parse(fs.readFileSync(f, "utf8"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** What a live store keeps next to the data besides the file itself: its lock; mid-write, also a temp file named for the process. */
const LOCK = "stash.json.lock";
const TMP = `stash.json.tmp-${process.pid}`;
const withSuffix = (d: string, suffix: string) => fs.readdirSync(d).filter((n) => n.startsWith(`stash.json.${suffix}`));
const run = (outcome: RunOutcome, kills = 0, gv = 0) => ({ outcome, kills, gv });
/** A win that passed the anti alt-farming gate: the only kind that counts toward win achievements. */
const qwin = (kills = 0, gv = 0, extra: { faction?: string; weapon?: string; bounty?: number } = {}) =>
  ({ outcome: "won" as const, kills, gv, winQualified: true, ...extra });
/** Keeps the expected startup chatter out of the test output, and lets a test look at it. */
const quiet = () => ({
  log: vi.spyOn(console, "log").mockImplementation(() => {}),
  error: vi.spyOn(console, "error").mockImplementation(() => {}),
});

// Captured before any test installs fake timers: lets a test wait for real file I/O while fake time stands still.
const realSetTimeout = setTimeout;
const realSleep = (ms: number) => new Promise((r) => realSetTimeout(r, ms));
async function waitReal(pred: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (pred()) return;
    await realSleep(5);
  }
  throw new Error(`timed out waiting for: ${what}`);
}

/** How long the store waits to batch changes into one write. */
const WRITE_WINDOW = 1000;

/**
 * Fake timers for the store's batching window and retry only; real file I/O keeps running underneath, and the tests
 * wait with realSleep/waitReal because the global setTimeout stands still. Returns the delays of every timer that was
 * unref'd. The global afterEach puts the real setTimeout back.
 */
function fakeTimers() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const fake = globalThis.setTimeout as unknown as (...a: unknown[]) => NodeJS.Timeout;
  const unref: number[] = [];
  globalThis.setTimeout = ((cb: () => void, ms?: number, ...rest: unknown[]) => {
    const t = fake(cb, ms, ...rest);
    const real = t.unref.bind(t);
    t.unref = () => { unref.push(ms ?? 0); return real(); };
    return t;
  }) as unknown as typeof setTimeout;
  return unref;
}

const zeroStats = { runs: 0, wins: 0, draws: 0, deaths: 0, kills: 0 };
const zeroProgress = () => ({ qualifiedWins: 0, bountyRuns: 0, bestRunKills: 0, winsByFaction: {}, winsByWeapon: {} });
const emptyRecord = (name: string, token: string): ProfileRecord => ({
  name, token, gv: 0, gvLifetime: 0, gvByMonth: {}, stats: { ...zeroStats }, cosmetics: { owned: [], equipped: {} },
  achievements: {}, progress: zeroProgress(),
});

const UNLOCKED_AT = 1_700_000_000_000;
/**
 * A profile with something in every field, as the v2 file holds it. It is settled: it already holds every achievement
 * its counters earn, so banking another run in a test unlocks (and grants) nothing behind the test's back.
 */
const goodProfile = {
  name: "alice", token: "t-alice", gv: 120, gvLifetime: 300,
  gvByMonth: { "2026-09": 100, "2026-10": 200 },
  stats: { runs: 9, wins: 2, draws: 1, deaths: 6, kills: 14 },
  cosmetics: { owned: ["cape-red", "trail-blue"], equipped: { cape: "cape-red" } },
  achievements: {
    first_blood: UNLOCKED_AT, slayer: UNLOCKED_AT, bounty_hunter: UNLOCKED_AT, first_win: UNLOCKED_AT, win_fire: UNLOCKED_AT,
  },
  progress: { qualifiedWins: 2, bountyRuns: 1, bestRunKills: 4, winsByFaction: { fire: 2 }, winsByWeapon: { axe: 1 } },
};
const bobby = (patch: Record<string, unknown> = {}) => ({ ...goodProfile, name: "bobby", token: "t-bobby", ...patch });
const v2 = (profiles: unknown) => JSON.stringify({ version: 2, profiles });
const v1 = (profiles: unknown) => JSON.stringify({ version: 1, profiles });

describe("claim", () => {
  it("creates an unknown profile with a token, no GV, zeroed stats, no cosmetics and no items of any kind", () => {
    const store = open(file);
    const { record, token, created } = store.claim("alice");
    expect(created).toBe(true);
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    expect(record).toEqual(emptyRecord("alice", token));
    expect(Object.keys(record).sort()).toEqual(["achievements", "cosmetics", "gv", "gvByMonth", "gvLifetime", "name", "progress", "stats", "token"]);
  });

  it("gives every profile its own token", () => {
    const store = open(file);
    expect(store.claim("alice").token).not.toBe(store.claim("bobby").token);
  });

  it("returns the same profile for a known name and its exact token", () => {
    const store = open(file);
    const first = store.claim("alice");
    const again = store.claim("alice", first.token);
    expect(again.created).toBe(false);
    expect(again.token).toBe(first.token);
    expect(again.record).toEqual(first.record);
  });

  it("refuses a known name without the token, with a wrong one, or with another profile's", () => {
    const store = open(file);
    const a = store.claim("alice");
    const b = store.claim("bobby");
    expect(() => store.claim("alice")).toThrow(ProfileForbiddenError);
    expect(() => store.claim("alice", "")).toThrow(ProfileForbiddenError);
    expect(() => store.claim("alice", "nope")).toThrow(ProfileForbiddenError);
    expect(() => store.claim("alice", b.token)).toThrow(ProfileForbiddenError);
    expect(() => store.claim("alice", a.token + "x")).toThrow(ProfileForbiddenError);
    expect(() => store.claim("alice", a.token.toUpperCase())).toThrow(ProfileForbiddenError);
    expect(store.claim("alice", a.token).created).toBe(false);
  });

  it("ignores a token supplied for an unknown name and issues a fresh one", () => {
    const store = open(file);
    const r = store.claim("alice", "stale-token-from-a-wiped-server");
    expect(r.created).toBe(true);
    expect(r.token).not.toBe("stale-token-from-a-wiped-server");
  });

  it.each(["", "a", "x".repeat(17), "has space", "dot.dot", "../etc", "a/b", "ünï", "tab\t", "nl\n", "ok\n"])(
    "rejects the invalid name %j",
    (name) => {
      const store = open(file);
      expect(() => store.claim(name)).toThrow(InvalidProfileNameError);
      expect(store.get(name)).toBeUndefined();
    },
  );

  it("treats names as case-sensitive", () => {
    const store = open(file);
    const a = store.claim("Alice");
    const b = store.claim("alice");
    expect(a.created && b.created).toBe(true);
    expect(a.token).not.toBe(b.token);
  });

  it("accepts names that collide with Object.prototype and persists them like any other", async () => {
    const store = open(file);
    const names = ["__proto__", "constructor", "toString", "hasOwnProperty"];
    for (const n of names) expect(store.claim(n).created).toBe(true);
    expect(store.get("__proto__")?.name).toBe("__proto__");
    expect(({} as Record<string, unknown>).gv).toBeUndefined();
    await store.flush();
    const back = open(file);
    for (const n of names) expect(back.get(n)?.name).toBe(n);
    expect(back.get("__proto__")?.token).toBe(store.get("__proto__")?.token);
    store.bankGv("__proto__", 5);
    expect(store.leaderboard(OCT, 10)).toEqual([{ name: "__proto__", gv: 5 }]);
  });

  describe("snapshots", () => {
    function seeded() {
      fs.writeFileSync(file, v2({ alice: goodProfile }));
      return open(file);
    }

    it("claim() and get() hand out deep copies: changing one never touches the store", () => {
      const store = open(file);
      const { record, token } = store.claim("alice");
      record.gv = 99;
      record.gvLifetime = 99;
      record.gvByMonth[OCT] = 99;
      record.stats.runs = 99;
      record.cosmetics.owned.push("hat");
      record.cosmetics.equipped.hat = "hat";
      record.achievements.first_win = 1;
      record.progress.bountyRuns = 99;
      record.progress.winsByFaction.fire = 99;
      record.progress.winsByWeapon.axe = 99;
      record.token = "hijacked";
      expect(store.get("alice")).toEqual(emptyRecord("alice", token));
    });

    it("get() copies every nested field of a full profile", () => {
      const store = seeded();
      const snap = store.get("alice")!;
      expect(snap).toEqual(goodProfile);
      snap.gvByMonth["2026-09"] = 1;
      delete snap.gvByMonth[OCT];
      snap.stats.kills = 0;
      snap.cosmetics.owned.length = 0;
      snap.cosmetics.equipped.cape = "gone";
      snap.achievements.first_win = 0;
      delete snap.achievements.slayer;
      snap.progress.bestRunKills = 0;
      snap.progress.winsByFaction.fire = 99;
      snap.progress.winsByWeapon.bow = 1;
      expect(store.get("alice")).toEqual(goodProfile);
      expect(store.claim("alice", "t-alice").record).toEqual(goodProfile);
    });

    it("the copies are plain objects, and two snapshots share nothing", () => {
      const store = seeded();
      const a = store.get("alice")!;
      const b = store.get("alice")!;
      for (const dict of [a.gvByMonth, a.cosmetics.equipped, a.stats, a.achievements, a.progress, a.progress.winsByFaction, a.progress.winsByWeapon]) {
        expect(Object.getPrototypeOf(dict)).toBe(Object.prototype);
      }
      expect(a.achievements).not.toBe(b.achievements);
      expect(a.progress).not.toBe(b.progress);
      expect(a.progress.winsByFaction).not.toBe(b.progress.winsByFaction);
      expect(a.progress.winsByWeapon).not.toBe(b.progress.winsByWeapon);
      expect(a.gvByMonth).not.toBe(b.gvByMonth);
      expect(a.cosmetics.owned).not.toBe(b.cosmetics.owned);
      expect(a.cosmetics.equipped).not.toBe(b.cosmetics.equipped);
      expect(a.stats).not.toBe(b.stats);
    });
  });
});

describe("get / verifyToken", () => {
  it("get returns undefined for an unknown name", () => {
    expect(open(file).get("nobody")).toBeUndefined();
  });

  it("verifyToken is true only for a known profile and its exact token", () => {
    const store = open(file);
    const a = store.claim("alice");
    const b = store.claim("bobby");
    expect(store.verifyToken("alice", a.token)).toBe(true);
    expect(store.verifyToken("alice", b.token)).toBe(false);
    expect(store.verifyToken("alice", "")).toBe(false);
    expect(store.verifyToken("nobody", a.token)).toBe(false);
    expect(store.verifyToken("alice", undefined as unknown as string)).toBe(false);
    expect(store.verifyToken("alice", 123 as unknown as string)).toBe(false);
  });
});

describe("recordRun", () => {
  it("counts a run by outcome: won, draw and died each have a counter, mia is a death", () => {
    const store = open(file);
    store.claim("alice");
    store.recordRun("alice", run("won"));
    expect(store.get("alice")!.stats).toEqual({ runs: 1, wins: 1, draws: 0, deaths: 0, kills: 0 });
    store.recordRun("alice", run("draw"));
    expect(store.get("alice")!.stats).toEqual({ runs: 2, wins: 1, draws: 1, deaths: 0, kills: 0 });
    store.recordRun("alice", run("died"));
    expect(store.get("alice")!.stats).toEqual({ runs: 3, wins: 1, draws: 1, deaths: 1, kills: 0 });
    store.recordRun("alice", run("mia"));
    expect(store.get("alice")!.stats).toEqual({ runs: 4, wins: 1, draws: 1, deaths: 2, kills: 0 });
  });

  describe("qualified wins", () => {
    const fresh = () => {
      const store = open(file);
      store.claim("alice");
      return store;
    };

    it("a win without winQualified counts as a win and a run, but in none of the qualified counters", () => {
      const store = fresh();
      store.recordRun("alice", { ...run("won", 0, 30), faction: "fire", weapon: "axe" });
      const r = store.get("alice")!;
      expect(r.stats).toEqual({ runs: 1, wins: 1, draws: 0, deaths: 0, kills: 0 });
      expect(r.progress).toEqual(zeroProgress());
      expect(r.gv).toBe(30);
      expect(r.achievements).toEqual({});
      expect(r.cosmetics.owned).toEqual([]);
    });

    it.each([undefined, false])("winQualified %s is the same as leaving it out", (flag) => {
      const store = fresh();
      store.recordRun("alice", { ...run("won"), faction: "fire", weapon: "axe", winQualified: flag });
      expect(store.get("alice")!.progress).toEqual(zeroProgress());
      expect(store.get("alice")!.stats.wins).toBe(1);
    });

    it.each<[string, unknown]>([["1", 1], ["the string true", "true"], ["an object", {}], ["a list", [true]], ["null", null]])(
      "only the boolean true qualifies a win (%s does not)",
      (_label, flag) => {
        const store = fresh();
        store.recordRun("alice", { ...run("won"), faction: "fire", weapon: "axe", winQualified: flag as boolean });
        expect(store.get("alice")!.progress).toEqual(zeroProgress());
      },
    );

    it("a qualified win counts as a win, a qualified win, a win for its faction and a win for its weapon", () => {
      const store = fresh();
      store.recordRun("alice", qwin(2, 40, { faction: "holy", weapon: "wand" }));
      const r = store.get("alice")!;
      expect(r.stats).toEqual({ runs: 1, wins: 1, draws: 0, deaths: 0, kills: 2 });
      expect(r.progress).toEqual({ qualifiedWins: 1, bountyRuns: 0, bestRunKills: 2, winsByFaction: { holy: 1 }, winsByWeapon: { wand: 1 } });
    });

    it.each(["died", "draw", "mia"] as const)("the flag on a %s counts nothing: only a win can be a qualified win", (outcome) => {
      const store = fresh();
      store.recordRun("alice", { ...run(outcome, 0, 10), faction: "fire", weapon: "axe", winQualified: true });
      expect(store.get("alice")!.progress).toEqual(zeroProgress());
      expect(store.get("alice")!.stats.wins).toBe(0);
    });

    it("stats.wins counts every win, the qualified counters only the qualified ones", () => {
      const store = fresh();
      for (let i = 0; i < 3; i++) store.recordRun("alice", { ...run("won"), faction: "fire", weapon: "axe" });
      for (let i = 0; i < 2; i++) store.recordRun("alice", qwin(0, 0, { faction: "fire", weapon: "axe" }));
      store.recordRun("alice", { ...run("won"), faction: "frost", weapon: "bow" });
      const r = store.get("alice")!;
      expect([r.stats.runs, r.stats.wins]).toEqual([6, 6]);
      expect(r.progress).toEqual({ ...zeroProgress(), qualifiedWins: 2, winsByFaction: { fire: 2 }, winsByWeapon: { axe: 2 } });
    });

    it("the gate touches only wins: kills, the best run, bounty runs and GV count for a walkover as for anything else", () => {
      const store = fresh();
      store.recordRun("alice", { ...run("won", 4, 50), bounty: 20, faction: "fire", weapon: "axe" });
      const r = store.get("alice")!;
      expect(r.stats.kills).toBe(4);
      expect(r.progress).toEqual({ ...zeroProgress(), bestRunKills: 4, bountyRuns: 1 });
      expect([r.gv, r.gvLifetime, r.gvByMonth[OCT]]).toEqual([50, 50, 50]);
    });

    it("the counter survives a restart", async () => {
      const store = fresh();
      store.recordRun("alice", qwin(0, 0, { faction: "plague", weapon: "bow" }));
      store.recordRun("alice", { ...run("won"), faction: "plague", weapon: "bow" });
      await store.flush();
      expect(readFile().profiles.alice.progress).toEqual({ ...zeroProgress(), qualifiedWins: 1, winsByFaction: { plague: 1 }, winsByWeapon: { bow: 1 } });
      expect(open(file).get("alice")).toEqual(store.get("alice"));
    });
  });

  it("adds kills, and banks the GV into the balance, the lifetime total and the current month", () => {
    const store = open(file);
    store.claim("alice");
    store.recordRun("alice", run("won", 3, 140));
    store.recordRun("alice", run("died", 1, 25));
    const r = store.get("alice")!;
    expect(r.stats).toEqual({ runs: 2, wins: 1, draws: 0, deaths: 1, kills: 4 });
    expect(r.gv).toBe(165);
    expect(r.gvLifetime).toBe(165);
    expect(r.gvByMonth).toEqual({ [OCT]: 165 });
  });

  it("a run that paid nothing still counts and leaves no month entry", () => {
    const store = open(file);
    store.claim("alice");
    store.recordRun("alice", run("died", 0, 0));
    const r = store.get("alice")!;
    expect(r.stats.runs).toBe(1);
    expect(r.gvByMonth).toEqual({});
    expect(r.gv + r.gvLifetime).toBe(0);
  });

  it("leaves the spendable balance alone when it is lower than the lifetime total", () => {
    fs.writeFileSync(file, v2({ alice: goodProfile })); // 120 spendable of 300 earned
    const store = open(file);
    store.recordRun("alice", run("won", 0, 50));
    const r = store.get("alice")!;
    expect([r.gv, r.gvLifetime]).toEqual([170, 350]);
    expect(r.gvByMonth).toEqual({ "2026-09": 100, [OCT]: 250 });
  });

  it("only touches the profile it names", () => {
    const store = open(file);
    store.claim("alice");
    const bob = store.claim("bobby").record;
    store.recordRun("alice", run("won", 2, 10));
    expect(store.get("bobby")).toEqual(bob);
  });

  it("floors fractional kills and GV; a fraction below 1 is nothing, quietly", () => {
    const { error } = quiet();
    const store = open(file);
    store.claim("alice");
    store.recordRun("alice", run("died", 1.9, 7.9));
    store.recordRun("alice", run("died", 0.5, 0.99));
    const r = store.get("alice")!;
    expect([r.stats.kills, r.gv, r.gvLifetime, r.gvByMonth[OCT]]).toEqual([1, 7, 7, 7]);
    expect(error).not.toHaveBeenCalled();
  });

  describe("garbage amounts", () => {
    // Policy: ignored (counted as 0) and logged, never thrown. The rest of the run is recorded normally.
    const garbage: Array<[string, unknown]> = [
      ["NaN", Number.NaN], ["Infinity", Infinity], ["-Infinity", -Infinity], ["a negative", -4],
      ["a number too big to stay exact", 1e300], ["a string", "12"], ["null", null], ["undefined", undefined],
    ];

    it.each(garbage)("a gv of %s is ignored and logged; the run and its kills still land", (_label, bad) => {
      const { error } = quiet();
      const store = open(file);
      store.claim("alice");
      store.recordRun("alice", { ...qwin(3), gv: bad as number });
      // No GV anywhere; the first kill and the first (qualified) win still unlock their achievements and grant their rewards.
      expect(store.get("alice")).toEqual({
        ...emptyRecord("alice", store.get("alice")!.token),
        stats: { ...zeroStats, runs: 1, wins: 1, kills: 3 },
        progress: { ...zeroProgress(), qualifiedWins: 1, bestRunKills: 3 },
        achievements: { first_blood: now, first_win: now },
        cosmetics: { owned: ["title-bloodied", "title-victor", "skin-laurel"], equipped: {} },
      });
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0]![0])).toMatch(/alice.*gv/);
    });

    it.each(garbage)("kills of %s are ignored and logged; the GV still lands", (_label, bad) => {
      const { error } = quiet();
      const store = open(file);
      store.claim("alice");
      store.recordRun("alice", { outcome: "died", kills: bad as number, gv: 30 });
      const r = store.get("alice")!;
      expect(r.stats).toEqual({ ...zeroStats, runs: 1, deaths: 1 });
      expect([r.gv, r.gvLifetime, r.gvByMonth[OCT]]).toEqual([30, 30, 30]);
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0]![0])).toMatch(/alice.*kills/);
    });

    it.each(garbage)("bankGv(%s) is ignored and logged", (_label, bad) => {
      const { error } = quiet();
      const store = open(file);
      const { record } = store.claim("alice");
      store.bankGv("alice", bad as number);
      expect(store.get("alice")).toEqual(record);
      expect(error).toHaveBeenCalledTimes(1);
    });

    it("never writes a count it would refuse to reload: sums stop at the largest exact integer", async () => {
      fs.writeFileSync(file, v2({ alice: { ...goodProfile, gv: Number.MAX_SAFE_INTEGER - 3, gvLifetime: Number.MAX_SAFE_INTEGER - 3, gvByMonth: {} } }));
      const store = open(file);
      store.recordRun("alice", run("won", 0, 10));
      store.bankGv("alice", Number.MAX_SAFE_INTEGER);
      await store.flush();
      const back = open(file).get("alice")!;
      expect([back.gv, back.gvLifetime, back.gvByMonth[OCT]]).toEqual([Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]);
    });
  });

  it("an outcome it does not know throws before anything changes", () => {
    const store = open(file);
    const { record } = store.claim("alice");
    for (const bad of ["extracted", "__proto__", "", undefined]) {
      expect(() => store.recordRun("alice", run(bad as RunOutcome, 2, 50))).toThrow(TypeError);
    }
    expect(store.get("alice")).toEqual(record);
  });

  it("a clock that gives no usable date fails the call before anything changes; a run without GV needs no month from it", () => {
    const store = open(file, () => Number.NaN);
    const { record } = store.claim("alice");
    expect(() => store.recordRun("alice", run("won", 1, 5))).toThrow(RangeError);
    expect(() => store.bankGv("alice", 5)).toThrow(RangeError);
    expect(store.get("alice")).toEqual(record);
    store.recordRun("alice", run("won", 1, 0));
    expect(store.get("alice")!.stats).toEqual({ ...zeroStats, runs: 1, wins: 1, kills: 1 });
  });

  it("throws for an unknown profile, and changes nothing", () => {
    const store = open(file);
    store.claim("alice");
    for (const name of ["nobody", "__proto__", "constructor", ""]) {
      expect(() => store.recordRun(name, run("died", 1, 10))).toThrow(UnknownProfileError);
    }
    expect(store.leaderboard(OCT, 10)).toEqual([]);
  });
});

describe("bankGv", () => {
  it("adds to the balance, the lifetime total and the current month, and records no run", () => {
    const store = open(file);
    store.claim("alice");
    store.bankGv("alice", 40);
    store.bankGv("alice", 2.7);
    const r = store.get("alice")!;
    expect([r.gv, r.gvLifetime, r.gvByMonth]).toEqual([42, 42, { [OCT]: 42 }]);
    expect(r.stats).toEqual(zeroStats);
  });

  it("zero is a no-op: no month entry, and nothing is written", async () => {
    const store = open(file);
    const { record } = store.claim("alice");
    await store.flush();
    const rename = vi.spyOn(fs.promises, "rename");
    store.bankGv("alice", 0);
    store.bankGv("alice", 0.4);
    await store.flush();
    expect(store.get("alice")).toEqual(record);
    expect(rename).not.toHaveBeenCalled();
  });

  it("throws for an unknown profile", () => {
    expect(() => open(file).bankGv("nobody", 5)).toThrow(UnknownProfileError);
  });
});

describe("months", () => {
  it("GV lands in the month the clock says at that moment, in UTC, to the millisecond", () => {
    const store = open(file);
    store.claim("alice");
    now = Date.UTC(2026, 0, 31, 23, 59, 59, 999);
    store.bankGv("alice", 10);
    now = Date.UTC(2026, 1, 1, 0, 0, 0, 0);
    store.bankGv("alice", 20);
    store.recordRun("alice", run("won", 0, 5));
    const r = store.get("alice")!;
    expect(r.gvByMonth).toEqual({ "2026-01": 10, "2026-02": 25 });
    expect([r.gv, r.gvLifetime]).toEqual([35, 35]);
    expect(store.leaderboard("2026-01", 10)).toEqual([{ name: "alice", gv: 10 }]);
    expect(store.leaderboard("2026-02", 10)).toEqual([{ name: "alice", gv: 25 }]);
  });

  it("rolls over a year", () => {
    const store = open(file);
    store.claim("alice");
    now = Date.UTC(2026, 11, 31, 23, 59, 59, 999);
    store.bankGv("alice", 1);
    now += 1;
    store.bankGv("alice", 2);
    expect(store.get("alice")!.gvByMonth).toEqual({ "2026-12": 1, "2027-01": 2 });
  });

  it("a month is a fresh start on the leaderboard while lifetime GV carries on", () => {
    const store = open(file);
    store.claim("alice");
    store.claim("bobby");
    store.bankGv("alice", 100);
    store.bankGv("bobby", 50);
    now = Date.UTC(2026, 10, 2);
    store.bankGv("bobby", 10);
    expect(store.leaderboard("2026-11", 10)).toEqual([{ name: "bobby", gv: 10 }]);
    expect(store.leaderboard(OCT, 10)).toEqual([{ name: "alice", gv: 100 }, { name: "bobby", gv: 50 }]);
    expect(store.get("bobby")!.gvLifetime).toBe(60);
  });

  it("the month is read from the clock once per payout and only when there is GV to place", () => {
    // Every banked run (but not a zero bankGv) also reads the clock once, for the time its achievements unlock at.
    const clock = vi.fn(() => now);
    const store = open(file, clock);
    store.claim("alice");
    store.recordRun("alice", run("died", 2, 0));
    expect(clock).toHaveBeenCalledTimes(1); // the unlock stamp only: no GV, no month
    clock.mockClear();
    store.bankGv("alice", 0);
    expect(clock).not.toHaveBeenCalled();
    store.recordRun("alice", run("won", 1, 9));
    expect(clock).toHaveBeenCalledTimes(2); // the unlock stamp and the month
    clock.mockClear();
    store.bankGv("alice", 4);
    expect(clock).toHaveBeenCalledTimes(2);
  });

  it("defaults to the system clock", () => {
    const store = new JsonProfileStore(file);
    stores.push(store);
    store.claim("alice");
    const before = new Date().getUTCMonth();
    store.bankGv("alice", 5);
    const months = Object.keys(store.get("alice")!.gvByMonth);
    expect(months).toHaveLength(1);
    // Either side of a month change while the test runs is fine.
    expect([before + 1, new Date().getUTCMonth() + 1]).toContain(Number(months[0]!.slice(5)));
  });
});

describe("leaderboard", () => {
  function seed(rows: Record<string, number>, month = OCT) {
    const store = open(file, () => Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 10));
    for (const [name, gv] of Object.entries(rows)) {
      store.claim(name);
      store.bankGv(name, gv);
    }
    return store;
  }

  it("lists name and gv, highest first", () => {
    const store = seed({ alice: 30, bobby: 90, carol: 60 });
    expect(store.leaderboard(OCT, 10)).toStrictEqual([
      { name: "bobby", gv: 90 }, { name: "carol", gv: 60 }, { name: "alice", gv: 30 },
    ]);
  });

  it("breaks ties by name, ascending, by code unit (so the order never depends on a locale)", () => {
    const store = seed({ mike: 5, Zed: 5, alice: 5, bobby: 9, "al-ice": 5, al_ice: 5 });
    expect(store.leaderboard(OCT, 10).map((e) => e.name)).toEqual(["bobby", "Zed", "al-ice", "al_ice", "alice", "mike"]);
  });

  it("only counts GV banked in that month, and only above zero", () => {
    fs.writeFileSync(file, v2({
      alice: { ...goodProfile, gvByMonth: { "2026-09": 100, [OCT]: 200 } },
      bobby: bobby({ gvByMonth: { "2026-09": 70 } }),
      carol: { ...goodProfile, name: "carol", token: "t-carol", gvByMonth: { [OCT]: 0 } },
      dave: { ...goodProfile, name: "dave", token: "t-dave", gvByMonth: {} },
    }));
    const store = open(file);
    expect(store.leaderboard(OCT, 10)).toEqual([{ name: "alice", gv: 200 }]);
    expect(store.leaderboard("2026-09", 10)).toEqual([{ name: "alice", gv: 100 }, { name: "bobby", gv: 70 }]);
  });

  it("a month with nobody in it, and a month that is not one, are empty", () => {
    const store = seed({ alice: 30 });
    expect(store.leaderboard("2020-01", 10)).toEqual([]);
    for (const bad of ["", "2026-13", "2026-00", "2026-1", "26-10", "__proto__", "constructor", "toString", "2026-10-01"]) {
      expect(store.leaderboard(bad, 10)).toEqual([]);
    }
    expect(store.leaderboard(undefined as unknown as string, 10)).toEqual([]);
  });

  it("an empty store has an empty board", () => {
    expect(open(file).leaderboard(OCT, 10)).toEqual([]);
  });

  describe("limit", () => {
    function crowd() {
      const rows: Record<string, number> = {};
      for (let i = 0; i < 130; i++) rows[`p${String(i).padStart(3, "0")}`] = i + 1;
      return seed(rows);
    }

    it.each<[string, number, number]>([
      ["a normal limit", 5, 5],
      ["one", 1, 1],
      ["zero is raised to 1", 0, 1],
      ["a negative is raised to 1", -7, 1],
      ["above the maximum is cut to it", 1000, LEADERBOARD_MAX_LIMIT],
      ["exactly the maximum", LEADERBOARD_MAX_LIMIT, LEADERBOARD_MAX_LIMIT],
      ["Infinity is cut to the maximum", Infinity, LEADERBOARD_MAX_LIMIT],
      ["-Infinity is raised to 1", -Infinity, 1],
      ["a fraction is floored", 2.9, 2],
      ["NaN falls back to the default", Number.NaN, LEADERBOARD_DEFAULT_LIMIT],
    ])("%s", (_label, limit, count) => {
      const entries = crowd().leaderboard(OCT, limit);
      expect(entries).toHaveLength(count);
      expect(entries[0]).toEqual({ name: "p129", gv: 130 }); // the top is always the top
    });

    it("never returns more than exist", () => {
      expect(seed({ alice: 1, bobby: 2 }).leaderboard(OCT, 50)).toHaveLength(2);
    });
  });

  it("returns fresh data: editing the result does not touch the store", () => {
    const store = seed({ alice: 30 });
    store.leaderboard(OCT, 10)[0]!.gv = 9999;
    expect(store.leaderboard(OCT, 10)).toEqual([{ name: "alice", gv: 30 }]);
  });

  it("never carries a token", () => {
    const store = seed({ alice: 30 });
    expect(JSON.stringify(store.leaderboard(OCT, 10))).not.toContain(store.get("alice")!.token);
  });
});

describe("the ranking cache is invisible", () => {
  const MONTHS = ["2026-09", OCT, "2026-11"] as const;
  type Board = ReturnType<JsonProfileStore["leaderboard"]>;
  const rows = (board: Board) => board.map(({ name, gv }) => ({ name, gv }));
  /** Reads every view of the ranking so that whatever the store caches is warm before the next change. */
  function warm(store: JsonProfileStore, months: readonly string[] = MONTHS): void {
    for (const m of months) {
      store.leaderboard(m, LEADERBOARD_MAX_LIMIT);
      store.leaderboardRank(m, "alice");
    }
    store.leaderboardMonths(24);
  }
  function seeded(rowsByName: Record<string, number>): JsonProfileStore {
    const store = open(file);
    for (const [name, gv] of Object.entries(rowsByName)) {
      store.claim(name);
      store.bankGv(name, gv);
    }
    return store;
  }

  it("GV for a profile that was not on the board shows at once in the board, the rank and the months", () => {
    const store = seeded({ alice: 30, bobby: 20 });
    store.claim("carol");
    store.claim("dave");
    warm(store);
    expect(rows(store.leaderboard(OCT, 10))).toEqual([{ name: "alice", gv: 30 }, { name: "bobby", gv: 20 }]);
    expect(store.leaderboardRank(OCT, "carol")).toBeUndefined();

    store.bankGv("carol", 25);
    expect(rows(store.leaderboard(OCT, 10))).toEqual([{ name: "alice", gv: 30 }, { name: "carol", gv: 25 }, { name: "bobby", gv: 20 }]);
    expect(store.leaderboardRank(OCT, "carol")).toEqual({ rank: 2, gv: 25 });
    expect(store.leaderboardRank(OCT, "bobby")).toEqual({ rank: 3, gv: 20 });

    store.recordRun("dave", run("died", 0, 100));
    expect(rows(store.leaderboard(OCT, 10)).map((r) => r.name)).toEqual(["dave", "alice", "carol", "bobby"]);
    expect(store.leaderboardRank(OCT, "dave")).toEqual({ rank: 1, gv: 100 });
    expect(store.leaderboardRank(OCT, "alice")).toEqual({ rank: 2, gv: 30 });
  });

  it("GV for a profile that was already ranked moves it at once, whether it comes from bankGv or from a run", () => {
    const store = seeded({ alice: 30, bobby: 20, carol: 10 });
    warm(store);
    store.bankGv("carol", 15); // 25: passes bobby
    expect(store.leaderboardRank(OCT, "carol")).toEqual({ rank: 2, gv: 25 });
    expect(store.leaderboardRank(OCT, "bobby")).toEqual({ rank: 3, gv: 20 });
    store.recordRun("bobby", run("won", 0, 10)); // 30: ties alice, and "alice" < "bobby"
    expect(rows(store.leaderboard(OCT, 10))).toEqual([{ name: "alice", gv: 30 }, { name: "bobby", gv: 30 }, { name: "carol", gv: 25 }]);
    store.recordRun("bobby", run("died", 0, 1));
    expect(store.leaderboardRank(OCT, "bobby")).toEqual({ rank: 1, gv: 31 });
    expect(store.leaderboardRank(OCT, "alice")).toEqual({ rank: 2, gv: 30 });
  });

  it("a run that pays nothing leaves the ranking exactly as it was", () => {
    const store = seeded({ alice: 30, bobby: 20 });
    warm(store);
    const before = [store.leaderboard(OCT, 10), store.leaderboardRank(OCT, "bobby"), store.leaderboardMonths(24)];
    store.recordRun("bobby", run("won", 3, 0));
    store.bankGv("bobby", 0);
    expect([store.leaderboard(OCT, 10), store.leaderboardRank(OCT, "bobby"), store.leaderboardMonths(24)]).toEqual(before);
  });

  it("GV in another month shows at once there, even for a month whose empty board was already read, and leaves the others alone", () => {
    const store = seeded({ alice: 30, bobby: 20 });
    warm(store);
    expect(store.leaderboard("2026-11", 10)).toEqual([]); // an empty board has been read
    expect(store.leaderboardRank("2026-11", "alice")).toBeUndefined();
    expect(store.leaderboardMonths(24)).toEqual([OCT]);

    now = Date.UTC(2026, 10, 2);
    store.bankGv("alice", 7);
    expect(store.leaderboard("2026-11", 10)).toEqual([{ name: "alice", gv: 7 }]);
    expect(store.leaderboardRank("2026-11", "alice")).toEqual({ rank: 1, gv: 7 });
    expect(store.leaderboardMonths(24)).toEqual(["2026-11", OCT]);
    expect(rows(store.leaderboard(OCT, 10))).toEqual([{ name: "alice", gv: 30 }, { name: "bobby", gv: 20 }]);

    store.claim("carol");
    store.recordRun("carol", run("died", 0, 9)); // a new profile, first ever GV in the new month
    expect(rows(store.leaderboard("2026-11", 10))).toEqual([{ name: "carol", gv: 9 }, { name: "alice", gv: 7 }]);
    now = Date.UTC(2027, 0, 1); // and a month that follows a year change
    store.bankGv("bobby", 1);
    expect(store.leaderboard("2027-01", 10)).toEqual([{ name: "bobby", gv: 1 }]);
    expect(store.leaderboardMonths(24)).toEqual(["2027-01", "2026-11", OCT]);
  });

  it("a month is listed only once someone has more than 0 GV in it, and reading a board never lists it", () => {
    quiet(); // the garbage amounts below are logged
    const store = open(file);
    store.claim("alice");
    store.claim("bobby");
    expect(store.leaderboard("2026-03", 10)).toEqual([]);
    expect(store.leaderboardMonths(24)).toEqual([]);
    store.recordRun("alice", run("won", 5, 0));
    store.bankGv("alice", 0);
    store.bankGv("alice", 0.9);
    store.bankGv("alice", -3);
    store.bankGv("alice", Number.NaN);
    store.recordRun("bobby", { ...run("died", 0), gv: "12" as unknown as number });
    expect(store.leaderboardMonths(24)).toEqual([]);
    expect(store.leaderboard(OCT, 10)).toEqual([]);
    store.bankGv("alice", 1);
    expect(store.leaderboardMonths(24)).toEqual([OCT]);
    expect(store.leaderboardRank(OCT, "bobby")).toBeUndefined(); // a profile with gv 0 never appears
  });

  it("months that hold only zeros in the file are not listed, and the first real GV lists the month", async () => {
    fs.writeFileSync(file, v2({
      alice: { ...goodProfile, gv: 0, gvLifetime: 0, gvByMonth: { "2026-03": 0, "2026-04": 0 } },
      bobby: bobby({ gvByMonth: {} }),
    }));
    const store = open(file);
    expect(store.leaderboardMonths(24)).toEqual([]);
    expect(store.leaderboard("2026-03", 10)).toEqual([]);
    now = Date.UTC(2026, 2, 9);
    store.bankGv("alice", 4);
    expect(store.leaderboardMonths(24)).toEqual(["2026-03"]);
    expect(store.leaderboard("2026-03", 10)).toEqual([{ name: "alice", gv: 4 }]);
    await store.flush();
    expect(open(file).leaderboardMonths(24)).toEqual(["2026-03"]);
  });

  it("spending changes no ranking and removes no month", () => {
    const store = open(file);
    const token = store.claim("alice").token;
    store.bankGv("alice", 200);
    store.claim("bobby");
    store.bankGv("bobby", 150);
    now = Date.UTC(2026, 10, 2);
    store.bankGv("alice", 100);
    warm(store);
    const before = MONTHS.map((m) => [store.leaderboard(m, 10), store.leaderboardRank(m, "alice")]);
    const months = store.leaderboardMonths(24);

    const bought = store.purchase("alice", token, "trail-ember"); // 100
    store.purchase("alice", token, "skin-crimson"); // 40
    expect(bought.ok).toBe(true);
    expect(store.get("alice")!.gv).toBe(160);
    expect(MONTHS.map((m) => [store.leaderboard(m, 10), store.leaderboardRank(m, "alice")])).toEqual(before);
    expect(store.leaderboardMonths(24)).toEqual(months);
    expect(store.leaderboardRank(OCT, "alice")).toEqual({ rank: 1, gv: 200 });
  });

  it("wearing a title shows on the next read even though the ranking itself is cached; nothing else about the row changes", () => {
    const store = open(file);
    const token = store.claim("alice").token;
    store.bankGv("alice", 100);
    store.claim("bobby");
    store.bankGv("bobby", 50);
    store.purchase("alice", token, "title-rookie");
    warm(store);
    expect(store.leaderboard(OCT, 10)).toStrictEqual([{ name: "alice", gv: 100 }, { name: "bobby", gv: 50 }]);
    expect(store.equip("alice", token, "title", "title-rookie").ok).toBe(true);
    expect(store.leaderboard(OCT, 10)).toStrictEqual([{ name: "alice", gv: 100, title: "title-rookie" }, { name: "bobby", gv: 50 }]);
    expect(store.leaderboardRank(OCT, "alice")).toEqual({ rank: 1, gv: 100 });
    expect(store.equip("alice", token, "title", null).ok).toBe(true);
    expect(store.leaderboard(OCT, 10)).toStrictEqual([{ name: "alice", gv: 100 }, { name: "bobby", gv: 50 }]);
  });

  it("a board a caller has mangled cannot corrupt the next call", () => {
    const store = seeded({ alice: 30, bobby: 20, carol: 10 });
    const expected = [{ name: "alice", gv: 30 }, { name: "bobby", gv: 20 }, { name: "carol", gv: 10 }];
    const first = store.leaderboard(OCT, 10);
    expect(first).toEqual(expected);
    first[0]!.gv = 9999;
    first[1]!.name = "mallory";
    first.reverse();
    first.pop();
    first.length = 0;
    const second = store.leaderboard(OCT, 10);
    expect(second).toEqual(expected);
    expect(second).not.toBe(first);
    second.splice(0, 2);
    second.push({ name: "zed", gv: 1 });
    expect(store.leaderboard(OCT, 10)).toEqual(expected);
    expect(store.leaderboard(OCT, 2)).toEqual(expected.slice(0, 2));
    expect(store.leaderboardRank(OCT, "bobby")).toEqual({ rank: 2, gv: 20 });
    expect(store.leaderboardRank(OCT, "mallory")).toBeUndefined();

    const months = store.leaderboardMonths(10);
    months.push("1999-01");
    months.reverse();
    months.length = 0;
    expect(store.leaderboardMonths(10)).toEqual([OCT]);
  });

  it("two stores opened on the same file give the same ranking, rank and months", async () => {
    const writer = open(file);
    for (let i = 0; i < 40; i++) {
      writer.claim(`p${i}`);
      writer.bankGv(`p${i}`, 1 + (i % 7)); // plenty of ties
    }
    now = Date.UTC(2026, 10, 3);
    for (let i = 0; i < 40; i += 3) writer.bankGv(`p${i}`, 5);
    await writer.flush();
    const a = open(file);
    const b = open(file);
    for (const m of [...MONTHS, "2020-01"]) {
      const board = a.leaderboard(m, LEADERBOARD_MAX_LIMIT);
      expect(b.leaderboard(m, LEADERBOARD_MAX_LIMIT), m).toStrictEqual(board);
      expect(writer.leaderboard(m, LEADERBOARD_MAX_LIMIT), m).toStrictEqual(board);
      for (const [i, row] of board.entries()) {
        expect(a.leaderboardRank(m, row.name)).toEqual({ rank: i + 1, gv: row.gv });
        expect(b.leaderboardRank(m, row.name)).toEqual({ rank: i + 1, gv: row.gv });
      }
    }
    expect(a.leaderboardMonths(24)).toEqual(["2026-11", OCT]);
    expect(b.leaderboardMonths(24)).toEqual(a.leaderboardMonths(24));
    expect(writer.leaderboardMonths(24)).toEqual(a.leaderboardMonths(24));
  });

  it("a store opened on a file that already holds GV ranks it the same as the store that wrote it, after more GV too", async () => {
    const first = seeded({ alice: 30, bobby: 20 });
    warm(first);
    first.bankGv("bobby", 20);
    await first.flush();
    const second = open(file);
    expect(second.leaderboard(OCT, 10)).toEqual(first.leaderboard(OCT, 10));
    // Settled one after the other: two stores writing at once would share one temp path.
    second.bankGv("alice", 15);
    await second.flush();
    first.bankGv("alice", 15);
    await first.flush();
    expect(second.leaderboard(OCT, 10)).toEqual(first.leaderboard(OCT, 10));
    expect(second.leaderboardRank(OCT, "alice")).toEqual({ rank: 1, gv: 45 });
  });

  it("matches a brute-force ranking at every step of a seeded random mix of claims, payouts, purchases, titles and month changes", () => {
    const rng = mulberry32(20261023);
    const below = (n: number) => Math.floor(rng() * n);
    const store = open(file);
    const names: string[] = [];
    const tokens = new Map<string, string>();
    const clocks = [Date.UTC(2026, 8, 5), Date.UTC(2026, 9, 5), Date.UTC(2026, 10, 5)];
    now = clocks[1]!;

    const oracleBoard = (month: string) =>
      names
        .map((n) => store.get(n)!)
        .filter((r) => (r.gvByMonth[month] ?? 0) > 0)
        .map((r) => {
          const title = r.cosmetics.equipped.title;
          return { name: r.name, gv: r.gvByMonth[month]!, ...(title && r.cosmetics.owned.includes(title) ? { title } : {}) };
        })
        .sort((a, b) => b.gv - a.gv || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const oracleMonths = () =>
      [...new Set(names.flatMap((n) => Object.entries(store.get(n)!.gvByMonth).filter(([, gv]) => gv > 0).map(([m]) => m)))].sort().reverse();

    for (let step = 0; step < 400; step++) {
      const roll = below(100);
      if (roll < 12 || names.length === 0) {
        const name = `p${names.length}`;
        tokens.set(name, store.claim(name).token);
        names.push(name);
        if (below(2) === 0) store.bankGv(name, 1 + below(30));
      } else if (roll < 45) {
        store.bankGv(names[below(names.length)]!, below(30));
      } else if (roll < 70) {
        const outcomes: RunOutcome[] = ["won", "died", "draw", "mia"];
        store.recordRun(names[below(names.length)]!, run(outcomes[below(4)]!, below(4), below(40)));
      } else if (roll < 80) {
        const name = names[below(names.length)]!;
        store.purchase(name, tokens.get(name)!, "title-rookie");
        if (below(2) === 0) store.equip(name, tokens.get(name)!, "title", below(3) === 0 ? null : "title-rookie");
      } else if (roll < 85) {
        const name = names[below(names.length)]!;
        store.purchase(name, tokens.get(name)!, "skin-crimson");
      } else {
        now = clocks[below(clocks.length)]!;
      }

      for (const month of [...MONTHS, "2020-01"]) {
        const expected = oracleBoard(month);
        expect(store.leaderboard(month, LEADERBOARD_MAX_LIMIT), `step ${step} ${month}`).toStrictEqual(expected.slice(0, LEADERBOARD_MAX_LIMIT));
        const probe = names[below(names.length)]!;
        const at = expected.findIndex((e) => e.name === probe);
        expect(store.leaderboardRank(month, probe), `step ${step} ${month} ${probe}`).toEqual(at < 0 ? undefined : { rank: at + 1, gv: expected[at]!.gv });
      }
      expect(store.leaderboardMonths(24), `step ${step}`).toEqual(oracleMonths());
    }
    expect(names.length).toBeGreaterThan(30);
    expect(oracleMonths().length).toBeGreaterThan(1);
  });

  it("a month nobody banked GV in is answered at once: the profiles are not scanned and nothing is cached for it", () => {
    const store = open(file);
    for (let i = 0; i < 20; i++) {
      store.claim(`p${i}`);
      store.bankGv(`p${i}`, i + 1);
    }
    // Peeked at to prove the cost: the leaderboard is public, and every well-formed month is a valid request.
    const { profiles, rankCache } = store as unknown as { profiles: Map<string, unknown>; rankCache: Map<string, unknown> };
    const scan = vi.spyOn(profiles, "values");
    for (let year = 2000; year < 2100; year++) {
      for (const month of ["01", "07"]) {
        expect(store.leaderboard(`${year}-${month}`, 10)).toEqual([]);
        expect(store.leaderboardRank(`${year}-${month}`, "p3")).toBeUndefined();
      }
    }
    expect(scan).not.toHaveBeenCalled();
    expect(rankCache.size).toBe(0);

    // A month that has GV still ranks, scanned once and cached.
    expect(store.leaderboard(OCT, 3).map((e) => e.name)).toEqual(["p19", "p18", "p17"]);
    expect(store.leaderboardRank(OCT, "p0")).toEqual({ rank: 20, gv: 1 });
    expect(scan).toHaveBeenCalledTimes(1);
    expect([...rankCache.keys()]).toEqual([OCT]);
  });
});

describe("persistence", () => {
  it("writes the documented v2 file format on flush and leaves no temp file behind", async () => {
    const store = open(file);
    const { token } = store.claim("alice");
    store.recordRun("alice", qwin(2, 50));
    await store.flush();
    expect(readFile()).toEqual({
      version: 2,
      profiles: {
        alice: {
          name: "alice", token, gv: 50, gvLifetime: 50, gvByMonth: { [OCT]: 50 },
          stats: { runs: 1, wins: 1, draws: 0, deaths: 0, kills: 2 },
          // The first kill and the first win unlocked their achievements and granted their rewards, in one step.
          cosmetics: { owned: ["title-bloodied", "title-victor", "skin-laurel"], equipped: {} },
          achievements: { first_blood: now, first_win: now },
          progress: { qualifiedWins: 1, bountyRuns: 0, bestRunKills: 2, winsByFaction: {}, winsByWeapon: {} },
        },
      },
    });
    expect(fs.readdirSync(dir)).toEqual(["stash.json", LOCK]);
  });

  it("a restart brings back every field, and everything keeps working", async () => {
    const store = open(file);
    const a = store.claim("alice");
    const b = store.claim("bobby");
    store.claim("carol");
    store.recordRun("alice", run("won", 3, 200));
    now = Date.UTC(2026, 10, 3);
    store.recordRun("alice", run("died", 1, 40));
    store.recordRun("bobby", run("mia", 0, 0));
    store.bankGv("bobby", 15);
    store.recordRun("bobby", run("draw", 2, 60));
    await store.flush();

    const later = Date.UTC(2026, 11, 1);
    const back = open(file, () => later);
    for (const name of ["alice", "bobby", "carol"]) expect(back.get(name)).toEqual(store.get(name));
    expect(back.get("alice")!.gvByMonth).toEqual({ [OCT]: 200, "2026-11": 40 });
    expect(back.leaderboard(OCT, 10)).toEqual(store.leaderboard(OCT, 10));
    expect(back.leaderboard("2026-11", 10)).toEqual([{ name: "bobby", gv: 75 }, { name: "alice", gv: 40 }]);
    expect(back.claim("alice", a.token).created).toBe(false);
    expect(back.claim("bobby", b.token).created).toBe(false);
    expect(() => back.claim("alice", b.token)).toThrow(ProfileForbiddenError);

    // New GV continues the month it falls in; the old months are not disturbed.
    back.bankGv("alice", 10);
    await back.flush();
    const third = open(file);
    expect(third.get("alice")!.gvByMonth).toEqual({ [OCT]: 200, "2026-11": 40, "2026-12": 10 });
    expect(third.get("alice")!.gvLifetime).toBe(250);
  });

  it("cosmetics survive a rewrite untouched", async () => {
    fs.writeFileSync(file, v2({ alice: goodProfile }));
    const store = open(file);
    store.bankGv("alice", 1);
    await store.flush();
    expect(open(file).get("alice")!.cosmetics).toEqual(goodProfile.cosmetics);
    expect(readFile().profiles.alice.cosmetics).toEqual(goodProfile.cosmetics);
  });

  it("starts empty when the file is missing", () => {
    const store = open(file);
    expect(store.get("alice")).toBeUndefined();
    expect(fs.existsSync(file)).toBe(false);
  });

  it("creates missing directories", async () => {
    const nested = path.join(dir, "a", "b", "stash.json");
    const store = open(nested);
    store.claim("alice");
    await store.flush();
    expect(readFile(nested).profiles.alice.name).toBe("alice");
  });

  it("a write is a temp file renamed over the target, so the target is never half written", async () => {
    const store = open(file);
    store.claim("alice");
    await store.flush();
    const rename = vi.spyOn(fs.promises, "rename");
    const open_ = vi.spyOn(fs.promises, "open");
    store.bankGv("alice", 5);
    await store.flush();
    expect(open_).toHaveBeenCalledWith(path.join(dir, TMP), "w");
    expect(rename).toHaveBeenCalledWith(path.join(dir, TMP), file);
  });

  it("flush resolves immediately when nothing is pending", async () => {
    const store = open(file);
    await store.flush();
    expect(fs.existsSync(file)).toBe(false);
  });

  it("flush covers changes made while a write was already running", async () => {
    const store = open(file);
    store.claim("alice");
    const flushing = store.flush();
    store.bankGv("alice", 7); // lands while the first write is in flight
    await flushing;
    expect(readFile().profiles.alice.gv).toBe(7);
  });

  it("a change made right after a flush is written without another flush call, once the batching window ends", async () => {
    fakeTimers();
    const store = open(file);
    store.claim("alice");
    await store.flush();
    store.bankGv("alice", 7);
    await vi.advanceTimersByTimeAsync(WRITE_WINDOW);
    await waitReal(() => readFile().profiles.alice.gv === 7, "the change to be written");
  });
});

describe("extreme values", () => {
  const MAX = Number.MAX_SAFE_INTEGER;

  it("saturated counters, a broken-clock unlock time of 0, a full wardrobe and many achievements survive a flush and a reopen untouched", async () => {
    const { error } = quiet();
    const wardrobe = COSMETIC_SLOTS.map((slot) => COSMETICS.find((c) => c.slot === slot)?.id);
    expect(wardrobe.every((id) => id !== undefined)).toBe(true); // a cosmetic for every slot, so all of them can be worn at once
    const equipped = Object.fromEntries(COSMETIC_SLOTS.map((slot, i) => [slot, wardrobe[i]!]));
    const unlockTimes = [0, MAX, 1_700_000_000_000];
    const maxed = {
      name: "alice", token: "t-alice", gv: MAX, gvLifetime: MAX,
      gvByMonth: { "2000-01": MAX, "2026-09": 1, [OCT]: MAX, "9999-12": MAX },
      stats: { runs: MAX, wins: MAX, draws: MAX, deaths: MAX, kills: MAX },
      cosmetics: { owned: COSMETICS.map((c) => c.id), equipped },
      achievements: Object.fromEntries(ACHIEVEMENTS.map((a, i) => [a.id, unlockTimes[i % 3]!])),
      progress: {
        qualifiedWins: MAX, bountyRuns: MAX, bestRunKills: MAX,
        winsByFaction: Object.fromEntries(GOLD_FACTIONS.map((f) => [f, MAX])),
        winsByWeapon: Object.fromEntries(GOLD_WEAPONS.map((w) => [w, MAX])),
      },
    };
    fs.writeFileSync(file, v2({ alice: maxed, zed: { ...maxed, name: "zed", token: "t-zed" } }));

    let broken = false;
    const store = open(file, () => (broken ? Number.NaN : now));
    expect(store.get("alice")).toEqual(maxed);

    // Every counter is already at the ceiling: more of everything must stay there, not wrap past it or go to Infinity.
    store.recordRun("alice", qwin(MAX, MAX, { faction: "fire", weapon: "axe", bounty: MAX }));
    store.bankGv("alice", MAX);
    store.recordRun("alice", run("died", 1, 1));
    expect(store.get("alice")).toEqual(maxed);

    // A profile whose achievements are all stamped 0 because the clock was unusable when it earned them.
    store.claim("bobby");
    broken = true;
    const { unlocked } = store.recordRun("bobby", qwin(60, 0, { faction: "fire", weapon: "axe", bounty: 5 }));
    broken = false;
    expect(unlocked).toEqual(["first_blood", "slayer", "reaper", "rampage", "bounty_hunter", "first_win", "win_fire"]);
    expect(Object.values(store.get("bobby")!.achievements)).toEqual(unlocked.map(() => 0));

    const before = ["alice", "zed", "bobby"].map((n) => store.get(n));
    await store.flush();
    const text = fs.readFileSync(file, "utf8");
    expect(text).toContain(`"gv":${MAX}`);

    const back = open(file);
    expect(["alice", "zed", "bobby"].map((n) => back.get(n))).toEqual(before);
    expect(error).not.toHaveBeenCalled(); // nothing was dropped on the way back in
    expect(Object.keys(readFile().profiles).sort()).toEqual(["alice", "bobby", "zed"]);
    expect(fs.readdirSync(dir)).toEqual(["stash.json", LOCK]);

    // The ranking copes with amounts at the ceiling: a tie there falls back to the name. The worn title rides along.
    expect(back.leaderboard(OCT, 10)).toEqual([{ name: "alice", gv: MAX, title: equipped.title }, { name: "zed", gv: MAX, title: equipped.title }]);
    expect(back.leaderboardRank(OCT, "zed")).toEqual({ rank: 2, gv: MAX });
    expect(back.leaderboardMonths(2)).toEqual(["9999-12", OCT]);
    // And it is still a working profile: spending lowers gv only, and the ceiling is a ceiling again afterwards.
    expect(back.verifyToken("alice", "t-alice")).toBe(true);
    back.bankGv("alice", 5);
    expect(back.get("alice")).toEqual(maxed);
  });
});

describe("a store with 50,000 profiles", () => {
  it("answers 200 board and rank lookups fast, and the first call after a payout rebuilds the ranking correctly", { timeout: 30_000 }, () => {
    const TOTAL = 50_000;
    const ACTIVE = 2_000;
    const profile = { qualifiedWins: 0, bountyRuns: 0, bestRunKills: 0, winsByFaction: {}, winsByWeapon: {} };
    const stats = { runs: 3, wins: 1, draws: 0, deaths: 2, kills: 4 };
    const cosmetics = { owned: [] as string[], equipped: {} };
    const profiles: Record<string, unknown> = {};
    const expected: Array<{ name: string; gv: number }> = [];
    for (let i = 0; i < TOTAL; i++) {
      const name = `p${String(i).padStart(5, "0")}`;
      const active = i % (TOTAL / ACTIVE) === 0;
      const gv = active ? 1 + ((i * 7919) % 997) : 0; // 2,000 profiles over under 1,000 values: ties all over the board
      if (active) expected.push({ name, gv });
      const gvByMonth = active ? { "2026-09": 5, [OCT]: gv } : i % 10 === 0 ? { "2026-09": 3 } : {};
      profiles[name] = {
        name, token: `t-${name}`, gv, gvLifetime: gv, gvByMonth, stats, cosmetics, achievements: {}, progress: profile,
      };
    }
    const byGvThenName = (a: { name: string; gv: number }, b: { name: string; gv: number }) =>
      b.gv - a.gv || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    expected.sort(byGvThenName);
    fs.writeFileSync(file, v2(profiles));

    const store = open(file);
    expect(store.leaderboardMonths(24)).toEqual([OCT, "2026-09"]);

    const probes: Array<{ name: string; gv: number }> = [];
    const boards: unknown[] = [];
    const ranks: unknown[] = [];
    // Counts full passes over a Map (the store keeps its profiles in one). The calls go through; only the count is kept.
    const mapPasses = [vi.spyOn(Map.prototype, "values"), vi.spyOn(Map.prototype, "entries"), vi.spyOn(Map.prototype, "forEach"), vi.spyOn(Map.prototype, Symbol.iterator)];
    const passes = () => mapPasses.reduce((n, spy) => n + spy.mock.calls.length, 0);
    const started = performance.now();
    for (let i = 0; i < 200; i++) {
      boards.push(store.leaderboard(OCT, 20));
      const probe = expected[(i * 37) % expected.length]!;
      probes.push(probe);
      ranks.push(store.leaderboardRank(OCT, probe.name));
    }
    const elapsed = performance.now() - started;
    const loopPasses = passes();
    // The bound is generous so it never flakes; the pass count below is what pins the cache. Without it every one of the
    // 400 requests would walk all 50,000 profiles.
    expect(elapsed).toBeLessThan(1500);
    expect(loopPasses).toBeLessThanOrEqual(2); // the first request builds the month's ranking, the other 399 reuse it

    const top = expected.slice(0, 20);
    for (const board of boards) expect(board).toStrictEqual(top);
    expect(ranks).toEqual(probes.map((p) => ({ rank: expected.indexOf(p) + 1, gv: p.gv })));

    // A payout drops that month's cache; the next call rebuilds it and puts the newcomer where it belongs.
    const sudden = "p00001"; // banked nothing so far
    expect(store.leaderboardRank(OCT, sudden)).toBeUndefined();
    store.bankGv(sudden, 5000);
    const passesBefore = passes();
    const rebuilt = performance.now();
    const board = store.leaderboard(OCT, 20);
    const rebuildMs = performance.now() - rebuilt;
    const rebuildPasses = passes() - passesBefore;
    store.leaderboardRank(OCT, sudden);
    expect(passes() - passesBefore).toBe(rebuildPasses); // one rebuild serves the rank lookup too
    expect(rebuildMs).toBeLessThan(1500);
    expect(rebuildPasses).toBeGreaterThanOrEqual(1);
    expect(rebuildPasses).toBeLessThanOrEqual(2);
    expect(board).toStrictEqual([{ name: sudden, gv: 5000 }, ...top.slice(0, 19)]);
    expect(store.leaderboardRank(OCT, sudden)).toEqual({ rank: 1, gv: 5000 });
    expect(store.leaderboardRank(OCT, expected[0]!.name)).toEqual({ rank: 2, gv: expected[0]!.gv });
    const last = expected.at(-1)!;
    expect(store.leaderboardRank(OCT, last.name)).toEqual({ rank: ACTIVE + 1, gv: last.gv });

    // Another month is rebuilt on its own, and the untouched one keeps its ranking.
    now = Date.UTC(2026, 10, 2);
    store.bankGv("p00002", 1);
    expect(store.leaderboard("2026-11", 20)).toEqual([{ name: "p00002", gv: 1 }]);
    expect(store.leaderboardMonths(24)).toEqual(["2026-11", OCT, "2026-09"]);
    expect(store.leaderboard(OCT, 20)).toStrictEqual(board);
    expect(store.leaderboard("2026-09", 3).map((e) => e.gv)).toEqual([5, 5, 5]);
  });
});

describe("a v2 file", () => {
  it("is not touched, backed up or rewritten at startup, and says nothing", async () => {
    fs.writeFileSync(file, v2({ alice: goodProfile, bobby: bobby() }));
    const before = fs.readFileSync(file);
    const { log, error } = quiet();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = open(file);
    await store.flush();
    expect(store.get("alice")).toEqual(goodProfile);
    expect(store.get("bobby")).toEqual(bobby());
    expect([log, error, warn].map((s) => s.mock.calls.length)).toEqual([0, 0, 0]);
    expect(fs.readFileSync(file).equals(before)).toBe(true);
    expect(fs.readdirSync(dir)).toEqual(["stash.json", LOCK]);
  });

  describe("written before qualifiedWins existed", () => {
    const { qualifiedWins: _q, ...legacyProgress } = goodProfile.progress;
    const legacy = { ...goodProfile, stats: { ...goodProfile.stats, wins: 12 }, progress: legacyProgress };

    it("loads with 0 qualified wins, not its old win count, and every other field intact", () => {
      expect(legacy.progress).not.toHaveProperty("qualifiedWins");
      fs.writeFileSync(file, v2({ alice: legacy }));
      const { log, error } = quiet();
      const r = open(file).get("alice")!;
      expect(r.progress).toEqual({ ...legacyProgress, qualifiedWins: 0 });
      expect(r.stats.wins).toBe(12);
      expect({ ...r, progress: legacy.progress }).toEqual({ ...legacy, progress: legacy.progress });
      expect([log, error].map((s) => s.mock.calls.length)).toEqual([0, 0]);
    });

    it("is an older file, not a damaged one: no backup and no rewrite until something changes", async () => {
      const text = v2({ alice: legacy });
      fs.writeFileSync(file, text);
      const store = open(file);
      await store.flush();
      expect(fs.readFileSync(file, "utf8")).toBe(text);
      expect(fs.readdirSync(dir)).toEqual(["stash.json", LOCK]);
      store.bankGv("alice", 1);
      await store.flush();
      expect(readFile().profiles.alice.progress).toEqual({ ...legacyProgress, qualifiedWins: 0 });
    });

    it("a profile with no progress block at all loads with 0 as well", () => {
      const { progress: _p, ...noProgress } = legacy;
      fs.writeFileSync(file, v2({ alice: noProgress }));
      expect(open(file).get("alice")!.progress).toEqual(zeroProgress());
    });

    it("a qualifiedWins of 0 or a large valid one is kept as written", () => {
      fs.writeFileSync(file, v2({
        alice: { ...goodProfile, progress: { ...goodProfile.progress, qualifiedWins: 0 } },
        bobby: bobby({ progress: { ...goodProfile.progress, qualifiedWins: Number.MAX_SAFE_INTEGER } }),
      }));
      const { error } = quiet();
      const store = open(file);
      expect([store.get("alice")!.progress.qualifiedWins, store.get("bobby")!.progress.qualifiedWins]).toEqual([0, Number.MAX_SAFE_INTEGER]);
      expect(error).not.toHaveBeenCalled();
    });
  });

  it("ignores a leftover temp file from a crashed write, and clears it: this version's, an old one's, and another process's", async () => {
    const leftovers = ["stash.json.tmp", "stash.json.tmp-4242", TMP];
    for (const name of leftovers) fs.writeFileSync(path.join(dir, name), "{half");
    fs.writeFileSync(path.join(dir, "stash.json.tmpfile"), "not ours"); // not one of the store's temp names
    const store = open(file);
    expect(fs.readdirSync(dir).sort()).toEqual([LOCK, "stash.json.tmpfile"]);
    store.claim("alice");
    await store.flush();
    expect(readFile().profiles.alice.name).toBe("alice");
    expect(fs.readdirSync(dir).sort()).toEqual(["stash.json", LOCK, "stash.json.tmpfile"]);
  });

  it("keeps a profile that has fields this version does not know, and sheds them on the next write", async () => {
    fs.writeFileSync(file, v2({ alice: { ...goodProfile, stash: [{ uid: "u", def: "gold" }], nickname: "Al" } }));
    const { error } = quiet();
    const store = open(file);
    expect(store.get("alice")).toEqual(goodProfile);
    expect(error).not.toHaveBeenCalled();
    store.bankGv("alice", 1);
    await store.flush();
    expect(Object.keys(readFile().profiles.alice).sort()).toEqual(
      ["achievements", "cosmetics", "gv", "gvByMonth", "gvLifetime", "name", "progress", "stats", "token"],
    );
  });

  it("a cosmetics slot named __proto__ stays plain data: it survives a restart and pollutes nothing", async () => {
    const text = JSON.stringify({ version: 2, profiles: { alice: goodProfile } })
      .replace('"equipped":{"cape":"cape-red"}', '"equipped":{"__proto__":"polluted","cape":"cape-red"}');
    expect(text).toContain('"__proto__":"polluted"');
    fs.writeFileSync(file, text);
    const store = open(file);
    const equipped = store.get("alice")!.cosmetics.equipped;
    expect(Object.keys(equipped).sort()).toEqual(["__proto__", "cape"]);
    expect(Object.getPrototypeOf(equipped)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(equipped, "__proto__")?.value).toBe("polluted");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    store.bankGv("alice", 1);
    await store.flush();
    expect(fs.readFileSync(file, "utf8")).toContain('"__proto__":"polluted"');
    expect(Object.keys(open(file).get("alice")!.cosmetics.equipped).sort()).toEqual(["__proto__", "cape"]);
  });
});

describe("an unusable profile file stops the server instead of wiping every profile", () => {
  it("moves an unparsable file aside, untouched, and refuses to start", () => {
    const text = '{"version":2,"profiles":{"alice":';
    fs.writeFileSync(file, text);
    let error: unknown;
    try {
      new JsonProfileStore(file);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ProfileFileError);
    const [aside, ...rest] = withSuffix(dir, "corrupt");
    expect(rest).toEqual([]);
    expect(aside).toMatch(/^stash\.json\.corrupt-\d+$/);
    expect(fs.readFileSync(path.join(dir, aside!), "utf8")).toBe(text);
    expect(fs.existsSync(file)).toBe(false);
    // The operator is told what happened and what to do, with real paths.
    const message = (error as Error).message;
    expect(message).toContain("refusing to start");
    expect(message).toContain(file);
    expect(message).toContain(path.join(dir, aside!));
    expect(message).toMatch(/restore/i);
    expect(withSuffix(dir, "bak")).toEqual([]);
  });

  it.each([
    ["an empty file", ""],
    ["not JSON at all", "stash? what stash?"],
    ["JSON that is not an object", "[]"],
    ["null", "null"],
    ["a version this code does not know", JSON.stringify({ version: 3, profiles: {} })],
    ["version 0", JSON.stringify({ version: 0, profiles: {} })],
    ["a version that is a string", JSON.stringify({ version: "2", profiles: {} })],
    ["a version that is a string (v1)", JSON.stringify({ version: "1", profiles: {} })],
    ["no version", JSON.stringify({ profiles: {} })],
    ["no profiles object", JSON.stringify({ version: 2 })],
    ["profiles that is a list", JSON.stringify({ version: 2, profiles: [] })],
    ["no profiles object (v1)", JSON.stringify({ version: 1 })],
    ["profiles that is a list (v1)", JSON.stringify({ version: 1, profiles: [] })],
  ])("%s: refuses to start and keeps the file for the operator", (_label, text) => {
    fs.writeFileSync(file, text);
    expect(() => new JsonProfileStore(file)).toThrow(ProfileFileError);
    expect(withSuffix(dir, "corrupt")).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, withSuffix(dir, "corrupt")[0]!), "utf8")).toBe(text);
    expect(fs.existsSync(file)).toBe(false);
    expect(withSuffix(dir, "bak")).toEqual([]); // a file that cannot be read is not migrated either
  });

  it("names the version it found, so a downgrade is easy to spot", () => {
    fs.writeFileSync(file, JSON.stringify({ version: 7, profiles: {} }));
    expect(() => new JsonProfileStore(file)).toThrow(/unsupported version 7, expected 2/);
  });

  it("the server stays down until the file is put back; then it starts with every profile", async () => {
    const first = open(file);
    first.claim("alice");
    await first.close(); // the server stops, which frees the file for the next start
    const backup = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, "{broken");
    expect(() => new JsonProfileStore(file)).toThrow(ProfileFileError);
    expect(() => new JsonProfileStore(file)).not.toThrow(); // nothing left at the path: a fresh, empty start

    fs.writeFileSync(file, backup); // the operator restores a copy
    expect(open(file).get("alice")?.name).toBe("alice");
  });

  it("if the file cannot be moved aside it is left in place and the error says so", () => {
    fs.writeFileSync(file, "{broken");
    vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("read-only filesystem"); });
    expect(() => new JsonProfileStore(file)).toThrow(/could not be moved aside \(read-only filesystem\)/);
    expect(fs.readFileSync(file, "utf8")).toBe("{broken");
  });

  it("an unreadable path (a directory where the file should be) is an error too, not an empty store", () => {
    fs.mkdirSync(file);
    expect(() => new JsonProfileStore(file)).toThrow();
  });
});

describe("a v2 file with some malformed profile entries", () => {
  const damaged: Array<[string, string, unknown]> = [
    ["a name that does not match its key", "bobby", bobby({ name: "someone-else" })],
    ["an invalid profile name", "a b", bobby({ name: "a b" })],
    ["a missing token", "bobby", bobby({ token: undefined })],
    ["an empty token", "bobby", bobby({ token: "" })],
    ["a token that is not a string", "bobby", bobby({ token: 12 })],
    ["a missing gv", "bobby", bobby({ gv: undefined })],
    ["a negative gv", "bobby", bobby({ gv: -1 })],
    ["a fractional gv", "bobby", bobby({ gv: 1.5 })],
    ["a gv that is a string", "bobby", bobby({ gv: "5" })],
    ["a gv too big to be exact", "bobby", bobby({ gv: 1e300 })],
    ["a negative gvLifetime", "bobby", bobby({ gvLifetime: -1 })],
    ["a missing gvLifetime", "bobby", bobby({ gvLifetime: undefined })],
    ["a missing gvByMonth", "bobby", bobby({ gvByMonth: undefined })],
    ["a gvByMonth that is null", "bobby", bobby({ gvByMonth: null })],
    ["a gvByMonth that is a list", "bobby", bobby({ gvByMonth: [5] })],
    ["a month that is not a month", "bobby", bobby({ gvByMonth: { "2026-13": 5 } })],
    ["a month without its leading zero", "bobby", bobby({ gvByMonth: { "2026-1": 5 } })],
    ["a month written in words", "bobby", bobby({ gvByMonth: { october: 5 } })],
    ["a month named __proto__", "bobby", bobby({ gvByMonth: { ["__proto__"]: 5 } })],
    ["a negative month amount", "bobby", bobby({ gvByMonth: { [OCT]: -5 } })],
    ["a fractional month amount", "bobby", bobby({ gvByMonth: { [OCT]: 0.5 } })],
    ["a month amount that is a string", "bobby", bobby({ gvByMonth: { [OCT]: "5" } })],
    ["a negative qualifiedWins", "bobby", bobby({ progress: { ...goodProfile.progress, qualifiedWins: -1 } })],
    ["a fractional qualifiedWins", "bobby", bobby({ progress: { ...goodProfile.progress, qualifiedWins: 1.5 } })],
    ["a qualifiedWins that is a string", "bobby", bobby({ progress: { ...goodProfile.progress, qualifiedWins: "2" } })],
    ["a qualifiedWins that is null", "bobby", bobby({ progress: { ...goodProfile.progress, qualifiedWins: null } })],
    ["a qualifiedWins too big to be exact", "bobby", bobby({ progress: { ...goodProfile.progress, qualifiedWins: 1e300 } })],
    ["missing stats", "bobby", bobby({ stats: undefined })],
    ["stats missing a counter", "bobby", bobby({ stats: { runs: 1, wins: 0, draws: 0, deaths: 0 } })],
    ["v1 style stats", "bobby", bobby({ stats: { raids: 1, extracts: 0, deaths: 0, kills: 0 } })],
    ["negative stats", "bobby", bobby({ stats: { ...zeroStats, runs: -1 } })],
    ["fractional stats", "bobby", bobby({ stats: { ...zeroStats, kills: 1.5 } })],
    ["missing cosmetics", "bobby", bobby({ cosmetics: undefined })],
    ["cosmetics without owned", "bobby", bobby({ cosmetics: { equipped: {} } })],
    ["cosmetics without equipped", "bobby", bobby({ cosmetics: { owned: [] } })],
    ["owned that is not a list", "bobby", bobby({ cosmetics: { owned: {}, equipped: {} } })],
    ["owned with a non-string", "bobby", bobby({ cosmetics: { owned: ["a", 1], equipped: {} } })],
    ["owned with a duplicate", "bobby", bobby({ cosmetics: { owned: ["a", "b", "a"], equipped: {} } })],
    ["equipped that is a list", "bobby", bobby({ cosmetics: { owned: [], equipped: ["a"] } })],
    ["equipped with a non-string", "bobby", bobby({ cosmetics: { owned: [], equipped: { cape: 3 } } })],
    ["an entry that is null", "bobby", null],
    ["an entry that is a string", "bobby", "bobby"],
    ["an entry that is a number", "bobby", 7],
    ["an entry that is a list", "bobby", []],
  ];

  it.each(damaged)("%s: keeps the good profile, drops the bad one, logs it, and rewrites the file", async (_label, key, entry) => {
    const text = v2({ alice: goodProfile, [key]: entry });
    fs.writeFileSync(file, text);
    const { log, error } = quiet();

    const store = open(file);
    expect(store.get("alice")).toEqual(goodProfile);
    expect(store.verifyToken("alice", "t-alice")).toBe(true);
    expect(store.get(key)).toBeUndefined();
    expect(store.claim("alice", "t-alice").created).toBe(false);

    expect(log).not.toHaveBeenCalled(); // nothing was migrated
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toContain(JSON.stringify(key));
    expect(String(error.mock.calls[0]![0])).toContain("dropped 1 malformed profile");

    // The original is kept next to it, byte for byte, before anything overwrites it.
    const [backup, ...extra] = withSuffix(dir, "bak");
    expect(extra).toEqual([]);
    expect(backup).toMatch(/^stash\.json\.bak-\d+$/);
    expect(fs.readFileSync(path.join(dir, backup!), "utf8")).toBe(text);
    expect(String(error.mock.calls[0]![0])).toContain(path.join(dir, backup!));
    expect(withSuffix(dir, "corrupt")).toEqual([]);

    // And the cleaned file is written at startup, with no mutation and no flush needed.
    await vi.waitFor(() => expect(readFile()).toEqual({ version: 2, profiles: { alice: goodProfile } }));
  });

  it("is quiet from then on: the next start sees a clean file", async () => {
    fs.writeFileSync(file, v2({ alice: goodProfile, bobby: null }));
    quiet();
    await open(file).flush();
    vi.restoreAllMocks();
    const { log, error } = quiet();
    const again = open(file);
    expect(again.get("alice")).toEqual(goodProfile);
    expect(error).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(withSuffix(dir, "bak")).toHaveLength(1);
  });

  it("keeps every good profile when several are bad", async () => {
    const carol = { ...goodProfile, name: "carol", token: "t-carol" };
    fs.writeFileSync(file, v2({ x1: null, alice: goodProfile, x2: { name: "x2" }, carol, x3: 7 }));
    const { error } = quiet();
    const store = open(file);
    expect([store.get("alice"), store.get("carol")]).toEqual([goodProfile, carol]);
    expect(error).toHaveBeenCalledTimes(1);
    for (const name of ["x1", "x2", "x3"]) expect(String(error.mock.calls[0]![0])).toContain(JSON.stringify(name));
    expect(String(error.mock.calls[0]![0])).toContain("dropped 3 malformed profile");
    await vi.waitFor(() => expect(Object.keys(readFile().profiles).sort()).toEqual(["alice", "carol"]));
  });

  it("when every entry is bad the server still starts, empty, with the original kept", async () => {
    const text = v2({ x1: null, x2: 4 });
    fs.writeFileSync(file, text);
    quiet();
    const store = open(file);
    expect(store.get("x1")).toBeUndefined();
    await vi.waitFor(() => expect(readFile()).toEqual({ version: 2, profiles: {} }));
    expect(fs.readFileSync(path.join(dir, withSuffix(dir, "bak")[0]!), "utf8")).toBe(text);
  });

  it("quotes and shortens hostile keys, and stops listing after a screenful", () => {
    const profiles: Record<string, unknown> = { alice: goodProfile, ["evil\n" + "x".repeat(500)]: null };
    for (let i = 0; i < 60; i++) profiles[`bad${i}`] = null;
    fs.writeFileSync(file, v2(profiles));
    const { error } = quiet();
    open(file);
    const line = String(error.mock.calls[0]![0]);
    expect(line).toContain("dropped 61 malformed profile");
    expect(line).toContain("and 11 more");
    expect(line).not.toContain("\n");
    expect(line.length).toBeLessThan(5000);
  });

  it("if the backup cannot be written the server refuses to start rather than overwrite the original", () => {
    const text = v2({ alice: goodProfile, bobby: null });
    fs.writeFileSync(file, text);
    quiet();
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => { throw new Error("no space left on device"); });
    expect(() => new JsonProfileStore(file)).toThrow("no space left on device");
    vi.restoreAllMocks();
    expect(fs.readFileSync(file, "utf8")).toBe(text);
    expect(withSuffix(dir, "bak")).toEqual([]); // no half-written backup either
  });
});

describe("a v1 file (the extraction build's stash format) is migrated", () => {
  const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "stash-v1.json");
  const fixtureBytes = fs.readFileSync(FIXTURE);
  const fixture = JSON.parse(fixtureBytes.toString("utf8")) as {
    profiles: Record<string, { name: string; token: string; stash: unknown[]; stats: { raids: number; extracts: number; deaths: number; kills: number } }>;
  };
  const migratedNames = ["alice", "BobTheBuilder", "zed-9", "__proto__", "carol_dev"];

  /** Works on a copy: the fixture itself is never touched. */
  const useFixture = () => fs.copyFileSync(FIXTURE, file);

  it("the fixture is what the tests below assume it is", () => {
    expect(Object.keys(fixture.profiles)).toEqual([...migratedNames, "mallory"]);
    expect(fixture.profiles.alice!.stash.length).toBeGreaterThan(3);
    expect(Object.hasOwn(fixture.profiles, "__proto__")).toBe(true);
  });

  it("keeps each valid profile's name and token, drops the stash, and maps the stats", () => {
    useFixture();
    quiet();
    const store = open(file);
    for (const name of migratedNames) {
      const old = fixture.profiles[name]!;
      expect(store.get(name)).toEqual({
        name,
        token: old.token,
        gv: 0,
        gvLifetime: 0,
        gvByMonth: {},
        stats: { runs: old.stats.raids, wins: 0, draws: 0, deaths: old.stats.deaths, kills: old.stats.kills },
        cosmetics: { owned: [], equipped: {} },
        achievements: {},
        progress: zeroProgress(),
      });
      expect(store.get(name)).not.toHaveProperty("stash");
    }
    expect(store.get("alice")!.stats).toEqual({ runs: 14, wins: 0, draws: 0, deaths: 8, kills: 11 });
  });

  it("drops the malformed entry and says so", () => {
    useFixture();
    const { error } = quiet();
    const store = open(file);
    expect(store.get("mallory")).toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    const line = String(error.mock.calls[0]![0]);
    expect(line).toContain('"mallory"');
    expect(line).toContain("dropped 1 malformed profile");
    expect(line).toContain("kept 5");
  });

  it("browsers keep their profile: the old tokens still work, and nobody else's do", () => {
    useFixture();
    quiet();
    const store = open(file);
    for (const name of migratedNames) {
      const { token } = fixture.profiles[name]!;
      expect(store.verifyToken(name, token)).toBe(true);
      expect(store.claim(name, token).created).toBe(false);
      expect(() => store.claim(name, "wrong")).toThrow(ProfileForbiddenError);
    }
    expect(store.verifyToken("alice", fixture.profiles.carol_dev!.token)).toBe(false);
    expect(store.verifyToken("mallory", fixture.profiles.mallory!.token)).toBe(false);
  });

  it("saves the original bytes as .bak-v1 first, and logs one line saying how many and where", () => {
    useFixture();
    const { log, error } = quiet();
    open(file);
    const backup = `${file}.bak-v1`;
    expect(fs.readFileSync(backup).equals(fixtureBytes)).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]![0]);
    expect(line).toContain("migrated 5 profile(s)");
    expect(line).toContain(backup);
    expect(line).not.toContain("\n");
    expect(String(error.mock.calls[0]![0])).toContain(backup); // the dropped entry's report points at the same copy
    expect(withSuffix(dir, "bak")).toEqual(["stash.json.bak-v1"]);
    expect(withSuffix(dir, "corrupt")).toEqual([]);
  });

  it("writes the migrated v2 file right away: no mutation, no flush", async () => {
    useFixture();
    quiet();
    open(file);
    await vi.waitFor(() => expect(readFile().version).toBe(2));
    const disk = readFile();
    expect(Object.keys(disk.profiles)).toEqual(migratedNames);
    expect(Object.hasOwn(disk.profiles, "__proto__")).toBe(true);
    expect(disk.profiles.alice).toEqual({
      name: "alice", token: fixture.profiles.alice!.token, gv: 0, gvLifetime: 0, gvByMonth: {},
      stats: { runs: 14, wins: 0, draws: 0, deaths: 8, kills: 11 }, cosmetics: { owned: [], equipped: {} },
      achievements: {}, progress: zeroProgress(),
    });
    expect(fs.readFileSync(file, "utf8")).not.toMatch(/stash|knife|bandage|extracts/);
  });

  it("the second start reads the v2 file: quiet, no new backup, nothing rewritten", async () => {
    useFixture();
    quiet();
    const first = open(file);
    await first.flush();
    vi.restoreAllMocks();
    const { log, error } = quiet();
    const again = open(file);
    await again.flush();
    expect(again.get("alice")).toEqual(first.get("alice"));
    expect([log, error].map((s) => s.mock.calls.length)).toEqual([0, 0]);
    expect(fs.readdirSync(dir).sort()).toEqual(["stash.json", "stash.json.bak-v1", LOCK]);
    expect(fs.readFileSync(`${file}.bak-v1`).equals(fixtureBytes)).toBe(true);
  });

  it("migrated profiles take part in the new economy like any other", async () => {
    useFixture();
    quiet();
    const store = open(file);
    store.recordRun("alice", run("won", 4, 150));
    store.bankGv("__proto__", 30);
    await store.flush();
    const back = open(file);
    expect(back.get("alice")).toMatchObject({
      gv: 150, gvLifetime: 150, gvByMonth: { [OCT]: 150 }, stats: { runs: 15, wins: 1, deaths: 8, kills: 15 },
    });
    expect(back.leaderboard(OCT, 10)).toEqual([{ name: "alice", gv: 150 }, { name: "__proto__", gv: 30 }]);
  });

  it("never overwrites a backup that is already there: it uses .bak-v1-<time> instead", () => {
    useFixture();
    fs.writeFileSync(`${file}.bak-v1`, "an earlier backup, precious");
    const { log } = quiet();
    open(file);
    expect(fs.readFileSync(`${file}.bak-v1`, "utf8")).toBe("an earlier backup, precious");
    const [second, ...rest] = withSuffix(dir, "bak-v1-");
    expect(rest).toEqual([]);
    expect(second).toMatch(/^stash\.json\.bak-v1-\d+$/);
    expect(fs.readFileSync(path.join(dir, second!)).equals(fixtureBytes)).toBe(true);
    expect(String(log.mock.calls[0]![0])).toContain(path.join(dir, second!));
  });

  it("refuses to start if every backup name is taken, with the v1 file untouched", () => {
    useFixture();
    quiet();
    const t = 1_700_000_000_000;
    fs.writeFileSync(`${file}.bak-v1`, "one");
    fs.writeFileSync(`${file}.bak-v1-${t}`, "two");
    vi.spyOn(Date, "now").mockReturnValue(t);
    expect(() => new JsonProfileStore(file)).toThrow(/could not save a copy/);
    vi.restoreAllMocks();
    expect(fs.readFileSync(file).equals(fixtureBytes)).toBe(true);
    expect(fs.readFileSync(`${file}.bak-v1`, "utf8")).toBe("one");
    expect(fs.readFileSync(`${file}.bak-v1-${t}`, "utf8")).toBe("two");
  });

  it("if the backup cannot be written, startup fails and the v1 file is left untouched", async () => {
    useFixture();
    quiet();
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => { throw new Error("no space left on device"); });
    expect(() => new JsonProfileStore(file)).toThrow(/no space left on device/);
    vi.restoreAllMocks();
    expect(fs.readFileSync(file).equals(fixtureBytes)).toBe(true);
    await sleep(30); // a write that was wrongly started would have landed by now
    expect(fs.readdirSync(dir)).toEqual(["stash.json"]); // no v2 file, no partial backup, nothing moved aside
    expect(fs.readFileSync(file).equals(fixtureBytes)).toBe(true);
  });

  it("if the backup cannot even be created, startup fails and the v1 file is left untouched", async () => {
    useFixture();
    quiet();
    const realOpen = fs.openSync.bind(fs);
    vi.spyOn(fs, "openSync").mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
      if (!String(p).includes(".bak-v1")) return (realOpen as (...a: unknown[]) => number)(p, ...rest); // readFileSync opens too
      throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    }) as typeof fs.openSync);
    expect(() => new JsonProfileStore(file)).toThrow(/could not save a copy.*EACCES/);
    vi.restoreAllMocks();
    await sleep(30);
    expect(fs.readdirSync(dir)).toEqual(["stash.json"]);
    expect(fs.readFileSync(file).equals(fixtureBytes)).toBe(true);
  });

  it("a v1 file with no profiles is migrated too: a version bump and a backup", async () => {
    const text = v1({});
    fs.writeFileSync(file, text);
    const { log } = quiet();
    open(file);
    expect(String(log.mock.calls[0]![0])).toContain("migrated 0 profile(s)");
    expect(fs.readFileSync(`${file}.bak-v1`, "utf8")).toBe(text);
    await vi.waitFor(() => expect(readFile()).toEqual({ version: 2, profiles: {} }));
  });

  it("when every entry is bad the server still starts, empty, with the original kept", async () => {
    const text = v1({ x1: null, x2: 4 });
    fs.writeFileSync(file, text);
    quiet();
    open(file);
    await vi.waitFor(() => expect(readFile()).toEqual({ version: 2, profiles: {} }));
    expect(fs.readFileSync(`${file}.bak-v1`, "utf8")).toBe(text);
  });

  it("an unparsable v1 file is refused, not migrated, and gets no backup of its own", () => {
    const text = '{"version":1,"profiles":{"alice":';
    fs.writeFileSync(file, text);
    expect(() => new JsonProfileStore(file)).toThrow(ProfileFileError);
    expect(withSuffix(dir, "bak")).toEqual([]);
    expect(fs.readFileSync(path.join(dir, withSuffix(dir, "corrupt")[0]!), "utf8")).toBe(text);
  });

  it("ignores v1 fields it has no use for, and migrates a profile whose stash is empty", () => {
    const old = { name: "alice", token: "t-alice", stash: [], stats: { raids: 2, extracts: 1, deaths: 1, kills: 3 }, lastSeen: 5 };
    fs.writeFileSync(file, v1({ alice: old }));
    quiet();
    expect(open(file).get("alice")).toEqual({ ...emptyRecord("alice", "t-alice"), stats: { runs: 2, wins: 0, draws: 0, deaths: 1, kills: 3 } });
  });

  describe("entries the v1 store would have dropped are dropped", () => {
    const v1Stats = { raids: 2, extracts: 1, deaths: 1, kills: 3 };
    const v1Alice = { name: "alice", token: "t-alice", stash: [{ uid: "u1", def: "gold" }, { uid: "u2", def: "medkit" }], stats: v1Stats };
    const migratedAlice = { ...emptyRecord("alice", "t-alice"), stats: { runs: 2, wins: 0, draws: 0, deaths: 1, kills: 3 } };
    const v1Bob = (patch: Record<string, unknown>) => ({ ...v1Alice, name: "bobby", token: "t-bobby", ...patch });
    const cases: Array<[string, string, unknown]> = [
      ["a name that does not match its key", "bobby", v1Bob({ name: "someone-else" })],
      ["an invalid profile name", "a b", v1Bob({ name: "a b" })],
      ["a missing token", "bobby", v1Bob({ token: undefined })],
      ["an empty token", "bobby", v1Bob({ token: "" })],
      ["negative stats", "bobby", v1Bob({ stats: { ...v1Stats, raids: -1 } })],
      ["fractional stats", "bobby", v1Bob({ stats: { ...v1Stats, kills: 1.5 } })],
      ["missing stats", "bobby", v1Bob({ stats: undefined })],
      ["v2 style stats", "bobby", v1Bob({ stats: zeroStats })],
      ["a stash that is not a list", "bobby", v1Bob({ stash: {} })],
      ["a missing stash", "bobby", v1Bob({ stash: undefined })],
      ["a malformed stash item", "bobby", v1Bob({ stash: [{ uid: 1 }] })],
      ["a duplicate stash uid", "bobby", v1Bob({ stash: [{ uid: "u", def: "gold" }, { uid: "u", def: "gold" }] })],
      ["an entry that is null", "bobby", null],
      ["an entry that is a string", "bobby", "bobby"],
      ["an entry that is a list", "bobby", []],
    ];

    it.each(cases)("%s: migrates the good profile, drops the bad one, reports it", async (_label, key, entry) => {
      const text = v1({ alice: v1Alice, [key]: entry });
      fs.writeFileSync(file, text);
      const { log, error } = quiet();

      const store = open(file);
      expect(store.get("alice")).toEqual(migratedAlice);
      expect(store.get(key)).toBeUndefined();
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0]![0])).toContain("migrated 1 profile(s)");
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0]![0])).toContain(JSON.stringify(key));
      expect(String(error.mock.calls[0]![0])).toContain("dropped 1 malformed profile");
      expect(fs.readFileSync(`${file}.bak-v1`, "utf8")).toBe(text);
      expect(withSuffix(dir, "bak")).toEqual(["stash.json.bak-v1"]);
      await vi.waitFor(() => expect(readFile()).toEqual({ version: 2, profiles: { alice: migratedAlice } }));
    });
  });
});

describe("durability and retry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("syncs the directory after the rename, so the new entry survives a crash", async () => {
    const store = open(file);
    store.claim("alice");
    await store.flush();

    const order: string[] = [];
    const realOpen = fs.promises.open.bind(fs.promises);
    const realRename = fs.promises.rename.bind(fs.promises);
    vi.spyOn(fs.promises, "open").mockImplementation((async (...args: Parameters<typeof fs.promises.open>) => {
      const fh = await realOpen(...args);
      const label = `${path.basename(String(args[0]))}:${args[1]}`;
      order.push(`open ${label}`);
      const sync = fh.sync.bind(fh);
      fh.sync = async () => { order.push(`sync ${label}`); await sync(); };
      return fh;
    }) as typeof fs.promises.open);
    vi.spyOn(fs.promises, "rename").mockImplementation(async (a, b) => { order.push("rename"); await realRename(a, b); });

    store.bankGv("alice", 5);
    await store.flush();
    expect(order).toEqual([
      `open ${TMP}:w`, `sync ${TMP}:w`, "rename",
      `open ${path.basename(dir)}:r`, `sync ${path.basename(dir)}:r`,
    ]);
  });

  /** Makes opening the directory (not the temp file) fail with the given errno code. */
  function failDirOpen(code: string) {
    const realOpen = fs.promises.open.bind(fs.promises);
    return vi.spyOn(fs.promises, "open").mockImplementation(((...args: Parameters<typeof fs.promises.open>) => {
      if (String(args[0]) !== dir) return realOpen(...args);
      return Promise.reject(Object.assign(new Error(`${code}: cannot open a directory`), { code }));
    }) as typeof fs.promises.open);
  }

  it.each(["EISDIR", "EPERM", "EINVAL"])("a platform that cannot open or sync a directory (%s) is not a failed write", async (code) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    failDirOpen(code);
    const store = open(file);
    store.claim("alice");
    await store.flush();
    expect(readFile().profiles.alice.name).toBe("alice");
    expect(error).not.toHaveBeenCalled();
  });

  it("any other failure to sync the directory is a failed write", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    failDirOpen("EIO");
    const store = open(file);
    store.claim("alice");
    await expect(store.flush()).rejects.toThrow("EIO");
  });

  /** Renames fail while `state.failing`; counts every attempt. */
  function flakyRename() {
    const state = { failing: true, attempts: 0 };
    const realRename = fs.promises.rename.bind(fs.promises);
    vi.spyOn(fs.promises, "rename").mockImplementation((async (...args: Parameters<typeof fs.promises.rename>) => {
      state.attempts++;
      if (state.failing) throw new Error("disk full");
      return realRename(...args);
    }) as typeof fs.promises.rename);
    return state;
  }

  it("a failed write is retried on its own: 1 s, doubling to a 30 s cap, on an unref'd timer, until it lands", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const unref = fakeTimers();
    const disk = flakyRename();
    const store = open(file);
    store.claim("alice");
    await vi.advanceTimersByTimeAsync(WRITE_WINDOW);
    await waitReal(() => disk.attempts === 1, "the first attempt");
    expect(fs.existsSync(file)).toBe(false);

    let attempts = 1;
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      await realSleep(10);
      expect(disk.attempts).toBe(attempts); // not a millisecond early
      await vi.advanceTimersByTimeAsync(1);
      attempts++;
      await waitReal(() => disk.attempts === attempts, `the retry after ${delay} ms`);
    }
    // One timer per failure, each armed as its attempt failed: the last of them is the pending 30 s one.
    expect(unref).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);

    disk.failing = false;
    await vi.advanceTimersByTimeAsync(30000);
    await waitReal(() => fs.existsSync(file), "the retry to succeed");
    await waitReal(() => vi.getTimerCount() === 0, "the retry timer to be gone");
    expect(readFile().profiles.alice.name).toBe("alice");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(disk.attempts).toBe(attempts + 1); // no more attempts once it worked
  });

  it("after a success the backoff starts over at 1 s", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const unref = fakeTimers();
    const disk = flakyRename();
    const store = open(file);
    store.claim("alice");
    await vi.advanceTimersByTimeAsync(WRITE_WINDOW);
    await waitReal(() => disk.attempts === 1, "the first attempt");
    await vi.advanceTimersByTimeAsync(1000); // retry 1 fails, the next delay is 2 s
    await waitReal(() => disk.attempts === 2, "the second attempt");
    disk.failing = false;
    await vi.advanceTimersByTimeAsync(2000);
    await waitReal(() => fs.existsSync(file), "the write to land");
    await store.flush(); // the write has finished for good, its directory sync included

    disk.failing = true;
    store.bankGv("alice", 5);
    await vi.advanceTimersByTimeAsync(WRITE_WINDOW);
    await waitReal(() => disk.attempts === 4, "the attempt after the next mutation");
    expect(unref).toEqual([1000, 2000, 1000]);
  });

  it("while backing off, a mutation does not start another write; flush() writes at once and cancels the timer", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fakeTimers();
    const disk = flakyRename();
    const store = open(file);
    store.claim("alice");
    await vi.advanceTimersByTimeAsync(WRITE_WINDOW);
    await waitReal(() => disk.attempts === 1, "the first attempt");
    expect(vi.getTimerCount()).toBe(1);

    store.bankGv("alice", 5);
    store.recordRun("alice", run("died"));
    await realSleep(30);
    expect(disk.attempts).toBe(1); // the timer owns the next attempt

    disk.failing = false;
    await store.flush();
    expect(disk.attempts).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
    expect(readFile().profiles.alice.gv).toBe(5);
    expect(readFile().profiles.alice.stats.deaths).toBe(1);
  });

  it("flush() still rejects while the disk is failing, and each failure arms one timer, never several", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fakeTimers();
    flakyRename();
    const store = open(file);
    store.claim("alice");
    await expect(store.flush()).rejects.toThrow("disk full");
    await expect(store.flush()).rejects.toThrow("disk full");
    await expect(store.flush()).rejects.toThrow("disk full");
    expect(vi.getTimerCount()).toBe(1);
  });

  it("a migration whose first write fails is retried like any other write; the v1 file and its backup wait it out", async () => {
    fs.copyFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "stash-v1.json"), file);
    quiet();
    fakeTimers();
    const disk = flakyRename();
    const store = open(file);
    await waitReal(() => disk.attempts === 1, "the first attempt");
    expect(readFile().version).toBe(1);
    expect(fs.existsSync(`${file}.bak-v1`)).toBe(true);
    disk.failing = false;
    await store.flush();
    expect(readFile().version).toBe(2);
  });
});

describe("write serialization", () => {
  /** Slows every write down and records how many writes overlap and how many ran. */
  function instrument(delayMs = 15) {
    const stats = { active: 0, maxActive: 0, writes: 0 };
    const realOpen = fs.promises.open.bind(fs.promises);
    const realRename = fs.promises.rename.bind(fs.promises);
    vi.spyOn(fs.promises, "open").mockImplementation(((...args: Parameters<typeof fs.promises.open>) => {
      // Only the temp-file open starts a write; syncing the directory afterwards also goes through open().
      if (!/\.tmp-\d+$/.test(String(args[0]))) return realOpen(...args);
      stats.active++;
      stats.writes++;
      stats.maxActive = Math.max(stats.maxActive, stats.active);
      return sleep(delayMs).then(() => realOpen(...args));
    }) as typeof fs.promises.open);
    vi.spyOn(fs.promises, "rename").mockImplementation((async (...args: Parameters<typeof fs.promises.rename>) => {
      await sleep(delayMs);
      try {
        return await realRename(...args);
      } finally {
        stats.active--;
      }
    }) as typeof fs.promises.rename);
    return stats;
  }

  it("a synchronous burst of mutations costs a single write", async () => {
    const stats = instrument(1);
    const store = open(file);
    store.claim("alice");
    for (let i = 0; i < 200; i++) store.bankGv("alice", 1);
    await store.flush();
    expect(stats.writes).toBe(1);
    expect(readFile().profiles.alice.gv).toBe(200);
  });

  it("never has two writes in flight, and coalesces mutations that arrive while one runs", async () => {
    const stats = instrument();
    const store = open(file);
    store.claim("alice");
    const flushes: Promise<void>[] = [];
    for (let i = 0; i < 60; i++) {
      store.bankGv("alice", 1);
      flushes.push(store.flush()); // asks for a write at once, in its own macrotask, many during a single 30 ms write
      await sleep(2);
    }
    await Promise.all(flushes);
    expect(stats.maxActive).toBe(1);
    expect(stats.writes).toBeGreaterThan(1);
    expect(stats.writes).toBeLessThan(30);
    expect(readFile().profiles.alice.gv).toBe(60);
    expect(fs.readdirSync(dir)).toEqual(["stash.json", LOCK]);
  });

  it("the file always ends up equal to the in-memory state", async () => {
    instrument(3);
    const store = open(file);
    const { token } = store.claim("alice");
    store.claim("bobby");
    const outcomes: RunOutcome[] = ["won", "draw", "died", "mia"];
    for (let i = 0; i < 25; i++) {
      now += 1000 * 3600 * 24 * 3; // drifts across a couple of months
      store.bankGv("alice", i + 1);
      store.recordRun("alice", run(outcomes[i % 4]!, i, i * 2));
      store.recordRun("bobby", run(outcomes[(i + 1) % 4]!, 1, i));
      if (i % 5 === 0) await sleep(4);
    }
    await store.flush();
    const disk = open(file);
    expect(disk.get("alice")).toEqual(store.get("alice"));
    expect(disk.get("bobby")).toEqual(store.get("bobby"));
    expect(disk.verifyToken("alice", token)).toBe(true);
    expect(Object.keys(disk.get("alice")!.gvByMonth).length).toBeGreaterThan(1);
  });

  it("flush rejects when the write fails and the data is retried by the next flush", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rename = vi.spyOn(fs.promises, "rename").mockRejectedValueOnce(new Error("disk on fire"));
    const store = open(file);
    store.claim("alice");
    await expect(store.flush()).rejects.toThrow("disk on fire");
    expect(fs.existsSync(file)).toBe(false);
    await store.flush(); // the mocked failure was one-shot: the retry succeeds
    expect(rename).toHaveBeenCalledTimes(2);
    expect(readFile().profiles.alice.name).toBe("alice");
  });

  it("a failed background write does not leave an unhandled rejection", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rename = vi.spyOn(fs.promises, "rename").mockRejectedValueOnce(new Error("nope"));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      fakeTimers();
      const store = open(file);
      store.claim("alice");
      await vi.advanceTimersByTimeAsync(WRITE_WINDOW);
      await waitReal(() => rename.mock.calls.length === 1, "the background write to fail");
      await realSleep(30);
      expect(unhandled).not.toHaveBeenCalled();
      await store.flush();
      expect(readFile().profiles.alice.name).toBe("alice");
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});

describe("batched writes", () => {
  it("a burst of changes over many ticks is a single write, when the batching window ends", async () => {
    fakeTimers();
    const rename = vi.spyOn(fs.promises, "rename");
    const store = open(file);
    store.claim("alice");
    for (let i = 0; i < 25; i++) {
      store.bankGv("alice", 1);
      await realSleep(2); // each in its own macrotask: a write started by the first change would be done long before the last
    }
    expect(rename).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(WRITE_WINDOW - 1);
    await realSleep(20);
    expect(rename).not.toHaveBeenCalled();
    expect(fs.existsSync(file)).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await waitReal(() => fs.existsSync(file), "the batch to be written");
    await store.flush(); // the write has finished for good
    expect(rename).toHaveBeenCalledTimes(1);
    expect(readFile().profiles.alice.gv).toBe(25);
  });

  it("changes made while a write runs wait for the next window instead of following it at once", async () => {
    fakeTimers();
    const realRename = fs.promises.rename.bind(fs.promises);
    const rename = vi.spyOn(fs.promises, "rename").mockImplementation((async (...args: Parameters<typeof fs.promises.rename>) => {
      await realSleep(30);
      return realRename(...args);
    }) as typeof fs.promises.rename);
    const store = open(file);
    store.claim("alice");
    await vi.advanceTimersByTimeAsync(WRITE_WINDOW);
    await waitReal(() => rename.mock.calls.length === 1, "the first write to start");
    store.bankGv("alice", 5); // lands while the first write is in flight
    await realSleep(150); // long enough for that write to have finished
    expect(rename).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(WRITE_WINDOW - 1);
    await realSleep(20);
    expect(rename).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await waitReal(() => rename.mock.calls.length === 2, "the second write to start");
    await store.flush();
    expect(readFile().profiles.alice.gv).toBe(5);
  });

  it("flush() writes at once, ahead of the window, and leaves no timer behind", async () => {
    fakeTimers();
    const store = open(file);
    store.claim("alice");
    expect(vi.getTimerCount()).toBe(1);
    await store.flush();
    expect(readFile().profiles.alice.name).toBe("alice");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("the window's timer is not unref'd, so a pending write keeps the process alive until it is made", () => {
    const unref = fakeTimers();
    open(file).claim("alice");
    expect(vi.getTimerCount()).toBe(1);
    expect(unref).toEqual([]);
  });

  it("a purchase is in memory the moment it is acknowledged, and on disk by the end of the window", async () => {
    fakeTimers();
    const store = open(file);
    const { token } = store.claim("alice");
    store.bankGv("alice", 200);
    await vi.advanceTimersByTimeAsync(WRITE_WINDOW);
    await store.flush();

    const bought = store.purchase("alice", token, "trail-ember");
    expect(bought.ok).toBe(true);
    expect(store.get("alice")!.cosmetics.owned).toContain("trail-ember");
    expect(readFile().profiles.alice.cosmetics.owned).not.toContain("trail-ember");
    await vi.advanceTimersByTimeAsync(WRITE_WINDOW);
    await waitReal(() => readFile().profiles.alice.cosmetics.owned.includes("trail-ember"), "the purchase to be written");
  });
});

describe("the profile file lock", () => {
  const lockPath = () => `${file}.lock`;
  const holder = () => fs.readFileSync(lockPath(), "utf8").trim();
  /** The id of a process that has already exited. */
  const deadPid = (): number => spawnSync(process.execPath, ["-e", ""]).pid;

  it("is taken at construction and names this process", () => {
    open(file);
    expect(holder()).toBe(String(process.pid));
  });

  it("a second store on the same file refuses to start, and the first keeps working", async () => {
    const first = open(file);
    first.claim("alice");
    expect(() => new JsonProfileStore(file)).toThrow(ProfileLockedError);
    expect(() => new JsonProfileStore(file)).toThrow(new RegExp(`process ${process.pid}, which is still running`));
    expect(holder()).toBe(String(process.pid));
    await first.flush();
    expect(readFile().profiles.alice.name).toBe("alice");
  });

  it("refuses to start while another live process holds the lock, and leaves its lock alone", () => {
    fs.writeFileSync(lockPath(), `${process.ppid}\n`); // the parent of the test run is running
    expect(() => new JsonProfileStore(file)).toThrow(ProfileLockedError);
    expect(holder()).toBe(String(process.ppid));
    expect(fs.existsSync(file)).toBe(false);
  });

  it("takes over a stale lock, one whose process is gone, and loads the file as usual", () => {
    const { log } = quiet();
    const pid = deadPid();
    fs.writeFileSync(lockPath(), `${pid}\n`);
    fs.writeFileSync(file, v2({ alice: goodProfile }));
    const store = new JsonProfileStore(file);
    stores.push(store);
    expect(holder()).toBe(String(process.pid));
    expect(store.get("alice")).toEqual(goodProfile);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`took over the lock of process ${pid}`));
  });

  it.each([["empty", ""], ["not a number", "garbage"], ["zero", "0"], ["negative", "-5"], ["a number with junk after it", "123abc"]])(
    "a lock that names no process (%s) is not guessed at: the start is refused and the lock stays",
    (_label, text) => {
      fs.writeFileSync(lockPath(), text);
      expect(() => new JsonProfileStore(file)).toThrow(ProfileLockedError);
      expect(() => new JsonProfileStore(file)).toThrow(/holds no process id/);
      expect(fs.readFileSync(lockPath(), "utf8")).toBe(text);
    },
  );

  it("a store that fails to start does not keep the file locked", () => {
    fs.writeFileSync(file, "{broken");
    expect(() => new JsonProfileStore(file)).toThrow(ProfileFileError);
    expect(fs.existsSync(lockPath())).toBe(false);
  });

  it("close() writes what is pending without waiting for the window, then frees the file for the next store", async () => {
    fakeTimers();
    const store = open(file);
    store.claim("alice");
    await store.close();
    expect(vi.getTimerCount()).toBe(0);
    expect(fs.existsSync(lockPath())).toBe(false);
    expect(readFile().profiles.alice.name).toBe("alice");

    const next = new JsonProfileStore(file);
    expect(next.get("alice")?.name).toBe("alice");
    expect(holder()).toBe(String(process.pid));
    await next.close();
    expect(fs.existsSync(lockPath())).toBe(false);
  });

  it("a closed store writes nothing more, and closing twice is harmless", async () => {
    fakeTimers();
    const store = open(file);
    store.claim("alice");
    await store.close();
    const rename = vi.spyOn(fs.promises, "rename");
    store.bankGv("alice", 5);
    await vi.advanceTimersByTimeAsync(WRITE_WINDOW * 2);
    await store.flush();
    await store.close();
    expect(rename).not.toHaveBeenCalled();
    expect(readFile().profiles.alice.gv).toBe(0);
  });

  it("close() lets go of the lock even when the final write fails, and says so", async () => {
    quiet();
    fakeTimers();
    vi.spyOn(fs.promises, "rename").mockRejectedValue(new Error("disk full"));
    const store = open(file);
    store.claim("alice");
    await expect(store.close()).rejects.toThrow("disk full");
    expect(fs.existsSync(lockPath())).toBe(false);
    expect(vi.getTimerCount()).toBe(0); // no retry is left to write without the lock
  });

  it("never removes a lock that has since passed to another process", async () => {
    const store = open(file);
    fs.writeFileSync(lockPath(), `${process.ppid}\n`);
    await store.close();
    expect(holder()).toBe(String(process.ppid));
  });

  it("is gone after a process exits without calling close(), a failed listen for one", () => {
    const module = fileURLToPath(new URL("../src/persistence/ProfileStore.ts", import.meta.url));
    const script = [
      `import fs from "node:fs";`,
      `import { JsonProfileStore } from ${JSON.stringify(module)};`,
      `new JsonProfileStore(${JSON.stringify(file)});`,
      `console.log(fs.existsSync(${JSON.stringify(lockPath())}) ? "held" : "never held");`,
      `process.exit(1);`,
    ].join("\n");
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: path.dirname(path.dirname(module)), encoding: "utf8",
    });
    expect(child.stdout.trim(), child.stderr).toBe("held");
    expect(child.status).toBe(1);
    expect(fs.existsSync(lockPath())).toBe(false);
  });
});
