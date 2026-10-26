// A headless player over the network (docs/BOTS.md 1): the network driver of the human-like brain. It talks to the server the
// way the web client does: HTTP for the profile, then a Colyseus room where it reads the SDK-decoded state and the `fxs`
// batches and sends inputs only (move, stop, target, swap, pickup). It never touches server internals; the map comes from the
// public seed. Everything it decides is the brain's (bots/brain/): one frame per state patch goes into the runner, and what
// comes out is sent with `room.send` at once, because the socket is the latency (the runner is configured with no self delay
// and the client's own render delay for the world). The fill bots of the server run the same brain in-process (BotManager).
import { Client, type Room } from "@colyseus/sdk";
import {
  CLIENT_MESSAGE_TYPES, generateMap, INTERP_DELAY_MS, mulberry32, PROFILE_TOKEN_HEADER, ROOM_NAME, unpackFx,
  type ClientMessageType, type FactionId, type FxBatch, type GameMap, type JoinOptions, type ProfileResponse, type RunResult,
} from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { loadConfig } from "../config";
import { createBrain } from "./brain/brain";
import { enabledModules } from "./brain/modules/index";
import { detectFeatures, type PerceptionInput, type PrivateMessage } from "./brain/perception";
import { createBotRunner } from "./brain/runner";
import { createPathBudget, createPathService, type PathBudget } from "./brain/services";
import {
  PERSONA_IDS, PERSONAS, TIERS,
  type BotAdapter, type BotRunnerApi, type BotStatsStoreApi, type Brain, type Command, type CommandType, type PersonaId, type TierId,
} from "./brain/types";
import { createBotStatsStore, NO_BIAS } from "./learning/BotStatsStore";

type ClientRoom = Room<any, RaidState>;

export interface BotOptions {
  verbose?: boolean;
  /**
   * Gives up (error, no result) after this long. Default 20 minutes: a run ends by itself, but every
   * death restarts the patience timer, so a long one is possible.
   */
  timeoutMs?: number;
  /**
   * Called as soon as the server has issued the profile's token, before the bot tries to join. A
   * claimed name is only ever reachable again with its token, so a caller that keeps tokens must keep
   * this one even when the join then fails. Must not throw.
   */
  onToken?: (token: string) => void;
  /**
   * Test knob: leave the room (with consent, so the server resolves the bot as MIA at once) once the run
   * has been going this long (server time). The bot gets no result message: the server has already
   * dropped it from the room when it settles the run.
   */
  abandonAfterMs?: number;
  /** The faction to ask for at join, as the hub's picker does. Left out, the server hands out its round-robin default. */
  faction?: FactionId;
  /** How well it plays (BOTS.md 2.2). Default "hard". */
  tier?: TierId;
  /** What it plays for (BOTS.md 5). Default: drawn from the seed. */
  persona?: PersonaId;
  /** The seed of the bot's random streams: the same seed and the same room play the same. Default: a hash of the profile name. */
  seed?: number;
  /**
   * The learning file (BOTS.md 6.2). Left out, the bot does not learn (it reads no bias and records nothing). Bots of one process
   * that name the same file share one store.
   */
  statsFile?: string;
}

export interface BotRun {
  profile: string;
  /** Null when the bot never got one; `error` then says why (none when it abandoned on purpose). */
  result: RunResult | null;
  error?: string;
  /** The bot left on purpose (`abandonAfterMs`), so there is no result and nothing went wrong. */
  abandoned?: true;
}

/** What the bot did, for the tests and `--verbose` (the brain's stats under the names the e2e reads). */
export interface BotStats {
  /** Mob targets picked, and mobs given up on (they went home, could not be hurt, or took too long). */
  mobTargets: number;
  mobDrops: number;
  /** Retreats from a mob fight at low hp. */
  retreats: number;
  /** Time (ms) spent with a mob focus. */
  mobFocusMs: number;
  /** Weapons taken from containers. */
  grabs: number;
  /** The longest stretch (ms) the bot stood still without attacking or fetching anything while it was alive in a running raid. */
  maxStallMs: number;
}

const NO_STATS: BotStats = { mobTargets: 0, mobDrops: 0, retreats: 0, mobFocusMs: 0, grabs: 0, maxStallMs: 0 };

