// The shop and wardrobe over a real socket: the real server in this process on a free port and a temp profile file,
// seeded with GV before it starts. These tests attack the API as a stranger would: no token, someone else's token, a
// body that lies about prices, many requests at once, malformed and oversized bodies, the wrong method or content type.
// Every test takes its own accounts from the seeded pool (or claims a fresh name), so none depends on another.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  COSMETICS, LEADERBOARD_MAX_MONTHS, PROFILE_TOKEN_HEADER, cosmeticById, isForSale,
} from "@raid/shared";
import { loadConfig } from "../src/config";
import { startServer, type RaidServer } from "../src/index";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

// ---------------------------------------------------------------- seed data
const POOL_MONTH = "2015-06";
const zeroStats = () => ({ runs: 0, wins: 0, draws: 0, deaths: 0, kills: 0 });
const zeroProgress = () => ({ qualifiedWins: 0, bountyRuns: 0, bestRunKills: 0, winsByFaction: {}, winsByWeapon: {} });
const withMeta = () => ({ achievements: {}, progress: zeroProgress() });

interface Seed {
  name: string;
  token: string;
  gv: number;
  gvLifetime: number;
  gvByMonth: Record<string, number>;
  stats: ReturnType<typeof zeroStats>;
  cosmetics: { owned: string[]; equipped: Record<string, string> };
  [extra: string]: unknown;
}

/** A version 2 profile as the file holds it. Without `achievements`/`progress` it is a file from before the meta layer. */
function seed(name: string, gv: number, over: Partial<Seed> = {}): Seed {
  return {
    name, token: `tok-${name}`, gv, gvLifetime: gv, gvByMonth: gv > 0 ? { [POOL_MONTH]: gv } : {},
    stats: zeroStats(), cosmetics: { owned: [], equipped: {} }, ...over,
  };
}

const seeds: Seed[] = [];
const seedAll = (...list: Seed[]) => { seeds.push(...list); };

interface Account { name: string; token: string }
const account = (s: Seed): Account => ({ name: s.name, token: s.token });

/** Spendable-GV pools. Even entries carry the new fields, odd ones are written as an old file would have them. */
const POOL_SIZES: Record<number, number> = { 0: 5, 30: 5, 39: 5, 40: 60, 60: 12, 100: 400, 400: 5, 1000: 12, 10000: 6 };
const pools = new Map<number, Account[]>();
for (const [gvText, count] of Object.entries(POOL_SIZES)) {
  const gv = Number(gvText);
  const accounts: Account[] = [];
  for (let i = 0; i < count; i++) {
    const s = seed(`g${gv}_${String(i).padStart(4, "0")}`, gv, i % 2 === 0 ? withMeta() : {});
    seedAll(s);
    accounts.push(account(s));
  }
  pools.set(gv, accounts);
}

/** A seeded account that holds exactly `gv` and has bought nothing. */
function take(gv: number): Account {
  const next = pools.get(gv)?.shift();
  if (!next) throw new Error(`the seeded pool of ${gv} GV accounts is used up`);
  return next;
}

// Profiles for the old-file and name-clash checks.
const LEGACY = seed("legacy_1", 100);
const MODERN = seed("modern_1", 100, withMeta());
/** Meta fields from before `qualifiedWins` existed: other counters are set, so the default must not wipe them. */
const OLD_PROGRESS = seed("oldprog_1", 100, {
  achievements: { first_blood: 1_600_000_000_000 },
  progress: { bountyRuns: 2, bestRunKills: 3, winsByFaction: { fire: 2 }, winsByWeapon: {} },
});
const CASE_UPPER = seed("CaseMe", 100, withMeta());
const CASE_LOWER = seed("caseme", 100, withMeta());
const CLASH_NAMES = ["__proto__", "constructor", "toString"];
const clashing = CLASH_NAMES.map((n) => seed(n, 100, withMeta()));
const EARNED = seed("earned_1", 0, { cosmetics: { owned: ["skin-laurel", "title-bloodied", "trail-comet"], equipped: {} } });
seedAll(LEGACY, MODERN, OLD_PROGRESS, CASE_UPPER, CASE_LOWER, ...clashing, EARNED);

// The leaderboard fixtures, each in a month of its own.
const RANK_MONTH = "2016-04";
const rank = Array.from({ length: 30 }, (_, i) => {
  const earned = 300 - i;
  const over: Partial<Seed> = { gvLifetime: earned, gvByMonth: { [RANK_MONTH]: earned } };
  const cosmetics: Record<number, Seed["cosmetics"]> = {
    5: { owned: ["title-rookie"], equipped: { title: "title-rookie" } },
    6: { owned: [], equipped: { title: "title-slayer" } }, // equipped but never owned
    7: { owned: ["skin-crimson"], equipped: { skin: "skin-crimson" } }, // not a title
    8: { owned: ["skin-crimson"], equipped: { title: "skin-crimson" } }, // not a title in the title slot
    9: { owned: ["title-bloodied"], equipped: { title: "title-bloodied" } }, // an earned title
  };
  return seed(`rk_${String(i).padStart(2, "0")}`, 0, { ...over, ...(cosmetics[i] ? { cosmetics: cosmetics[i] } : {}) });
});
const earned = (name: string, month: string, monthly: number, spendable: number, over: Partial<Seed> = {}) =>
  seed(name, spendable, { gvLifetime: monthly, gvByMonth: { [month]: monthly }, ...over });
