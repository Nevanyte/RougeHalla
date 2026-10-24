// A headless player. It talks to the server the way the web client does: HTTP for the profile, then a
// Colyseus room where it reads synced state and sends inputs only (move, stop, aim, attack, release, swap, pickup).
// It never touches server internals; the map comes from the public seed. The brain is a hunt, re-evaluated every
// THINK_MS from the latest state: pick the nearest standing enemy, see where the snapshot buffer puts it, and let the
// shared weapon policy (decide) say where to walk, where to aim and whether the trigger is down. Early in a run it may
// detour for a second weapon, and it swaps slot to the better weapon edge against the enemy's. The arena (teleport,
// locked gates, sudden death) needs no handling: the bot just keeps hunting.
import { Client, type Room } from "@colyseus/sdk";
import {
  attackInterval, bestSlot, decide, FACTIONS, generateMap, hasLineOfSight, INTERACT_RANGE, INTERP_DELAY_MS,
  isFactionId, isRanged, isWeaponId, PLAYER_SPEED, PROFILE_TOKEN_HEADER, ROOM_NAME, SnapshotBuffer, TICK_MS, TILE,
  weaponTimings, withGates, wrapAngle,
  type ClientMessages, type ClientMessageType, type FactionId, type GameMap, type JoinOptions, type PolicyOutput,
  type ProfileResponse, type RunResult, type TimedFx, type Vec2, type WeaponId,
} from "@raid/shared";
import type { PlayerState, RaidState } from "@raid/shared/schema";

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

/**
 * A chase that has not got ORBIT_PROGRESS closer to its target for ORBIT_MS (plus up to ORBIT_JITTER_MS, so the bots do not
 * all turn at once) is a pursuit loop: three bots on a ring, each running after the one ahead at the same speed, never
 * meet. The bot then goes for another enemy and leaves that one alone for ORBIT_AVOID_MS, unless it comes within
 * ORBIT_MIN_DISTANCE or hits us (it is attacking us then, not circling). Within ORBIT_MIN_DISTANCE, or while the trigger
 * is down, it is a fight, not a chase.
 */
export const ORBIT_MS = 3000;
export const ORBIT_JITTER_MS = 1500;
const ORBIT_PROGRESS = 40;
export const ORBIT_MIN_DISTANCE = 150;
const ORBIT_AVOID_MS = 6000;

