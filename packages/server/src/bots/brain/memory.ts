// What a bot remembers of a run (docs/BOTS.md 3.5, 6.1) and what it notices in each new percept (2.4). `observe` folds one
// Percept into the MemoryView and returns the stimuli that are NEW in it: a thing is a stimulus the first time it appears, so
// a foe that stays on screen is one `newThreat`, a projectile is one `incoming`, a hit is one `hpLoss`. Everything here is
// derived from the percept alone (its events, its fighters, its minimap), never from the world, so the fairness suite's
// perturbations cannot reach it. Time is `percept.now`; nothing here draws a random number.
//
// Stimulus conventions (types.ts leaves `subject` and `value` open):
//   newThreat      subject = fighter, value = distance (u)
//   foeSwapped     subject = fighter
//   incoming       subject = projectile id, value = ms from the DRAWN position (percept.viewT) to the hit circle
//   windupAtMe     subject = attacker (player or mob), value = ms the windup still has to run when it was seen
//   drawAtMe       subject = attacker; value as windupAtMe for a `windup` fx, none for a draw read off `drawStartedAt`
//   hpLoss         subject = attacker when a hit named one, value = hp lost
//   lowHp          value = hp share
//   lockLost/targetDown   subject = the fighter the lock was on
//   orderFailed    subject = the fighter a `target` named, none for a move or stop
//   arrived        none
//   announcement   subject = the fighter named, value = bounty for a bounty
//   castSeen       subject = caster; chestUp = reward chest id; teleport/planOffer: none
// `clickMissed` cannot be seen in a percept (the humanizer owns it) and is never emitted here.
import {
  ENGAGE_TRADE_SECONDS, MOB_LEASH_RADIUS, PLAYER_RADIUS, PLAYER_SPEED, RANGED_HIT_REACH, WISH_COOLDOWN_SECONDS,
  type FactionId, type GameMap, type Vec2, type WeaponId,
} from "@raid/shared";
import {
  BOT_VIEW,
  type CampMemory, type ChoiceKey, type ContainerMemory, type Features, type FighterId, type FighterMemory, type MemoryApi,
  type MemoryView, type MobMemory, type ObservedEvent, type Percept, type SelfMemory, type ServerMs, type Stimulus,
  type StimulusKind, type TierParams, type TimedCommand,
} from "./types";

export interface MemoryConfig {
  readonly tier: TierParams;
  readonly map: GameMap;
  readonly selfId: FighterId;
  readonly features: Features;
}

/** A foe back on screen after this long off it is a new threat again (2.4). */
const REENTRY_MS = 3000;
/** An opponent's hp share is forgotten (back to "full") this long after it was last read off a bar. */
const HP_FORGET_MS = 20_000;
const TRADE_MS = ENGAGE_TRADE_SECONDS * 1000;
const RECENT_HIT_MS = 3000;
/** A windup or a draw is "at me" inside this range, when its aim line passes within AIM_LATERAL u of me. */
const FACING_RANGE = 400;
const AIM_LATERAL = 60;
const CHASE_COS = 0.7;
/** A chaser closes on me at least this fast along the line between us (u/s); a standing foe is not chasing. */
const CHASE_CLOSING = 20;
/** Two draw starts closer than this are the same draw (the `windup` fx and `drawStartedAt` both announce one). */
const DRAW_SAME_MS = 200;
/** A windup fx cancelled this long after its landing time is still a feint of that windup. */
const FEINT_SLACK_MS = 400;

const MOB_AWAKE_U = 24;
const MOB_CAMP_U = 40;
/** A rise in a mob's hp share (bar steps are 0.05) that marks it as walking home. */
const RISE_EPS = 0.02;
/** A mob walking home stays flagged until it arrives (it may leave the screen on the way); this bounds a flag that never sees the arrival. */
const RETURN_MAX_MS = 15_000;
const VISIT_U = 150;
const ARRIVE_U = 24;
const ORDER_CHECK_MS = 400;
/** A move is also taken as applied when the bot has walked this far (a driver that sends no `seq` leaves moveSeq alone). */
const WALKED_U = 8;
const PICKUP_TOAST_MS = 5000;
/** A loose weapon that has not been seen for this long is assumed taken by someone. */
const LOOSE_WEAPON_MS = 60_000;
const HIDDEN_MARGIN_U = 80;
/** A lock that dropped on a target this low is probably a kill whose death fx is still on its way (the world is drawn later than the HUD). */
const DYING_HP = 0.15;
const LOCK_WAIT_MS = 60;
const LOCK_GIVE_UP_MS = 1500;
const HP_CREDIT_MS = 500;
const HP_ALONE_SHARE = 0.02;

const PICKUP_REFUSED = [/nothing there/i, /nothing to take/i, /too far away/i, /can.?t reach that/i];

