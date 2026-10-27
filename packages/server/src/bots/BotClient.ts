// A headless player. It talks to the server the way the web client does: HTTP for the profile, then a
// Colyseus room where it reads synced state and sends inputs only (move, stop, target, swap, pickup, cast). It never touches
// server internals; the map comes from the public seed. The brain is a hunt, re-evaluated every THINK_MS from the latest
// state: pick the foe, and play it like a human with the LoL-style controls: click it (`target`) once it is within the
// server's reach (TARGET_RANGE), and let the server chase it, attack it and aim at it until the lock ends; walk (`move`)
// to get it that close, to fetch a weapon or to run. The foe is the nearest standing player, except that with no player
// close the bot farms the regional mobs first (mobHunt.ts decides who: it also drops a mob that cannot be hurt and runs
// from a fight it is losing). A weapon a mob dropped, or a chest's early in the run, is worth a detour when only one
// weapon is carried; the bot swaps slot to the better weapon edge against the foe's weapon. It casts its faction's Wish by the
// intent tags of the ability (abilityPolicy.ts) once it is ready, and never picks a player it cannot target (hidden). It joins asking for a faction
// when told to (`faction`), and a pursuit loop between players (three bots on a ring, each chasing the one ahead) is
// broken by turning on someone else for a while (ORBIT_*). The arena (teleport, locked gates, sudden death) needs no
// handling: after the teleport there are no mobs in reach and the bot just keeps hunting players. When the server plans
// (phase "planning"), it picks the better of its two dealt spawns for farming from its private `plan` message and presses ready.
import { Client, type Room } from "@colyseus/sdk";
import {
  abilityInSlot, bestSlot, buffPower, buildGameMap, rankOf, EFFECT_CASTING, EFFECT_HIDDEN, EFFECT_UNTARGETABLE, findPath,
  hasLineOfSight, INTERACT_RANGE, isFactionId, isWeaponId, lockSpacing, MASK_MOVE, PLAYER_RADIUS,
  PROFILE_TOKEN_HEADER, reachMask, ROOM_NAME, segmentClear, TARGET_RANGE, TILE, unpackFx, withGates,
  type ClientMessages, type ClientMessageType, type FactionId, type FxBatch, type GameMap, type JoinOptions,
  type PlanMessage, type ProfileResponse, type RunResult, type TimedFx, type Vec2, type WeaponId,
} from "@raid/shared";
import type { PlayerState, RaidState } from "@raid/shared/schema";
import { decideCast, hidesCaster, type CastSituation } from "./abilityPolicy";
import { bestSlotVsMob, mobWeapon, pathLength, planPick, retreatPoint, MobHunter, type HuntDecision } from "./mobHunt";

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

/** Whatever the bot is fighting this think, a player or a mob: its id in the room (what `target` and `attackTarget` name), where it is, how far, what it holds. */
interface Foe { id: string; at: Vec2; d: number; theirs: WeaponId | null; mob: boolean }

/** The last `target` order sent, to be re-sent only when the server has not taken it (a refused order changes nothing in the state). */
interface Order { id: string; at: number; tries: number; walkUntil: number }

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
  /** The longest stretch (ms) the bot stood still without attacking or fetching anything while it was alive in a running raid. */
  maxStallMs: number;
}

type Slots = readonly [WeaponId | null, WeaponId | null];

const THINK_MS = 50;
/** A walk is re-sent at most this often: the server paths from scratch each time and the goal keeps moving. */
const REPLAN_MS = 250;
/** An unchanged goal is sent again after this long anyway (an unreachable click is ignored, which would leave us idle). */
const RESEND_MS = 1500;
/** The current target is kept unless another is this much nearer (as a share), so two near-equal enemies don't make it dither. */
const SWITCH_RATIO = 0.75;

