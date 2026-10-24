// A headless player. It talks to the server the way the web client does: HTTP for the profile, then a
// Colyseus room where it reads synced state and sends inputs only (move, stop, aim, attack, release, swap, pickup).
// It never touches server internals; the map comes from the public seed. The brain is a hunt, re-evaluated every
// THINK_MS from the latest state: pick the foe, see where the snapshot buffer puts it, and let the shared weapon
// policy (decide) say where to walk, where to aim and whether the trigger is down. The foe is the nearest standing
// player, except that with no player close the bot farms the regional mobs first (mobHunt.ts decides who: it also drops
// a mob that cannot be hurt and runs from a fight it is losing). A weapon a mob dropped, or a chest's early in the run,
// is worth a detour when only one weapon is carried; the bot swaps slot to the better weapon edge against the foe's
// weapon. The arena (teleport, locked gates, sudden death) needs no handling: after the teleport there are no mobs in
// reach and the bot just keeps hunting players.
import { Client, type Room } from "@colyseus/sdk";
import {
  bestSlot, decide, findPath, generateMap, hasLineOfSight, INTERACT_RANGE, INTERP_DELAY_MS,
  isFactionId, isRanged, isRegionalKind, isWeaponId, PLAYER_RADIUS, PLAYER_SPEED, PROFILE_TOKEN_HEADER, ROOM_NAME, segmentClear,
  SnapshotBuffer, TICK_MS, TILE, unpackFx, withGates, wrapAngle,
  type ClientMessages, type ClientMessageType, type GameMap, type JoinOptions, type PolicyOutput,
  type FxBatch, type ProfileResponse, type RunResult, type Vec2, type WeaponId,
} from "@raid/shared";
import type { PlayerState, RaidState } from "@raid/shared/schema";
import { bestSlotVsMob, bowFullDraw, mobSpacing, mobWeapon, pathLength, retreatPoint, MobHunter, type HuntDecision } from "./mobHunt";

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
}

export interface BotRun {
  profile: string;
  /** Null when the bot never got one; `error` then says why (none when it abandoned on purpose). */
  result: RunResult | null;
  error?: string;
  /** The bot left on purpose (`abandonAfterMs`), so there is no result and nothing went wrong. */
  abandoned?: true;
}

/** A standing enemy and how far away it is. */
interface Enemy { id: string; p: PlayerState; d: number }

/** Whatever the bot is fighting this think, a player or a mob: where it is, how far, what it holds and where its snapshots live. */
interface Foe { key: string; at: Vec2; d: number; theirs: WeaponId | null; mob: boolean }

/** What the bot did, for the tests and `--verbose`. */
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
  /** The longest stretch (ms) the bot stood still without attacking, drawing or fetching anything while it was alive in a running raid. */
  maxStallMs: number;
}

/** Where the snapshot buffer puts a player at render time, and how fast it was moving over the last VEL_WINDOW_MS. */
interface View { x: number; y: number; vx: number; vy: number }

type Slots = readonly [WeaponId | null, WeaponId | null];

// A bow has to be released at its full draw, and the draw is 0.4-0.6 s, so the brain runs at the server's tick rate.
const THINK_MS = 50;
/** A chase is re-sent at most this often: the server paths from scratch each time and the target keeps moving. */
const REPLAN_MS = 250;
/** An unchanged goal is sent again after this long anyway (an unreachable click is ignored, which would leave us idle). */
const RESEND_MS = 1500;
/** The current target is kept unless another is this much nearer (as a share), so two near-equal enemies don't make it dither. */
const SWITCH_RATIO = 0.75;

