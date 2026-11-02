// A bot's farming plan: the build it is going for and the camps it means to clear for it, in order. Pure: it reads the public camp
// state (type, alive, cleared, respawn time; the planning screen shows the same) and the bot's own sheet, and answers "which
// camps, in which order". The strategy walks the first planned camp and the hunt prefers the mob types the build wants.
//
//   1. The build: one of the faction's two builds (testing/TUNING_BALANCE.md section 13: A and B), drawn once per run. Its
//      weights say how much each normal mob type's stat is worth to it; every stat is worth something (STAT_FLOOR).
//   2. The route: greedy by value per second from where the bot stands, ROUTE_STEPS camps ahead. A camp's value is its mobs
//      times the build's weight for its type (an elite camp adds ELITE_VALUE once the bot is ready for elites); its cost is
//      the walk, any wait for a respawn (at most MAX_WAIT_MS) and the time to clear it. A cleared camp is planned for its
//      respawn, so a bot that clears the camps near it comes back as they return.
//   3. Elites come later: not before ELITE_AFTER_MS into the run and ELITE_MIN_KILLS mob kills, unless the sheet is strong.
//   4. Adaptability: a planned camp that loses mobs while the bot is away (somebody is farming it), one with an enemy player at
//      it, or one cleared by somebody else while the bot walked to it is contested for CONTEST_MS: the plan leaves it out and is
//      made again at once. A zone contested twice in a row is avoided for longer (another player is farming it). Only the camps
//      on the bot's own route are watched: a camp it does not plan for is nobody's business of its own. (CampState.state's
//      "engaged" is sticky until the respawn, so it says nothing about now.)
import type { FactionId, MobTypeId, Vec2 } from "@raid/shared";
import { mobStatReward } from "@raid/shared";

/** The stats a mob kill can give (shared mobStats.ts REWARDS). */
export type FarmStat = "ad" | "ap" | "armor" | "shield" | "maxHp" | "attackSpeed" | "moveSpeed" | "lifesteal" | "damage";

export interface BuildGoal {
  readonly id: string;
  readonly name: string;
  readonly weights: Readonly<Partial<Record<FarmStat, number>>>;
}

/** The faction rework's two builds per faction, as stat weights (README "Live playtest rules": two builds per faction). */
export const BUILD_GOALS: Readonly<Record<FactionId, readonly [BuildGoal, BuildGoal]>> = {
  fire: [
    { id: "fire:A", name: "AD burst assassin", weights: { ad: 1, damage: 1, attackSpeed: 0.6, moveSpeed: 0.4 } },
    { id: "fire:B", name: "AP burn tank", weights: { ap: 1, armor: 0.8, shield: 0.8, maxHp: 0.6 } },
  ],
  sentenced: [
    { id: "sentenced:A", name: "stat bully bruiser", weights: { armor: 0.8, shield: 0.8, ad: 0.8, ap: 0.6, maxHp: 0.5 } },
    { id: "sentenced:B", name: "attack-speed max-HP punisher", weights: { attackSpeed: 1, maxHp: 0.8, damage: 0.5 } },
  ],
  plague: [
    { id: "plague:A", name: "attack-speed SO DoT stacker", weights: { attackSpeed: 1, ap: 1, damage: 0.4 } },
    { id: "plague:B", name: "zombie tank", weights: { armor: 0.9, shield: 0.9, ap: 0.7, maxHp: 0.6 } },
  ],
  frost: [
    { id: "frost:A", name: "Defense/SD shield tank", weights: { armor: 1, shield: 1, maxHp: 0.8 } },
    { id: "frost:B", name: "bow kiter", weights: { attackSpeed: 1, moveSpeed: 0.7, damage: 0.6, shield: 0.5 } },
  ],
  holy: [
    { id: "holy:A", name: "lifesteal juggernaut", weights: { lifesteal: 1, maxHp: 0.7, ad: 0.5, attackSpeed: 0.4 } },
    { id: "holy:B", name: "Soul-damage Holy", weights: { ap: 1, lifesteal: 0.7, maxHp: 0.4 } },
  ],
};

