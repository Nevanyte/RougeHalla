// What a headless bot does about the regional mobs (GAME_DESIGN 11). Pure: it reads a snapshot of the room (the bot, the
// standing players, the mobs) and answers "who do I fight now": a player, a mob, or run away. BotClient executes the
// answer by locking the foe (the server chases and attacks it) or walking away; nothing here touches a socket or the clock.
//
// The rules, in order:
//   1. Inside the coliseum (after the teleport) there are no mobs to reach: hunt players.
//   2. A player close by (playerThreat), or one that hit us lately with one in bow range, takes priority and keeps it until
//      it is playerRelease away: the hunt is what the bots did before mobs existed. (A mob's blows are not a player's shots:
//      the caller attributes each hit, see HuntInput.shotByPlayerAt.)
//   3. Low hp (retreatHp) in a mob fight with an awake mob near: run from the awake mobs and the players, and stay off mobs.
//   4. Otherwise farm mobs, while the run has budget left: the kill goal is not reached and mobs have not eaten more than
//      focusBudgetMs of the bot's time. The target is the best of the alive mobs within reach of a path it can walk: one the
//      bot's faction beats in a duel (matchupShare), that a carried weapon works on (not useless) and that does not fight
//      from range (those back off out of their leash), nearest first, favouring a weapon edge, a weapon type we lack, and a
//      mob no other player is nearer to; elites wait for card power, normal-mob stat progression, or full hp.
//   5. A target is dropped (and left alone for a while) when it never gets hurt: it went home (a mob walking home is
//      untouchable and shows no flag, but its hp rises), the attacks are not landing, or the chase is taking too long.
import {
  campMatchup, isFactionId, isRanged, isRegionalKind, isWeaponId, matchupShare, nearestCamps, REGION_WEAPONS,
  TILE, weaponEdge, FISTS, MOB_STAT_CAP, MOB_STAT_REWARDS, mobStatCount, type FactionId, type GameMap, type PlanMessage, type Vec2, type WeaponId, type MobStatCounts, type MobTypeId,
} from "@raid/shared";

// It moved to shared (planning.ts) for the planning screen; re-exported so the bots' callers keep their import.
export { matchupShare };

/** The part of a state.mobs entry the hunt reads. */
export interface MobLike {
  kind: string;
  status: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  faction: string;
  weapon0: string;
  /** MobTypeId, only when learned from a visible mob. */
  type?: MobTypeId;
}

/** `[id, mob]` pairs: a Colyseus MapSchema and a Map both iterate like this. */
export type MobEntries = Iterable<readonly [string, MobLike]>;

export interface MobHuntConfig {
  /** A standing player this close (u) is hunted instead of mobs... */
  playerThreat: number;
  /** ...until it is this far, and one that hit us is a threat inside this range (a bow's reach). */
  playerRelease: number;
  underFireRange: number;
  /** A hit by a player within this long (ms) counts as "being shot". */
  underFireMs: number;
  /** Mobs farther than this in a straight line are not considered, and a walk longer than reach x walkSlack is too far... */
  reach: number;
  /** ...except for a bot that has not killed a mob yet, which will walk this far (u) for its first. */
  firstReach: number;
  walkSlack: number;
  /** Walking distances are computed for this many of the nearest candidates only. */
  maxCandidates: number;
  /** No new mob fight below this hp share. */
  startMinHp: number;
  /** Elites need this much card power or per-type normal mob kills, unless at this hp share. */
  eliteMinPower: number;
  eliteFullHp: number;
  /**
   * The share of its hp the bot's faction keeps in a straight duel with the mob (matchupShare) must reach this to take the mob
   * on: mobMinShare for a normal mob, eliteMinShare for an elite (eliteSureShare when card power or normal-mob kill stacks reach eliteSurePower).
   */
  mobMinShare: number;
  eliteMinShare: number;
  eliteSureShare: number;
  eliteSurePower: number;
  /** Below this hp share, on a mob with an awake one within retreatClear, the bot runs for retreatMinMs to retreatMaxMs, then stays off mobs for retreatBanMs. */
  retreatHp: number;
  retreatClear: number;
  retreatMinMs: number;
  retreatMaxMs: number;
  retreatBanMs: number;
  /** Mob kills (the server's count) after which the bot stops farming, and the most time a run may spend with a mob focus. */
  killGoal: number;
  focusBudgetMs: number;
  /** A target is dropped after: this long since picked; this long attacking without hurting it; this long not attacking and not hurting it. */
  targetBudgetMs: number;
  stallAttackMs: number;
  approachMs: number;
  /** How long a dropped target is left alone: one that went home / one that never got hurt. */
  returnBanMs: number;
  stallBanMs: number;
  /** A mob this far (u) from where it was first seen is awake (it left its camp). */
  awakeMoved: number;
  /** Leave mobs that fight from range (a bow, a wand) alone. */
  skipRanged: boolean;
  /** After a pick found nothing, look again no sooner than this. */
  repickMs: number;
}

