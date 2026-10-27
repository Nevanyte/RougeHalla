// The HTTP API over a real socket: the real server in this process on a free port and a temp profile file,
// seeded with a few profiles (some with GV in past months) before it starts. Every test claims its own names.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LEADERBOARD_DEFAULT_LIMIT, LEADERBOARD_MAX_LIMIT, LEADERBOARD_MAX_MONTHS, PASSCODE_HEADER, PROFILE_TOKEN_HEADER, ROOM_NAME, monthKey,
  type LeaderboardResponse, type ProfileResponse,
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
const stats = (over: Record<string, number> = {}) => ({ runs: 0, wins: 0, draws: 0, deaths: 0, kills: 0, ...over });
/** The meta layer's defaults: what a profile written before achievements existed reads back as. */
const zeroProgress = { qualifiedWins: 0, bountyRuns: 0, bestRunKills: 0, winsByFaction: {}, winsByWeapon: {} };
/** Seeds are written as an older v2 file would have them, without `achievements` or `progress` unless a test gives them. */
const seedProfile = (name: string, gvByMonth: Record<string, number> = {}, over: Record<string, unknown> = {}) => ({
  name, token: `tok-${name}`, gv: 0, gvLifetime: 0, gvByMonth, stats: stats(), cosmetics: { owned: [], equipped: {} }, ...over,
});

/** Ties at 300 sort by name in code unit order, so an uppercase name comes first. */
const MARCH = "2019-03";
const APRIL = "2019-04";
const FULL = seedProfile("s_full", { "2017-11": 900 }, {
  gv: 700, gvLifetime: 900,
  stats: stats({ runs: 12, wins: 3, draws: 1, deaths: 8, kills: 21 }),
  cosmetics: { owned: ["cape-red", "trail-blue"], equipped: { cape: "cape-red" } },
});
/** Carries the meta fields in full, so the API can be seen serving them. Two wins, one of them qualified. */
const META = seedProfile("s_meta", {}, {
  gv: 15, gvLifetime: 15, gvByMonth: { "2017-12": 15 },
  stats: stats({ runs: 3, wins: 2, deaths: 1, kills: 2 }),
  cosmetics: { owned: ["title-victor", "skin-laurel"], equipped: { title: "title-victor" } },
  achievements: { first_win: 1_700_000_000_000 },
  progress: { qualifiedWins: 1, bountyRuns: 0, bestRunKills: 2, winsByFaction: { fire: 1 }, winsByWeapon: { axe: 1 } },
});
/**
 * Written by the build before `qualifiedWins` existed: four wins, a progress object without the counter. It must read
 * back as 0 qualified wins (not as 4), with every other counter kept.
 */
const OLD_COUNTERS = { bountyRuns: 1, bestRunKills: 3, winsByFaction: { fire: 2 }, winsByWeapon: { sword: 2 } };
const OLD_PROGRESS = seedProfile("s_oldprog", {}, {
  stats: stats({ runs: 6, wins: 4, deaths: 2, kills: 5 }),
  achievements: { first_blood: 1_600_000_000_000 },
  cosmetics: { owned: ["title-bloodied"], equipped: {} },
  progress: OLD_COUNTERS,
});
const CROWD = "2018-01";
const crowd = Array.from({ length: 120 }, (_, i) => seedProfile(`crowd${String(i).padStart(3, "0")}`, { [CROWD]: i + 1 }));
const seeded = [
  FULL,
  META,
  OLD_PROGRESS,
  seedProfile("s_bob", { [MARCH]: 500 }),
  seedProfile("s_amy", { [MARCH]: 300 }),
  seedProfile("s_cat", { [MARCH]: 300 }),
  seedProfile("s_Dan", { [MARCH]: 300 }),
  seedProfile("s_eve", { [MARCH]: 1 }),
  seedProfile("s_fay", { [MARCH]: 0 }),
  seedProfile("s_gay", { [APRIL]: 40 }),
  ...crowd,
];

