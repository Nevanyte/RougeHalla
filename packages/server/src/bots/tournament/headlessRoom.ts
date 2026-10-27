// A Room-less driver of one arena world, in the Room's own tick order (rooms/RaidRoom.ts `tick`), for the tournament, the perf
// and bandwidth gates and any test that wants a lobby of bots to play: no Colyseus, no clock, no sockets, nothing that is not
// seeded, so a game replays exactly from its options.
//
// One tick is what one Room step with one patch is: the lobby's arrivals, the commands that reached the server by this step,
// the step, its events routed as `handleEvents` routes them (the fx batch, a bot's toasts and results), the roster, the
// patch, and one frame per bot over the batches broadcast since its last frame. A Room callback may run up to three steps
// per patch under lag; a headless room has no lag, so it is always one.
//
// What it does not do: persistence (nothing is banked, no profile exists), the lock on the room or the linger after the end.
import {
  generateMap, mulberry32, TICK_MS,
  type FxBatch, type GameMap, type RunResult,
} from "@raid/shared";
import { BotManager, type BotSeatOverrides } from "../BotManager";
import type { BotFillConfig, BotSeatSpec, BotStatsStoreApi, BrainFactory, Features } from "../brain/types";
import { FxChannel } from "../../rooms/FxChannel";
import { createGameWorld } from "../../sim/gameplay";
import { step } from "../../sim/step";
import type { SimConfig, SimEvent, World } from "../../sim/world";

/** The GV toast a bot reads, spelt as the Room spells it (RaidRoom.GV_TOAST). */
const GV_TOAST = { kill: "kill", mob: "mob", elite: "elite", bounty: "bounty", skip: "chest skip", quest: "quest" } as const;

/** Short timers like the e2e's: a run is over in minutes of simulated time. Mobs on, as the server has them. */
export const HEADLESS_CONFIG: SimConfig = {
  minPlayers: 2,
  lobbySeconds: 30,
  fillSeconds: 5,
  patienceSeconds: 120,
  patienceMinSeconds: 48,
  suddenDeathSeconds: 30,
  mobs: true,
};

export interface HeadlessRoomOptions {
  /**
   * The world's seed (the map, `generateMap(seed)`: its first certified attempt, built here on this thread, never from a pool).
   * Also seeds the sim's own random stream and the reward stream.
   */
  seed: number;
  /** A ready map of `seed` (its seed must match), so a caller that already built it does not pay for it twice. */
  map?: GameMap;
  /** Timers and flags over HEADLESS_CONFIG. */
  config?: Partial<SimConfig>;
  /** The fill configuration the manager reads (latency, jitter, mixes; `fillTo` and `arrivalSeconds` when it fills a lobby). */
  bots: BotFillConfig;
  /** A fixed lineup, seated at once in this order (the sim shuffles who spawns where). With one, the raid starts on the first tick. */
  lineup?: readonly BotSeatOverrides[];
  /** The manager's seed (its streams and every bot's). Default: derived from `seed`. */
  botSeed?: number;
  /** What the bots learn from (null / absent = learning off). */
  statsStore?: BotStatsStoreApi | null;
  /** Callsigns the manager must not draw (a real profile's). Default: none. */
  isNameTaken?: (name: string) => boolean;
  /** Test seams of the manager. */
  features?: Features;
  createBrain?: BrainFactory;
  /** False keeps the lobby open after seating the lineup (a test adds a human, or lets `bots.fillTo` and the countdown run). */
  startAtOnce?: boolean;
}

/** A player's result, as the Room's `settle` receives it. */
export interface ResolvedResult {
  readonly id: string;
  readonly result: RunResult;
  readonly bot: boolean;
}

export interface HeadlessRoom {
  readonly world: World;
  readonly manager: BotManager;
  readonly channel: FxChannel;
  /** The seats `lineup` made, in order. */
  readonly seats: readonly BotSeatSpec[];
  /** Every `resolved` event so far, in the order they came. */
  readonly results: readonly ResolvedResult[];
  /** The fx batch of the last tick, if it had one. */
  readonly lastBatch: FxBatch | null;
  /** Ticks stepped. */
  readonly ticks: number;
  /** One Room step: arrivals, due commands, the step, the event routing, the patch and the bots' frames. Returns the step's events. */
  tick(): SimEvent[];
  /**
   * Ticks until the run ends or `maxSimMs` of simulated time have passed since this call. `onTick` sees every tick's events.
   * `ended` is false when the cap stopped it.
   */
  runUntilEnd(maxSimMs: number, onTick?: (events: readonly SimEvent[]) => void): { ended: boolean; simMs: number };
}

