// The whole game, end to end: the real server in this process on a free port, a temp profile file, short
// timers, regional mobs on (the server's default), and four headless bots (src/bots) that farm the mobs and hunt each
// other through one complete run by sending inputs only: they walk, lock their foes (the server chases them and attacks:
// the LoL-style controls), swap weapons and pick up a second one (a mob's drop too). Each asks for its faction at join, as the hub's picker does, and the server
// must have given it that one. Three play it out; the fourth walks out a second into the run, which the server must settle
// as MIA (it leaves, so it may never see its result: that one is checked through the store). What is asserted is what must
// hold whoever wins: the run ended in one winner or a draw, every bot that stayed got exactly one sensible result, the GV
// ledger balances for every profile (kills pay GV_KILL, mobs and quests pay what the sim paid under their per-run caps,
// the winner gets GV_WIN unless the anti alt-farming rule withheld it, all banked once, in the profile, its lifetime and the
// month), the stats add up, the file on disk says the same, no bot stood stuck, and nothing blew up. The bots must really
// fight: somebody gets killed by a bot, and the kills the results claim match the deaths they name; the faction signatures
// fire (damage over time and Fire's backlash are broadcast as `hit` fx with a `sig`, each dealt by a fighter of the faction
// that owns it, a player or a mob); and in the long-patience run somebody kills a mob (the death fx and the GV agree). A
// player can also die to a mob (killedBy is then the mob's name), and the fx that name a mob are not players' hits or
// deaths. The bots cast their faction's Wish (the lock is 5 s here): its fx name players and the faction's own ability, none comes
// before the lock is over, each bot casts it once (again only after the arena's teleport refunded a cast), and in the long run
// some bot's Wish lands. Elite mob kills create reward chests for CHEST_SECONDS; when an elite chest is within reach the bots walk
// to it and take a card (or skip), and no
// player picks twice at one chest. Every bot decodes every `fxs` batch it receives
// against its own copy of the roster (what a real client has), and none of them loses a tuple. Every run is planned first (the live
// server's planning phase): each bot is dealt its two spawns in a private `plan` message, reads them, takes one and presses ready (the
// brain's planning module), so the server hands out the spawns it left over. The run is played twice: with a patience long enough for the bots to farm mobs and meet, and with one so short
// that the arena teleports them into the coliseum before anyone has died, after which they must keep landing hits.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import { matchMaker, Room } from "@colyseus/core";
import {
  CATCHUP_MULT, CHEST_RANGE, GV_ELITE, GV_KILL, GV_MOB_CAP, GV_WIN, MOB_TYPES, mobName, monthKey, PROFILE_TOKEN_HEADER, REGION_FACTIONS, rewardCurve, ROOM_NAME,
  SUDDEN_DEATH_KILLER, TELEPORT_IMMUNITY_MS, unpackFx, WIN_BONUS_MIN_OPPONENTS, WIN_BONUS_MIN_PLAYERS, WISHES,
  type FactionId, type FxBatch, type ProfileResponse, type RunOutcome, type RunResult, type SignatureKind, type TimedFx,
} from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { BotClient, type BotRun } from "../src/bots/BotClient";
import type { PersonaId } from "../src/bots/brain/types";
import { loadConfig } from "../src/config";
import { startServer, type RaidServer } from "../src/index";
import type { ProfileRecord } from "../src/persistence/ProfileStore";

const BOTS = 4;
/** Index of the bot that walks out of the run. Every faction can kill now, so any lineup leaves three who can fight it out. */
const QUITTER = 1;
/**
 * The faction each bot asks for at join, by index, so the run never depends on the server's round-robin default. The
 * first lineup keeps Fire, Plague and Sentenced in the fight (the quitter is Holy): their signatures all come out as
 * `hit` fx with a `sig` (burn and backlash, disease, mark), which is what the run is checked for. The second keeps
 * Frost, Fire and Holy in the fight (the quitter is Sentenced), so the chill and Holy's lifesteal can run on a real
 * server too. Nothing asserts them: who fights whom, and for how long, varies from run to run.
 */
const SIGNATURE_LINEUP: readonly FactionId[] = ["fire", "holy", "plague", "sentenced"];
const CONTROL_LINEUP: readonly FactionId[] = ["frost", "sentenced", "fire", "holy"];
/**
 * The brain each bot plays with: Hard (the quickest hands) and a hunter, a farmer, a hunter and an opportunist, so that kills and
 * mob kills keep their odds (BOTS.md 9.2). The quitter (index 1) leaves a second in, so its persona is the one that does not
 * matter, and the farmer, who is what the mob kills lean on, takes a seat that stays.
 */