export const MOB_HUNT: Readonly<MobHuntConfig> = {
  playerThreat: 250,
  playerRelease: 450,
  underFireRange: 520,
  underFireMs: 1500,
  reach: 700,
  firstReach: 1100,
  walkSlack: 1.25,
  maxCandidates: 6,
  startMinHp: 0.5,
  eliteMinPower: 4,
  eliteFullHp: 0.9,
  mobMinShare: 0.5,
  eliteMinShare: 0.6,
  eliteSureShare: 0.4,
  eliteSurePower: 6,
  retreatHp: 0.35,
  retreatClear: 320,
  retreatMinMs: 1500,
  retreatMaxMs: 5000,
  retreatBanMs: 40_000,
  killGoal: 5,
  focusBudgetMs: 150_000,
  targetBudgetMs: 60_000,
  stallAttackMs: 3000,
  approachMs: 12_000,
  returnBanMs: 8000,
  stallBanMs: 30_000,
  awakeMoved: 40,
  skipRanged: true,
  repickMs: 400,
};

/** Score (lower is better, in units of walking distance) of the things that make a mob a better or worse meal. */
const EDGE_BONUS = 90;
const SHARE_BONUS = 200;
/** (skipRanged off) A melee bot after a ranged mob has to catch a target that backs away: it often cannot before the mob leaves its leash. */
const KITER_PENALTY = 200;
const EDGE_PENALTY = 400;
/** Another player is nearer to the mob than we are: it will be there first, and two bots on one mob end up fighting each other. */
const CONTEST_PENALTY = 350;
/** Weaker mobs die sooner: this much score per point of max hp. */
const HP_WEIGHT = 0.12;
const NEW_WEAPON_BONUS = 120;
const ELITE_PENALTY = 120;

/** A hp rise this big in one observation means the mob is healing, which only a mob walking home does. */
const RISE_EPS = 0.5;
const RISE_HOLD_MS = 1500;

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const asWeapon = (def: string): WeaponId | null => (isWeaponId(def) ? def : null);

/** What the bot has seen of each mob: where it first stood (its camp spot) and whether its hp is rising. */
export class MobTracker {
  private readonly rec = new Map<string, { mob: MobLike; home: Vec2; hp: number; risingUntil: number }>();

  /** Call with the current mobs every think. Forgets mobs that left the state. */
  observe(mobs: MobEntries, now: number): void {
    let seen = 0;
    for (const [id, m] of mobs) {
      if (!isRegionalKind(m.kind)) continue;
      seen++;
      const r = this.rec.get(id);
      if (!r) {
        this.rec.set(id, { mob: m, home: { x: m.x, y: m.y }, hp: m.hp, risingUntil: 0 });
        continue;
      }
      r.mob = m;
      if (m.status === "alive" && m.hp > r.hp + RISE_EPS) r.risingUntil = now + RISE_HOLD_MS;
      r.hp = m.hp;
    }
    if (this.rec.size > seen) {
      const live = new Set<string>();
      for (const [id] of mobs) live.add(id);
      for (const id of [...this.rec.keys()]) if (!live.has(id)) this.rec.delete(id);
    }
  }

