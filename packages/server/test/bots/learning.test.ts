import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBotStatsStore, NO_BIAS, type BotStatsFs } from "../../src/bots/learning/BotStatsStore";
import { LEARN, type ChoiceKey, type PersonaId, type RunSummary, type TierId } from "../../src/bots/brain/types";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-stats-"));
  file = path.join(dir, "bot-stats.json");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const K = (s: string): ChoiceKey => s as ChoiceKey;

interface RunOpts {
  tier?: TierId;
  persona?: PersonaId;
  place?: number;
  players?: number;
  choices?: readonly string[];
  outcome?: RunSummary["outcome"];
}

function run(o: RunOpts = {}): RunSummary {
  const place = o.place ?? 1;
  return {
    tier: o.tier ?? "normal",
    persona: o.persona ?? "hunter",
    faction: "fire",
    outcome: o.outcome ?? (place === 1 ? "won" : "died"),
    place,
    players: o.players ?? 6,
    choices: (o.choices ?? ["faction|hunter|fire"]).map(K),
  };
}

interface FileBody {
  version: number;
  updatedAt: number;
  baseline: Record<TierId, { n: number; s: number }>;
  entries: Record<string, { n: number; s: number }>;
}

const readBody = (f = file): FileBody => JSON.parse(fs.readFileSync(f, "utf8")) as FileBody;