/** What any stat is worth to a build that does not ask for it: a stack is never worthless. */
export const STAT_FLOOR = 0.25;
export const ROUTE_STEPS = 4;
/** Waiting at a camp for its respawn is planned only when the respawn is this close. */
export const MAX_WAIT_MS = 40_000;
/** The time a camp takes to clear, per normal mob and for an elite. */
export const CLEAR_MS_PER_MOB = 4_000;
export const CLEAR_MS_ELITE = 15_000;
/** An elite camp's elite, in normal mobs' worth of value (its augment chest). */
export const ELITE_VALUE = 6;
export const ELITE_AFTER_MS = 360_000;
export const ELITE_MIN_KILLS = 12;
/** Card power that lets a bot take elites early. */
export const ELITE_EARLY_POWER = 6;
export const CONTEST_MS = 30_000;
/** A zone contested this many times within ZONE_MEMORY_MS is left out for ZONE_AVOID_MS. */
export const ZONE_CONTESTS = 2;
export const ZONE_MEMORY_MS = 90_000;
export const ZONE_AVOID_MS = 60_000;
/** An enemy player this close to a camp contests it. */
export const CONTEST_PLAYER_RANGE = 320;
/** Mobs dying at a camp the bot is farther than this beyond the clearing of are somebody else's kills. */
export const OWN_FIGHT_SLACK = 200;
/** A straight line is this much shorter than a walk. */
export const WALK_FACTOR = 1.3;
export const REPLAN_MS = 8_000;

/** One camp as the plan reads it: the map's definition and its public state. */
export interface RouteCamp {
  readonly index: number;
  readonly id: string;
  readonly zone: FactionId;
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly elite: boolean;
  readonly spots: number;
  readonly type: MobTypeId | "";
  readonly alive: number;
  /** 0 idle, 1 engaged, 2 cleared. */
  readonly state: number;
  readonly respawnAt: number;
}

export interface RouteInput {
  readonly now: number;
  readonly runMs: number;
  readonly self: Vec2;
  /** Walking speed, world units a second. */
  readonly speed: number;
  readonly mobKills: number;
  readonly power: number;
  readonly camps: readonly RouteCamp[];
  /** Positions of the enemy players the bot knows of. */
  readonly players: readonly Vec2[];
  /** Whether the bot can farm this camp at all (its matchup and its weapons; the strategy's own filters). */
  readonly canFarm: (camp: RouteCamp) => boolean;
}

export interface RouteStep { readonly camp: number; readonly arriveAt: number; readonly startAt: number }

export function buildOf(faction: FactionId, draw: number): BuildGoal {
  return BUILD_GOALS[faction][draw < 0.5 ? 0 : 1];
}

/** How much a kill of this normal type is worth to the build (STAT_FLOOR..1); an unknown type is worth the floor. */
export function typeWeight(build: BuildGoal, type: string | undefined): number {
  const reward = type ? mobStatReward(type) : undefined;
  if (!reward) return STAT_FLOOR;
  return Math.max(STAT_FLOOR, build.weights[reward.effect.stat as FarmStat] ?? 0);
}

