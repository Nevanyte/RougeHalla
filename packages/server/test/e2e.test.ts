// The whole game, end to end: the real server in this process on a free port, a temp profile file, short
// timers, and four headless bots (src/bots) that hunt each other through one complete run by sending inputs
// only. Three play it out; the fourth walks out a second into the run, which the server must settle as
// MIA (it leaves, so it may never see its result: that one is checked through the store). What is asserted is
// what must hold whoever wins: the run ended in one winner or a draw, every bot that stayed got exactly one
// sensible result, the GV ledger balances for every profile (kills pay GV_KILL, the winner gets GV_WIN unless the
// anti alt-farming rule withheld it, all of it banked once, in the profile, its lifetime total and the month), the
// stats add up, the file on disk says the same, and nothing blew up. The bots must really fight: somebody gets
// killed by a bot, and the kills the results claim match the deaths they name. The run is played twice: with a
// patience long enough for the bots to meet first, and with one so short that the arena teleports them into the
// coliseum before anyone has died, after which they must keep landing hits.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import { matchMaker, Room } from "@colyseus/core";
import {
  GV_KILL, GV_WIN, monthKey, PROFILE_TOKEN_HEADER, ROOM_NAME, SUDDEN_DEATH_KILLER, TELEPORT_IMMUNITY_MS,
  WIN_BONUS_MIN_OPPONENTS, WIN_BONUS_MIN_PLAYERS, type ProfileResponse, type RunOutcome, type RunResult, type TimedFx,
} from "@raid/shared";
import { BotClient, type BotRun } from "../src/bots/BotClient";
import { loadConfig } from "../src/config";
import { startServer, type RaidServer } from "../src/index";
import type { ProfileRecord } from "../src/persistence/ProfileStore";

const BOTS = 4;
/** Index of the bot that walks out of the run. */
const QUITTER = 0;
/** Server time into the run when it does: too early for anyone to have died, since a kill takes a few swings. */
const QUIT_AFTER_MS = 1_000;
const OUTCOMES: readonly RunOutcome[] = ["won", "draw", "died", "mia"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sum = (xs: Iterable<number>): number => { let n = 0; for (const x of xs) n += x; return n; };
/** What the store keeps and the file must repeat (the token and name are identity, not ledger). */
const ledger = (r: ProfileRecord) => ({ gv: r.gv, gvLifetime: r.gvLifetime, gvByMonth: r.gvByMonth, stats: r.stats, cosmetics: r.cosmetics });

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

async function until(pred: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await sleep(20);
  }
}

const fatal: string[] = [];
const onFatal = (err: unknown) => { fatal.push(err instanceof Error ? (err.stack ?? err.message) : String(err)); };
let errorSpy: MockInstance<typeof console.error>;

beforeAll(() => {
  errorSpy = vi.spyOn(console, "error");
  process.on("uncaughtException", onFatal);
  process.on("unhandledRejection", onFatal);
});

afterAll(() => {
  process.off("uncaughtException", onFatal);
  process.off("unhandledRejection", onFatal);
  errorSpy?.mockRestore();
});

interface Timers { patienceSeconds: number; suddenDeathSeconds: number }

interface Played { bots: BotClient[]; players: number[]; fx: TimedFx[] }

