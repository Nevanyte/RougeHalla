// One tournament game (docs/BOTS.md 9.3): a fixed lineup of bots in a headless arena run, played to its end, summarised as plain
// data. Deterministic: the same options give a byte-identical summary (no clock, no Math.random, nothing measured in wall time
// in it; the worker times the call from outside).
import { SUDDEN_DEATH_KILLER, type FactionId, type RunOutcome, type RunResult } from "@raid/shared";
import type { BotSeatOverrides } from "../BotManager";
import {
  BOT_FILL_DEFAULTS,
  type BotStatsStoreApi, type CommandType, type PersonaId, type TierId,
} from "../brain/types";
import { createHeadlessRoom } from "./headlessRoom";
import type { SimConfig, SimEvent } from "../../sim/world";

/** A game is cut off after this much simulated time since it started (12 minutes). */
export const MAX_GAME_MS = 12 * 60_000;

/** A tournament seat: the three things a game fixes about a bot. */
export interface SeatSpec {
  readonly tier: TierId;
  readonly persona: PersonaId;
  readonly faction: FactionId;
}

export interface RunGameOptions {
  /** The world's seed: the map, the spawn shuffle, the loot, the mobs. */
  readonly seed: number;
  /** In seating order. A field left out is drawn by the manager from the game seed. */
  readonly lineup: readonly BotSeatOverrides[];
  /** Seeds the bots' streams. Default: derived from `seed` by the headless room. */
  readonly botSeed?: number;
  /** Timers over the headless defaults (patience 120 s down to 48 s, sudden death 30 s, mobs on). */
  readonly config?: Partial<SimConfig>;
  /** Simulated one-way latency and jitter of the bots' commands (ms). Default: the production defaults. */
  readonly latencyMs?: number;
  readonly jitterMs?: number;
  /** Simulated time cap. Default MAX_GAME_MS. */
  readonly maxSimMs?: number;
  /** What the bots learn from; null (default) = nothing, which is what makes a game a pure function of its options. */
  readonly store?: BotStatsStoreApi | null;
}

/** What one bot measured about itself (brain.stats), as plain data with sorted keys. */
export interface BotBehaviour {
  readonly commands: Readonly<Record<CommandType, number>>;
  readonly commandsTotal: number;
  /** Stimulus kind -> click delays (ms, rounded), the last 256 of each. */
  readonly reactions: Readonly<Record<string, readonly number[]>>;
  readonly targetClicks: number;
  readonly clickMissed: number;
  readonly clickWrong: number;
  readonly hesitations: number;
  readonly lapses: number;
  readonly throttled: number;
  readonly superseded: number;
  readonly apmPeak: number;
  readonly mobTargets: number;
  readonly mobDrops: number;
  readonly retreats: number;
  readonly mobFocusMs: number;
  readonly grabs: number;
  readonly maxStallMs: number;
  readonly dodges: number;
  readonly jukes: number;
  readonly kiteCycles: number;
  readonly goals: Readonly<Record<string, number>>;
}

export type DiedTo = "bot" | "mob" | "arena" | null;

export interface BotGameSummary {
  /** The bot's id in the world and its callsign. */
  readonly id: string;
  readonly name: string;
  readonly tier: TierId;
  readonly persona: PersonaId;
  readonly faction: FactionId;
  /** 1 = the winner, a draw's players share 1; players who went down in one tick share a place. A capped game's survivors are 1. */
  readonly place: number;
  /** "capped": still standing when the game was cut off. */
  readonly outcome: RunOutcome | "capped";
  /** Players it killed (death fx it dealt), mobs it killed, and the damage it dealt to players and to mobs. */
  readonly kills: number;
  readonly mobKills: number;
  readonly damage: number;
  readonly mobDamage: number;
  readonly deaths: number;
  readonly gv: number;
  /** Since the raid started; null while standing at the end (or at the cap). */
  readonly diedAtMs: number | null;
  /** Since the raid started: the first mob this bot killed (null: none). A tuning diagnostic. */
  readonly firstMobKillMs?: number | null;
  /** Its hp share when the coliseum teleport came (null: it was down already, or there was no teleport). A tuning diagnostic. */
  readonly tpHp?: number | null;
  readonly diedTo: DiedTo;
  readonly behaviour: BotBehaviour;
}