/** Aim is streamed at most 10 Hz, only when it moved this much (rad)... */
const AIM_MS = 100;
const AIM_EPS = 0.03;
/** ...and re-sent after this long anyway: walking turns a fighter again once its aim goes stale (AIM_STALE_MS). */
const AIM_KEEPALIVE_MS = 700;
/** The target's velocity is the displacement over this long, ending at render time. */
const VEL_WINDOW_MS = 100;
/** A velocity beyond this many times PLAYER_SPEED is a teleport across the window, not a runner. */
const VEL_SANE = 1.25;
/** Never extrapolate a projectile's target further than this (ms). */
const MAX_LEAD_MS = 350;
/** Loose a bow this long after its full draw (s): the estimated server clock can run a little ahead of the real one. */
const RELEASE_MARGIN_S = 0.015;
/**
 * Swap weapons at most this often (ms; a random extra up to SWAP_JITTER_MS), never mid-draw, and only against an enemy this
 * close. Two bots answering each other's weapon (a rock-paper-scissors loop) would otherwise swap in lockstep forever.
 */
const SWAP_EVERY_MS = 2000;
const SWAP_JITTER_MS = 2000;
const SWAP_DISTANCE = 600;

/** A detour for a chest's weapon only happens this early in the run (server ms)... */
const GRAB_WINDOW_MS = 25_000;
/** ...for a weapon this close (straight line, roughly nine in ten spawns have one)... */
const GRAB_RADIUS = 8 * TILE;
/**
 * ...but a loose weapon on the ground (a mob's drop, or one lying about) is worth the walk at any time in the run, and a
 * bow kills from far off, so the drop can lie that far from where the bot stood.
 */
const DROP_RADIUS = 15 * TILE;
/** ...with no enemy this close, and no awake mob this close (it would chase the bot back and forth)... */
const GRAB_ENEMY_DISTANCE = 240;
const GRAB_MOB_DISTANCE = 220;
/** ...and is dropped for good once it has taken this long, so it can never stall the hunt. */
const GRAB_BUDGET_MS = 6_000;
const GRAB_MAX_FAILS = 2;
const PICKUP_RETRY_MS = 400;
/** Inside this distance of a container we start taking; keeps a margin under INTERACT_RANGE for stale positions. */
const PICKUP_DISTANCE = INTERACT_RANGE - 12;

/** Snapshots are kept for a mob only while it is this close (u): a target is picked within MOB_HUNT.reach (700). */
const MOB_VIEW_RADIUS = 1300;
/** A mob's snapshot-buffer key, so it can never collide with a player's session id. */
const mobKey = (id: string): string => `mob:${id}`;
/** A stall this long (ms) is logged with --verbose. */
const STALL_LOG_MS = 1500;
/** A player behind a wall threatens from this many times its straight-line distance. */
const BLOCKED_THREAT_FACTOR = 2;
/** The bot moved less than this (u) between two thinks counts as standing still... */
const STILL_EPS = 1;
/** ...and may stand this long (ms) doing nothing before the stall counter starts (a cooldown, a swap, a stopped draw). */
const STILL_GRACE_MS = 600;