/** Plays one run on a fresh server (and fresh profiles) and checks everything that must hold, whoever wins. */
async function playRun(prefix: string, timers: Timers, expectKill = false): Promise<Played> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-e2e-"));
  const profileFile = path.join(dir, "data", "stash.json");
  const port = await freePort();
  const server: RaidServer = await startServer({
    ...loadConfig({}),
    port,
    stashFile: profileFile,
    latencyMs: 0,
    minPlayers: BOTS,
    fillSeconds: 0,
    lobbySeconds: 30, // the run starts the moment the 4th bot joins (fillSeconds 0); this only keeps a slow machine from splitting them
    ...timers,
    patienceMinSeconds: timers.patienceSeconds, // flat: the run's pace shouldn't depend on how many are still standing
  }).catch((err: unknown) => {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  });
  let stopped = false;
  // Every fx the room broadcasts, in order (the bots see the same stream): what the run did, not just how it ended.
  const fx: TimedFx[] = [];
  const realBroadcast = Room.prototype.broadcast;
  const broadcastSpy = vi.spyOn(Room.prototype, "broadcast").mockImplementation(function (this: unknown, ...args: unknown[]) {
    if (args[0] === "fx") fx.push(args[1] as TimedFx);
    return (realBroadcast as (...a: unknown[]) => void).apply(this, args);
  });
  try {
    const url = `http://127.0.0.1:${port}`;
    const names = Array.from({ length: BOTS }, (_, i) => `${prefix}${i + 1}`);
    const bots = names.map((_, i) => new BotClient({
      timeoutMs: 90_000,
      verbose: !!process.env.E2E_VERBOSE,
      ...(i === QUITTER ? { abandonAfterMs: QUIT_AFTER_MS } : {}),
    }));
    const players = names.map((_, i) => i).filter((i) => i !== QUITTER);
    const started = Date.now();

    // All four walk into the same lobby; the fourth one starts the run.
    await Promise.all(bots.map((bot, i) => bot.connect(url, names[i]!)));
    expect(new Set(bots.map((b) => b.roomId)).size).toBe(1);
    const roomId = bots[0]!.roomId;
    for (const name of names) {
      const fresh = server.store.get(name)!;
      expect(ledger(fresh), `${name} starts empty`).toEqual({
        gv: 0, gvLifetime: 0, gvByMonth: {}, stats: { runs: 0, wins: 0, draws: 0, deaths: 0, kills: 0 }, cosmetics: { owned: [], equipped: {} },
      });
    }

    const runs: BotRun[] = await Promise.all(bots.map((b) => b.run()));
    const finished = Date.now();
    const seconds = (finished - started) / 1000;

    // --- the quitter left on purpose and got no result (the server had dropped it before settling it)
    expect(runs[QUITTER]!.error, `${names[QUITTER]} failed`).toBeUndefined();
    expect(runs[QUITTER]!.abandoned, `${names[QUITTER]} never reached ${QUIT_AFTER_MS} ms into the run, so it never quit`).toBe(true);
    expect(runs[QUITTER]!.result).toBeNull();

    // --- everyone else got exactly one result, and a sensible one. `resultsSeen` only counts what arrived
    // while the bot was still in the room, so it cannot see a duplicate sent after it left; a double
    // settlement is caught by `runs: 1` in the stats below.
    const results = new Map<number, RunResult>();
    for (const i of players) {
      const run = runs[i]!;
      expect(run.error, `${names[i]} failed`).toBeUndefined();
      expect(run.abandoned).toBeUndefined();
      expect(run.profile).toBe(names[i]);
      expect(run.result, `${names[i]} got no result`).not.toBeNull();
      expect(bots[i]!.resultsSeen, `${names[i]} result count`).toBe(1);
      const r = run.result!;
      expect(OUTCOMES).toContain(r.outcome);
      expect(r.profile).toBe(names[i]);
      expect(r.players).toBe(BOTS);
      expect(r.place).toBeGreaterThanOrEqual(1);
      expect(r.place).toBeLessThanOrEqual(BOTS);
      expect(Number.isInteger(r.kills) && r.kills >= 0).toBe(true);
      expect(Number.isInteger(r.durationSec) && r.durationSec >= 0).toBe(true);
      results.set(i, r);
    }
    const all = [...results.values()];
    console.log(`[e2e] ${seconds.toFixed(1)}s ${names.map((n, i) => `${n}=${results.get(i)?.outcome ?? "quit"}`).join(" ")}`);

    // --- the run ended: one winner in first place, or a draw in which everyone tied shares first place
    const winners = all.filter((r) => r.outcome === "won");
    const draws = all.filter((r) => r.outcome === "draw");
    if (winners.length > 0) {
      expect(winners.length, "exactly one winner").toBe(1);
      expect(winners[0]!.place).toBe(1);
      expect(draws, "a winner and a draw in one run").toEqual([]);
    } else {
      expect(draws.length, "no winner and no draw: the run never resolved").toBeGreaterThanOrEqual(2);
      for (const r of draws) expect(r.place, `${r.profile} drew`).toBe(1);
    }
    for (const r of all) {
      if (r.outcome === "died") {
        expect(r.place, `${r.profile} died`).toBeGreaterThanOrEqual(2);
        expect(r.killedBy !== null && (names.includes(r.killedBy) || r.killedBy === SUDDEN_DEATH_KILLER), `${r.profile} killed by ${r.killedBy}`).toBe(true);
        expect(r.killedBy, `${r.profile} killed themselves`).not.toBe(r.profile);
        expect(r.killedBy, `${r.profile} killed by the quitter, who left too early to kill`).not.toBe(names[QUITTER]);
      } else {
        expect(r.killedBy, `${r.profile} (${r.outcome})`).toBeNull();
      }
    }

    // --- the kills: the bots really fought, and the kills the results claim are the deaths they name
    const totalKills = sum(all.map((r) => r.kills));
    const diedToABot = all.filter((r) => r.outcome === "died" && r.killedBy !== null && names.includes(r.killedBy));
    const tally = new Map<string, number>();
    for (const r of diedToABot) tally.set(r.killedBy!, (tally.get(r.killedBy!) ?? 0) + 1);
    if (expectKill) expect(totalKills, "nobody killed anybody: the bots never fought").toBeGreaterThanOrEqual(1);
    for (const r of all) {
      expect(r.kills, `${r.profile} claims fewer kills than the deaths that name it`).toBeGreaterThanOrEqual(tally.get(r.profile) ?? 0);
    }
    // Every death by a bot is one player's kill, and every kill is such a death except: a trade in the last tick
    // (the winner or both drawers were killed by the one they killed, so no `died` result names them), and a hit
    // the quitter's leave turned into a kill for somebody (it left too soon for that to be likely).
    const trades = all.filter((r) => r.outcome === "won" || r.outcome === "draw").length;
    expect(totalKills, "kills without a death behind them").toBeLessThanOrEqual(diedToABot.length + trades + 1);
    expect(totalKills).toBeGreaterThanOrEqual(diedToABot.length);
    // The broadcast agrees: a death fx with a killer is a kill (a leave credited to the last hitter has no fx, and
    // only the quitter leaves), and a `died` result for each of the deaths but the trades and the quitter's.
    const deathFx = fx.filter((f) => f.kind === "death" && f.by !== null);
    expect(deathFx.length, "death fx against deaths by a bot").toBeGreaterThanOrEqual(diedToABot.length);
    expect(deathFx.length, "death fx against results").toBeLessThanOrEqual(diedToABot.length + trades + 1);
    expect(totalKills, "kills against death fx").toBeGreaterThanOrEqual(deathFx.length);
    expect(totalKills, "kills against death fx").toBeLessThanOrEqual(deathFx.length + 1);

    // --- the win bonus. The run started with BOTS (4) players, so the player count never withholds it: the winner
    // keeps it exactly when they damaged WIN_BONUS_MIN_OPPONENTS different players, and the result says which. A shot
    // fx with a `hit` is a blow that reached the victim (teleport immunity can still absorb it), so the winner's shot
    // fx bound it from above; two kills are two different victims, which bounds it from below. Nobody but a winner
    // is ever told their bonus was withheld.
    expect(BOTS).toBeGreaterThanOrEqual(WIN_BONUS_MIN_PLAYERS);
    for (const r of all) {
      if (r.outcome !== "won") expect(r.winBonusWithheld, `${r.profile} (${r.outcome}) was told a bonus was withheld`).toBe(false);
    }
    const winner = winners.length === 1 ? winners[0]! : null;
    if (winner) {
      expect(winner.gv.win, `${winner.profile} win bonus`).toBe(winner.winBonusWithheld ? 0 : GV_WIN);
      if (winner.kills >= 2) expect(winner.winBonusWithheld, `${winner.profile} killed ${winner.kills} players`).toBe(false);
      const victory = fx.find((f) => f.kind === "victory");
      expect(victory, "no victory fx").toMatchObject({ kind: "victory", name: winner.profile, draw: false });
      const winnerSession = (victory as Extract<TimedFx, { kind: "victory" }>).id;
      const shotAt = new Set(fx.flatMap((f) => (f.kind === "shot" && f.by === winnerSession && f.hit !== null ? [f.hit] : [])));
      expect(shotAt.has(winnerSession!), "the winner shot themselves").toBe(false);
      if (!winner.winBonusWithheld) expect(shotAt.size, `${winner.profile} got the bonus without hitting enough players`).toBeGreaterThanOrEqual(WIN_BONUS_MIN_OPPONENTS);
      if (shotAt.size < WIN_BONUS_MIN_OPPONENTS) expect(winner.winBonusWithheld, `${winner.profile} hit ${shotAt.size} players`).toBe(true);
    }
    const bonusPaid = winner && !winner.winBonusWithheld ? GV_WIN : 0;

    // --- the GV each result paid
    const winBonus = sum(all.map((r) => r.gv.win));
    for (const r of all) {
      expect(r.gv.total, `${r.profile} total`).toBe(r.gv.kills + r.gv.mobs + r.gv.bounty + r.gv.win);
      expect(r.gv.kills, `${r.profile} kill GV`).toBe(GV_KILL * r.kills);
      expect(r.gv.mobs, `${r.profile} mob GV (there are no mobs yet)`).toBe(0);
      expect(r.gv.bounty).toBeGreaterThanOrEqual(0);
      if (r.gv.bounty > 0) {
        // Only a player with 3 kills carries a bounty, and the bounty is paid to whoever kills them.
        expect(Math.max(...all.filter((o) => o !== r).map((o) => o.kills))).toBeGreaterThanOrEqual(3);
      }
      expect(r.gv.win, `${r.profile} win bonus`).toBe(r.outcome === "won" && !r.winBonusWithheld ? GV_WIN : 0);
    }
    expect(sum(all.map((r) => r.gv.kills))).toBe(GV_KILL * totalKills);
    expect(winBonus, "the win bonus is paid at most once, to a winner who earned it").toBe(bonusPaid);
    expect(sum(all.map((r) => r.gv.total)), "GV_KILL × kills + bounties + the win bonus actually paid").toBe(
      GV_KILL * totalKills + sum(all.map((r) => r.gv.bounty)) + bonusPaid,
    );

    // --- the ledger in the store: every profile was fresh, so what it holds is exactly this run's payout,
    // once, in the balance, the lifetime total and the month. The quitter never saw its result, but it left
    // at 1 s, before any kill is possible: it earned nothing, and its record says so exactly.
    const months = new Set([monthKey(started), monthKey(finished)]);
    const records = names.map((n) => server.store.get(n)!);
    for (const [i, rec] of records.entries()) {
      const what = `${names[i]} (${results.get(i)?.outcome ?? "quit"})`;
      expect(rec.name).toBe(names[i]);
      expect(rec.gvLifetime, `${what} lifetime`).toBe(rec.gv);
      expect(Object.keys(rec.gvByMonth).every((m) => months.has(m)), `${what} months ${JSON.stringify(rec.gvByMonth)}`).toBe(true);
      expect(sum(Object.values(rec.gvByMonth)), `${what} month`).toBe(rec.gv);
      if (rec.gv === 0) expect(rec.gvByMonth, what).toEqual({});
      const r = results.get(i);
      if (r) expect(rec.gv, `${what} banked`).toBe(r.gv.total);
      else {
        expect(rec.gv, `${what} banked`).toBe(0);
        expect(rec.stats.kills, `${what} kills`).toBe(0);
      }
    }

    // --- stats follow the outcomes
    for (const [i, rec] of records.entries()) {
      const r = results.get(i);
      expect(rec.stats, names[i]).toEqual({
        runs: 1,
        wins: r?.outcome === "won" ? 1 : 0,
        draws: r?.outcome === "draw" ? 1 : 0,
        deaths: !r || r.outcome === "died" || r.outcome === "mia" ? 1 : 0,
        kills: r ? r.kills : 0,
      });
    }
    expect(sum(records.map((rec) => rec.stats.wins))).toBe(winners.length === 1 ? 1 : 0);
    expect(sum(records.map((rec) => rec.stats.draws))).toBe(draws.length);
    expect(sum(records.map((rec) => rec.stats.deaths))).toBe(1 + all.filter((r) => r.outcome === "died" || r.outcome === "mia").length);
    expect(sum(records.map((rec) => rec.gv)), "everything banked is what the results paid").toBe(sum(all.map((r) => r.gv.total)));

    // --- what a player sees over HTTP is the same ledger
    for (const [i, bot] of bots.entries()) {
      const res = await fetch(`${url}/api/profile/${names[i]}`, { headers: { [PROFILE_TOKEN_HEADER]: bot.token } });
      expect(res.status).toBe(200);
      const { profile, created } = (await res.json()) as ProfileResponse;
      expect(created).toBe(false);
      expect(profile).toMatchObject({ name: names[i], gv: records[i]!.gv, gvLifetime: records[i]!.gvLifetime, stats: records[i]!.stats });
      expect(profile.gvByMonth).toEqual(records[i]!.gvByMonth);
    }

    // --- the file on disk says the same
    await server.store.flush();
    const onDisk = JSON.parse(fs.readFileSync(profileFile, "utf8")) as { version: number; profiles: Record<string, ProfileRecord> };
    expect(onDisk.version).toBe(2);
    expect(Object.keys(onDisk.profiles).sort()).toEqual([...names].sort());
    for (const [i, name] of names.entries()) expect(ledger(onDisk.profiles[name]!), name).toEqual(ledger(records[i]!));

    // --- the run is over: the room is gone and nobody is still marked as in a run
    await until(() => matchMaker.getLocalRoomById(roomId) === undefined, "the room to be disposed");
    expect((await matchMaker.query({ name: ROOM_NAME })).length).toBe(0);
    await until(() => server.profiles.size === 0, "every profile to be free again");

    // --- and it was quiet
    await server.stop();
    stopped = true;
    expect(fatal).toEqual([]);
    expect(errorSpy.mock.calls).toEqual([]);
    return { bots, players, fx };
  } finally {
    broadcastSpy.mockRestore();
    try {
      if (!stopped) await server.stop();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

describe("headless bots hunt through a full run", () => {
  it("ends in one winner (or a draw) and banks exactly the GV it paid", async () => {
    // Patience 8 s then 3 s locked: even bots that never meet are teleported together and burnt down by sudden
    // death (about 10 s of ramp from full hp), so the run ends within roughly 40 s whatever they do.
    // With the bots really fighting this ends in kills, whoever wins (expectKill): a run decided by sudden death alone
    // would mean they never landed a hit.
    await playRun("e2ebot", { patienceSeconds: 8, suddenDeathSeconds: 3 }, true);
  }, 120_000);

  it("teleports everyone into the coliseum and the bots keep hunting there", async () => {
    // A patience this short expires before anyone can have died, so the arena always fires.
    const { bots, players, fx } = await playRun("tpbot", { patienceSeconds: 1, suddenDeathSeconds: 2 });
    for (const i of players) expect(bots[i]!.teleports, `bot ${i} teleports`).toBeGreaterThanOrEqual(1);

    // And they fight there: shots that hit somebody after the teleport's immunity is over, so they can do damage.
    const teleport = fx.find((f) => f.kind === "teleport");
    expect(teleport, "no teleport fx was broadcast").toBeDefined();
    const live = teleport!.t + TELEPORT_IMMUNITY_MS;
    const hits = fx.filter((f) => f.kind === "shot" && f.hit !== null && f.t >= live);
    expect(hits.length, "the bots never hit each other after the teleport").toBeGreaterThanOrEqual(1);
  }, 120_000);
});