const BOT_TIER = "hard";
const BOT_PERSONAS: readonly PersonaId[] = ["hunter", "hunter", "farmer", "opportunist"];
/** Which faction a signature belongs to: its `hit` fx are always dealt by that faction's players. */
const SIGNATURE_OWNER: Readonly<Record<SignatureKind, FactionId>> = { burn: "fire", backlash: "fire", disease: "plague", mark: "sentenced" };
/** How long every Wish stays locked after the run starts here (the server's default is 45 s: too long for a run of this length). */
const WISH_LOCK_SECONDS = 5;
/** Server time into the run when it does: too early for anyone to have died, since a kill takes several hits. */
const QUIT_AFTER_MS = 1_000;
const OUTCOMES: readonly RunOutcome[] = ["won", "draw", "died", "mia"];
/** What `killedBy` says when a mob dealt the killing blow: the mob's name, from the shared catalog. */
const MOB_NAMES: ReadonlySet<string> = new Set([
  ...MOB_TYPES.map((t) => t.name),
  ...REGION_FACTIONS.flatMap((r) => [mobName(r, false), mobName(r, true)]),
]);
/** No bot may stand still without attacking, drawing or fetching a weapon for longer than this (ms): it would be stuck on a target it cannot reach. */
const MAX_STALL_MS = 8_000;
/**
 * Whole runs played, at most, to see what the bots only do in most runs (see playUntil). A run that needed a third would be
 * a failure however it ended, so the second is the last: it asserts the evidence.
 */
const RUN_ATTEMPTS = 2;
/** The most a mob can pay for one kill: an elite's GV, at the reward curve's best (a feed of 0) with the catch-up bonus. */
const MOB_GV_MAX = Math.round(GV_ELITE * rewardCurve(0) * CATCHUP_MULT);
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

/**
 * What a run must also show beyond the books (which are always checked): a kill by a bot, a signature hit by a bot, a mob killed
 * by a bot, a Wish cast by a bot that took effect (a `castLand`), and a chest option taken by a bot (asked only of a run in which
 * some camp was cleared: a clear is the bots' to make or not, and nothing is owed to a camp nobody emptied).
 */
interface Wanted { expectKill?: boolean; expectSignature?: boolean; expectMobKill?: boolean; expectWish?: boolean; expectChest?: boolean }

/** What one client's `fxs` messages came to when read the way the client reads them. */
interface Decoding { batches: number; tuples: number; decoded: number; dropped: Array<{ t: number; tuple: unknown; unresolved: boolean }> }

/**
 * Has `bot`'s own room (the SDK client, with the roster it built from its state and patches) decode every `fxs` batch it
 * receives. The broadcast spy below reads them against the server's roster, which cannot tell whether a client has the entry
 * an index names by the time the batch arrives; this can.
 */
function watchDecoding(bot: BotClient): Decoding {
  const seen: Decoding = { batches: 0, tuples: 0, decoded: 0, dropped: [] };
  const room = bot["room"];
  room.onMessage("fxs", (batch: FxBatch) => {
    seen.batches++;
    seen.tuples += batch.l.length;
    seen.decoded += unpackFx(batch, room.state.roster, (tuple, unresolved) => seen.dropped.push({ t: batch.t, tuple, unresolved })).length;
  });
  return seen;
}

interface Played {
  bots: BotClient[]; players: number[]; fx: TimedFx[]; sessions: ReadonlySet<string>;
  /** What the run showed, for playUntil: kills by the bots, signature hits dealt by them, mobs they killed, Wishes that landed. */
  kills: number; signatureHits: number; mobKills: number; wishLands: number;
  /** Elite reward chests that dropped with a bot already within pick range, and the card options (skips not counted) bots took. */
  chestOpportunities: number; chestPicks: number;
}

