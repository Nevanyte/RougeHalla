// Feeds the unchanged MobHunter (../mobHunt) from a percept and the memory, as docs/BOTS.md 3.6 says. One adapter per bot: it
// holds the hunter (its engagement, bans and retreat timers) and its per-bot MobHuntConfig. The strategy turns the answer into
// a candidate goal: `mob` is a farm, `retreat` a flee, `player` no mob candidate this think.
import { isRegionalKind, mobFaction, type FactionId, type Vec2 } from "@raid/shared";
import {
  MOB_HUNT, MobHunter, type HuntDecision, type HuntInput, type MobHuntConfig, type MobHuntStats, type MobLike,
} from "../mobHunt";
import type { BrainConfig, BrainContext, MobMemory } from "./types";

/** A farmer puts up with more attrition than a hunter: the hp share it needs to start a mob fight is lower by this x persona.pve. */
const PVE_RELIEF = 0.25;
/** A fighter out of sight still counts for the hunt this long after it was last seen. */
export const WHEREABOUTS_MAX_AGE_MS = 5000;
/** A player behind a wall threatens from this many times its straight-line distance (spawns near each other are screened). */
export const BLOCKED_THREAT_FACTOR = 2;
/** Without a pathfinder (Easy) a walk is the straight line times this. */
export const STRAIGHT_WALK_FACTOR = 1.3;
/** mobHunt's `why` when it looked and found no mob worth taking: the only "player" answer that says go and find one. */
export const NO_MOB_IN_REACH = "no mob in reach";

/** MobHunter caps its own time step at 250 ms: a longer gap between two thinks is replayed in pieces this long (see decide). */
const CATCHUP_PIECE_MS = 240;
const CATCHUP_MAX_PIECES = 14;

/** The hunt's tunables for one bot: mobHunt's defaults, with the persona's thresholds and the tier's route quality. */
export function huntConfigFor(cfg: Pick<BrainConfig, "tier" | "persona">): MobHuntConfig {
  const { tier, persona } = cfg;
  return {
    ...MOB_HUNT,
    killGoal: persona.mobKillGoal,
    retreatHp: persona.fleeHp,
    playerThreat: persona.playerThreat,
    // A threat radius past the default release distance would never let go of the player lock.
    playerRelease: Math.max(MOB_HUNT.playerRelease, persona.playerThreat + 50),
    // Starting a mob fight at an hp that would retreat from it at once only costs the 40 s ban.
    startMinHp: Math.max(persona.fleeHp + 0.05, tier.caution.startHp - PVE_RELIEF * persona.pve),
    mobMinShare: tier.caution.mobShare,
    eliteMinShare: tier.caution.eliteShare,
    reach: tier.route.reach,
    firstReach: 1.6 * tier.route.reach,
    maxCandidates: tier.route.horizon,
  };
}

/** True when the answer says "no mob in reach": the bot may look for camps farther away. */
export function wantsMobs(d: HuntDecision): boolean {
  return d.kind === "player" && d.why === NO_MOB_IN_REACH;
}

const maxHps = new Map<string, number>();
/** What `mobLife.ts` sets: the region faction scaled (hp is not paced). A mob of an unknown region is taken as a fire one. */
function mobMaxHp(zone: FactionId | null, elite: boolean): number {
  const key = `${zone ?? "?"}/${elite ? "e" : "m"}`;
  let hp = maxHps.get(key);
  if (hp === undefined) {
    hp = mobFaction(zone ?? "fire", elite).hp;
    maxHps.set(key, hp);
  }
  return hp;
}

/** A remembered mob as the hunt reads a synced one. Its hp is the last share seen, so a mob that left the screen never heals. */
export function mobLikeOf(m: Readonly<MobMemory>): MobLike | null {
  if (!isRegionalKind(m.kind)) return null;
  const maxHp = mobMaxHp(m.faction, m.kind === "elite");
  return {
    kind: m.kind, status: m.alive ? "alive" : "dead", x: m.pos.x, y: m.pos.y, hp: m.hpFrac * maxHp, maxHp,
    faction: m.faction ?? "", weapon0: m.inHand ?? "",
  };
}

export interface HuntAdapterOptions {
  /** Tactics' last `attacking` (locked, in reach, in sight). Without it the percept's lock and `engaged` stand in. */
  attacking?: () => boolean;
  /** Hears every drop and retreat of the hunt. */
  log?: (msg: string) => void;
}