type Ev<K extends ObservedEvent["kind"]> = Extract<ObservedEvent, { kind: K }>;

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Does an attack aimed along `angle` from `origin` pass close enough to `at` for a human to call it "aimed at me"? */
function aimedAt(origin: Vec2, angle: number, at: Vec2): boolean {
  const d = dist(origin, at);
  if (d > FACING_RANGE) return false;
  if (d < 1) return true;
  const diff = Math.abs(angleDiff(angle, Math.atan2(at.y - origin.y, at.x - origin.x)));
  return diff < Math.PI / 2 && d * Math.sin(diff) <= AIM_LATERAL;
}

interface CampGeom {
  readonly id: string;
  readonly zone: FactionId;
  readonly elite: boolean;
  readonly x: number;
  readonly y: number;
  /** The territory a player must stand in to contest it. */
  readonly radius: number;
  readonly spots: readonly Vec2[];
}

function campGeoms(map: GameMap): CampGeom[] {
  if (map.camps.length > 0) {
    return map.camps.map((c) => ({
      id: c.id, zone: c.zone, elite: c.eliteSpot >= 0, x: c.x, y: c.y, radius: c.radius > 0 ? c.radius : c.r, spots: c.spots,
    }));
  }
  const out: CampGeom[] = [];
  for (const r of map.regions) {
    for (const c of r.mobCamps) out.push({ id: c.id, zone: c.region, elite: c.elite, x: c.x, y: c.y, radius: MOB_LEASH_RADIUS, spots: c.spots });
  }
  return out;
}

interface FighterAux {
  /** Read off a screen at least once (an announcement alone does not give a position). */
  everSeen: boolean;
  /** The bot has reacted to it being there; cleared when it comes back after REENTRY_MS or from hiding. */
  announced: boolean;
  visible: boolean;
  hpSeenAt: ServerMs;
  /** The last weapon seen in its hand (memory.inHand goes null when the hand is empty, this does not). */
  held: WeaponId | null;
  /** Vanished from the middle of the window with Wishes on: probably hidden, not walked off. */
  hiddenSuspect: boolean;
}

interface MobAux {
  dotted: boolean;
  /** The lowest hp share of the rise it is on (see foldMobs). */
  low: number;
  /** It was seen healing away from its spot: walking home, untouchable until it arrives. */
  returningUntil: ServerMs;
}

interface PendingOrder {
  readonly tc: TimedCommand;
  readonly moveSeq: number;
  readonly from: Vec2 | null;
  reflected: boolean;
  arrived: boolean;
  done: boolean;
}

interface HpCredit {
  readonly src: "hp" | "hit";
  amount: number;
  readonly t: ServerMs;
}

type Emit = (kind: StimulusKind, subject: string | null, at: Vec2 | null, value?: number, when?: ServerMs) => void;

interface Obs {
  readonly p: Percept;
  readonly now: ServerMs;
  readonly emit: Emit;
  /** Ids named by a death fx in this percept (players and mobs). */
  readonly deaths: Set<string>;
  /** hp the bot lost to hits in this percept's events. */
  hitSum: number;
  /** The HUD's coliseum flag changed since the last percept: the teleport dropped every lock and order. */
  flip: boolean;
}