  mob(id: string): MobLike | null {
    return this.rec.get(id)?.mob ?? null;
  }

  home(id: string): Vec2 | null {
    return this.rec.get(id)?.home ?? null;
  }

  /** Its hp was rising a moment ago: it is walking home (untouchable, ignoring everyone). */
  returning(id: string, now: number): boolean {
    const r = this.rec.get(id);
    return r !== undefined && now < r.risingUntil;
  }

  /** Alive, not heading home, and away from its camp spot or hurt: it is fighting somebody. */
  awake(id: string, now: number, awakeMoved: number): boolean {
    const r = this.rec.get(id);
    if (!r || r.mob.status !== "alive" || now < r.risingUntil) return false;
    return dist(r.mob, r.home) > awakeMoved || r.mob.hp < r.mob.maxHp - RISE_EPS;
  }

  /** Positions of the awake mobs within `radius` of `from`. */
  awakeNear(from: Vec2, radius: number, now: number, awakeMoved: number): Vec2[] {
    const out: Vec2[] = [];
    for (const [id, r] of this.rec) {
      if (dist(r.mob, from) <= radius && this.awake(id, now, awakeMoved)) out.push({ x: r.mob.x, y: r.mob.y });
    }
    return out;
  }
}

/** What the hunt reads about the bot itself. */
export interface HuntSelf {
  /** The bot's faction, or null when unknown (every mob is then taken to be an even match). */
  faction: FactionId | null;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** The carried weapons (both slots; null = empty). */
  weapons: readonly (WeaponId | null)[];
  /** The bot's card power (shared cards.ts cardPower: the sum of tier x count over its build). */
  power: number;
  /** The server's count of mobs this bot killed. */
  mobKills: number;
  /** Per-type stat progression, read from this bot only. */
  mobStats?: MobStatCounts;
}

export interface HuntInput {
  /** Any steadily rising clock in ms. */
  now: number;
  self: HuntSelf;
  /** Straight-line distance to the nearest standing enemy player; Infinity when there is none. */
  playerDistance: number;
  /** Positions of the standing enemy players. */
  players: readonly Vec2[];
  /** The arena has teleported everyone into the coliseum. */
  inColiseum: boolean;
  mobs: MobEntries;
  /** Walking distance from the bot to a point, or null when there is no path. */
  walk: (to: Vec2) => number | null;
  /** The bot is attacking something now (it is locked on a foe and in reach of it). */
  attacking: boolean;
  /**
   * When (the `now` clock) a player last hit the bot; -Infinity if none has. Not "hp lost": a mob's blows lose hp too, and a
   * bot that read them as a player's fire dropped its mob fight for a player that never shot.
   */
  shotByPlayerAt: number;
}

export type HuntDecision =
  | { kind: "player"; why: string }
  | { kind: "mob"; id: string; why: string }
  | { kind: "retreat"; from: Vec2[]; why: string };

interface Engagement {
  id: string;
  since: number;
  bestHp: number;
  /** Time attacking without the mob losing hp, and time not attacking without it losing hp. */
  stallMs: number;
  approachMs: number;
}

export interface MobHuntStats {
  /** Mob targets picked. */
  targets: number;
  /** Targets dropped because they never got hurt (went home, shots not landing, too slow). */
  drops: number;
  retreats: number;
  /** Time spent with a mob focus (ms). */
  focusMs: number;
}

function mobTypeProgress(stacks: MobStatCounts): number {
  const totalKills = MOB_STAT_REWARDS.reduce((total, reward) => total + mobStatCount(stacks, reward.id), 0);
  return totalKills / MOB_STAT_CAP;
}