/** A weapon detour only happens this early in the run (server ms)... */
const GRAB_WINDOW_MS = 25_000;
/** ...for a weapon this close (straight line, roughly nine in ten spawns have one)... */
const GRAB_RADIUS = 8 * TILE;
/** ...with no enemy this close... */
const GRAB_ENEMY_DISTANCE = 240;
/** ...and is dropped for good once it has taken this long, so it can never stall the hunt. */
const GRAB_BUDGET_MS = 6_000;
const GRAB_MAX_FAILS = 2;
const PICKUP_RETRY_MS = 400;
/** Inside this distance of a container we start taking; keeps a margin under INTERACT_RANGE for stale positions. */
const PICKUP_DISTANCE = INTERACT_RANGE - 12;

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
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
  /** The chase being timed for the orbit breaker: the closest we have been to the target, and since when. */
  private chase: { id: string; best: number; since: number; limit: number } | null = null;
  /** The enemy a pursuit loop made us give up on, until `avoidUntil`. */
  private avoidId: string | null = null;
  private avoidUntil = 0;
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

  constructor(private readonly opts: BotOptions = {}) {
    this.done = new Promise((resolve) => { this.settle = resolve; });
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
    for (let i = 0; !room.state?.players; i++) {
      if (i > 500) { void room.leave(true).catch(() => {}); throw new Error("no room state from the server"); }
      await sleep(10);
    }
    this.map = generateMap(room.state.seed);
    this.log(`joined ${room.roomId} (${body.profile.gv} GV)`);

    room.reconnection.enabled = false; // a bot that drops is simply done
    room.onMessage("result", (r: RunResult) => { this.resultsSeen++; this.log(`result: ${r.outcome} (place ${r.place}/${r.players}, +${r.gv.total} GV)`); this.finish(r); });
    room.onMessage("toast", (m: { text: string }) => this.onToast(m.text));
    room.onMessage("fx", (fx: TimedFx) => this.onFx(fx));
    room.onStateChange((s) => {
      this.patchAt = Date.now();
      for (const [id, p] of s.players) {
        let buf = this.buffers.get(id);
        if (!buf) this.buffers.set(id, (buf = new SnapshotBuffer()));
        buf.push(s.serverTime, p.x, p.y);
      }
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

  private onFx(fx: TimedFx): void {
    if (fx.kind === "teleport") { this.teleports++; this.onTeleport(); return; }
    // An enemy we gave up chasing that now lands (or fails to land) a blow on us is no longer circling: fight back.
    if ((fx.kind === "hit" || fx.kind === "block") && fx.id === this.room.sessionId && fx.by !== null && fx.by === this.avoidId) {
      this.avoidId = null;
    }
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
    this.chase = null;
    this.avoidId = null;
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
    const enemy = this.pickEnemy(me, now);
    if (!enemy) { this.stand(); return; }
    if (this.grabWeapon(me, now, enemy)) {
      // The detour walks away from the target on purpose; its time must not read as a chase going nowhere.
      if (this.chase?.id === enemy.id) { this.chase.best = enemy.d; this.chase.since = now; }
      return;
    }
    this.fight(me, enemy, now);
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
      if (id === this.room.sessionId || p.status !== "alive") continue;
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
    } else if (this.trigger || pick.d < ORBIT_MIN_DISTANCE || pick.d < c.best - ORBIT_PROGRESS) {
      c.best = pick.d;
      c.since = now;
    } else if (now - c.since > c.limit) {
      this.log(`chase of ${pick.id} is going nowhere: turning on someone else`);
      this.avoidId = pick.id;
      this.avoidUntil = now + ORBIT_AVOID_MS;
      this.chase = null;
    }
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
   * Hunts `enemy` with the weapon in hand: the policy decides where to walk, where to aim and whether the trigger is down.
   * Every aim is measured from where the buffered snapshots put us at render time and carries that time as `t`: the
   * server swings melee from there and looses projectiles from there too. A projectile flies in present server time,
   * so the target is led to where it will be about when the shot is loosed.
   */
  private fight(me: PlayerState, enemy: Enemy, now: number): void {
    const s = this.room.state;
    const slots: Slots = [asWeapon(me.weapon0), asWeapon(me.weapon1)];
    const weapon = slots[slotOf(me)];
    const theirs = inHand(enemy.p);
    if (this.swap(me, slots, theirs, enemy.d, now)) return;
    if (!weapon || !isFactionId(me.faction)) { this.stand(); return; }

    const renderT = s.serverTime - INTERP_DELAY_MS;
    const serverNow = this.serverNow();
    const ranged = isRanged(weapon);
    const seen = this.view(enemy.id, renderT);
    const seenSelf = this.view(this.room.sessionId, renderT);
    const self = seenSelf ?? { x: me.x, y: me.y };
    let target: Vec2 = seen ?? enemy.p;
    const targetVel: Vec2 = seen ? { x: seen.vx, y: seen.vy } : { x: 0, y: 0 };
    if (seen && ranged) {
      const lead = Math.min(MAX_LEAD_MS, serverNow - renderT + TICK_MS / 2) / 1000;
      target = { x: seen.x + seen.vx * lead, y: seen.y + seen.vy * lead };
    }
    const timings = weaponTimings("bow", attackInterval(FACTIONS[me.faction], "bow"));
    const drawn = me.drawStartedAt > 0 ? Math.max(1e-3, (serverNow - me.drawStartedAt) / 1000) : 0;
    const out = decide({
      self, target, targetVel,
      los: hasLineOfSight(s.gatesLocked ? withGates(this.map) : this.map, self, target),
      weapon,
      ready: serverNow >= me.readyAt,
      drawSeconds: drawn,
      fullDraw: timings.fullDraw + RELEASE_MARGIN_S,
    });

    if (out.move === "stop") this.hold();
    else if (out.move) this.moveTo(out.move, now);
    this.aim(out.aim, now);
    this.pull(out, me, weapon, renderT, now);
  }

  /** Swaps to the slot with the better weapon edge against the enemy's weapon; true when it did. Never mid-draw. */
  private swap(me: PlayerState, slots: Slots, theirs: WeaponId | null, d: number, now: number): boolean {
    if (d > SWAP_DISTANCE || now < this.nextSwapAt || me.drawStartedAt > 0) return false;
    const slot = slotOf(me);
    const want = bestSlot(slots, slot, theirs);
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
   * Early in the run, with one weapon carried, a detour for a container's weapon. True while it is going for one (the
   * hunt waits). It is bounded in time, distance and tries, so it can never stall the hunt.
   */
  private grabWeapon(me: PlayerState, now: number, enemy: Enemy): boolean {
    const s = this.room.state;
    const carried = (me.weapon0 !== "" ? 1 : 0) + (me.weapon1 !== "" ? 1 : 0);
    if (carried !== 1 || s.inColiseum || s.serverTime - s.raidStartedAt > GRAB_WINDOW_MS || enemy.d < GRAB_ENEMY_DISTANCE) {
      this.grab = null;
      return false;
    }
    let g = this.grab;
    if (g && (!this.holdsWeapon(g.containerId) || now - g.since > GRAB_BUDGET_MS || g.fails >= GRAB_MAX_FAILS)) {
      this.grabSkipped.add(g.containerId);
      g = this.grab = null;
    }
    if (!g) {
      const found = this.findWeapon(me);
      if (!found) return false;
      g = this.grab = { containerId: found, since: now, pickupSentAt: 0, fails: 0 };
      this.log(`going for a weapon in ${found}`);
    }
    this.stopTrigger();
    const c = s.containers.get(g.containerId)!;
    const map = s.gatesLocked ? withGates(this.map) : this.map;
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

  /** The nearest container within GRAB_RADIUS holding a weapon other than the one carried. */
  private findWeapon(me: PlayerState): string | null {
    const have = asWeapon(me.weapon0) ?? asWeapon(me.weapon1);
    let best: string | null = null;
    let bestD = GRAB_RADIUS;
    this.room.state.containers.forEach((c) => {
      const d = dist(me, c);
      if (d >= bestD || this.grabSkipped.has(c.id)) return;
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
