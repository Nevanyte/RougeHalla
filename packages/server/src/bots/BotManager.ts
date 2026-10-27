// BotManager: the in-process driver that fills a lobby with bots and plays them (docs/BOTS.md 1 and 7.2). The Room's only bot
// surface. A fill bot is a normal PlayerState + PlayerRuntime (addPlayer with { bot: true }): no client, no profile, no seat. Its
// brain runs behind a BotRunner, once per Room callback (one frame per patch, like a client), and whatever it clicks goes through a
// latency delay line into the very `enqueueClientMessage` a human's message takes, before the first step at or after its arrival.
//
// It never touches persistence: no ProfileStore import, no profile, token or registry entry. The learning store is its own file
// (bots/learning), and a bot that never got a result (the room closed first) records nothing.
//
// Randomness comes from streams seeded by `deps.seed` and nothing else (no Math.random, no clock), so the same seed and the same
// world give the same lobby and the same commands: the arrival schedule, tiers, personas, factions and names, and the delay
// line's jitter (a stream of its own, so tuning the latency never reshuffles who arrives).
import {
  CLIENT_MESSAGE_TYPES, FACTION_IDS, INTERP_DELAY_MS, isFactionId, MAX_PLAYERS, mulberry32,
  type FactionId, type FxBatch, type Rng, type RunResult,
} from "@raid/shared";
import { PlayerState } from "@raid/shared/schema";
import { enqueueClientMessage } from "../sim/inputs";
import { addPlayer, removePlayer } from "../sim/step";
import { chainHook, type World } from "../sim/world";
import { createBrain } from "./brain/brain";
import { enabledModules } from "./brain/modules";
import { detectFeatures, type PerceptionInput, type PrivateMessage } from "./brain/perception";
import { softmaxIndex } from "./brain/random";
import { createBotRunner } from "./brain/runner";
import { createPathBudget, createPathService } from "./brain/services";
import {
  LEARN, PERSONA_IDS, PERSONAS, TIER_IDS, TIERS,
  type BotAdapter, type BotFillConfig, type BotRunnerApi, type BotSeatSpec, type BotStatsStoreApi, type Brain, type BrainFactory,
  type Command, type Features, type LearnedBias, type PersonaId, type ServerMs, type TierId,
} from "./brain/types";
import { botId, pickCallsign } from "./callsigns";
import { NO_BIAS } from "./learning/BotStatsStore";

/** At most this many bots-and-humans of one faction in a lobby, as far as the state shows (the rest are picked from the others). */
const MAX_PER_FACTION = 2;
/** The faction softmax over `faction|<persona>|<faction>` biases (they are at most +-LEARN.cap, so this keeps every faction in play). */
const FACTION_TEMPERATURE = 0.3;
/** The last arrival is this long before the countdown ends. */
const ARRIVAL_END_MARGIN_MS = 1000;
/** A bot's pending toasts and private messages are capped: a dead bot reads none, and they must not pile up. */
const MAX_BUFFERED = 32;
/** A bot's undelivered commands. The humanizer's rate cap keeps this a handful; the limit is only a backstop. */
const MAX_QUEUED = 256;

export interface BotManagerDeps {
  /** The learning store (null = learning off: a bot reads NO_BIAS and nothing is recorded). */
  store: BotStatsStoreApi | null;
  /** True when `name` is a real profile's (a read-only lookup). The manager never creates or changes a profile. */
  isNameTaken(name: string): boolean;
  /** Seeds every stream of the manager and, derived, of each bot. */
  seed: number;
  /** Test seam: skips detectFeatures. */
  features?: Features;
  /** Test seam: a scripted brain in place of createBrain. */
  createBrain?: BrainFactory;
}

/** What `addBot` may fix instead of drawing it. */
export interface BotSeatOverrides {
  readonly tier?: TierId;
  readonly persona?: PersonaId;
  readonly faction?: FactionId;
  readonly name?: string;
}