export class MobHunter {
  readonly tracker = new MobTracker();
  readonly stats: MobHuntStats = { targets: 0, drops: 0, retreats: 0, focusMs: 0 };
  private readonly banned = new Map<string, number>();
  private eng: Engagement | null = null;
  private lastAt = 0;
  private lastKind: HuntDecision["kind"] = "player";
  private playerLock = false;
  private retreatUntil = 0;
  private retreatMinUntil = 0;
  private mobBanUntil = 0;
  private nextPickAt = 0;

  /** `log` hears every drop and retreat with its reason (BotClient prints them with --verbose). */
  constructor(readonly cfg: Readonly<MobHuntConfig> = MOB_HUNT, private readonly log: (msg: string) => void = () => {}) {}

  /** The mob the hunt is on, if any. */
  get target(): string | null {
    return this.eng?.id ?? null;
  }

  isBanned(id: string, now: number): boolean {
    const until = this.banned.get(id);
    if (until === undefined) return false;
    if (now >= until) { this.banned.delete(id); return false; }
    return true;
  }

  /** Positions of the awake mobs near `from` (a weapon detour, or a retreat, wants to stay away from them). */
  awakeNear(from: Vec2, radius: number, now: number): Vec2[] {
    return this.tracker.awakeNear(from, radius, now, this.cfg.awakeMoved);
  }

  decide(inp: HuntInput): HuntDecision {
    const dt = this.lastAt > 0 ? Math.min(250, Math.max(0, inp.now - this.lastAt)) : 0;
    this.lastAt = inp.now;
    this.tracker.observe(inp.mobs, inp.now);
    if (this.lastKind === "mob") this.stats.focusMs += dt;
    const out = this.choose(inp, dt);
    this.lastKind = out.kind;
    return out;
  }

  private choose(inp: HuntInput, dt: number): HuntDecision {
    const c = this.cfg;
    const { now, self } = inp;
    if (inp.inColiseum) {
      this.eng = null;
      return { kind: "player", why: "coliseum" };
    }

    // A player close by, or shooting at us, wins; the lock is held until it is clearly gone.
    const near = inp.playerDistance;
    if (near < c.playerThreat || (now - inp.shotByPlayerAt < c.underFireMs && near < c.underFireRange)) this.playerLock = true;
    else if (near >= c.playerRelease) this.playerLock = false;
    if (this.playerLock) {
      this.eng = null;
      return { kind: "player", why: "a player is close" };
    }

    const hpFrac = self.maxHp > 0 ? self.hp / self.maxHp : 1;
    const retreat = this.retreat(inp, hpFrac);
    if (retreat) return retreat;

    if (now < this.mobBanUntil) return { kind: "player", why: "staying off mobs" };
    if (this.stats.focusMs >= c.focusBudgetMs) return { kind: "player", why: "mob time budget spent" };
    if (self.mobKills >= c.killGoal) return { kind: "player", why: "enough mob kills" };

    if (this.eng && !this.keep(this.eng, inp, dt)) this.eng = null;
    if (!this.eng) {
      if (now < this.nextPickAt) return { kind: "player", why: "no mob in reach" };
      const id = this.pick(inp, hpFrac);
      if (id === null) {
        this.nextPickAt = now + c.repickMs;
        return { kind: "player", why: "no mob in reach" };
      }
      const m = this.tracker.mob(id)!;
      this.eng = { id, since: now, bestHp: m.hp, stallMs: 0, approachMs: 0 };
      this.stats.targets++;
    }
    const m = this.tracker.mob(this.eng.id)!;
    return { kind: "mob", id: this.eng.id, why: `${m.faction} ${m.kind} with ${m.weapon0}` };
  }

