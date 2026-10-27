// The delay ring (docs/BOTS.md 1, 3): frames in, one Percept per frame out, seen the way a client with this bot's latency
// would draw it. The bot itself comes from the frame at now - selfDelayMs (the latest patch it would hold); everyone
// else is interpolated at viewT = now - worldDelayMs (what is drawn), with the fields a client reads off the latest patch
// (hp, status, weapon) taken from that same self frame; the window is BOT_VIEW around the bot. Fx play at render time,
// once each; toasts, results and private messages as soon as the patch carrying them would have arrived.
import {
  hasLineOfSight, matchupScore, matchupTint, MATCHUP_RANGE, TELEPORT_DISTANCE, withGates,
  type FactionId, type ProjectileEnd, type ProjectileKind, type Vec2, type WeaponId,
} from "@raid/shared";
import { fieldInView, inView } from "./perception";
import {
  BOT_VIEW, LAUNCH_NEAR,
  type ComposeConfig, type ContainerView, type FighterId, type FighterView, type Frame, type FrameRingApi,
  type MobView, type ObservedEvent, type Percept, type PerceptExtras, type ProjectileView, type SelfView, type ServerMs,
} from "./types";

/** Velocity is read off two samples this far apart (a human sees motion). */
const VELOCITY_MS = 100;
/** Frames are kept this long beyond the world delay (the velocity sample and some slack). */
const KEEP_EXTRA_MS = 200;
/** Until the first compose names the world delay: generous (compose returns null until the ring covers it anyway). */
const DEFAULT_KEEP_MS = 1000;
/** Never more frames than this, however rarely compose runs. */
const MAX_FRAMES = 128;
/** Undelivered fx kept at most (a driver that never composes must not grow without bound). */
const MAX_QUEUED = 4096;
/** Client MobView DEATH_MS: a dead mob stays drawn, fading, this long after its death in render time. */
const MOB_FADE_MS = 450;
/** Client RaidScene.bodyPending: a body within this of a death still ahead of render time is not drawn yet. */
const BODY_MATCH = 1;
/** Client ProjectileView: past its range with no projEnd it is dropped after this much more travel. */
const RANGE_SLACK = 40;
/** Stops that end a projectile outright (ProjectileView VANISHES): it is not left pinned at its end point. */
const VANISHES: ReadonlySet<ProjectileEnd> = new Set<ProjectileEnd>(["reflected", "deleted", "destroyed"]);
/** Finished projectile ids remembered, so a late launch never brings one back. */
const DONE_MAX = 256;

interface Flight {
  readonly id: string;
  readonly kind: ProjectileKind;
  readonly x0: number;
  readonly y0: number;
  readonly vx: number;
  readonly vy: number;
  readonly t0: ServerMs;
  readonly range: number;
  end: { readonly x: number; readonly y: number; readonly t: ServerMs; readonly reason: ProjectileEnd } | null;
  /** Credited once, when it is first due (the client's launch cue); undefined until then. */
  from: FighterId | null | undefined;
}

/** A world fx waiting for render time, with the frame that carried it (what was in its box then). */
interface Queued {
  readonly ev: ObservedEvent;
  readonly frame: Frame;
}

/** The two frames around a time, and how far between them it falls. */
interface Bracket {
  readonly a: Frame;
  readonly b: Frame | null;
  readonly k: number;
  /** The later frame carries a teleport: never slide across it (the client's interpolator cuts). */
  readonly cut: boolean;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
/** A fighter of a frame as far as sampling cares. */
type Placed = { readonly id: string; readonly x: number; readonly y: number };

/** Self-delay frame and its window centre, for one compose. */
interface View {
  readonly cx: number;
  readonly cy: number;
  readonly visible: ReadonlySet<FighterId>;
}

export class FrameRing implements FrameRingApi {
  private readonly frames: Frame[] = [];
  private readonly world: Queued[] = [];
  private readonly immediate: ObservedEvent[] = [];
  private readonly flights = new Map<string, Flight>();
  private readonly done = new Set<string>();
  /** When each fighter's death fx is stamped (mob fades, deaths still ahead of render time). */
  private readonly deathAt = new Map<FighterId, ServerMs>();
  private keepMs = DEFAULT_KEEP_MS;

  /** Frames held (tests). */
  get size(): number {
    return this.frames.length;
  }