export interface HuntAdapter {
  readonly hunter: MobHunter;
  readonly config: Readonly<MobHuntConfig>;
  readonly stats: MobHuntStats;
  /** The hunt's answer for this think. Call it once per strategy decision. */
  decide(ctx: BrainContext): HuntDecision;
  /** The strategy chose something else than the mob the hunt is on: let go of it, as the old bot did by hunting a player. */
  release(ctx: BrainContext): void;
  awakeNear(from: Vec2, radius: number, now: number): Vec2[];
}

export function createHuntAdapter(cfg: BrainConfig, opts: HuntAdapterOptions = {}): HuntAdapter {
  const config = huntConfigFor(cfg);
  const hunter = new MobHunter(config, opts.log);
  const walkPaths = cfg.tier.route.walkPaths;
  /** Mobs the tracker has been told the camp spot of (its `home` is the first position it sees). */
  const homed = new Set<string>();
  let lastAt = 0;

  const attackingOf = (ctx: BrainContext): boolean => (opts.attacking ? opts.attacking() : ctx.p.self.attackTarget !== null && ctx.engaged);

  function input(ctx: BrainContext): HuntInput {
    const { p, mem } = ctx;
    const me = p.self;
    const players: Vec2[] = [];
    let nearest = Infinity;
    const onScreen = new Set<string>();
    for (const f of p.fighters) {
      onScreen.add(f.id);
      if (f.status !== "alive") continue;
      players.push({ x: f.x, y: f.y });
      nearest = Math.min(nearest, f.los ? f.dist : f.dist * BLOCKED_THREAT_FACTOR);
    }
    for (const [id, m] of mem.fighters) {
      if (onScreen.has(id) || !m.alive || p.now - m.seenAt >= WHEREABOUTS_MAX_AGE_MS) continue;
      const w = mem.whereabouts(id, p.now);
      if (w) players.push({ x: w.at.x, y: w.at.y });
    }
    const mobs: [string, MobLike][] = [];
    for (const [id, m] of mem.mobs) {
      if (m.returning) continue; // walking home: untouchable and ignoring everyone, so nothing to hunt or fear
      const like = mobLikeOf(m);
      if (!like) continue;
      mobs.push([id, like]);
    }
    const from = { x: me.x, y: me.y };
    return {
      now: p.now,
      self: {
        faction: me.faction, x: me.x, y: me.y, hp: me.hp, maxHp: me.maxHp, weapons: me.weapons,
        stacks: me.stacks, mobKills: me.mobKills,
      },
      playerDistance: nearest,
      players,
      inColiseum: p.hud.inColiseum,
      mobs,
      walk: (to) => {
        if (!walkPaths) return Math.hypot(to.x - from.x, to.y - from.y) * STRAIGHT_WALK_FACTOR;
        return ctx.svc.paths.walk(from, to)?.dist ?? null;
      },
      attacking: attackingOf(ctx),
      shotByPlayerAt: mem.self.lastHitByPlayerAt ?? -Infinity,
    };
  }

  /** The tracker takes a mob's `home` from the first position it sees; memory knows where the dot first stood. */
  function seedHomes(ctx: BrainContext, inp: HuntInput): void {
    const fresh: [string, MobLike][] = [];
    let any = false;
    for (const [id, like] of inp.mobs) {
      const home = ctx.mem.mobs.get(id)?.home;
      if (homed.has(id)) { fresh.push([id, like]); continue; }
      homed.add(id);
      if (home) { fresh.push([id, { ...like, x: home.x, y: home.y }]); any = true; } else fresh.push([id, like]);
    }
    if (any) hunter.tracker.observe(fresh, inp.now);
  }

  return {
    hunter,
    config,
    get stats() { return hunter.stats; },
    decide(ctx) {
      const inp = input(ctx);
      seedHomes(ctx, inp);
      // The hunt's timers (a target that never gets hurt, one that is never reached) advance in steps of at most 250 ms. A think
      // every second or two would run them five to ten times slow, so a gap is replayed in pieces over the same snapshot.
      if (hunter.target !== null && lastAt > 0 && inp.now - lastAt > CATCHUP_PIECE_MS) {
        const gap = inp.now - lastAt;
        const pieces = Math.min(CATCHUP_MAX_PIECES, Math.ceil(gap / CATCHUP_PIECE_MS));
        for (let k = 1; k < pieces; k++) hunter.decide({ ...inp, now: lastAt + (gap * k) / pieces });
      }
      lastAt = inp.now;
      return hunter.decide(inp);
    },
    release(ctx) {
      if (hunter.target === null) return;
      // A player "close by" drops the engagement and nothing else; the next real call lifts the lock if nobody is.
      hunter.decide({ ...input(ctx), playerDistance: 0 });
    },
    awakeNear: (from, radius, now) => hunter.awakeNear(from, radius, now),
  };
}