  /**
   * Low hp in a mob fight: run from the awake mobs (a sleeping one is simply left alone) and stay off mobs for a while. The
   * retreat lasts at least retreatMinMs, ends when nothing awake is near, and never lasts beyond retreatMaxMs. Only a bot that
   * is on a mob retreats: a bot that is low on hp for another reason keeps hunting as before.
   */
  private retreat(inp: HuntInput, hpFrac: number): HuntDecision | null {
    const c = this.cfg;
    const { now, self } = inp;
    const awake = this.awakeNear(self, c.retreatClear, now);
    if (this.retreatUntil > now) {
      if (awake.length > 0 || now < this.retreatMinUntil) return { kind: "retreat", from: [...awake, ...inp.players], why: "running" };
      this.retreatUntil = 0;
    } else if (this.eng !== null && hpFrac < c.retreatHp) {
      this.eng = null;
      this.mobBanUntil = now + c.retreatBanMs;
      if (awake.length > 0) {
        this.retreatUntil = now + c.retreatMaxMs;
        this.retreatMinUntil = now + c.retreatMinMs;
        this.stats.retreats++;
        this.log(`retreating at ${Math.round(hpFrac * 100)}% hp`);
        return { kind: "retreat", from: [...awake, ...inp.players], why: "low hp" };
      }
      this.log(`leaving mobs alone at ${Math.round(hpFrac * 100)}% hp`);
    }
    return null;
  }

  /** Keeps the engagement while the target is alive and getting hurt; false drops it (and bans it when it is a lost cause). */
  private keep(e: Engagement, inp: HuntInput, dt: number): boolean {
    const c = this.cfg;
    const m = this.tracker.mob(e.id);
    if (!m || m.status !== "alive") {
      this.log(`mob ${e.id} is ${m ? "down" : "gone"} after ${Math.round((inp.now - e.since) / 100) / 10} s${m ? ` (${m.faction} ${m.kind})` : ""}`);
      return false; // dead (or gone): on to the next
    }
    if (this.tracker.returning(e.id, inp.now)) return this.drop(e, inp.now, c.returnBanMs, "its hp is rising: it is walking home");
    if (m.hp < e.bestHp - RISE_EPS) {
      e.bestHp = m.hp;
      e.stallMs = 0;
      e.approachMs = 0;
    } else if (inp.attacking) {
      e.stallMs += dt;
    } else {
      e.approachMs += dt;
    }
    if (e.stallMs >= c.stallAttackMs || e.approachMs >= c.approachMs || inp.now - e.since >= c.targetBudgetMs) {
      return this.drop(e, inp.now, c.stallBanMs, e.stallMs >= c.stallAttackMs ? "attacks do not hurt it" : e.approachMs >= c.approachMs ? "cannot reach it" : "taking too long");
    }
    return true;
  }

