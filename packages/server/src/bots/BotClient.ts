// A headless player. It talks to the server the way the web client does: HTTP for the profile, then a
// Colyseus room where it reads synced state and sends inputs only (move, stop, attack, take, use).
// It never touches server internals; the map comes from the public seed. The brain is a hunt, re-evaluated
// every THINK_MS from the latest state: heal when hurt and nobody is close, otherwise walk at the nearest
// standing enemy and swing once one is in weapon range with a clear line. Early in a run it may detour for a
// better weapon. The arena (teleport, locked gates, sudden death) needs no handling: the bot just keeps hunting.
import { Client, type Room } from "@colyseus/sdk";
import {
  bestWeapon, generateMap, hasLineOfSight, INTERACT_RANGE, INTERP_DELAY_MS, INVENTORY_SLOTS, ITEMS,
  PROFILE_TOKEN_HEADER, ROOM_NAME, SnapshotBuffer, TILE,
  type ClientMessages, type GameMap, type ItemDTO, type JoinOptions, type ProfileResponse, type RunResult,
  type TimedFx, type Vec2, type WeaponDef,
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

const THINK_MS = 100;
/** A chase is re-sent at most this often: the server paths from scratch each time and the target keeps moving. */
const REPLAN_MS = 250;
/** An unchanged goal is sent again after this long anyway (an unreachable click is ignored, which would leave us idle). */
const RESEND_MS = 1500;
/** Heal below this share of max hp... */
const HEAL_BELOW = 0.5;
/** ...but not with an enemy closer than this: a swing is worth more than a bandage then. */
const SAFE_DISTANCE = 160;
/** Fire only inside this share of the weapon's range, so a target stepping back is still hit. */
const ENGAGE_FRACTION = 0.9;
/** The current target is kept unless another is this much nearer (as a share), so two near-equal enemies don't make it dither. */
const SWITCH_RATIO = 0.75;

/** A weapon detour only happens this early in the run (server ms)... */
const GRAB_WINDOW_MS = 25_000;
/** ...for a weapon this close (straight line)... */
const GRAB_RADIUS = 6 * TILE;
/** ...with no enemy this close... */
const GRAB_ENEMY_DISTANCE = 240;
/** ...and is dropped for good once it has taken this long, so it can never stall the hunt. */
const GRAB_BUDGET_MS = 6_000;
const GRAB_MAX_FAILS = 2;
const TAKE_RETRY_MS = 400;
/** Inside this distance of a container we start taking; keeps a margin under INTERACT_RANGE for stale positions. */
const TAKE_DISTANCE = INTERACT_RANGE - 12;

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export class BotClient {
  roomId = "";
  token = "";
  /** `result` messages received while the bot was still in the room. A correct server sends exactly one. */
  resultsSeen = 0;
  /** `teleport` fx seen: how many times the arena moved everyone into the coliseum. */
  teleports = 0;

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

  // Brain memory.
  private targetId: string | null = null;
  private dest: Vec2 | null = null;
  private moveSentAt = 0;
  /** We sent a stop to stand and fight; cleared by the next move. */
  private holding = false;
  private nextAttackAt = 0;
  private lastUseAt = 0;
  /** The weapon detour in progress, if any. */
  private grab: { containerId: string; uid: string; since: number; takeSentAt: number; fails: number } | null = null;
  /** Containers whose weapon we gave up on. */
  private readonly grabSkipped = new Set<string>();
  /** Set when the inventory is full: no more detours. */
  private grabOff = false;

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
    room.onMessage("fx", (fx: TimedFx) => { if (fx.kind === "teleport") { this.teleports++; this.onTeleport(); } });
    room.onStateChange((s) => {
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

  private send<K extends keyof ClientMessages>(type: K, payload: ClientMessages[K]): void {
    this.room.send(type, payload);
  }

  private onToast(text: string): void {
    this.log(`toast: ${text}`);
    if (/Too far|reach|gone/.test(text) && this.grab) this.grab.fails++;
    else if (text === "Inventory full") this.grabOff = true;
  }

  /** The server clears our path and queued inputs when it teleports us, so forget what we thought we had told it. */
  private onTeleport(): void {
    this.log("teleported into the coliseum");
    this.dest = null;
    this.moveSentAt = 0;
    this.holding = false;
    this.grab = null;
  }

  // ------------------------------------------------------------------ brain
  private think(): void {
    const s = this.room.state;
    const me = s.players.get(this.room.sessionId);
    if (this.finished || s.phase !== "active" || me?.status !== "alive") return;
    const now = Date.now();
    if (this.opts.abandonAfterMs !== undefined && s.serverTime - s.raidStartedAt >= this.opts.abandonAfterMs) {
      this.log("abandoning the run");
      this.abandoned = true;
      this.finish(null);
      return;
    }
    const inv = Array.from(me.inventory, (i) => ({ uid: i.uid, def: i.def }));
    const pos = { x: me.x, y: me.y };
    const enemy = this.pickEnemy(pos);
    this.heal(me, inv, enemy, now);
    if (!enemy) { this.hold(); return; }
    if (this.grabWeapon(inv, pos, now, enemy)) return;
    this.hunt(enemy, inv, pos, now);
  }

  /** The nearest standing enemy, sticking with the current target unless another is clearly nearer. */
  private pickEnemy(pos: Vec2): Enemy | null {
    let best: Enemy | null = null;
    let current: Enemy | null = null;
    for (const [id, p] of this.room.state.players) {
      if (id === this.room.sessionId || p.status !== "alive") continue;
      const e = { id, p, d: dist(pos, p) };
      if (!best || e.d < best.d) best = e;
      if (id === this.targetId) current = e;
    }
    const pick = current && best && best.d >= current.d * SWITCH_RATIO ? current : best;
    this.targetId = pick?.id ?? null;
    return pick;
  }

  private heal(me: PlayerState, inv: ItemDTO[], enemy: Enemy | null, now: number): void {
    if (me.hp >= me.maxHp * HEAL_BELOW || now - this.lastUseAt < 600) return;
    if (enemy && enemy.d < SAFE_DISTANCE) return;
    let best: ItemDTO | undefined;
    let bestHeal = 0;
    for (const i of inv) {
      const d = ITEMS[i.def];
      if (d?.kind === "healing" && d.heal > bestHeal) { best = i; bestHeal = d.heal; }
    }
    if (!best) return;
    this.log(`healing at ${Math.round(me.hp)} hp`);
    this.send("use", { uid: best.uid });
    this.lastUseAt = now;
  }

  /**
   * Swings at the nearest enemy that is inside the weapon's engage range with a clear line, standing still
   * to do it; otherwise walks at the target. The swing aims where the buffered snapshots put the enemy at
   * render time and carries that same time as `t`, so the server's rewind agrees. One swing per cooldown.
   */
  private hunt(target: Enemy, inv: ItemDTO[], pos: Vec2, now: number): void {
    const weapon = bestWeapon(inv.map((i) => i.def));
    const renderT = this.room.state.serverTime - INTERP_DELAY_MS;
    const aim = this.shootable(weapon, pos, renderT);
    if (!aim) { this.moveTo(target.p, now); return; }
    this.hold();
    if (now < this.nextAttackAt) return;
    this.log(`attack at ${Math.round(aim.d)} with ${weapon.name}`);
    this.send("attack", { x: aim.x, y: aim.y, t: renderT });
    this.nextAttackAt = now + weapon.cooldownMs + 30;
  }

  /** The nearest standing enemy within engage range and in the clear, at `renderT`. */
  private shootable(weapon: WeaponDef, pos: Vec2, renderT: number): (Vec2 & { d: number }) | null {
    const at = { x: 0, y: 0 };
    let best: (Vec2 & { d: number }) | null = null;
    let nearest = weapon.range * ENGAGE_FRACTION;
    for (const [id, q] of this.room.state.players) {
      if (id === this.room.sessionId || q.status !== "alive" || !this.buffers.get(id)?.sample(renderT, at)) continue;
      const d = dist(pos, at);
      if (d < nearest && hasLineOfSight(this.map, pos, at)) { nearest = d; best = { x: at.x, y: at.y, d }; }
    }
    return best;
  }

  /**
   * Early in the run, a detour for a container's weapon that beats the best one carried. True while it is
   * going for one (the hunt waits). It is bounded in time, distance and tries, so it can never stall the hunt.
   */
  private grabWeapon(inv: ItemDTO[], pos: Vec2, now: number, enemy: Enemy): boolean {
    const s = this.room.state;
    if (this.grabOff || s.inColiseum || s.serverTime - s.raidStartedAt > GRAB_WINDOW_MS || enemy.d < GRAB_ENEMY_DISTANCE) {
      this.grab = null;
      return false;
    }
    let g = this.grab;
    if (g) {
      const c = s.containers.get(g.containerId);
      if (!c?.items.some((i) => i.uid === g!.uid) || now - g.since > GRAB_BUDGET_MS || g.fails >= GRAB_MAX_FAILS) {
        this.grabSkipped.add(g.containerId);
        g = this.grab = null;
      }
    }
    if (!g) {
      const found = this.findUpgrade(inv, pos);
      if (!found) return false;
      g = this.grab = { containerId: found.containerId, uid: found.uid, since: now, takeSentAt: 0, fails: 0 };
      this.log(`going for a weapon in ${found.containerId}`);
    }
    const c = s.containers.get(g.containerId)!;
    if (inv.length >= INVENTORY_SLOTS) { this.grabOff = true; this.grab = null; return false; }
    if (dist(pos, c) > TAKE_DISTANCE || !hasLineOfSight(this.map, pos, c)) {
      this.moveTo(c, now);
    } else {
      this.hold();
      if (now - g.takeSentAt >= TAKE_RETRY_MS) {
        this.send("take", { containerId: c.id, uid: g.uid });
        g.takeSentAt = now;
      }
    }
    return true;
  }

  /** The nearest container within GRAB_RADIUS holding a weapon that out-damages everything carried. */
  private findUpgrade(inv: ItemDTO[], pos: Vec2): { containerId: string; uid: string } | null {
    const have = bestWeapon(inv.map((i) => i.def)).damage;
    let best: { containerId: string; uid: string } | null = null;
    let bestD = GRAB_RADIUS;
    this.room.state.containers.forEach((c) => {
      const d = dist(pos, c);
      if (d >= bestD || this.grabSkipped.has(c.id)) return;
      for (const item of c.items) {
        const def = ITEMS[item.def];
        if (def?.kind === "weapon" && def.damage > have) { best = { containerId: c.id, uid: item.uid }; bestD = d; return; }
      }
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
}
