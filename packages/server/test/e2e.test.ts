// The whole game, end to end: the real server in this process on a free port, a temp profile file, short
// timers, regional mobs on (the server's default), and four headless bots (src/bots) that farm the mobs and hunt each
// other through one complete run by sending inputs only: they walk, aim, draw and loose their bows, swing, swap weapons
// and pick up a second one (a mob's drop too). Three play it out; the fourth walks out a second into the run, which the
// server must settle as MIA (it leaves, so it may never see its result: that one is checked through the store). What is
// asserted is what must hold whoever wins: the run ended in one winner or a draw, every bot that stayed got exactly one
// sensible result, the GV ledger balances for every profile (kills pay GV_KILL, mobs pay what the sim paid under the
// per-run cap, the winner gets GV_WIN unless the anti alt-farming rule withheld it, all of it banked once, in the
// profile, its lifetime total and the month), the stats add up, the file on disk says the same, no bot stood stuck, and
// nothing blew up. The bots must really fight: somebody gets killed by a bot, and the kills the results claim match
// the deaths they name; and in the long-patience run somebody kills a mob (the death fx and the GV agree). A player can
// also die to a mob (killedBy is then the mob's name), and the fx that name a mob are not players' hits or deaths. The
// run is played twice: with a patience long enough for the bots to farm mobs and meet, and with one so short that the
// arena teleports them into the coliseum before anyone has died, after which they must keep landing hits.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import { matchMaker, Room } from "@colyseus/core";
import {
  GV_ELITE, GV_KILL, GV_MOB_CAP, GV_WIN, mobName, monthKey, PROFILE_TOKEN_HEADER, REGION_FACTIONS, ROOM_NAME, SUDDEN_DEATH_KILLER,
  TELEPORT_IMMUNITY_MS, unpackFx, WIN_BONUS_MIN_OPPONENTS, WIN_BONUS_MIN_PLAYERS, type FxBatch, type ProfileResponse, type RunOutcome,
  type RunResult, type TimedFx,
} from "@raid/shared";
import { BotClient, type BotRun } from "../src/bots/BotClient";
import { loadConfig } from "../src/config";
import { startServer, type RaidServer } from "../src/index";
import type { ProfileRecord } from "../src/persistence/ProfileStore";

const BOTS = 4;
/**
 * Index of the bot that walks out of the run. The bots join one after another, and the server hands out factions round-robin
 * in join order (fire, sentenced, plague, frost), so this is the Sentenced one, whose damage is mostly a mark that does not
 * exist yet: the three who stay are the ones who can actually kill each other. The test asserts nothing about factions.
 */
const QUITTER = 1;
/** Server time into the run when it does: too early for anyone to have died, since a kill takes several hits. */
const QUIT_AFTER_MS = 1_000;
const OUTCOMES: readonly RunOutcome[] = ["won", "draw", "died", "mia"];
/** What `killedBy` says when a mob dealt the killing blow: the mob's name, from the shared catalog. */
const MOB_NAMES: ReadonlySet<string> = new Set(REGION_FACTIONS.flatMap((r) => [mobName(r, false), mobName(r, true)]));
/** No bot may stand still without attacking, drawing or fetching a weapon for longer than this (ms): it would be stuck on a target it cannot reach. */
const MAX_STALL_MS = 8_000;
const MOB_RUN_ATTEMPTS = 4;
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

interface Played { bots: BotClient[]; players: number[]; fx: TimedFx[]; sessions: ReadonlySet<string>; mobKills: number }