// ---------------------------------------------------------------- server fixture
let server: RaidServer;
let port = 0;
let dir = "";
let profileFile = "";

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-api-"));
  profileFile = path.join(dir, "data", "stash.json");
  fs.mkdirSync(path.dirname(profileFile), { recursive: true });
  fs.writeFileSync(profileFile, JSON.stringify({ version: 2, profiles: Object.fromEntries(seeded.map((p) => [p.name, p])) }));
  port = await freePort();
  server = await startServer({ ...loadConfig({}), port, latencyMs: 0, stashFile: profileFile });
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

async function api(name: string, token?: string) {
  const res = await fetch(url(`/api/profile/${name}`), { headers: token === undefined ? {} : { [PROFILE_TOKEN_HEADER]: token } });
  return { res, status: res.status, text: await res.clone().text(), body: (await res.json()) as any };
}

async function board(query = "") {
  const res = await fetch(url(`/api/leaderboard${query}`));
  return { res, status: res.status, text: await res.clone().text(), body: (await res.json()) as any };
}

let counter = 0;
interface Account { name: string; token: string }

/** A brand new profile, claimed over HTTP the way the menu does it. */
async function claim(): Promise<Account> {
  const name = `tp${++counter}`;
  const { status, body } = await api(name);
  expect(status).toBe(200);
  expect(body.created).toBe(true);
  return { name, token: body.token };
}

const names = (entries: Array<{ name: string }>) => entries.map((e) => e.name);