/** A 32-bit seed for one stream of a game (a murmur finaliser over seed and tag), so the streams of one seed do not march together. */
function mix(seed: number, tag: number): number {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(tag + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

export function createHeadlessRoom(opts: HeadlessRoomOptions): HeadlessRoom {
  const seed = opts.seed >>> 0;
  const world = createGameWorld({
    // As the server builds it: no decor (props are cosmetic, the sim never reads them, and the hash leaves them out).
    map: opts.map ?? generateMap(seed, undefined, { decor: false }),
    config: { ...HEADLESS_CONFIG, ...opts.config },
    random: mulberry32(mix(seed, 1)),
    // A fixed secret: a game replays exactly. (A live Room draws this from crypto.)
    rewardSalt: [mix(seed, 2), mix(seed, 3), mix(seed, 4), mix(seed, 5)],
    // The default is a random UUID, which would put a different string in every container of every replay.
    newItemUid: ((n: number) => () => `u${++n}`)(0),
  });
  const manager = new BotManager(world, opts.bots, {
    store: opts.statsStore ?? null,
    isNameTaken: opts.isNameTaken ?? (() => false),
    seed: opts.botSeed ?? mix(seed, 6),
    ...(opts.features ? { features: opts.features } : {}),
    ...(opts.createBrain ? { createBrain: opts.createBrain } : {}),
  });
  const channel = new FxChannel();
  const results: ResolvedResult[] = [];
  const seats: BotSeatSpec[] = [];
  let lastBatch: FxBatch | null = null;
  let ticks = 0;

  for (const over of opts.lineup ?? []) {
    const spec = manager.addBot(over);
    if (spec === null) throw new Error("the lineup does not fit the lobby (a full or closed lobby)");
    seats.push(spec);
  }
  // The countdown ends with the first step: updateLobby starts the raid in it, as it would at the countdown's end. The manager's
  // lobbyClosing hook seats no one for a lobby with no human, so a fixed lineup stays what it was.
  if ((opts.lineup?.length ?? 0) > 0 && opts.startAtOnce !== false) world.state.lobbyEndsAt = world.state.serverTime;

  function tick(): SimEvent[] {
    const s = world.state;
    if (s.phase === "lobby") manager.lobbyTick();
    manager.beforeStep(s.serverTime + TICK_MS);
    const events = step(world, TICK_MS);
    ticks++;

    const fxs = [];
    for (const ev of events) {
      switch (ev.type) {
        case "fx":
          fxs.push(ev.fx);
          break;
        case "toast":
          if (ev.to !== null && manager.isBot(ev.to)) manager.onToast(ev.to, ev.text);
          break;
        case "resolved": {
          const bot = ev.bot === true || world.players.get(ev.id)?.bot === true;
          results.push({ id: ev.id, result: ev.result, bot });
          if (bot) manager.onResult(ev.id, ev.result);
          break;
        }
        case "gv":
          if (manager.isBot(ev.id)) manager.onToast(ev.id, `+${ev.amount} GV (${GV_TOAST[ev.reason]})`);
          break;
        case "plan":
          // The bot's own deal (the planning module reads it from its next frame).
          if (manager.isBot(ev.to)) manager.onPrivate(ev.to, "plan", ev.plan);
          break;
        case "planningStarted":
        case "raidStarted":
        case "raidEnded":
          break;
      }
    }
    lastBatch = channel.batch(fxs, s.serverTime, world.projectiles);
    channel.extendRoster(s);
    channel.rosterSent();
    manager.afterPatch(lastBatch ? [lastBatch] : []);
    return events;
  }

  return {
    world,
    manager,
    channel,
    seats,
    results,
    get lastBatch() { return lastBatch; },
    get ticks() { return ticks; },
    tick,
    runUntilEnd(maxSimMs, onTick) {
      const t0 = world.state.serverTime;
      // Ended is a phase the sim never leaves; a lobby with nobody in it would idle for ever, so it is bounded by the cap too.
      while (world.state.phase !== "ended" && world.state.serverTime - t0 < maxSimMs) {
        const events = tick();
        onTick?.(events);
      }
      return { ended: world.state.phase === "ended", simMs: world.state.serverTime - t0 };
    },
  };
}