/** Plays one run on a fresh server (and fresh profiles) and checks everything that must hold, whoever wins. */
async function playRun(
  prefix: string, lineup: readonly FactionId[], timers: Timers, want: Wanted = {},
): Promise<Played> {
  const { expectKill = false, expectSignature = false, expectMobKill = false, expectWish = false, expectChest = false } = want;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-e2e-"));
  const profileFile = path.join(dir, "data", "stash.json");
  const port = await freePort();
  const server: RaidServer = await startServer({
    ...loadConfig({ BOTS_FILL_TO: "0" }),
    mobs: true, // the default; spelled out because this run is about them
    port,
    stashFile: profileFile,
    latencyMs: 0,
    minPlayers: BOTS,
    fillSeconds: 0,
    lobbySeconds: 30, // the run starts the moment the 4th bot joins (fillSeconds 0); this only keeps a slow machine from splitting them
    // The live server's planning phase (PLAN_SECONDS from loadConfig): the bots take a dealt spawn and press ready, so it
    // ends as soon as all four have. The first patience timer scales like the others, so `timers` sets the run's pace.
    firstPatienceSeconds: 0,
    ...timers,
    wishLockSeconds: WISH_LOCK_SECONDS,
    patienceMinSeconds: timers.patienceSeconds, // flat: the run's pace shouldn't depend on how many are still standing
  }).catch((err: unknown) => {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  });
  let stopped = false;
  // Every fx the room broadcasts, in order (the bots see the same stream): what the run did, not just how it ended.
  const fx: TimedFx[] = [];
  // The faction of each mob that dealt a signature hit, read the moment the hit went out (the mob may be gone by the end of the run).
  const mobFactionOf = new Map<string, string>();
  // Reward containers are created by elite deaths. Keep only drops that a living bot could pick immediately.
  const chestOpportunities = new Set<string>();
  // When the run started (server ms), read from the room's state at the first batch of fx: the Wish lock counts from it.
  let raidStartedAt = 0;
  const realBroadcast = Room.prototype.broadcast;
  const broadcastSpy = vi.spyOn(Room.prototype, "broadcast").mockImplementation(function (this: unknown, ...args: unknown[]) {
    if (args[0] === "fxs") {
      const batch = unpackFx(args[1] as FxBatch, (this as Room<{ state: RaidState }>).state.roster);
      fx.push(...batch);
      const mobs = (this as Room<{ state: RaidState }>).state?.mobs;
      const state = (this as Room<{ state: RaidState }>).state;
      if (raidStartedAt === 0) raidStartedAt = (this as Room<{ state: RaidState }>).state?.raidStartedAt ?? 0;
      if (state) for (const box of state.containers.values()) {
        if (box.kind !== "reward" || box.camp <= 0 || chestOpportunities.has(box.id)) continue;
        const inRange = [...state.players.values()].some((p) => p.hp > 0 && Math.hypot(p.x - box.x, p.y - box.y) <= CHEST_RANGE);
        if (inRange) chestOpportunities.add(box.id);
      }
      for (const f of batch) {
        if (f.kind !== "hit" || f.sig === undefined || f.by === null || mobFactionOf.has(f.by)) continue;
        const m = mobs?.get(f.by);
        if (m) mobFactionOf.set(f.by, m.faction);
      }
    }
    return (realBroadcast as (...a: unknown[]) => void).apply(this, args);
  });
  try {
    const url = `http://127.0.0.1:${port}`;
    const names = Array.from({ length: BOTS }, (_, i) => `${prefix}${i + 1}`);
    const bots = names.map((_, i) => new BotClient({
      // A death restarts the flat 30 s patience timer, so a long run with three survivors can pass a minute and a half (1 in 22 runs
      // after the merge, with planning's few seconds on top); the test's own limit (450 s for two attempts) still bounds it.
      timeoutMs: 150_000,
      verbose: !!process.env.E2E_VERBOSE,
      faction: lineup[i],
      tier: BOT_TIER,
      persona: BOT_PERSONAS[i],
      ...(i === QUITTER ? { abandonAfterMs: QUIT_AFTER_MS } : {}),
    }));
    const players = names.map((_, i) => i).filter((i) => i !== QUITTER);
    const started = Date.now();

    // All four walk into the same lobby, one after another; the fourth one starts the run.
    const decodings: Decoding[] = [];
    for (const [i, bot] of bots.entries()) {
      await bot.connect(url, names[i]!);
      decodings.push(watchDecoding(bot));
    }
    expect(new Set(bots.map((b) => b.roomId)).size).toBe(1);
    const roomId = bots[0]!.roomId;

    // The server's own player for each bot has the faction it asked for and an empty hand (it fights on fists). Read
    // before the first await, so even the quitter (which leaves a second into the run) is still in the state.
    const serverRoom = matchMaker.getLocalRoomById(roomId) as Room<{ state: RaidState }> | undefined;
    expect(serverRoom, "the room the bots joined").toBeDefined();
    const factionOfSession = new Map<string, FactionId>();
    for (const [i, name] of names.entries()) {
      const entry = [...serverRoom!.state.players].find(([, p]) => p.name === name);
      expect(entry, `${name} has a player in the room`).toBeDefined();
      const [id, p] = entry!;
      expect(p.faction, `${name} asked for ${lineup[i]}`).toBe(lineup[i]);
      expect([p.weapon0, p.weapon1, p.slot], `${name} (${p.faction}) starts on fists: both slots empty`).toEqual(["", "", 0]);
      factionOfSession.set(id, p.faction as FactionId);
    }
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

    // --- no client lost a thing: every tuple of every batch named only fighters its roster has, and read
    for (const [i, d] of decodings.entries()) {
      expect(d.dropped, `${names[i]} could not read some fx`).toEqual([]);
      expect(d.decoded, `${names[i]} decoded ${d.decoded} of ${d.tuples} fx tuples`).toBe(d.tuples);
      if (i !== QUITTER) {
        expect(d.batches, `${names[i]} never received a batch`).toBeGreaterThan(0);
        expect(d.tuples, `${names[i]} never received an fx`).toBeGreaterThan(0);
      }
    }

    // --- the run was planned: every bot, the quitter too, was dealt its two spawns in a private `plan` message and pressed ready
    expect(loadConfig({}).planSeconds, "the live config plans").toBeGreaterThan(0);
    for (const [i, bot] of bots.entries()) {
      expect(bot.plansSeen, `${names[i]} was never dealt a plan`).toBeGreaterThanOrEqual(1);
      expect(bot.sent.plan, `${names[i]} never answered its plan`).toBeGreaterThanOrEqual(1);
    }

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
      `[e2e] seed ${bots[0]!.seed} ${seconds.toFixed(1)}s ${names.map((n, i) => `${n}(${lineup[i]})=${results.get(i)?.outcome ?? "quit"}${results.get(i)?.killedBy ? ` by ${results.get(i)!.killedBy}` : ""}`).join(" ")}`
      + ` (sent ${sent("target")} targets, ${sent("move")} moves, ${sent("swap")} swaps, ${sent("pickup")} pickups, ${sent("plan")} plans, ${sent("choose")} chooses;`
      + ` ${mobKills} mobs killed: ${bots.map((b) => mobDeathBy(b.sessionId)).join("/")}; longest stall ${Math.max(...players.map((i) => bots[i]!.stats.maxStallMs)) | 0} ms)`,
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

    // --- the bots fought with their weapons: every one that stayed locked on a foe (it never sends the trigger itself), and some hit another
    for (const i of players) expect(bots[i]!.sent.target, `${names[i]} never locked a foe`).toBeGreaterThanOrEqual(1);
    for (const i of players) {
      const { aim, attack, release } = bots[i]!.sent;
      expect(aim + attack + release, `${names[i]} streamed aim or the trigger`).toBe(0);
    }
    // ...and none stood stuck: the longest time a bot stood still, alive in the running raid, doing nothing (no attack, no
    // weapon fetch) stays short, whatever it was chasing.
    for (const i of players) expect(bots[i]!.stats.maxStallMs, `${names[i]} stood still for ${bots[i]!.stats.maxStallMs} ms`).toBeLessThan(MAX_STALL_MS);
    expect(fx.some((f) => f.kind === "hit" && isPlayer(f.by)), "no bot ever hit anything").toBe(true);

    // --- the chests: an elite death can drop a shared chest, the bots take a card (or skip), once each. A chest is the
    // server's: one `chestTaken` per picker per chest, an option index the chest has, and no more picks than bots. What is asked of the
    // bots is that nobody picks twice, that no bot sends more `choose` than it has picks (a card lost to a faster hand is asked for
    // again, so a few more are fine) and that, when an elite chest appeared within reach, one of them took a card; never a count.
    const chestFx = fx.flatMap((f) => (f.kind === "chestTaken" ? [f] : []));
    expect(new Set(chestFx.map((f) => `${f.chest}/${f.by}`)).size, "a player picked twice at one chest").toBe(chestFx.length);
    for (const f of chestFx) {
      expect(isPlayer(f.by), `chestTaken by ${f.by}, who is no bot`).toBe(true);
      expect(f.option, `chestTaken option ${f.option}`).toBeGreaterThanOrEqual(-1);
    }
    const botChestPicks = chestFx.filter((f) => f.option >= 0).length;
    for (const [i, bot] of bots.entries()) {
      const mine = chestFx.filter((f) => f.by === bot.sessionId).length;
      expect(bot.sent.choose, `${names[i]} sent fewer choose messages than it had picks`).toBeGreaterThanOrEqual(mine);
      expect(bot.sent.choose, `${names[i]} sent ${bot.sent.choose} choose messages for ${mine} picks`).toBeLessThanOrEqual(mine + 4);
    }
    console.log(`[e2e] chests: ${chestOpportunities.size} elite chests appeared within reach, ${botChestPicks} options taken and ${chestFx.length - botChestPicks} skips by the bots (${sent("choose")} chooses)`);
    if (expectChest && chestOpportunities.size > 0) expect(botChestPicks, `${chestOpportunities.size} elite chests appeared within reach and no bot took an option`).toBeGreaterThanOrEqual(1);

    // --- the signatures fired: damage over time and backlash are `hit` fx with a `sig`, and each was dealt by a fighter (a
    // player, or a mob of a region's faction) of the faction that owns that signature. What is asked of the bots is that
    // their own signatures fire at least once (never a count: who meets whom, and for how long, is up to the bots).
    const sigHits = fx.flatMap((f) => (f.kind === "hit" && f.sig !== undefined ? [f] : []));
    for (const f of sigHits) {
      const dealer = factionOfSession.get(f.by ?? "") ?? mobFactionOf.get(f.by ?? "");
      expect(dealer, `${f.sig} hit on ${f.id} dealt by ${f.by}`).toBe(SIGNATURE_OWNER[f.sig!]);
    }
    const botSigHits = sigHits.filter((f) => isPlayer(f.by)).length;
    console.log(
      `[e2e] signature hits: ${JSON.stringify(Object.fromEntries([...new Set(sigHits.map((f) => f.sig))].map((k) => [k, sigHits.filter((f) => f.sig === k).length])))}`
      + ` (${botSigHits} by the bots)`,
    );
    if (expectSignature) expect(botSigHits, "no bot ever dealt signature damage (burn, backlash, disease or mark)").toBeGreaterThanOrEqual(1);

    // --- the Wishes: the fx name players and the Wish of their faction, none comes before the lock is over, and each bot casts one
    // (the arena's teleport refunds a cast it cancels, which allows one more). What is asked of the bots is that some Wish lands.
    const wishFx = fx.flatMap((f) => (f.kind === "cast" || f.kind === "castLand" || f.kind === "castEnd" ? [f] : []));
    for (const f of wishFx) {
      expect(isPlayer(f.by), `${f.kind} by ${f.by}, who is no player`).toBe(true);
      expect(f.ability, `${f.kind} by ${f.by} (${factionOfSession.get(f.by)})`).toBe(WISHES[factionOfSession.get(f.by)!]);
      expect(f.t, `${f.kind} by ${f.by} before the lock was over`).toBeGreaterThanOrEqual(raidStartedAt + WISH_LOCK_SECONDS * 1000);
    }
    const wishCounts = [...sessions].map((id) => ({
      id,
      cast: wishFx.filter((f) => f.kind === "cast" && f.by === id).length,
      land: wishFx.filter((f) => f.kind === "castLand" && f.by === id).length,
      end: wishFx.filter((f) => f.kind === "castEnd" && f.by === id).length,
      refunded: wishFx.filter((f) => f.kind === "castEnd" && f.by === id && f.reason === "cancelled").length,
    }));
    for (const c of wishCounts) {
      expect(c.cast, `${c.id} began ${c.cast} casts`).toBeLessThanOrEqual(1 + c.refunded);
      expect(c.land + c.end, `${c.id} ended ${c.land + c.end} casts`).toBeLessThanOrEqual(1 + c.refunded);
    }
    const statusFx = fx.flatMap((f) => (f.kind === "status" ? [f] : []));
    for (const f of statusFx) expect(isPlayer(f.by), `${f.status} on ${f.id} from ${f.by}, who is no player`).toBe(true);
    const wishLands = sum(wishCounts.map((c) => c.land));
    console.log(
      `[e2e] wishes: ${sum(wishCounts.map((c) => c.cast))} cast fx, ${wishLands} landed, ${sum(wishCounts.map((c) => c.end))} ended unlanded,`
      + ` ${statusFx.length} status fx (${bots.map((b) => `${b.sent.cast}`).join("/")} cast messages sent per bot)`,
    );
    if (expectWish) expect(wishLands, "no bot's Wish ever landed").toBeGreaterThanOrEqual(1);

    // --- the kills: the bots really fought, and the kills the results claim are the deaths they name
    const totalKills = sum(all.map((r) => r.kills));
    const diedToABot = all.filter((r) => r.outcome === "died" && r.killedBy !== null && names.includes(r.killedBy));
    const tally = new Map<string, number>();
    for (const r of diedToABot) tally.set(r.killedBy!, (tally.get(r.killedBy!) ?? 0) + 1);
    if (expectKill) expect(totalKills, "nobody killed anybody: the bots never fought").toBeGreaterThanOrEqual(1);
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
    // (the winner or both drawers were killed by the one they killed, so no `died` result names them), a hit
    // the quitter's leave turned into a kill for somebody (it left too soon for that to be likely), and a player a mob
    // finished after a rival hit them within KILL_CREDIT_SECONDS: the result names the mob, the kill is the rival's.
    const trades = all.filter((r) => r.outcome === "won" || r.outcome === "draw").length;
    const diedToAMob = all.filter((r) => r.outcome === "died" && r.killedBy !== null && MOB_NAMES.has(r.killedBy)).length;
    expect(totalKills, "kills without a death behind them").toBeLessThanOrEqual(diedToABot.length + trades + diedToAMob + 1);
    expect(totalKills).toBeGreaterThanOrEqual(diedToABot.length - posthumous);
    // The broadcast agrees: a death fx with a killer is a kill (a leave credited to the last hitter has no fx, and
    // only the quitter leaves), and a `died` result for each of the deaths but the trades and the quitter's.
    const deathFx = fx.filter((f) => f.kind === "death" && isPlayer(f.id) && isPlayer(f.by));
    expect(deathFx.length, "death fx against deaths by a bot").toBeGreaterThanOrEqual(diedToABot.length - posthumous);
    expect(deathFx.length, "death fx against results").toBeLessThanOrEqual(diedToABot.length + trades + 1);
    expect(totalKills, "kills against death fx").toBeGreaterThanOrEqual(deathFx.length);
    expect(totalKills, "kills against death fx").toBeLessThanOrEqual(deathFx.length + diedToAMob + 1);

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
      expect(r.gv.total, `${r.profile} total`).toBe(r.gv.kills + r.gv.mobs + r.gv.bounty + r.gv.quest + r.gv.win);
      expect(r.gv.kills, `${r.profile} kill GV`).toBe(GV_KILL * r.kills);
      // Mob GV is what the sim paid per mob killed (1 to 2 for a normal one, 3 to 10 for an elite, scaled by the reward curve
      // and, for a player far behind the lobby's feed, the catch-up bonus), under the per-run cap: the death fx name the killer,
      // so a bot with mob GV killed at least one and a bot that killed some was paid at least a GV each (up to the cap) and no
      // more than MOB_GV_MAX each (an elite killed with the catch-up bonus: 12, not 10).
      const killed = mobDeathBy(bots[names.indexOf(r.profile)]!.sessionId);
      expect(r.gv.mobs, `${r.profile} mob GV`).toBeLessThanOrEqual(GV_MOB_CAP);
      expect(r.gv.mobs, `${r.profile} mob GV against the ${killed} mobs it killed`).toBeLessThanOrEqual(MOB_GV_MAX * killed);
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
    expect(sum(all.map((r) => r.gv.total)), "GV_KILL × kills + mobs + bounties + quests + the win bonus actually paid").toBe(
      GV_KILL * totalKills + sum(all.map((r) => r.gv.mobs)) + sum(all.map((r) => r.gv.bounty)) + sum(all.map((r) => r.gv.quest)) + bonusPaid,
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
    return {
      bots, players, fx, sessions, kills: totalKills, signatureHits: botSigHits, mobKills, wishLands,
      chestOpportunities: chestOpportunities.size, chestPicks: botChestPicks,
    };
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
 * Plays whole runs until one shows everything in `want`, at most RUN_ATTEMPTS: the last attempt asserts it, the earlier ones just
 * look. Every run checks all of playRun's books, so a run without the evidence is still a good run; what it lacks is the proof
 * that the bots farm a mob, fight a player and bring out their signatures. Those are properties of the bots against a random map
 * (the room draws its seed itself), not of every run: the spawns can put two bots close enough to fight before either reached a
 * camp (no mob kill: 1 run in 20 measured), or the fights can end before a signature lands. More than two attempts is a
 * failure, not a retry: what the bots do must hold in far more than the 19 runs in 20 that this allows twice in a row.
 */
async function playUntil(prefix: string, lineup: readonly FactionId[], timers: Timers, want: Required<Wanted>): Promise<Played> {
  for (let attempt = 1; ; attempt++) {
    const last = attempt === RUN_ATTEMPTS;
    const played = await playRun(`${prefix}${attempt}-`, lineup, timers, last ? want : {});
    const missing = [
      ...(want.expectKill && played.kills === 0 ? ["a kill by a bot"] : []),
      ...(want.expectSignature && played.signatureHits === 0 ? ["a signature hit by a bot"] : []),
      ...(want.expectMobKill && played.mobKills === 0 ? ["a mob killed by a bot"] : []),
      ...(want.expectWish && played.wishLands === 0 ? ["a Wish landed by a bot"] : []),
      // Only an elite chest that appeared within pick range owes a bot pick; normal camp clears do not drop chests.
      ...(want.expectChest && played.chestOpportunities > 0 && played.chestPicks === 0 ? ["a chest option taken by a bot"] : []),
    ];
    if (last || missing.length === 0) {
      console.log(`[e2e] ${prefix}: the evidence took ${attempt} attempt${attempt === 1 ? "" : "s"} (at most ${RUN_ATTEMPTS} are allowed)`);
      return played;
    }
    console.log(`[e2e] attempt ${attempt} of ${RUN_ATTEMPTS}: no ${missing.join(" and no ")}, playing again`);
  }
}

describe("headless bots hunt through a full run", () => {
  it("ends in one winner (or a draw) and banks exactly the GV it paid", async () => {
    // Patience 30 s, then 10 s locked in the coliseum before sudden death starts. The first 30 s are what the bots farm mobs
    // in (the walk to a camp is 4-6 s and a kill takes 5-15 s): a bot kills a mob in 19 runs in 20 (playUntil). Even bots
    // that never meet are then teleported together (the mobs go home) and burnt down by sudden death (about 10 s of ramp from
    // full hp), so a death is never more than about 25 s after that and a run ends within roughly 60-80 s whatever the bots do.
    // The 10 s are what lets the bots kill each other first (a faction's hp is 500-1750 and a hit a fraction of that): with
    // them really fighting, the run shows a kill by a bot (expectKill) and the signatures that go with it (expectSignature).
    // Who dies of what is not fixed: a player kill, a mob or sudden death can each take a bot, which is why the test asserts
    // the books and not a body count.
    await playUntil(
      "e2ebot", SIGNATURE_LINEUP, { patienceSeconds: 30, suddenDeathSeconds: 10 },
      { expectKill: true, expectSignature: true, expectMobKill: true, expectWish: true, expectChest: true },
    );
  }, 450_000);

  it("teleports everyone into the coliseum and the bots keep hunting there", async () => {
    // A patience this short expires before anyone can have died, so the arena always fires.
    const { bots, players, fx, sessions } = await playRun("tpbot", CONTROL_LINEUP, { patienceSeconds: 1, suddenDeathSeconds: 2 });
    for (const i of players) expect(bots[i]!.teleports, `bot ${i} teleports`).toBeGreaterThanOrEqual(1);

    // And they fight there: shots that hit somebody after the teleport's immunity is over, so they can do damage.
    const teleport = fx.find((f) => f.kind === "teleport");
    expect(teleport, "no teleport fx was broadcast").toBeDefined();
    const live = teleport!.t + TELEPORT_IMMUNITY_MS;
    const hits = fx.filter((f) => f.kind === "hit" && sessions.has(f.by ?? "") && sessions.has(f.id) && f.t >= live);
    expect(hits.length, "the bots never hit each other after the teleport").toBeGreaterThanOrEqual(1);
  }, 120_000);
});