export interface GameSummary {
  readonly seed: number;
  readonly ended: boolean;
  /** Index into `bots` of the winner, or null (a draw, or a capped game). */
  readonly winner: number | null;
  readonly draw: boolean;
  /** Simulated ms from the raid's start to its end (or to the cap). */
  readonly durationMs: number;
  readonly ticks: number;
  /** Since the raid started; null when it never happened. */
  readonly firstDeathMs: number | null;
  /** Since the raid started: the first player a bot killed (a mob's or the arena's kill is not one); null when none. A tuning diagnostic. */
  readonly firstKillMs?: number | null;
  /** Every bot's death, in order: [ms since the raid started, victim index, killer index or -1 for a mob or the arena]. A tuning diagnostic. */
  readonly deathLog?: ReadonlyArray<readonly [number, number, number]>;
  /**
   * The first hit between each pair of bots: [ms since the raid started, attacker index, victim index, attacker hp share, victim hp share
   * (before the hit), victim busy: 1 when it traded a hit with a third bot in the 3 s before, attacker busy likewise]. A tuning diagnostic.
   */
  readonly firstHits?: ReadonlyArray<readonly [number, number, number, number, number, number, number]>;
  /** The coliseum teleport, and the moment sudden death's burn began. */
  readonly teleportMs: number | null;
  readonly suddenDeathMs: number | null;
  readonly bots: readonly BotGameSummary[];
  /** The manager's counters: `refused` and `errors` must stay 0. */
  readonly manager: {
    readonly sent: number; readonly applied: number; readonly refused: number; readonly lost: number;
    readonly frames: number; readonly errors: number;
  };
}

interface Tally {
  kills: number;
  mobKills: number;
  damage: number;
  mobDamage: number;
  diedAt: number | null;
  firstMobKill: number | null;
  tpHp: number | null;
}

const sortedEntries = <V>(o: Readonly<Record<string, V>>): Array<[string, V]> =>
  Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

function sortedRecord<V>(o: Readonly<Record<string, V>>): Record<string, V> {
  return Object.fromEntries(sortedEntries(o));
}

/** The death fx names a killer only when a player dealt the blow (a mob's is `by: null`, like the arena's): the result tells them apart. */
function diedTo(result: RunResult | undefined): DiedTo {
  if (result?.outcome !== "died") return null;
  if (result.killedBy === SUDDEN_DEATH_KILLER) return "arena";
  return result.killedByBot ? "bot" : "mob";
}

