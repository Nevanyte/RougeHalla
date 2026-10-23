// A headless player. It talks to the server the way the web client does: HTTP for the profile, then a
// Colyseus room where it reads synced state and sends inputs only (move, attack, take, use, extract).
// It never touches server internals; the map comes from the public seed. Behaviour is a fixed priority
// list, re-evaluated every THINK_MS from the latest state: heal, fight, then loot (until a budget runs
// out) and finally walk to an extract inside the zone's next circle and leave.
import { Client, type Room } from "@colyseus/sdk";
import {
  bestWeapon, findPath, generateMap, hasLineOfSight, INTERACT_RANGE, INTERP_DELAY_MS, INVENTORY_SLOTS, isOutside,
  ITEMS, mulberry32, PROFILE_TOKEN_HEADER, ROOM_NAME, SnapshotBuffer,
  type ClientMessages, type ExtractZoneDef, type GameMap, type ItemDTO, type JoinOptions, type ProfileResponse,
  type RaidResult, type Vec2,
} from "@raid/shared";
import type { ContainerState, PlayerState, RaidState } from "@raid/shared/schema";

type ClientRoom = Room<any, RaidState>;

export interface BotOptions {
  verbose?: boolean;
  /** Gives up (error, no result) after this long. Default 10 minutes. */
  timeoutMs?: number;
  /**
   * Called as soon as the server has issued the profile's token, before the bot tries to join. A
   * claimed name is only ever reachable again with its token, so a caller that keeps tokens must keep
   * this one even when the join then fails. Must not throw.
   */
  onToken?: (token: string) => void;
  /**
   * Test knob: leave the room (with consent, so the server resolves the bot as MIA at once) right
   * after this many successful takes. The bot never takes more than that, and gets no result message:
   * the server has already dropped it from the room when it settles the raid.
   */
  abandonAfterLoot?: number;
}

export interface BotRun {
  profile: string;
  /** Null when the bot never got one; `error` then says why (none when it abandoned on purpose). */
  result: RaidResult | null;
  error?: string;
  /** The bot left on purpose (`abandonAfterLoot`), so there is no result and nothing went wrong. */
  abandoned?: true;
}

const THINK_MS = 100;
/** A walk is re-sent at most this often (and at once when its goal changes). */
const REPLAN_MS = 500;
const HEAL_BELOW = 50;
/** Containers that keep refusing our takes (toasts) are dropped after this many. */
const FAIL_LIMIT = 3;
const TARGET_TIMEOUT_MS = 10_000;
const TAKES_PER_THINK = 2;
/** Inside this distance of a container we start taking; keeps a margin under INTERACT_RANGE for stale positions. */
const TAKE_DISTANCE = INTERACT_RANGE - 12;
/** Fire only inside this share of the weapon's range, so a target stepping back is still hit. */
const ENGAGE_FRACTION = 0.9;

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The best weapon and the strongest healing item in the stash: what a sensible player packs. */
function pickLoadout(stash: readonly ItemDTO[]): string[] {
  const best = (kind: "weapon" | "healing") => stash
    .filter((i) => ITEMS[i.def]?.kind === kind)
    .sort((a, b) => score(b) - score(a))[0];
  const score = (i: ItemDTO) => { const d = ITEMS[i.def]; return d?.kind === "weapon" ? d.damage : d?.kind === "healing" ? d.heal : 0; };
  return [best("weapon"), best("healing")].filter((i): i is ItemDTO => !!i).map((i) => i.uid);
}

export class BotClient {
  roomId = "";
  token = "";
  /** `result` messages received while the bot was still in the room. A correct server sends exactly one. */
  resultsSeen = 0;
  /** The stash uids this bot brought into the raid. */
  loadout: string[] = [];
  /** Uids that showed up in its inventory after the raid began, i.e. what its takes got it, in order. */
  looted: string[] = [];

  private profile = "";
  private room!: ClientRoom;
  private map!: GameMap;
  private lootFraction = 0.25;
  private lootItems = 3;
  private finished = false;
  /** The socket is gone (left or errored): there is nothing to say goodbye to. */
  private roomClosed = false;
  private abandoned = false;
  private readonly done: Promise<BotRun>;
  private settle!: (run: BotRun) => void;
  private timers: NodeJS.Timeout[] = [];
  private readonly buffers = new Map<string, SnapshotBuffer>();