const TIE_MONTH = "2016-07";
const EARN_MONTH = "2016-08";
const TITLE_MONTH = "2016-06";
const LEAK_MONTH = "2016-10";
seedAll(
  ...rank,
  earned("tie_b", TIE_MONTH, 50, 0), earned("tie_a", TIE_MONTH, 50, 0), earned("tie_c", TIE_MONTH, 90, 0),
  earned("earn_a", EARN_MONTH, 1000, 1000), earned("earn_b", EARN_MONTH, 500, 500),
  earned("ttl_1", TITLE_MONTH, 777, 30), earned("ttl_2", TITLE_MONTH, 700, 0),
  earned("leak_x", LEAK_MONTH, 555, 4_242_424, { gvLifetime: 6_000_000 }),
  earned("mo_a", "2016-02", 10, 0), earned("mo_b", "2016-11", 5, 0), earned("mo_c", "2017-05", 7, 0),
  seed("mo_zero", 0, { gvByMonth: { "2016-09": 0 } }),
  seed("many_mo", 0, {
    gvByMonth: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`, 1])),
  }),
);

/** Months in which someone banked GV, newest first: what `months` has to say (before the cap). */
const monthsWithGv = [...new Set(seeds.flatMap((s) => Object.entries(s.gvByMonth).filter(([, gv]) => gv > 0).map(([m]) => m)))].sort().reverse();

const PROFILE_FIELDS = ["achievements", "cosmetics", "gv", "gvByMonth", "gvLifetime", "name", "progress", "stats"];
const PROTOTYPE_KEYS = Object.getOwnPropertyNames(Object.prototype).sort();

// ---------------------------------------------------------------- server fixture
let server: RaidServer;
let port = 0;
let dir = "";
let profileFile = "";

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-shop-"));
  profileFile = path.join(dir, "data", "stash.json");
  fs.mkdirSync(path.dirname(profileFile), { recursive: true });
  fs.writeFileSync(profileFile, JSON.stringify({ version: 2, profiles: Object.fromEntries(seeds.map((s) => [s.name, s])) }));
  port = await freePort();
  server = await startServer({ ...loadConfig({ BOTS_FILL_TO: "0" }), port, latencyMs: 0, stashFile: profileFile });
});

afterAll(async () => {
  try {
    await server?.stop();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- HTTP helpers
const url = (p: string) => `http://127.0.0.1:${port}${p}`;
const purchasePath = (name: string) => `/api/profile/${name}/purchase`;
const equipPath = (name: string) => `/api/profile/${name}/equip`;
const FOREIGN = { origin: "http://game.example.test" };

interface Reply { res: Response; status: number; text: string; body: any }

async function read(res: Response): Promise<Reply> {
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { res, status: res.status, text, body };
}

/** A POST with a JSON content type. A string body is sent as it is, so a test can break the JSON. */
async function post(pathname: string, token: string | undefined, body: unknown, headers: Record<string, string> = {}): Promise<Reply> {
  const h: Record<string, string> = { "content-type": "application/json", ...headers };
  if (token !== undefined) h[PROFILE_TOKEN_HEADER] = token;
  return read(await fetch(url(pathname), { method: "POST", headers: h, body: typeof body === "string" ? body : JSON.stringify(body) }));
}

const buyAs = (who: Account, token: string | undefined, id: unknown) => post(purchasePath(who.name), token, { id });
const buy = (who: Account, id: unknown) => buyAs(who, who.token, id);
const equipAs = (who: Account, token: string | undefined, slot: unknown, id: unknown) => post(equipPath(who.name), token, { slot, id });
const equip = (who: Account, slot: unknown, id: unknown) => equipAs(who, who.token, slot, id);

async function api(name: string, token?: string): Promise<Reply> {
  return read(await fetch(url(`/api/profile/${name}`), { headers: token === undefined ? {} : { [PROFILE_TOKEN_HEADER]: token } }));
}

async function board(query = "", token?: string): Promise<Reply> {
  return read(await fetch(url(`/api/leaderboard${query}`), { headers: token === undefined ? {} : { [PROFILE_TOKEN_HEADER]: token } }));
}

/** The leaderboard asked about `name`, by that profile's owner: a seeded profile's token is on file. */
function boardAs(name: string, query = ""): Promise<Reply> {
  const seeded = seeds.find((s) => s.name === name);
  if (!seeded) throw new Error(`no seeded profile ${name}`);
  return board(`${query}${query.includes("?") ? "&" : "?"}name=${name}`, seeded.token);
}

let counter = 0;

/** A brand new profile with no GV, claimed over HTTP the way the menu does it. */
async function claim(): Promise<Account> {
  const name = `sh${++counter}`;
  const { status, body } = await api(name);
  expect(status).toBe(200);
  expect(body.created).toBe(true);
  return { name, token: body.token };
}

/** The owner's view of the profile, fetched from the server. */
async function profileOf(who: Account): Promise<any> {
  const r = await api(who.name, who.token);
  expect(r.status).toBe(200);
  return r.body.profile;
}

function expectRefused(r: Reply, status: number, code: string): void {
  expect(r.status).toBe(status);
  expect(r.res.headers.get("content-type")).toMatch(/application\/json/);
  expect(r.body.code).toBe(code);
  expect(typeof r.body.error).toBe("string");
  expect(r.body.profile).toBeUndefined();
}

/** Any refusal at all: the point is that nothing was sold, not which of two sensible codes explains it. */
function expectAnyRefusal(r: Reply): void {
  expect(r.status).toBeGreaterThanOrEqual(400);
  expect(r.status).toBeLessThan(500);
  expect(r.res.headers.get("content-type")).toMatch(/application\/json/);
  expect(typeof r.body.code).toBe("string");
  expect(r.body.profile).toBeUndefined();
}

/** A JSON error and nothing else: no HTML page, no stack trace, no file paths. */
function expectCleanJsonError(r: Reply): void {
  expect(r.res.headers.get("content-type")).toMatch(/application\/json/);
  expect(r.body).toBeDefined();
  expect(r.text).not.toMatch(/<html|<!doctype|node_modules|\.[cm]?[jt]s:\d+|\bat\s+\S+\s+\(|SyntaxError|Error:/i);
  expect(Object.keys(r.body).every((k) => ["error", "code", "need", "have"].includes(k))).toBe(true);
}

function expectPrototypeClean(): void {
  expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(PROTOTYPE_KEYS);
  const probe = {} as Record<string, unknown>;
  for (const k of ["polluted", "price", "gv", "skin", "owned", "id"]) expect(probe[k]).toBeUndefined();
}

function expectSecretless(r: Reply, ...secrets: string[]): void {
  const headers = [...r.res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
  for (const s of secrets) {
    expect(r.text).not.toContain(s);
    expect(headers).not.toContain(s);
  }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// ================================================================ happy paths
describe("shop: the happy path", () => {
  it("buys a 40 GV skin with 100 GV: balance 60, item owned, no token anywhere, never cached", async () => {
    const who = take(100);
    const r = await buy(who, "skin-crimson");
    expect(r.status).toBe(200);
    expect(r.res.headers.get("cache-control")).toBe("no-store");
    expect(r.res.headers.get("content-type")).toMatch(/application\/json/);
    expect(Object.keys(r.body)).toEqual(["profile"]);
    expect(Object.keys(r.body.profile).sort()).toEqual(PROFILE_FIELDS);
    expect(r.body.profile.name).toBe(who.name);
    expect(r.body.profile.gv).toBe(60);
    expect(r.body.profile.cosmetics).toEqual({ owned: ["skin-crimson"], equipped: {} });
    expectSecretless(r, who.token);
    expect(r.text).not.toContain("tok-");
  });

  it("the purchase is server-side state: a fresh GET agrees, and so does the profile file once it is written", async () => {
    const who = take(100);
    await buy(who, "skin-crimson");
    const mine = await profileOf(who);
    expect(mine.gv).toBe(60);
    expect(mine.cosmetics.owned).toEqual(["skin-crimson"]);
    await server.store.flush();
    const disk = JSON.parse(fs.readFileSync(profileFile, "utf8"));
    expect(disk.version).toBe(2);
    expect(disk.profiles[who.name].gv).toBe(60);
    expect(disk.profiles[who.name].cosmetics.owned).toEqual(["skin-crimson"]);
  });

  it("spending changes only the balance and the cosmetics: GV earned, stats and the other fields stay", async () => {
    const who = take(100);
    const before = await profileOf(who);
    const r = await buy(who, "skin-crimson");
    expect(r.body.profile).toEqual({ ...before, gv: 60, cosmetics: { owned: ["skin-crimson"], equipped: {} } });
    expect(r.body.profile.gvLifetime).toBe(100);
    expect(r.body.profile.gvByMonth).toEqual({ [POOL_MONTH]: 100 });
  });

  it("equips what was bought, then unequips with id null; GET agrees each time", async () => {
    const who = take(100);
    await buy(who, "skin-crimson");
    const on = await equip(who, "skin", "skin-crimson");
    expect(on.status).toBe(200);
    expect(on.res.headers.get("cache-control")).toBe("no-store");
    expect(on.body.profile.cosmetics.equipped.skin).toBe("skin-crimson");
    expect(on.body.profile.gv).toBe(60); // equipping is free
    expectSecretless(on, who.token);
    expect((await profileOf(who)).cosmetics.equipped).toEqual({ skin: "skin-crimson" });

    const off = await equip(who, "skin", null);
    expect(off.status).toBe(200);
    expect(off.body.profile.cosmetics).toEqual({ owned: ["skin-crimson"], equipped: {} });
    expect((await profileOf(who)).cosmetics).toEqual({ owned: ["skin-crimson"], equipped: {} });
  });

  it("equipping twice and unequipping an empty slot are both fine", async () => {
    const who = take(100);
    await buy(who, "skin-crimson");
    expect((await equip(who, "skin", "skin-crimson")).status).toBe(200);
    const again = await equip(who, "skin", "skin-crimson");
    expect(again.status).toBe(200);
    expect(again.body.profile.cosmetics.equipped).toEqual({ skin: "skin-crimson" });
    const empty = await equip(who, "trail", null);
    expect(empty.status).toBe(200);
    expect(empty.body.profile.cosmetics.equipped).toEqual({ skin: "skin-crimson" });
  });

  it("swapping an equipped item for another one replaces it", async () => {
    const who = take(100);
    await buy(who, "skin-crimson");
    await buy(who, "skin-amber");
    await equip(who, "skin", "skin-crimson");
    const r = await equip(who, "skin", "skin-amber");
    expect(r.body.profile.cosmetics.equipped).toEqual({ skin: "skin-amber" });
  });

  it("an earned item that is not for sale can be equipped once it is owned", async () => {
    const who = account(EARNED);
    for (const [slot, id] of [["skin", "skin-laurel"], ["title", "title-bloodied"], ["trail", "trail-comet"]] as const) {
      const r = await equip(who, slot, id);
      expect(r.status).toBe(200);
      expect(r.body.profile.cosmetics.equipped[slot]).toBe(id);
    }
  });

  it("each golden variant has a slot of its own, so several can be on at once", async () => {
    const who = take(1000);
    await buy(who, "gilded-fire"); // 400
    await buy(who, "gilded-sword"); // 300
    expect((await equip(who, "gold-fire", "gilded-fire")).status).toBe(200);
    const r = await equip(who, "gold-sword", "gilded-sword");
    expect(r.body.profile.cosmetics.equipped).toEqual({ "gold-fire": "gilded-fire", "gold-sword": "gilded-sword" });
    expect(r.body.profile.gv).toBe(300);
  });

  it("a profile from before the meta layer shops, and answers with empty achievements and zero progress", async () => {
    const legacy = account(LEGACY);
    const modern = account(MODERN);
    for (const who of [legacy, modern]) {
      const r = await buy(who, "skin-crimson");
      expect(r.status).toBe(200);
      expect(Object.keys(r.body.profile).sort()).toEqual(PROFILE_FIELDS);
      expect(r.body.profile.achievements).toEqual({});
      expect(r.body.profile.progress).toEqual({ qualifiedWins: 0, bountyRuns: 0, bestRunKills: 0, winsByFaction: {}, winsByWeapon: {} });
      expect(r.body.profile.gv).toBe(60);
    }
  });

  it("a profile whose progress predates qualifiedWins shops, answers qualifiedWins 0 and keeps its other counters", async () => {
    const who = account(OLD_PROGRESS);
    const r = await buy(who, "skin-crimson");
    expect(r.status).toBe(200);
    expect(r.body.profile.gv).toBe(60);
    expect(r.body.profile.progress).toEqual({ qualifiedWins: 0, bountyRuns: 2, bestRunKills: 3, winsByFaction: { fire: 2 }, winsByWeapon: {} });
    expect(r.body.profile.achievements).toEqual({ first_blood: 1_600_000_000_000 });
    expect((await profileOf(who)).progress).toEqual(r.body.profile.progress);
  });

  it("names that clash with Object.prototype shop like any other, and pollute nothing", async () => {
    for (const s of clashing) {
      const who = account(s);
      const r = await buy(who, "skin-crimson");
      expect(r.status).toBe(200);
      expect(r.body.profile.name).toBe(s.name);
      expect(r.body.profile.gv).toBe(60);
      expect((await equip(who, "skin", "skin-crimson")).body.profile.cosmetics.equipped).toEqual({ skin: "skin-crimson" });
      expect((await profileOf(who)).cosmetics.owned).toEqual(["skin-crimson"]);
      expect((await buyAs(who, "wrong", "skin-amber")).status).toBe(403);
    }
    expectPrototypeClean();
  });

  it("names differing only in case are different profiles with different tokens", async () => {
    const upper = account(CASE_UPPER);
    const lower = account(CASE_LOWER);
    expect(upper.token).not.toBe(lower.token);
    expectRefused(await buyAs(lower, upper.token, "skin-crimson"), 403, "forbidden");
    expectRefused(await buyAs(upper, lower.token, "skin-crimson"), 403, "forbidden");
    expect((await profileOf(upper)).gv).toBe(100);
    expect((await profileOf(lower)).gv).toBe(100);
    expect((await buy(upper, "skin-crimson")).status).toBe(200);
    expect((await profileOf(lower)).gv).toBe(100);
  });
});

// ================================================================ authentication
describe("shop: authentication", () => {
  const routes = [
    ["purchase", async (who: Account, token: string | undefined) => buyAs(who, token, "skin-crimson")],
    ["equip", async (who: Account, token: string | undefined) => equipAs(who, token, "skin", "skin-crimson")],
  ] as const;

  /** For equip the victim really owns the skin, so a forged request would have something to put on. */
  async function victim(route: string): Promise<Account> {
    const who = take(100);
    if (route === "equip") expect((await buy(who, "skin-crimson")).status).toBe(200);
    return who;
  }

  it.each(routes)("%s without a token header: 403 forbidden, nothing changes, and no balance is revealed", async (route, attempt) => {
    const who = await victim(route);
    const before = await profileOf(who);
    const r = await attempt(who, undefined);
    expectRefused(r, 403, "forbidden");
    expect(Object.keys(r.body).sort()).toEqual(["code", "error"]);
    expect(r.res.headers.get("cache-control")).toBe("no-store");
    expect(await profileOf(who)).toEqual(before);
  });

  const forgeries: Array<[string, (victim: Account, other: Account) => string]> = [
    ["a made-up token", () => "not-the-token"],
    ["another profile's valid token", (_v, other) => other.token],
    ["the right token in the wrong case", (v) => v.token.toUpperCase()],
    ["the right token with a space inside", (v) => `${v.token.slice(0, 5)} ${v.token.slice(5)}`],
    ["the right token plus one character", (v) => `${v.token}0`],
    ["the right token minus one character", (v) => v.token.slice(0, -1)],
    ["the right token behind a Bearer prefix", (v) => `Bearer ${v.token}`],
    ["the right token twice, comma separated", (v) => `${v.token}, ${v.token}`],
    ["an empty token", () => ""],
  ];

  for (const [route, attempt] of routes) {
    it.each(forgeries)(`${route} with %s: 403 forbidden, victim and attacker unchanged`, async (_label, forge) => {
      const who = await victim(route);
      const attacker = await claim();
      const [victimBefore, attackerBefore] = [await profileOf(who), await profileOf(attacker)];
      const r = await attempt(who, forge(who, attacker));
      expectRefused(r, 403, "forbidden");
      expect(Object.keys(r.body).sort()).toEqual(["code", "error"]);
      expectSecretless(r, who.token, attacker.token);
      expect(await profileOf(who)).toEqual(victimBefore);
      expect(await profileOf(attacker)).toEqual(attackerBefore);
    });
  }

  it("a funded attacker cannot spend the victim's GV or the victim's token against their own name either way", async () => {
    const a = take(100);
    const b = take(100);
    expectRefused(await buyAs(a, b.token, "skin-crimson"), 403, "forbidden");
    expectRefused(await buyAs(b, a.token, "skin-crimson"), 403, "forbidden");
    expect((await profileOf(a)).gv).toBe(100);
    expect((await profileOf(b)).gv).toBe(100);
  });

  it("a repeated token header is not accepted by looking only at the first one", async () => {
    const who = take(100);
    const other = await claim();
    const headers = new Headers({ "content-type": "application/json" });
    headers.append(PROFILE_TOKEN_HEADER, who.token);
    headers.append(PROFILE_TOKEN_HEADER, other.token);
    const r = await read(await fetch(url(purchasePath(who.name)), { method: "POST", headers, body: JSON.stringify({ id: "skin-crimson" }) }));
    expectRefused(r, 403, "forbidden");
    expect((await profileOf(who)).gv).toBe(100);
  });

  it("whitespace around the header value is not part of it (HTTP strips it), so that is the owner's own token and no bypass", async () => {
    const who = take(100);
    const r = await buyAs(who, `  ${who.token}  `, "skin-crimson");
    expect(r.status).toBe(200);
    expect(r.body.profile.gv).toBe(60);
  });

  it.each(["purchase", "equip"] as const)("%s for a name that does not exist: 403 (never 404), identical to a wrong token, and the profile is never created", async (route) => {
    const owner = take(100);
    const realToken = (await claim()).token;
    const ghost = `gh${route[0]}${++counter}`; // a valid name, 16 characters at most
    const send = (name: string, token: string | undefined) =>
      route === "purchase" ? post(purchasePath(name), token, { id: "skin-crimson" }) : post(equipPath(name), token, { slot: "skin", id: "skin-crimson" });

    const known = await send(owner.name, "wrong-token");
    const withValidTokenOfSomeoneElse = await send(ghost, realToken);
    const withoutToken = await send(`${ghost}-b`, undefined);
    expectRefused(withValidTokenOfSomeoneElse, 403, "forbidden");
    expectRefused(withoutToken, 403, "forbidden");
    // The two answers are the same, so a name's existence cannot be probed through this route.
    expect({ status: withValidTokenOfSomeoneElse.status, body: withValidTokenOfSomeoneElse.body }).toEqual({ status: known.status, body: known.body });
    expect({ status: withoutToken.status, body: withoutToken.body }).toEqual({ status: known.status, body: known.body });

    for (const name of [ghost, `${ghost}-b`]) {
      expect(server.store.get(name)).toBeUndefined();
      const claimed = await api(name); // still free: the first GET claims it
      expect(claimed.status).toBe(200);
      expect(claimed.body.created).toBe(true);
    }
  });

  it("tokens in the query string, the JSON body, a cookie or an Authorization header are ignored", async () => {
    const who = take(100);
    const path = purchasePath(who.name);
    const id = "skin-crimson";
    const attempts: Reply[] = [
      await post(`${path}?${PROFILE_TOKEN_HEADER}=${who.token}`, undefined, { id }),
      await post(`${path}?token=${who.token}`, undefined, { id }),
      await post(path, undefined, { id, token: who.token }),
      await post(path, undefined, { id, [PROFILE_TOKEN_HEADER]: who.token }),
      await post(path, undefined, { id, headers: { [PROFILE_TOKEN_HEADER]: who.token } }),
      await post(path, undefined, { id }, { cookie: `${PROFILE_TOKEN_HEADER}=${who.token}; token=${who.token}` }),
      await post(path, undefined, { id }, { authorization: `Bearer ${who.token}` }),
      await post(path, undefined, { id }, { "x-token": who.token, "x-auth-token": who.token }),
    ];
    for (const r of attempts) expectRefused(r, 403, "forbidden");
    const mine = await profileOf(who);
    expect(mine.gv).toBe(100);
    expect(mine.cosmetics.owned).toEqual([]);

    const eq = account(EARNED);
    const e = await post(`${equipPath(eq.name)}?token=${eq.token}`, undefined, { slot: "skin", id: "skin-laurel", token: eq.token });
    expectRefused(e, 403, "forbidden");
  });

  it("a wrong token in the header is not rescued by the right one in the query string or body", async () => {
    const who = take(100);
    const r = await post(`${purchasePath(who.name)}?token=${who.token}`, "wrong", { id: "skin-crimson", token: who.token });
    expectRefused(r, 403, "forbidden");
    expect((await profileOf(who)).gv).toBe(100);
  });

  it.each(["x", "a".repeat(17), "bad%20name", "a.b", "a%2Fb", "%00%00", "name%20", "%E2%82%AC%E2%82%AC"])(
    "the invalid name %s is a 400 on both routes and creates nothing",
    async (name) => {
      const someone = take(100);
      for (const [pathname, body] of [
        [purchasePath(name), { id: "skin-crimson" }],
        [equipPath(name), { slot: "skin", id: null }],
      ] as const) {
        const r = await post(pathname, someone.token, body);
        expectRefused(r, 400, "bad_request");
        expect(r.res.headers.get("cache-control")).toBe("no-store");
      }
      expect(server.store.get(decodeURIComponent(name))).toBeUndefined();
      expect((await profileOf(someone)).gv).toBe(100);
    },
  );

  it("a malformed percent-escape in the name is a clean JSON 400, not Express's HTML error page with a stack trace", async () => {
    const someone = take(100);
    for (const pathname of [purchasePath("%E0%A4%A"), equipPath("%E0%A4%A")]) {
      const r = await post(pathname, someone.token, { id: "skin-crimson" });
      expect(r.status).toBe(400);
      expectCleanJsonError(r);
    }
  });
});

// ================================================================ never trust the client
describe("shop: the client's word is never taken", () => {
  it("fields that claim a price, a balance, ownership or an identity are ignored", async () => {
    const who = take(100);
    const bystander = take(100);
    const r = await post(purchasePath(who.name), who.token, {
      id: "skin-crimson", price: 0, cost: 0, gv: 999_999, gvLifetime: 999_999, balance: 999_999,
      owned: ["gilded-fire", "gilded-sword"], profile: { name: bystander.name, gv: 5, cosmetics: { owned: [], equipped: {} } },
      name: bystander.name, token: bystander.token, free: true, discount: 100,
    });
    expect(r.status).toBe(200);
    expect(r.body.profile.name).toBe(who.name);
    expect(r.body.profile.gv).toBe(60); // the catalog's 40, taken from the store's 100
    expect(r.body.profile.gvLifetime).toBe(100);
    expect(r.body.profile.cosmetics.owned).toEqual(["skin-crimson"]);
    expect((await profileOf(bystander)).gv).toBe(100);
    expect((await profileOf(bystander)).cosmetics.owned).toEqual([]);
  });

  it.each([-1000, -1, 0, 0.5, 1e9, "0", "free", null])("a negative or odd price (%j) in the body can neither credit nor discount", async (price) => {
    const who = take(100);
    const r = await post(purchasePath(who.name), who.token, { id: "skin-crimson", price, cost: price, amount: price });
    expect(r.status).toBe(200);
    expect(r.body.profile.gv).toBe(60);
  });

  it("a client-claimed balance cannot buy what the store's balance cannot", async () => {
    const poor = take(39);
    const r = await post(purchasePath(poor.name), poor.token, { id: "skin-crimson", gv: 1_000_000, balance: 1_000_000 });
    expectRefused(r, 402, "insufficient_gv");
    expect(r.body).toMatchObject({ need: 40, have: 39 });
    expect((await profileOf(poor)).gv).toBe(39);
  });

  it("equip ignores claims of ownership, and never grants anything", async () => {
    const who = take(100);
    const r = await post(equipPath(who.name), who.token, { slot: "skin", id: "skin-crimson", owned: true, owns: ["skin-crimson"], cosmetics: { owned: ["skin-crimson"] } });
    expectRefused(r, 409, "not_owned");
    const mine = await profileOf(who);
    expect(mine.cosmetics).toEqual({ owned: [], equipped: {} });
    expect(mine.gv).toBe(100);
  });

  it("the cosmetic id is read from the JSON body only, not from the query string or a header", async () => {
    const who = take(100);
    const viaQuery = await post(`${purchasePath(who.name)}?id=skin-crimson`, who.token, {});
    expectAnyRefusal(viaQuery);
    const viaHeader = await post(purchasePath(who.name), who.token, {}, { id: "skin-crimson", "x-cosmetic-id": "skin-crimson" });
    expectAnyRefusal(viaHeader);
    expect(await profileOf(who)).toMatchObject({ gv: 100, cosmetics: { owned: [] } });
  });

  it.each<[string, unknown]>([
    ["a number", 1],
    ["an array holding the id", ["skin-crimson"]],
    ["an array of ids", ["skin-crimson", "skin-amber"]],
    ["an empty object", {}],
    ["an object with an id key", { id: "skin-crimson" }],
    ["an object that stringifies to the id", { toString: "skin-crimson" }],
    ["null", null],
    ["true", true],
    ["false", false],
    ["an empty string", ""],
  ])("purchase with id as %s is refused and changes nothing", async (_label, id) => {
    const who = take(100);
    const before = await profileOf(who);
    const r = await buy(who, id);
    expectAnyRefusal(r);
    expect(await profileOf(who)).toEqual(before);
  });

  it("purchase with no id at all (or an empty body) is refused and changes nothing", async () => {
    const who = take(100);
    const before = await profileOf(who);
    expectAnyRefusal(await post(purchasePath(who.name), who.token, {}));
    expectAnyRefusal(await post(purchasePath(who.name), who.token, ""));
    expectAnyRefusal(await post(purchasePath(who.name), who.token, { ID: "skin-crimson", Id: "skin-crimson", ids: ["skin-crimson"] }));
    expect(await profileOf(who)).toEqual(before);
  });

  it.each(["SKIN-CRIMSON", "Skin-Crimson", " skin-crimson", "skin-crimson ", "skin-crimson\u0000", "skin-crimson\n", "skin\u2010crimson", "skin-crimson,skin-amber", "skin-crimson;gilded-fire", "../skin-crimson", "skin-crimson".repeat(60)])(
    "the lookalike id %j is an unknown cosmetic, not a purchase",
    async (id) => {
      const who = take(100);
      const r = await buy(who, id);
      expectRefused(r, 404, "unknown_cosmetic");
      expect(await profileOf(who)).toMatchObject({ gv: 100, cosmetics: { owned: [] } });
    },
  );

  it.each(["__proto__", "constructor", "toString", "hasOwnProperty", "prototype", "valueOf"])("id %s is an unknown cosmetic (404) and pollutes nothing", async (id) => {
    const who = take(100);
    expectRefused(await buy(who, id), 404, "unknown_cosmetic");
    expectRefused(await equip(who, "skin", id), 404, "unknown_cosmetic");
    expect(await profileOf(who)).toMatchObject({ gv: 100, cosmetics: { owned: [], equipped: {} } });
    expectPrototypeClean();
  });

  it("a JSON body with __proto__ and constructor keys still sells at the catalog price and pollutes nothing", async () => {
    const who = take(100);
    const body = '{"__proto__":{"polluted":true,"price":0,"gv":1000000},"constructor":{"prototype":{"polluted":true,"price":0}},"id":"skin-crimson"}';
    const r = await post(purchasePath(who.name), who.token, body);
    expect(r.status).toBe(200);
    expect(r.body.profile.gv).toBe(60);
    const e = await post(equipPath(who.name), who.token, '{"__proto__":{"polluted":true},"slot":"skin","id":"skin-crimson"}');
    expect(e.status).toBe(200);
    expectPrototypeClean();
    expect(({} as any).polluted).toBeUndefined();
  });

  it("odd but small payloads are refused cleanly, never a server error", async () => {
    const who = take(100);
    const payloads = [
      '{"id":"\\ud800"}', // a lone surrogate
      `{"id":${"[".repeat(400)}${"]".repeat(400)}}`, // deeply nested
      '{"id":1e999}', // Infinity once parsed
      '{"id":-0}',
      '{"id":"skin-crimson\\u0000"}',
      '{"id":{"__proto__":{"id":"skin-crimson"}}}',
      '{"id":"skin-crimson","id":null}', // the last duplicate wins, and it is null
      `{"id":"${"\\u00e9".repeat(100)}"}`,
    ];
    for (const text of payloads) {
      const r = await post(purchasePath(who.name), who.token, text);
      expectAnyRefusal(r);
      const e = await post(equipPath(who.name), who.token, text.replace('"id"', '"slot":"skin","id"'));
      expect(e.status).toBeLessThan(500);
    }
    expect(await profileOf(who)).toMatchObject({ gv: 100, cosmetics: { owned: [], equipped: {} } });
    expectPrototypeClean();
  });

  it("achievement-only items are never sold, however rich the buyer", async () => {
    const who = take(10000);
    const notForSale = COSMETICS.filter((c) => !isForSale(c));
    expect(notForSale.length).toBeGreaterThan(10);
    expect(notForSale.map((c) => c.id)).toEqual(expect.arrayContaining(["skin-laurel", "skin-ghost", "title-bloodied", "trail-comet", "outline-bounty"]));
    for (const c of notForSale) expectRefused(await buy(who, c.id), 409, "not_for_sale");
    const mine = await profileOf(who);
    expect(mine.gv).toBe(10000);
    expect(mine.cosmetics.owned).toEqual([]);
  });

  it("every item the catalog sells costs exactly its catalog price, and spoken prices are what the shop spec says", async () => {
    expect(cosmeticById("skin-crimson")?.price).toBe(40);
    expect(cosmeticById("title-rookie")?.price).toBe(30);
    expect(cosmeticById("trail-ember")?.price).toBe(100);
    expect(cosmeticById("gilded-fire")?.price).toBe(400);
    expect(cosmeticById("skin-laurel")?.price).toBeUndefined();

    const who = take(10000);
    const sellable = COSMETICS.filter(isForSale);
    let spent = 0;
    for (const c of sellable) {
      const r = await buy(who, c.id);
      expect(r.status).toBe(200);
      spent += c.price as number;
      expect(r.body.profile.gv).toBe(10000 - spent);
    }
    const mine = await profileOf(who);
    expect(spent).toBe(sum(sellable.map((c) => c.price as number)));
    expect(mine.cosmetics.owned).toEqual(sellable.map((c) => c.id));
    expect(mine.gv).toBe(10000 - spent);
  });

  it.each<[string, unknown]>([
    ["a number", 5],
    ["null", null],
    ["an array", ["skin"]],
    ["an object", { skin: true }],
    ["an empty string", ""],
    ["a wrong case", "Skin"],
    ["a padded name", " skin"],
    ["__proto__", "__proto__"],
    ["constructor", "constructor"],
    ["toString", "toString"],
    ["hasOwnProperty", "hasOwnProperty"],
    ["a golden slot that does not exist", "gold-banana"],
    ["a made-up slot", "hat"],
  ])("equip with slot as %s: 400 unknown_slot, nothing changes, nothing polluted", async (_label, slot) => {
    const who = take(100);
    await buy(who, "skin-crimson");
    const before = await profileOf(who);
    const r = await equip(who, slot, "skin-crimson");
    expectRefused(r, 400, "unknown_slot");
    expect(await profileOf(who)).toEqual(before);
    expectPrototypeClean();
  });

  it("equip with no slot, or a slot only in the query string, is refused", async () => {
    const who = take(100);
    await buy(who, "skin-crimson");
    expectRefused(await post(equipPath(who.name), who.token, { id: "skin-crimson" }), 400, "unknown_slot");
    expectRefused(await post(`${equipPath(who.name)}?slot=skin`, who.token, { id: "skin-crimson" }), 400, "unknown_slot");
    expect((await profileOf(who)).cosmetics.equipped).toEqual({});
  });

  it.each<[string, unknown]>([
    ["a number", 7],
    ["an array", ["skin-crimson"]],
    ["an object", { id: "skin-crimson" }],
    ["true", true],
    ["an empty string", ""],
  ])("equip with id as %s is refused and takes nothing off", async (_label, id) => {
    const who = take(100);
    await buy(who, "skin-crimson");
    await equip(who, "skin", "skin-crimson");
    const r = await equip(who, "skin", id);
    expectAnyRefusal(r);
    expect((await profileOf(who)).cosmetics.equipped).toEqual({ skin: "skin-crimson" });
  });

  it("leaving out the id never unequips: only an explicit null does", async () => {
    const who = take(100);
    await buy(who, "skin-crimson");
    await equip(who, "skin", "skin-crimson");
    expectAnyRefusal(await post(equipPath(who.name), who.token, { slot: "skin" }));
    expectAnyRefusal(await post(equipPath(who.name), who.token, { slot: "skin", id: undefined }));
    expect((await profileOf(who)).cosmetics.equipped).toEqual({ skin: "skin-crimson" });
    expect((await equip(who, "skin", null)).status).toBe(200);
  });

  it("equip refusals: unknown cosmetic 404, wrong slot 400, not owned 409 (for sale or not), and none of them buys or grants", async () => {
    const who = take(100);
    await buy(who, "skin-crimson");
    expectRefused(await equip(who, "skin", "skin-nope"), 404, "unknown_cosmetic");
    expectRefused(await equip(who, "trail", "skin-crimson"), 400, "slot_mismatch");
    expectRefused(await equip(who, "title", "skin-crimson"), 400, "slot_mismatch");
    expectRefused(await equip(who, "skin", "skin-amber"), 409, "not_owned"); // for sale and affordable, still not owned
    expectRefused(await equip(who, "skin", "skin-laurel"), 409, "not_owned"); // earned-only
    expectRefused(await equip(who, "gold-fire", "gilded-sword"), 400, "slot_mismatch");
    const mine = await profileOf(who);
    expect(mine.gv).toBe(60);
    expect(mine.cosmetics).toEqual({ owned: ["skin-crimson"], equipped: {} });
  });

  it("an item owned by someone else cannot be put on: ownership is per profile", async () => {
    const owner = take(100);
    const thief = take(100);
    await buy(owner, "skin-crimson");
    expectRefused(await equip(thief, "skin", "skin-crimson"), 409, "not_owned");
    expectRefused(await post(equipPath(thief.name), owner.token, { slot: "skin", id: "skin-crimson" }), 403, "forbidden");
    expect((await profileOf(thief)).cosmetics).toEqual({ owned: [], equipped: {} });
  });
});

// ================================================================ money
describe("shop: money", () => {
  it("not enough GV: 402 with the exact need and have, nothing charged or granted", async () => {
    const who = take(39);
    const r = await buy(who, "skin-crimson");
    expectRefused(r, 402, "insufficient_gv");
    expect(r.body.need).toBe(40);
    expect(r.body.have).toBe(39);
    expect(await profileOf(who)).toMatchObject({ gv: 39, cosmetics: { owned: [] } });
  });

  it("a new profile with nothing: 402, need the price, have 0", async () => {
    const who = await claim();
    const r = await buy(who, "gilded-fire");
    expectRefused(r, 402, "insufficient_gv");
    expect(r.body).toMatchObject({ need: 400, have: 0 });
    expect((await profileOf(who)).gv).toBe(0);
  });

  it("exactly enough GV buys it and leaves 0; one GV short does not", async () => {
    const exact = take(40);
    const r = await buy(exact, "skin-crimson");
    expect(r.status).toBe(200);
    expect(r.body.profile.gv).toBe(0);
    expect(r.body.profile.cosmetics.owned).toEqual(["skin-crimson"]);

    const big = take(400);
    expect((await buy(big, "gilded-fire")).body.profile.gv).toBe(0);
    const short = take(30);
    expectRefused(await buy(short, "gilded-fire"), 402, "insufficient_gv");
  });

  it("buying the same item twice: 409 already_owned, and the GV was taken once", async () => {
    const who = take(100);
    expect((await buy(who, "skin-crimson")).status).toBe(200);
    const again = await buy(who, "skin-crimson");
    expectRefused(again, 409, "already_owned");
    expect(again.body.need).toBeUndefined();
    const mine = await profileOf(who);
    expect(mine.gv).toBe(60);
    expect(mine.cosmetics.owned).toEqual(["skin-crimson"]);
  });

  it("an item earned for free cannot be bought, and an owned one cannot be bought again at any balance", async () => {
    const who = take(10000);
    await buy(who, "title-gladiator");
    expectRefused(await buy(who, "title-gladiator"), 409, "already_owned");
    expect((await profileOf(who)).gv).toBe(10000 - 150);
  });

  it("sequential spending: 100 GV buys two 40 GV skins, then the third is refused with the true shortfall", async () => {
    const who = take(100);
    expect((await buy(who, "skin-crimson")).body.profile.gv).toBe(60);
    expect((await buy(who, "skin-amber")).body.profile.gv).toBe(20);
    const third = await buy(who, "skin-lime");
    expectRefused(third, 402, "insufficient_gv");
    expect(third.body).toMatchObject({ need: 40, have: 20 });
    expectRefused(await buy(who, "skin-crimson"), 409, "already_owned");
    const mine = await profileOf(who);
    expect(mine.gv).toBe(20);
    expect(mine.cosmetics.owned).toEqual(["skin-crimson", "skin-amber"]);
  });

  it("repeating one request five times in a row charges once", async () => {
    const who = take(100);
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await buy(who, "skin-crimson")).status);
    expect(codes).toEqual([200, 409, 409, 409, 409]);
    expect((await profileOf(who)).gv).toBe(60);
  });

  it("a refused request of any kind leaves the balance alone", async () => {
    const who = take(100);
    const other = await claim();
    await buyAs(who, "wrong", "skin-crimson");
    await buyAs(who, other.token, "skin-crimson");
    await buy(who, "skin-nope");
    await buy(who, "skin-laurel");
    await buy(who, 5);
    await equip(who, "hat", null);
    await post(purchasePath(who.name), who.token, "{nope");
    expect(await profileOf(who)).toMatchObject({ gv: 100, gvLifetime: 100, cosmetics: { owned: [], equipped: {} } });
  });

  describe("concurrency", () => {
    it("ten identical purchases at once against a balance that covers exactly one: one 200, nine refusals, 0 left, owned once", async () => {
      const who = take(40);
      const replies = await Promise.all(Array.from({ length: 10 }, () => buy(who, "skin-crimson")));
      expect(replies.filter((r) => r.status === 200)).toHaveLength(1);
      const refused = replies.filter((r) => r.status !== 200);
      expect(refused).toHaveLength(9);
      for (const r of refused) {
        expect([402, 409]).toContain(r.status);
        expect(r.res.headers.get("content-type")).toMatch(/application\/json/);
        expect(["insufficient_gv", "already_owned"]).toContain(r.body.code);
      }
      const mine = await profileOf(who);
      expect(mine.gv).toBe(0);
      expect(mine.cosmetics.owned).toEqual(["skin-crimson"]);
    });

    it("ten identical purchases at once against a big balance still sell the item once", async () => {
      const who = take(1000);
      const replies = await Promise.all(Array.from({ length: 10 }, () => buy(who, "skin-crimson")));
      expect(replies.filter((r) => r.status === 200)).toHaveLength(1);
      expect(replies.filter((r) => r.status === 409)).toHaveLength(9);
      const mine = await profileOf(who);
      expect(mine.gv).toBe(960);
      expect(mine.cosmetics.owned).toEqual(["skin-crimson"]);
    });

    it("two different items whose total exceeds the balance, bought together: exactly one 200", async () => {
      const accounts = Array.from({ length: 5 }, () => take(60));
      const replies = await Promise.all(accounts.flatMap((who) => [buy(who, "skin-crimson"), buy(who, "skin-amber")]));
      accounts.forEach((who, i) => {
        const pair = [replies[2 * i]!, replies[2 * i + 1]!];
        expect(pair.filter((r) => r.status === 200)).toHaveLength(1);
        expect(pair.filter((r) => r.status === 402)).toHaveLength(1);
      });
      for (const who of accounts) {
        const mine = await profileOf(who);
        expect(mine.gv).toBe(20);
        expect(mine.cosmetics.owned).toHaveLength(1);
      }
    });

    it("four 40 GV skins at once against 100 GV: exactly two sell, 20 left", async () => {
      const who = take(100);
      const ids = ["skin-crimson", "skin-amber", "skin-lime", "skin-teal"];
      const replies = await Promise.all(ids.map((id) => buy(who, id)));
      const sold = ids.filter((_, i) => replies[i]!.status === 200);
      expect(sold).toHaveLength(2);
      for (const r of replies.filter((r) => r.status !== 200)) expectRefused(r, 402, "insufficient_gv");
      const mine = await profileOf(who);
      expect(mine.gv).toBe(20);
      expect([...mine.cosmetics.owned].sort()).toEqual([...sold].sort());
    });

    it("concurrent shoppers do not touch each other's balances", async () => {
      const a = take(40);
      const b = take(40);
      const replies = await Promise.all(
        Array.from({ length: 5 }, () => [buy(a, "skin-crimson"), buy(b, "skin-amber")]).flat(),
      );
      const aReplies = replies.filter((_, i) => i % 2 === 0);
      const bReplies = replies.filter((_, i) => i % 2 === 1);
      expect(aReplies.filter((r) => r.status === 200)).toHaveLength(1);
      expect(bReplies.filter((r) => r.status === 200)).toHaveLength(1);
      expect(await profileOf(a)).toMatchObject({ gv: 0, cosmetics: { owned: ["skin-crimson"] } });
      expect(await profileOf(b)).toMatchObject({ gv: 0, cosmetics: { owned: ["skin-amber"] } });
    });

    it("a purchase racing GET profile never shows a torn state: balance and ownership move together", async () => {
      const who = take(100);
      const ids = ["skin-crimson", "skin-amber", "skin-lime", "skin-teal"];
      const calls: Array<Promise<Reply>> = [];
      for (let i = 0; i < 40; i++) {
        calls.push(api(who.name, who.token));
        if (i % 10 === 5) calls.push(buy(who, ids[Math.floor(i / 10)]!));
      }
      const replies = await Promise.all(calls);
      let sawOwned = false;
      for (const r of replies) {
        if (r.status !== 200) continue;
        const p = r.body.profile;
        // Every snapshot is a state the store was really in: nothing bought, or n items and n*40 GV gone.
        expect(p.gv + 40 * p.cosmetics.owned.length).toBe(100);
        expect(p.gv).toBeGreaterThanOrEqual(0);
        if (p.cosmetics.owned.length > 0) sawOwned = true;
      }
      expect(sawOwned).toBe(true);
      const final = await profileOf(who);
      expect(final.cosmetics.owned).toHaveLength(2);
      expect(final.gv).toBe(20);
    });
  });

  describe("GV earned is separate from GV spent", () => {
    it("lifetime and the monthly total never drop after spending", async () => {
      const who = take(1000);
      const before = await profileOf(who);
      expect(before).toMatchObject({ gv: 1000, gvLifetime: 1000, gvByMonth: { [POOL_MONTH]: 1000 } });
      for (const id of ["gilded-fire", "gilded-sword", "title-unbroken"]) expect((await buy(who, id)).status).toBe(200);
      const after = await profileOf(who);
      expect(after.gv).toBe(100);
      expect(after.gvLifetime).toBe(1000);
      expect(after.gvByMonth).toEqual({ [POOL_MONTH]: 1000 });
      expect(after.stats).toEqual(before.stats);
    });

    it("the leaderboard still ranks by GV earned, not by what is left to spend", async () => {
      const a = account(seeds.find((s) => s.name === "earn_a")!);
      const b = account(seeds.find((s) => s.name === "earn_b")!);
      const rows = (r: Reply) => r.body.entries.map((e: any) => [e.name, e.gv]);
      expect(rows(await board(`?month=${EARN_MONTH}`))).toEqual([["earn_a", 1000], ["earn_b", 500]]);

      for (const id of ["gilded-fire", "gilded-sword", "title-unbroken"]) expect((await buy(a, id)).status).toBe(200);
      expect((await profileOf(a)).gv).toBe(100); // 100 left to spend, against b's 500

      const after = await board(`?month=${EARN_MONTH}&name=${a.name}`, a.token);
      expect(rows(after)).toEqual([["earn_a", 1000], ["earn_b", 500]]);
      expect(after.body.you).toEqual({ rank: 1, gv: 1000 });
      expect((await board(`?month=${EARN_MONTH}&name=${b.name}`, b.token)).body.you).toEqual({ rank: 2, gv: 500 });
    });
  });
});

// ================================================================ transport hygiene
describe("shop: transport hygiene", () => {
  const routes = [
    ["purchase", purchasePath, { id: "skin-crimson" }],
    ["equip", equipPath, { slot: "skin", id: null }],
  ] as const;

  it.each(["{\"id\": ", "{id: \"skin-crimson\"}", "{'id':'skin-crimson'}", "{\"id\":\"skin-crimson\"", "}{", "\u0000", "undefined", "{\"id\":\"skin-crimson\"}}", "<html></html>"])(
    "malformed JSON %j: a 400 JSON error with no HTML and no stack trace",
    async (text) => {
      for (const [, pathOf] of routes) {
        const who = take(100);
        const r = await post(pathOf(who.name), who.token, text);
        expect(r.status).toBe(400);
        expect(r.body.code).toBe("bad_request");
        expectCleanJsonError(r);
        expect(await profileOf(who)).toMatchObject({ gv: 100, cosmetics: { owned: [], equipped: {} } });
      }
    },
  );

  it.each([["an array", "[]"], ["an array of ids", "[\"skin-crimson\"]"], ["a string", "\"skin-crimson\""], ["null", "null"], ["a number", "5"], ["true", "true"]])(
    "a JSON body that is %s instead of an object is a 400",
    async (_label, text) => {
      for (const [, pathOf] of routes) {
        const who = take(100);
        const r = await post(pathOf(who.name), who.token, text);
        expect(r.status).toBe(400);
        expect(r.body.code).toBe("bad_request");
        expectCleanJsonError(r);
        expect(await profileOf(who)).toMatchObject({ gv: 100, cosmetics: { owned: [], equipped: {} } });
      }
    },
  );

  it("an empty body with the JSON content type is refused and changes nothing", async () => {
    const who = take(100);
    const r = await read(await fetch(url(purchasePath(who.name)), { method: "POST", headers: { "content-type": "application/json", [PROFILE_TOKEN_HEADER]: who.token } }));
    expectAnyRefusal(r);
    expect(await profileOf(who)).toMatchObject({ gv: 100, cosmetics: { owned: [] } });
  });

  describe("size", () => {
    const padded = (bytes: number) => `{"id":"${"a".repeat(bytes - 9)}"}`;

    it("a body of exactly 1 KB is read (and its id is simply unknown); one byte more is a 413", async () => {
      const who = take(100);
      const at = padded(1024);
      expect(Buffer.byteLength(at)).toBe(1024);
      expectRefused(await post(purchasePath(who.name), who.token, at), 404, "unknown_cosmetic");
      const over = padded(1025);
      expect(Buffer.byteLength(over)).toBe(1025);
      const r = await post(purchasePath(who.name), who.token, over);
      expect(r.status).toBe(413);
      expect(r.body.code).toBe("bad_request");
      expectCleanJsonError(r);
      expect(await profileOf(who)).toMatchObject({ gv: 100, cosmetics: { owned: [] } });
    });

    it("the limit holds on the equip route as well, and a valid request padded past it is refused rather than honoured", async () => {
      const who = take(100);
      await buy(who, "skin-crimson");
      const body = `{"slot":"skin","id":"skin-crimson","pad":"${"x".repeat(1100)}"}`;
      const r = await post(equipPath(who.name), who.token, body);
      expect(r.status).toBe(413);
      expect((await profileOf(who)).cosmetics.equipped).toEqual({});
    });

    it("the limit is checked before the token: an anonymous giant body is a 413, not a read", async () => {
      const who = take(100);
      const r = await post(purchasePath(who.name), undefined, padded(4096));
      expect(r.status).toBe(413);
      expect(r.text).not.toContain(who.name);
    });

    it("a body sent in chunks with no Content-Length is limited too", async () => {
      const who = take(100);
      const chunk = new Uint8Array(1000).fill(0x20);
      const stream = new ReadableStream({
        start(controller) {
          for (let i = 0; i < 10; i++) controller.enqueue(chunk);
          controller.close();
        },
      });
      const res = await fetch(url(purchasePath(who.name)), {
        method: "POST", headers: { "content-type": "application/json", [PROFILE_TOKEN_HEADER]: who.token }, body: stream, duplex: "half",
      } as RequestInit);
      expect(res.status).toBe(413);
      expect(await profileOf(who)).toMatchObject({ gv: 100, cosmetics: { owned: [] } });
    });

    it("a multi-megabyte body, and a tiny gzip body that inflates to megabytes, are refused and the server stays up", async () => {
      const who = take(100);
      const outcomes: Array<number | "closed"> = [];
      const attempt = async (init: RequestInit) => {
        try {
          outcomes.push((await fetch(url(purchasePath(who.name)), init)).status);
        } catch {
          outcomes.push("closed"); // the server may drop the connection instead of reading it all, which is also a refusal
        }
      };
      const headers = { "content-type": "application/json", [PROFILE_TOKEN_HEADER]: who.token };
      await attempt({ method: "POST", headers, body: Buffer.alloc(5_000_000, 0x20) });
      await attempt({ method: "POST", headers: { ...headers, "content-encoding": "gzip" }, body: zlib.gzipSync(Buffer.alloc(10_000_000, 0x20)) });
      expect(outcomes).toHaveLength(2);
      for (const o of outcomes) expect(o === "closed" || o === 413).toBe(true);
      expect(await profileOf(who)).toMatchObject({ gv: 100, cosmetics: { owned: [] } }); // and the next request is answered
    });

    it("a gzip-encoded body that is small once inflated is an ordinary request", async () => {
      const who = take(100);
      const r = await read(await fetch(url(purchasePath(who.name)), {
        method: "POST",
        headers: { "content-type": "application/json", "content-encoding": "gzip", [PROFILE_TOKEN_HEADER]: who.token },
        body: zlib.gzipSync(JSON.stringify({ id: "skin-crimson" })),
      }));
      expect(r.status).toBe(200);
      expect(r.body.profile.gv).toBe(60);
    });

    it("a token header too big for HTTP is refused by the transport and the server carries on", async () => {
      const who = take(100);
      const r = await fetch(url(purchasePath(who.name)), {
        method: "POST", headers: { "content-type": "application/json", [PROFILE_TOKEN_HEADER]: "a".repeat(40_000) }, body: JSON.stringify({ id: "skin-crimson" }),
      }).then((res) => res.status, () => "closed" as const);
      expect([403, 431, "closed"]).toContain(r);
      expect(await profileOf(who)).toMatchObject({ gv: 100, cosmetics: { owned: [] } });
    });
  });

  describe("content type", () => {
    const json = JSON.stringify({ id: "skin-crimson" });
    const wrongTypes: Array<[string, string | null, string]> = [
      ["text/plain", "text/plain", json],
      ["text/plain with a charset", "text/plain;charset=UTF-8", json],
      ["form-encoded", "application/x-www-form-urlencoded", "id=skin-crimson"],
      ["form-encoded carrying JSON", "application/x-www-form-urlencoded", json],
      ["multipart", "multipart/form-data; boundary=x", "--x\r\nContent-Disposition: form-data; name=\"id\"\r\n\r\nskin-crimson\r\n--x--"],
      ["text/json", "text/json", json],
      ["application/octet-stream", "application/octet-stream", json],
      ["no content type", null, json],
    ];

    it.each(wrongTypes)("%s: 415, the profile is unchanged", async (_label, type, text) => {
      const who = take(100);
      const headers: Record<string, string> = { [PROFILE_TOKEN_HEADER]: who.token };
      if (type !== null) headers["content-type"] = type;
      const body: BodyInit = type === null ? new TextEncoder().encode(text) : text;
      const r = await read(await fetch(url(purchasePath(who.name)), { method: "POST", headers, body }));
      expect(r.status).toBe(415);
      expect(r.body.code).toBe("bad_request");
      expectCleanJsonError(r);
      expect(await profileOf(who)).toMatchObject({ gv: 100, cosmetics: { owned: [] } });
    });

    it("the same goes for equip", async () => {
      const who = take(100);
      await buy(who, "skin-crimson");
      const r = await read(await fetch(url(equipPath(who.name)), {
        method: "POST", headers: { "content-type": "text/plain", [PROFILE_TOKEN_HEADER]: who.token }, body: JSON.stringify({ slot: "skin", id: "skin-crimson" }),
      }));
      expect(r.status).toBe(415);
      expect((await profileOf(who)).cosmetics.equipped).toEqual({});
    });

    it("a cross-site form post with the token in the query string is not a purchase", async () => {
      const who = take(100);
      const r = await read(await fetch(url(`${purchasePath(who.name)}?${PROFILE_TOKEN_HEADER}=${who.token}`), {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...FOREIGN }, body: "id=skin-crimson",
      }));
      expect(r.status).toBe(415);
      expect((await profileOf(who)).gv).toBe(100);
    });

    it.each(["application/json; charset=utf-8", "APPLICATION/JSON", "application/json;charset=UTF-8"])("%s is accepted", async (type) => {
      const who = take(100);
      const r = await read(await fetch(url(purchasePath(who.name)), {
        method: "POST", headers: { "content-type": type, [PROFILE_TOKEN_HEADER]: who.token }, body: JSON.stringify({ id: "skin-crimson" }),
      }));
      expect(r.status).toBe(200);
    });
  });

  describe("methods", () => {
    const methods = ["GET", "HEAD", "PUT", "PATCH", "DELETE"] as const;
    const cases = methods.flatMap((m) => routes.map((r) => [m, r[0], r[1]] as const));

    it.each(cases)("%s on %s is 405 with Allow: POST, OPTIONS, even with the owner's token and a body that would have worked", async (method, route, pathOf) => {
      const who = take(100);
      // For equip the skin is really owned, so the same body would have put it on had the method been accepted.
      if (route === "equip") expect((await buy(who, "skin-crimson")).status).toBe(200);
      const before = await profileOf(who);
      const hasBody = method !== "GET" && method !== "HEAD";
      const res = await fetch(url(pathOf(who.name)), {
        method,
        headers: { "content-type": "application/json", [PROFILE_TOKEN_HEADER]: who.token },
        body: hasBody ? JSON.stringify({ id: "skin-crimson", slot: "skin" }) : undefined,
      });
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST, OPTIONS");
      expect(res.headers.get("cache-control")).toBe("no-store");
      const text = await res.text();
      expect(text).not.toContain(who.token);
      expect(text).not.toContain(who.name);
      expect(await profileOf(who)).toEqual(before);
    });

    it("a wrong method for a name nobody has claimed neither creates it nor reveals anything", async () => {
      for (const method of methods) {
        const name = `nm${method.toLowerCase()}${++counter}`;
        const res = await fetch(url(purchasePath(name)), { method });
        expect(res.status).toBe(405);
        expect(server.store.get(name)).toBeUndefined();
        expect((await api(name)).body.created).toBe(true);
      }
    });

    it("the method is judged before the token, the body or the name, so a 405 is the same for everyone", async () => {
      for (const pathname of [purchasePath("x"), purchasePath("nobody-here"), purchasePath("%00")]) {
        const res = await fetch(url(pathname), { method: "GET", headers: { "x-profile-token": "whatever" } });
        expect(res.status).toBe(405);
      }
    });

    it("POST to the profile route itself is still refused, and the shop routes did not open it", async () => {
      const who = take(100);
      const res = await fetch(url(`/api/profile/${who.name}`), { method: "POST", headers: { [PROFILE_TOKEN_HEADER]: who.token, "content-type": "application/json" }, body: JSON.stringify({ id: "skin-crimson" }) });
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET, OPTIONS");
      expect((await profileOf(who)).gv).toBe(100);
    });
  });

  describe("CORS", () => {
    it.each(routes)("the preflight for a POST to %s with the token and content-type headers is answered and changes nothing", async (_route, pathOf) => {
      const name = `pre${++counter}`;
      const res = await fetch(url(pathOf(name)), {
        method: "OPTIONS",
        headers: { ...FOREIGN, "access-control-request-method": "POST", "access-control-request-headers": `content-type,${PROFILE_TOKEN_HEADER}` },
      });
      expect(res.status).toBeLessThan(300);
      expect(["*", FOREIGN.origin]).toContain(res.headers.get("access-control-allow-origin"));
      const headers = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase().split(/\s*,\s*/);
      expect(headers).toContain(PROFILE_TOKEN_HEADER);
      expect(headers).toContain("content-type");
      expect(res.headers.get("access-control-allow-methods")).toMatch(/\bPOST\b/);
      expect(server.store.get(name)).toBeUndefined();
    });

    it("the real POST answers any origin, names the token header, and never allows credentials", async () => {
      const who = take(100);
      const ok = await post(purchasePath(who.name), who.token, { id: "skin-crimson" }, FOREIGN);
      expect(ok.status).toBe(200);
      const refusals = [
        await post(purchasePath(who.name), "wrong", { id: "skin-amber" }, FOREIGN), // 403
        await post(purchasePath(who.name), who.token, "{nope", FOREIGN), // 400 from the parser
        await post(purchasePath(who.name), who.token, { id: "skin-crimson" }, FOREIGN), // 409
        await post(purchasePath(who.name), who.token, "x".repeat(2000), FOREIGN), // 413
        await post(purchasePath(who.name), who.token, "x", { ...FOREIGN, "content-type": "text/plain" }), // 415
        await read(await fetch(url(purchasePath(who.name)), { method: "PUT", headers: FOREIGN })), // 405
      ];
      expect(refusals.map((r) => r.status)).toEqual([403, 400, 409, 413, 415, 405]);
      for (const r of [ok, ...refusals]) {
        expect(r.res.headers.get("access-control-allow-origin")).toBe("*");
        expect((r.res.headers.get("access-control-allow-headers") ?? "").toLowerCase()).toContain(PROFILE_TOKEN_HEADER);
        expect(r.res.headers.get("access-control-allow-credentials")).toBeNull();
      }
    });
  });
});

// ================================================================ unmatched routes
describe("/api: anything unmatched answers a JSON 404", () => {
  /** Every one of these reaches no handler: a path that is nothing, or one that only looks like a real route. */
  const unmatched = [
    "/api", "/api/nope", "/api/nope/deeper/still", "/api/admin", "/api/shop", "/api/profile",
    "/api/profile/ab/nope", "/api/profile/ab/purchase/extra", "/api/profile/ab/equip/extra",
    "/api/leaderboard/extra", "/api/health/extra", "/api/profile/ab/purchased",
  ];
  const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
  const cases = methods.flatMap((m) => unmatched.map((p) => [m, p] as const));

  /** The page Express would otherwise send: a stack trace with file paths, or its plain "Cannot GET". */
  const NO_FRAMEWORK_PAGE = /<html|<!doctype|<pre>|Cannot (GET|POST|PUT|PATCH|DELETE)|node_modules|\.[cm]?[jt]s:\d+|\bat\s+\S+\s+\(|Error:/i;

  function expectNotFound(r: Reply): void {
    expect(r.status).toBe(404);
    expect(r.res.headers.get("content-type")).toMatch(/application\/json/);
    expect(r.res.headers.get("cache-control")).toBe("no-store");
    expect(r.body).toEqual({ error: "not found" });
    expect(r.text).not.toMatch(NO_FRAMEWORK_PAGE);
  }

  it.each(cases)("%s %s: 404 JSON with no HTML, no stack trace and no cache", async (method, pathname) => {
    const hasBody = method !== "GET";
    expectNotFound(await read(await fetch(url(pathname), {
      method,
      headers: { "content-type": "application/json", [PROFILE_TOKEN_HEADER]: "whatever" },
      body: hasBody ? JSON.stringify({ id: "skin-crimson" }) : undefined,
    })));
  });

  it("the answer is the same for a request with a body that is not JSON, a form post or no body at all", async () => {
    const path = "/api/profile/ab/nope";
    const bodies: Array<{ type?: string; body?: string }> = [
      { type: "application/json", body: "{nope" }, // malformed JSON
      { type: "application/json", body: "x".repeat(5000) }, // past the shop's body limit
      { type: "application/x-www-form-urlencoded", body: "id=skin-crimson" },
      { type: "text/plain", body: "hello" },
      {}, // nothing at all
    ];
    for (const { type, body } of bodies) {
      expectNotFound(await read(await fetch(url(path), { method: "POST", headers: type ? { "content-type": type } : {}, body })));
    }
  });

  it("an unmatched route claims nothing and reads nothing: no profile is created under a name in the path", async () => {
    const free = `um${++counter}`;
    const owner = take(100);
    for (const pathname of [`/api/profile/${free}/nope`, `/api/profile/${free}/purchase/extra`, `/api/leaderboard/${free}`, `/api/${free}`]) {
      for (const method of ["GET", "POST"]) {
        const r = await read(await fetch(url(pathname), { method, headers: { [PROFILE_TOKEN_HEADER]: owner.token } }));
        expectNotFound(r);
        expectSecretless(r, owner.token, owner.name);
      }
    }
    expect(server.store.get(free)).toBeUndefined();
    expect((await api(free)).body.created).toBe(true); // the name was still free
    expect(await profileOf(owner)).toMatchObject({ gv: 100, cosmetics: { owned: [] } });
  });

  it("an unmatched route answers any origin like the real ones, and never allows credentials", async () => {
    for (const method of ["GET", "POST"]) {
      const r = await read(await fetch(url("/api/nope"), { method, headers: FOREIGN }));
      expectNotFound(r);
      expect(r.res.headers.get("access-control-allow-origin")).toBe("*");
      expect((r.res.headers.get("access-control-allow-headers") ?? "").toLowerCase()).toContain(PROFILE_TOKEN_HEADER);
      expect(r.res.headers.get("access-control-allow-credentials")).toBeNull();
    }
  });

  it("the real routes are untouched by the fallthrough behind them", async () => {
    expect((await read(await fetch(url("/api/health")))).body).toEqual({ ok: true });
    expect((await board(`?month=${RANK_MONTH}&limit=1`)).status).toBe(200);
    const who = take(100);
    expect((await api(who.name, who.token)).status).toBe(200);
    expect((await buy(who, "skin-crimson")).status).toBe(200);
    expect((await equip(who, "skin", "skin-crimson")).status).toBe(200);
    // And their refusals stay their own: a wrong method is a 405, not a 404.
    expect((await read(await fetch(url(purchasePath(who.name))))).status).toBe(405);
    expect((await read(await fetch(url(`/api/profile/${who.name}`), { method: "POST" }))).status).toBe(405);
  });

  it("an error raised before any handler ran (a malformed %-escape in a name) is a JSON 400 with no stack, for GET as well", async () => {
    const owner = take(100);
    for (const pathname of ["/api/profile/%E0%A4%A", "/api/profile/%"]) {
      for (const method of ["GET", "POST"]) {
        const r = await read(await fetch(url(pathname), { method, headers: { [PROFILE_TOKEN_HEADER]: owner.token } }));
        expect(r.status, `${method} ${pathname}`).toBe(400);
        expect(r.res.headers.get("content-type")).toMatch(/application\/json/);
        expect(r.res.headers.get("cache-control")).toBe("no-store");
        expect(r.body).toEqual({ error: "bad request" });
        expect(r.text).not.toMatch(NO_FRAMEWORK_PAGE);
        expectSecretless(r, owner.token);
      }
    }
    expect(await profileOf(owner)).toMatchObject({ gv: 100 });
  });
});

// ================================================================ the leaderboard
describe("GET /api/leaderboard: months, you and titles", () => {
  it("lists the months with GV, newest first, capped, and never a month at zero", async () => {
    const { status, body, res } = await board(`?month=${RANK_MONTH}`);
    expect(status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(monthsWithGv.length).toBeGreaterThan(LEADERBOARD_MAX_MONTHS); // the fixture is big enough to exercise the cap
    expect(body.months).toEqual(monthsWithGv.slice(0, LEADERBOARD_MAX_MONTHS));
    expect(body.months).toHaveLength(LEADERBOARD_MAX_MONTHS);
    expect([...body.months].sort().reverse()).toEqual(body.months);
    expect(new Set(body.months).size).toBe(body.months.length);
    expect(body.months).not.toContain("2016-09"); // mo_zero banked 0 there
    for (const m of [RANK_MONTH, EARN_MONTH, TIE_MONTH, TITLE_MONTH, LEAK_MONTH, "2016-02", "2016-11", "2017-05", POOL_MONTH]) {
      expect(body.months).toContain(m);
    }
    expect(body.months[0]).toBe("2017-05");
  });

  it("the shape without a name: month, entries and months, and no you", async () => {
    const { body } = await board(`?month=${RANK_MONTH}&limit=3`);
    expect(Object.keys(body).sort()).toEqual(["entries", "month", "months"]);
    expect(body.entries.map((e: any) => e.name)).toEqual(["rk_00", "rk_01", "rk_02"]);
  });

  it("an empty month, a month with a different limit, and an unknown name all keep the same months list", async () => {
    const reference = (await board(`?month=${RANK_MONTH}`)).body.months;
    expect((await board("?month=1999-12")).body).toEqual({ month: "1999-12", entries: [], months: reference });
    expect((await board(`?month=${EARN_MONTH}&limit=1`)).body.months).toEqual(reference);
  });

  it("?name= with the owner's token gives that player's rank and the GV earned that month, even far below the limit", async () => {
    const last = await boardAs("rk_29", `?month=${RANK_MONTH}&limit=3`);
    expect(last.status).toBe(200);
    expect(last.body.entries).toHaveLength(3);
    expect(last.body.entries.map((e: any) => e.name)).not.toContain("rk_29");
    expect(last.body.you).toEqual({ rank: 30, gv: 271 });
    expect(Object.keys(last.body.you).sort()).toEqual(["gv", "rank"]);

    expect((await boardAs("rk_00", `?month=${RANK_MONTH}&limit=1`)).body.you).toEqual({ rank: 1, gv: 300 });
    const mid = await boardAs("rk_12", `?month=${RANK_MONTH}`);
    expect(mid.body.you).toEqual({ rank: 13, gv: 288 });
    expect(mid.body.entries[12]).toMatchObject({ name: "rk_12", gv: 288 }); // inside the default 20, and the same place
  });

  it("ties are ranked by name, and `you` agrees with the rows", async () => {
    const { body } = await board(`?month=${TIE_MONTH}`);
    expect(body.entries.map((e: any) => [e.name, e.gv])).toEqual([["tie_c", 90], ["tie_a", 50], ["tie_b", 50]]);
    expect((await boardAs("tie_a", `?month=${TIE_MONTH}`)).body.you).toEqual({ rank: 2, gv: 50 });
    expect((await boardAs("tie_b", `?month=${TIE_MONTH}`)).body.you).toEqual({ rank: 3, gv: 50 });
  });

  it("`you` is the month asked for: a player with GV only in another month has none", async () => {
    const r = await boardAs("rk_00", `?month=${EARN_MONTH}`);
    expect(r.status).toBe(200);
    expect("you" in r.body).toBe(false);
  });

  it.each([
    ["an unknown name", "nobody_here"],
    ["a name that is too short", "x"],
    ["a name that is too long", "x".repeat(17)],
    ["a name with a space", "a%20b"],
    ["a name with a dot", "bad.name"],
    ["a name with an encoded slash", "a%2Fb"],
    ["a NUL", "%00"],
    ["an empty name", ""],
    ["a profile with a month at zero", "mo_zero"],
    ["a profile with GV only in other months", "many_mo"],
  ])("?name= %s: a normal 200 and no you, even from the profile's own owner", async (_label, name) => {
    const r = await board(`?month=2016-09&name=${name}`, seeds.find((s) => s.name === name)?.token);
    expect(r.status).toBe(200);
    expect(r.body.month).toBe("2016-09");
    expect("you" in r.body).toBe(false);
    expect(Object.keys(r.body).sort()).toEqual(["entries", "month", "months"]);
  });

  it("a profile with nothing this month, and a repeated name parameter, have no you either", async () => {
    const fresh = await claim();
    const owner = (name: string) => seeds.find((s) => s.name === name)!.token;
    expect("you" in (await board(`?name=${fresh.name}`, fresh.token)).body).toBe(false);
    expect("you" in (await board(`?month=${RANK_MONTH}&name=rk_00&name=rk_01`, owner("rk_00"))).body).toBe(false);
    expect("you" in (await board(`?month=${RANK_MONTH}&name[]=rk_00`, owner("rk_00"))).body).toBe(false);
  });

  it("`you` works for the profile names that clash with Object.prototype", async () => {
    for (const name of ["__proto__", "constructor", "toString"]) {
      const r = await boardAs(name, `?month=${RANK_MONTH}`);
      expect(r.status).toBe(200);
      expect("you" in r.body).toBe(false);
    }
    expect((await boardAs("__proto__", `?month=${POOL_MONTH}&limit=1`)).body.you).toMatchObject({ gv: 100 });
    for (const name of ["constructor", "toString"]) expect((await boardAs(name, `?month=${POOL_MONTH}&limit=1`)).body.you).toMatchObject({ gv: 100 });
    expectPrototypeClean();
  });

  it("an owned, equipped title shows as `title` on that profile's row only", async () => {
    const { body } = await board(`?month=${RANK_MONTH}`);
    const titles = Object.fromEntries(body.entries.map((e: any) => [e.name, e.title]));
    expect(titles.rk_05).toBe("title-rookie");
    expect(titles.rk_09).toBe("title-bloodied");
    for (const row of body.entries) {
      if (row.name === "rk_05" || row.name === "rk_09") continue;
      expect("title" in row).toBe(false); // rk_06 never owned its title, rk_07/rk_08 wear no title
    }
  });

  it("buying and equipping a title puts it on the board, and unequipping takes it off; a rival is untouched", async () => {
    const mine = account(seeds.find((s) => s.name === "ttl_1")!);
    const rows = async () => (await board(`?month=${TITLE_MONTH}`)).body.entries as Array<Record<string, unknown>>;
    expect(await rows()).toEqual([{ name: "ttl_1", gv: 777 }, { name: "ttl_2", gv: 700 }]);

    expect((await buy(mine, "title-rookie")).body.profile.gv).toBe(0);
    expect(await rows()).toEqual([{ name: "ttl_1", gv: 777 }, { name: "ttl_2", gv: 700 }]); // owning is not wearing

    expect((await equip(mine, "title", "title-rookie")).status).toBe(200);
    expect(await rows()).toEqual([{ name: "ttl_1", gv: 777, title: "title-rookie" }, { name: "ttl_2", gv: 700 }]);

    expect((await equip(mine, "title", null)).status).toBe(200);
    expect(await rows()).toEqual([{ name: "ttl_1", gv: 777 }, { name: "ttl_2", gv: 700 }]);
  });

  it("a rival cannot put a title on someone else's row", async () => {
    const rival = account(seeds.find((s) => s.name === "ttl_2")!);
    const victim = account(seeds.find((s) => s.name === "ttl_1")!);
    expectRefused(await equipAs(victim, rival.token, "title", null), 403, "forbidden");
    expectRefused(await equip(rival, "title", "title-rookie"), 409, "not_owned");
    const { body } = await board(`?month=${TITLE_MONTH}`);
    expect(body.entries.find((e: any) => e.name === "ttl_2")).toEqual({ name: "ttl_2", gv: 700 });
  });

  it("the public board shows names, GV earned and titles: no tokens, no balances, no profile data", async () => {
    const months = [RANK_MONTH, EARN_MONTH, TIE_MONTH, TITLE_MONTH, LEAK_MONTH, POOL_MONTH];
    for (const month of months) {
      const r = await boardAs("leak_x", `?month=${month}&limit=100`); // with `you` in the body too
      for (const s of seeds) expect(r.text).not.toContain(s.token);
      for (const row of r.body.entries) {
        expect(Object.keys(row).every((k) => ["name", "gv", "title"].includes(k))).toBe(true);
        expect(typeof row.name).toBe("string");
        expect(Number.isInteger(row.gv)).toBe(true);
      }
      expect(r.text).not.toMatch(/token|balance|gvLifetime|cosmetics|owned|achievements|progress|stash/i);
    }
  });

  it("a profile's spendable GV and lifetime GV are not on the board; the month's GV is", async () => {
    const r = await boardAs("leak_x", `?month=${LEAK_MONTH}`);
    expect(r.body.entries).toEqual([{ name: "leak_x", gv: 555 }]);
    expect(r.body.you).toEqual({ rank: 1, gv: 555 });
    expect(r.text).not.toContain("4242424");
    expect(r.text).not.toContain("6000000");
  });
});

// ================================================================ `you` belongs to its owner
describe("GET /api/leaderboard: `you` needs the owner's token", () => {
  const MINE = "rk_29"; // 30th of 30 in RANK_MONTH: far below any limit the query asks for
  const query = `?month=${RANK_MONTH}&limit=3`;
  const tokenOf = (name: string) => seeds.find((s) => s.name === name)!.token;

  /** What identifies a response apart from its date: status, headers and the exact bytes. */
  function fingerprint(r: Reply): unknown {
    const headers = Object.fromEntries([...r.res.headers.entries()].filter(([k]) => k !== "date"));
    return { status: r.status, headers, text: r.text };
  }

  it("the owner's own token gets the rank and the month's GV, far below the limit, with the rest of the body unchanged", async () => {
    const plain = await board(query);
    const mine = await board(`${query}&name=${MINE}`, tokenOf(MINE));
    expect(mine.status).toBe(200);
    expect(mine.res.headers.get("cache-control")).toBe("no-store"); // a per-owner answer must never be stored
    expect(mine.body.you).toEqual({ rank: 30, gv: 271 });
    expect(mine.body.entries.map((e: any) => e.name)).not.toContain(MINE);
    const { you: _you, ...rest } = mine.body;
    expect(rest).toEqual(plain.body);
  });

  it("the right rank comes with the right token on the default limit and on the maximum one", async () => {
    for (const limit of ["", "&limit=1", "&limit=100"]) {
      expect((await board(`?month=${RANK_MONTH}${limit}&name=rk_12`, tokenOf("rk_12"))).body.you).toEqual({ rank: 13, gv: 288 });
    }
  });

  const denied: Array<[string, () => string | undefined]> = [
    ["no token", () => undefined],
    ["an empty token", () => ""],
    ["a made-up token", () => "not-the-token"],
    ["another profile's valid token (a better rank)", () => tokenOf("rk_00")],
    ["another profile's valid token (a worse rank)", () => tokenOf("tie_a")],
    ["the right token in the wrong case", () => tokenOf(MINE).toUpperCase()],
    ["the right token plus one character", () => `${tokenOf(MINE)}0`],
    ["the right token minus one character", () => tokenOf(MINE).slice(0, -1)],
    ["the right token behind a Bearer prefix", () => `Bearer ${tokenOf(MINE)}`],
    ["the right token twice, comma separated", () => `${tokenOf(MINE)}, ${tokenOf(MINE)}`],
  ];

  it.each(denied)("%s: a normal 200, no you, and the body of a request that never named anyone", async (_label, token) => {
    const plain = await board(query);
    const r = await board(`${query}&name=${MINE}`, token());
    expect(r.status).toBe(200);
    expect("you" in r.body).toBe(false);
    expect(r.body).toEqual(plain.body);
    expect(r.text).toBe(plain.text);
    expect(r.res.headers.get("cache-control")).toBe("no-store");
    expect(r.res.headers.get("content-type")).toMatch(/application\/json/);
    expect(r.text).not.toContain("271"); // the GV of the profile asked about is not anywhere in the answer
  });

  it("the token is read from the header only: a query string, a cookie, an Authorization header or a second token header do not do", async () => {
    const plain = await board(query);
    const token = tokenOf(MINE);
    const doubled = new Headers();
    doubled.append(PROFILE_TOKEN_HEADER, token);
    doubled.append(PROFILE_TOKEN_HEADER, tokenOf("rk_00"));
    const named = `/api/leaderboard${query}&name=${MINE}`;
    const withHeaders = async (headers: HeadersInit) => read(await fetch(url(named), { headers }));
    const attempts: Reply[] = [
      await board(`${query}&name=${MINE}&${PROFILE_TOKEN_HEADER}=${token}`),
      await board(`${query}&name=${MINE}&token=${token}`),
      await withHeaders({ cookie: `${PROFILE_TOKEN_HEADER}=${token}; token=${token}` }),
      await withHeaders({ authorization: `Bearer ${token}` }),
      await withHeaders({ "x-token": token, "x-auth-token": token }),
      await withHeaders(doubled),
    ];
    for (const r of attempts) {
      expect(r.status).toBe(200);
      expect(r.text).toBe(plain.text);
    }
  });

  it("whether a name exists cannot be told from the answer: a real name, an unclaimed one and an invalid one are byte for byte alike", async () => {
    const ghost = `ghost${++counter}`; // valid, and nobody has claimed it
    expect(server.store.get(ghost)).toBeUndefined();
    const stranger = await claim();
    const answers = [
      await board(query),
      await board(`${query}&name=${MINE}`),
      await board(`${query}&name=${MINE}`, "wrong"),
      await board(`${query}&name=${MINE}`, tokenOf("rk_00")),
      await board(`${query}&name=${ghost}`),
      await board(`${query}&name=${ghost}`, "wrong"),
      await board(`${query}&name=${ghost}`, stranger.token),
      await board(`${query}&name=x`, tokenOf(MINE)), // too short to be a name
      await board(`${query}&name=bad%20name`, tokenOf(MINE)),
      await board(`${query}&name=`, tokenOf(MINE)),
    ];
    const [reference, ...others] = answers.map(fingerprint);
    for (const other of others) expect(other).toEqual(reference);
    expect(server.store.get(ghost)).toBeUndefined(); // asking about a name never creates it
  });

  it("a stranger's own valid token never reveals someone else's place, and never claims anything", async () => {
    const stranger = await claim();
    const r = await board(`${query}&name=${MINE}`, stranger.token);
    expect("you" in r.body).toBe(false);
    expect(server.store.get(MINE)!.name).toBe(MINE);
    expect((await board(`?month=${RANK_MONTH}&name=${stranger.name}`, stranger.token)).body.you).toBeUndefined(); // no GV this month
  });

  it("the board itself stays public: top rows, months and titles are the same with a token, with someone else's, and with none", async () => {
    const reference = await board(`?month=${RANK_MONTH}&limit=20`);
    expect(reference.status).toBe(200);
    expect(reference.body.months).toEqual(monthsWithGv.slice(0, LEADERBOARD_MAX_MONTHS));
    expect(reference.body.entries[0]).toEqual({ name: "rk_00", gv: 300 });
    expect(Object.fromEntries(reference.body.entries.map((e: any) => [e.name, e.title])).rk_05).toBe("title-rookie");
    for (const token of [tokenOf("rk_05"), tokenOf("rk_29"), "wrong", ""]) {
      expect((await board(`?month=${RANK_MONTH}&limit=20`, token)).text).toBe(reference.text); // a token alone changes nothing
    }
    for (const name of ["rk_05", "rk_29", "nobody_here"]) {
      const named = await board(`?month=${RANK_MONTH}&limit=20&name=${name}`);
      expect(named.text).toBe(reference.text);
    }
  });

  it("the current month, when it is not asked for by name, ranks the owner with the token and nobody without it", async () => {
    const who = await claim();
    server.store.bankGv(who.name, 123);
    const withToken = await board(`?limit=100&name=${who.name}`, who.token);
    const without = await board(`?limit=100&name=${who.name}`);
    expect(withToken.status).toBe(200);
    expect(without.status).toBe(200);
    const place = withToken.body.entries.findIndex((e: any) => e.name === who.name);
    expect(place).toBeGreaterThanOrEqual(0); // the row itself is public
    expect(withToken.body.you).toEqual({ rank: place + 1, gv: 123 });
    expect("you" in without.body).toBe(false);
    expect(without.body.entries).toEqual(withToken.body.entries);
  });
});

// ================================================================ regression guards
describe("GET /api/profile/:name: the existing rules still hold", () => {
  it("a wrong, missing or foreign token is a 403 with no profile and no token in it", async () => {
    const victim = take(100);
    const other = await claim();
    for (const token of [undefined, "", "wrong", other.token, victim.token.toUpperCase()]) {
      const r = await api(victim.name, token);
      expect(r.status).toBe(403);
      expect(r.res.headers.get("cache-control")).toBe("no-store");
      expect(r.body.profile).toBeUndefined();
      expect(r.body.token).toBeUndefined();
      expectSecretless(r, victim.token, other.token, "tok-");
    }
    expect((await api(victim.name, victim.token)).status).toBe(200);
  });

  it("a free name is claimed only by a request without the owner's token, once; after that it is the owner's", async () => {
    const name = `free-${++counter}`;
    const first = await api(name);
    expect(first.status).toBe(200);
    expect(first.body.created).toBe(true);
    expect(first.body.token).toMatch(/^[0-9a-f-]{36}$/);
    expect((await api(name)).status).toBe(403);
    expect((await api(name, "guess")).status).toBe(403);
    const owner = await api(name, first.body.token);
    expect(owner.status).toBe(200);
    expect(owner.body.created).toBe(false);
    expect(owner.body.token).toBe(first.body.token);
  });

  it("the profile response carries its own token beside the profile and no other profile's token", async () => {
    const who = take(100);
    const r = await api(who.name, who.token);
    expect(Object.keys(r.body).sort()).toEqual(["created", "profile", "token"]);
    expect(Object.keys(r.body.profile).sort()).toEqual(PROFILE_FIELDS);
    expect(JSON.stringify(r.body.profile)).not.toContain(who.token);
    for (const s of seeds) if (s.name !== who.name) expect(r.text).not.toContain(s.token);
    expect(r.text).not.toContain("stash");
  });

  it("a fresh claim holds no one else's token, and the profile it returns has empty achievements and zero progress", async () => {
    const r = await api(`claim-${++counter}`);
    expect(r.status).toBe(200);
    for (const s of seeds) expect(r.text).not.toContain(s.token);
    expect(r.body.profile.achievements).toEqual({});
    expect(r.body.profile.progress).toEqual({ qualifiedWins: 0, bountyRuns: 0, bestRunKills: 0, winsByFaction: {}, winsByWeapon: {} });
  });

  it("shop responses never contain another profile's token either", async () => {
    const who = take(100);
    const replies = [await buy(who, "skin-crimson"), await equip(who, "skin", "skin-crimson"), await equip(who, "skin", null)];
    for (const r of replies) {
      expect(r.status).toBe(200);
      for (const s of seeds) expect(r.text).not.toContain(s.token);
    }
  });

  it("the profile route's claim-or-return behaviour is untouched by the shop routes next to it", async () => {
    const who = take(100);
    await buy(who, "skin-crimson");
    const r = await api(who.name, who.token);
    expect(r.body.created).toBe(false);
    expect(r.body.token).toBe(who.token);
    expect(r.body.profile.gv).toBe(60);
    expect(r.body.profile.cosmetics.owned).toEqual(["skin-crimson"]);
  });
});