/** Plays one run on a fresh server (and fresh profiles) and checks everything that must hold, whoever wins. */
async function playRun(prefix: string, timers: Timers, expectMobKill = false): Promise<Played> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-e2e-"));
  const profileFile = path.join(dir, "data", "stash.json");
  const port = await freePort();
  const server: RaidServer = await startServer({
    ...loadConfig({}),
    mobs: true, // the default; spelled out because this run is about them
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
    if (args[0] === "fxs") fx.push(...unpackFx(args[1] as FxBatch));
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

    // All four walk into the same lobby, one after another; the fourth one starts the run.
    for (const [i, bot] of bots.entries()) await bot.connect(url, names[i]!);
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

    // --- the fx that name a player on both ends: a mob's hit or death shares the stream (its id is a mob's, not a session's)
    const sessions = new Set(bots.map((b) => b.sessionId));
    const isPlayer = (id: string | null | undefined): boolean => id != null && sessions.has(id);
    const mobDeathBy = (id: string): number => fx.filter((f) => f.kind === "death" && !sessions.has(f.id) && f.by === id).length;

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
    const sent = (type: keyof BotClient["sent"]) => sum(bots.map((b) => b.sent[type]));
    const mobKills = sum(bots.map((b) => mobDeathBy(b.sessionId)));
    console.log(
      `[e2e] seed ${bots[0]!.seed} ${seconds.toFixed(1)}s ${names.map((n, i) => `${n}=${results.get(i)?.outcome ?? "quit"}`).join(" ")}`
      + ` (sent ${sent("attack")} attacks, ${sent("release")} releases, ${sent("swap")} swaps, ${sent("pickup")} pickups;`
      + ` ${mobKills} mobs killed: ${bots.map((b) => mobDeathBy(b.sessionId)).join("/")})`,
    );

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
        expect(
          r.killedBy !== null && (names.includes(r.killedBy) || r.killedBy === SUDDEN_DEATH_KILLER || MOB_NAMES.has(r.killedBy)),
          `${r.profile} killed by ${r.killedBy}`,
        ).toBe(true);
        expect(r.killedBy, `${r.profile} killed themselves`).not.toBe(r.profile);
        expect(r.killedBy, `${r.profile} killed by the quitter, who left too early to kill`).not.toBe(names[QUITTER]);
      } else {
        expect(r.killedBy, `${r.profile} (${r.outcome})`).toBeNull();
      }
    }

    // --- the bots fought with their weapons: every one that stayed pulled the trigger, and some hit another
    for (const i of players) expect(bots[i]!.sent.attack, `${names[i]} never attacked`).toBeGreaterThanOrEqual(1);
    // ...and none stood stuck: the longest time a bot stood still, alive in the running raid, doing nothing (no attack, no draw, no
    // weapon fetch) stays short, whatever it was chasing.
    for (const i of players) expect(bots[i]!.stats.maxStallMs, `${names[i]} stood still for ${bots[i]!.stats.maxStallMs} ms`).toBeLessThan(MAX_STALL_MS);
    expect(fx.some((f) => f.kind === "hit" && isPlayer(f.by)), "no bot ever hit anything").toBe(true);

    // --- the kills: the bots really fought, and the kills the results claim are the deaths they name
    const totalKills = sum(all.map((r) => r.kills));
    const diedToABot = all.filter((r) => r.outcome === "died" && r.killedBy !== null && names.includes(r.killedBy));
    const tally = new Map<string, number>();
    for (const r of diedToABot) tally.set(r.killedBy!, (tally.get(r.killedBy!) ?? 0) + 1);
    // A projectile outlives its shooter: one that kills after its shooter's own run is over names the shooter but is
    // nobody's kill, and its death fx has no killer id. Those are the death fx without a killer that sudden death
    // doesn't account for; usually there are none.
    const posthumous = fx.filter((f) => f.kind === "death" && isPlayer(f.id) && f.by === null).length
      - all.filter((r) => r.killedBy === SUDDEN_DEATH_KILLER).length;
    expect(posthumous, "deaths without a killer id against sudden-death results").toBeGreaterThanOrEqual(0);
    for (const r of all) {
      const short = (tally.get(r.profile) ?? 0) - r.kills;
      expect(short, `${r.profile} claims fewer kills than the deaths that name it`).toBeLessThanOrEqual(r.outcome === "died" ? posthumous : 0);
    }
    // Every death by a bot is one player's kill, and every kill is such a death except: a trade in the last tick
    // (the winner or both drawers were killed by the one they killed, so no `died` result names them), and a hit
    // the quitter's leave turned into a kill for somebody (it left too soon for that to be likely).
    const trades = all.filter((r) => r.outcome === "won" || r.outcome === "draw").length;
    expect(totalKills, "kills without a death behind them").toBeLessThanOrEqual(diedToABot.length + trades + 1);
    expect(totalKills).toBeGreaterThanOrEqual(diedToABot.length - posthumous);
    // The broadcast agrees: a death fx with a killer is a kill (a leave credited to the last hitter has no fx, and
    // only the quitter leaves), and a `died` result for each of the deaths but the trades and the quitter's.
    const deathFx = fx.filter((f) => f.kind === "death" && isPlayer(f.id) && isPlayer(f.by));
    expect(deathFx.length, "death fx against deaths by a bot").toBeGreaterThanOrEqual(diedToABot.length - posthumous);
    expect(deathFx.length, "death fx against results").toBeLessThanOrEqual(diedToABot.length + trades + 1);
    expect(totalKills, "kills against death fx").toBeGreaterThanOrEqual(deathFx.length);
    expect(totalKills, "kills against death fx").toBeLessThanOrEqual(deathFx.length + 1);

    // --- the win bonus. The run started with BOTS (4) players, so the player count never withholds it: the winner
    // keeps it exactly when they damaged WIN_BONUS_MIN_OPPONENTS different players, and the result says which. A `hit`
    // fx is damage that reached the victim (teleport immunity absorbs a blow without one), so the players the winner's
    // hits name are the ones it damaged; two kills are two different victims too. Nobody but a winner is ever told
    // their bonus was withheld.
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
      const hitBy = new Set(fx.flatMap((f) => (f.kind === "hit" && f.by === winnerSession && isPlayer(f.id) ? [f.id] : [])));
      expect(hitBy.has(winnerSession!), "the winner hit themselves").toBe(false);
      if (!winner.winBonusWithheld) expect(hitBy.size, `${winner.profile} got the bonus without hitting enough players`).toBeGreaterThanOrEqual(WIN_BONUS_MIN_OPPONENTS);
      if (hitBy.size < WIN_BONUS_MIN_OPPONENTS) expect(winner.winBonusWithheld, `${winner.profile} hit ${hitBy.size} players`).toBe(true);
    }
    const bonusPaid = winner && !winner.winBonusWithheld ? GV_WIN : 0;

    // --- the GV each result paid
    const winBonus = sum(all.map((r) => r.gv.win));
    for (const r of all) {
      expect(r.gv.total, `${r.profile} total`).toBe(r.gv.kills + r.gv.mobs + r.gv.bounty + r.gv.win);
      expect(r.gv.kills, `${r.profile} kill GV`).toBe(GV_KILL * r.kills);
      // Mob GV is what the sim paid per mob killed (1 to 2 for a normal one, 3 to 10 for an elite, scaled by the reward curve),
      // under the per-run cap: the death fx name the killer, so a bot with mob GV killed at least one and a bot that killed
      // some was paid at least a GV each (up to the cap) and no more than an elite's worth each.
      const killed = mobDeathBy(bots[names.indexOf(r.profile)]!.sessionId);
      expect(r.gv.mobs, `${r.profile} mob GV`).toBeLessThanOrEqual(GV_MOB_CAP);
      expect(r.gv.mobs, `${r.profile} mob GV against the ${killed} mobs it killed`).toBeLessThanOrEqual(GV_ELITE * killed);
      expect(r.gv.mobs, `${r.profile} mob GV against the ${killed} mobs it killed`).toBeGreaterThanOrEqual(Math.min(GV_MOB_CAP, killed));
      expect(r.gv.bounty).toBeGreaterThanOrEqual(0);
      if (r.gv.bounty > 0) {
        // Only a player with 3 kills carries a bounty, and the bounty is paid to whoever kills them.
        expect(Math.max(...all.filter((o) => o !== r).map((o) => o.kills))).toBeGreaterThanOrEqual(3);
      }
      expect(r.gv.win, `${r.profile} win bonus`).toBe(r.outcome === "won" && !r.winBonusWithheld ? GV_WIN : 0);
    }
    expect(sum(all.map((r) => r.gv.kills))).toBe(GV_KILL * totalKills);
    expect(winBonus, "the win bonus is paid at most once, to a winner who earned it").toBe(bonusPaid);
    expect(sum(all.map((r) => r.gv.total)), "GV_KILL × kills + mobs + bounties + the win bonus actually paid").toBe(
      GV_KILL * totalKills + sum(all.map((r) => r.gv.mobs)) + sum(all.map((r) => r.gv.bounty)) + bonusPaid,
    );
    // The mobs: a bot killed one in the run that had the time for it, and no mob GV exists without a kill behind it.
    if (expectMobKill) {
      expect(mobKills, "no bot killed a mob: the bots never farmed").toBeGreaterThanOrEqual(1);
      expect(sum(all.map((r) => r.gv.mobs)), "mobs were killed but none paid GV").toBeGreaterThanOrEqual(1);
    }
    if (mobKills === 0) expect(sum(all.map((r) => r.gv.mobs)), "mob GV without a mob kill").toBe(0);

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
    return { bots, players, fx, sessions, mobKills };
  } finally {
    broadcastSpy.mockRestore();
    try {
      if (!stopped) await server.stop();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

/**
 * Plays whole runs until one has a mob killed by a bot, at most MOB_RUN_ATTEMPTS. Every run checks all of playRun's books, so a
 * run without a mob kill is still a good run; what it lacks is the evidence that the bots can farm. That is a property of the
 * bots against a random map (the room draws its seed itself): the spawns can put two bots close enough to fight before either
 * reached a camp (about one run in twelve measured), and it is asserted on the last attempt, not hoped for.
 */
async function playUntilMobKill(prefix: string, timers: Timers): Promise<Played> {
  for (let attempt = 1; ; attempt++) {
    const played = await playRun(`${prefix}${attempt}-`, timers, attempt === MOB_RUN_ATTEMPTS);
    if (played.mobKills > 0) return played;
    console.log(`[e2e] attempt ${attempt}: no bot killed a mob, playing again`);
  }
}

describe("headless bots hunt through a full run", () => {
  it("ends in one winner (or a draw) and banks exactly the GV it paid", async () => {
    // Patience 30 s, then 10 s locked in the coliseum before sudden death starts. The first 30 s are what the bots farm mobs
    // in (the walk to a camp is 4-6 s and a kill takes 5-15 s): a bot kills a mob in most runs (playUntilMobKill). Even bots
    // that never meet are then teleported together (the mobs go home) and burnt down by sudden death (about 10 s of ramp from
    // full hp), so a death is never more than about 25 s after that and a run ends within roughly 60-80 s whatever the bots do.
    // Who dies of what is not fixed: a player kill, a mob or sudden death can each take a bot, which is why the test asserts
    // the books and not a body count.
    await playUntilMobKill("e2ebot", { patienceSeconds: 30, suddenDeathSeconds: 10 });
  }, 450_000);

  it("teleports everyone into the coliseum and the bots keep hunting there", async () => {
    // A patience this short expires before anyone can have died, so the arena always fires.
    const { bots, players, fx, sessions } = await playRun("tpbot", { patienceSeconds: 1, suddenDeathSeconds: 2 });
    for (const i of players) expect(bots[i]!.teleports, `bot ${i} teleports`).toBeGreaterThanOrEqual(1);

    // And they fight there: shots that hit somebody after the teleport's immunity is over, so they can do damage.
    const teleport = fx.find((f) => f.kind === "teleport");
    expect(teleport, "no teleport fx was broadcast").toBeDefined();
    const live = teleport!.t + TELEPORT_IMMUNITY_MS;
    const hits = fx.filter((f) => f.kind === "hit" && sessions.has(f.by ?? "") && sessions.has(f.id) && f.t >= live);
    expect(hits.length, "the bots never hit each other after the teleport").toBeGreaterThanOrEqual(1);
  }, 120_000);
});