  push(frame: Frame): void {
    const frames = this.frames;
    const last = frames[frames.length - 1];
    // Out of order: ignored, as the client's snapshot buffer does. The same time again replaces the frame.
    if (last && frame.t < last.t) return;
    if (last && frame.t === last.t) frames[frames.length - 1] = frame;
    else frames.push(frame);

    for (const ev of frame.events) {
      this.world.push({ ev, frame });
      if (ev.kind === "death") this.deathAt.set(ev.id, ev.t);
    }
    for (const ev of frame.immediate) this.immediate.push(ev);
    if (this.world.length > MAX_QUEUED) this.world.splice(0, this.world.length - MAX_QUEUED);
    if (this.immediate.length > MAX_QUEUED) this.immediate.splice(0, this.immediate.length - MAX_QUEUED);

    // As the client's ProjectileView hears of them on arrival: launches, then each stop point capping its flight.
    for (const p of frame.projectiles) {
      if (this.flights.has(p.id) || this.done.has(p.id)) continue;
      this.flights.set(p.id, {
        id: p.id, kind: p.kind, x0: p.x0, y0: p.y0, vx: p.vx, vy: p.vy, t0: p.t0, range: p.range, end: null, from: undefined,
      });
    }
    for (const ev of frame.events) {
      if (ev.kind !== "projEnd" || ev.at === null) continue;
      const flight = this.flights.get(ev.id);
      if (flight) flight.end = { x: ev.at.x, y: ev.at.y, t: ev.t, reason: ev.reason };
    }
    this.prune(frame.t);
  }

  compose(cfg: ComposeConfig): Percept | null {
    const frames = this.frames;
    const n = frames.length;
    if (n === 0) return null;
    this.keepMs = cfg.worldDelayMs + KEEP_EXTRA_MS;
    const now = frames[n - 1]!.t;
    const viewT = now - cfg.worldDelayMs;
    if (frames[0]!.t > viewT) return null;
    const selfT = now - cfg.selfDelayMs;
    const latest = this.frameAt(selfT) ?? frames[0]!;
    const self = latest.self;
    // The camera follows the drawn fighter, which the client keeps drawing from the snapshots until a teleport is drawn: until
    // render time reaches the cut, the screen is still the one around the old spot, not around where the patch has it now.
    const before = this.teleportBetween(viewT, latest.t) ? this.frameAt(viewT) : undefined;
    const eye = before ? this.selfAt(viewT) ?? self : self;
    const cx = eye.x, cy = eye.y;
    // What is drawn around that old spot: the latest frame only holds what is around the new one, so the last frame before the
    // cut stands in for it (for at most the render delay).
    const scene = before ?? latest;
    const sight = latest.hud.gatesLocked ? withGates(cfg.map) : cfg.map;

    const due = this.takeWorld(viewT);
    const pendingDeaths = new Set<FighterId>();
    const pendingBodies: Vec2[] = [];
    for (const q of this.world) {
      if (q.ev.kind !== "death") continue;
      pendingDeaths.add(q.ev.id);
      if (q.ev.at) pendingBodies.push(q.ev.at);
    }

    const now0 = this.bracket(viewT)!;
    const prevT = viewT - VELOCITY_MS;
    const prev = this.bracket(prevT);
    const prevSelf = this.frameAt(latest.t - VELOCITY_MS)?.self ?? null;
    const cut = this.teleportBetween(prevT, viewT);
    const central = cfg.attentionCentral;

    const fighters: Array<Mutable<FighterView>> = [];
    for (const f of scene.fighters) {
      // The latest patch decides who is drawn; a death still ahead of render time keeps the body standing (RaidScene).
      if (f.status !== "alive" && f.status !== "lobby" && !pendingDeaths.has(f.id)) continue;
      const at = this.sample(now0, "fighters", f.id) ?? f;
      if (!inView(cx, cy, at.x, at.y)) continue;
      const v = this.velocity(prev, prevSelf, "fighters", f.id, at, cut);
      const dx = at.x - cx, dy = at.y - cy;
      fighters.push({
        ...f, x: at.x, y: at.y, vx: v.x, vy: v.y, dist: Math.hypot(dx, dy), los: hasLineOfSight(sight, eye, at), tint: 0,
        central: isCentral(dx, dy, central),
      });
    }

    const mobs: MobView[] = [];
    for (const m of scene.mobs) {
      if (m.status !== "alive") {
        const died = this.deathAt.get(m.id);
        if (died === undefined || !(viewT < died + MOB_FADE_MS)) continue;
      }
      const at = this.sample(now0, "mobs", m.id) ?? m;
      if (!inView(cx, cy, at.x, at.y)) continue;
      const v = this.velocity(prev, prevSelf, "mobs", m.id, at, cut);
      const dx = at.x - cx, dy = at.y - cy;
      mobs.push({
        ...m, x: at.x, y: at.y, vx: v.x, vy: v.y, dist: Math.hypot(dx, dy), los: hasLineOfSight(sight, eye, at),
        central: isCentral(dx, dy, central),
      });
    }

    tintNearestFoe(latest, self, fighters, mobs);

    const visible = new Set<FighterId>([self.id]);
    for (const f of fighters) visible.add(f.id);
    for (const m of mobs) visible.add(m.id);
    const view: View = { cx, cy, visible };

    const containers: ContainerView[] = [];
    for (const c of scene.containers) {
      if (!inView(cx, cy, c.x, c.y)) continue;
      if (c.kind === "body" && pendingBodies.some((d) => Math.abs(c.x - d.x) < BODY_MATCH && Math.abs(c.y - d.y) < BODY_MATCH)) continue;
      containers.push({ ...c, dist: Math.hypot(c.x - cx, c.y - cy) });
    }

    const projectiles = this.fly(viewT, view, eye === self ? self : { ...self, x: cx, y: cy }, fighters, mobs);

    const events: ObservedEvent[] = [];
    for (const q of due) {
      const ev = deliver(q, view);
      if (ev) events.push(ev);
    }
    for (const ev of this.takeImmediate(selfT)) events.push(ev);

    return {
      now, viewT, self, hud: latest.hud, fighters, mobs, containers, projectiles, minimap: latest.minimap, events,
      extras: windowExtras(scene.extras, view, fighters, mobs, self), features: cfg.features,
    };
  }

