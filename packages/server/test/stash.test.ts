import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STARTER_KIT, type ItemDTO } from "@raid/shared";
import {
  InvalidProfileNameError, JsonStashStore, ProfileForbiddenError, StashFileError, StashItemError, UnknownProfileError,
} from "../src/persistence/StashStore";

const dirs: string[] = [];
const stores: JsonStashStore[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-stash-"));
  dirs.push(dir);
  return dir;
}

function open(file: string): JsonStashStore {
  const store = new JsonStashStore(file);
  stores.push(store);
  return store;
}

let dir: string;
let file: string;

beforeEach(() => {
  dir = tmpDir();
  file = path.join(dir, "stash.json");
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Let any write still in flight finish before the directory goes away.
  await Promise.allSettled(stores.splice(0).map((s) => s.flush()));
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const readFile = (f = file) => JSON.parse(fs.readFileSync(f, "utf8"));
const items = (...defs: string[]): ItemDTO[] => defs.map((def, i) => ({ uid: `${def}-${i}`, def }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

describe("claim", () => {
  it("creates an unknown profile with a token, the starter kit and zeroed stats", () => {
    const store = open(file);
    const { record, token, created } = store.claim("alice");
    expect(created).toBe(true);
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    expect(record.token).toBe(token);
    expect(record.name).toBe("alice");
    expect(record.stash.map((i) => i.def)).toEqual([...STARTER_KIT]);
    expect(new Set(record.stash.map((i) => i.uid)).size).toBe(STARTER_KIT.length);
    expect(record.stats).toEqual({ raids: 0, extracts: 0, deaths: 0, kills: 0 });
  });

  it("gives every profile its own token and its own item uids", () => {
    const store = open(file);
    const a = store.claim("alice");
    const b = store.claim("bobby");
    expect(a.token).not.toBe(b.token);
    const uids = [...a.record.stash, ...b.record.stash].map((i) => i.uid);
    expect(new Set(uids).size).toBe(uids.length);
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
    expect(({} as Record<string, unknown>).stash).toBeUndefined();
    await store.flush();
    const back = open(file);
    for (const n of names) expect(back.get(n)?.name).toBe(n);
    expect(back.get("__proto__")?.token).toBe(store.get("__proto__")?.token);
  });

  it("hands out snapshots: changing a returned record never touches the store", () => {
    const store = open(file);
    const { record } = store.claim("alice");
    record.stash.length = 0;
    record.stats.raids = 99;
    record.token = "hijacked";
    const fresh = store.get("alice")!;
    expect(fresh.stash).toHaveLength(STARTER_KIT.length);
    expect(fresh.stats.raids).toBe(0);
    expect(fresh.token).not.toBe("hijacked");
    fresh.stash.pop();
    expect(store.get("alice")!.stash).toHaveLength(STARTER_KIT.length);
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

describe("withdraw", () => {
  function seeded() {
    const store = open(file);
    store.claim("alice");
    const base = store.get("alice")!.stash.map((i) => i.uid);
    store.withdraw("alice", base);
    store.deposit("alice", items("rifle", "vest", "gold", "medkit"));
    return store;
  }

  it("removes exactly the requested items and returns them in the requested order", () => {
    const store = seeded();
    const got = store.withdraw("alice", ["gold-2", "rifle-0"]);
    expect(got).toEqual([{ uid: "gold-2", def: "gold" }, { uid: "rifle-0", def: "rifle" }]);
    expect(store.get("alice")!.stash).toEqual([{ uid: "vest-1", def: "vest" }, { uid: "medkit-3", def: "medkit" }]);
  });

  it("is all or nothing when a uid is missing", () => {
    const store = seeded();
    const before = store.get("alice")!.stash;
    expect(() => store.withdraw("alice", ["rifle-0", "ghost"])).toThrow(StashItemError);
    expect(store.get("alice")!.stash).toEqual(before);
  });

  it("is all or nothing when a uid is repeated, even if the item exists", () => {
    const store = seeded();
    const before = store.get("alice")!.stash;
    expect(() => store.withdraw("alice", ["rifle-0", "rifle-0"])).toThrow(StashItemError);
    expect(store.get("alice")!.stash).toEqual(before);
  });

  it("refuses non-string uids", () => {
    const store = seeded();
    expect(() => store.withdraw("alice", [42 as unknown as string])).toThrow(StashItemError);
  });

  it("an item can only be withdrawn once", () => {
    const store = seeded();
    store.withdraw("alice", ["rifle-0"]);
    expect(() => store.withdraw("alice", ["rifle-0"])).toThrow(StashItemError);
  });

  it("withdrawing nothing is a no-op", () => {
    const store = seeded();
    const before = store.get("alice")!;
    expect(store.withdraw("alice", [])).toEqual([]);
    expect(store.get("alice")).toEqual(before);
  });

  it("returns copies, so editing them cannot corrupt the store", () => {
    const store = seeded();
    const [rifle] = store.withdraw("alice", ["rifle-0"]);
    rifle!.def = "plate";
    store.deposit("alice", [rifle!]);
    expect(store.get("alice")!.stash.find((i) => i.uid === "rifle-0")?.def).toBe("plate");
    expect(store.get("alice")!.stash.filter((i) => i.uid === "rifle-0")).toHaveLength(1);
  });

  it("throws for an unknown profile", () => {
    expect(() => open(file).withdraw("nobody", [])).toThrow(UnknownProfileError);
  });
});

describe("deposit", () => {
  it("appends items to the stash", () => {
    const store = open(file);
    store.claim("alice");
    store.deposit("alice", items("rifle", "gold"));
    expect(store.get("alice")!.stash.slice(-2)).toEqual(items("rifle", "gold"));
  });

  it("skips a uid that is already stashed, so repeating a deposit cannot duplicate items", () => {
    const store = open(file);
    store.claim("alice");
    const before = store.get("alice")!.stash.length;
    store.deposit("alice", items("rifle"));
    store.deposit("alice", items("rifle"));
    store.deposit("alice", [{ uid: "x1", def: "gold" }, { uid: "x1", def: "gold" }]);
    expect(store.get("alice")!.stash).toHaveLength(before + 2);
  });

  it("stores only uid and def", () => {
    const store = open(file);
    store.claim("alice");
    store.deposit("alice", [{ uid: "u1", def: "gold", extra: "nope" } as ItemDTO]);
    expect(store.get("alice")!.stash.at(-1)).toStrictEqual({ uid: "u1", def: "gold" });
  });

  it("throws for an unknown profile", () => {
    expect(() => open(file).deposit("nobody", items("gold"))).toThrow(UnknownProfileError);
  });

  it("round trips with withdraw", () => {
    const store = open(file);
    store.claim("alice");
    const start = store.get("alice")!.stash;
    const out = store.withdraw("alice", start.map((i) => i.uid));
    expect(store.get("alice")!.stash).toEqual([]);
    store.deposit("alice", out);
    expect(store.get("alice")!.stash).toEqual(start);
  });
});

describe("recordRaid", () => {
  it("counts extracts, deaths and kills; mia is a death", () => {
    const store = open(file);
    store.claim("alice");
    store.recordRaid("alice", "extracted", 2);
    expect(store.get("alice")!.stats).toEqual({ raids: 1, extracts: 1, deaths: 0, kills: 2 });
    store.recordRaid("alice", "died", 1);
    expect(store.get("alice")!.stats).toEqual({ raids: 2, extracts: 1, deaths: 1, kills: 3 });
    store.recordRaid("alice", "mia", 0);
    expect(store.get("alice")!.stats).toEqual({ raids: 3, extracts: 1, deaths: 2, kills: 3 });
  });

  it("ignores nonsense kill counts", () => {
    const store = open(file);
    store.claim("alice");
    store.recordRaid("alice", "died", -4);
    store.recordRaid("alice", "died", Number.NaN);
    store.recordRaid("alice", "died", Infinity);
    store.recordRaid("alice", "died", 1.9);
    expect(store.get("alice")!.stats).toEqual({ raids: 4, extracts: 0, deaths: 4, kills: 1 });
  });

  it("throws for an unknown profile", () => {
    expect(() => open(file).recordRaid("nobody", "died", 0)).toThrow(UnknownProfileError);
  });
});

describe("persistence", () => {
  it("writes the documented file format on flush and leaves no temp file behind", async () => {
    const store = open(file);
    const { token, record } = store.claim("alice");
    await store.flush();
    expect(readFile()).toEqual({ version: 1, profiles: { alice: { name: "alice", token, stash: record.stash, stats: record.stats } } });
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    expect(fs.readdirSync(dir)).toEqual(["stash.json"]);
  });

  it("reloads every field from disk", async () => {
    const store = open(file);
    const a = store.claim("alice");
    const b = store.claim("bobby");
    store.withdraw("alice", [a.record.stash[0]!.uid]);
    store.deposit("alice", items("rifle"));
    store.recordRaid("alice", "extracted", 3);
    store.recordRaid("bobby", "mia", 0);
    await store.flush();

    const back = open(file);
    expect(back.get("alice")).toEqual(store.get("alice"));
    expect(back.get("bobby")).toEqual(store.get("bobby"));
    expect(back.claim("alice", a.token).created).toBe(false);
    expect(back.claim("bobby", b.token).created).toBe(false);
    expect(() => back.claim("alice", b.token)).toThrow(ProfileForbiddenError);
  });

  it("keeps working after a reload: later changes persist too", async () => {
    const first = open(file);
    const { token } = first.claim("alice");
    await first.flush();
    const second = open(file);
    second.deposit("alice", items("gold"));
    await second.flush();
    const third = open(file);
    expect(third.get("alice")!.stash.at(-1)).toEqual({ uid: "gold-0", def: "gold" });
    expect(third.verifyToken("alice", token)).toBe(true);
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
    store.deposit("alice", items("gold"));
    await store.flush();
    expect(open_).toHaveBeenCalledWith(`${file}.tmp`, "w");
    expect(rename).toHaveBeenCalledWith(`${file}.tmp`, file);
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
    store.deposit("alice", items("gold")); // lands while the first write is in flight
    await flushing;
    expect(readFile().profiles.alice.stash.at(-1)).toEqual({ uid: "gold-0", def: "gold" });
  });

  it("a change made right after a flush is written without another flush call", async () => {
    const store = open(file);
    store.claim("alice");
    await store.flush();
    store.deposit("alice", items("gold"));
    await vi.waitFor(() => expect(readFile().profiles.alice.stash.at(-1)).toEqual({ uid: "gold-0", def: "gold" }));
  });
});

const zeroStats = { raids: 0, extracts: 0, deaths: 0, kills: 0 };
const goodProfile = {
  name: "alice", token: "t-alice", stash: [{ uid: "u1", def: "gold" }, { uid: "u2", def: "medkit" }],
  stats: { raids: 2, extracts: 1, deaths: 1, kills: 3 },
};
const v1 = (profiles: unknown) => JSON.stringify({ version: 1, profiles });
const withSuffix = (d: string, suffix: string) => fs.readdirSync(d).filter((n) => n.startsWith(`stash.json.${suffix}-`));

describe("an unusable stash file stops the server instead of wiping every profile", () => {
  it("moves an unparsable file aside, untouched, and refuses to start", () => {
    const text = '{"version":1,"profiles":{"alice":';
    fs.writeFileSync(file, text);
    let error: unknown;
    try {
      new JsonStashStore(file);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(StashFileError);
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
    ["a version this code does not know", JSON.stringify({ version: 2, profiles: {} })],
    ["a version that is a string", JSON.stringify({ version: "1", profiles: {} })],
    ["no version", JSON.stringify({ profiles: {} })],
    ["no profiles object", JSON.stringify({ version: 1 })],
    ["profiles that is a list", JSON.stringify({ version: 1, profiles: [] })],
  ])("%s: refuses to start and keeps the file for the operator", (_label, text) => {
    fs.writeFileSync(file, text);
    expect(() => new JsonStashStore(file)).toThrow(StashFileError);
    expect(withSuffix(dir, "corrupt")).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, withSuffix(dir, "corrupt")[0]!), "utf8")).toBe(text);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("names the version it found, so a downgrade is easy to spot", () => {
    fs.writeFileSync(file, JSON.stringify({ version: 7, profiles: {} }));
    expect(() => new JsonStashStore(file)).toThrow(/unsupported version 7, expected 1/);
  });

  it("the server stays down until the file is put back; then it starts with every profile", async () => {
    const first = open(file);
    first.claim("alice");
    await first.flush();
    const backup = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, "{broken");
    expect(() => new JsonStashStore(file)).toThrow(StashFileError);
    expect(() => new JsonStashStore(file)).not.toThrow(); // nothing left at the path: a fresh, empty start

    fs.writeFileSync(file, backup); // the operator restores a copy
    expect(open(file).get("alice")?.name).toBe("alice");
  });

  it("if the file cannot be moved aside it is left in place and the error says so", () => {
    fs.writeFileSync(file, "{broken");
    vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("read-only filesystem"); });
    expect(() => new JsonStashStore(file)).toThrow(/could not be moved aside \(read-only filesystem\)/);
    expect(fs.readFileSync(file, "utf8")).toBe("{broken");
  });

  it("an unreadable path (a directory where the file should be) is an error too, not an empty stash", () => {
    fs.mkdirSync(file);
    expect(() => new JsonStashStore(file)).toThrow();
  });
});

describe("a v1 file with some malformed profile entries", () => {
  const damaged: Array<[string, string, unknown]> = [
    ["a name that does not match its key", "bobby", { ...goodProfile, name: "someone-else", token: "t-bobby" }],
    ["an invalid profile name", "a b", { ...goodProfile, name: "a b", token: "t-ab" }],
    ["a missing token", "bobby", { ...goodProfile, name: "bobby", token: undefined }],
    ["an empty token", "bobby", { ...goodProfile, name: "bobby", token: "" }],
    ["negative stats", "bobby", { ...goodProfile, name: "bobby", token: "t-bobby", stats: { ...zeroStats, raids: -1 } }],
    ["fractional stats", "bobby", { ...goodProfile, name: "bobby", token: "t-bobby", stats: { ...zeroStats, kills: 1.5 } }],
    ["missing stats", "bobby", { ...goodProfile, name: "bobby", token: "t-bobby", stats: undefined }],
    ["a stash that is not a list", "bobby", { ...goodProfile, name: "bobby", token: "t-bobby", stash: {} }],
    ["a malformed stash item", "bobby", { ...goodProfile, name: "bobby", token: "t-bobby", stash: [{ uid: 1 }] }],
    ["a duplicate stash uid", "bobby", { ...goodProfile, name: "bobby", token: "t-bobby", stash: [{ uid: "u", def: "gold" }, { uid: "u", def: "gold" }] }],
    ["an entry that is null", "bobby", null],
    ["an entry that is a string", "bobby", "bobby"],
    ["an entry that is a list", "bobby", []],
  ];

  it.each(damaged)("%s: keeps the good profile, drops the bad one, logs it, and rewrites the file", async (_label, key, entry) => {
    const text = v1({ alice: goodProfile, [key]: entry });
    fs.writeFileSync(file, text);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const store = open(file);
    expect(store.get("alice")).toEqual(goodProfile);
    expect(store.verifyToken("alice", "t-alice")).toBe(true);
    expect(store.get(key)).toBeUndefined();
    expect(store.claim("alice", "t-alice").created).toBe(false);

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
    await vi.waitFor(() => expect(readFile()).toEqual({ version: 1, profiles: { alice: goodProfile } }));
  });

  it("is quiet from then on: the next start sees a clean file", async () => {
    fs.writeFileSync(file, v1({ alice: goodProfile, bobby: null }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await open(file).flush();
    vi.restoreAllMocks();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const again = open(file);
    expect(again.get("alice")).toEqual(goodProfile);
    expect(error).not.toHaveBeenCalled();
    expect(withSuffix(dir, "bak")).toHaveLength(1);
  });

  it("keeps every good profile when several are bad", async () => {
    const carol = { ...goodProfile, name: "carol", token: "t-carol" };
    fs.writeFileSync(file, v1({ x1: null, alice: goodProfile, x2: { name: "x2" }, carol, x3: 7 }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = open(file);
    expect([store.get("alice"), store.get("carol")]).toEqual([goodProfile, carol]);
    expect(error).toHaveBeenCalledTimes(1);
    for (const name of ["x1", "x2", "x3"]) expect(String(error.mock.calls[0]![0])).toContain(JSON.stringify(name));
    expect(String(error.mock.calls[0]![0])).toContain("dropped 3 malformed profile");
    await vi.waitFor(() => expect(Object.keys(readFile().profiles).sort()).toEqual(["alice", "carol"]));
  });

  it("when every entry is bad the server still starts, empty, with the original kept", async () => {
    const text = v1({ x1: null, x2: 4 });
    fs.writeFileSync(file, text);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const store = open(file);
    expect(store.get("x1")).toBeUndefined();
    await vi.waitFor(() => expect(readFile()).toEqual({ version: 1, profiles: {} }));
    expect(fs.readFileSync(path.join(dir, withSuffix(dir, "bak")[0]!), "utf8")).toBe(text);
  });

  it("quotes and shortens hostile keys, and stops listing after a screenful", () => {
    const profiles: Record<string, unknown> = { alice: goodProfile, ["evil\n" + "x".repeat(500)]: null };
    for (let i = 0; i < 60; i++) profiles[`bad${i}`] = null;
    fs.writeFileSync(file, v1(profiles));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    open(file);
    const line = String(error.mock.calls[0]![0]);
    expect(line).toContain("dropped 61 malformed profile");
    expect(line).toContain("and 11 more");
    expect(line).not.toContain("\n");
    expect(line.length).toBeLessThan(5000);
  });

  it("if the backup cannot be written the server refuses to start rather than overwrite the original", () => {
    const text = v1({ alice: goodProfile, bobby: null });
    fs.writeFileSync(file, text);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => { throw new Error("no space left on device"); });
    expect(() => new JsonStashStore(file)).toThrow("no space left on device");
    vi.restoreAllMocks();
    expect(fs.readFileSync(file, "utf8")).toBe(text);
  });
});

describe("a healthy file", () => {
  it("is not touched, backed up or rewritten at startup, and says nothing", async () => {
    const first = open(file);
    first.claim("alice");
    await first.flush();
    const before = fs.readFileSync(file, "utf8");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const second = open(file);
    await second.flush();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(fs.readdirSync(dir)).toEqual(["stash.json"]);
  });

  it("ignores a leftover temp file from a crashed write", async () => {
    fs.writeFileSync(`${file}.tmp`, "{half");
    const store = open(file);
    store.claim("alice");
    await store.flush();
    expect(readFile().profiles.alice.name).toBe("alice");
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
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

    store.deposit("alice", items("gold"));
    await store.flush();
    expect(order).toEqual([
      "open stash.json.tmp:w", "sync stash.json.tmp:w", "rename",
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

  /**
   * Fake timers for the store's retry only; real file I/O keeps running underneath, and the tests
   * wait with realSleep/waitReal because the global setTimeout stands still. Returns the delays of
   * every timer that was unref'd. useRealTimers() (afterEach) puts the real setTimeout back.
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

  it("a failed write is retried on its own: 1 s, doubling to a 30 s cap, on an unref'd timer, until it lands", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const unref = fakeTimers();
    const disk = flakyRename();
    const store = open(file);
    store.claim("alice");
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
    await waitReal(() => disk.attempts === 1, "the first attempt");
    await vi.advanceTimersByTimeAsync(1000); // retry 1 fails, the next delay is 2 s
    await waitReal(() => disk.attempts === 2, "the second attempt");
    disk.failing = false;
    await vi.advanceTimersByTimeAsync(2000);
    await waitReal(() => fs.existsSync(file), "the write to land");

    disk.failing = true;
    store.deposit("alice", items("gold"));
    await waitReal(() => disk.attempts === 4, "the attempt after the next mutation");
    expect(unref).toEqual([1000, 2000, 1000]);
  });

  it("while backing off, a mutation does not start another write; flush() writes at once and cancels the timer", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fakeTimers();
    const disk = flakyRename();
    const store = open(file);
    store.claim("alice");
    await waitReal(() => disk.attempts === 1, "the first attempt");
    expect(vi.getTimerCount()).toBe(1);

    store.deposit("alice", items("gold"));
    store.recordRaid("alice", "died", 0);
    await realSleep(30);
    expect(disk.attempts).toBe(1); // the timer owns the next attempt

    disk.failing = false;
    await store.flush();
    expect(disk.attempts).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
    expect(readFile().profiles.alice.stash.at(-1)).toEqual({ uid: "gold-0", def: "gold" });
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
});

describe("write serialization", () => {
  /** Slows every write down and records how many writes overlap and how many ran. */
  function instrument(delayMs = 15) {
    const stats = { active: 0, maxActive: 0, writes: 0 };
    const realOpen = fs.promises.open.bind(fs.promises);
    const realRename = fs.promises.rename.bind(fs.promises);
    vi.spyOn(fs.promises, "open").mockImplementation(((...args: Parameters<typeof fs.promises.open>) => {
      // Only the temp-file open starts a write; syncing the directory afterwards also goes through open().
      if (!String(args[0]).endsWith(".tmp")) return realOpen(...args);
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
    for (let i = 0; i < 200; i++) store.deposit("alice", [{ uid: `b${i}`, def: "gold" }]);
    await store.flush();
    expect(stats.writes).toBe(1);
    expect(readFile().profiles.alice.stash).toHaveLength(STARTER_KIT.length + 200);
  });

  it("never has two writes in flight, and coalesces mutations that arrive while one runs", async () => {
    const stats = instrument();
    const store = open(file);
    store.claim("alice");
    for (let i = 0; i < 60; i++) {
      store.deposit("alice", [{ uid: `s${i}`, def: "gold" }]);
      await sleep(2); // each mutation in its own macrotask, many during a single 30 ms write
    }
    await store.flush();
    expect(stats.maxActive).toBe(1);
    expect(stats.writes).toBeGreaterThan(1);
    expect(stats.writes).toBeLessThan(30);
    expect(readFile().profiles.alice.stash).toHaveLength(STARTER_KIT.length + 60);
    expect(fs.readdirSync(dir)).toEqual(["stash.json"]);
  });

  it("the file always ends up equal to the in-memory state", async () => {
    instrument(3);
    const store = open(file);
    const { token } = store.claim("alice");
    store.claim("bobby");
    for (let i = 0; i < 25; i++) {
      store.deposit("alice", [{ uid: `m${i}`, def: "gold" }]);
      const taken = store.withdraw("alice", [store.get("alice")!.stash[0]!.uid]);
      store.deposit("bobby", taken);
      store.recordRaid("alice", i % 2 ? "died" : "extracted", i);
      if (i % 5 === 0) await sleep(4);
    }
    await store.flush();
    const disk = open(file);
    expect(disk.get("alice")).toEqual(store.get("alice"));
    expect(disk.get("bobby")).toEqual(store.get("bobby"));
    expect(disk.verifyToken("alice", token)).toBe(true);
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
    vi.spyOn(fs.promises, "rename").mockRejectedValueOnce(new Error("nope"));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const store = open(file);
      store.claim("alice");
      await sleep(30);
      expect(unhandled).not.toHaveBeenCalled();
      await store.flush();
      expect(readFile().profiles.alice.name).toBe("alice");
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