const dist =(a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const asWeapon = (def: string): WeaponId | null => (isWeaponId(def) ? def : null);
const slotOf = (p: PlayerState): 0 | 1 => (p.slot === 1 ? 1 : 0);
const inHand = (p: PlayerState): WeaponId | null => asWeapon(slotOf(p) === 0 ? p.weapon0 : p.weapon1);

export class BotClient {
  roomId = "";
  token = "";
  /** `result` messages received while the bot was still in the room. A correct server sends exactly one. */
  resultsSeen = 0;
  /** `teleport` fx seen: how many times the arena moved everyone into the coliseum. */
  teleports = 0;
  /** Inputs sent so far, by message type. */
  readonly sent: Record<ClientMessageType, number> = { move: 0, stop: 0, aim: 0, attack: 0, release: 0, swap: 0, pickup: 0 };

  private profile = "";
  private room!: ClientRoom;
  private map!: GameMap;
  private finished = false;
  /** The socket is gone (left or errored): there is nothing to say goodbye to. */
  private roomClosed = false;
  private abandoned = false;
  private readonly done: Promise<BotRun>;
  private settle!: (run: BotRun) => void;
  private timers: NodeJS.Timeout[] = [];
  private readonly buffers = new Map<string, SnapshotBuffer>();
  /** Local clock at the latest state patch, to estimate the server's clock between patches. */
  private patchAt = 0;
  private readonly scratch = { x: 0, y: 0 };

  // Brain memory.
  private targetId: string | null = null;
  private dest: Vec2 | null = null;
  private moveSentAt = 0;
  /** We sent a stop to stand and fight; cleared by the next move. */
  private holding = false;
  /** What we believe the server thinks of our trigger (it repeats attacks while it is down). */
  private trigger = false;
  /** The bow draw (its `drawStartedAt`) we already released, so a draw still showing in the state isn't released twice. */
  private loosed = 0;
  private aimSent: { a: number; at: number } | null = null;
  private nextSwapAt = 0;
  /** The weapon detour in progress, if any. */
  private grab: { containerId: string; since: number; pickupSentAt: number; fails: number } | null = null;
  /** Containers whose weapon we gave up on. */
  private readonly grabSkipped = new Set<string>();
  private readonly hunter = new MobHunter(undefined, (msg) => this.log(msg));
  private grabs = 0;
  /** Stall watch: where we stood at the last think, since when we have stood there doing nothing, and the longest such stretch. */
  private lastPos: Vec2 = { x: NaN, y: NaN };
  private stillSince = 0;
  private maxStall = 0;
  private stallLoggedAt = 0;
  /** What the last think decided, for the log. */
  private lastHunt = "";

  constructor(private readonly opts: BotOptions = {}) {
    this.done = new Promise((resolve) => { this.settle = resolve; });
  }

  /** This bot's id in the room (what fx and the state call it). Empty until it has joined. */
  get sessionId(): string {
    return this.room?.sessionId ?? "";
  }

  /** The map seed of the room it joined (0 before that). */
  get seed(): number {
    return this.room?.state?.seed ?? 0;
  }

  get stats(): BotStats {
    const h = this.hunter.stats;
    return {
      mobTargets: h.targets, mobDrops: h.drops, retreats: h.retreats, mobFocusMs: h.focusMs, grabs: this.grabs, maxStallMs: this.maxStall,
    };
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

    const options: JoinOptions = { profile, token: body.token };
    this.room = await this.join(base, options);
    this.roomId = this.room.roomId;
    const room = this.room;
    for (let i = 0; !room.state?.players; i++) {
      if (i > 500) { void room.leave(true).catch(() => {}); throw new Error("no room state from the server"); }
      await sleep(10);
    }
    this.map = generateMap(room.state.seed);
    this.log(`joined ${room.roomId} (${body.profile.gv} GV)`);

    room.reconnection.enabled = false; // a bot that drops is simply done
    room.onMessage("result", (r: RunResult) => { this.resultsSeen++; this.log(`result: ${r.outcome} (place ${r.place}/${r.players}, +${r.gv.total} GV)`); this.finish(r); });
    room.onMessage("toast", (m: { text: string }) => this.onToast(m.text));
    room.onMessage("fxs", (b: FxBatch) => { for (const fx of unpackFx(b)) if (fx.kind === "teleport") { this.teleports++; this.onTeleport(); } });
    room.onStateChange((s) => {
      this.patchAt = Date.now();
      for (const [id, p] of s.players) {
        let buf = this.buffers.get(id);
        if (!buf) this.buffers.set(id, (buf = new SnapshotBuffer()));
        buf.push(s.serverTime, p.x, p.y);
      }
      this.bufferMobs(s);
    });
    room.onLeave((code) => { this.roomClosed = true; this.finish(null, `left the room unexpectedly (code ${code})`); });
    room.onError((code, msg) => this.finish(null, `room error ${code}: ${msg ?? ""}`));
    this.timers.push(
      setInterval(() => {
        try { this.think(); } catch (err) { this.finish(null, `brain crashed: ${err instanceof Error ? err.stack : err}`); }
      }, THINK_MS),
      setTimeout(() => this.finish(null, "timed out"), this.opts.timeoutMs ?? 1_200_000),
    );
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

  private finish(result: RunResult | null, error?: string): void {
    if (this.finished) return;
    this.finished = true;
    for (const t of this.timers) { clearInterval(t); clearTimeout(t); }
    if (error) this.log(`stopped: ${error}`);
    const run: BotRun = { profile: this.profile, result };
    if (error) run.error = error;
    if (this.abandoned) run.abandoned = true;
    // A closed socket never answers a leave, which would cost the whole fallback wait below.
    if (this.roomClosed || !this.room?.connection?.isOpen) { this.settle(run); return; }
    let timer: NodeJS.Timeout | undefined;
    const bail = new Promise<void>((r) => { timer = setTimeout(r, 2000); });
    Promise.race([this.room.leave(true).catch(() => {}), bail]).finally(() => { clearTimeout(timer); this.settle(run); });
  }

  private log(msg: string): void {
    if (this.opts.verbose) console.log(`[${this.profile}] ${msg}`);
  }

  private send<K extends ClientMessageType>(type: K, payload: ClientMessages[K]): void {
    this.sent[type]++;
    this.room.send(type, payload);
  }

  /** The refusals a pickup can get; a refused detour is retried once or twice, then given up on. */
  private onToast(text: string): void {
    this.log(`toast: ${text}`);
    const g = this.grab;
    if (!g) return;
    if (text === "Nothing there" || text === "Nothing to take") g.fails = GRAB_MAX_FAILS; // gone or empty: retrying is pointless
    else if (text === "Too far away" || text === "Can't reach that") g.fails++;
  }

  /**
   * The server clears our path and queued inputs when it teleports us, and our trigger with them: forget what we told it.
   * An attack sent within one RTT before this fx arrived lands after the clear and re-arms the trigger, so a trigger we
   * think is down is released again; the brain presses it anew when its policy says so.
   */
  private onTeleport(): void {
    this.log("teleported into the coliseum");
    this.dest = null;
    this.moveSentAt = 0;
    this.holding = false;
    this.stopTrigger();
    this.loosed = 0;
    this.aimSent = null;
    this.grab = null;
  }

  // ------------------------------------------------------------------ brain
  private think(): void {
    const s = this.room.state;
    const me = s.players.get(this.room.sessionId);
    if (this.finished || s.phase !== "active" || me?.status !== "alive") return;
    if (this.opts.abandonAfterMs !== undefined && s.serverTime - s.raidStartedAt >= this.opts.abandonAfterMs) {
      this.log("abandoning the run");
      this.abandoned = true;
      this.finish(null);
      return;
    }
    const now = Date.now();
    this.watchStall(me, now);
    const enemy = this.pickEnemy(me);
    const hunt = this.huntMobs(me, enemy, now);
    this.logHunt(hunt);
    if (hunt.kind === "retreat" && this.retreat(me, hunt, now)) return;
    const mob = hunt.kind === "mob" ? this.mobFoe(me, hunt.id) : null;
    if (this.grabWeapon(me, now, enemy?.d ?? Infinity)) return;
    if (mob) this.fight(me, mob, now);
    else if (enemy) this.fight(me, { key: enemy.id, at: enemy.p, d: enemy.d, theirs: inHand(enemy.p), mob: false }, now);
    else this.stand();
  }

  /** Counts how long the bot has stood still doing nothing in a running raid: the longest such stretch is `stats.maxStallMs`. */
  private watchStall(me: PlayerState, now: number): void {
    const busy = this.trigger || me.drawStartedAt > 0 || this.grab !== null;
    if (this.stillSince === 0 || busy || !(dist(me, this.lastPos) < STILL_EPS)) this.stillSince = now;
    this.lastPos = { x: me.x, y: me.y };
    const stalled = now - this.stillSince - STILL_GRACE_MS;
    this.maxStall = Math.max(this.maxStall, stalled);
    if (stalled > STALL_LOG_MS && this.opts.verbose && now - this.stallLoggedAt > STALL_LOG_MS) {
      this.stallLoggedAt = now;
      this.log(`standing still for ${Math.round(stalled)} ms: ${this.lastHunt}, hp ${Math.round(me.hp)}, dest ${this.dest ? `${Math.round(this.dest.x)},${Math.round(this.dest.y)}` : "none"}, holding ${this.holding}, slot ${me.slot} (${me.weapon0}/${me.weapon1})`);
    }
  }

  /**
   * Who to fight: the mob hunt's call (mobHunt.ts) from the room as the bot sees it. Mobs are only for the bot that has no
   * player near it; the decision never leaves the bot without a foe it could fight (the player hunt is the fallback).
   */
  private huntMobs(me: PlayerState, enemy: Enemy | null, now: number): HuntDecision {
    const s = this.room.state;
    const players = this.standingPlayers();
    return this.hunter.decide({
      now,
      self: {
        faction: isFactionId(me.faction) ? me.faction : null,
        x: me.x, y: me.y, hp: me.hp, maxHp: me.maxHp, weapons: [asWeapon(me.weapon0), asWeapon(me.weapon1)],
        stacks: me.stacksHp + me.stacksAs + me.stacksMs, mobKills: me.mobKills,
      },
      playerDistance: enemy ? this.threatDistance(me, players) : Infinity,
      players,
      inColiseum: s.inColiseum,
      mobs: s.mobs,
      walk: (to) => this.walkDistance(me, to),
      attacking: this.trigger,
    });
  }

  /** Where the other standing players are. */
  private standingPlayers(): Vec2[] {
    const out: Vec2[] = [];
    for (const [id, p] of this.room.state.players) if (id !== this.room.sessionId && p.status === "alive") out.push({ x: p.x, y: p.y });
    return out;
  }

  /**
   * How far the nearest standing player is for the purpose of deciding whether it threatens us: a player behind a wall counts as
   * twice as far (spawns near each other are screened to have no line of sight, so two bots that start 200 u apart still farm).
   */
  private threatDistance(me: Vec2, players: readonly Vec2[]): number {
    const map = this.collision();
    let best = Infinity;
    for (const p of players) {
      const d = dist(me, p);
      best = Math.min(best, hasLineOfSight(map, me, p) ? d : d * BLOCKED_THREAT_FACTOR);
    }
    return best;
  }

  /** The map the server walks and shoots on: the gates are walls from the first teleport to the end of the run. */
  private collision(): GameMap {
    return this.room.state.gatesLocked ? withGates(this.map) : this.map;
  }

  /** Length of the walk from `from` to `to`, or null when the server's pathfinder finds none. */
  private walkDistance(from: Vec2, to: Vec2): number | null {
    const path = findPath(this.collision(), from, to);
    return path.length === 0 ? null : pathLength(from, path);
  }

  /** The mob `id` as a foe, or null when it is gone. */
  private mobFoe(me: Vec2, id: string): Foe | null {
    const m = this.room.state.mobs.get(id);
    if (!m || m.status !== "alive") return null;
    return { key: mobKey(id), at: m, d: dist(me, m), theirs: mobWeapon(m), mob: true };
  }

  /** Keeps a snapshot buffer for every mob within MOB_VIEW_RADIUS, so a mob target can be aimed at and led like a player. */
  private bufferMobs(s: RaidState): void {
    const me = s.players.get(this.room.sessionId);
    if (!me) return;
    for (const [id, m] of s.mobs) {
      const key = mobKey(id);
      if (m.status !== "alive" || !isRegionalKind(m.kind) || dist(me, m) > MOB_VIEW_RADIUS) {
        this.buffers.delete(key);
        continue;
      }
      let buf = this.buffers.get(key);
      if (!buf) this.buffers.set(key, (buf = new SnapshotBuffer()));
      buf.push(s.serverTime, m.x, m.y);
    }
  }

  private logHunt(hunt: HuntDecision): void {
    const what = hunt.kind === "mob" ? `going for mob ${hunt.id} (${hunt.why})` : `${hunt.kind} (${hunt.why})`;
    if (what !== this.lastHunt) this.log(what);
    this.lastHunt = what;
  }

  /** Low hp in a mob fight: stop shooting and walk away from the awake mobs and the players. False when there is nowhere to go (cornered): fight on. */
  private retreat(me: PlayerState, hunt: Extract<HuntDecision, { kind: "retreat" }>, now: number): boolean {
    const map = this.collision();
    const to = retreatPoint(me, hunt.from, (a, b) => segmentClear(map, a, b, PLAYER_RADIUS));
    if (!to) return false;
    this.grab = null;
    this.stopTrigger();
    this.moveTo(to, now);
    return true;
  }

  /** The nearest standing enemy, sticking with the current target unless another is clearly nearer. */
  private pickEnemy(me: PlayerState): Enemy | null {
    let best: Enemy | null = null;
    let current: Enemy | null = null;
    for (const [id, p] of this.room.state.players) {
      if (id === this.room.sessionId || p.status !== "alive") continue;
      const e = { id, p, d: dist(me, p) };
      if (!best || e.d < best.d) best = e;
      if (id === this.targetId) current = e;
    }
    const pick = current && best && best.d >= current.d * SWITCH_RATIO ? current : best;
    this.targetId = pick?.id ?? null;
    return pick;
  }

  /** The server clock now: the latest patch plus the time since it arrived (at most two ticks, so a stalled stream can't run away). */
  private serverNow(): number {
    return this.room.state.serverTime + Math.min(Date.now() - this.patchAt, 2 * TICK_MS);
  }

  /** Where `id` was at render time and its velocity then, from the buffered snapshots; null before it has any. */
  private view(id: string, renderT: number): View | null {
    const buf = this.buffers.get(id);
    const at = this.scratch;
    // The older sample first: sampling drops what is older than the bracket it finds.
    if (!buf?.sample(renderT - VEL_WINDOW_MS, at)) return null;
    const x0 = at.x;
    const y0 = at.y;
    buf.sample(renderT, at);
    let vx = ((at.x - x0) * 1000) / VEL_WINDOW_MS;
    let vy = ((at.y - y0) * 1000) / VEL_WINDOW_MS;
    if (Math.hypot(vx, vy) > PLAYER_SPEED * VEL_SANE) { vx = 0; vy = 0; }
    return { x: at.x, y: at.y, vx, vy };
  }

  /**
   * Fights `foe` (a player or a mob; the server treats both the same) with the weapon in hand: the policy decides where to
   * walk, where to aim and whether the trigger is down. Every aim is measured from where the buffered snapshots put us at
   * render time and carries that time as `t`: the server swings melee from there and looses projectiles from there too. A
   * projectile flies in present server time, so the target is led to where it will be about when the shot is loosed.
   */
  private fight(me: PlayerState, foe: Foe, now: number): void {
    const s = this.room.state;
    const slots: Slots = [asWeapon(me.weapon0), asWeapon(me.weapon1)];
    const weapon = slots[slotOf(me)];
    if (this.swap(me, slots, foe.theirs, foe.mob, foe.d, now)) return;
    if (!weapon || !isFactionId(me.faction)) { this.stand(); return; }

    const renderT = s.serverTime - INTERP_DELAY_MS;
    const serverNow = this.serverNow();
    const ranged = isRanged(weapon);
    const seen = this.view(foe.key, renderT);
    const seenSelf = this.view(this.room.sessionId, renderT);
    const self = seenSelf ?? { x: me.x, y: me.y };
    let target: Vec2 = seen ?? foe.at;
    const targetVel: Vec2 = seen ? { x: seen.vx, y: seen.vy } : { x: 0, y: 0 };
    if (seen && ranged) {
      const lead = Math.min(MAX_LEAD_MS, serverNow - renderT + TICK_MS / 2) / 1000;
      target = { x: seen.x + seen.vx * lead, y: seen.y + seen.vy * lead };
    }
    const drawn = me.drawStartedAt > 0 ? Math.max(1e-3, (serverNow - me.drawStartedAt) / 1000) : 0;
    const out = decide({
      self, target, targetVel,
      los: hasLineOfSight(this.collision(), self, target),
      weapon,
      ...(foe.mob ? { spacing: mobSpacing(weapon, foe.theirs) } : {}),
      ready: serverNow >= me.readyAt,
      drawSeconds: drawn,
      // Attack-speed stacks shorten the bow's draw: holding for the unbuffed draw would over-hold every shot.
      fullDraw: bowFullDraw(me.faction, me.stacksAs) + RELEASE_MARGIN_S,
    });

    if (out.move === "stop") this.hold();
    else if (out.move) this.moveTo(out.move, now);
    this.aim(out.aim, now);
    this.pull(out, me, weapon, renderT, now);
  }

  /** Swaps to the slot with the better weapon edge against the foe's weapon (against a mob, one that works on it); true when it did. Never mid-draw. */
  private swap(me: PlayerState, slots: Slots, theirs: WeaponId | null, mob: boolean, d: number, now: number): boolean {
    if (d > SWAP_DISTANCE || now < this.nextSwapAt || me.drawStartedAt > 0) return false;
    const slot = slotOf(me);
    const want = mob ? bestSlotVsMob(slots, slot, theirs) : bestSlot(slots, slot, theirs);
    if (want === slot) return false;
    this.log(`swapping ${slots[slot]} for ${slots[want]} against ${theirs}`);
    this.send("swap", { slot: want });
    this.nextSwapAt = now + SWAP_EVERY_MS + Math.random() * SWAP_JITTER_MS;
    return true;
  }

  /** Streams the aim: at most 10 Hz, when it moved, and now and then regardless. */
  private aim(a: number, now: number): void {
    const last = this.aimSent;
    if (last && now - last.at < AIM_MS) return;
    if (last && Math.abs(wrapAngle(a - last.a)) < AIM_EPS && now - last.at < AIM_KEEPALIVE_MS) return;
    this.send("aim", { a });
    this.aimSent = { a, at: now };
  }

  /**
   * Turns the policy's trigger into inputs: `attack` when the hold turns on (the server repeats it while held),
   * `release` when it turns off, and for the bow a `release` at the full draw, followed at once by a fresh press so the
   * next draw starts the moment the cooldown allows.
   */
  private pull(out: PolicyOutput, me: PlayerState, weapon: WeaponId, renderT: number, now: number): void {
    const msg = { a: out.aim, t: renderT };
    if (weapon === "bow" && out.release && me.drawStartedAt > 0 && me.drawStartedAt !== this.loosed) {
      this.send("release", msg);
      this.loosed = me.drawStartedAt;
      this.trigger = false;
      this.aimSent = { a: out.aim, at: now };
    }
    if (out.hold && !this.trigger) {
      this.send("attack", msg);
      this.trigger = true;
      this.aimSent = { a: out.aim, at: now };
    } else if (!out.hold && this.trigger) {
      this.send("release", msg);
      this.trigger = false;
      this.aimSent = { a: out.aim, at: now };
    }
  }

  /**
   * With one weapon carried, a detour for a weapon lying about: a chest's early in the run, or a loose one (a mob's drop)
   * at any time. True while it is going for one (the hunt waits). It is bounded in time, distance and tries, so it can
   * never stall the hunt, and it waits while an enemy or an awake mob is close.
   */
  private grabWeapon(me: PlayerState, now: number, enemyD: number): boolean {
    const s = this.room.state;
    const carried = (me.weapon0 !== "" ? 1 : 0) + (me.weapon1 !== "" ? 1 : 0);
    if (carried === 2 && this.grab) this.grabs++; // the detour worked
    if (carried !== 1 || s.inColiseum || enemyD < GRAB_ENEMY_DISTANCE || this.hunter.awakeNear(me, GRAB_MOB_DISTANCE, now).length > 0) {
      this.grab = null;
      return false;
    }
    let g = this.grab;
    if (g && (!this.holdsWeapon(g.containerId) || now - g.since > GRAB_BUDGET_MS || g.fails >= GRAB_MAX_FAILS)) {
      this.grabSkipped.add(g.containerId);
      g = this.grab = null;
    }
    if (!g) {
      const found = this.findWeapon(me, s.serverTime - s.raidStartedAt <= GRAB_WINDOW_MS);
      if (!found) return false;
      g = this.grab = { containerId: found, since: now, pickupSentAt: 0, fails: 0 };
      this.log(`going for a weapon in ${found}`);
    }
    this.stopTrigger();
    const c = s.containers.get(g.containerId)!;
    const map = this.collision();
    if (dist(me, c) > PICKUP_DISTANCE || !hasLineOfSight(map, me, c)) {
      this.moveTo(c, now);
    } else if (!this.holding) {
      this.hold(); // let the position settle before asking: a pickup from a stale position is refused as too far
    } else if (now - g.pickupSentAt >= PICKUP_RETRY_MS) {
      this.send("pickup", { containerId: c.id });
      g.pickupSentAt = now;
    }
    return true;
  }

  /** The weapon a container still offers (the first item, which is what a pickup takes), or null. */
  private weaponIn(containerId: string): WeaponId | null {
    const c = this.room.state.containers.get(containerId);
    if (!c) return null;
    for (const item of c.items) return asWeapon(item.def);
    return null;
  }

  private holdsWeapon(containerId: string): boolean {
    return this.weaponIn(containerId) !== null;
  }

  /**
   * The nearest container holding a weapon other than the one carried: a loose weapon within DROP_RADIUS at any time, a chest
   * or a body within GRAB_RADIUS while the run is `early`.
   */
  private findWeapon(me: PlayerState, early: boolean): string | null {
    const have = asWeapon(me.weapon0) ?? asWeapon(me.weapon1);
    let best: string | null = null;
    let bestD = Infinity;
    const others = this.standingPlayers();
    this.room.state.containers.forEach((c) => {
      const d = dist(me, c);
      const reach = c.kind === "ground" ? DROP_RADIUS : early ? GRAB_RADIUS : 0;
      if (d >= reach || d >= bestD || this.grabSkipped.has(c.id)) return;
      if (others.some((p) => dist(p, c) < d)) return; // somebody else is nearer to it: they get there first, and we would meet over it
      const w = this.weaponIn(c.id);
      if (w !== null && w !== have) { best = c.id; bestD = d; }
    });
    return best;
  }

  /** Walks at `goal`: re-sent at most every REPLAN_MS, and only when the goal has moved (or after RESEND_MS). */
  private moveTo(goal: Vec2, now: number): void {
    this.holding = false;
    const since = now - this.moveSentAt;
    if (since < REPLAN_MS || (this.dest && dist(this.dest, goal) < 6 && since < RESEND_MS)) return;
    this.send("move", { x: goal.x, y: goal.y });
    this.dest = { x: goal.x, y: goal.y };
    this.moveSentAt = now;
  }

  /** Stands still (once per halt): a bot walking into its target would only run past it. */
  private hold(): void {
    if (this.holding) return;
    this.holding = true;
    this.dest = null;
    this.send("stop", {});
  }

  /** Trigger up, if it is down (nothing to fight, or busy with something else). */
  private stopTrigger(): void {
    if (!this.trigger) return;
    this.trigger = false;
    this.send("release", { a: this.aimSent?.a ?? 0 });
  }

  private stand(): void {
    this.hold();
    this.stopTrigger();
  }
}