  // ---------------------------------------------------------------------------------------------------------------- frames

  private prune(now: ServerMs): void {
    const frames = this.frames;
    const cutoff = now - this.keepMs;
    // Keep one frame at or before the cutoff, so the oldest time still needed has a bracket.
    while (frames.length > 2 && frames[1]!.t <= cutoff) frames.shift();
    while (frames.length > MAX_FRAMES) frames.shift();
    for (const [id, t] of this.deathAt) if (t + MOB_FADE_MS < cutoff - 2000) this.deathAt.delete(id);
  }

  /** The newest frame at or before `t`. */
  private frameAt(t: ServerMs): Frame | undefined {
    const frames = this.frames;
    for (let i = frames.length - 1; i >= 0; i--) if (frames[i]!.t <= t) return frames[i];
    return undefined;
  }

  /** A teleport fx stamped in (from, to]. */
  private teleportBetween(from: ServerMs, to: ServerMs): boolean {
    for (const f of this.frames) for (const e of f.events) if (e.kind === "teleport" && e.t > from && e.t <= to) return true;
    return false;
  }

  /** Where the bot itself is drawn at `t` from the snapshots (held across a cut, as the others are). */
  private selfAt(t: ServerMs): Vec2 | null {
    const br = this.bracket(t);
    if (!br) return null;
    const a = br.a.self, b = br.b?.self;
    if (!b || br.cut) return { x: a.x, y: a.y };
    return { x: a.x + (b.x - a.x) * br.k, y: a.y + (b.y - a.y) * br.k };
  }

  private bracket(t: ServerMs): Bracket | null {
    const frames = this.frames;
    let i = frames.length - 1;
    while (i >= 0 && frames[i]!.t > t) i--;
    if (i < 0) return null;
    const a = frames[i]!;
    const b = frames[i + 1] ?? null;
    if (b === null) return { a, b, k: 0, cut: false };
    return { a, b, k: (t - a.t) / (b.t - a.t), cut: b.events.some((e) => e.kind === "teleport") };
  }

  /** Where a fighter is drawn at the bracket's time: interpolated, never extrapolated, never slid across a teleport. */
  private sample(br: Bracket | null, which: "fighters" | "mobs", id: FighterId): Vec2 | null {
    if (!br) return null;
    const listA: readonly Placed[] = br.a[which];
    const pa = findById(listA, id);
    const listB: readonly Placed[] | null = br.b ? br.b[which] : null;
    const pb = listB ? findById(listB, id) : undefined;
    if (pa && pb) {
      if (br.cut || Math.hypot(pb.x - pa.x, pb.y - pa.y) > TELEPORT_DISTANCE) return { x: pa.x, y: pa.y };
      return { x: pa.x + (pb.x - pa.x) * br.k, y: pa.y + (pb.y - pa.y) * br.k };
    }
    const p = pa ?? pb;
    return p ? { x: p.x, y: p.y } : null;
  }

