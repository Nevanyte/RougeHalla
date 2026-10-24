// The meta layer at store level, no HTTP: the shop (purchase), the wardrobe (equip), achievements unlocked while a run
// is banked, how all of it persists, and the leaderboard's titles, ranks and months. The store is synchronous, so
// "concurrent" below means callers interleaved by the event loop: a check and the change it guards never have an
// await between them, and these tests hold it to that.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACHIEVEMENTS, COSMETICS, COSMETIC_SLOTS, GOLD_FACTIONS, GOLD_SLOTS, cosmeticById, isForSale, mulberry32, shuffle,
  type RunOutcome, type ShopErrorCode,
} from "@raid/shared";
import {
  JsonProfileStore, type Clock, type ProfileRecord, type RunRecord, type ShopOutcome,
} from "../src/persistence/ProfileStore";

// ---------------------------------------------------------------- fixtures
const dirs: string[] = [];
const stores: JsonProfileStore[] = [];
let dir: string;
let file: string;
/** What the injected clock says; tests move it to prove timestamps and months. */
let now: number;
const OCT = "2026-10";

function open(clock: Clock = () => now, f = file): JsonProfileStore {
  const store = new JsonProfileStore(f, { clock });
  stores.push(store);
  return store;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-shop-"));
  dirs.push(dir);
  file = path.join(dir, "stash.json");
  now = Date.UTC(2026, 9, 20, 12);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.allSettled(stores.splice(0).map((s) => s.flush()));
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const readFile = () => JSON.parse(fs.readFileSync(file, "utf8"));
const quiet = () => ({
  log: vi.spyOn(console, "log").mockImplementation(() => {}),
  error: vi.spyOn(console, "error").mockImplementation(() => {}),
});

const zeroStats = { runs: 0, wins: 0, draws: 0, deaths: 0, kills: 0 };
const zeroProgress = () => ({ qualifiedWins: 0, bountyRuns: 0, bestRunKills: 0, winsByFaction: {}, winsByWeapon: {} });

/** A profile as the v2 file holds it. Settled: nothing in it makes the next purchase or equip unlock anything. */
const fileProfile = (name: string, over: Record<string, unknown> = {}) => ({
  name, token: `t-${name}`, gv: 0, gvLifetime: 0, gvByMonth: {} as Record<string, number>,
  stats: { ...zeroStats }, cosmetics: { owned: [] as string[], equipped: {} as Record<string, string> },
  achievements: {} as Record<string, number>, progress: zeroProgress(), ...over,
});
/** `gv` spendable and earned long ago, written straight into the file so no unlock fires on the way in. */
const withGv = (name: string, gv: number, over: Record<string, unknown> = {}) =>
  fileProfile(name, { gv, gvLifetime: gv, gvByMonth: gv > 0 ? { "2026-01": gv } : {}, ...over });
/** 5000 earned, so the "glorious" achievement is already in its book: banking more won't unlock it behind a test's back. */
const owning = (name: string, owned: string[], over: Record<string, unknown> = {}) =>
  withGv(name, 5000, { cosmetics: { owned, equipped: {} }, achievements: { glorious: 1 }, ...over });

function openWith(...profiles: Array<ReturnType<typeof fileProfile>>): JsonProfileStore {
  fs.writeFileSync(file, JSON.stringify({ version: 2, profiles: Object.fromEntries(profiles.map((p) => [p.name, p])) }));
  return open();
}

/** A new profile holding `gv` (kept under the 1000 that unlocks "glorious", so `owned` stays exactly what was bought). */
function signUp(store: JsonProfileStore, name: string, gv = 0): string {
  const { token } = store.claim(name);
  if (gv > 0) store.bankGv(name, gv);
  return token;
}

const price = (id: string): number => cosmeticById(id)!.price!;
const ok = (r: ShopOutcome): ProfileRecord => {
  if (!r.ok) throw new Error(`expected the request to succeed, got ${JSON.stringify(r)}`);
  return r.record;
};
const refused = (code: ShopErrorCode, extra: { need?: number; have?: number } = {}) => ({ ok: false, code, ...extra });
const snap = (store: JsonProfileStore, ...names: string[]) => names.map((n) => store.get(n));
const objectPrototypeNames = () => Object.getOwnPropertyNames(Object.prototype).sort();

/**
 * Runs `fn` and proves it left nothing to write: after a flush, no file write happens at all, so no mutation was
 * even scheduled (a write would go through `rename`).
 */
async function expectNoWrite(store: JsonProfileStore, fn: () => void): Promise<void> {
  await store.flush();
  const rename = vi.spyOn(fs.promises, "rename");
  try {
    fn();
    await store.flush();
    expect(rename).not.toHaveBeenCalled();
  } finally {
    rename.mockRestore();
  }
}

const FOR_SALE = COSMETICS.filter(isForSale);
const NOT_FOR_SALE = COSMETICS.filter((c) => !isForSale(c));

// ---------------------------------------------------------------- the shop
describe("purchase", () => {
  it("rests on the catalog these tests assume", () => {
    expect([price("skin-crimson"), price("title-rookie"), price("trail-ember"), price("gilded-fire"), price("outline-neon")]).toEqual([40, 30, 100, 400, 80]);
    for (const id of ["skin-laurel", "title-victor", "title-bloodied", "trail-comet", "outline-bounty"]) {
      expect(isForSale(cosmeticById(id)!), id).toBe(false);
    }
    expect(FOR_SALE.length).toBeGreaterThan(30);
  });

  it("success debits exactly the price, grants the item, and leaves lifetime GV and the monthly totals alone", async () => {
    const store = open();
    const token = signUp(store, "alice", 100);
    now = Date.UTC(2026, 10, 3);
    store.bankGv("alice", 20);
    signUp(store, "bobby", 100);
    const before = store.get("alice")!;
    const bob = store.get("bobby");
    expect([before.gv, before.gvLifetime, before.gvByMonth]).toEqual([120, 120, { [OCT]: 100, "2026-11": 20 }]);

    const result = store.purchase("alice", token, "skin-crimson");
    const after = ok(result);

    expect(after).toEqual(store.get("alice"));
    expect(after.gv).toBe(80);
    expect(after.gvLifetime).toBe(120);
    expect(after.gvByMonth).toEqual({ [OCT]: 100, "2026-11": 20 });
    expect(after.cosmetics).toEqual({ owned: ["skin-crimson"], equipped: {} }); // bought, not worn
    expect(after).toEqual({ ...before, gv: 80, cosmetics: { owned: ["skin-crimson"], equipped: {} } });
    expect(store.get("bobby")).toEqual(bob);
  });

  it("is persisted: after a flush and a reopen the item is still owned and the GV still spent", async () => {
    const store = open();
    const token = signUp(store, "alice", 100);
    store.purchase("alice", token, "skin-crimson");
    store.purchase("alice", token, "title-rookie");
    await store.flush();
    expect(readFile().profiles.alice).toMatchObject({ gv: 30, gvLifetime: 100, gvByMonth: { [OCT]: 100 } });
    expect(readFile().profiles.alice.cosmetics.owned).toEqual(["skin-crimson", "title-rookie"]);

    const back = open();
    expect(back.get("alice")).toEqual(store.get("alice"));
    expect(back.get("alice")!.cosmetics.owned).toEqual(["skin-crimson", "title-rookie"]);
    expect(back.purchase("alice", token, "skin-crimson")).toStrictEqual(refused("already_owned"));
  });

  it("hands back a snapshot: editing the returned record does not touch the store", () => {
    const store = open();
    const token = signUp(store, "alice", 100);
    const record = ok(store.purchase("alice", token, "skin-crimson"));
    record.gv = 9999;
    record.cosmetics.owned.push("gilded-fire");
    record.cosmetics.equipped.skin = "skin-crimson";
    expect(store.get("alice")!.gv).toBe(60);
    expect(store.get("alice")!.cosmetics).toEqual({ owned: ["skin-crimson"], equipped: {} });
  });

  it("purchases add up: each debits its own price", () => {
    const store = open();
    const token = signUp(store, "alice", 200);
    for (const id of ["skin-crimson", "title-rookie", "trail-ember"]) ok(store.purchase("alice", token, id));
    const r = store.get("alice")!;
    expect(r.gv).toBe(200 - 40 - 30 - 100);
    expect(r.cosmetics.owned).toEqual(["skin-crimson", "title-rookie", "trail-ember"]);
  });

  it("every priced cosmetic can be bought, one by one, at exactly its catalog price", () => {
    const total = FOR_SALE.reduce((sum, c) => sum + c.price!, 0);
    const store = openWith(withGv("alice", total));
    let balance = total;
    for (const c of FOR_SALE) {
      const record = ok(store.purchase("alice", "t-alice", c.id));
      balance -= c.price!;
      expect([c.id, record.gv]).toEqual([c.id, balance]);
      expect(record.cosmetics.owned.at(-1)).toBe(c.id);
    }
    const r = store.get("alice")!;
    expect(r.gv).toBe(0);
    expect(r.gvLifetime).toBe(total);
    expect(r.cosmetics.owned).toEqual(FOR_SALE.map((c) => c.id));
  });

  describe("insufficient GV", () => {
    it("is refused with the exact need and have, and nothing changes", async () => {
      const store = open();
      const token = signUp(store, "alice", 39);
      const before = snap(store, "alice");
      await expectNoWrite(store, () => {
        expect(store.purchase("alice", token, "skin-crimson")).toStrictEqual(refused("insufficient_gv", { need: 40, have: 39 }));
      });
      expect(snap(store, "alice")).toEqual(before);
    });

    it("a profile with nothing at all has 0", async () => {
      const store = open();
      const token = signUp(store, "alice");
      await expectNoWrite(store, () => {
        expect(store.purchase("alice", token, "gilded-fire")).toStrictEqual(refused("insufficient_gv", { need: 400, have: 0 }));
      });
    });

    it("exactly enough works and leaves 0; the next purchase then sees 0", () => {
      const store = open();
      const token = signUp(store, "alice", 40);
      expect(ok(store.purchase("alice", token, "skin-crimson")).gv).toBe(0);
      expect(store.purchase("alice", token, "title-rookie")).toStrictEqual(refused("insufficient_gv", { need: 30, have: 0 }));
      expect(store.get("alice")!.cosmetics.owned).toEqual(["skin-crimson"]);
    });

    it("one GV short of any price in the shop is refused with that price as the need", () => {
      const store = openWith(...FOR_SALE.map((c, i) => withGv(`p${i}`, c.price! - 1)));
      FOR_SALE.forEach((c, i) => {
        expect(store.purchase(`p${i}`, `t-p${i}`, c.id), c.id).toStrictEqual(refused("insufficient_gv", { need: c.price!, have: c.price! - 1 }));
        expect(store.get(`p${i}`), c.id).toMatchObject({ gv: c.price! - 1, cosmetics: { owned: [] } });
      });
    });

    it("spending does not make a profile richer on the leaderboard or in lifetime GV, and lifetime GV does not buy anything", () => {
      const store = open();
      const token = signUp(store, "alice", 100);
      store.purchase("alice", token, "trail-ember"); // 100 spent, 0 left
      expect(store.get("alice")).toMatchObject({ gv: 0, gvLifetime: 100 });
      expect(store.purchase("alice", token, "title-rookie")).toStrictEqual(refused("insufficient_gv", { need: 30, have: 0 }));
      expect(store.leaderboard(OCT, 10)).toEqual([{ name: "alice", gv: 100 }]);
    });
  });

  describe("unknown cosmetic", () => {
    const ids: Array<[string, unknown]> = [
      ["__proto__", "__proto__"], ["constructor", "constructor"], ["toString", "toString"], ["hasOwnProperty", "hasOwnProperty"],
      ["valueOf", "valueOf"], ["the empty string", ""], ["a space", " "], ["a trailing space", "skin-crimson "],
      ["a leading space", " skin-crimson"], ["upper case", "SKIN-CRIMSON"], ["an underscore", "skin_crimson"], ["a prefix", "skin-"],
      ["a null byte", "skin-crimson\u0000"], ["a made up id", "bogus"],
      ["0", 0], ["1", 1], ["-1", -1], ["NaN", Number.NaN], ["Infinity", Infinity], ["true", true], ["false", false],
      ["null", null], ["undefined", undefined], ["an empty object", {}], ["an object that has the id", { id: "skin-crimson" }],
      ["an object with a price", { id: "skin-crimson", price: 0 }], ["a list with the id", ["skin-crimson"]], ["an empty list", []],
      ["a function", () => "skin-crimson"], ["a symbol", Symbol("skin-crimson")], ["a bigint", 40n],
    ];

    it("is refused for ids that are not in the catalog, whatever they look like, and nothing changes", async () => {
      const store = openWith(owning("alice", []), owning("bobby", ["skin-amber"]));
      const before = snap(store, "alice", "bobby");
      const names = objectPrototypeNames();
      await expectNoWrite(store, () => {
        for (const [label, id] of ids) {
          expect(store.purchase("alice", "t-alice", id), label).toStrictEqual(refused("unknown_cosmetic"));
        }
      });
      expect(snap(store, "alice", "bobby")).toEqual(before);
      expect(objectPrototypeNames()).toEqual(names);
    });

    it("is judged after the token: a stranger learns nothing about the catalog", () => {
      const store = openWith(owning("alice", []));
      for (const id of ["bogus", "skin-laurel", "skin-crimson", "__proto__", 7]) {
        expect(store.purchase("alice", "wrong", id), String(id)).toStrictEqual(refused("forbidden"));
      }
    });
  });

  describe("not for sale", () => {
    it("every cosmetic without a price is refused, rich or poor, and nothing changes", async () => {
      expect(NOT_FOR_SALE.map((c) => c.id)).toEqual(expect.arrayContaining(["skin-laurel", "title-victor"]));
      const store = openWith(owning("alice", []), fileProfile("poor"));
      const before = snap(store, "alice", "poor");
      await expectNoWrite(store, () => {
        for (const c of NOT_FOR_SALE) {
          expect(store.purchase("alice", "t-alice", c.id), c.id).toStrictEqual(refused("not_for_sale"));
          expect(store.purchase("poor", "t-poor", c.id), c.id).toStrictEqual(refused("not_for_sale")); // not "insufficient"
        }
      });
      expect(snap(store, "alice", "poor")).toEqual(before);
    });

    it("an achievement reward cannot be bought even by someone who is missing only the achievement", () => {
      const store = openWith(owning("alice", []));
      for (const id of ["skin-laurel", "title-victor"]) {
        expect(store.purchase("alice", "t-alice", id)).toStrictEqual(refused("not_for_sale"));
      }
      expect(store.get("alice")).toMatchObject({ gv: 5000, cosmetics: { owned: [] } });
    });
  });

  describe("already owned (a double spend)", () => {
    it("a second purchase of the same item is refused and the GV is charged once", async () => {
      const store = open();
      const token = signUp(store, "alice", 200);
      ok(store.purchase("alice", token, "skin-crimson"));
      await expectNoWrite(store, () => {
        expect(store.purchase("alice", token, "skin-crimson")).toStrictEqual(refused("already_owned"));
        expect(store.purchase("alice", token, "skin-crimson")).toStrictEqual(refused("already_owned"));
      });
      expect(store.get("alice")!.gv).toBe(160);
      expect(store.get("alice")!.cosmetics.owned).toEqual(["skin-crimson"]);
    });

    it("an item that came from an achievement is not on sale, and a bought one that an achievement would grant is not granted twice", () => {
      const store = openWith(owning("alice", ["gilded-fire"]));
      expect(store.purchase("alice", "t-alice", "gilded-fire")).toStrictEqual(refused("already_owned"));
      expect(store.get("alice")!.gv).toBe(5000);
    });
  });

  describe("forbidden", () => {
    const wrongTokens: Array<[string, unknown]> = [
      ["an empty token", ""], ["a wrong token", "nope"], ["the other profile's token", "t-bobby"],
      ["the token with a character added", "t-alicex"], ["the token cut short", "t-alic"], ["the token in capitals", "T-ALICE"],
      ["the token with a leading space", " t-alice"], ["the token with a trailing newline", "t-alice\n"],
      ["undefined", undefined], ["null", null], ["a number", 123], ["true", true], ["an object", {}],
      ["a list holding the token", ["t-alice"]], ["an object with a toString that gives the token", { toString: () => "t-alice" }],
    ];

    it("a wrong or missing token changes nothing anywhere, not even the other profile, and writes nothing", async () => {
      const store = openWith(withGv("alice", 100), withGv("bobby", 100));
      const before = snap(store, "alice", "bobby");
      await expectNoWrite(store, () => {
        for (const [label, token] of wrongTokens) {
          expect(store.purchase("alice", token as string, "skin-crimson"), label).toStrictEqual(refused("forbidden"));
        }
      });
      expect(snap(store, "alice", "bobby")).toEqual(before);
    });

    it("bobby's own token does not buy into alice's profile, and alice's does not buy into bobby's", async () => {
      const store = openWith(withGv("alice", 100), withGv("bobby", 100));
      const before = snap(store, "alice", "bobby");
      await expectNoWrite(store, () => {
        expect(store.purchase("alice", "t-bobby", "skin-crimson")).toStrictEqual(refused("forbidden"));
        expect(store.purchase("bobby", "t-alice", "skin-crimson")).toStrictEqual(refused("forbidden"));
      });
      expect(snap(store, "alice", "bobby")).toEqual(before);
    });

    const names: Array<[string, unknown]> = [
      ["an unknown profile", "nobody"], ["__proto__", "__proto__"], ["constructor", "constructor"], ["the empty name", ""],
      ["the name in other case", "Alice"], ["a name with a space", "alice "], ["undefined", undefined], ["null", null],
      ["a number", 123], ["an object", {}], ["a list", ["alice"]],
    ];

    it.each(names)("%s: forbidden, and no profile is created", async (_label, name) => {
      const store = openWith(withGv("alice", 100));
      const before = snap(store, "alice");
      await expectNoWrite(store, () => {
        expect(store.purchase(name as string, "t-alice", "skin-crimson")).toStrictEqual(refused("forbidden"));
        expect(store.purchase(name as string, "", "skin-crimson")).toStrictEqual(refused("forbidden"));
      });
      expect(snap(store, "alice")).toEqual(before);
      if (typeof name === "string") expect(store.get(name)).toBeUndefined();
    });

    it("says nothing about the balance, the catalog or ownership: every refusal for a stranger is the same bare answer", () => {
      const store = openWith(owning("alice", ["skin-crimson"]));
      const answers = [
        store.purchase("alice", "wrong", "skin-crimson"), // owned
        store.purchase("alice", "wrong", "gilded-fire"), // affordable
        store.purchase("alice", "wrong", "skin-laurel"), // not for sale
        store.purchase("alice", "wrong", "bogus"), // not in the catalog
      ];
      for (const a of answers) expect(a).toStrictEqual({ ok: false, code: "forbidden" });
    });
  });

  describe("a client cannot influence the price", () => {
    it("takes no price: extra arguments, whatever they hold, change nothing about what is charged", () => {
      const store = open();
      const token = signUp(store, "alice", 200);
      const buy = store.purchase as unknown as (...a: unknown[]) => ShopOutcome;
      expect(ok(buy.call(store, "alice", token, "skin-crimson", 1)).gv).toBe(160);
      expect(ok(buy.call(store, "alice", token, "title-rookie", { price: 0 }, 0, -40)).gv).toBe(130);
      expect(ok(buy.call(store, "alice", token, "outline-white", -1000)).gv).toBe(80);
      expect(ok(buy.call(store, "alice", token, "outline-black", Number.NaN)).gv).toBe(30);
      expect(store.get("alice")).toMatchObject({ gv: 30, gvLifetime: 200 });
    });

    it("an id that carries a price is not an id", () => {
      const store = open();
      const token = signUp(store, "alice", 10);
      const id = { id: "gilded-fire", price: 1, toString: () => "gilded-fire" };
      expect(store.purchase("alice", token, id)).toStrictEqual(refused("unknown_cosmetic"));
      expect(store.get("alice")).toMatchObject({ gv: 10, cosmetics: { owned: [] } });
    });

    it("a negative price cannot mint GV: the catalog is the only source of prices", () => {
      expect(FOR_SALE.every((c) => Number.isSafeInteger(c.price) && c.price! > 0)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------- interleaved callers
describe("concurrent purchases", () => {
  const tick = () => Promise.resolve();

  it("many callers for the same item with the balance for exactly one: one succeeds, the rest are refused", async () => {
    const store = open();
    const token = signUp(store, "alice", 40);
    const results = await Promise.all(
      Array.from({ length: 40 }, async () => {
        await tick();
        return store.purchase("alice", token, "skin-crimson");
      }),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const r of results.filter((r) => !r.ok)) expect(["insufficient_gv", "already_owned"]).toContain((r as { code: string }).code);
    const r = store.get("alice")!;
    expect(r.gv).toBe(0);
    expect(r.cosmetics.owned).toEqual(["skin-crimson"]);
    expect(r.gvLifetime).toBe(40);
  });

  it("many callers for the same item with the balance for three of it: it is still bought once and charged once", async () => {
    const store = open();
    const token = signUp(store, "alice", 120);
    const results = await Promise.all(
      Array.from({ length: 30 }, async (_, i) => {
        for (let k = 0; k < i % 4; k++) await tick();
        return store.purchase("alice", token, "skin-crimson");
      }),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(store.get("alice")).toMatchObject({ gv: 80, cosmetics: { owned: ["skin-crimson"] } });
  });

  it.each([
    ["the dearer first", ["trail-ember", "skin-crimson"]],
    ["the cheaper first", ["skin-crimson", "trail-ember"]],
  ])("two different items whose prices together exceed the balance: exactly one succeeds (%s)", async (_label, ids) => {
    const store = open();
    const token = signUp(store, "alice", 100); // 100 buys either, 140 buys both
    const results = await Promise.all(
      ids.map(async (id) => {
        await tick();
        return store.purchase("alice", token, id);
      }),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
    const r = store.get("alice")!;
    expect(r.cosmetics.owned).toHaveLength(1);
    expect(r.gv).toBe(100 - price(r.cosmetics.owned[0]!));
    expect(r.gv).toBeGreaterThanOrEqual(0);
    // The refusal says what it was short of.
    const refusal = results.find((x) => !x.ok) as { code: string; need: number; have: number };
    expect(refusal.code).toBe("insufficient_gv");
    expect(refusal.have).toBe(r.gv);
  });

  it("every distinct item in the shop at once, with the balance for exactly the first 20 of them: exactly 20 succeed and nothing is left", async () => {
    expect(FOR_SALE.length).toBeGreaterThan(20);
    const distinct = shuffle(mulberry32(7), FOR_SALE.map((c) => c.id)).slice(0, 50);
    // 50 purchases in all: every distinct item once, then repeats of items that come early.
    const calls = [...distinct, ...distinct.slice(0, 50 - distinct.length)];
    const winners = distinct.slice(0, 20);
    const balance = winners.reduce((sum, id) => sum + price(id), 0);
    const store = openWith(withGv("alice", balance));

    const results = await Promise.all(
      calls.map(async (id) => {
        await tick();
        return store.purchase("alice", "t-alice", id);
      }),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(20);
    results.forEach((r, i) => {
      if (i < 20) expect(r.ok, calls[i]).toBe(true);
      else if (i < distinct.length) expect(r, calls[i]).toStrictEqual(refused("insufficient_gv", { need: price(calls[i]!), have: 0 }));
      else expect(r, calls[i]).toStrictEqual(refused("already_owned"));
    });
    const r = store.get("alice")!;
    expect(r.gv).toBe(0);
    expect([...r.cosmetics.owned].sort()).toEqual([...winners].sort());
    expect(new Set(r.cosmetics.owned).size).toBe(r.cosmetics.owned.length);
    expect(r.gvLifetime).toBe(balance);

    await store.flush();
    const back = open().get("alice")!;
    expect(back.gv).toBe(0);
    expect([...back.cosmetics.owned].sort()).toEqual([...winners].sort());
  });

  it.each([1, 2, 3, 4, 5])("callers in a random order, with random waits, get exactly what a one-at-a-time run in their order would (seed %i)", async (seed) => {
    const rng = mulberry32(seed);
    const ids = FOR_SALE.slice(0, 14).map((c) => c.id);
    const start = 700;
    const store = openWith(withGv("alice", start));
    const arrivals: Array<{ id: string; result: ShopOutcome }> = [];
    const tasks = Array.from({ length: 120 }, async () => {
      const id = ids[Math.floor(rng() * ids.length)]!;
      const waits = Math.floor(rng() * 5);
      for (let k = 0; k < waits; k++) await tick();
      if (rng() < 0.2) await new Promise<void>((resolve) => setImmediate(resolve));
      arrivals.push({ id, result: store.purchase("alice", "t-alice", id) });
    });
    await Promise.all(tasks);
    expect(arrivals).toHaveLength(120);

    // The reference: the same requests, applied one at a time in the order they actually arrived.
    let gv = start;
    const owned = new Set<string>();
    for (const { id, result } of arrivals) {
      if (owned.has(id)) {
        expect(result, id).toStrictEqual(refused("already_owned"));
      } else if (gv < price(id)) {
        expect(result, id).toStrictEqual(refused("insufficient_gv", { need: price(id), have: gv }));
      } else {
        expect(result.ok, id).toBe(true);
        gv -= price(id);
        owned.add(id);
      }
    }
    const r = store.get("alice")!;
    expect(r.gv).toBe(gv);
    expect(r.gv).toBeGreaterThanOrEqual(0);
    expect(r.cosmetics.owned).toEqual([...owned]);
    expect(start - r.gv).toBe([...owned].reduce((sum, id) => sum + price(id), 0));
  });

  it("buyers on different profiles never touch each other's balances", async () => {
    const store = openWith(withGv("alice", 100), withGv("bobby", 40), withGv("carol", 0));
    const results = await Promise.all(
      [["alice", "skin-crimson"], ["bobby", "skin-crimson"], ["carol", "skin-crimson"], ["alice", "outline-white"], ["bobby", "title-rookie"]].map(
        async ([name, id]) => {
          await tick();
          return [name, id, store.purchase(name!, `t-${name}`, id!)] as const;
        },
      ),
    );
    expect(results.map(([n, i, r]) => [n, i, r.ok])).toEqual([
      ["alice", "skin-crimson", true], ["bobby", "skin-crimson", true], ["carol", "skin-crimson", false],
      ["alice", "outline-white", true], ["bobby", "title-rookie", false],
    ]);
    expect(store.get("alice")).toMatchObject({ gv: 10, cosmetics: { owned: ["skin-crimson", "outline-white"] } });
    expect(store.get("bobby")).toMatchObject({ gv: 0, cosmetics: { owned: ["skin-crimson"] } });
    expect(store.get("carol")).toMatchObject({ gv: 0, cosmetics: { owned: [] } });
  });

  it("a purchase interleaved with a run being banked keeps both: the debit and the credit each apply once", async () => {
    const store = open();
    const token = signUp(store, "alice", 100);
    await Promise.all([
      (async () => { await tick(); store.recordRun("alice", { outcome: "died", kills: 0, gv: 25 }); })(),
      (async () => { await tick(); store.purchase("alice", token, "skin-crimson"); })(),
      (async () => { await tick(); store.bankGv("alice", 5); })(),
    ]);
    expect(store.get("alice")).toMatchObject({ gv: 100 + 25 + 5 - 40, gvLifetime: 130, cosmetics: { owned: ["skin-crimson"] } });
  });
});

// ---------------------------------------------------------------- the wardrobe
describe("equip", () => {
  const OWNED = ["skin-crimson", "skin-amber", "outline-white", "trail-ember", "title-rookie", "title-victor", "gilded-fire", "gilded-axe"];
  const world = () => openWith(owning("alice", OWNED), owning("bobby", ["skin-lime", "title-slayer"]));
  const equipped = (store: JsonProfileStore, name = "alice") => store.get(name)!.cosmetics.equipped;

  it("puts an owned item on in its slot, and changes nothing else", () => {
    const store = world();
    const before = store.get("alice")!;
    const after = ok(store.equip("alice", "t-alice", "skin", "skin-crimson"));
    expect(after).toEqual(store.get("alice"));
    expect(after).toEqual({ ...before, cosmetics: { owned: OWNED, equipped: { skin: "skin-crimson" } } });
  });

  it("every kind of slot takes its own item, all at once", () => {
    const store = world();
    const worn: Array<[string, string]> = [
      ["skin", "skin-crimson"], ["outline", "outline-white"], ["trail", "trail-ember"], ["title", "title-rookie"],
      ["gold-fire", "gilded-fire"], ["gold-axe", "gilded-axe"],
    ];
    for (const [slot, id] of worn) ok(store.equip("alice", "t-alice", slot, id));
    expect(equipped(store)).toEqual(Object.fromEntries(worn));
  });

  it("replaces the item in a slot; the replaced one stays owned", () => {
    const store = world();
    ok(store.equip("alice", "t-alice", "skin", "skin-crimson"));
    ok(store.equip("alice", "t-alice", "skin", "skin-amber"));
    expect(equipped(store)).toEqual({ skin: "skin-amber" });
    expect(store.get("alice")!.cosmetics.owned).toEqual(OWNED);
  });

  it("is persisted", async () => {
    const store = world();
    ok(store.equip("alice", "t-alice", "title", "title-victor"));
    ok(store.equip("alice", "t-alice", "gold-axe", "gilded-axe"));
    await store.flush();
    expect(readFile().profiles.alice.cosmetics.equipped).toEqual({ title: "title-victor", "gold-axe": "gilded-axe" });
    expect(equipped(open())).toEqual({ title: "title-victor", "gold-axe": "gilded-axe" });
  });

  it("a bought item can be put on right away", () => {
    const store = open();
    const token = signUp(store, "alice", 100);
    ok(store.purchase("alice", token, "trail-ember"));
    expect(equipped(store)).toEqual({});
    ok(store.equip("alice", token, "trail", "trail-ember"));
    expect(equipped(store)).toEqual({ trail: "trail-ember" });
  });

  describe("taking an item off (id null)", () => {
    it("empties that slot only, keeps the item, and may be repeated", () => {
      const store = world();
      ok(store.equip("alice", "t-alice", "skin", "skin-crimson"));
      ok(store.equip("alice", "t-alice", "title", "title-rookie"));
      const off = ok(store.equip("alice", "t-alice", "skin", null));
      expect(off.cosmetics.equipped).toEqual({ title: "title-rookie" });
      expect(Object.hasOwn(equipped(store), "skin")).toBe(false); // the key is gone, not set to something empty
      expect(store.get("alice")!.cosmetics.owned).toEqual(OWNED);
      expect(ok(store.equip("alice", "t-alice", "skin", null)).cosmetics.equipped).toEqual({ title: "title-rookie" });
    });

    it("an empty slot, and an item already worn, are no-ops that write nothing", async () => {
      const store = world();
      ok(store.equip("alice", "t-alice", "skin", "skin-crimson"));
      await expectNoWrite(store, () => {
        expect(ok(store.equip("alice", "t-alice", "skin", "skin-crimson")).cosmetics.equipped).toEqual({ skin: "skin-crimson" }); // already worn
        expect(ok(store.equip("alice", "t-alice", "trail", null)).cosmetics.equipped).toEqual({ skin: "skin-crimson" }); // never worn
        expect(ok(store.equip("alice", "t-alice", "gold-fire", null)).cosmetics.equipped).toEqual({ skin: "skin-crimson" });
      });
      ok(store.equip("alice", "t-alice", "skin", null));
      await expectNoWrite(store, () => {
        expect(ok(store.equip("alice", "t-alice", "skin", null)).cosmetics.equipped).toEqual({}); // now empty: nothing to remove
        expect(ok(store.equip("alice", "t-alice", "skin", null)).cosmetics.equipped).toEqual({});
      });
    });

    it("a real change is written (the control for the test above)", async () => {
      const store = world();
      await store.flush();
      const rename = vi.spyOn(fs.promises, "rename");
      ok(store.equip("alice", "t-alice", "skin", "skin-crimson"));
      await store.flush();
      expect(rename).toHaveBeenCalledTimes(1);
      ok(store.equip("alice", "t-alice", "skin", null));
      await store.flush();
      expect(rename).toHaveBeenCalledTimes(2);
      expect(readFile().profiles.alice.cosmetics.equipped).toEqual({});
    });
  });

  describe("not owned", () => {
    it("an item that exists but is not in the profile is refused, even one another profile owns", async () => {
      const store = world();
      const before = snap(store, "alice", "bobby");
      await expectNoWrite(store, () => {
        expect(store.equip("alice", "t-alice", "skin", "skin-lime")).toStrictEqual(refused("not_owned")); // bobby's
        expect(store.equip("alice", "t-alice", "skin", "skin-teal")).toStrictEqual(refused("not_owned")); // nobody's
        expect(store.equip("alice", "t-alice", "title", "title-slayer")).toStrictEqual(refused("not_owned"));
        expect(store.equip("alice", "t-alice", "gold-sword", "gilded-sword")).toStrictEqual(refused("not_owned"));
      });
      expect(snap(store, "alice", "bobby")).toEqual(before);
    });

    it("an item that was not bought does not become owned by being equipped, and an unaffordable one is not bought by it", () => {
      const store = openWith(withGv("alice", 1000));
      expect(store.equip("alice", "t-alice", "gold-fire", "gilded-fire")).toStrictEqual(refused("not_owned"));
      expect(store.get("alice")).toMatchObject({ gv: 1000, cosmetics: { owned: [], equipped: {} } });
    });
  });

  describe("wrong slot", () => {
    it("an item in a slot that is not its own is refused", async () => {
      const store = world();
      const before = snap(store, "alice");
      await expectNoWrite(store, () => {
        expect(store.equip("alice", "t-alice", "outline", "skin-crimson")).toStrictEqual(refused("slot_mismatch"));
        expect(store.equip("alice", "t-alice", "title", "skin-crimson")).toStrictEqual(refused("slot_mismatch"));
        expect(store.equip("alice", "t-alice", "skin", "gilded-fire")).toStrictEqual(refused("slot_mismatch"));
        expect(store.equip("alice", "t-alice", "gold-fire", "skin-crimson")).toStrictEqual(refused("slot_mismatch"));
        expect(store.equip("alice", "t-alice", "skin", "title-victor")).toStrictEqual(refused("slot_mismatch"));
      });
      expect(snap(store, "alice")).toEqual(before);
    });

    it("a golden slot takes its own golden variant only", () => {
      const store = world();
      expect(store.equip("alice", "t-alice", "gold-fire", "gilded-axe")).toStrictEqual(refused("slot_mismatch"));
      expect(store.equip("alice", "t-alice", "gold-axe", "gilded-fire")).toStrictEqual(refused("slot_mismatch"));
      expect(equipped(store)).toEqual({});
      ok(store.equip("alice", "t-alice", "gold-fire", "gilded-fire"));
      expect(equipped(store)).toEqual({ "gold-fire": "gilded-fire" });
    });

    it("the whole matrix: with everything owned, an item goes on in exactly the slot it belongs to", () => {
      const store = openWith(owning("alice", COSMETICS.map((c) => c.id)));
      for (const c of COSMETICS) {
        for (const slot of COSMETIC_SLOTS) {
          const r = store.equip("alice", "t-alice", slot, c.id);
          if (slot === c.slot) expect(r.ok, `${c.id} in ${slot}`).toBe(true);
          else expect(r, `${c.id} in ${slot}`).toStrictEqual(refused("slot_mismatch"));
        }
      }
      // And each golden slot takes exactly one cosmetic: the golden variant for its own faction or weapon.
      for (const slot of GOLD_SLOTS) {
        const accepted = COSMETICS.filter((c) => store.equip("alice", "t-alice", slot, c.id).ok).map((c) => c.id);
        expect(accepted, slot).toEqual([`gilded-${slot.slice("gold-".length)}`]);
      }
    });
  });

  describe("unknown slot", () => {
    const slots: Array<[string, unknown]> = [
      ["__proto__", "__proto__"], ["constructor", "constructor"], ["toString", "toString"], ["hasOwnProperty", "hasOwnProperty"],
      ["valueOf", "valueOf"], ["the empty string", ""], ["a capitalised slot", "Skin"], ["a shouting slot", "SKIN"],
      ["a slot with a space", " skin"], ["a slot with a trailing space", "skin "], ["a golden slot for nothing", "gold-bogus"],
      ["a bare golden prefix", "gold-"], ["a slot from an old build", "cape"],
      ["0", 0], ["1", 1], ["true", true], ["null", null], ["undefined", undefined], ["an object", {}], ["a list", ["skin"]],
      ["a function", () => "skin"],
    ];

    it("is refused, with an item or with null, and pollutes nothing", async () => {
      const store = world();
      const before = snap(store, "alice", "bobby");
      const names = objectPrototypeNames();
      await expectNoWrite(store, () => {
        for (const [label, slot] of slots) {
          expect(store.equip("alice", "t-alice", slot, "skin-crimson"), label).toStrictEqual(refused("unknown_slot"));
          expect(store.equip("alice", "t-alice", slot, null), label).toStrictEqual(refused("unknown_slot"));
        }
      });
      expect(snap(store, "alice", "bobby")).toEqual(before);
      expect(objectPrototypeNames()).toEqual(names);
      expect(({} as Record<string, unknown>)["skin-crimson"]).toBeUndefined();
      expect(Object.getPrototypeOf(equipped(store))).toBe(Object.prototype);
    });

    it("a slot named like Object.prototype's members never reaches the equipped map", () => {
      const store = world();
      for (const slot of ["__proto__", "constructor", "toString"]) store.equip("alice", "t-alice", slot, "skin-crimson");
      expect(Object.keys(equipped(store))).toEqual([]);
      expect(Object.getPrototypeOf(equipped(store))).toBe(Object.prototype);
      expect((equipped(store) as Record<string, unknown>).skin).toBeUndefined();
    });
  });

  describe("bad request", () => {
    const ids: Array<[string, unknown]> = [
      ["undefined", undefined], ["0", 0], ["1", 1], ["NaN", Number.NaN], ["true", true], ["false", false], ["an empty object", {}],
      ["an object with the id", { id: "skin-crimson" }], ["a list", []], ["a list with the id", ["skin-crimson"]], ["a function", () => "skin-crimson"],
    ];

    it("an id that is neither a string nor null is refused", async () => {
      const store = world();
      const before = snap(store, "alice");
      await expectNoWrite(store, () => {
        for (const [label, id] of ids) {
          expect(store.equip("alice", "t-alice", "skin", id), label).toStrictEqual(refused("bad_request"));
        }
      });
      expect(snap(store, "alice")).toEqual(before);
    });

    it("a string that is not in the catalog is an unknown cosmetic", async () => {
      const store = world();
      await expectNoWrite(store, () => {
        for (const id of ["bogus", "__proto__", "constructor", "", "SKIN-CRIMSON", "skin-crimson "]) {
          expect(store.equip("alice", "t-alice", "skin", id), id).toStrictEqual(refused("unknown_cosmetic"));
        }
      });
    });
  });

  describe("forbidden", () => {
    it("a wrong or missing token, another profile's token, or an unknown profile changes nothing", async () => {
      const store = world();
      ok(store.equip("alice", "t-alice", "skin", "skin-crimson"));
      const before = snap(store, "alice", "bobby");
      await expectNoWrite(store, () => {
        const tokens: unknown[] = ["", "nope", "t-bobby", "t-alicex", "T-ALICE", undefined, null, 5, {}, ["t-alice"]];
        for (const token of tokens) {
          expect(store.equip("alice", token as string, "skin", "skin-amber"), String(token)).toStrictEqual(refused("forbidden"));
          expect(store.equip("alice", token as string, "skin", null), String(token)).toStrictEqual(refused("forbidden"));
          expect(store.equip("alice", token as string, "not-a-slot", 7), String(token)).toStrictEqual(refused("forbidden"));
        }
        for (const name of ["nobody", "__proto__", "", "Alice", undefined, null, 7]) {
          expect(store.equip(name as string, "t-alice", "skin", "skin-amber")).toStrictEqual(refused("forbidden"));
        }
        expect(store.equip("bobby", "t-alice", "skin", "skin-lime")).toStrictEqual(refused("forbidden"));
      });
      expect(snap(store, "alice", "bobby")).toEqual(before);
      expect(equipped(store)).toEqual({ skin: "skin-crimson" });
    });
  });
});

// ---------------------------------------------------------------- achievements, unlocked while a run is banked
describe("achievements via recordRun", () => {
  const run = (outcome: RunOutcome, extra: Partial<RunRecord> = {}): RunRecord => ({ outcome, kills: 0, gv: 0, ...extra });
  /** A contested win: the only kind that counts toward win achievements and the faction/weapon counters. */
  const win = (extra: Partial<RunRecord> = {}) => run("won", { winQualified: true, ...extra });
  /** A win that failed the anti alt-farming gate (a walkover against throwaway callsigns). */
  const walkover = (extra: Partial<RunRecord> = {}) => run("won", extra);
  const loss = (extra: Partial<RunRecord> = {}) => run("died", extra);
  const fresh = (name = "alice") => {
    const store = open();
    store.claim(name);
    return store;
  };
  const ownedOf = (store: JsonProfileStore, name = "alice") => store.get(name)!.cosmetics.owned;
  const progressOf = (store: JsonProfileStore, name = "alice") => store.get(name)!.progress;

  describe("first win", () => {
    it("unlocks once, stamps the unlock time, and grants its title and its colour", () => {
      const store = fresh();
      expect(store.recordRun("alice", win({ gv: 50 }))).toEqual({ unlocked: ["first_win"] });
      expect(store.get("alice")!.achievements).toEqual({ first_win: now });
      expect(ownedOf(store)).toEqual(["title-victor", "skin-laurel"]);
    });

    it("a second win unlocks nothing and does not rewrite the timestamp or the grants", () => {
      const store = fresh();
      const first = now;
      store.recordRun("alice", win({ gv: 50 }));
      now += 5 * 24 * 3_600_000;
      expect(store.recordRun("alice", win({ gv: 50 }))).toEqual({ unlocked: [] });
      now += 1;
      expect(store.recordRun("alice", win())).toEqual({ unlocked: [] });
      const r = store.get("alice")!;
      expect(r.achievements).toEqual({ first_win: first });
      expect(r.cosmetics.owned).toEqual(["title-victor", "skin-laurel"]);
      expect(r.stats.wins).toBe(3);
    });

    it("a loss, a draw and a mia do not unlock it", () => {
      const store = fresh();
      for (const outcome of ["died", "draw", "mia"] as const) expect(store.recordRun("alice", run(outcome, { gv: 20 }))).toEqual({ unlocked: [] });
      expect(store.get("alice")!.achievements).toEqual({});
    });

    it("a reward the profile already owns is not duplicated; the other one is still granted", () => {
      const store = openWith(owning("alice", ["skin-crimson", "title-victor"]));
      expect(store.recordRun("alice", win())).toEqual({ unlocked: ["first_win"] });
      expect(ownedOf(store)).toEqual(["skin-crimson", "title-victor", "skin-laurel"]);
    });

    it("every achievement that completes in one run shares that run's time, and comes back in catalog order", () => {
      const store = fresh();
      now = Date.UTC(2026, 9, 21, 8, 30, 15, 123);
      expect(store.recordRun("alice", win({ kills: 1, gv: 70 }))).toEqual({ unlocked: ["first_blood", "first_win"] });
      expect(store.get("alice")!.achievements).toEqual({ first_blood: now, first_win: now });
      expect(ownedOf(store)).toEqual(["title-bloodied", "title-victor", "skin-laurel"]);
    });
  });

  describe("kills", () => {
    it("the first kill unlocks first_blood; a run without one does not", () => {
      const store = fresh();
      expect(store.recordRun("alice", loss())).toEqual({ unlocked: [] });
      expect(store.recordRun("alice", loss({ kills: 1 }))).toEqual({ unlocked: ["first_blood"] });
      expect(ownedOf(store)).toEqual(["title-bloodied"]);
    });

    it("10 kills across several runs unlock slayer on the run that crosses 10, not before", () => {
      const store = fresh();
      expect(store.recordRun("alice", loss({ kills: 3 })).unlocked).toEqual(["first_blood"]);
      expect(store.recordRun("alice", loss({ kills: 3 })).unlocked).toEqual([]);
      expect(store.recordRun("alice", loss({ kills: 3 })).unlocked).toEqual([]); // 9
      expect(store.get("alice")!.achievements).not.toHaveProperty("slayer");
      now += 1000;
      expect(store.recordRun("alice", loss({ kills: 1 })).unlocked).toEqual(["slayer"]); // 10
      expect(store.get("alice")!.achievements.slayer).toBe(now);
      expect(ownedOf(store)).toEqual(["title-bloodied", "title-slayer"]);
      expect(store.recordRun("alice", loss({ kills: 4 })).unlocked).toEqual([]); // never again
    });

    it("one run that jumps past several thresholds unlocks them all", () => {
      const store = openWith(withGv("alice", 0, { stats: { ...zeroStats, runs: 3, kills: 8 } }));
      expect(store.recordRun("alice", loss({ kills: 44 })).unlocked).toEqual(["first_blood", "slayer", "reaper", "rampage"]);
      expect(ownedOf(store)).toEqual(["title-bloodied", "title-slayer", "title-reaper", "title-rampage", "trail-comet"]);
    });

    it("rampage needs 5 kills in a single run: five runs of one kill do not do it", () => {
      const store = fresh();
      for (let i = 0; i < 5; i++) store.recordRun("alice", loss({ kills: 1 }));
      expect(store.get("alice")!.achievements).not.toHaveProperty("rampage");
      expect(store.recordRun("alice", loss({ kills: 4 })).unlocked).toEqual([]); // best run so far: 4
      expect(store.recordRun("alice", loss({ kills: 5 })).unlocked).toContain("rampage");
    });

    it("bestRunKills is a maximum, not a sum", () => {
      const store = fresh();
      for (const [kills, best] of [[3, 3], [1, 3], [4, 4], [2, 4], [0, 4]] as const) {
        store.recordRun("alice", loss({ kills }));
        expect(progressOf(store).bestRunKills, `after a run of ${kills}`).toBe(best);
      }
      expect(store.get("alice")!.stats.kills).toBe(10);
    });
  });

  describe("bounty", () => {
    it("a run with any bounty counts as one bounty run, however big the bounty; a run without does not", () => {
      const store = fresh();
      expect(store.recordRun("alice", loss({ gv: 40, bounty: 30 })).unlocked).toEqual(["bounty_hunter"]);
      expect(progressOf(store).bountyRuns).toBe(1);
      expect(ownedOf(store)).toEqual(["title-bounty-hunter", "outline-bounty"]);
      store.recordRun("alice", loss({ gv: 500, bounty: 480 }));
      expect(progressOf(store).bountyRuns).toBe(2);
      store.recordRun("alice", loss({ gv: 40 })); // no bounty key
      store.recordRun("alice", loss({ gv: 40, bounty: 0 }));
      expect(progressOf(store).bountyRuns).toBe(2);
    });

    it("counts on a lost run as well as a won one", () => {
      const store = fresh();
      store.recordRun("alice", run("mia", { bounty: 10, gv: 10 }));
      store.recordRun("alice", win({ bounty: 10, gv: 60 }));
      expect(progressOf(store).bountyRuns).toBe(2);
    });

    it("a bounty that floors to nothing, or is garbage, counts no run (garbage is logged)", () => {
      const { error } = quiet();
      const store = fresh();
      store.recordRun("alice", loss({ bounty: 0.9 }));
      expect(error).not.toHaveBeenCalled();
      for (const bad of [Number.NaN, -5, Infinity, "9", null]) store.recordRun("alice", loss({ bounty: bad as number }));
      expect(error).toHaveBeenCalledTimes(5);
      expect(progressOf(store).bountyRuns).toBe(0);
      expect(store.get("alice")!.achievements).toEqual({});
    });
  });

  describe("wins by faction and weapon", () => {
    it("a win counts for the faction played and the weapon in hand", () => {
      const store = fresh();
      store.recordRun("alice", win({ faction: "fire", weapon: "sword" }));
      store.recordRun("alice", win({ faction: "fire", weapon: "axe" }));
      store.recordRun("alice", win({ faction: "frost", weapon: "axe" }));
      expect(progressOf(store)).toEqual({ ...zeroProgress(), qualifiedWins: 3, winsByFaction: { fire: 2, frost: 1 }, winsByWeapon: { sword: 1, axe: 2 } });
    });

    it("a faction alone, a weapon alone, or neither is fine", () => {
      const store = fresh();
      store.recordRun("alice", win({ faction: "plague" }));
      store.recordRun("alice", win({ weapon: "bow" }));
      store.recordRun("alice", win());
      expect(progressOf(store)).toEqual({ ...zeroProgress(), qualifiedWins: 3, winsByFaction: { plague: 1 }, winsByWeapon: { bow: 1 } });
    });

    it.each([
      ["__proto__", "__proto__"], ["constructor", "constructor"], ["toString", "toString"], ["hasOwnProperty", "hasOwnProperty"],
      ["bogus", "bogus"], ["the empty string", ""], ["in capitals", "FIRE"], ["with a space", "fire "],
      ["a weapon given as the faction", "axe"], ["a number", 3], ["an object", { fire: 1 }], ["a list", ["fire"]],
    ])("an unknown faction id (%s) counts for nothing and pollutes nothing", (_label, faction) => {
      const names = objectPrototypeNames();
      const store = fresh();
      expect(() => store.recordRun("alice", win({ faction: faction as string, weapon: faction as string }))).not.toThrow();
      expect(progressOf(store).winsByFaction).toEqual({});
      expect(Object.keys(progressOf(store).winsByFaction)).toEqual([]);
      expect(progressOf(store).winsByWeapon).toEqual(faction === "axe" ? { axe: 1 } : {}); // "axe" is a weapon id, just not a faction
      expect(objectPrototypeNames()).toEqual(names);
      expect(Object.getPrototypeOf(progressOf(store).winsByFaction)).toBe(Object.prototype);
    });

    it.each([
      ["__proto__", "__proto__"], ["constructor", "constructor"], ["bogus", "bogus"], ["the empty string", ""], ["in capitals", "AXE"],
      ["a faction given as the weapon", "fire"], ["a number", 3], ["an object", { axe: 1 }],
    ])("an unknown weapon id (%s) counts for nothing", (_label, weapon) => {
      const store = fresh();
      store.recordRun("alice", win({ weapon: weapon as string }));
      expect(progressOf(store).winsByWeapon).toEqual({});
      expect(store.get("alice")!.stats.wins).toBe(1); // the win itself still counts
    });

    it.each(["died", "draw", "mia"] as const)("a %s with a faction and a weapon counts nothing", (outcome) => {
      const store = fresh();
      store.recordRun("alice", run(outcome, { kills: 2, faction: "fire", weapon: "axe" }));
      expect(progressOf(store)).toEqual({ ...zeroProgress(), bestRunKills: 2 });
    });

    it("a faction win unlocks that faction's title; each faction has its own", () => {
      const titles: Record<string, [string, string]> = {
        fire: ["win_fire", "title-pyre-lord"], sentenced: ["win_sentenced", "title-the-judge"], plague: ["win_plague", "title-rat-king"],
        frost: ["win_frost", "title-ice-wall"], holy: ["win_holy", "title-demon-blood"],
      };
      for (const faction of GOLD_FACTIONS) {
        const store = fresh();
        const [achievement, title] = titles[faction]!;
        const { unlocked } = store.recordRun("alice", win({ faction }));
        expect(unlocked, faction).toEqual(["first_win", achievement]);
        expect(ownedOf(store), faction).toEqual(["title-victor", "skin-laurel", title]);
      }
    });

    it("3 wins as fire unlock gild_fire and grant the golden variant; 2 do not", () => {
      const store = fresh();
      store.recordRun("alice", win({ faction: "fire" }));
      expect(store.recordRun("alice", win({ faction: "fire" })).unlocked).toEqual([]);
      expect(ownedOf(store)).not.toContain("gilded-fire");
      store.recordRun("alice", win({ faction: "frost" })); // another faction does not help
      expect(store.get("alice")!.achievements).not.toHaveProperty("gild_fire");
      expect(store.recordRun("alice", win({ faction: "fire" })).unlocked).toEqual(["gild_fire"]);
      expect(ownedOf(store)).toContain("gilded-fire");
    });

    it("a golden variant that was bought first is not granted a second time", () => {
      const store = openWith(owning("alice", ["gilded-fire"], { stats: { ...zeroStats, runs: 2, wins: 2 }, achievements: { glorious: 1, first_win: 1, win_fire: 1 },
        progress: { ...zeroProgress(), qualifiedWins: 2, winsByFaction: { fire: 2 } } }));
      expect(store.recordRun("alice", win({ faction: "fire" })).unlocked).toEqual(["gild_fire"]);
      expect(ownedOf(store)).toEqual(["gilded-fire"]);
      expect(store.get("alice")!.gv).toBe(5000);
    });

    it("5 wins holding the axe unlock gild_axe; 4 do not, and wins with other weapons do not count", () => {
      const store = fresh();
      for (let i = 0; i < 4; i++) store.recordRun("alice", win({ weapon: "axe" }));
      store.recordRun("alice", win({ weapon: "sword" }));
      expect(store.get("alice")!.achievements).not.toHaveProperty("gild_axe");
      expect(ownedOf(store)).not.toContain("gilded-axe");
      expect(store.recordRun("alice", win({ weapon: "axe" })).unlocked).toEqual(["gild_axe"]);
      expect(ownedOf(store)).toContain("gilded-axe");
      expect(progressOf(store).winsByWeapon).toEqual({ axe: 5, sword: 1 });
    });

    it("a win with each of the five factions unlocks cycle_breaker, on the fifth faction and not before", () => {
      const store = fresh();
      const stages = GOLD_FACTIONS.map((faction) => store.recordRun("alice", win({ faction })).unlocked);
      expect(stages[0]).toEqual(["first_win", "win_fire"]);
      expect(stages[1]).toEqual(["win_sentenced"]);
      expect(stages[2]).toEqual(["win_plague"]);
      expect(stages[3]).toEqual(["win_frost"]);
      expect(stages[4]).toEqual(["champion", "win_holy", "cycle_breaker"]); // the 5th win is also the 5th win overall
      expect(ownedOf(store)).toContain("title-cycle-breaker");
    });

    it("wins with only four factions, however many, do not", () => {
      const store = fresh();
      for (let i = 0; i < 3; i++) for (const faction of GOLD_FACTIONS.slice(0, 4)) store.recordRun("alice", win({ faction }));
      expect(store.get("alice")!.achievements).not.toHaveProperty("cycle_breaker");
    });
  });

  describe("qualified wins only (the anti alt-farming gate)", () => {
    // Everything that reads a win count: the three win ladders, a title per faction, and the golden variants.
    const WIN_GOAL_IDS = ACHIEVEMENTS.filter(
      (a) => (a.goal.kind === "progress" && a.goal.key === "qualifiedWins") || ["factionWins", "weaponWins", "everyFactionWins"].includes(a.goal.kind),
    ).map((a) => a.id);
    const winEarned = (store: JsonProfileStore) => Object.keys(store.get("alice")!.achievements).filter((id) => WIN_GOAL_IDS.includes(id));

    it("knows which achievements the gate covers", () => {
      expect(WIN_GOAL_IDS).toEqual(expect.arrayContaining([
        "first_win", "champion", "warlord", "win_fire", "win_holy", "gild_fire", "gild_holy", "gild_sword", "gild_shield", "cycle_breaker",
      ]));
      expect(WIN_GOAL_IDS).toHaveLength(3 + 5 + 1 + 5 + 5);
    });

    it("a walkover counts as a win and a run and as nothing else a win goal reads", () => {
      const store = fresh();
      expect(store.recordRun("alice", walkover({ gv: 25, faction: "fire", weapon: "axe" }))).toEqual({ unlocked: [] });
      const r = store.get("alice")!;
      expect(r.stats).toEqual({ runs: 1, wins: 1, draws: 0, deaths: 0, kills: 0 });
      expect(r.progress).toEqual(zeroProgress());
      expect(r.achievements).toEqual({});
      expect(r.cosmetics.owned).toEqual([]);
      expect(r.gv).toBe(25); // the run still pays
    });

    it("winQualified false is a walkover too", () => {
      const store = fresh();
      expect(store.recordRun("alice", run("won", { winQualified: false, faction: "fire" }))).toEqual({ unlocked: [] });
      expect(progressOf(store)).toEqual(zeroProgress());
    });

    it("walkovers in every faction and with every weapon, past every threshold, unlock none of the win achievements", () => {
      const store = fresh();
      const weapons = ["sword", "axe", "bow", "wand", "shield"];
      // 30 walkovers: 6 per faction (gild_* needs 3), 6 per weapon (gild_* needs 5), well past first_win and champion.
      for (let i = 0; i < 30; i++) {
        const result = store.recordRun("alice", walkover({ gv: 10, faction: GOLD_FACTIONS[i % 5], weapon: weapons[i % 5] }));
        expect(result.unlocked, `walkover ${i + 1}`).toEqual(i === 24 ? ["veteran"] : []); // the 25th run of any kind is veteran
      }
      const r = store.get("alice")!;
      expect(winEarned(store)).toEqual([]);
      expect(Object.keys(r.achievements)).toEqual(["veteran"]);
      expect(r.stats).toMatchObject({ runs: 30, wins: 30 });
      expect(r.progress).toEqual(zeroProgress());
      expect(r.cosmetics.owned).toEqual(["title-veteran", "skin-ghost"]);
      expect(r.gv).toBe(300);
    });

    it("the next qualified win unlocks first_win once, however many walkovers came first", () => {
      const store = fresh();
      for (let i = 0; i < 12; i++) store.recordRun("alice", walkover({ faction: "fire", weapon: "axe" }));
      expect(store.recordRun("alice", win({ faction: "fire", weapon: "axe" }))).toEqual({ unlocked: ["first_win", "win_fire"] });
      const stamp = store.get("alice")!.achievements.first_win;
      expect(stamp).toBe(now);
      expect(store.get("alice")!.stats.wins).toBe(13);
      expect(progressOf(store).qualifiedWins).toBe(1);
      expect(ownedOf(store)).toEqual(["title-victor", "skin-laurel", "title-pyre-lord"]);

      now += 1000;
      expect(store.recordRun("alice", walkover({ faction: "fire" })).unlocked).toEqual([]);
      expect(store.recordRun("alice", win({ faction: "frost" })).unlocked).toEqual(["win_frost"]); // not first_win again
      expect(store.get("alice")!.achievements.first_win).toBe(stamp);
      expect(winEarned(store)).toEqual(["first_win", "win_fire", "win_frost"]);
    });

    it.each(["died", "draw", "mia"] as const)("the flag on a %s counts nothing: only a win can be a qualified win", (outcome) => {
      const store = fresh();
      expect(store.recordRun("alice", run(outcome, { winQualified: true, faction: "fire", weapon: "axe", gv: 10 }))).toEqual({ unlocked: [] });
      expect(progressOf(store)).toEqual(zeroProgress());
      expect(store.get("alice")!.stats.wins).toBe(0);
    });

    it("5 walkovers and 4 qualified wins do not unlock champion; the 5th qualified win does", () => {
      const store = fresh();
      for (let i = 0; i < 5; i++) store.recordRun("alice", walkover());
      for (let i = 0; i < 4; i++) store.recordRun("alice", win());
      expect(winEarned(store)).toEqual(["first_win"]);
      expect(store.get("alice")!.stats.wins).toBe(9);
      expect(store.recordRun("alice", win()).unlocked).toEqual(["champion"]);
      expect(ownedOf(store)).toContain("title-champion");
    });

    it("19 qualified wins do not unlock warlord, however many walkovers are mixed in; the 20th does", () => {
      const store = fresh();
      const seen: string[] = [];
      for (let i = 0; i < 19; i++) {
        seen.push(...store.recordRun("alice", win()).unlocked);
        seen.push(...store.recordRun("alice", walkover()).unlocked);
      }
      expect(seen.filter((id) => WIN_GOAL_IDS.includes(id))).toEqual(["first_win", "champion"]);
      expect(store.get("alice")!.stats.wins).toBe(38);
      expect(progressOf(store).qualifiedWins).toBe(19);
      expect(store.recordRun("alice", win()).unlocked).toEqual(["warlord"]);
      expect(ownedOf(store)).toContain("title-warlord");
    });

    it("20 walkovers in a row are not 20 wins: warlord stays locked", () => {
      const store = fresh();
      for (let i = 0; i < 20; i++) store.recordRun("alice", walkover());
      expect(store.get("alice")!.achievements).toEqual({});
    });

    it("the faction and weapon goals count qualified wins only: 2 qualified fire wins and 5 fire walkovers are still 2", () => {
      const store = fresh();
      for (let i = 0; i < 5; i++) store.recordRun("alice", walkover({ faction: "fire", weapon: "axe" }));
      for (let i = 0; i < 2; i++) store.recordRun("alice", win({ faction: "fire", weapon: "axe" }));
      expect(progressOf(store)).toMatchObject({ qualifiedWins: 2, winsByFaction: { fire: 2 }, winsByWeapon: { axe: 2 } });
      expect(store.get("alice")!.achievements).not.toHaveProperty("gild_fire");
      expect(store.recordRun("alice", win({ faction: "fire", weapon: "axe" })).unlocked).toEqual(["gild_fire"]);
    });

    it("cycle_breaker needs a qualified win with every faction: five walkovers, one per faction, give none", () => {
      const store = fresh();
      for (const faction of GOLD_FACTIONS) store.recordRun("alice", walkover({ faction }));
      expect(store.get("alice")!.achievements).toEqual({});
      for (const faction of GOLD_FACTIONS) store.recordRun("alice", win({ faction }));
      expect(store.get("alice")!.achievements).toHaveProperty("cycle_breaker");
    });

    it("the gate is about wins only: a walkover's kills, bounty and GV still unlock their own achievements", () => {
      const store = fresh();
      expect(store.recordRun("alice", walkover({ kills: 5, gv: 50, bounty: 10, faction: "fire", weapon: "axe" })).unlocked)
        .toEqual(["first_blood", "rampage", "bounty_hunter"]);
      expect(store.get("alice")).toMatchObject({ gv: 50, stats: { runs: 1, wins: 1, kills: 5 } });
    });

    it("the qualified count survives a restart, and unlocking carries on from it", async () => {
      const store = fresh();
      for (let i = 0; i < 19; i++) store.recordRun("alice", win());
      for (let i = 0; i < 3; i++) store.recordRun("alice", walkover());
      await store.flush();
      expect(readFile().profiles.alice.progress.qualifiedWins).toBe(19);
      const back = open();
      expect(progressOf(back).qualifiedWins).toBe(19);
      expect(back.get("alice")!.stats.wins).toBe(22);
      expect(back.recordRun("alice", walkover()).unlocked).toEqual([]);
      expect(back.recordRun("alice", win()).unlocked).toEqual(["warlord"]);
    });
  });

  describe("lifetime GV", () => {
    it("crossing 1000 through bankGv unlocks glorious silently, and it survives a restart", async () => {
      const store = fresh();
      store.bankGv("alice", 999);
      expect(store.get("alice")!.achievements).toEqual({});
      now += 777;
      expect(store.bankGv("alice", 1)).toBeUndefined(); // nobody is there to be told
      expect(store.get("alice")!.achievements).toEqual({ glorious: now });
      expect(ownedOf(store)).toEqual(["title-glorious"]);
      await store.flush();
      const back = open().get("alice")!;
      expect(back.achievements).toEqual({ glorious: now });
      expect(back.cosmetics.owned).toEqual(["title-glorious"]);
    });

    it("crossing 1000 through a run unlocks it in that run's result", () => {
      const store = fresh();
      store.bankGv("alice", 900);
      expect(store.recordRun("alice", loss({ gv: 100 })).unlocked).toEqual(["glorious"]);
    });

    it("counts what was earned, not what is left: spending does not hold it back", () => {
      const store = fresh();
      const token = store.get("alice")!.token;
      store.bankGv("alice", 900);
      for (const id of ["gilded-fire", "gilded-frost"]) store.purchase("alice", token, id); // 900 -> 100
      expect(store.get("alice")!.gv).toBe(100);
      store.bankGv("alice", 100);
      expect(store.get("alice")).toMatchObject({ gv: 200, gvLifetime: 1000 });
      expect(Object.keys(store.get("alice")!.achievements)).toEqual(["glorious"]);
    });

    it("banking a lot at once crosses the line once", () => {
      const store = fresh();
      store.bankGv("alice", 100_000);
      expect(store.get("alice")!.achievements).toEqual({ glorious: now });
      expect(ownedOf(store)).toEqual(["title-glorious"]);
    });

    it("banking that stays under 1000 unlocks nothing, and zero banks nothing at all", async () => {
      const store = fresh();
      store.bankGv("alice", 999);
      await expectNoWrite(store, () => store.bankGv("alice", 0));
      expect(store.get("alice")!.achievements).toEqual({});
    });
  });

  describe("reloading", () => {
    it("never re-unlocks anything, and keeps every timestamp", async () => {
      const store = fresh();
      store.recordRun("alice", win({ kills: 12, gv: 600, bounty: 40, faction: "fire", weapon: "axe" }));
      now += 1000;
      store.bankGv("alice", 500);
      await store.flush();
      const before = store.get("alice")!;
      expect(Object.keys(before.achievements)).toEqual(expect.arrayContaining(["first_blood", "slayer", "rampage", "bounty_hunter", "first_win", "glorious", "win_fire"]));

      now += 1_000_000;
      const back = open();
      expect(back.get("alice")).toEqual(before);
      expect(back.recordRun("alice", loss())).toEqual({ unlocked: [] });
      expect(back.recordRun("alice", win({ faction: "fire", weapon: "axe" }))).toEqual({ unlocked: [] });
      back.bankGv("alice", 1);
      const after = back.get("alice")!;
      expect(after.achievements).toEqual(before.achievements);
      expect(after.cosmetics.owned).toEqual(before.cosmetics.owned);
    });
  });

  describe("a call that throws changes nothing", () => {
    const everything = { kills: 9, gv: 500, bounty: 50, faction: "fire", weapon: "axe" };

    it("an unknown outcome leaves counters, achievements, GV and cosmetics as they were", async () => {
      const store = fresh();
      store.recordRun("alice", loss({ kills: 2, gv: 10 }));
      const before = store.get("alice")!;
      await expectNoWrite(store, () => {
        for (const outcome of ["extracted", "__proto__", "", "WON", undefined, null, 1]) {
          expect(() => store.recordRun("alice", { ...everything, outcome } as unknown as RunRecord), String(outcome)).toThrow(TypeError);
        }
      });
      expect(store.get("alice")).toEqual(before);
    });

    it("a clock that gives no usable date fails a paying run before any counter or achievement moves", async () => {
      const store = open(() => Number.NaN);
      store.claim("alice");
      const before = store.get("alice")!;
      await expectNoWrite(store, () => {
        expect(() => store.recordRun("alice", { ...everything, outcome: "won" })).toThrow(RangeError);
        expect(() => store.bankGv("alice", 5000)).toThrow(RangeError);
      });
      expect(store.get("alice")).toEqual(before);
    });

    it.each([Number.NaN, Infinity, -Infinity, -5, 1.5])(
      "a run with no GV still unlocks when the clock says %s, stamped 0, and the file stays loadable",
      async (bad) => {
        const store = open(() => bad);
        store.claim("alice");
        expect(store.recordRun("alice", win({ kills: 1 }))).toEqual({ unlocked: ["first_blood", "first_win"] });
        expect(store.get("alice")!.achievements).toEqual({ first_blood: 0, first_win: 0 });
        await store.flush();
        // An unusable stamp (NaN is written as null) would make the whole profile unreadable on the next start.
        const back = open();
        expect(back.get("alice")).toEqual(store.get("alice"));
        expect(back.verifyToken("alice", store.get("alice")!.token)).toBe(true);
      },
    );

    it("an unknown profile throws and creates nothing", async () => {
      const store = fresh();
      await expectNoWrite(store, () => {
        for (const name of ["nobody", "__proto__", "constructor"]) {
          expect(() => store.recordRun(name, { ...everything, outcome: "won" })).toThrow();
        }
      });
      expect(store.get("nobody")).toBeUndefined();
    });
  });

  describe("an old profile whose counters already earn achievements", () => {
    // Its win counter is the qualified one: a profile that counted 12 wins before the gate existed is a different case (see below).
    const old = (over: Record<string, unknown> = {}) =>
      withGv("alice", 0, { stats: { runs: 20, wins: 12, draws: 0, deaths: 8, kills: 0 }, progress: { ...zeroProgress(), qualifiedWins: 12 }, ...over });

    it("loads with nothing unlocked, and is not unlocked just by being loaded", async () => {
      const store = openWith(old());
      expect(store.get("alice")!.achievements).toEqual({});
      await store.flush();
      expect(store.get("alice")!.achievements).toEqual({});
    });

    it("12 qualified wins unlock first_win and champion the next time it banks a run", () => {
      const store = openWith(old());
      expect(store.recordRun("alice", loss())).toEqual({ unlocked: ["first_win", "champion"] });
      expect(store.get("alice")!.achievements).toEqual({ first_win: now, champion: now });
      expect(ownedOf(store)).toEqual(["title-victor", "skin-laurel", "title-champion"]);
      expect(store.recordRun("alice", loss())).toEqual({ unlocked: [] });
    });

    it("the next time it banks GV does as well, without a run", () => {
      const store = openWith(old());
      store.bankGv("alice", 5);
      expect(Object.keys(store.get("alice")!.achievements)).toEqual(["first_win", "champion"]);
      expect(ownedOf(store)).toEqual(["title-victor", "skin-laurel", "title-champion"]);
    });

    it("old kills, runs and lifetime GV count too (but progress counters it never kept do not)", () => {
      const store = openWith(withGv("alice", 0, {
        gv: 300, gvLifetime: 2000, gvByMonth: { "2026-01": 2000 },
        stats: { runs: 30, wins: 0, draws: 0, deaths: 30, kills: 60 },
      }));
      const { unlocked } = store.recordRun("alice", loss());
      expect(unlocked).toEqual(["first_blood", "slayer", "reaper", "veteran", "glorious"]);
      expect(ownedOf(store)).toEqual(["title-bloodied", "title-slayer", "title-reaper", "title-veteran", "skin-ghost", "title-glorious"]);
      expect(store.get("alice")!.achievements).not.toHaveProperty("rampage"); // bestRunKills started at 0
    });

    describe("that counted wins before there was a qualified win", () => {
      // A progress block as written before qualifiedWins existed.
      const legacyProgress = () => ({ bountyRuns: 0, bestRunKills: 0, winsByFaction: {}, winsByWeapon: {} });
      const legacy = (over: Record<string, unknown> = {}) =>
        withGv("alice", 0, { stats: { runs: 20, wins: 12, draws: 0, deaths: 8, kills: 0 }, progress: legacyProgress(), ...over });

      it("12 old wins give no win achievement: it loads with 0 qualified wins, and banking changes nothing", async () => {
        const store = openWith(legacy());
        expect(progressOf(store)).toEqual(zeroProgress());
        expect(store.get("alice")!.stats.wins).toBe(12);
        expect(store.recordRun("alice", loss())).toEqual({ unlocked: [] });
        store.bankGv("alice", 5);
        expect(store.recordRun("alice", walkover({ faction: "fire", weapon: "axe" }))).toEqual({ unlocked: [] });
        expect(store.get("alice")!.achievements).toEqual({});
        expect(ownedOf(store)).toEqual([]);
        await store.flush();
        expect(open().get("alice")!.achievements).toEqual({});
      });

      it("its first qualified win unlocks first_win and nothing the old count would have", () => {
        const store = openWith(legacy());
        expect(store.recordRun("alice", win({ faction: "plague" }))).toEqual({ unlocked: ["first_win", "win_plague"] });
        expect(store.get("alice")!.stats.wins).toBe(13);
        expect(progressOf(store).qualifiedWins).toBe(1);
        expect(store.get("alice")!.achievements).not.toHaveProperty("champion"); // 13 wins in all, but 1 qualified
      });

      it("a file with no progress block at all behaves the same", () => {
        const noProgress = legacy();
        const { progress: _dropped, ...rest } = noProgress;
        const store = openWith(rest as ReturnType<typeof fileProfile>);
        expect(progressOf(store)).toEqual(zeroProgress());
        expect(store.recordRun("alice", loss())).toEqual({ unlocked: [] });
        expect(store.recordRun("alice", win())).toEqual({ unlocked: ["first_win"] });
      });

      it("what it unlocked under the old rule stays unlocked and owned, and is not granted twice", () => {
        const store = openWith(legacy({
          achievements: { first_win: 7, champion: 7 }, cosmetics: { owned: ["title-victor", "skin-laurel", "title-champion"], equipped: { title: "title-champion" } },
        }));
        expect(store.recordRun("alice", win())).toEqual({ unlocked: [] });
        const r = store.get("alice")!;
        expect(r.achievements).toEqual({ first_win: 7, champion: 7 });
        expect(r.cosmetics).toEqual({ owned: ["title-victor", "skin-laurel", "title-champion"], equipped: { title: "title-champion" } });
        expect(r.progress.qualifiedWins).toBe(1);
      });
    });

    it("rewards it already owns are kept once", () => {
      const store = openWith(old({ cosmetics: { owned: ["skin-laurel"], equipped: { skin: "skin-laurel" } } }));
      store.recordRun("alice", loss());
      expect(ownedOf(store)).toEqual(["skin-laurel", "title-victor", "title-champion"]);
      expect(store.get("alice")!.cosmetics.equipped).toEqual({ skin: "skin-laurel" });
    });
  });

  it("every achievement's rewards are cosmetics that exist", () => {
    for (const a of ACHIEVEMENTS) for (const id of a.reward) expect(cosmeticById(id), `${a.id} -> ${id}`).toBeDefined();
  });
});

// ---------------------------------------------------------------- persistence of the meta fields
describe("persistence of the meta layer", () => {
  it("a v2 file written before achievements and progress existed loads with defaults and every other field intact", async () => {
    const legacy = {
      name: "alice", token: "t-alice", gv: 120, gvLifetime: 300, gvByMonth: { "2026-09": 100, "2026-10": 200 },
      stats: { runs: 9, wins: 2, draws: 1, deaths: 6, kills: 14 },
      cosmetics: { owned: ["skin-crimson", "title-rookie"], equipped: { skin: "skin-crimson" } },
    };
    const text = JSON.stringify({ version: 2, profiles: { alice: legacy } });
    fs.writeFileSync(file, text);
    const { log, error } = quiet();
    const store = open();
    expect(store.get("alice")).toEqual({ ...legacy, achievements: {}, progress: zeroProgress() });
    expect(store.verifyToken("alice", "t-alice")).toBe(true);
    // An older file is not damaged: no backup, no rewrite, no noise.
    await store.flush();
    expect([log, error].map((s) => s.mock.calls.length)).toEqual([0, 0]);
    expect(fs.readFileSync(file, "utf8")).toBe(text);
    expect(fs.readdirSync(dir)).toEqual(["stash.json"]);

    // Its first change writes the new fields.
    store.bankGv("alice", 1);
    await store.flush();
    const disk = readFile().profiles.alice;
    expect(Object.keys(disk).sort()).toEqual(["achievements", "cosmetics", "gv", "gvByMonth", "gvLifetime", "name", "progress", "stats", "token"]);
    expect(disk.progress).toEqual(zeroProgress());
    expect(disk.cosmetics.equipped).toEqual({ skin: "skin-crimson" });
  });

  it("a profile that has only one of the two new fields keeps what it has and defaults the other", () => {
    const base = fileProfile("alice");
    const progress = base.progress;
    const rest: Record<string, unknown> = { ...base };
    delete rest.achievements;
    delete rest.progress;
    fs.writeFileSync(file, JSON.stringify({
      version: 2,
      profiles: {
        alice: { ...rest, achievements: { first_win: 5 } },
        bobby: { ...rest, name: "bobby", token: "t-bobby", progress: { ...progress, bountyRuns: 2, bestRunKills: 3 } },
      },
    }));
    const store = open();
    expect(store.get("alice")).toMatchObject({ achievements: { first_win: 5 }, progress: zeroProgress() });
    expect(store.get("bobby")).toMatchObject({ achievements: {}, progress: { ...zeroProgress(), bountyRuns: 2, bestRunKills: 3 } });
  });

  describe("garbage in the new fields drops that profile like any other malformed entry and keeps the rest", () => {
    const good = fileProfile("alice", { achievements: { first_win: 5 }, progress: { qualifiedWins: 1, bountyRuns: 1, bestRunKills: 2, winsByFaction: { fire: 1 }, winsByWeapon: { axe: 1 } } });
    const bad = (over: Record<string, unknown>) => fileProfile("bobby", over);
    const progressWith = (over: Record<string, unknown>) => ({ ...zeroProgress(), ...over });
    const cases: Array<[string, unknown]> = [
      ["achievements that is null", bad({ achievements: null })],
      ["achievements that is a list", bad({ achievements: [] })],
      ["achievements that is a string", bad({ achievements: "first_win" })],
      ["achievements that is a number", bad({ achievements: 5 })],
      ["a negative unlock time", bad({ achievements: { first_win: -1 } })],
      ["a fractional unlock time", bad({ achievements: { first_win: 1.5 } })],
      ["an unlock time that is a string", bad({ achievements: { first_win: "yesterday" } })],
      ["an unlock time that is null", bad({ achievements: { first_win: null } })],
      ["progress that is null", bad({ progress: null })],
      ["progress that is a list", bad({ progress: [] })],
      ["progress that is a string", bad({ progress: "none" })],
      ["progress that is a number", bad({ progress: 5 })],
      ["progress without its counters", bad({ progress: {} })],
      ["a negative qualifiedWins", bad({ progress: progressWith({ qualifiedWins: -1 }) })],
      ["a fractional qualifiedWins", bad({ progress: progressWith({ qualifiedWins: 1.5 }) })],
      ["a qualifiedWins that is a string", bad({ progress: progressWith({ qualifiedWins: "3" }) })],
      ["a qualifiedWins that is null (what JSON makes of NaN and Infinity)", bad({ progress: progressWith({ qualifiedWins: null }) })],
      ["a qualifiedWins that is a boolean", bad({ progress: progressWith({ qualifiedWins: true }) })],
      ["a qualifiedWins that is a list", bad({ progress: progressWith({ qualifiedWins: [] }) })],
      ["a qualifiedWins that is an object", bad({ progress: progressWith({ qualifiedWins: { n: 1 } }) })],
      ["a qualifiedWins one past the largest exact integer", bad({ progress: progressWith({ qualifiedWins: 2 ** 53 }) })],
      ["progress without bestRunKills", bad({ progress: { bountyRuns: 0, winsByFaction: {}, winsByWeapon: {} } })],
      ["a negative bountyRuns", bad({ progress: progressWith({ bountyRuns: -1 }) })],
      ["a fractional bountyRuns", bad({ progress: progressWith({ bountyRuns: 1.5 }) })],
      ["a bestRunKills that is a string", bad({ progress: progressWith({ bestRunKills: "3" }) })],
      ["a negative bestRunKills", bad({ progress: progressWith({ bestRunKills: -4 }) })],
      ["winsByFaction that is null", bad({ progress: progressWith({ winsByFaction: null }) })],
      ["winsByFaction that is a list", bad({ progress: progressWith({ winsByFaction: [] }) })],
      ["a negative faction count", bad({ progress: progressWith({ winsByFaction: { fire: -1 } }) })],
      ["a faction count that is a string", bad({ progress: progressWith({ winsByFaction: { fire: "2" } }) })],
      ["winsByWeapon that is a number", bad({ progress: progressWith({ winsByWeapon: 5 }) })],
      ["a fractional weapon count", bad({ progress: progressWith({ winsByWeapon: { axe: 1.5 } }) })],
    ];

    it.each(cases)("%s", async (_label, entry) => {
      const text = JSON.stringify({ version: 2, profiles: { alice: good, bobby: entry } });
      fs.writeFileSync(file, text);
      const { error } = quiet();
      const store = open();
      expect(store.get("bobby")).toBeUndefined();
      expect(store.get("alice")).toEqual(good);
      expect(store.verifyToken("alice", "t-alice")).toBe(true);
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0]![0])).toContain("dropped 1 malformed profile");
      const backup = fs.readdirSync(dir).filter((n) => n.startsWith("stash.json.bak-"));
      expect(backup).toHaveLength(1);
      expect(fs.readFileSync(path.join(dir, backup[0]!), "utf8")).toBe(text);
      await vi.waitFor(() => expect(readFile()).toEqual({ version: 2, profiles: { alice: good } }));
    });
  });

  it("flush after a purchase writes the file through a temp file and a rename, and leaves no temp file behind", async () => {
    const store = open();
    const token = signUp(store, "alice", 100);
    await store.flush();
    const rename = vi.spyOn(fs.promises, "rename");
    const openFile = vi.spyOn(fs.promises, "open");
    store.purchase("alice", token, "skin-crimson");
    await store.flush();
    expect(openFile).toHaveBeenCalledWith(`${file}.tmp`, "w");
    expect(rename).toHaveBeenCalledWith(`${file}.tmp`, file);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    expect(fs.readdirSync(dir)).toEqual(["stash.json"]);
    expect(readFile().profiles.alice).toMatchObject({ gv: 60, cosmetics: { owned: ["skin-crimson"] } });
  });

  it("a burst of purchases, equips and runs costs one write, and the file ends up equal to the store", async () => {
    const store = open();
    const token = signUp(store, "alice", 300);
    await store.flush();
    const rename = vi.spyOn(fs.promises, "rename");
    store.purchase("alice", token, "skin-crimson");
    store.purchase("alice", token, "title-rookie");
    store.equip("alice", token, "skin", "skin-crimson");
    store.equip("alice", token, "title", "title-rookie");
    store.recordRun("alice", { outcome: "won", kills: 6, gv: 80, bounty: 20, faction: "holy", weapon: "wand", winQualified: true });
    await store.flush();
    expect(rename).toHaveBeenCalledTimes(1);
    expect(open().get("alice")).toEqual(store.get("alice"));
    expect(fs.readdirSync(dir)).toEqual(["stash.json"]);
  });

  it("a restart brings back purchases, equipment, achievements and counters, and the economy keeps working", async () => {
    const store = open();
    const token = signUp(store, "alice", 200);
    store.purchase("alice", token, "skin-crimson");
    store.equip("alice", token, "skin", "skin-crimson");
    store.recordRun("alice", { outcome: "won", kills: 5, gv: 100, bounty: 30, faction: "fire", weapon: "axe", winQualified: true });
    store.equip("alice", token, "title", "title-victor");
    await store.flush();
    const before = store.get("alice")!;

    const back = open();
    expect(back.get("alice")).toEqual(before);
    expect(back.get("alice")!.progress).toEqual({ qualifiedWins: 1, bountyRuns: 1, bestRunKills: 5, winsByFaction: { fire: 1 }, winsByWeapon: { axe: 1 } });
    expect(back.purchase("alice", token, "skin-crimson")).toStrictEqual(refused("already_owned"));
    expect(ok(back.purchase("alice", token, "outline-white")).gv).toBe(before.gv - 50);
    expect(back.equip("alice", token, "skin", null)).toMatchObject({ ok: true });
    expect(back.equip("alice", "other", "skin", null)).toStrictEqual(refused("forbidden"));
  });
});

// ---------------------------------------------------------------- the leaderboard
describe("leaderboard with titles, ranks and months", () => {
  /** `rows`: name -> GV banked in `month`, each in the month's own clock. */
  function seed(rows: Record<string, number>, month = OCT) {
    const store = open(() => Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 10));
    for (const [name, gv] of Object.entries(rows)) {
      store.claim(name);
      store.bankGv(name, gv);
    }
    return store;
  }

  describe("title", () => {
    const wearing = (name: string, owned: string[], title: string | undefined, over: Record<string, unknown> = {}) =>
      withGv(name, 0, {
        gv: 10, gvLifetime: 10, gvByMonth: { [OCT]: 10 },
        cosmetics: { owned, equipped: title === undefined ? {} : { title } }, ...over,
      });

    it("shows for a profile that owns and wears a title, and the key is absent for everyone else", () => {
      const store = openWith(
        wearing("alice", ["title-victor"], "title-victor"),
        wearing("bobby", ["title-victor"], undefined), // owns, not worn
        wearing("carol", [], "title-victor"), // worn, not owned
        wearing("dave", ["skin-crimson"], undefined),
      );
      const board = store.leaderboard(OCT, 10);
      expect(board).toStrictEqual([
        { name: "alice", gv: 10, title: "title-victor" },
        { name: "bobby", gv: 10 },
        { name: "carol", gv: 10 },
        { name: "dave", gv: 10 },
      ]);
      for (const entry of board.slice(1)) expect(Object.hasOwn(entry, "title"), entry.name).toBe(false);
    });

    it("only a title counts: a skin, a gilded item, an unknown id or a made up slot value in the title slot does not", () => {
      const store = openWith(
        wearing("alice", ["skin-crimson"], "skin-crimson"),
        wearing("bobby", ["gilded-fire"], "gilded-fire"),
        wearing("carol", ["bogus"], "bogus"),
        wearing("dave", ["__proto__"], "__proto__"),
        wearing("eve", ["title-rookie"], "title-victor"), // owns one title, wears another it does not own
      );
      for (const entry of store.leaderboard(OCT, 10)) expect(Object.hasOwn(entry, "title"), entry.name).toBe(false);
    });

    it("a title in another slot is not a title", () => {
      const store = openWith(wearing("alice", ["title-rookie"], undefined, { cosmetics: { owned: ["title-rookie"], equipped: { skin: "title-rookie" } } }));
      expect(store.leaderboard(OCT, 10)).toStrictEqual([{ name: "alice", gv: 10 }]);
    });

    it("follows equip and unequip, and an item the profile never bought stays off", () => {
      const store = openWith(withGv("alice", 100, { gvByMonth: { [OCT]: 100 }, cosmetics: { owned: ["title-rookie", "title-victor"], equipped: {} } }));
      expect(store.leaderboard(OCT, 5)).toStrictEqual([{ name: "alice", gv: 100 }]);
      ok(store.equip("alice", "t-alice", "title", "title-rookie"));
      expect(store.leaderboard(OCT, 5)).toStrictEqual([{ name: "alice", gv: 100, title: "title-rookie" }]);
      ok(store.equip("alice", "t-alice", "title", "title-victor"));
      expect(store.leaderboard(OCT, 5)).toStrictEqual([{ name: "alice", gv: 100, title: "title-victor" }]);
      ok(store.equip("alice", "t-alice", "title", null));
      expect(store.leaderboard(OCT, 5)).toStrictEqual([{ name: "alice", gv: 100 }]);
    });

    it("a title earned from an achievement shows once it is worn", () => {
      const store = seed({ alice: 50 });
      store.recordRun("alice", { outcome: "won", kills: 0, gv: 0, winQualified: true });
      ok(store.equip("alice", store.get("alice")!.token, "title", "title-victor"));
      expect(store.leaderboard(OCT, 5)).toStrictEqual([{ name: "alice", gv: 50, title: "title-victor" }]);
    });

    it("carries the id and nothing else: no token, no cosmetics list", () => {
      const store = openWith(wearing("alice", ["title-victor", "skin-crimson"], "title-victor", { token: "secret-token-alice" }));
      const text = JSON.stringify(store.leaderboard(OCT, 5));
      expect(text).not.toContain("secret-token-alice");
      expect(text).not.toContain("skin-crimson");
      expect(Object.keys(store.leaderboard(OCT, 5)[0]!).sort()).toEqual(["gv", "name", "title"]);
    });

    it("returned rows are copies", () => {
      const store = openWith(wearing("alice", ["title-victor"], "title-victor"));
      store.leaderboard(OCT, 5)[0]!.title = "hacked";
      expect(store.leaderboard(OCT, 5)[0]!.title).toBe("title-victor");
    });
  });

  describe("rank", () => {
    it("agrees with the order of leaderboard() for everyone, ties and awkward names included", () => {
      const store = seed({ mike: 5, Zed: 5, alice: 5, bobby: 9, "al-ice": 5, al_ice: 5, A1: 7, a1: 7, z9: 1, "0day": 5, top: 100 });
      const rows = store.leaderboard(OCT, 100);
      expect(rows.map((r) => r.name)).toEqual(["top", "bobby", "A1", "a1", "0day", "Zed", "al-ice", "al_ice", "alice", "mike", "z9"]);
      rows.forEach((row, i) => {
        expect(store.leaderboardRank(OCT, row.name), row.name).toEqual({ rank: i + 1, gv: row.gv });
      });
    });

    it("tied profiles have different ranks, ordered by name, and rank 1 is the top of the board", () => {
      const store = seed({ bb: 10, a1: 10, cc: 10 });
      expect(["a1", "bb", "cc"].map((n) => store.leaderboardRank(OCT, n)!.rank)).toEqual([1, 2, 3]);
    });

    it("works past the board's limit: rank 120 is 120 even though only 100 rows can be listed", () => {
      const rows: Record<string, number> = {};
      for (let i = 0; i < 130; i++) rows[`p${String(i).padStart(3, "0")}`] = i + 1;
      const store = seed(rows);
      expect(store.leaderboard(OCT, 1000)).toHaveLength(100);
      expect(store.leaderboardRank(OCT, "p129")).toEqual({ rank: 1, gv: 130 });
      expect(store.leaderboardRank(OCT, "p009")).toEqual({ rank: 121, gv: 10 });
      expect(store.leaderboardRank(OCT, "p000")).toEqual({ rank: 130, gv: 1 });
    });

    it("is undefined for a profile with nothing banked in that month, an unknown name, and a bad month", () => {
      const store = seed({ alice: 30 });
      store.claim("idle");
      expect(store.leaderboardRank(OCT, "idle")).toBeUndefined();
      expect(store.leaderboardRank(OCT, "nobody")).toBeUndefined();
      expect(store.leaderboardRank(OCT, "__proto__")).toBeUndefined();
      expect(store.leaderboardRank("2020-01", "alice")).toBeUndefined();
      for (const bad of ["", "2026-13", "2026-00", "2026-1", "__proto__", "2026-10-01"]) expect(store.leaderboardRank(bad, "alice"), bad).toBeUndefined();
      expect(store.leaderboardRank(undefined as unknown as string, "alice")).toBeUndefined();
      expect(store.leaderboardRank(OCT, undefined as unknown as string)).toBeUndefined();
      expect(store.leaderboardRank(OCT, "alice")).toEqual({ rank: 1, gv: 30 });
    });

    it("a profile named like an Object.prototype member ranks like any other", () => {
      const store = open();
      store.claim("__proto__");
      store.bankGv("__proto__", 5);
      store.claim("constructor");
      store.bankGv("constructor", 9);
      expect(store.leaderboardRank(OCT, "constructor")).toEqual({ rank: 1, gv: 9 });
      expect(store.leaderboardRank(OCT, "__proto__")).toEqual({ rank: 2, gv: 5 });
    });

    it("each month has its own ranking, and spending GV does not move anyone", () => {
      const store = open();
      const a = signUp(store, "alice", 300);
      signUp(store, "bobby", 200);
      now = Date.UTC(2026, 10, 3);
      store.bankGv("bobby", 50);
      store.purchase("alice", a, "trail-ember");
      expect(store.leaderboardRank(OCT, "alice")).toEqual({ rank: 1, gv: 300 });
      expect(store.leaderboardRank(OCT, "bobby")).toEqual({ rank: 2, gv: 200 });
      expect(store.leaderboardRank("2026-11", "bobby")).toEqual({ rank: 1, gv: 50 });
      expect(store.leaderboardRank("2026-11", "alice")).toBeUndefined();
    });

    it("moves when GV is banked", () => {
      const store = seed({ alice: 30, bobby: 20 });
      expect(store.leaderboardRank(OCT, "bobby")).toEqual({ rank: 2, gv: 20 });
      store.bankGv("bobby", 11);
      expect(store.leaderboardRank(OCT, "bobby")).toEqual({ rank: 1, gv: 31 });
      expect(store.leaderboardRank(OCT, "alice")).toEqual({ rank: 2, gv: 30 });
    });
  });

  describe("months", () => {
    const monthsFile = (months: Array<[string, Record<string, number>]>) =>
      openWith(...months.map(([name, gvByMonth]) => withGv(name, 0, { gvByMonth })));

    it("lists the months anyone banked GV in, newest first, across years", () => {
      const store = monthsFile([
        ["alice", { "2025-12": 5, "2026-03": 9 }],
        ["bobby", { "2026-01": 1, "2024-11": 1 }],
        ["carol", { "2026-10": 4 }],
      ]);
      expect(store.leaderboardMonths(24)).toEqual(["2026-10", "2026-03", "2026-01", "2025-12", "2024-11"]);
    });

    it("lists a month once however many profiles played in it, and only months with GV above zero", () => {
      const store = monthsFile([
        ["alice", { "2026-03": 5, "2026-04": 0 }],
        ["bobby", { "2026-03": 9, "2026-05": 0 }],
        ["carol", { "2026-03": 1, "2026-02": 3 }],
        ["dave", {}],
      ]);
      expect(store.leaderboardMonths(24)).toEqual(["2026-03", "2026-02"]);
    });

    it("respects the limit", () => {
      const store = monthsFile([["alice", { "2026-01": 1, "2026-02": 1, "2026-03": 1, "2026-04": 1, "2026-05": 1 }]]);
      expect(store.leaderboardMonths(2)).toEqual(["2026-05", "2026-04"]);
      expect(store.leaderboardMonths(1)).toEqual(["2026-05"]);
      expect(store.leaderboardMonths(2.9)).toEqual(["2026-05", "2026-04"]);
      expect(store.leaderboardMonths(5)).toHaveLength(5);
      expect(store.leaderboardMonths(1000)).toHaveLength(5);
      expect(store.leaderboardMonths(Infinity)).toHaveLength(5);
    });

    it("a limit that is zero, negative or not a number gives none", () => {
      // Several months, so a limit that wrongly counted from the end (slice(0, -1)) would show.
      const store = monthsFile([["alice", { "2026-01": 1, "2026-02": 1, "2026-03": 1 }]]);
      for (const limit of [0, -1, -2, -100, -Infinity, Number.NaN, 0.5]) expect(store.leaderboardMonths(limit), String(limit)).toEqual([]);
    });

    it("is empty when nobody has banked anything", () => {
      const store = open();
      store.claim("alice");
      expect(store.leaderboardMonths(24)).toEqual([]);
    });

    it("follows the clock: GV banked in a new month adds it at the front; spending removes nothing", () => {
      const store = open();
      const token = signUp(store, "alice", 100);
      expect(store.leaderboardMonths(24)).toEqual([OCT]);
      now = Date.UTC(2026, 11, 31, 23, 59, 59, 999);
      store.bankGv("alice", 1);
      now += 1;
      store.bankGv("alice", 1);
      store.purchase("alice", token, "trail-ember");
      expect(store.get("alice")!.gv).toBe(2);
      expect(store.leaderboardMonths(24)).toEqual(["2027-01", "2026-12", OCT]);
    });

    it("every listed month has a non-empty board, and every month with a board is listed", () => {
      const store = monthsFile([["alice", { "2026-03": 5, "2026-04": 0 }], ["bobby", { "2026-02": 9, "2026-03": 2 }]]);
      const listed = store.leaderboardMonths(24);
      for (const m of listed) expect(store.leaderboard(m, 10).length, m).toBeGreaterThan(0);
      for (const m of ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]) {
        expect(listed.includes(m), m).toBe(store.leaderboard(m, 10).length > 0);
      }
    });
  });
});