describe("GET /api/profile/:name", () => {
  it("claims a free name: a token and an empty profile, never cached", async () => {
    const { res, status, body } = await api("claim-me");
    expect(status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(Object.keys(body).sort()).toEqual(["created", "profile", "token"]);
    expect(body.created).toBe(true);
    expect(body.token).toMatch(/^[0-9a-f-]{36}$/);
    const response: ProfileResponse = body;
    expect(response.profile).toEqual({
      name: "claim-me", gv: 0, gvLifetime: 0, gvByMonth: {},
      stats: { runs: 0, wins: 0, draws: 0, deaths: 0, kills: 0 },
      cosmetics: { owned: [], equipped: {} },
      achievements: {}, progress: zeroProgress,
    });
  });

  it("the profile has exactly the documented fields: no stash, and the token only beside it", async () => {
    const { body, text } = await api("fields-1");
    expect(Object.keys(body.profile).sort()).toEqual(["achievements", "cosmetics", "gv", "gvByMonth", "gvLifetime", "name", "progress", "stats"]);
    expect(Object.keys(body.profile.stats).sort()).toEqual(["deaths", "draws", "kills", "runs", "wins"]);
    expect(Object.keys(body.profile.cosmetics).sort()).toEqual(["equipped", "owned"]);
    expect(Object.keys(body.profile.progress).sort()).toEqual(["bestRunKills", "bountyRuns", "qualifiedWins", "winsByFaction", "winsByWeapon"]);
    expect(JSON.stringify(body.profile)).not.toContain(body.token);
    expect(text).not.toContain("stash");
  });

  it("returns the same profile to its owner", async () => {
    const first = await api("owner1");
    const again = await api("owner1", first.body.token);
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
    expect(again.body.token).toBe(first.body.token);
    expect(again.body.profile).toEqual(first.body.profile);
  });

  it("serves a stored profile in full: GV, lifetime, months, stats and cosmetics", async () => {
    const { status, body } = await api("s_full", "tok-s_full");
    expect(status).toBe(200);
    expect(body.created).toBe(false);
    expect(body.token).toBe("tok-s_full");
    expect(body.profile).toEqual({
      name: "s_full", gv: 700, gvLifetime: 900, gvByMonth: { "2017-11": 900 },
      stats: { runs: 12, wins: 3, draws: 1, deaths: 8, kills: 21 },
      cosmetics: { owned: ["cape-red", "trail-blue"], equipped: { cape: "cape-red" } },
      achievements: {}, progress: zeroProgress, // an older file without the meta fields reads back as none unlocked
    });
  });

  it("serves the achievements and progress a stored profile has, in full, with qualifiedWins apart from stats.wins", async () => {
    const { status, body } = await api("s_meta", "tok-s_meta");
    expect(status).toBe(200);
    expect(body.profile).toEqual({
      name: "s_meta", gv: 15, gvLifetime: 15, gvByMonth: { "2017-12": 15 },
      stats: { runs: 3, wins: 2, draws: 0, deaths: 1, kills: 2 },
      cosmetics: { owned: ["title-victor", "skin-laurel"], equipped: { title: "title-victor" } },
      achievements: { first_win: 1_700_000_000_000 },
      progress: { qualifiedWins: 1, bountyRuns: 0, bestRunKills: 2, winsByFaction: { fire: 1 }, winsByWeapon: { axe: 1 } },
    });
    expect(body.profile.progress.qualifiedWins).toBeLessThan(body.profile.stats.wins); // the two are different counters
    expect(JSON.stringify(body.profile)).not.toContain("tok-s_meta");
  });

  it("a profile stored before qualifiedWins existed serves 0, not its old win count, and keeps every other counter", async () => {
    const { status, body } = await api("s_oldprog", "tok-s_oldprog");
    expect(status).toBe(200);
    expect(body.profile.stats.wins).toBe(4);
    expect(body.profile.progress).toEqual({
      qualifiedWins: 0, bountyRuns: 1, bestRunKills: 3, winsByFaction: { fire: 2 }, winsByWeapon: { sword: 2 },
    });
    expect(body.profile.achievements).toEqual({ first_blood: 1_600_000_000_000 });
    // A file with no progress at all reads the same way.
    const bare = await api("s_full", "tok-s_full");
    expect(bare.body.profile.progress.qualifiedWins).toBe(0);
  });

  it("reflects what a resolved run banked", async () => {
    const who = await claim();
    server.store.recordRun(who.name, { outcome: "won", kills: 2, gv: 10, winQualified: true });
    server.store.recordRun(who.name, { outcome: "mia", kills: 0, gv: 0 });
    const { body } = await api(who.name, who.token);
    expect(body.profile.gv).toBe(10);
    expect(body.profile.gvLifetime).toBe(10);
    expect(Object.keys(body.profile.gvByMonth)).toHaveLength(1);
    expect(Object.values(body.profile.gvByMonth)).toEqual([10]);
    expect(body.profile.stats).toEqual({ runs: 2, wins: 1, draws: 0, deaths: 1, kills: 2 });
    // The same run's achievements and counters, as the store recorded them.
    expect(Object.keys(body.profile.achievements).sort()).toEqual(["first_blood", "first_win"]);
    expect(body.profile.progress).toEqual({ ...zeroProgress, qualifiedWins: 1, bestRunKills: 2 });
    expect(body.profile.cosmetics.owned).toEqual(["title-bloodied", "title-victor", "skin-laurel"]);
  });

  it("a win that did not pass the gate is a win in stats but not a qualified one: no First Win, no counters", async () => {
    const who = await claim();
    server.store.recordRun(who.name, { outcome: "won", kills: 0, gv: 0, faction: "fire", weapon: "axe" });
    server.store.recordRun(who.name, { outcome: "won", kills: 0, gv: 0, faction: "fire", weapon: "axe", winQualified: false });
    const { body } = await api(who.name, who.token);
    expect(body.profile.stats).toEqual({ runs: 2, wins: 2, draws: 0, deaths: 0, kills: 0 });
    expect(body.profile.progress).toEqual(zeroProgress);
    expect(body.profile.achievements).toEqual({});
    expect(body.profile.cosmetics.owned).toEqual([]);

    // The first one that does pass counts from there, and unlocks First Win (and the faction win) then.
    server.store.recordRun(who.name, { outcome: "won", kills: 0, gv: 0, faction: "fire", weapon: "axe", winQualified: true });
    const later = (await api(who.name, who.token)).body.profile;
    expect(later.stats.wins).toBe(3);
    expect(later.progress).toEqual({ ...zeroProgress, qualifiedWins: 1, winsByFaction: { fire: 1 }, winsByWeapon: { axe: 1 } });
    expect(Object.keys(later.achievements)).toEqual(["first_win", "win_fire"]);
    expect(later.cosmetics.owned).toEqual(["title-victor", "skin-laurel", "title-pyre-lord"]);
  });

  it("answers 403 to anyone else, and never leaks a token", async () => {
    const victim = await api("victim1");
    const other = await api("other1");
    const secrets = [victim.body.token, other.body.token, "tok-s_full"];
    for (const attempt of [undefined, "", "wrong", other.body.token]) {
      const r = await api("victim1", attempt);
      expect(r.status).toBe(403);
      expect(r.res.headers.get("cache-control")).toBe("no-store");
      for (const s of secrets) expect(r.text).not.toContain(s);
      expect(r.body.profile).toBeUndefined();
    }
    const stored = await api("s_full", "wrong");
    expect(stored.status).toBe(403);
    expect(stored.text).not.toContain("900");
  });

  it.each(["a", "x".repeat(17), "bad%20name", "a.b", "%E2%82%AC%E2%82%AC", "a%2Fb", "%00%00"])("answers 400 for the invalid name %s", async (name) => {
    const { status, body } = await api(name);
    expect(status).toBe(400);
    expect(body.profile).toBeUndefined();
    expect(body.token).toBeUndefined();
  });

  it("a refused request changes nothing", async () => {
    const keeper = await api("keeper1");
    expect((await api("keeper1")).status).toBe(403);
    expect((await api("x")).status).toBe(400);
    expect(server.store.get("x")).toBeUndefined();
    expect((await api("keeper1", keeper.body.token)).body.profile).toEqual(keeper.body.profile);
  });

  it("ignores a token sent for a free name and issues a fresh one", async () => {
    const r = await api("fresh1", "stale-token-from-a-wiped-server");
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(true);
    expect(r.body.token).not.toBe("stale-token-from-a-wiped-server");
  });

  it("accepts names that clash with Object.prototype", async () => {
    const r = await api("__proto__");
    expect(r.status).toBe(200);
    expect(r.body.profile.name).toBe("__proto__");
    expect((await api("__proto__", r.body.token)).body.created).toBe(false);
    expect((await api("__proto__")).status).toBe(403);
  });

  it("keeps /api/health", async () => {
    const res = await fetch(url("/api/health"));
    expect(await res.json()).toEqual({ ok: true });
  });

  it("claims reach the profile file, in the v2 format", async () => {
    const who = await claim();
    await server.store.flush();
    const disk = JSON.parse(fs.readFileSync(profileFile, "utf8"));
    expect(disk.version).toBe(2);
    expect(disk.profiles[who.name]).toEqual({
      name: who.name, token: who.token, gv: 0, gvLifetime: 0, gvByMonth: {},
      stats: { runs: 0, wins: 0, draws: 0, deaths: 0, kills: 0 }, cosmetics: { owned: [], equipped: {} },
      achievements: {}, progress: zeroProgress,
    });
    // The seeded profiles came through the rewrite untouched; the older ones only gained the meta defaults.
    expect(disk.profiles.s_full).toEqual({ ...FULL, achievements: {}, progress: zeroProgress });
    expect(disk.profiles.s_meta).toEqual(META);
    expect(disk.profiles.s_oldprog).toEqual({ ...OLD_PROGRESS, progress: { ...OLD_COUNTERS, qualifiedWins: 0 } });
  });
});

describe("GET /api/leaderboard", () => {
  it("answers { month, entries } for a month, highest GV first, ties by name, never cached", async () => {
    const { res, status, body } = await board(`?month=${MARCH}`);
    expect(status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(Object.keys(body).sort()).toEqual(["entries", "month", "months"]);
    const response: LeaderboardResponse = body;
    expect({ month: response.month, entries: response.entries }).toEqual({
      month: MARCH,
      entries: [
        { name: "s_bob", gv: 500 }, { name: "s_Dan", gv: 300 }, { name: "s_amy", gv: 300 },
        { name: "s_cat", gv: 300 }, { name: "s_eve", gv: 1 },
      ],
    });
    expect(Array.isArray(response.months)).toBe(true);
  });

  it("months lists the months anyone banked GV in, newest first, and no month at zero or with nobody", async () => {
    const { months } = (await board(`?month=${MARCH}`)).body as LeaderboardResponse;
    expect(months).toEqual([...months].sort().reverse()); // newest first
    expect(new Set(months).size).toBe(months.length);
    expect(months.length).toBeLessThanOrEqual(LEADERBOARD_MAX_MONTHS);
    // The seeded months are all there, in order; the current month (from other tests' runs) sorts above them.
    const seededMonths = ["2019-04", MARCH, CROWD, "2017-12", "2017-11"];
    expect(months.filter((m) => seededMonths.includes(m))).toEqual(seededMonths);
    expect(months).not.toContain("1999-12");
    // The list does not depend on the month asked about.
    expect((await board(`?month=1999-12`)).body.months).toEqual(months);
  });

  it("an entry is a name and a number: no token, no other profile data", async () => {
    const { body, text } = await board(`?month=${MARCH}`);
    for (const e of body.entries) expect(Object.keys(e).sort()).toEqual(["gv", "name"]);
    for (const p of seeded) expect(text).not.toContain(p.token);
  });

  it("lists a month on its own: GV from other months, and a month at zero, do not count", async () => {
    expect((await board(`?month=${APRIL}`)).body.entries).toEqual([{ name: "s_gay", gv: 40 }]);
    expect(names((await board(`?month=${MARCH}`)).body.entries)).not.toContain("s_fay");
    expect((await board("?month=2017-11")).body.entries).toEqual([{ name: "s_full", gv: 900 }]);
  });

  it("a month nobody played is an empty board, not an error", async () => {
    const { status, body } = await board("?month=1999-12");
    expect(status).toBe(200);
    expect(body.month).toBe("1999-12");
    expect(body.entries).toEqual([]);
    expect(body.months).not.toContain("1999-12");
  });

  describe("limit", () => {
    it("defaults to LEADERBOARD_DEFAULT_LIMIT", async () => {
      const { body } = await board(`?month=${CROWD}`);
      expect(body.entries).toHaveLength(LEADERBOARD_DEFAULT_LIMIT);
      expect(body.entries[0]).toEqual({ name: "crowd119", gv: 120 });
      expect(body.entries.at(-1)).toEqual({ name: "crowd100", gv: 101 });
    });

    it.each<[string, number]>([
      ["3", 3],
      ["%2B4", 4], // a literal "+", since a bare one in a query string means a space
      ["1", 1],
      ["0", 1],
      ["-5", 1],
      ["007", 7],
      [String(LEADERBOARD_MAX_LIMIT), LEADERBOARD_MAX_LIMIT],
      [String(LEADERBOARD_MAX_LIMIT + 1), LEADERBOARD_MAX_LIMIT],
      ["100000", LEADERBOARD_MAX_LIMIT],
      ["9".repeat(400), LEADERBOARD_MAX_LIMIT],
    ])("limit=%s gives %i entries (an integer is clamped into range)", async (limit, count) => {
      const { status, body } = await board(`?month=${CROWD}&limit=${limit}`);
      expect(status).toBe(200);
      expect(body.entries).toHaveLength(count);
      expect(body.entries[0]).toEqual({ name: "crowd119", gv: 120 });
    });

    it.each(["abc", "", "2.5", "1e2", "0x10", "NaN", "Infinity", "%205", "5%20", "3,4", "--1", "5abc", "%00"])(
      "limit=%j is not an integer: the default applies",
      async (limit) => {
        const { status, body } = await board(`?month=${CROWD}&limit=${limit}`);
        expect(status).toBe(200);
        expect(body.entries).toHaveLength(LEADERBOARD_DEFAULT_LIMIT);
      },
    );

    it("a repeated limit is not an integer either", async () => {
      expect((await board(`?month=${CROWD}&limit=1&limit=2`)).body.entries).toHaveLength(LEADERBOARD_DEFAULT_LIMIT);
    });

    it("does not pad a short board", async () => {
      expect((await board(`?month=${MARCH}&limit=50`)).body.entries).toHaveLength(5);
    });
  });

  describe("month", () => {
    it.each([
      "", "2019-3", "2019-13", "2019-00", "19-03", "abc", "2019-03-01", "2019/03", " 2019-03", "2019-03 ", "20190-03", "%00", "__proto__",
    ])("month=%j is rejected with 400, never cached, and says why", async (month) => {
      const { res, status, body } = await board(`?month=${encodeURIComponent(month)}`);
      expect(status).toBe(400);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(body.entries).toBeUndefined();
      expect(body.error).toMatch(/month/);
    });

    it("a repeated month is rejected too", async () => {
      expect((await board(`?month=${MARCH}&month=${APRIL}`)).status).toBe(400);
    });

    it("a bad month is rejected even with a good limit", async () => {
      expect((await board("?month=2019-13&limit=5")).status).toBe(400);
    });

    it("the month parameter is the only thing that picks the month; other parameters are ignored", async () => {
      const { status, body } = await board(`?month=${APRIL}&x=1&limit=1&nonsense`);
      expect(status).toBe(200);
      expect(body.entries).toEqual([{ name: "s_gay", gv: 40 }]);
    });
  });

  describe("the current month", () => {
    const LIVE = 25;

    it("is the default; the default limit applies; new GV shows at once", async () => {
      const before = monthKey(Date.now());
      for (let i = 0; i < LIVE; i++) {
        const name = `live-${String(i).padStart(2, "0")}`;
        server.store.claim(name);
        server.store.bankGv(name, 1000 + i);
      }
      const { status, body } = await board();
      const after = monthKey(Date.now());
      expect(status).toBe(200);
      expect([before, after]).toContain(body.month);
      expect(body.entries).toHaveLength(LEADERBOARD_DEFAULT_LIMIT);
      expect(names(body.entries)).toEqual(Array.from({ length: LEADERBOARD_DEFAULT_LIMIT }, (_, i) => `live-${String(LIVE - 1 - i).padStart(2, "0")}`));
      expect(body.entries[0]).toEqual({ name: "live-24", gv: 1024 });

      server.store.bankGv("live-00", 5000);
      const again = await board("?limit=2");
      expect(again.body.entries).toEqual([{ name: "live-00", gv: 6000 }, { name: "live-24", gv: 1024 }]);
      // The same board by its explicit month.
      expect((await board(`?month=${again.body.month}&limit=2`)).body).toEqual(again.body);
    });

    it("a profile claimed over HTTP and paid by a run appears under its own name", async () => {
      const who = await claim();
      server.store.recordRun(who.name, { outcome: "won", kills: 1, gv: 9_999_999 });
      const { body } = await board("?limit=1");
      expect(body.entries).toEqual([{ name: who.name, gv: 9_999_999 }]);
    });
  });
});

describe("/api: method and CORS rules", () => {
  const ALLOW_HEADERS = `${PROFILE_TOKEN_HEADER}, ${PASSCODE_HEADER}, content-type`;
  const foreign = { origin: "http://game.example.test" };

  it.each(["HEAD", "POST", "PUT", "PATCH", "DELETE"])("%s on a profile is refused with 405 and claims nothing", async (method) => {
    const name = `m${method.toLowerCase()}${++counter}`;
    const res = await fetch(url(`/api/profile/${name}`), { method });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, OPTIONS");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(server.store.get(name)).toBeUndefined(); // the name was not burned
    const mine = await api(name);
    expect(mine.status).toBe(200);
    expect(mine.body.created).toBe(true);
    expect(mine.body.token).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each(["HEAD", "POST", "PUT", "PATCH", "DELETE"])("%s on the leaderboard is refused with 405", async (method) => {
    const res = await fetch(url(`/api/leaderboard?month=${MARCH}`), { method });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, OPTIONS");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).not.toContain("s_bob");
  });

  it("a non-GET with the owner's token is refused too, and hands out no token", async () => {
    const who = await claim();
    for (const method of ["HEAD", "POST"]) {
      const res = await fetch(url(`/api/profile/${who.name}`), { method, headers: { [PROFILE_TOKEN_HEADER]: who.token } });
      expect(res.status).toBe(405);
      expect(await res.text()).not.toContain(who.token);
    }
  });

  it("an invalid name or month gets 405 for a non-GET as well: the method is judged first", async () => {
    expect((await fetch(url("/api/profile/x"), { method: "HEAD" })).status).toBe(405);
    expect((await fetch(url("/api/profile/x"))).status).toBe(400);
    expect((await fetch(url("/api/leaderboard?month=nope"), { method: "POST" })).status).toBe(405);
    expect((await fetch(url("/api/leaderboard?month=nope"))).status).toBe(400);
  });

  it("GET still works and is unchanged", async () => {
    const first = await api(`get${++counter}`);
    expect(first.status).toBe(200);
    expect(first.body.created).toBe(true);
    expect((await board(`?month=${APRIL}`)).status).toBe(200);
  });

  it.each([
    ["a profile claim", () => fetch(url(`/api/profile/cors${++counter}`), { headers: foreign })],
    ["a refused claim (403)", async () => {
      const who = await claim();
      return fetch(url(`/api/profile/${who.name}`), { headers: foreign });
    }],
    ["an invalid name (400)", () => fetch(url("/api/profile/x"), { headers: foreign })],
    ["a refused method (405)", () => fetch(url("/api/profile/anything"), { method: "HEAD", headers: foreign })],
    ["a leaderboard", () => fetch(url(`/api/leaderboard?month=${MARCH}`), { headers: foreign })],
    ["a leaderboard with a bad month (400)", () => fetch(url("/api/leaderboard?month=nope"), { headers: foreign })],
    ["a refused leaderboard method (405)", () => fetch(url("/api/leaderboard"), { method: "POST", headers: foreign })],
    ["/api/health", () => fetch(url("/api/health"), { headers: foreign })],
  ])("%s allows any origin and the token header", async (_label, request) => {
    const res = await request();
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-headers")).toBe(ALLOW_HEADERS);
    expect(res.headers.get("access-control-allow-credentials")).toBeNull(); // no cookies: nothing to allow
  });

  it("answers the preflight for a request that carries the token header", async () => {
    const name = `pre${++counter}`;
    const res = await fetch(url(`/api/profile/${name}`), {
      method: "OPTIONS",
      headers: { ...foreign, "access-control-request-method": "GET", "access-control-request-headers": PROFILE_TOKEN_HEADER },
    });
    expect(res.status).toBe(204);
    const allowed = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase().split(/\s*,\s*/);
    expect(allowed).toContain(PROFILE_TOKEN_HEADER);
    expect(allowed).toContain("content-type");
    expect(["*", foreign.origin]).toContain(res.headers.get("access-control-allow-origin"));
    expect(res.headers.get("access-control-allow-methods")).toMatch(/GET/);
    expect(server.store.get(name)).toBeUndefined(); // a preflight is not a claim
  });

  it("answers the preflight for the leaderboard", async () => {
    const res = await fetch(url("/api/leaderboard?month=2019-03"), {
      method: "OPTIONS",
      headers: { ...foreign, "access-control-request-method": "GET" },
    });
    expect(res.status).toBe(204);
    expect(["*", foreign.origin]).toContain(res.headers.get("access-control-allow-origin"));
    expect(res.headers.get("access-control-allow-methods")).toMatch(/GET/);
  });

  it("matchmaking preflights keep the headers the SDK needs", async () => {
    const res = await fetch(url(`/matchmake/create/${ROOM_NAME}`), {
      method: "OPTIONS",
      headers: { ...foreign, "access-control-request-method": "POST", "access-control-request-headers": "content-type, authorization" },
    });
    expect(res.status).toBe(204);
    const allowed = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    for (const h of ["content-type", "authorization", PROFILE_TOKEN_HEADER, PASSCODE_HEADER]) expect(allowed).toContain(h);
  });
});