  /** u/s from the sample VELOCITY_MS earlier, when the fighter was on screen then too and no cut lies between (else 0). */
  private velocity(
    prev: Bracket | null, prevSelf: SelfView | null, which: "fighters" | "mobs", id: FighterId, at: Vec2, cut: boolean,
  ): Vec2 {
    if (!prevSelf || cut) return { x: 0, y: 0 };
    const q = this.sample(prev, which, id);
    if (!q || !inView(prevSelf.x, prevSelf.y, q.x, q.y) || Math.hypot(at.x - q.x, at.y - q.y) > TELEPORT_DISTANCE) return { x: 0, y: 0 };
    return { x: ((at.x - q.x) * 1000) / VELOCITY_MS, y: ((at.y - q.y) * 1000) / VELOCITY_MS };
  }

  // ---------------------------------------------------------------------------------------------------------------- events

  /** World fx due by viewT, oldest first, each handed out once. */
  private takeWorld(viewT: ServerMs): Queued[] {
    const due: Queued[] = [];
    let keep = 0;
    const q = this.world;
    for (let i = 0; i < q.length; i++) {
      const item = q[i]!;
      if (item.ev.t <= viewT) due.push(item);
      else q[keep++] = item;
    }
    q.length = keep;
    return due;
  }

  private takeImmediate(t: ServerMs): ObservedEvent[] {
    const due: ObservedEvent[] = [];
    let keep = 0;
    const q = this.immediate;
    for (let i = 0; i < q.length; i++) {
      const ev = q[i]!;
      if (ev.t <= t) due.push(ev);
      else q[keep++] = ev;
    }
    q.length = keep;
    return due;
  }

  // ----------------------------------------------------------------------------------------------------------- projectiles

  /** Every flight at viewT, as ProjectileView draws it; the ones in the window. A due stop ends it (FxView plays its projEnd). */
  private fly(viewT: ServerMs, view: View, self: SelfView, fighters: readonly FighterView[], mobs: readonly MobView[]): ProjectileView[] {
    const out: ProjectileView[] = [];
    for (const [id, fl] of this.flights) {
      const speed = Math.hypot(fl.vx, fl.vy);
      const travelled = speed * ((viewT - fl.t0) / 1000);
      if (fl.end ? viewT >= fl.end.t : travelled > fl.range + RANGE_SLACK) {
        this.finish(id);
        continue;
      }
      // Not loosed yet as drawn.
      if (!(travelled >= 0) || speed === 0) continue;
      const limit = fl.end ? Math.hypot(fl.end.x - fl.x0, fl.end.y - fl.y0) : fl.range;
      if (fl.end && VANISHES.has(fl.end.reason) && travelled >= limit) {
        this.finish(id);
        continue;
      }
      if (fl.from === undefined) fl.from = launcher(fl.x0, fl.y0, self, fighters, mobs);
      const d = Math.min(travelled, limit) / speed;
      const x = fl.x0 + fl.vx * d, y = fl.y0 + fl.vy * d;
      if (!inView(view.cx, view.cy, x, y)) continue;
      out.push({ id, kind: fl.kind, x, y, vx: fl.vx, vy: fl.vy, x0: fl.x0, y0: fl.y0, t0: fl.t0, range: fl.range, from: fl.from });
    }
    return out;
  }