/** A `target` the server has not taken is sent again no sooner than this (ms): a refused order leaves no trace in the state. */
const TARGET_RESEND_MS = 300;
/** After this many orders in a row that did not take (a foe walking home, out of reach by the time they arrived), walk to the foe for... */
const TARGET_TRIES = 3;
/** ...this long (ms), then click it again. */
const REFUSED_WALK_MS = 1000;
/** The server takes a lock within TARGET_RANGE; the bot clicks only this much (u) inside it, since what it sees is a patch old. */
const LOCK_MARGIN = 40;
/** The foe counts as being attacked while the bot is locked on it, can see it and is this much (u) past its weapon's attack range at most. */
const ATTACK_SLACK = 24;
/**
 * Swap weapons at most this often (ms; a random extra up to SWAP_JITTER_MS), never mid-draw, and only against an enemy this
 * close. Two bots answering each other's weapon (a rock-paper-scissors loop) would otherwise swap in lockstep forever.
 */
const SWAP_EVERY_MS = 2000;
const SWAP_JITTER_MS = 2000;
const SWAP_DISTANCE = 600;

/**
 * A chase that has not got ORBIT_PROGRESS closer to its target for ORBIT_MS (plus up to ORBIT_JITTER_MS, so the bots do not
 * all turn at once) is a pursuit loop: three bots on a ring, each running after the one ahead at the same speed, never
 * meet. The bot then goes for another enemy and leaves that one alone for ORBIT_AVOID_MS, unless it comes within
 * ORBIT_MIN_DISTANCE or hits us (it is attacking us then, not circling). Within ORBIT_MIN_DISTANCE, or while it is in
 * reach of the foe it has locked, it is a fight, not a chase.
 */
export const ORBIT_MS = 3000;
export const ORBIT_JITTER_MS = 1500;
const ORBIT_PROGRESS = 40;
export const ORBIT_MIN_DISTANCE = 150;
const ORBIT_AVOID_MS = 6000;

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

/** Planning: with no `plan` message this long (ms) into the phase, the bot just says it is ready (the server picks for it). */
const PLAN_WAIT_MS = 1000;
/** A spawn pick the server has not confirmed (the message still shows no pick) is sent again after this long (ms). */
const PLAN_RESEND_MS = 400;

/** A Wish is tried at most this often (ms): a refused or fizzled cast costs nothing, so it is simply asked again. */
const WISH_TRY_MS = 1000;
/**
 * After a Wish that hides its caster is sent (Swarm), the bot slips away instead of fighting for the cast's own time plus this (ms), so
 * a cast the server refused frees it soon. Its own knowledge, not the synced bit: the bit only shows once the cast has landed, and a
 * lock sent in that window would start the landing tick's auto-attack and reveal it at once.
 */
const ESCAPE_GRACE_MS = 300;
/** A hit on the bot this recent (ms) is "being hit" for the Wish's escape and sustain rules. */
const RECENT_HIT_MS = 1500;

/** A player the server will let anyone lock: not hidden (Swarm) and not untargetable. Clients and bots read the same synced bits. */
const targetableBits = (effects: number): boolean => (effects & (EFFECT_HIDDEN | EFFECT_UNTARGETABLE)) === 0;