/** Plays one game to its end (or the cap) and summarises it. */
export function runGame(opts: RunGameOptions): GameSummary {
  const room = createHeadlessRoom({
    seed: opts.seed,
    ...(opts.config ? { config: opts.config } : {}),
    bots: {
      ...BOT_FILL_DEFAULTS,
      fillTo: opts.lineup.length,
      latencyMs: opts.latencyMs ?? BOT_FILL_DEFAULTS.latencyMs,
      jitterMs: opts.jitterMs ?? BOT_FILL_DEFAULTS.jitterMs,
    },
    lineup: opts.lineup,
    ...(opts.botSeed !== undefined ? { botSeed: opts.botSeed } : {}),
    statsStore: opts.store ?? null,
  });
  const { world, manager } = room;
  const ids = room.seats.map((s) => s.id);
  const tally = new Map<string, Tally>(ids.map((id) => [id, { kills: 0, mobKills: 0, damage: 0, mobDamage: 0, diedAt: null, firstMobKill: null, tpHp: null }]));
  let startedAt = -1;
  let firstDeath: number | null = null;
  let firstKill: number | null = null;
  const deathLog: Array<[number, number, number]> = [];
  const firstHits: Array<[number, number, number, number, number, number, number]> = [];
  const pairSeen = new Set<number>();
  /** The last hit between bots each one was in, per bot: [time, other bot index]. */
  const lastTrade = new Map<number, [number, number]>();
  let teleport: number | null = null;
  let suddenDeath: number | null = null;

  const since = (t: number): number => t - startedAt;

  const observe = (events: readonly SimEvent[]): void => {
    const s = world.state;
    if (startedAt < 0 && s.phase !== "lobby") startedAt = s.raidStartedAt;
    // The burn starts when the clock set at the teleport runs out, not when it is set.
    if (suddenDeath === null && s.suddenDeathAt > 0 && s.serverTime >= s.suddenDeathAt && startedAt >= 0) suddenDeath = since(s.suddenDeathAt);
    for (const ev of events) {
      if (ev.type !== "fx") continue;
      const fx = ev.fx;
      if (fx.kind === "hit") {
        const by = fx.by === null ? undefined : tally.get(fx.by);
        if (by && s.players.has(fx.id) && fx.by !== null && fx.by !== fx.id) {
          const a = ids.indexOf(fx.by);
          const v = ids.indexOf(fx.id);
          const key = Math.min(a, v) * 16 + Math.max(a, v);
          const hpShare = (id: string): number => { const pl = s.players.get(id); return pl && pl.maxHp > 0 ? Math.round((pl.hp / pl.maxHp) * 100) / 100 : 0; };
          const busy = (who: number, other: number): number => {
            const lt = lastTrade.get(who);
            return lt !== undefined && lt[1] !== other && since(s.serverTime) - lt[0] <= 3000 ? 1 : 0;
          };
          if (!pairSeen.has(key)) {
            pairSeen.add(key);
            firstHits.push([since(s.serverTime), a, v, hpShare(fx.by), hpShare(fx.id), busy(v, a), busy(a, v)]);
          }
          lastTrade.set(a, [since(s.serverTime), v]);
          lastTrade.set(v, [since(s.serverTime), a]);
        }
        if (by) {
          if (s.players.has(fx.id)) by.damage += fx.amount;
          else by.mobDamage += fx.amount;
        }
      } else if (fx.kind === "death") {
        const killer = fx.by === null ? undefined : tally.get(fx.by);
        const victim = tally.get(fx.id);
        if (victim) {
          victim.diedAt = since(s.serverTime);
          firstDeath ??= victim.diedAt;
          deathLog.push([victim.diedAt, ids.indexOf(fx.id), fx.by === null ? -1 : ids.indexOf(fx.by)]);
        }
        if (killer) {
          if (s.players.has(fx.id)) {
            killer.kills++;
            firstKill ??= since(s.serverTime);
          } else {
            killer.mobKills++;
            killer.firstMobKill ??= since(s.serverTime);
          }
        }
      } else if (fx.kind === "teleport") {
        if (teleport === null) {
          for (const [id, t] of tally) {
            const pl = s.players.get(id);
            t.tpHp = pl && pl.status === "alive" && pl.maxHp > 0 ? Math.round((pl.hp / pl.maxHp) * 100) / 100 : null;
          }
        }
        teleport ??= since(s.serverTime);
      }
    }
  };

  const ran = room.runUntilEnd(opts.maxSimMs ?? MAX_GAME_MS, observe);
  const byId = new Map(room.results.map((r) => [r.id, r.result]));
  const winnerResults = room.results.filter((r) => r.result.outcome === "won");
  const draw = room.results.some((r) => r.result.outcome === "draw");
  const winnerIndex = winnerResults.length === 1 ? ids.indexOf(winnerResults[0]!.id) : -1;

  const bots: BotGameSummary[] = room.seats.map((spec) => {
    const t = tally.get(spec.id)!;
    const result = byId.get(spec.id);
    const brain = manager.brainOf(spec.id);
    const st = brain?.stats;
    const commands = sortedRecord(st?.commands ?? {}) as Record<CommandType, number>;
    const behaviour: BotBehaviour = {
      commands,
      commandsTotal: Object.values(commands).reduce((a, b) => a + b, 0),
      reactions: Object.fromEntries(sortedEntries(st?.reactions ?? {}).map(([k, v]) => [k, (v ?? []).map(Math.round)])),
      targetClicks: st?.targetClicks ?? 0,
      clickMissed: st?.clickMissed ?? 0,
      clickWrong: st?.clickWrong ?? 0,
      hesitations: st?.hesitations ?? 0,
      lapses: st?.lapses ?? 0,
      throttled: st?.throttled ?? 0,
      superseded: st?.superseded ?? 0,
      apmPeak: st?.apmPeak ?? 0,
      mobTargets: st?.mobTargets ?? 0,
      mobDrops: st?.mobDrops ?? 0,
      retreats: st?.retreats ?? 0,
      mobFocusMs: Math.round(st?.mobFocusMs ?? 0),
      grabs: st?.grabs ?? 0,
      maxStallMs: Math.round(st?.maxStallMs ?? 0),
      dodges: st?.dodges ?? 0,
      jukes: st?.jukes ?? 0,
      kiteCycles: st?.kiteCycles ?? 0,
      goals: sortedRecord((st?.goals ?? {}) as Record<string, number>),
    };
    return {
      id: spec.id,
      name: spec.name,
      tier: spec.tier,
      persona: spec.persona,
      faction: spec.faction,
      // No result: still standing at the cap. They share first place, as a draw's players do.
      place: result?.place ?? 1,
      outcome: result?.outcome ?? "capped",
      kills: t.kills,
      mobKills: t.mobKills,
      damage: Math.round(t.damage),
      mobDamage: Math.round(t.mobDamage),
      deaths: result && (result.outcome === "died" || result.outcome === "mia") ? 1 : 0,
      gv: result?.gv.total ?? 0,
      diedAtMs: t.diedAt,
      firstMobKillMs: t.firstMobKill,
      tpHp: t.tpHp,
      diedTo: diedTo(result),
      behaviour,
    };
  });

  const summary: GameSummary = {
    seed: opts.seed >>> 0,
    ended: ran.ended,
    winner: winnerIndex >= 0 ? winnerIndex : null,
    draw,
    durationMs: startedAt >= 0 ? world.state.serverTime - startedAt : 0,
    ticks: room.ticks,
    firstDeathMs: firstDeath,
    firstKillMs: firstKill,
    deathLog,
    firstHits,
    teleportMs: teleport,
    suddenDeathMs: suddenDeath,
    bots,
    manager: {
      sent: manager.stats.sent, applied: manager.stats.applied, refused: manager.stats.refused, lost: manager.stats.lost,
      frames: manager.stats.frames, errors: manager.stats.errors,
    },
  };
  manager.dispose();
  return summary;
}