export function readyForElites(inp: Pick<RouteInput, "runMs" | "mobKills" | "power">): boolean {
  return (inp.runMs >= ELITE_AFTER_MS && inp.mobKills >= ELITE_MIN_KILLS) || inp.power >= ELITE_EARLY_POWER;
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** One bot's plan: its build, its route, and what it has learned about contested camps and zones. */
export class BuildRoute {
  route: RouteStep[] = [];
  private plannedAt = -Infinity;
  private readonly contested = new Map<number, number>();
  private readonly zoneHits = new Map<string, number[]>();
  private readonly zoneAvoid = new Map<string, number>();
  /** The camp the bot was walking to, and its state then: a clear it did not make is a contest. */
  private heading: { camp: number; state: number } | null = null;
  /** Each camp's living mobs at the last update: a drop while the bot is away is somebody else farming it. */
  private readonly lastAlive = new Map<number, number>();
  readonly stats = { plans: 0, contests: 0 };

  constructor(readonly build: BuildGoal) {}

  /** The first planned camp, after noting contests and planning again when the plan is stale or broken. */
  update(inp: RouteInput): RouteStep | null {
    this.noteContests(inp);
    const first = this.route[0];
    const broken = first !== undefined && (this.isContested(first.camp, inp.now) || this.done(inp, first));
    if (broken || inp.now - this.plannedAt >= REPLAN_MS || this.route.length === 0) this.plan(inp);
    const next = this.route[0] ?? null;
    const c = next ? inp.camps.find((k) => k.index === next.camp) : undefined;
    this.heading = c ? { camp: c.index, state: c.state } : null;
    return next;
  }

  isContested(camp: number, now: number): boolean {
    return (this.contested.get(camp) ?? -Infinity) > now;
  }

  /** The value of one camp to this build, now (0 when it is no use to it). */
  campValue(c: RouteCamp, elites: boolean): number {
    if (c.elite && !elites) return 0;
    const mobs = c.state === 2 ? c.spots : Math.max(0, c.alive);
    const normals = c.elite ? Math.max(0, mobs - 1) : mobs;
    let v = normals * typeWeight(this.build, c.type || undefined);
    if (c.elite && mobs > 0) v += ELITE_VALUE;
    return v;
  }

  private done(inp: RouteInput, step: RouteStep): boolean {
    const c = inp.camps.find((k) => k.index === step.camp);
    return !c || (c.state === 2 && c.respawnAt - inp.now > MAX_WAIT_MS);
  }

  private noteContests(inp: RouteInput): void {
    const { now } = inp;
    const planned = new Set(this.route.map((s) => s.camp));
    for (const c of inp.camps) {
      const before = this.lastAlive.get(c.index);
      this.lastAlive.set(c.index, c.alive);
      if (!planned.has(c.index) || this.isContested(c.index, now)) continue;
      const near = dist(inp.self, c);
      const away = near > c.r + OWN_FIGHT_SLACK;
      const farmedByOther = away && before !== undefined && c.alive < before;
      const playerAt = near > c.r && inp.players.some((p) => dist(p, c) <= CONTEST_PLAYER_RANGE);
      const stolen = away && this.heading?.camp === c.index && this.heading.state !== 2 && c.state === 2;
      if (!farmedByOther && !playerAt && !stolen) continue;
      this.contested.set(c.index, now + CONTEST_MS);
      this.stats.contests++;
      const hits = (this.zoneHits.get(c.zone) ?? []).filter((t) => now - t < ZONE_MEMORY_MS);
      hits.push(now);
      this.zoneHits.set(c.zone, hits);
      if (hits.length >= ZONE_CONTESTS) this.zoneAvoid.set(c.zone, now + ZONE_AVOID_MS);
    }
  }

  /** Greedy by value per second, ROUTE_STEPS ahead, with respawns planned and contested camps and zones left out. */
  plan(inp: RouteInput): void {
    this.plannedAt = inp.now;
    this.stats.plans++;
    const elites = readyForElites(inp);
    const speed = Math.max(1, inp.speed);
    const out: RouteStep[] = [];
    const used = new Set<number>();
    let at: Vec2 = inp.self;
    let t = inp.now;
    for (let step = 0; step < ROUTE_STEPS; step++) {
      let best: { c: RouteCamp; arrive: number; start: number; done: number; score: number } | null = null;
      for (const c of inp.camps) {
        if (used.has(c.index) || this.isContested(c.index, inp.now)) continue;
        if ((this.zoneAvoid.get(c.zone) ?? -Infinity) > inp.now || !inp.canFarm(c)) continue;
        const value = this.campValue(c, elites);
        if (!(value > 0)) continue;
        const arrive = t + (dist(at, c) * WALK_FACTOR / speed) * 1000;
        const ready = c.state === 2 ? c.respawnAt : inp.now;
        if (ready - arrive > MAX_WAIT_MS) continue;
        const start = Math.max(arrive, ready);
        const mobs = c.state === 2 ? c.spots : c.alive;
        const clear = c.elite ? CLEAR_MS_ELITE + Math.max(0, mobs - 1) * CLEAR_MS_PER_MOB : mobs * CLEAR_MS_PER_MOB;
        const score = value / ((start - t + clear) / 1000 + 1);
        // Ties go to the lower index, so the plan is the same whatever order the camps came in.
        if (!best || score > best.score || (score === best.score && c.index < best.c.index)) best = { c, arrive, start, done: start + clear, score };
      }
      if (!best) break;
      out.push({ camp: best.c.index, arriveAt: best.arrive, startAt: best.start });
      used.add(best.c.index);
      at = best.c;
      t = best.done;
    }
    this.route = out;
  }
}