export function createMemory(cfg: MemoryConfig): MemoryApi {
  const { tier, selfId } = cfg;
  const geoms = campGeoms(cfg.map);
  const fighters = new Map<FighterId, FighterMemory>();
  const mobs = new Map<FighterId, MobMemory>();
  const camps = new Map<string, CampMemory>();
  const containers = new Map<string, ContainerMemory>();
  const bounties = new Map<FighterId, number>();
  const choices: ChoiceKey[] = [];
  const selfMem: SelfMemory = {
    lastHitAt: null, lastHitByPlayerAt: null, lastDealtAt: null, recentDamage: 0, recentHits: [], teleportedAt: null, lastOrder: null, lastCast: null,
    stillSince: 0,
  };
  for (const g of geoms) camps.set(g.id, { id: g.id, zone: g.zone, elite: g.elite, aliveSeen: 0, clearedAt: null, contestedAt: null, visitedAt: null });

  const fAux = new Map<FighterId, FighterAux>();
  const mAux = new Map<FighterId, MobAux>();
  const campHad = new Map<string, boolean>();
  const windups = new Map<FighterId, { t: ServerMs; ms: number; atMe: boolean }>();
  const drawAt = new Map<FighterId, ServerMs>();
  const trades = new Map<string, ServerMs>();
  const incomingSeen = new Set<string>();
  const seenChests = new Set<string>();
  let recent: { t: ServerMs; by: FighterId | null; amount: number }[] = [];
  let credits: HpCredit[] = [];
  let stimuli: readonly Stimulus[] = [];

  let started = false;
  let stillAnchor: Vec2 = { x: 0, y: 0 };
  let prevHp = 0;
  let prevColiseum = false;
  let prevHpShare = 1;
  let prevTarget: FighterId | null = null;
  let dropped: { id: FighterId; at: ServerMs; intentional: boolean } | null = null;
  let pending: PendingOrder | null = null;
  let pickup: { id: string; at: ServerMs } | null = null;
  let lastMinimapT = Number.NEGATIVE_INFINITY;
  let lastMoveSeq = 0;
  let lastPos: Vec2 | null = null;
  let lastPlanEnd = -1;

  function blankFighter(id: FighterId, name: string): FighterMemory {
    return {
      id, name, bot: false, faction: null, weaponsSeen: [], inHand: null, otherSlot: null, seenAt: 0, pos: { x: 0, y: 0 },
      vel: { x: 0, y: 0 }, hpFrac: 1, bounty: 0, alive: true, diedAt: null, hitMeAt: null, hitByMeAt: null, damageToMe: 0,
      damageByMe: 0, engagedWith: null, engagedAt: null, chasingMe: false, wishSeenAt: null, wishReadyGuess: null, feints: 0,
      lastFeintAt: null,
    };
  }

  function fighterAux(id: FighterId): FighterAux {
    let a = fAux.get(id);
    if (!a) {
      a = { everSeen: false, announced: false, visible: false, hpSeenAt: 0, held: null, hiddenSuspect: false };
      fAux.set(id, a);
    }
    return a;
  }

  /** The record of a fighter an announcement named, made if it was never on screen. */
  function ensureFighter(id: FighterId, name: string): FighterMemory {
    let m = fighters.get(id);
    if (!m) {
      m = blankFighter(id, name);
      fighters.set(id, m);
      fighterAux(id);
    } else if (m.name === "" && name !== "") m.name = name;
    return m;
  }

  function campAt(at: Vec2): string | null {
    let best: string | null = null;
    let bestD = MOB_CAMP_U;
    for (const g of geoms) {
      for (const s of g.spots) {
        const d = dist(s, at);
        if (d <= bestD) { bestD = d; best = g.id; }
      }
    }
    return best;
  }

  function mobAux(id: FighterId): MobAux {
    let a = mAux.get(id);
    if (!a) {
      a = { dotted: false, low: 1, returningUntil: 0 };
      mAux.set(id, a);
    }
    return a;
  }

  // ----------------------------------------------------------------------------------------------------------- helpers

  /** Inside the attention centre of the current screen. */
  function central(me: Vec2, at: Vec2): boolean {
    const c = tier.attention.central;
    return Math.abs(at.x - me.x) <= c * BOT_VIEW.halfW && Math.abs(at.y - me.y) <= c * BOT_VIEW.halfH;
  }

  /** Where the percept draws `id` (a player or a mob), if it is on screen. */
  function drawnAt(p: Percept, id: FighterId): { pos: Vec2; hpFrac: number; status: string } | null {
    for (const f of p.fighters) if (f.id === id) return { pos: { x: f.x, y: f.y }, hpFrac: f.hpFrac, status: f.status };
    for (const m of p.mobs) if (m.id === id) return { pos: { x: m.x, y: m.y }, hpFrac: m.hpFrac, status: m.status };
    return null;
  }

  function posOf(p: Percept, id: FighterId, fallback: Vec2 | null): Vec2 | null {
    const d = drawnAt(p, id);
    if (d) return d.pos;
    const m = fighters.get(id);
    if (m && fighterAux(id).everSeen) return m.pos;
    const mob = mobs.get(id);
    if (mob) return mob.pos;
    return fallback;
  }

  /** Down for good as far as the bot can tell: a death fx, a drawn status, a dead record. */
  function isDown(o: Obs, id: FighterId): boolean {
    if (o.deaths.has(id)) return true;
    const d = drawnAt(o.p, id);
    if (d && d.status !== "alive") return true;
    if (fighters.get(id)?.alive === false) return true;
    return mobs.get(id)?.alive === false;
  }

  // ----------------------------------------------------------------------------------------------------------- self

  function foldSelf(o: Obs): void {
    const me = o.p.self;
    if (!started) {
      started = true;
      stillAnchor = { x: me.x, y: me.y };
      selfMem.stillSince = o.now;
      prevHp = me.hp;
      prevColiseum = o.p.hud.inColiseum;
    } else if (dist(me, stillAnchor) > 1) {
      stillAnchor = { x: me.x, y: me.y };
      selfMem.stillSince = o.now;
    }
    // The HUD flips with the bot's own frame, before the teleport fx is drawn: the lock and the walk it lost are not failures.
    o.flip = o.p.hud.inColiseum !== prevColiseum;
    prevColiseum = o.p.hud.inColiseum;
    if (o.flip) pending = null;
  }

  // ------------------------------------------------------------------------------------------------------- fighters

  function foldFighters(o: Obs): void {
    const { p, now, emit } = o;
    const me = p.self;
    const hidingPossible = cfg.features.statusEffects || p.features.statusEffects;
    const onScreen = new Set<FighterId>();
    for (const f of p.fighters) {
      if (f.id === selfId) continue;
      onScreen.add(f.id);
      let m = fighters.get(f.id);
      const a = fighterAux(f.id);
      if (!m) {
        m = blankFighter(f.id, f.name);
        fighters.set(f.id, m);
      }
      const known = a.everSeen && a.announced && !a.hiddenSuspect && now - m.seenAt <= REENTRY_MS;
      const here: Vec2 = { x: f.x, y: f.y };

      m.name = f.name;
      m.bot = f.bot;
      if (f.faction !== null) m.faction = f.faction;
      if (f.status === "dead" || f.status === "mia") {
        if (m.alive) { m.alive = false; m.diedAt = now; }
        bounties.delete(f.id);
      }

      if (f.inHand !== null) {
        if (!m.weaponsSeen.includes(f.inHand)) m.weaponsSeen.push(f.inHand);
        if (a.held !== null && a.held !== f.inHand) m.otherSlot = a.held;
        if (known && m.alive && m.inHand !== null && m.inHand !== f.inHand) emit("foeSwapped", f.id, here);
        a.held = f.inHand;
      }
      m.inHand = f.inHand;

      m.pos = here;
      m.vel = { x: f.vx, y: f.vy };
      m.hpFrac = f.hpFrac;
      a.hpSeenAt = now;
      m.bounty = f.bounty;
      if (m.alive) {
        if (f.bounty > 0) bounties.set(f.id, f.bounty);
        else bounties.delete(f.id);
      }
      m.chasingMe = m.alive && chasing(me, here, f.vx, f.vy);

      if (m.alive && f.status === "alive") {
        if (!known) emit("newThreat", f.id, here, dist(me, here));
        a.announced = true;
        a.hiddenSuspect = false;
        if (f.drawStartedAt > 0 && aimedAt(here, f.facing, me)) {
          const last = drawAt.get(f.id);
          if (last === undefined || Math.abs(f.drawStartedAt - last) > DRAW_SAME_MS) {
            drawAt.set(f.id, f.drawStartedAt);
            emit("drawAtMe", f.id, here);
          }
        }
      }
      m.seenAt = now;
      a.everSeen = true;
      a.visible = true;
    }

    for (const [id, a] of fAux) {
      const m = fighters.get(id);
      if (!m || onScreen.has(id)) continue;
      if (a.visible) {
        a.visible = false;
        // Gone from the middle of the window rather than off its edge: a hidden Wishes caster, not a walker.
        a.hiddenSuspect = hidingPossible && m.alive
          && Math.abs(m.pos.x - me.x) <= BOT_VIEW.halfW - HIDDEN_MARGIN_U && Math.abs(m.pos.y - me.y) <= BOT_VIEW.halfH - HIDDEN_MARGIN_U;
      }
      if (m.chasingMe && now - m.seenAt > 1500) m.chasingMe = false;
      if (a.everSeen && now - a.hpSeenAt > HP_FORGET_MS) m.hpFrac = 1;
    }
  }

  function chasing(me: Vec2, at: Vec2, vx: number, vy: number): boolean {
    const speed = Math.hypot(vx, vy);
    const d = dist(me, at);
    if (speed < CHASE_CLOSING || d < 1) return false;
    const toward = (vx * (me.x - at.x) + vy * (me.y - at.y)) / d;
    return toward >= CHASE_CLOSING && toward / speed > CHASE_COS;
  }

  // --------------------------------------------------------------------------------------------------------- events

  /** Records an exchange of blows between two other fighters; the second one inside TRADE_MS makes both "engaged". */
  function trade(victim: FighterId, by: FighterId | null, t: ServerMs): void {
    if (by === null || by === selfId || victim === selfId) return;
    const a = fighters.get(by);
    const b = fighters.get(victim);
    if (!a || !b) return;
    trades.set(`${by}>${victim}`, t);
    const back = trades.get(`${victim}>${by}`);
    if (back === undefined || Math.abs(t - back) > TRADE_MS) return;
    a.engagedWith = victim;
    a.engagedAt = t;
    b.engagedWith = by;
    b.engagedAt = t;
  }

  function onWindup(o: Obs, e: Ev<"windup">): void {
    const { p, emit } = o;
    windups.set(e.by, { t: e.t, ms: e.ms, atMe: false });
    if (e.by === selfId) return;
    const origin = posOf(p, e.by, e.at);
    if (!origin || !aimedAt(origin, e.a, p.self)) return;
    const w = windups.get(e.by);
    if (w) w.atMe = true;
    if (e.weapon === "bow") {
      const last = drawAt.get(e.by);
      if (last !== undefined && Math.abs(e.t - last) <= DRAW_SAME_MS) return;
      drawAt.set(e.by, e.t);
      emit("drawAtMe", e.by, origin, Math.max(0, e.t + e.ms - o.now));
    } else {
      emit("windupAtMe", e.by, origin, Math.max(0, e.t + e.ms - o.now));
    }
  }

  function onHit(o: Obs, e: Ev<"hit">): void {
    if (e.id === selfId) {
      selfMem.lastHitAt = e.t;
      o.hitSum += e.amount;
      recent.push({ t: e.t, by: e.by, amount: e.amount });
      const f = e.by === null ? undefined : fighters.get(e.by);
      if (f) {
        selfMem.lastHitByPlayerAt = e.t;
        f.hitMeAt = e.t;
        f.damageToMe += e.amount;
      }
      return;
    }
    if (e.by === selfId) {
      selfMem.lastDealtAt = e.t;
      const f = fighters.get(e.id);
      if (f) {
        f.hitByMeAt = e.t;
        f.damageByMe += e.amount;
      }
      return;
    }
    trade(e.id, e.by, e.t);
  }

  function onCancel(e: Ev<"cancel">): void {
    if (e.id === selfId) return;
    const w = windups.get(e.id);
    windups.delete(e.id);
    const f = fighters.get(e.id);
    if (!w || !w.atMe || !f || e.t - w.t > w.ms + FEINT_SLACK_MS) return;
    f.feints++;
    f.lastFeintAt = e.t;
  }

  function onDeath(o: Obs, e: Ev<"death">): void {
    o.deaths.add(e.id);
    if (e.mob) {
      const m = mobs.get(e.id);
      if (m) m.alive = false;
      return;
    }
    if (e.id === selfId) return;
    const f = ensureFighter(e.id, e.name);
    if (f.alive) { f.alive = false; f.diedAt = e.t; }
    f.bounty = 0;
    bounties.delete(e.id);
    o.emit("announcement", e.id, e.at);
  }

  function onBounty(o: Obs, e: Ev<"bounty">): void {
    if (e.id !== selfId) {
      const f = ensureFighter(e.id, e.name);
      f.bounty = e.bounty;
      if (e.bounty > 0 && f.alive) bounties.set(e.id, e.bounty);
      else bounties.delete(e.id);
    }
    o.emit("announcement", e.id, null, e.bounty);
  }

  function onToast(o: Obs, e: Ev<"toast">): void {
    if (!pickup || o.now - pickup.at > PICKUP_TOAST_MS) return;
    if (!PICKUP_REFUSED.some((re) => re.test(e.text))) return;
    const c = containers.get(pickup.id);
    if (c) c.skipped = true;
    pickup = null;
  }

  /**
   * A Wish landing on screen: `castLand` = { by, ability, target, x, y, x2?, y2? } (shared FxEvent), `by` named only when the
   * caster is drawn. A human counts the cooldown from the cast they saw. (`cast` and `castEnd` carry the same `by`, and `status`
   * names its target as `id`: none of them is a landing.)
   */
  function onExt(o: Obs, e: Ev<"ext">): void {
    if (e.fx !== "castLand") return;
    const by = e.data["by"];
    const who = typeof by === "string" ? by : null;
    if (who === selfId) return;
    if (who !== null) {
      const f = fighters.get(who);
      if (f) {
        f.wishSeenAt = e.t;
        f.wishReadyGuess = e.t + WISH_COOLDOWN_SECONDS * 1000;
      }
    }
    o.emit("castSeen", who, e.at);
  }

  function foldEvents(o: Obs): void {
    let planSeen = false;
    for (const e of o.p.events) {
      switch (e.kind) {
        case "windup": onWindup(o, e); break;
        case "swing": windups.delete(e.by); break;
        case "hit": onHit(o, e); break;
        case "block": trade(e.id, e.by, e.t); break;
        case "cancel": onCancel(e); break;
        case "death": onDeath(o, e); break;
        case "teleport":
          selfMem.teleportedAt = e.t;
          pending = null;
          dropped = null;
          o.emit("teleport", null, null);
          break;
        case "bounty": onBounty(o, e); break;
        case "victory": o.emit("announcement", e.id, null); break;
        case "toast": onToast(o, e); break;
        case "private":
          if (e.type === "plan" && !o.p.extras.plan) planSeen = true;
          break;
        case "ext": onExt(o, e); break;
        default: break;
      }
    }
    if (planSeen) o.emit("planOffer", null, null);
  }

  // ------------------------------------------------------------------------------------------- mobs, camps, containers

  function foldMobs(o: Obs): void {
    const { p, now } = o;
    if (p.minimap.t !== lastMinimapT) {
      lastMinimapT = p.minimap.t;
      const live = new Set<FighterId>();
      for (const d of p.minimap.mobs) {
        live.add(d.id);
        const a = mobAux(d.id);
        a.dotted = true;
        let m = mobs.get(d.id);
        if (!m) {
          const home = { x: d.x, y: d.y };
          m = {
            id: d.id, kind: d.elite ? "elite" : "mob", faction: d.faction, home, campId: campAt(home), pos: { x: d.x, y: d.y },
            dotAt: p.minimap.t, seenAt: null, hpFrac: 1, inHand: null, awake: false, returning: false, alive: true,
          };
          mobs.set(d.id, m);
          continue;
        }
        if (!m.alive) continue;
        m.pos = { x: d.x, y: d.y };
        m.dotAt = p.minimap.t;
      }
      // A dot that is gone is a dead mob (mobs do not respawn); a mob never dotted (seen on screen only) is not judged by it.
      for (const [id, m] of mobs) if (m.alive && mAux.get(id)?.dotted && !live.has(id)) m.alive = false;
    }

    for (const v of p.mobs) {
      if (v.kind === "dummy") continue;
      const a = mobAux(v.id);
      let m = mobs.get(v.id);
      if (!m) {
        const home = { x: v.x, y: v.y };
        m = {
          id: v.id, kind: v.kind, faction: v.faction, home, campId: campAt(home), pos: home, dotAt: now, seenAt: null, hpFrac: v.hpFrac,
          inHand: v.inHand, awake: false, returning: false, alive: true,
        };
        mobs.set(v.id, m);
      }
      if (!m.alive) continue;
      m.kind = v.kind;
      if (v.faction !== null) m.faction = v.faction;
      m.pos = { x: v.x, y: v.y };
      m.inHand = v.inHand;
      if (v.status !== "alive") {
        m.alive = false;
        o.deaths.add(v.id);
        continue;
      }
      // Healing while away from its spot is what a mob walking home does. `low` is where the rise began, so a slow climb counts
      // as well as a jump; being hurt again means it is not untouchable after all.
      if (m.seenAt === null || v.hpFrac < m.hpFrac) {
        a.low = v.hpFrac;
        a.returningUntil = 0;
      }
      if (!offHome(m)) a.low = v.hpFrac;
      else if (v.hpFrac > a.low + RISE_EPS) a.returningUntil = now + RETURN_MAX_MS;
      m.hpFrac = v.hpFrac;
      m.seenAt = now;
    }

    for (const m of mobs.values()) {
      if (!m.alive) {
        m.awake = false;
        m.returning = false;
        continue;
      }
      const off = offHome(m);
      const a = mobAux(m.id);
      if (!off) a.returningUntil = 0;
      m.returning = off && now < a.returningUntil;
      // As MobTracker has it: a mob walking home is no longer fighting anyone.
      m.awake = off && !m.returning;
    }
  }

  function offHome(m: MobMemory): boolean {
    return m.home !== null && dist(m.pos, m.home) > MOB_AWAKE_U;
  }

  function foldCamps(o: Obs): void {
    const { p, now } = o;
    const me = p.self;
    const alive = new Map<string, number>();
    for (const m of mobs.values()) if (m.alive && m.campId !== null) alive.set(m.campId, (alive.get(m.campId) ?? 0) + 1);
    const views = new Map<string, number>();
    for (const c of p.extras.camps ?? []) views.set(c.id, c.state);
    for (const g of geoms) {
      const c = camps.get(g.id)!;
      const n = alive.get(g.id) ?? 0;
      c.aliveSeen = n;
      if (n > 0) {
        campHad.set(g.id, true);
        c.clearedAt = null;
      } else if (campHad.get(g.id) && c.clearedAt === null) {
        c.clearedAt = now;
      }
      if (views.get(g.id) === 2 && c.clearedAt === null) c.clearedAt = now;
      if (dist(me, g) <= VISIT_U) c.visitedAt = now;
      for (const f of p.fighters) {
        if (f.id !== selfId && f.status === "alive" && dist(f, g) <= g.radius) c.contestedAt = now;
      }
    }
  }

  function foldContainers(o: Obs): void {
    const { p, now } = o;
    const seen = new Set<string>();
    for (const c of p.containers) {
      seen.add(c.id);
      const m = containers.get(c.id);
      if (!m) {
        containers.set(c.id, { id: c.id, kind: c.kind, pos: { x: c.x, y: c.y }, closed: c.closed, weapon: c.weapon, seenAt: now, skipped: false });
        continue;
      }
      m.kind = c.kind;
      m.pos = { x: c.x, y: c.y };
      m.closed = c.closed;
      if (c.weapon !== undefined) m.weapon = c.weapon;
      m.seenAt = now;
    }
    // What a human would think of a weapon left lying out of sight for a minute: someone took it. (A chest stays, shut or open.)
    for (const m of containers.values()) {
      if (seen.has(m.id) || m.kind !== "ground" || now - m.seenAt <= LOOSE_WEAPON_MS) continue;
      m.closed = false;
      m.weapon = null;
    }
  }

  // ----------------------------------------------------------------------------------------------------- projectiles

  /** ms until the projectile enters the hit circle around `me` if both keep their course, or null when it never does. */
  function timeToImpact(pr: Percept["projectiles"][number], me: Vec2): number | null {
    const speed = Math.hypot(pr.vx, pr.vy);
    if (speed < 1e-6) return null;
    const ux = pr.vx / speed;
    const uy = pr.vy / speed;
    const left = Math.max(0, pr.range - Math.hypot(pr.x - pr.x0, pr.y - pr.y0));
    const dx = me.x - pr.x;
    const dy = me.y - pr.y;
    const along = dx * ux + dy * uy;
    const perp = Math.abs(dx * uy - dy * ux);
    const reach = RANGED_HIT_REACH + PLAYER_RADIUS;
    if (perp > reach) return null;
    const half = Math.sqrt(reach * reach - perp * perp);
    if (along < -half) return null;
    const enter = Math.max(0, along - half);
    return enter > left ? null : (enter / speed) * 1000;
  }

  function foldProjectiles(o: Obs): void {
    const live = new Set<string>();
    for (const pr of o.p.projectiles) {
      live.add(pr.id);
      if (incomingSeen.has(pr.id) || pr.from === selfId) continue;
      const ms = timeToImpact(pr, o.p.self);
      if (ms === null) continue;
      incomingSeen.add(pr.id);
      o.emit("incoming", pr.id, pr, ms);
    }
    for (const id of incomingSeen) if (!live.has(id)) incomingSeen.delete(id);
  }

  // ----------------------------------------------------------------------------------------- the bot's own state

  function takeCredit(src: HpCredit["src"], amount: number): number {
    let left = amount;
    for (const c of credits) {
      if (c.src !== src || left <= 0) continue;
      const take = Math.min(c.amount, left);
      c.amount -= take;
      left -= take;
    }
    return left;
  }

  /**
   * A hit shows twice: the hp bar drops with the bot's own frame and the hit fx follows with the world's (about 100 ms later). Each
   * source is credited to the other so one hit is one hpLoss; a small hp drop with no hit fx (a burn) is not a stimulus.
   */
  function foldHpLoss(o: Obs): void {
    const me = o.p.self;
    credits = credits.filter((c) => o.now - c.t <= HP_CREDIT_MS && c.amount > 1e-9);
    const drop = Math.max(0, prevHp - me.hp);
    prevHp = me.hp;
    const dropNet = drop >= Math.max(1, HP_ALONE_SHARE * me.maxHp) ? takeCredit("hit", drop) : 0;
    const hitNet = o.hitSum > 0 ? takeCredit("hp", o.hitSum) : 0;
    const loss = Math.max(dropNet, hitNet);
    credits = credits.filter((c) => c.amount > 1e-9);
    if (loss <= 0) return;
    if (dropNet > hitNet) credits.push({ src: "hp", amount: dropNet - hitNet, t: o.now });
    else if (hitNet > dropNet) credits.push({ src: "hit", amount: hitNet - dropNet, t: o.now });
    const by = recent.length > 0 ? recent[recent.length - 1]!.by : null;
    o.emit("hpLoss", o.hitSum > 0 && by !== null && fighters.has(by) ? by : null, null, loss);
  }

  function foldLowHp(o: Obs): void {
    const me = o.p.self;
    const share = me.maxHp > 0 ? me.hp / me.maxHp : 1;
    if (prevHpShare >= 0.5 && share < 0.5) o.emit("lowHp", null, null, share);
    prevHpShare = share;
  }

  /** A move or stop the bot sent just before the lock vanished explains it. */
  function droppedOnPurpose(now: ServerMs): boolean {
    const t = selfMem.lastOrder;
    return t !== null && (t.cmd.type === "move" || t.cmd.type === "stop") && now - t.at <= 1000;
  }

  function foldLock(o: Obs): void {
    const { p, now } = o;
    const target = p.self.attackTarget;
    if (prevTarget !== null && target !== prevTarget) {
      dropped = target === null ? { id: prevTarget, at: now, intentional: droppedOnPurpose(now) } : null;
    }
    prevTarget = target;
    if (target !== null || o.flip) dropped = null;
    if (!dropped) return;

    const d = dropped;
    const where = posOf(p, d.id, null);
    if (isDown(o, d.id)) {
      dropped = null;
      if (!d.intentional) o.emit("targetDown", d.id, where);
      return;
    }
    if (d.intentional) { dropped = null; return; }
    const seen = drawnAt(p, d.id);
    if (!seen) {
      // Out of the window and not announced dead: give the death announcement time to arrive, then let it go.
      if (now - d.at > LOCK_GIVE_UP_MS) dropped = null;
      return;
    }
    const lag = Math.max(0, now - p.viewT);
    if (seen.hpFrac > DYING_HP || now - d.at >= lag + LOCK_WAIT_MS) {
      dropped = null;
      o.emit("lockLost", d.id, seen.pos, undefined, d.at);
    }
  }

  function foldOrders(o: Obs): void {
    const { p, now } = o;
    const me = p.self;
    const order = pending;
    if (order && !order.done) {
      const c = order.tc.cmd;
      if (!order.reflected) {
        if (c.type === "move") {
          const seq = c.msg.seq;
          order.reflected = typeof seq === "number" ? me.moveSeq === seq : me.moveSeq !== order.moveSeq || (order.from !== null && dist(me, order.from) > WALKED_U);
        } else if (c.type === "stop") {
          // Without a seq nothing in a percept says whether a stop was applied.
          order.reflected = typeof c.msg.seq === "number" ? me.moveSeq === c.msg.seq : true;
        } else if (c.type === "target") {
          order.reflected = me.attackTarget === c.msg.id;
        }
      }
      if (c.type === "move" && !order.arrived && dist(me, c.msg) <= ARRIVE_U) {
        order.arrived = true;
        order.done = true;
        o.emit("arrived", null, null);
      } else if (!order.reflected && now - order.tc.at >= ORDER_CHECK_MS) {
        order.done = true;
        o.emit("orderFailed", c.type === "target" ? c.msg.id : null, null);
      }
    }
    lastMoveSeq = me.moveSeq;
    lastPos = { x: me.x, y: me.y };
  }

  function foldExtras(o: Obs): void {
    const { p } = o;
    if (p.extras.plan && p.extras.plan.endsAt !== lastPlanEnd) {
      lastPlanEnd = p.extras.plan.endsAt;
      o.emit("planOffer", null, null);
    }
    for (const c of p.extras.chests ?? []) {
      if (c.picked || seenChests.has(c.id)) continue;
      seenChests.add(c.id);
      o.emit("chestUp", c.id, { x: c.x, y: c.y });
    }
  }

  // ------------------------------------------------------------------------------------------------------ the API

  function observe(p: Percept): readonly Stimulus[] {
    const now = p.now;
    const me = p.self;
    const out: Stimulus[] = [];
    const emit: Emit = (kind, subject, at, value, when = now) => {
      const s: Stimulus = { kind, at: when, subject, central: at === null || central(me, at) };
      out.push(value === undefined ? s : { ...s, value });
    };
    const o: Obs = { p, now, emit, deaths: new Set(), hitSum: 0, flip: false };

    foldSelf(o);
    foldFighters(o);
    foldEvents(o);
    foldMobs(o);
    foldCamps(o);
    foldContainers(o);
    foldProjectiles(o);
    foldHpLoss(o);
    foldLowHp(o);
    foldLock(o);
    foldOrders(o);
    foldExtras(o);

    recent = recent.filter((h) => now - h.t <= RECENT_HIT_MS);
    selfMem.recentHits = recent.slice();
    selfMem.recentDamage = recent.reduce((sum, h) => sum + h.amount, 0);
    // A dead bot is a spectator: it still reads the announcements.
    const alive = me.status !== "dead" && me.status !== "mia";
    stimuli = alive ? out : out.filter((s) => s.kind === "announcement");
    return stimuli;
  }

  function noteSent(tc: TimedCommand): void {
    const c = tc.cmd;
    if (c.type === "pickup") {
      pickup = { id: c.msg.containerId, at: tc.at };
      return;
    }
    if (c.type === "cast") {
      selfMem.lastCast = tc;
      return;
    }
    if (c.type !== "move" && c.type !== "stop" && c.type !== "target") return;
    selfMem.lastOrder = tc;
    pending = { tc, moveSeq: lastMoveSeq, from: lastPos, reflected: false, arrived: false, done: false };
  }

  const view: MemoryView = {
    fighters,
    mobs,
    camps,
    containers,
    self: selfMem,
    get stimuli() { return stimuli; },
    bounties,
    choices,
    whereabouts(id, now) {
      const m = fighters.get(id);
      if (!m || !m.alive || !fAux.get(id)?.everSeen) return null;
      const age = Math.max(0, now - m.seenAt);
      if (age > tier.memorySpanMs) return null;
      return { at: { x: m.pos.x, y: m.pos.y }, radius: 0.6 * PLAYER_SPEED * (age / 1000) };
    },
  };

  return {
    observe,
    noteSent,
    recordChoice(key) { choices.push(key); },
    view,
  };
}