  // Brain memory.
  private leaving = false;
  private carriedAtStart = -1;
  /** Every uid seen in the inventory so far; a new one after the first look is loot. */
  private readonly seenUids = new Set<string>();
  private target: { id: string; since: number } | null = null;
  private exit: { zone: ExtractZoneDef; at: number } | null = null;
  private dest: Vec2 | null = null;
  private moveSentAt = 0;
  private nextAttackAt = 0;
  private lastUseAt = 0;
  private extractSentAt = 0;
  private extractMargin = 10;
  private lastTakeFrom: string | null = null;
  private readonly fails = new Map<string, number>();
  private readonly pendingTakes = new Map<string, number>();

  constructor(private readonly opts: BotOptions = {}) {
    this.done = new Promise((resolve) => { this.settle = resolve; });
  }

  /** Claims (or re-opens, given its token) the profile, packs a loadout, joins a lobby and starts playing. */
  async connect(endpoint: string, profile: string, token?: string): Promise<void> {
    this.profile = profile;
    const rng = mulberry32(hashString(profile));
    this.lootFraction = 0.22 + rng() * 0.08;
    this.lootItems = 3 + Math.floor(rng() * 2);

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

    const options: JoinOptions = { profile, token: body.token, loadout: pickLoadout(body.profile.stash) };
    this.loadout = options.loadout;
    this.room = await this.join(base, options);
    this.roomId = this.room.roomId;
    const room = this.room;
    for (let i = 0; !room.state?.players; i++) {
      if (i > 500) { void room.leave(true).catch(() => {}); throw new Error("no room state from the server"); }
      await sleep(10);
    }
    this.map = generateMap(room.state.seed);
    this.log(`joined ${room.roomId} with ${options.loadout.length} item(s)`);

    room.reconnection.enabled = false; // a bot that drops is simply done
    room.onMessage("result", (r: RaidResult) => { this.resultsSeen++; this.log(`result: ${r.outcome}`); this.finish(r); });
    room.onMessage("toast", (m: { text: string }) => this.onToast(m.text));
    room.onMessage("fx", () => {});
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
      setTimeout(() => this.finish(null, "timed out"), this.opts.timeoutMs ?? 600_000),
    );
  }

  /** Resolves once the raid result arrived (or the bot failed); never rejects. */
  run(): Promise<BotRun> {
    return this.done;
  }

  private async join(base: string, options: JoinOptions): Promise<ClientRoom> {
    const client = new Client(base);
    // A seat reserved in the instant a raid starts is refused; the next attempt lands in a fresh lobby.
    for (let attempt = 0; ; attempt++) {
      try {
        return await client.joinOrCreate<RaidState>(ROOM_NAME, options);
      } catch (err) {
        if (attempt >= 2 || !errText(err).includes("raid already started")) throw err;
      }
    }
  }

  private finish(result: RaidResult | null, error?: string): void {
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
    if (/Too far|reach|gone/.test(text) && this.lastTakeFrom) {
      this.fails.set(this.lastTakeFrom, (this.fails.get(this.lastTakeFrom) ?? 0) + 1);
    } else if (text === "Inventory full") {
      this.leaving = true;
    } else if (text === "Not in an extraction zone") {
      this.extractMargin += 12; // our idea of "inside" was off: stand deeper in
    } else if (text === "Extraction cancelled") {
      this.extractSentAt = 0; // start again on the next think
    }
  }

  // ------------------------------------------------------------------ brain
  private think(): void {
    const s = this.room.state;
    const me = s.players.get(this.room.sessionId);
    if (this.finished || s.phase !== "active" || me?.status !== "alive") return;
    const now = Date.now();
    const inv = Array.from(me.inventory, (i) => ({ uid: i.uid, def: i.def }));
    const pos = { x: me.x, y: me.y };
    if (this.carriedAtStart < 0) {
      this.carriedAtStart = inv.length;
      for (const i of inv) this.seenUids.add(i.uid);
    }
    for (const i of inv) {
      if (this.seenUids.has(i.uid)) continue;
      this.seenUids.add(i.uid);
      this.looted.push(i.uid);
    }
    const abandonAfter = this.opts.abandonAfterLoot;
    if (abandonAfter !== undefined && this.looted.length >= abandonAfter) {
      this.log(`abandoning the raid after ${this.looted.length} take(s)`);
      this.abandoned = true;
      this.finish(null);
      return;
    }

    this.heal(me, inv, now);

    const zone = s.zone;
    const raidMs = s.raidEndsAt - s.raidStartedAt;
    if (!this.leaving && (
      s.serverTime - s.raidStartedAt >= this.lootFraction * raidMs ||
      zone.stage >= 3 ||
      inv.length >= INVENTORY_SLOTS ||
      inv.length - this.carriedAtStart >= this.lootItems ||
      (zone.stage > 0 && isOutside(zone, me.x, me.y))
    )) {
      this.leaving = true;
      this.log(`heading for an extract (stage ${zone.stage}, ${inv.length} item(s))`);
    }

    // Shooting cancels an extraction, so a bot standing in its exit zone keeps still.
    const exit = this.leaving ? this.exitFor(pos, now) : null;
    const atExit = !!exit && dist(pos, exit) <= exit.r - this.extractMargin;
    const threatened = this.fight(inv, pos, now, !atExit);

    if (exit) {
      if (!atExit) this.moveTo(this.safeGoal(pos, exit), now);
      else if (me.extractProgress === 0 && now - this.extractSentAt >= 600) {
        this.send("extract", {});
        this.extractSentAt = now;
      }
    } else {
      this.loot(inv, pos, now, threatened);
    }
  }

  private heal(me: PlayerState, inv: ItemDTO[], now: number): void {
    if (me.hp >= HEAL_BELOW || me.hp >= me.maxHp || now - this.lastUseAt < 600) return;
    let best: ItemDTO | undefined;
    let bestHeal = 0;
    for (const i of inv) {
      const d = ITEMS[i.def];
      if (d?.kind === "healing" && d.heal > bestHeal) { best = i; bestHeal = d.heal; }
    }
    if (!best) return;
    this.send("use", { uid: best.uid });
    this.lastUseAt = now;
  }

  /**
   * Attacks the nearest alive enemy inside the weapon's engage range with a clear line, aiming where
   * the buffered snapshots put it at render time (the same time sent as `t`, so the server's rewind
   * agrees). At most one swing per cooldown. Returns whether there was such an enemy.
   */
  private fight(inv: ItemDTO[], pos: Vec2, now: number, canShoot: boolean): boolean {
    const s = this.room.state;
    const weapon = bestWeapon(inv.map((i) => i.def));
    const renderT = s.serverTime - INTERP_DELAY_MS;
    const at = { x: 0, y: 0 };
    let aim: Vec2 | null = null;
    let nearest = weapon.range * ENGAGE_FRACTION;
    for (const [id, q] of s.players) {
      if (id === this.room.sessionId || q.status !== "alive" || !this.buffers.get(id)?.sample(renderT, at)) continue;
      const d = dist(pos, at);
      if (d < nearest && hasLineOfSight(this.map, pos, at)) { nearest = d; aim = { x: at.x, y: at.y }; }
    }
    if (!aim) return false;
    if (canShoot && now >= this.nextAttackAt) {
      this.log(`attack at ${Math.round(nearest)} with ${weapon.name}`);
      this.send("attack", { x: aim.x, y: aim.y, t: renderT });
      this.nextAttackAt = now + weapon.cooldownMs + 30;
    }
    return true;
  }

  private loot(inv: ItemDTO[], pos: Vec2, now: number, threatened: boolean): void {
    const s = this.room.state;
    let c = this.target ? s.containers.get(this.target.id) : undefined;
    if (c && (c.items.length === 0 || (this.fails.get(c.id) ?? 0) >= FAIL_LIMIT || now - this.target!.since > TARGET_TIMEOUT_MS)) {
      if (now - this.target!.since > TARGET_TIMEOUT_MS) this.fails.set(c.id, FAIL_LIMIT);
      c = undefined;
    }
    if (!c) {
      c = this.pickContainer(pos);
      this.target = c ? { id: c.id, since: now } : null;
      if (!c) { this.leaving = true; return; }
      this.log(`looting ${c.label} (${c.items.length} item(s))`);
    }
    if (dist(pos, c) > TAKE_DISTANCE || !hasLineOfSight(this.map, pos, c)) { this.moveTo(c, now); return; }
    if (threatened) return; // fighting comes first

    const fresh = (uid: string) => now - (this.pendingTakes.get(uid) ?? -Infinity) < 500;
    const items = Array.from(c.items, (i) => ({ uid: i.uid, def: i.def }));
    const inFlight = items.filter((i) => fresh(i.uid)).length;
    const room = INVENTORY_SLOTS - inv.length - inFlight;
    const value = (i: ItemDTO) => ITEMS[i.def]?.value ?? 0;
    const wanted = items.filter((i) => !fresh(i.uid)).sort((a, b) => value(b) - value(a));
    // With an abandon target, never have more takes in flight than it still needs: it is exact, not "at least".
    const abandonAfter = this.opts.abandonAfterLoot;
    const budget = abandonAfter === undefined ? TAKES_PER_THINK : Math.min(TAKES_PER_THINK, abandonAfter - this.looted.length - inFlight);
    for (const item of wanted.slice(0, Math.max(0, Math.min(room, budget)))) {
      this.send("take", { containerId: c.id, uid: item.uid });
      this.pendingTakes.set(item.uid, now);
      this.lastTakeFrom = c.id;
    }
  }

  /** Among the few nearest containers that still hold items and lie inside the next circle, the one with the shortest walk. */
  private pickContainer(pos: Vec2): ContainerState | undefined {
    const z = this.room.state.zone;
    const cands: ContainerState[] = [];
    this.room.state.containers.forEach((c) => {
      const inSafeArea = Math.hypot(c.x - z.nextX, c.y - z.nextY) < z.nextR - 32;
      if (c.items.length > 0 && inSafeArea && (this.fails.get(c.id) ?? 0) < FAIL_LIMIT) cands.push(c);
    });
    cands.sort((a, b) => dist(a, pos) - dist(b, pos));
    let best: ContainerState | undefined;
    let bestLen = Infinity;
    for (const c of cands.slice(0, 6)) {
      const len = this.pathLen(pos, c);
      if (len < bestLen) { best = c; bestLen = len; }
    }
    return best;
  }

  /**
   * The extract to leave through: one inside the circle the zone is shrinking to (the final one always
   * is), then the shortest walk. Kept while the bot stands in it, so a stage change can't pull it off a
   * running extraction; otherwise re-judged every REPLAN_MS with a bias toward the current choice.
   */
  private exitFor(pos: Vec2, now: number): ExtractZoneDef {
    const cur = this.exit;
    if (cur && (now - cur.at < REPLAN_MS || dist(pos, cur.zone) <= cur.zone.r)) return cur.zone;
    const z = this.room.state.zone;
    let best = this.map.extracts[0]!;
    let bestScore = Infinity;
    for (const e of this.map.extracts) {
      const inside = Math.hypot(e.x - z.nextX, e.y - z.nextY) <= z.nextR;
      const walk = Math.min(this.pathLen(pos, e), 30_000);
      const score = (inside ? 0 : 10_000) + walk - (e.id === cur?.zone.id ? 150 : 0);
      if (score < bestScore) { best = e; bestScore = score; }
    }
    if (best.id !== cur?.zone.id) this.log(`exit: ${best.name}`);
    this.exit = { zone: best, at: now };
    return best;
  }

  /** The exit, unless both we and it are outside the current circle: then the circle's centre, if we can walk there. */
  private safeGoal(pos: Vec2, exit: ExtractZoneDef): Vec2 {
    const z = this.room.state.zone;
    if (z.stage > 0 && isOutside(z, pos.x, pos.y) && isOutside(z, exit.x, exit.y)) {
      const centre = { x: z.x, y: z.y };
      if (Number.isFinite(this.pathLen(pos, centre))) return centre;
    }
    return exit;
  }

  private moveTo(goal: Vec2, now: number): void {
    if (this.dest && dist(this.dest, goal) < 8 && now - this.moveSentAt < REPLAN_MS) return;
    this.send("move", { x: goal.x, y: goal.y });
    this.dest = { x: goal.x, y: goal.y };
    this.moveSentAt = now;
  }

  /** Walking distance along our own A*, or Infinity. Only used to choose goals; the server paths for real. */
  private pathLen(from: Vec2, to: Vec2): number {
    const pts = findPath(this.map, { x: from.x, y: from.y }, { x: to.x, y: to.y });
    if (pts.length === 0) return Infinity;
    let len = 0;
    let prev: Vec2 = from;
    for (const p of pts) { len += dist(prev, p); prev = p; }
    return len;
  }
}