  private finish(id: string): void {
    this.flights.delete(id);
    this.done.add(id);
    if (this.done.size > DONE_MAX) this.done.delete(this.done.values().next().value!);
  }
}

export function createFrameRing(): FrameRing {
  return new FrameRing();
}

/** A frame's lists are sorted by id (perception.ts), so a lookup is a binary search: no map built per frame. */
function findById<T extends { readonly id: string }>(list: readonly T[], id: string): T | undefined {
  let lo = 0, hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const at = list[mid]!.id;
    if (at === id) return list[mid];
    if (at < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

function isCentral(dx: number, dy: number, share: number): boolean {
  return Math.abs(dx) <= share * BOT_VIEW.halfW && Math.abs(dy) <= share * BOT_VIEW.halfH;
}

/**
 * The client's matchup tint (ui/screenFeedback.ts matchupTarget) is ONE hue for the nearest foe in sight within
 * MATCHUP_RANGE, players and mobs alike, only while the bot stands in an active run. It goes on that fighter if it is a
 * player; every other fighter reads 0.
 */
function tintNearestFoe(latest: Frame, self: SelfView, fighters: Array<Mutable<FighterView>>, mobs: readonly MobView[]): void {
  if (latest.hud.phase !== "active" || self.status !== "alive" || self.faction === null) return;
  let best = -1;
  let bestDist = MATCHUP_RANGE;
  let foe: { faction: FactionId; weapon: WeaponId | null } | null = null;
  for (let i = 0; i < fighters.length; i++) {
    const f = fighters[i]!;
    if (f.status !== "alive" || f.faction === null || !(f.dist < bestDist) || !f.los) continue;
    best = i;
    bestDist = f.dist;
    foe = { faction: f.faction, weapon: f.inHand };
  }
  for (const m of mobs) {
    if (m.status !== "alive" || m.faction === null || !(m.dist < bestDist) || !m.los) continue;
    best = -1;
    bestDist = m.dist;
    foe = null;
  }
  if (best < 0 || foe === null) return;
  const me = { faction: self.faction, weapon: self.weapons[self.slot] };
  fighters[best]!.tint = matchupTint(matchupScore(me, foe), bestDist);
}

/** The fighter drawn nearest a launch's origin within LAUNCH_NEAR (FxView's launch cue), among what the bot sees. */
function launcher(x: number, y: number, self: SelfView, fighters: readonly FighterView[], mobs: readonly MobView[]): FighterId | null {
  let best: FighterId | null = null;
  let bestSq = LAUNCH_NEAR * LAUNCH_NEAR;
  const consider = (id: FighterId, px: number, py: number): void => {
    const sq = (px - x) ** 2 + (py - y) ** 2;
    if (sq < bestSq) {
      best = id;
      bestSq = sq;
    }
  };
  if (self.status === "alive") consider(self.id, self.x, self.y);
  for (const f of fighters) consider(f.id, f.x, f.y);
  for (const m of mobs) consider(m.id, m.x, m.y);
  return best;
}

const maskId = (id: FighterId | null, view: View): FighterId | null => (id !== null && view.visible.has(id) ? id : null);

/**
 * One due world fx in the exact window: perception kept it in its box; this applies the window around the bot as it is
 * drawn now, and names an attacker or killer only when it is drawn too. Announcements carry no point and always pass.
 */
function deliver(q: Queued, view: View): ObservedEvent | null {
  const ev = q.ev;
  if (ev.at === null) return ev;
  const on = inView(view.cx, view.cy, ev.at.x, ev.at.y);
  switch (ev.kind) {
    case "death": {
      if (on) return ev.by === maskId(ev.by, view) ? ev : { ...ev, by: maskId(ev.by, view) };
      const kind = ev.mob ? findById(q.frame.mobs, ev.id)?.kind : undefined;
      if (kind === "mob") return null;
      // An elite's fall is announced with its killer; a player's (or a dummy's) only by name.
      return kind === "elite" ? { ...ev, at: null } : { ...ev, at: null, by: null };
    }
    case "hit":
    case "block": {
      if (!on) return null;
      const by = maskId(ev.by, view);
      return by === ev.by ? ev : { ...ev, by };
    }
    case "ext": {
      if (!on) return null;
      let data: Record<string, unknown> | null = null;
      for (const [k, v] of Object.entries(ev.data)) {
        if (typeof v !== "string" || view.visible.has(v) || !namesFighter(q.frame, v)) continue;
        data ??= { ...ev.data };
        data[k] = null;
      }
      return data ? { ...ev, data } : ev;
    }
    default:
      return on ? ev : null;
  }
}

function namesFighter(frame: Frame, id: string): boolean {
  return findById(frame.fighters, id) !== undefined || findById(frame.mobs, id) !== undefined;
}

/** The extras of the latest patch, cut to the window: effect bits of what is drawn, areas on screen. Chests are not: the minimap draws them all. */
function windowExtras(
  ex: PerceptExtras, view: View, fighters: readonly FighterView[], mobs: readonly MobView[], self: SelfView,
): PerceptExtras {
  if (Object.keys(ex).length === 0) return ex;
  const out: Mutable<PerceptExtras> = { ...ex };
  if (ex.effects) {
    const bits: Record<FighterId, number> = {};
    const put = (id: FighterId): void => {
      const v = ex.effects![id];
      if (v !== undefined) bits[id] = v;
    };
    put(self.id);
    for (const f of fighters) put(f.id);
    for (const m of mobs) put(m.id);
    out.effects = bits;
  }
  if (ex.fields) {
    out.fields = ex.fields
      .filter((f) => fieldInView(view.cx, view.cy, f))
      .map((f) => (f.owner === null || view.visible.has(f.owner) ? f : { ...f, owner: null }));
  }
  return out;
}