export interface BotManagerStats {
  /** Bots seated (by the arrival schedule, by lobbyClosing, or by addBot) and bots that gave their seat up to a human. */
  arrived: number;
  yielded: number;
  /** Commands the brains issued (queued on a delay line). */
  sent: number;
  /** Commands handed to enqueueClientMessage, and how many of those it accepted / refused. `refused` must stay 0. */
  applied: number;
  refused: number;
  /** Commands that came due for a bot no longer in the world. */
  lost: number;
  /** Frames run (one per bot per patch). */
  frames: number;
  /** Brains that threw. The bot stops acting, the room goes on. */
  errors: number;
  /** Results handed to the brains. */
  results: number;
}

/** One bot's commands in flight to the server: arrivals are never out of order, as on a TCP connection. */
interface DelayLine {
  readonly queue: Array<{ readonly arrival: ServerMs; readonly cmd: Command }>;
  lastArrival: ServerMs;
}

interface Seat {
  readonly spec: BotSeatSpec;
  readonly runner: BotRunnerApi<PerceptionInput>;
  readonly line: DelayLine;
  toasts: string[];
  privates: PrivateMessage[];
  ended: boolean;
  failed: boolean;
}

/** A 32-bit seed for one stream: the seed mixed with a tag (a murmur finaliser), so no two streams of a manager march in step. */
function mix(seed: number, tag: number): number {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(tag + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** An id by cumulative weight. Weights are relative, not normalised; a mix with nothing above 0 falls back to the first id. */
function pickWeighted<K extends string>(rng: Rng, ids: readonly K[], weights: Readonly<Record<K, number>>): K {
  let total = 0;
  for (const id of ids) total += Math.max(0, weights[id]);
  const r = rng();
  if (!(total > 0)) return ids[0]!;
  let acc = r * total;
  for (const id of ids) {
    acc -= Math.max(0, weights[id]);
    if (acc < 0) return id;
  }
  return ids[ids.length - 1]!;
}

export class BotManager {
  readonly stats: BotManagerStats = {
    arrived: 0, yielded: 0, sent: 0, applied: 0, refused: 0, lost: 0, frames: 0, errors: 0, results: 0,
  };

  private readonly world: World;
  private readonly cfg: BotFillConfig;
  private readonly deps: BotManagerDeps;
  private readonly seats = new Map<string, Seat>();
  /** Fill decisions and the delay line's jitter: two streams, so the latency setting never changes who arrives. */
  private readonly fillRng: Rng;
  private readonly lineRng: Rng;
  private readonly features: Features;
  private readonly budget = createPathBudget();
  private readonly makeBrain: BrainFactory;
  /** The lobby size to fill up to. */
  private readonly target: number;
  private nextN = 1;
  /** Server times at which the next bots arrive, ascending. Drawn once, when the countdown gets within arrivalSeconds. */
  private pending: number[] = [];
  private scheduled = false;
  /** The countdown's end when the schedule was drawn: a shorter countdown squeezes the schedule into what is left. */
  private scheduleEnd = 0;
  private lastHumans = 0;
  private disposed = false;

  constructor(world: World, cfg: BotFillConfig, deps: BotManagerDeps) {
    this.world = world;
    this.cfg = cfg;
    this.deps = deps;
    this.target = Math.min(MAX_PLAYERS, Math.max(0, Math.floor(cfg.fillTo)));
    this.fillRng = mulberry32(mix(deps.seed, 0));
    this.lineRng = mulberry32(mix(deps.seed, 1));
    this.features = deps.features ?? detectFeatures({
      state: world.state, player: new PlayerState(), map: world.map, messageTypes: CLIENT_MESSAGE_TYPES,
    });
    this.makeBrain = deps.createBrain ?? createBrain;
    chainHook(world, "lobbyClosing", () => this.lobbyClosing());
  }

  // ======================================================================================================== the lobby

  /**
   * Before each lobby step. Once a human is in and the countdown is within arrivalSeconds of its end, draws the arrival times
   * of the bots still missing (uniform over the rest of the countdown less a second) and seats each when its time comes, so
   * the HUD's head count ticks up like a queue. A human who joins takes the seat of the latest bot still to come. Never
   * touches the countdown.
   */
  lobbyTick(): void {
    const s = this.world.state;
    if (this.disposed || this.target <= 0 || s.phase !== "lobby") return;
    const now = s.serverTime;
    const humans = this.humans();
    for (let i = this.lastHumans; i < humans && this.pending.length > 0; i++) this.pending.pop();
    this.lastHumans = humans;
    // A lobby with no human in it gets no bots (the last client leaving disposes the room anyway).
    if (humans === 0) return;

    if (!this.scheduled) {
      if (s.lobbyEndsAt - now > this.cfg.arrivalSeconds * 1000) return;
      this.scheduled = true;
      this.scheduleEnd = s.lobbyEndsAt;
      const need = Math.max(0, this.target - s.players.size);
      const lastAt = Math.max(now, s.lobbyEndsAt - ARRIVAL_END_MARGIN_MS);
      for (let i = 0; i < need; i++) this.pending.push(now + this.fillRng() * (lastAt - now));
      this.pending.sort((a, b) => a - b);
    } else if (s.lobbyEndsAt < this.scheduleEnd) {
      this.squeeze(now, s.lobbyEndsAt);
    }

    while (this.pending.length > 0 && this.pending[0]! <= now) {
      this.pending.shift();
      if (s.players.size < this.target) this.addBot();
    }
  }

  /** The countdown got shorter (enough humans joined): the arrivals still to come keep their order inside what is left. */
  private squeeze(now: ServerMs, endsAt: ServerMs): void {
    const oldSpan = Math.max(0, this.scheduleEnd - ARRIVAL_END_MARGIN_MS - now);
    const newSpan = Math.max(0, endsAt - ARRIVAL_END_MARGIN_MS - now);
    this.scheduleEnd = endsAt;
    if (oldSpan <= 0) return;
    this.pending = this.pending.map((t) => now + Math.max(0, t - now) * (newSpan / oldSpan));
  }

  /** The lobby is about to start the raid (the sim's `lobbyClosing` hook): seat whoever has not arrived yet, at once. */
  lobbyClosing(): void {
    this.pending = [];
    if (this.disposed || this.target <= 0 || this.humans() === 0) return;
    const s = this.world.state;
    while (s.players.size < this.target && s.players.size < MAX_PLAYERS) {
      if (this.addBot() === null) break;
    }
  }

  /** A human is joining a full lobby: the newest bot gives its seat up (a lobby leave costs nothing). */
  yieldSeat(): boolean {
    if (this.disposed || this.world.state.phase !== "lobby") return false;
    let newest: Seat | undefined;
    for (const seat of this.seats.values()) newest = seat;
    if (newest === undefined) return false;
    this.seats.delete(newest.spec.id);
    removePlayer(this.world, newest.spec.id);
    this.stats.yielded++;
    return true;
  }

  /**
   * Seats one bot now (a lobby only), drawing what `over` leaves open. The arrival schedule and lobbyClosing call this; so
   * may a tournament seating a fixed lineup. Null when the lobby is full or closed.
   */
  addBot(over: BotSeatOverrides = {}): BotSeatSpec | null {
    const state = this.world.state;
    if (this.disposed || state.phase !== "lobby" || state.players.size >= MAX_PLAYERS) return null;
    const n = this.nextN++;
    // Every draw is made whether or not it is overridden, so fixing one thing never reshuffles the rest.
    const drawnTier = pickWeighted(this.fillRng, TIER_IDS, this.cfg.tierMix);
    const drawnPersona = pickWeighted(this.fillRng, PERSONA_IDS, this.cfg.personaMix);
    const tier = over.tier ?? drawnTier;
    const persona = over.persona ?? drawnPersona;
    const learned = this.deps.store?.snapshot() ?? NO_BIAS;
    const drawnFaction = this.pickFaction(persona, learned);
    const drawnName = this.pickName();
    const spec: BotSeatSpec = {
      id: botId(n), name: over.name ?? drawnName, tier, persona, faction: over.faction ?? drawnFaction, seed: mix(this.deps.seed, 1000 + n),
    };
    addPlayer(this.world, spec.id, spec.name, { faction: spec.faction, bot: true });
    this.seats.set(spec.id, this.seat(spec, learned));
    this.stats.arrived++;
    return spec;
  }

  private humans(): number {
    let n = 0;
    for (const rt of this.world.players.values()) if (!rt.bot) n++;
    return n;
  }

  /** A softmax over the learned faction biases among the factions with room (at most MAX_PER_FACTION a lobby), plus an exploration floor. */
  private pickFaction(persona: PersonaId, learned: LearnedBias): FactionId {
    const counts = new Map<FactionId, number>();
    for (const p of this.world.state.players.values()) {
      if (isFactionId(p.faction)) counts.set(p.faction, (counts.get(p.faction) ?? 0) + 1);
    }
    let open: readonly FactionId[] = FACTION_IDS.filter((f) => (counts.get(f) ?? 0) < MAX_PER_FACTION);
    if (open.length === 0) open = FACTION_IDS;
    if (this.fillRng() < LEARN.explore) return open[Math.floor(this.fillRng() * open.length) % open.length]!;
    const utilities = open.map((f) => learned.bias(`faction|${persona}|${f}`));
    return open[softmaxIndex(this.fillRng, utilities, FACTION_TEMPERATURE)]!;
  }

  /** A callsign that no one in the room has (case-insensitive) and no profile owns. */
  private pickName(): string {
    const inRoom = new Set<string>();
    for (const p of this.world.state.players.values()) inRoom.add(p.name.toLowerCase());
    return pickCallsign(this.fillRng, (name) => inRoom.has(name.toLowerCase()) || this.deps.isNameTaken(name));
  }

  // ============================================================================================================ the bots

  private seat(spec: BotSeatSpec, learned: LearnedBias): Seat {
    const line: DelayLine = { queue: [], lastArrival: Number.NEGATIVE_INFINITY };
    const adapter: BotAdapter = {
      selfId: spec.id,
      supports: (type) => this.features.messageTypes.includes(type),
      send: (cmd, at) => this.deliver(line, cmd, at),
    };
    const tier = TIERS[spec.tier];
    const brain: Brain = this.makeBrain({
      id: spec.id,
      name: spec.name,
      tier,
      persona: PERSONAS[spec.persona],
      seed: spec.seed,
      map: this.world.map,
      features: this.features,
      learned,
      // One search allowance for the whole room; each bot keeps its own cache over it.
      services: { paths: createPathService(this.world.map, this.budget), log: () => {} },
      modules: enabledModules(this.features),
    });
    const runner = createBotRunner({
      brain,
      adapter,
      cfg: { selfDelayMs: this.cfg.latencyMs, worldDelayMs: INTERP_DELAY_MS + this.cfg.latencyMs },
      map: this.world.map,
      features: this.features,
      tier,
    });
    return { spec, runner, line, toasts: [], privates: [], ended: false, failed: false };
  }

  /**
   * A command the bot clicked at `at`: it reaches the server `latencyMs` +- `jitterMs` later, and never before the command
   * ahead of it. False when this server does not take the message.
   */
  private deliver(line: DelayLine, cmd: Command, at: ServerMs): boolean {
    if (!this.features.messageTypes.includes(cmd.type) || line.queue.length >= MAX_QUEUED) return false;
    const jitter = (this.lineRng() * 2 - 1) * this.cfg.jitterMs;
    const arrival = Math.max(line.lastArrival, at + this.cfg.latencyMs + jitter);
    line.lastArrival = arrival;
    line.queue.push({ arrival, cmd });
    this.stats.sent++;
    return true;
  }

  /**
   * Right before the step at server time `stepT`: every command whose arrival has come reaches its bot's input queue through
   * enqueueClientMessage, the call a human's message takes, so the step applies it as it would a socket message that came
   * in between two steps.
   */
  beforeStep(stepT: ServerMs): void {
    if (this.disposed) return;
    for (const seat of this.seats.values()) {
      const { queue } = seat.line;
      if (queue.length === 0 || queue[0]!.arrival > stepT) continue;
      const rt = this.world.players.get(seat.spec.id);
      let due = 0;
      while (due < queue.length && queue[due]!.arrival <= stepT) {
        const { cmd } = queue[due++]!;
        if (rt === undefined) this.stats.lost++;
        else if (enqueueClientMessage(rt.inputs, cmd.type, cmd.msg)) this.stats.applied++;
        else this.stats.refused++;
      }
      queue.splice(0, due);
    }
  }

  /**
   * Once per Room callback, after the patch went out: every bot standing in a running raid sees the state as it now stands and
   * the `fxs` batches that were broadcast since its last frame (the very ones the clients got), and decides.
   */
  afterPatch(batches: readonly FxBatch[]): void {
    if (this.disposed) return;
    this.budget.startTick();
    const state = this.world.state;
    // The planning screen is a phase of its own: a bot's frames run in it too, while its status is still the lobby's.
    const planning = state.phase === "planning";
    if (state.phase !== "active" && !planning) return;
    for (const seat of this.seats.values()) {
      if (seat.ended || seat.failed) continue;
      if (state.players.get(seat.spec.id)?.status !== (planning ? "lobby" : "alive")) continue;
      const input: PerceptionInput = {
        state,
        fxs: batches,
        ...(seat.toasts.length > 0 ? { toasts: seat.toasts } : {}),
        ...(seat.privates.length > 0 ? { privates: seat.privates } : {}),
      };
      seat.toasts = [];
      seat.privates = [];
      try {
        seat.runner.frame(input);
        this.stats.frames++;
      } catch (err) {
        // A brain bug must not take the room's tick down with it: the bot goes idle and the fight goes on.
        seat.failed = true;
        this.stats.errors++;
        console.error(`[bots] ${seat.spec.name} (${seat.spec.id}) stopped acting:`, err);
      }
    }
  }

  // ===================================================================================================== messages to a bot

  isBot(id: string): boolean {
    return this.seats.has(id);
  }

  /** A toast the server would have sent this bot ("Too far away", "+5 GV (kill)"): read with its next frame. */
  onToast(id: string, text: string): void {
    const seat = this.seats.get(id);
    if (seat === undefined) return;
    seat.toasts.push(text);
    if (seat.toasts.length > MAX_BUFFERED) seat.toasts.shift();
  }

  /** A private server message addressed to this bot (R3 `plan`, R7 `reveal`): read with its next frame. */
  onPrivate(id: string, type: string, msg: unknown): void {
    const seat = this.seats.get(id);
    if (seat === undefined) return;
    seat.privates.push({ type, msg });
    if (seat.privates.length > MAX_BUFFERED) seat.privates.shift();
  }

  /** The bot's run is over: its brain learns from the outcome. Nothing else (the Room banks nothing for a bot). */
  onResult(id: string, result: RunResult): void {
    const seat = this.seats.get(id);
    if (this.disposed || seat === undefined || seat.ended) return;
    seat.ended = true;
    seat.line.queue.length = 0;
    this.stats.results++;
    try {
      const summary = seat.runner.end(result);
      // The faction was the manager's pick, not a brain decision: the run it led to is what the faction bias learns from.
      this.deps.store?.record({ ...summary, choices: [...summary.choices, `faction|${seat.spec.persona}|${seat.spec.faction}`] });
    } catch (err) {
      console.error(`[bots] could not record the result of ${seat.spec.name}:`, err);
    }
  }

  /** The room is closing. A bot with no result records nothing (its run never resolved), and the learning file is written out. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pending = [];
    try {
      this.deps.store?.flush();
    } catch (err) {
      console.error("[bots] could not flush the bot stats:", err);
    }
  }

  // ========================================================================================================== inspection

  /** The bots seated, in seating order. */
  specs(): readonly BotSeatSpec[] {
    return [...this.seats.values()].map((s) => s.spec);
  }

  /** A bot's brain (its goal and stats), or undefined. */
  brainOf(id: string): Brain | undefined {
    return this.seats.get(id)?.runner.brain;
  }

  /** Commands issued and not yet delivered, over all bots. */
  get inFlight(): number {
    let n = 0;
    for (const seat of this.seats.values()) n += seat.line.queue.length;
    return n;
  }
}