/** The Colyseus guard is 100 messages a second per client (RaidRoom): the bot stays under it whatever the brain asks for. */
const MAX_SENDS_PER_SECOND = 90;
/** A stall this long (ms) longer than the last one logged is logged with --verbose. */
const STALL_LOG_STEP_MS = 1500;
/** Private messages kept for the next frame, at most. */
const MAX_PRIVATES = 64;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** FNV-1a: a stable 32-bit seed from a profile name. */
function hashName(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** One store per learning file in this process: bots that each loaded and wrote their own copy would overwrite one another. */
const statsStores = new Map<string, BotStatsStoreApi>();

function statsStore(file: string): BotStatsStoreApi {
  let store = statsStores.get(file);
  if (!store) {
    // The profile file belongs to the profile store alone (the server this CLI talks to is usually run with the same env).
    store = createBotStatsStore(file, { forbid: [loadConfig(process.env).stashFile] });
    statsStores.set(file, store);
  }
  return store;
}

export class BotClient {
  roomId = "";
  token = "";
  /** `result` messages received while the bot was still in the room. A correct server sends exactly one. */
  resultsSeen = 0;
  /** `teleport` fx seen: how many times the arena moved everyone into the coliseum. */
  teleports = 0;
  /** Inputs sent so far, by message type. */
  readonly sent: Record<ClientMessageType, number> = { move: 0, stop: 0, target: 0, aim: 0, attack: 0, release: 0, swap: 0, pickup: 0 };

  private profile = "";
  private room!: ClientRoom;
  private finished = false;
  /** The socket is gone (left or errored): there is nothing to say goodbye to. */
  private roomClosed = false;
  private abandoned = false;
  private readonly done: Promise<BotRun>;
  private settle!: (run: BotRun) => void;
  private timer: NodeJS.Timeout | undefined;

  private brain: Brain | null = null;
  private tierPlayed: TierId = "hard";
  private personaPlayed: PersonaId = "hunter";
  private runner: BotRunnerApi<PerceptionInput> | null = null;
  private budget: PathBudget = createPathBudget();
  private store: BotStatsStoreApi | null = null;
  private ended = false;
  /** What arrived since the last frame (patch): the next frame hands it to perception. */
  private fxBuf: FxBatch[] = [];
  private toastBuf: string[] = [];
  private privateBuf: PrivateMessage[] = [];
  /** Times of the messages sent in the last second. */
  private sendTimes: number[] = [];
  private stallLogged = 0;

  constructor(private readonly opts: BotOptions = {}) {
    this.done = new Promise((resolve) => { this.settle = resolve; });
  }

  /** This bot's id in the room (what fx and the state call it). Empty until it has joined. */
  get sessionId(): string {
    return this.room?.sessionId ?? "";
  }

  /** The tier and persona it plays (the persona may have been drawn from the seed); null before it has joined. */
  get tierId(): TierId | null {
    return this.brain ? this.tierPlayed : null;
  }

  get personaId(): PersonaId | null {
    return this.brain ? this.personaPlayed : null;
  }

  /** The map seed of the room it joined (0 before that). */
  get seed(): number {
    return this.room?.state?.seed ?? 0;
  }

  get stats(): BotStats {
    const s = this.brain?.stats;
    if (!s) return { ...NO_STATS };
    return { mobTargets: s.mobTargets, mobDrops: s.mobDrops, retreats: s.retreats, mobFocusMs: s.mobFocusMs, grabs: s.grabs, maxStallMs: s.maxStallMs };
  }

  /** Claims (or re-opens, given its token) the profile, joins a lobby and starts playing. */
  async connect(endpoint: string, profile: string, token?: string): Promise<void> {
    this.profile = profile;
    const base = endpoint.replace(/\/+$/, "").replace(/^ws/, "http");
    const res = await fetch(`${base}/api/profile/${encodeURIComponent(profile)}`, {
      headers: token ? { [PROFILE_TOKEN_HEADER]: token } : {},
    }).catch((err: Error) => {
      throw new Error(`cannot reach ${base} (${(err.cause as NodeJS.ErrnoException | undefined)?.code ?? err.message})`);
    });
    if (!res.ok) throw new Error(`profile "${profile}": HTTP ${res.status}${res.status === 403 ? " (taken by someone else, or the token is wrong)" : ""}`);
    const body = (await res.json()) as ProfileResponse;
    this.token = body.token;
    this.opts.onToken?.(body.token);

    const options: JoinOptions = { profile, token: body.token, ...(this.opts.faction ? { faction: this.opts.faction } : {}) };
    this.room = await this.join(base, options);
    this.roomId = this.room.roomId;
    const room = this.room;
    room.reconnection.enabled = false; // a bot that drops is simply done
    this.listen(room);
    for (let i = 0; !room.state?.players; i++) {
      if (i > 500) { void room.leave(true).catch(() => {}); throw new Error("no room state from the server"); }
      await sleep(10);
    }
    if (this.finished) return; // the room dropped us while we waited for its state: `run()` says why
    try {
      this.start(room, body.profile.gv);
    } catch (err) {
      void room.leave(true).catch(() => {});
      throw err;
    }
    this.timer = setTimeout(() => this.finish(null, "timed out"), this.opts.timeoutMs ?? 1_200_000);
  }

  /** Resolves once the run result arrived (or the bot failed); never rejects. */
  run(): Promise<BotRun> {
    return this.done;
  }

  private async join(base: string, options: JoinOptions): Promise<ClientRoom> {
    const client = new Client(base);
    // A seat reserved in the instant a run starts is refused; the next attempt lands in a fresh lobby.
    for (let attempt = 0; ; attempt++) {
      try {
        return await client.joinOrCreate<RaidState>(ROOM_NAME, options);
      } catch (err) {
        if (attempt >= 2 || !errText(err).includes("raid already started")) throw err;
      }
    }
  }

  /** Message and lifecycle handlers: registered at once, so nothing the server sends right behind the join is dropped. */
  private listen(room: ClientRoom): void {
    room.onMessage("result", (r: RunResult) => {
      this.resultsSeen++;
      this.log(`result: ${r.outcome} (place ${r.place}/${r.players}, +${r.gv.total} GV)`);
      this.finish(r);
    });
    room.onMessage("toast", (m: { text: string }) => {
      this.log(`toast: ${m.text}`);
      if (!this.finished) this.toastBuf.push(m.text);
    });
    // One batch per server step; the frame decodes it (perception) when the patch that goes with it has arrived.
    room.onMessage("fxs", (b: FxBatch) => {
      if (this.finished) return;
      this.fxBuf.push(b);
      if (!room.state?.roster) return;
      for (const fx of unpackFx(b, room.state.roster)) if (fx.kind === "teleport") { this.teleports++; this.log("teleported into the coliseum"); }
    });
    // Messages a later branch adds (a planning offer, a reveal) reach the brain untouched.
    room.onMessage("*", (type: string | number, msg: unknown) => {
      if (this.finished || this.privateBuf.length >= MAX_PRIVATES) return;
      this.privateBuf.push({ type: String(type), msg });
    });
    room.onStateChange(() => this.onPatch());
    room.onLeave((code) => { this.roomClosed = true; this.finish(null, `left the room unexpectedly (code ${code})`); });
    room.onError((code, msg) => this.finish(null, `room error ${code}: ${msg ?? ""}`));
  }

  /** Builds the brain and its runner for this room: the map, what the server can do, the tier and the persona. */
  private start(room: ClientRoom, gv: number): void {
    const map: GameMap = generateMap(room.state.seed);
    const selfId = room.sessionId;
    const features = detectFeatures({ state: room.state, player: room.state.players.get(selfId), map });
    const seed = this.opts.seed ?? hashName(this.profile);
    const tier = TIERS[this.opts.tier ?? "hard"];
    const persona = PERSONAS[this.opts.persona ?? PERSONA_IDS[Math.floor(mulberry32(seed ^ 0x9e3779b9)() * PERSONA_IDS.length)]!];
    const store = this.opts.statsFile ? statsStore(this.opts.statsFile) : null;
    this.store = store;

    const paths = createPathService(map, this.budget);
    const brain = createBrain({
      id: selfId, name: this.profile, tier, persona, seed, map, features,
      learned: store ? store.snapshot() : NO_BIAS,
      services: { paths, log: (msg) => this.log(msg) },
      modules: enabledModules(features),
    });
    const adapter: BotAdapter = {
      selfId,
      supports: (type: CommandType) => features.messageTypes.includes(type),
      send: (cmd) => this.sendCommand(cmd),
    };
    this.brain = brain;
    this.tierPlayed = tier.id;
    this.personaPlayed = persona.id;
    this.runner = createBotRunner({ brain, adapter, cfg: { selfDelayMs: 0, worldDelayMs: INTERP_DELAY_MS }, map, features, tier });
    this.log(`joined ${room.roomId} (${gv} GV) as ${tier.id} ${persona.id}, seed ${seed}`);
  }

  /** One state patch: the bot's frame. The brain times itself, so nothing else drives it. */
  private onPatch(): void {
    const runner = this.runner;
    if (!runner || this.finished) return;
    try {
      const s = this.room.state;
      if (this.opts.abandonAfterMs !== undefined && s.phase === "active" && s.players.get(this.room.sessionId)?.status === "alive"
        && s.serverTime - s.raidStartedAt >= this.opts.abandonAfterMs) {
        this.log("abandoning the run");
        this.abandoned = true;
        this.finish(null);
        return;
      }
      const input: PerceptionInput = {
        state: s,
        ...(this.fxBuf.length > 0 ? { fxs: this.fxBuf } : {}),
        ...(this.toastBuf.length > 0 ? { toasts: this.toastBuf } : {}),
        ...(this.privateBuf.length > 0 ? { privates: this.privateBuf } : {}),
      };
      this.fxBuf = [];
      this.toastBuf = [];
      this.privateBuf = [];
      this.budget.startTick();
      runner.frame(input);
      this.logStall();
    } catch (err) {
      this.finish(null, `brain crashed: ${err instanceof Error ? err.stack : err}`);
    }
  }

  /** The network adapter's send: now, through the SDK, under the message guard. False when refused. */
  private sendCommand(cmd: Command): boolean {
    const now = Date.now();
    while (this.sendTimes.length > 0 && now - this.sendTimes[0]! >= 1000) this.sendTimes.shift();
    if (this.finished || this.roomClosed || this.sendTimes.length >= MAX_SENDS_PER_SECOND) return false;
    this.sendTimes.push(now);
    if ((CLIENT_MESSAGE_TYPES as readonly string[]).includes(cmd.type)) this.sent[cmd.type as ClientMessageType]++;
    this.room.send(cmd.type, cmd.msg);
    return true;
  }

  private finish(result: RunResult | null, error?: string): void {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.timer);
    if (error) this.log(`stopped: ${error}`);
    this.endRun(result);
    const run: BotRun = { profile: this.profile, result };
    if (error) run.error = error;
    if (this.abandoned) run.abandoned = true;
    // A closed socket never answers a leave, which would cost the whole fallback wait below.
    if (this.roomClosed || !this.room?.connection?.isOpen) { this.settle(run); return; }
    let timer: NodeJS.Timeout | undefined;
    const bail = new Promise<void>((r) => { timer = setTimeout(r, 2000); });
    Promise.race([this.room.leave(true).catch(() => {}), bail]).finally(() => { clearTimeout(timer); this.settle(run); });
  }

  /** The run is over for the brain (result null: voided): the learning store takes its summary, if there is one. */
  private endRun(result: RunResult | null): void {
    if (this.ended || !this.runner) return;
    this.ended = true;
    try {
      const summary = this.runner.end(result);
      this.store?.record(summary);
      this.store?.flush();
    } catch (err) {
      this.log(`could not close the run: ${errText(err)}`);
    }
  }

  private log(msg: string): void {
    if (this.opts.verbose) console.log(`[${this.profile}] ${msg}`);
  }

  /** --verbose: a growing stall says what the brain was doing meanwhile. */
  private logStall(): void {
    if (!this.opts.verbose || !this.brain) return;
    const stall = this.brain.stats.maxStallMs;
    if (stall < this.stallLogged + STALL_LOG_STEP_MS) return;
    this.stallLogged = stall;
    const me = this.room.state.players.get(this.room.sessionId);
    this.log(`stood still for ${Math.round(stall)} ms: goal ${this.brain.goal.kind}, hp ${Math.round(me?.hp ?? 0)}, at ${Math.round(me?.x ?? 0)},${Math.round(me?.y ?? 0)}`);
  }
}