/** A stall this long (ms) is logged with --verbose. */
const STALL_LOG_MS = 1500;
/** A player behind a wall threatens from this many times its straight-line distance. */
const BLOCKED_THREAT_FACTOR = 2;
/** The bot moved less than this (u) between two thinks counts as standing still... */
const STILL_EPS = 1;
/** ...and may stand this long (ms) doing nothing before the stall counter starts (a cooldown, a swap, a windup). */
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
  readonly sent: Record<ClientMessageType, number> = { move: 0, stop: 0, target: 0, aim: 0, attack: 0, release: 0, swap: 0, pickup: 0, plan: 0, cast: 0 };

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

  // Brain memory.
  private targetId: string | null = null;
  /** The chase being timed for the orbit breaker: the closest we have been to the target, and since when. */
  private chase: { id: string; best: number; since: number; limit: number } | null = null;
  /** The enemy a pursuit loop made us give up on, until `avoidUntil`. */
  private avoidId: string | null = null;
  private avoidUntil = 0;
  private dest: Vec2 | null = null;
  private moveSentAt = 0;
  /** We sent a stop to stand still; cleared by the next move or lock. */
  private holding = false;
  /** The foe is in reach of the weapon and locked: the server is swinging or shooting at it (the stall and orbit watches' "fighting"). */
  private attacking = false;
  /** The last `target` sent, until the server's `attackTarget` shows it took it. */
  private order: Order | null = null;
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
  /** When a hit fx last showed a player (not a mob; a player's damage-over-time hit counts too) hurting us: the hunt's "being shot at" evidence. */
  private playerHitAt = -Infinity;
  /** Planning: the latest private deal, the spawn option asked for and when, when the phase was first seen, and the latch. */
  private plan: PlanMessage | null = null;
  /** `plan` messages received (the tests read it: the server deals every player). */
  plansSeen = 0;
  private planAsked: { k: 0 | 1; at: number } | null = null;
  private planSeenAt = 0;
  private readySent = false;
  /** When anyone (a mob, a burn) last hurt us, and when we last asked for our Wish. */
  private hitAt = -Infinity;
  private wishTriedAt = -Infinity;
  /** A Wish that hides its caster was sent: the bot slips away (never locks anyone) until this time, or while the server shows the cast or the hiding. */
  private escaping = false;
  private escapeUntil = -Infinity;
  /** The foe the bot fought this think (the Wish aims at it), if any. */
  private foe: Foe | null = null;

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

    const options: JoinOptions = { profile, token: body.token, ...(this.opts.faction ? { faction: this.opts.faction } : {}) };
    this.room = await this.join(base, options);
    this.roomId = this.room.roomId;
    const room = this.room;
    // Before anything is awaited: the last player in starts the planning phase, and its deal can beat the first state.
    room.onMessage("plan", (m: PlanMessage) => { this.plansSeen++; this.plan = m; });
    for (let i = 0; !room.state?.players; i++) {
      if (i > 500) { void room.leave(true).catch(() => {}); throw new Error("no room state from the server"); }
      await sleep(10);
    }
    this.map = buildGameMap(room.state.seed);
    this.log(`joined ${room.roomId} (${body.profile.gv} GV)`);

    room.reconnection.enabled = false; // a bot that drops is simply done
    room.onMessage("result", (r: RunResult) => { this.resultsSeen++; this.log(`result: ${r.outcome} (place ${r.place}/${r.players}, +${r.gv.total} GV)`); this.finish(r); });
    room.onMessage("toast", (m: { text: string }) => this.onToast(m.text));
    // One batch per server step (the old per-fx message is gone).
    room.onMessage("fxs", (b: FxBatch) => { for (const fx of unpackFx(b, room.state.roster)) this.onFx(fx); });
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

  private onFx(fx: TimedFx): void {
    if (fx.kind === "teleport") { this.teleports++; this.onTeleport(); return; }
    // An enemy we gave up chasing that now lands (or fails to land) a blow on us is no longer circling: fight back.
    if ((fx.kind === "hit" || fx.kind === "block") && fx.id === this.room.sessionId && fx.by !== null && fx.by === this.avoidId) {
      this.avoidId = null;
    }
    if (fx.kind === "hit" && fx.id === this.room.sessionId && fx.by !== null && fx.by !== fx.id && this.room.state.players.has(fx.by)) {
      this.playerHitAt = Date.now();
    }
    if (fx.kind === "hit" && fx.id === this.room.sessionId && fx.by !== fx.id) this.hitAt = Date.now();
  }

  /** The server clears our path, queued inputs and lock when it teleports us: forget what we told it, and lock on again when the hunt says so. */
  private onTeleport(): void {
    this.log("teleported into the coliseum");
    this.dest = null;
    this.moveSentAt = 0;
    this.holding = false;
    this.attacking = false;
    this.order = null;
    this.grab = null;
    this.chase = null;
    this.avoidId = null;
  }

  // ------------------------------------------------------------------ brain
  private think(): void {
    const s = this.room.state;
    const me = s.players.get(this.room.sessionId);
    if (!this.finished && s.phase === "planning" && me) { this.planStart(me, Date.now()); return; }
    if (this.finished || s.phase !== "active" || me?.status !== "alive") return;
    if (this.opts.abandonAfterMs !== undefined && s.serverTime - s.raidStartedAt >= this.opts.abandonAfterMs) {
      this.log("abandoning the run");
      this.abandoned = true;
      this.finish(null);
      return;
    }
    const now = Date.now();
    this.watchStall(me, now);
    const enemy = this.pickEnemy(me, now);
    const hunt = this.huntMobs(me, enemy, now);
    this.logHunt(hunt);
    this.foe = null;
    // Hiding (it cast Swarm to get away, or is casting it): fighting on would reveal it with the next swing, so it slips away instead.
    this.attacking = this.slipping(me, now) ? this.slipAway(me, enemy, now) : this.act(me, enemy, hunt, now);
    this.castWish(me, enemy, now);
  }

  /** Is the bot hidden, or has it sent a hiding Wish that is still casting (by its own clock or the server's bit)? Then it does not fight. */
  private slipping(me: PlayerState, now: number): boolean {
    if ((me.effects & EFFECT_HIDDEN) !== 0) return true;
    if (!this.escaping) return false;
    if ((me.effects & EFFECT_CASTING) !== 0 || now < this.escapeUntil) return true;
    this.escaping = false;
    return false;
  }

  /** Walks away from the nearest player, or stands when there is none or nowhere to go; never attacks. False: not attacking. */
  private slipAway(me: PlayerState, enemy: Enemy | null, now: number): boolean {
    const map = this.collision();
    const to = enemy ? retreatPoint(me, [enemy.p], (a, b) => segmentClear(map, a, b, PLAYER_RADIUS)) : null;
    this.grab = null;
    if (to) this.moveTo(to, now);
    else this.stand();
    return false;
  }

  /**
   * Asks for the faction's Wish when the policy (abilityPolicy.ts, by the ability's intent tags) says so: only once it is ready
   * (the server's clock against the synced ready time), at most every WISH_TRY_MS. The server validates everything again.
   */
  private castWish(me: PlayerState, enemy: Enemy | null, now: number): void {
    const s = this.room.state;
    const slot = abilityInSlot(me, "wish");
    if (!slot || now - this.wishTriedAt < WISH_TRY_MS || s.serverTime < me.wishReadyAt) return;
    const map = this.collision();
    const foe = this.foe;
    const foeBits = foe ? (foe.mob ? s.mobs.get(foe.id)?.effects : s.players.get(foe.id)?.effects) ?? 0 : 0;
    const situation: CastSituation = {
      me: { x: me.x, y: me.y, hpFrac: me.maxHp > 0 ? me.hp / me.maxHp : 1, effects: me.effects, recentlyHit: now - this.hitAt < RECENT_HIT_MS },
      foe: foe ? { id: foe.id, x: foe.at.x, y: foe.at.y, d: foe.d, los: hasLineOfSight(map, me, foe.at), targetable: targetableBits(foeBits), mob: foe.mob } : null,
      threat: enemy
        ? {
          x: enemy.p.x, y: enemy.p.y, d: enemy.d, chasing: enemy.p.attackTarget === this.room.sessionId, id: enemy.id,
          los: hasLineOfSight(map, me, enemy.p), targetable: true,
        }
        : null,
      map: this.map,
      gatesLocked: s.gatesLocked,
    };
    const cast = decideCast(slot.def, slot.rank, situation);
    if (!cast) return;
    this.wishTriedAt = now;
    this.log(`casting ${slot.def.name}${cast.id ? ` on ${cast.id}` : ""}`);
    this.send("cast", cast.id !== undefined ? { slot: "wish", x: cast.x, y: cast.y, id: cast.id } : { slot: "wish", x: cast.x, y: cast.y });
    if (hidesCaster(slot.def, slot.rank)) {
      this.escaping = true;
      this.escapeUntil = now + rankOf(slot.def, slot.rank).castMs + ESCAPE_GRACE_MS;
    }
  }

  /**
   * The planning screen, as a player would use it: take the better of the two dealt spawns for farming (planPick: the
   * matchup of the camps nearest each, mobHunt.ts), wait for the server to confirm the pick (or say it was taken: then the
   * other one), and press ready. With no deal (none came, or both options are taken) it presses ready and lets the server
   * pick.
   */
  private planStart(me: PlayerState, now: number): void {
    if (this.readySent) return;
    if (this.planSeenAt === 0) this.planSeenAt = now;
    const m = this.plan;
    if (!m) {
      if (now - this.planSeenAt >= PLAN_WAIT_MS) this.ready();
      return;
    }
    if (m.pick >= 0) { this.ready(); return; }
    const k = isFactionId(me.faction) ? planPick(this.map, m, me.faction, inHand(me)) : (m.taken[0] ? 1 : 0);
    if (k === -1 || m.taken[k]) { this.ready(); return; }
    const a = this.planAsked;
    if (a && a.k === k && now - a.at < PLAN_RESEND_MS) return;
    this.log(`planning: picking spawn ${m.spawns[k]} (option ${k})`);
    this.planAsked = { k, at: now };
    this.send("plan", { spawn: k });
  }

  private ready(): void {
    this.readySent = true;
    this.log("planning: ready");
    this.send("plan", { ready: true });
  }

  /** What to do this think: run, fetch a weapon, fight a mob or a player, or stand. True when the bot is attacking a foe (see `attacking`). */
  private act(me: PlayerState, enemy: Enemy | null, hunt: HuntDecision, now: number): boolean {
    if (hunt.kind === "retreat" && this.retreat(me, hunt, now)) { this.pauseChase(enemy, now); return false; }
    const mob = hunt.kind === "mob" ? this.mobFoe(me, hunt.id) : null;
    if (this.grabWeapon(me, now, enemy?.d ?? Infinity)) { this.pauseChase(enemy, now); return false; }
    if (mob) {
      this.pauseChase(enemy, now);
      return this.fight(me, mob, now);
    }
    if (enemy) return this.fight(me, { id: enemy.id, at: enemy.p, d: enemy.d, theirs: inHand(enemy.p), mob: false }, now);
    this.stand();
    return false;
  }

  /**
   * A weapon detour, a retreat or a mob fight walks away from the player the orbit breaker is timing on purpose; its time must not
   * read as a chase going nowhere.
   */
  private pauseChase(enemy: Enemy | null, now: number): void {
    if (enemy && this.chase?.id === enemy.id) { this.chase.best = enemy.d; this.chase.since = now; }
  }

  /** Counts how long the bot has stood still doing nothing in a running raid: the longest such stretch is `stats.maxStallMs`. */
  private watchStall(me: PlayerState, now: number): void {
    const busy = this.attacking || me.drawStartedAt > 0 || this.grab !== null;
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
        stacks: buffPower(me.buffs), mobKills: me.mobKills,
      },
      playerDistance: enemy ? this.threatDistance(me, players) : Infinity,
      players,
      inColiseum: s.inColiseum,
      mobs: s.mobs,
      walk: (to) => this.walkDistance(me, to),
      attacking: this.attacking,
      shotByPlayerAt: this.playerHitAt,
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
    return { id, at: m, d: dist(me, m), theirs: mobWeapon(m), mob: true };
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
    this.moveTo(to, now);
    return true;
  }

  /**
   * The nearest standing enemy, sticking with the current target unless another is clearly nearer. An enemy a pursuit loop
   * made us give up on is only taken when it is the last one standing, or once it is within ORBIT_MIN_DISTANCE (or hit us,
   * see onFx), which ends the avoidance.
   */
  private pickEnemy(me: PlayerState, now: number): Enemy | null {
    let best: Enemy | null = null;
    let current: Enemy | null = null;
    let avoided: Enemy | null = null;
    for (const [id, p] of this.room.state.players) {
      if (id === this.room.sessionId || p.status !== "alive" || !targetableBits(p.effects)) continue;
      const e = { id, p, d: dist(me, p) };
      if (id === this.avoidId) {
        if (now < this.avoidUntil && e.d >= ORBIT_MIN_DISTANCE) { avoided = e; continue; }
        this.avoidId = null;
      }
      if (!best || e.d < best.d) best = e;
      if (id === this.targetId) current = e;
    }
    const pick = (current && best && best.d >= current.d * SWITCH_RATIO ? current : best) ?? avoided;
    this.targetId = pick?.id ?? null;
    this.breakOrbit(pick, now);
    return pick;
  }

  /** Times the chase of `pick`; one that is not closing in for too long gets its target avoided from the next think on. */
  private breakOrbit(pick: Enemy | null, now: number): void {
    const c = this.chase;
    if (!pick) { this.chase = null; return; }
    if (!c || c.id !== pick.id) {
      this.chase = { id: pick.id, best: pick.d, since: now, limit: ORBIT_MS + Math.random() * ORBIT_JITTER_MS };
    } else if (this.attacking || pick.d < ORBIT_MIN_DISTANCE || pick.d < c.best - ORBIT_PROGRESS) {
      c.best = pick.d;
      c.since = now;
    } else if (now - c.since > c.limit) {
      this.log(`chase of ${pick.id} is going nowhere: turning on someone else`);
      this.avoidId = pick.id;
      this.avoidUntil = now + ORBIT_AVOID_MS;
      this.chase = null;
    }
  }

  /**
   * Fights `foe` (a player or a mob; the server treats both the same) with the weapon in hand, as a player clicking it would:
   * the server takes a lock on a foe within TARGET_RANGE (seen or not: it walks around a wall to it), so until then the bot
   * walks to it; once it can, it sends `target` and leaves the rest to the server, which walks into range, attacks and aims
   * until the lock ends. True when the foe is locked, in reach of the weapon and in sight: the server is attacking it.
   */
  private fight(me: PlayerState, foe: Foe, now: number): boolean {
    const slots: Slots = [asWeapon(me.weapon0), asWeapon(me.weapon1)];
    const weapon = slots[slotOf(me)];
    this.foe = foe;
    if (this.swap(me, slots, foe.theirs, foe.mob, foe.d, now)) return false;
    if (!weapon || !isFactionId(me.faction)) { this.stand(); return false; }

    if (foe.d > TARGET_RANGE - LOCK_MARGIN) {
      this.moveTo(foe.at, now);
      return false;
    }
    this.lockOn(me, foe, now);
    // The weapon's reach, like the lock's own `clear`: a sword is stopped by a fence, an arrow is not.
    return me.attackTarget === foe.id && foe.d <= lockSpacing(weapon).attackRange + ATTACK_SLACK
      && hasLineOfSight(this.collision(), me, foe.at, reachMask(weapon));
  }

  /**
   * Clicks `foe` unless the server already has it locked. An order that did not take (the state still shows another lock or none
   * after TARGET_RESEND_MS) is sent again, and after TARGET_TRIES such orders the bot walks to the foe for REFUSED_WALK_MS first
   * (a foe that walked home or fell before the order arrived).
   */
  private lockOn(me: PlayerState, foe: Foe, now: number): void {
    if (me.attackTarget === foe.id) { this.order = null; return; }
    let o = this.order?.id === foe.id ? this.order : null;
    if (o && now < o.walkUntil) { this.moveTo(foe.at, now); return; }
    if (o && now - o.at < TARGET_RESEND_MS) return;
    if (o && o.tries >= TARGET_TRIES) {
      this.log(`${foe.id} will not be locked: walking up to it`);
      o.tries = 0;
      o.walkUntil = now + REFUSED_WALK_MS;
      this.moveTo(foe.at, now);
      return;
    }
    o = this.order = { id: foe.id, at: now, tries: (o?.tries ?? 0) + 1, walkUntil: 0 };
    this.send("target", { id: foe.id });
    // The lock replaces the walk and the halt we sent: a later move to the same goal must be sent again.
    this.dest = null;
    this.holding = false;
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
    const c = s.containers.get(g.containerId)!;
    const map = this.collision();
    // Movement reach, as the server's pickup test (no looting through a fence).
    if (dist(me, c) > PICKUP_DISTANCE || !hasLineOfSight(map, me, c, MASK_MOVE)) {
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

  /** Nothing to fight: halts (which also drops a lock). */
  private stand(): void {
    this.hold();
  }
}