  private drop(e: Engagement, now: number, banMs: number, why: string): false {
    this.banned.set(e.id, now + banMs);
    this.stats.drops++;
    const m = this.tracker.mob(e.id);
    const home = this.tracker.home(e.id);
    this.log(`dropping mob ${e.id}: ${why}${m && home ? ` (hp ${Math.round(m.hp)}/${Math.round(m.maxHp)}, ${Math.round(dist(m, home))} u from home, ${m.faction} ${m.kind})` : ""}`);
    return false;
  }

/** The best mob to start on, or null. */
  private pick(inp: HuntInput, hpFrac: number): string | null {
    const c = this.cfg;
    const { now, self } = inp;
    if (hpFrac < c.startMinHp) return null;
    const carried = self.weapons.filter((w) => w !== null);
    const reach = self.mobKills === 0 ? c.firstReach : c.reach;
    const progressionPower = self.power + mobTypeProgress(self.mobStats);
    const near: { id: string; m: MobLike; d: number; theirs: WeaponId | null; edge: number; share: number }[] = [];
    for (const [id, m] of inp.mobs) {
      if (!isRegionalKind(m.kind) || m.status !== "alive") continue;
      const d = dist(m, self);
      if (d > reach || this.isBanned(id, now) || this.tracker.returning(id, now)) continue;
      if (m.kind === "elite" && !(progressionPower >= c.eliteMinPower || hpFrac >= c.eliteFullHp)) continue;
      const share = self.faction !== null && isFactionId(m.faction) ? matchupShare(self.faction, m.faction, m.kind === "elite") : 0.7;
      const need = m.kind !== "elite" ? c.mobMinShare : progressionPower >= c.eliteSurePower ? c.eliteSureShare : c.eliteMinShare;
      if (share < need) continue; // this faction loses to it, or wins too narrowly (Fire against Holy mobs, anyone against the wrong elite)
      const theirs = mobWeapon(m);
      const edge = theirs === null ? 0 : bestEdge(self.weapons, theirs);
      if (edge <= -2) continue; // nothing we carry works against it (see useless)
      // A mob with a bow or a wand backs away from whoever closes in and leaves its leash, taking the fight home with it: the
      // bots kill about one in ten of them. A weapon that loses to its own is worse still, for an elite.
      if (c.skipRanged && theirs !== null && isRanged(theirs)) continue;
      if (edge < 0 && m.kind === "elite") continue;
      near.push({ id, m, d, theirs, edge, share });
    }
    near.sort((a, b) => a.d - b.d);
    let best: string | null = null;
    let bestScore = Infinity;
    for (const { id, m, theirs, edge, share } of near.slice(0, c.maxCandidates)) {
      const walk = inp.walk(m);
      if (walk === null || walk > reach * c.walkSlack) continue;
      let score = walk - share * SHARE_BONUS + m.maxHp * HP_WEIGHT;
      if (m.type && mobStatCount(self.mobStats, m.type) >= MOB_STAT_CAP) score += 10_000;
      if (edge > 0) score -= EDGE_BONUS;
      else if (edge < 0) score += EDGE_PENALTY;
      if (theirs !== null) {
        if (carried.length < 2 && !carried.includes(theirs)) score -= NEW_WEAPON_BONUS;
        if (isRanged(theirs) && !carried.some((w) => isRanged(w!))) score += KITER_PENALTY;
      }
      if (m.kind === "elite") score += ELITE_PENALTY;
      if (inp.players.some((p) => dist(p, m) < walk)) score += CONTEST_PENALTY;
      if (score < bestScore) { bestScore = score; best = id; }
    }
    return best;
  }
}

/** The weapon a mob fights with: its own, else its region's. */
export function mobWeapon(m: Pick<MobLike, "weapon0" | "faction">): WeaponId | null {
  return asWeapon(m.weapon0) ?? (isFactionId(m.faction) ? REGION_WEAPONS[m.faction] : null);
}

/**
 * Does `mine` do nothing against a mob that carries `theirs`? Either the mob's guard stops it (a raised shield blocks swings
 * and bashes and reflects arrows; a wand ball deletes an arrow; an axe swing destroys a ball), or it stops the mob: a mob
 * whose blows all bounce off a shield deals no damage, and a mob that deals none gives up after MOB_GIVE_UP_SECONDS and walks
 * home, untouchable. The bots measured both: such fights run out the clock.
 */
export function useless(mine: WeaponId, theirs: WeaponId): boolean {
  if (theirs === "shield") return mine === "sword" || mine === "bow" || mine === "shield";
  if (mine === "shield") return theirs === "sword" || theirs === "bow";
  if (theirs === "wand") return mine === "bow";
  if (theirs === "axe") return mine === "wand";
  return false;
}

/**
 * The best weapon edge any carried weapon that is not useless has against `theirs` (we can swap to it): 1 beats, 0 mirror or
 * neutral, -1 loses. -2 when every carried weapon is useless against it. Carrying nothing is fighting on fists (a run starts
 * that way): neutral, 0, and never useless (a fists swing pierces a raised shield and a ball does not stop it).
 */
export function bestEdge(weapons: readonly (WeaponId | null)[], theirs: WeaponId): -2 | -1 | 0 | 1 {
  if (weapons.every((w) => w === null)) return weaponEdge(FISTS, theirs);
  let best: -2 | -1 | 0 | 1 = -2;
  for (const w of weapons) {
    if (w === null || useless(w, theirs)) continue;
    best = Math.max(best, weaponEdge(w, theirs)) as -2 | -1 | 0 | 1;
  }
  return best;
}