/** The real fs with counters on the write path and optional failure injection. */
function spyFs(fail: Partial<Record<keyof BotStatsFs, () => boolean>> = {}) {
  const real: Pick<BotStatsFs, "writeSynced" | "rename" | "remove" | "syncDir" | "mkdirp"> = {
    writeSynced(f, text) {
      const fd = fs.openSync(f, "w");
      try {
        fs.writeFileSync(fd, text, "utf8");
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    },
    rename: (a, b) => fs.renameSync(a, b),
    remove: (f) => fs.rmSync(f, { force: true }),
    syncDir: () => undefined,
    mkdirp: (d) => fs.mkdirSync(d, { recursive: true }),
  };
  const calls = { writes: 0, renames: 0, removes: 0 };
  const wrap = <T extends keyof typeof real>(name: T, count?: keyof typeof calls): (typeof real)[T] =>
    ((...args: unknown[]) => {
      if (count !== undefined) calls[count]++;
      if (fail[name]?.()) throw new Error(`injected failure in ${name}`);
      return (real[name] as (...a: unknown[]) => unknown)(...args);
    }) as (typeof real)[T];
  const io: Partial<BotStatsFs> = {
    writeSynced: wrap("writeSynced", "writes"),
    rename: wrap("rename", "renames"),
    remove: wrap("remove", "removes"),
    syncDir: wrap("syncDir"),
    mkdirp: wrap("mkdirp"),
  };
  return { io, calls };
}

/** A clock the test moves by hand. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, set: (v: number) => (t = v), advance: (d: number) => (t += d) };
}

describe("snapshot and record", () => {
  it("round-trips through a file: a new store reads the same biases and the file has the documented shape", () => {
    const c = clock();
    const store = createBotStatsStore(file, { now: c.now });
    for (let i = 0; i < 5; i++) {
      store.record(run({ place: 1, choices: ["faction|hunter|fire", "second|fire|bow"] }));
      store.record(run({ place: 6, choices: ["faction|hunter|frost"] }));
    }
    store.flush();

    const body = readBody();
    expect(Object.keys(body)).toEqual(["version", "updatedAt", "baseline", "entries"]);
    expect(body.version).toBe(LEARN.version);
    expect(body.updatedAt).toBe(c.now());
    expect(Object.keys(body.baseline).sort()).toEqual(["easy", "hard", "normal"]);
    expect(Object.keys(body.entries).sort()).toEqual(["faction|hunter|fire", "faction|hunter|frost", "second|fire|bow"]);
    expect(body.entries["faction|hunter|fire"]!.n).toBeGreaterThan(4.9);

    const first = store.snapshot();
    const reloaded = createBotStatsStore(file, { now: c.now }).snapshot();
    for (const key of Object.keys(body.entries)) expect(reloaded.bias(K(key))).toBe(first.bias(K(key)));
    expect(first.bias(K("faction|hunter|fire"))).toBeGreaterThan(0);
    expect(first.bias(K("faction|hunter|frost"))).toBeLessThan(0);
  });

  it("answers 0 for an unknown key and reports enabled", () => {
    const snap = createBotStatsStore(null).snapshot();
    expect(snap.enabled).toBe(true);
    expect(snap.bias(K("faction|hunter|holy"))).toBe(0);
    expect(NO_BIAS.enabled).toBe(false);
    expect(NO_BIAS.bias(K("faction|hunter|holy"))).toBe(0);
  });

  it("hands out a frozen snapshot that later records do not change", () => {
    const store = createBotStatsStore(null);
    store.record(run({ place: 1, choices: ["faction|hunter|fire"] }));
    store.record(run({ place: 6, choices: ["faction|hunter|frost"] }));
    const before = store.snapshot();
    const fire = before.bias(K("faction|hunter|fire"));
    expect(Object.isFrozen(before)).toBe(true);
    for (let i = 0; i < 30; i++) store.record(run({ place: 6, choices: ["faction|hunter|fire"] }));
    expect(before.bias(K("faction|hunter|fire"))).toBe(fire);
    expect(store.snapshot().bias(K("faction|hunter|fire"))).toBeLessThan(fire);
    expect(store.snapshot()).toBe(store.snapshot());
  });

  it("scores a run as (players - place) / (players - 1) into its tier's baseline", () => {
    const store = createBotStatsStore(file, { now: clock().now });
    store.record(run({ tier: "hard", place: 2, players: 5 }));
    store.flush();
    expect(readBody().baseline.hard.n).toBe(1);
    expect(readBody().baseline.hard.s).toBeCloseTo(0.75, 12);
    expect(readBody().baseline.easy).toEqual({ n: 0, s: 0 });
  });

  it("records the residual against the tier's own baseline", () => {
    const store = createBotStatsStore(file, { now: clock().now });
    store.record(run({ place: 1, choices: ["faction|hunter|fire"] }));
    store.record(run({ place: 6, choices: ["faction|hunter|frost"] }));
    store.flush();
    const { baseline, entries } = readBody();
    const mean = baseline.normal.s / baseline.normal.n;
    expect(mean).toBeCloseTo(0.99 / 1.99, 12);
    // The very first run of a tier says nothing (it is its own baseline); the second is judged against the mean.
    expect(entries["faction|hunter|fire"]).toEqual({ n: 1, s: 0.5 });
    expect(entries["faction|hunter|frost"]!.s).toBeCloseTo(Math.max(0, 0.5 + 0 - mean), 12);
  });

  it("counts a draw as place 1, whatever place the summary says", () => {
    const a = createBotStatsStore(file, { now: clock().now });
    a.record(run({ place: 3, outcome: "draw", choices: ["faction|hunter|fire"] }));
    a.record(run({ place: 6, choices: ["faction|hunter|frost"] }));
    a.flush();
    const drawn = readBody();

    const f2 = path.join(dir, "second.json");
    const b = createBotStatsStore(f2, { now: clock().now });
    b.record(run({ place: 1, outcome: "won", choices: ["faction|hunter|fire"] }));
    b.record(run({ place: 6, choices: ["faction|hunter|frost"] }));
    b.flush();
    expect(drawn.entries).toEqual(readBody(f2).entries);
    expect(drawn.baseline).toEqual(readBody(f2).baseline);
  });

  it("counts a key once per run even when it is listed twice", () => {
    const store = createBotStatsStore(file, { now: clock().now });
    store.record(run({ choices: ["faction|hunter|fire", "faction|hunter|fire"] }));
    store.flush();
    expect(readBody().entries["faction|hunter|fire"]!.n).toBe(1);
  });

  it("ignores keys that are not domain|context|option", () => {
    const store = createBotStatsStore(file, { now: clock().now });
    store.record(run({ choices: ["nonsense", "faction|hunter", "bogus|a|b", "faction||fire", "faction|hunter|fire"] }));
    store.flush();
    expect(Object.keys(readBody().entries)).toEqual(["faction|hunter|fire"]);
  });

  it("records nothing for a void run or a run with nobody to beat", () => {
    const store = createBotStatsStore(file, { now: clock().now });
    store.record(run({ outcome: "void", place: 1 }));
    store.record(run({ players: 1, place: 1 }));
    store.record(run({ players: 0, place: 1 }));
    store.flush();
    expect(fs.existsSync(file)).toBe(false);
    expect(store.snapshot().bias(K("faction|hunter|fire"))).toBe(0);

    store.record(run({ place: 1 }));
    store.record(run({ outcome: "void", place: 6, choices: ["faction|hunter|frost"] }));
    store.flush();
    expect(Object.keys(readBody().entries)).toEqual(["faction|hunter|fire"]);
    expect(readBody().baseline.normal.n).toBe(1);
  });

  it("works in memory when the file is null", () => {
    const writes = spyFs();
    const store = createBotStatsStore(null, { fs: writes.io, now: clock().now });
    for (let i = 0; i < 40; i++) {
      store.record(run({ place: 1, choices: ["faction|hunter|fire"] }));
      store.record(run({ place: 6, choices: ["faction|hunter|frost"] }));
    }
    store.flush();
    store.close();
    expect(writes.calls).toEqual({ writes: 0, renames: 0, removes: 0 });
    expect(store.snapshot().bias(K("faction|hunter|fire"))).toBeGreaterThan(0.1);
  });
});

describe("what it learns", () => {
  it("bounds the bias at the cap after 1000 identical wins", () => {
    const store = createBotStatsStore(null);
    for (let i = 0; i < 1000; i++) {
      store.record(run({ place: 1, choices: ["faction|hunter|fire"] }));
      store.record(run({ place: 6, choices: ["faction|hunter|frost"] }));
    }
    const snap = store.snapshot();
    expect(snap.bias(K("faction|hunter|fire"))).toBe(LEARN.cap);
    expect(snap.bias(K("faction|hunter|frost"))).toBe(-LEARN.cap);
  });

  it("is not moved much by a single run (the prior is worth LEARN.strength runs)", () => {
    const store = createBotStatsStore(null);
    store.record(run({ place: 1, choices: ["faction|hunter|fire"] }));
    store.record(run({ place: 6, choices: ["faction|hunter|frost"] }));
    const snap = store.snapshot();
    expect(Math.abs(snap.bias(K("faction|hunter|fire")))).toBeLessThan(0.07);
    expect(Math.abs(snap.bias(K("faction|hunter|frost")))).toBeLessThan(0.07);
  });

  it("decays a key's n and sum by LEARN.decay per update, a half-life of about 69", () => {
    expect(LEARN.decay ** 69).toBeCloseTo(0.5, 2);
    const c = clock();
    const store = createBotStatsStore(file, { now: c.now });
    // One tier, one place: the baseline equals every score, so each residual is exactly 0.5.
    for (let i = 0; i < 69; i++) store.record(run({ place: 2, choices: ["faction|hunter|fire"] }));
    store.flush();
    const n69 = readBody().entries["faction|hunter|fire"]!;
    expect(n69.n).toBeCloseTo((1 - LEARN.decay ** 69) / (1 - LEARN.decay), 9);
    expect(n69.s).toBeCloseTo(0.5 * n69.n, 9);
    store.record(run({ place: 2, choices: ["faction|hunter|fire"] }));
    store.flush();
    const n70 = readBody().entries["faction|hunter|fire"]!;
    // Adding one update leaves the first update's weight at LEARN.decay ** 69 of its original, about half.
    expect(n70.n - n69.n).toBeCloseTo(LEARN.decay ** 69, 9);
    expect(n70.n).toBeCloseTo(LEARN.decay * n69.n + 1, 12);
  });

  it("follows a change: what happened lately outweighs what happened long ago", () => {
    const store = createBotStatsStore(null);
    for (let i = 0; i < 200; i++) {
      store.record(run({ place: 1, choices: ["faction|hunter|fire"] }));
      store.record(run({ place: 6, choices: ["faction|hunter|frost"] }));
    }
    expect(store.snapshot().bias(K("faction|hunter|fire"))).toBeGreaterThan(0.2);
    for (let i = 0; i < 300; i++) {
      store.record(run({ place: 6, choices: ["faction|hunter|fire"] }));
      store.record(run({ place: 1, choices: ["faction|hunter|frost"] }));
    }
    const snap = store.snapshot();
    expect(snap.bias(K("faction|hunter|fire"))).toBeLessThan(-0.2);
    expect(snap.bias(K("faction|hunter|frost"))).toBeGreaterThan(0.2);
  });

  it("removes the confound: a key only Hard bots pick, and Hard always places well, stays near 0", () => {
    const store = createBotStatsStore(null);
    for (let i = 0; i < 300; i++) {
      store.record(run({ tier: "hard", place: 1, choices: ["faction|hunter|fire"] }));
      store.record(run({ tier: "easy", place: 6, choices: ["faction|hunter|frost"] }));
      store.record(run({ tier: "normal", place: 3, choices: ["faction|hunter|holy"] }));
    }
    const snap = store.snapshot();
    expect(Math.abs(snap.bias(K("faction|hunter|fire")))).toBeLessThan(0.01);
    expect(Math.abs(snap.bias(K("faction|hunter|frost")))).toBeLessThan(0.01);
    expect(Math.abs(snap.bias(K("faction|hunter|holy")))).toBeLessThan(0.01);
  });

  it("still sees a real edge inside one tier", () => {
    const store = createBotStatsStore(null);
    for (let i = 0; i < 100; i++) {
      store.record(run({ tier: "hard", place: 1, choices: ["second|fire|bow"] }));
      store.record(run({ tier: "hard", place: 6, choices: ["second|fire|axe"] }));
      store.record(run({ tier: "easy", place: 6, choices: ["second|fire|axe"] }));
    }
    const snap = store.snapshot();
    expect(snap.bias(K("second|fire|bow"))).toBeGreaterThan(0.15);
    expect(snap.bias(K("second|fire|axe"))).toBeLessThan(-0.05);
  });

  it("caps the entries and drops the smallest n, never the key this run just touched", () => {
    const c = clock();
    const store = createBotStatsStore(file, { now: c.now });
    for (let i = 0; i < 5; i++) store.record(run({ choices: ["faction|hunter|fire"] }));
    for (let i = 0; i < LEARN.maxEntries + 100; i++) store.record(run({ choices: [`camp|fire|mob${i}`] }));
    store.flush();
    const entries = readBody().entries;
    expect(Object.keys(entries)).toHaveLength(LEARN.maxEntries);
    expect(entries["faction|hunter|fire"]).toBeDefined();
    expect(entries[`camp|fire|mob${LEARN.maxEntries + 99}`]).toBeDefined();
    expect(entries["camp|fire|mob0"]).toBeUndefined();
    expect(store.snapshot().bias(K("camp|fire|mob0"))).toBe(0);
  });

  it("trims an oversized file it loads", () => {
    const entries: Record<string, { n: number; s: number }> = {};
    for (let i = 0; i < LEARN.maxEntries + 50; i++) entries[`camp|fire|mob${i}`] = { n: 1 + (i % 7), s: 0.5 * (1 + (i % 7)) };
    fs.writeFileSync(file, JSON.stringify({ version: LEARN.version, updatedAt: 1, baseline: {}, entries }));
    const store = createBotStatsStore(file, { now: clock().now });
    store.record(run({ choices: ["faction|hunter|fire"] }));
    store.flush();
    expect(Object.keys(readBody().entries)).toHaveLength(LEARN.maxEntries);
  });
});

describe("the file", () => {
  it("starts empty without a file and creates its directory on the first write", () => {
    const nested = path.join(dir, "a", "b", "stats.json");
    const store = createBotStatsStore(nested, { now: clock().now });
    expect(store.snapshot().bias(K("faction|hunter|fire"))).toBe(0);
    expect(fs.existsSync(path.dirname(nested))).toBe(false);
    store.record(run());
    expect(readBody(nested).version).toBe(LEARN.version);
  });

  it("moves an unparsable file aside to <file>.bad-<timestamp> and starts empty, logging once", () => {
    fs.writeFileSync(file, "{ this is not json");
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = createBotStatsStore(file, { now: () => 4242 });
    expect(err).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readFileSync(`${file}.bad-4242`, "utf8")).toBe("{ this is not json");
    expect(store.snapshot().bias(K("faction|hunter|fire"))).toBe(0);

    store.record(run({ place: 1, choices: ["faction|hunter|fire"] }));
    store.flush();
    expect(readBody().entries["faction|hunter|fire"]).toBeDefined();
    expect(fs.readFileSync(`${file}.bad-4242`, "utf8")).toBe("{ this is not json");
    expect(err).toHaveBeenCalledTimes(1);
  });

  it("moves aside an empty file and a file of the wrong shape", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const [i, text] of ["", "[]", "42", JSON.stringify({ version: 1, baseline: {}, entries: [] }), JSON.stringify({ version: 1 })].entries()) {
      const f = path.join(dir, `shape${i}.json`);
      fs.writeFileSync(f, text);
      const store = createBotStatsStore(f, { now: () => 7 });
      expect(fs.existsSync(f), text).toBe(false);
      expect(fs.readFileSync(`${f}.bad-7`, "utf8")).toBe(text);
      expect(store.snapshot().bias(K("faction|hunter|fire"))).toBe(0);
    }
  });

  it("moves aside a file with another version instead of reading it", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const old = JSON.stringify({ version: 2, updatedAt: 1, baseline: {}, entries: { "faction|hunter|fire": { n: 50, s: 50 } } });
    fs.writeFileSync(file, old);
    const store = createBotStatsStore(file, { now: () => 99 });
    expect(err).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(`${file}.bad-99`, "utf8")).toBe(old);
    expect(store.snapshot().bias(K("faction|hunter|fire"))).toBe(0);
  });

  it("keeps the good rows when one row is damaged", () => {
    const body = {
      version: LEARN.version, updatedAt: 1, baseline: {},
      entries: {
        "faction|hunter|fire": { n: 20, s: 18 },
        "faction|hunter|frost": { n: "lots", s: 3 },
        "faction|hunter|holy": { n: 1, s: 5 },
        "garbage": { n: 1, s: 1 },
      },
    };
    fs.writeFileSync(file, JSON.stringify(body));
    const store = createBotStatsStore(file, { now: clock().now });
    const snap = store.snapshot();
    expect(snap.bias(K("faction|hunter|fire"))).toBeGreaterThan(0.2);
    expect(snap.bias(K("faction|hunter|frost"))).toBe(0);
    expect(snap.bias(K("faction|hunter|holy"))).toBe(0);
    expect(fs.existsSync(`${file}.bad-${clock().now()}`)).toBe(false);
  });

  it("refuses the profile file and its lock file", () => {
    const stash = path.join(dir, "stash.json");
    expect(() => createBotStatsStore(stash, { forbid: [stash] })).toThrow(/profile store/);
    expect(() => createBotStatsStore(`${stash}.lock`, { forbid: [stash] })).toThrow();
    expect(() => createBotStatsStore(path.join(dir, ".", "x", "..", "stash.json"), { forbid: [stash] })).toThrow();
    expect(() => createBotStatsStore(stash, { forbid: [path.join(dir, "other.json"), stash] })).toThrow();
    expect(fs.existsSync(stash)).toBe(false);
    expect(fs.existsSync(`${stash}.lock`)).toBe(false);
    expect(() => createBotStatsStore(path.join(dir, "bot-stats.json"), { forbid: [stash] })).not.toThrow();
  });

  it("never writes, not even a directory, when its file is forbidden", () => {
    const stash = path.join(dir, "deeper", "stash.json");
    expect(() => createBotStatsStore(stash, { forbid: [stash] })).toThrow();
    expect(fs.existsSync(path.dirname(stash))).toBe(false);
  });
});

describe("writes", () => {
  it("coalesces: at most one write per LEARN.writeEveryMs, and flush() and close() write at once", () => {
    const c = clock();
    const spy = spyFs();
    const store = createBotStatsStore(file, { now: c.now, fs: spy.io });
    store.record(run({ place: 1, choices: ["faction|hunter|fire"] }));
    expect(spy.calls.renames).toBe(1);

    for (let i = 0; i < 20; i++) {
      c.advance(400);
      store.record(run({ place: 1, choices: ["faction|hunter|fire"] }));
    }
    expect(c.now() - 1_000_000).toBeLessThan(LEARN.writeEveryMs);
    expect(spy.calls.renames).toBe(1);
    expect(readBody().entries["faction|hunter|fire"]!.n).toBeLessThan(2);

    c.advance(LEARN.writeEveryMs);
    store.record(run({ place: 1, choices: ["faction|hunter|fire"] }));
    expect(spy.calls.renames).toBe(2);
    expect(readBody().entries["faction|hunter|fire"]!.n).toBeGreaterThan(19);

    c.advance(10);
    store.record(run({ place: 6, choices: ["faction|hunter|frost"] }));
    expect(spy.calls.renames).toBe(2);
    store.flush();
    expect(spy.calls.renames).toBe(3);
    expect(readBody().entries["faction|hunter|frost"]).toBeDefined();
    store.flush();
    expect(spy.calls.renames).toBe(3);

    c.advance(1);
    store.record(run({ place: 6, choices: ["faction|hunter|frost"] }));
    store.close();
    expect(spy.calls.renames).toBe(4);
    expect(readBody().entries["faction|hunter|frost"]!.n).toBeGreaterThan(1.9);
  });

  it("writes nothing after close()", () => {
    const spy = spyFs();
    const c = clock();
    const store = createBotStatsStore(file, { now: c.now, fs: spy.io });
    store.record(run());
    store.close();
    store.close();
    const writes = spy.calls.renames;
    c.advance(LEARN.writeEveryMs * 3);
    store.record(run());
    store.flush();
    expect(spy.calls.renames).toBe(writes);
  });

  it("is not held off for long by a clock that went backwards", () => {
    const c = clock();
    const spy = spyFs();
    const store = createBotStatsStore(file, { now: c.now, fs: spy.io });
    store.record(run());
    c.advance(-60_000);
    store.record(run());
    expect(spy.calls.renames).toBe(2);
  });

  it("writes atomically: a failed rename leaves the old file whole and no temp file behind", () => {
    const c = clock();
    let failRename = false;
    const spy = spyFs({ rename: () => failRename });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = createBotStatsStore(file, { now: c.now, fs: spy.io });
    store.record(run({ place: 1, choices: ["faction|hunter|fire"] }));
    const good = fs.readFileSync(file, "utf8");

    failRename = true;
    c.advance(LEARN.writeEveryMs);
    expect(() => store.record(run({ place: 6, choices: ["faction|hunter|frost"] }))).not.toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe(good);
    expect(readBody().entries["faction|hunter|frost"]).toBeUndefined();
    expect(fs.readdirSync(dir)).toEqual(["bot-stats.json"]);
  });

  it("survives a crash between the temp write and the rename: the target is the old file and a new store reads it", () => {
    const c = clock();
    // The process dies after the temp file is written: the rename throws and nothing gets to clean up.
    let crashed = false;
    const spy = spyFs({ rename: () => crashed, remove: () => crashed });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = createBotStatsStore(file, { now: c.now, fs: spy.io });
    store.record(run({ place: 1, choices: ["faction|hunter|fire"] }));
    const good = fs.readFileSync(file, "utf8");

    crashed = true;
    c.advance(LEARN.writeEveryMs);
    store.record(run({ place: 6, choices: ["faction|hunter|frost"] }));
    const leftovers = fs.readdirSync(dir).filter((f) => f !== "bot-stats.json");
    expect(leftovers).toHaveLength(1);
    expect(leftovers[0]).toMatch(/^bot-stats\.json\.tmp-/);
    expect(fs.readFileSync(file, "utf8")).toBe(good);

    const reborn = createBotStatsStore(file, { now: c.now });
    expect(reborn.snapshot().bias(K("faction|hunter|frost"))).toBe(0);
    expect(Object.keys(readBody().entries)).toEqual(["faction|hunter|fire"]);
    // The next write replaces the stray temp file and the data catches up.
    reborn.record(run({ place: 6, choices: ["faction|hunter|frost"] }));
    reborn.flush();
    expect(Object.keys(readBody().entries).sort()).toEqual(["faction|hunter|fire", "faction|hunter|frost"]);
  });

  it("never leaves a partial file as the target when the temp write itself fails", () => {
    const c = clock();
    let failWrite = false;
    const spy = spyFs({ writeSynced: () => failWrite });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = createBotStatsStore(file, { now: c.now, fs: spy.io });
    store.record(run());
    const good = fs.readFileSync(file, "utf8");
    failWrite = true;
    c.advance(LEARN.writeEveryMs);
    store.record(run({ choices: ["faction|hunter|frost"] }));
    expect(fs.readFileSync(file, "utf8")).toBe(good);
  });

  it("keeps the data after a failed write and writes it at the next due record or flush", () => {
    const c = clock();
    let fail = false;
    const spy = spyFs({ rename: () => fail });
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = createBotStatsStore(file, { now: c.now, fs: spy.io });
    fail = true;
    store.record(run({ place: 1, choices: ["faction|hunter|fire"] }));
    expect(err).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(file)).toBe(false);

    // Inside the window nothing is retried (so a dead disk is not hammered or logged on every record).
    c.advance(100);
    store.record(run({ place: 1, choices: ["faction|hunter|fire"] }));
    expect(spy.calls.renames).toBe(1);
    expect(err).toHaveBeenCalledTimes(1);

    fail = false;
    c.advance(LEARN.writeEveryMs);
    store.record(run({ place: 1, choices: ["faction|hunter|fire"] }));
    expect(readBody().entries["faction|hunter|fire"]!.n).toBeGreaterThan(2.9);
  });

  it("flush() after a failed write tries again at once, and close() never throws", () => {
    let fail = true;
    const spy = spyFs({ rename: () => fail });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = createBotStatsStore(file, { now: clock().now, fs: spy.io });
    store.record(run());
    expect(fs.existsSync(file)).toBe(false);
    expect(() => store.flush()).not.toThrow();
    fail = false;
    store.flush();
    expect(readBody().version).toBe(LEARN.version);
    fail = true;
    store.record(run());
    expect(() => store.close()).not.toThrow();
  });

  it("does not leave the previous version's data out of the new file", () => {
    const c = clock();
    const store = createBotStatsStore(file, { now: c.now });
    store.record(run({ tier: "hard", place: 1, choices: ["faction|hunter|fire"] }));
    store.flush();
    const second = createBotStatsStore(file, { now: c.now });
    second.record(run({ tier: "easy", place: 6, choices: ["faction|hunter|frost"] }));
    second.flush();
    const body = readBody();
    expect(Object.keys(body.entries).sort()).toEqual(["faction|hunter|fire", "faction|hunter|frost"]);
    expect(body.baseline.hard.n).toBe(1);
    expect(body.baseline.easy.n).toBe(1);
  });
});