/**
 * Which of two slots to hold against a mob carrying `theirs`: the one with the better edge, a useless weapon last; the current
 * slot on a tie; an empty slot never (a carried weapon, even a poor one, is held over fists, and the bots take up a weapon
 * as soon as the hand is empty). (Against a player `bestSlot` of the policies is right: a player is not a mob that gives up.)
 */
export function bestSlotVsMob(slots: readonly [WeaponId | null, WeaponId | null], current: 0 | 1, theirs: WeaponId | null): 0 | 1 {
  const score = (w: WeaponId | null): number => (w === null ? -Infinity : theirs === null ? 0 : useless(w, theirs) ? -2 : weaponEdge(w, theirs));
  const other = current === 0 ? 1 : 0;
  return score(slots[other]) > score(slots[current]) ? other : current;
}

/**
 * Where to run to get away from `threats` (awake mobs, standing players): the walkable point among sixteen headings at two
 * distances that ends farthest from the nearest threat. Null when nothing is walkable.
 */
export function retreatPoint(self: Vec2, threats: readonly Vec2[], walkable: (from: Vec2, to: Vec2) => boolean): Vec2 | null {
  let best: Vec2 | null = null;
  let bestScore = -Infinity;
  for (const step of [7 * TILE, 4 * TILE]) {
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      const p = { x: self.x + Math.cos(a) * step, y: self.y + Math.sin(a) * step };
      if (!walkable(self, p)) continue;
      let nearest = Infinity;
      for (const t of threats) nearest = Math.min(nearest, dist(p, t));
      const score = Math.min(nearest, 1e6) + step * 0.25;
      if (score > bestScore) { bestScore = score; best = p; }
    }
  }
  return best;
}

/** How many of the camps nearest a spawn the bot's planning weighs. */
export const PLAN_CAMPS = 2;
/** A camp whose weapon makes the bot's useless counts this much of its matchup (the second slot may still answer it). */
const PLAN_USELESS_WEIGHT = 0.25;

/**
 * How good a start the spawn `poolIndex` is for a bot of `faction` holding `weapon`: the matchup (shared campMatchup) of the
 * PLAN_CAMPS camps nearest it, each cut to PLAN_USELESS_WEIGHT when the camp's weapon makes `weapon` useless. Higher is better.
 */
export function planSpawnScore(map: GameMap, poolIndex: number, faction: FactionId, weapon: WeaponId | null): number {
  const at = map.spawnPool[poolIndex];
  if (!at) return -Infinity;
  let score = 0;
  for (const camp of nearestCamps(map, at, PLAN_CAMPS)) {
    const share = campMatchup(faction, camp);
    score += weapon !== null && useless(weapon, REGION_WEAPONS[camp.zone]) ? share * PLAN_USELESS_WEIGHT : share;
  }
  return score;
}

/**
 * Which of its two dealt spawns a bot picks: the better planSpawnScore of those nobody else holds (option 0 on a tie), or
 * -1 when both are taken (or none was dealt).
 */
export function planPick(
  map: GameMap, plan: Pick<PlanMessage, "spawns" | "taken">, faction: FactionId, weapon: WeaponId | null,
): -1 | 0 | 1 {
  let best: -1 | 0 | 1 = -1;
  let bestScore = -Infinity;
  for (const k of [0, 1] as const) {
    if (plan.spawns[k] < 0 || plan.taken[k]) continue;
    const score = planSpawnScore(map, plan.spawns[k], faction, weapon);
    if (best < 0 || score > bestScore) { best = k; bestScore = score; }
  }
  return best;
}

/** Total length of the path `from` -> through `points`. */
export function pathLength(from: Vec2, points: readonly Vec2[]): number {
  let total = 0;
  let at = from;
  for (const p of points) {
    total += dist(at, p);
    at = p;
  }
  return total;
}
