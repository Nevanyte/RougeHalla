// How strong is a regional mob in the REAL sim? A player on a weapon (its faction's signature weapon by default) meets ONE
// mob of a region (the region's weapon, hp and damage scaled by k = MOB_K, or ELITE_K for an elite) on an open floor, and the
// fight is played to the end through step(): the weapon state machines, the ledger, the signature systems, mobAI.thinkMobs
// and settle(). The player is driven by the shared weapon policy `decide`, exactly like harness/duel.ts (the bots now click their foe instead: BotClient).
//
//   npx tsx bench/mobDuel.ts                       shipped MOB_K / ELITE_K: the 5x5 tables (normal and elite), 3 seeds
//   npx tsx bench/mobDuel.ts --sweep               the k sweep (normal 0.30..0.60, elite 0.50..0.90), one summary row per k
//   npx tsx bench/mobDuel.ts --reference           the continuous duel() reference (before the weapon layer and signatures)
//   npx tsx bench/mobDuel.ts --weapons             the player on each of the 5 weapons (weapon-edge variants)
//   npx tsx bench/mobDuel.ts --one fire:holy [--elite] [--k 0.4] [--seed 2] [--weapon sword] [--trace]
//   options: --seeds N (3)  --wake hit|aggro (hit)  --cap SECONDS (60)  --k X  --elite-k X  --json FILE
//            --style policy|stand (policy)  --leash U (what-if, emulated)  --mobs-stand (what-if: ranged mobs don't back away)
//            --sweep takes --leashes a,b,c  --ks a,b  --eks a,b
//
// Reuse: runMobDuel(spec) is the one-duel function; runGrid (the 25 pairings), cellStats, verdict and the table functions build on it.
//
// How a seed varies a duel (the sim has no rolls, so the same setup would repeat exactly): it picks the direction the player
// comes from, a start distance within +-20 u of `distance`, how many ticks the player waits before it acts (0..3), and how
// the mob faces at rest (seed % 3 = 0: toward the player, 1: sideways, 2: away). Everything else is the sim as shipped. Note how
// little that changes: the fight starts at the player's first hit and runs on the sim's own clock, so seeds agree to a point or two.
//
// k reaches the sim through setMobScalesForHarness (sim/combatant.ts), set before placeMob and always restored.
import { writeFileSync } from "node:fs";
import {
  decide, duel, ELITE_K, FACTION_IDS, FACTIONS, hasLineOfSight, INTERP_DELAY_MS, isFactionId, isRanged, isWeaponId, MOB_K,
  MOB_LEASH_RADIUS, mulberry32, PLAYER_RADIUS, POLICIES, REGION_WEAPONS, scaledFaction, segmentClear, SIGNATURE_WEAPONS, TICK_MS,
  TILE, WEAPON_IDS, WEAPONS, type FactionId, type FactionSpec, type PolicyInput, type SpacingPolicy, type Vec2, type WeaponId,
} from "@raid/shared";
import { buildArena } from "../src/harness/duel";
import { activeWeapon, combatant, setMobScalesForHarness, timingsOf, type Combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { aggro } from "../src/sim/mobAI";
import { placeMob } from "../src/sim/mobLife";
import { positionAt } from "../src/sim/movement";
import { addPlayer, step } from "../src/sim/step";
import { moveMultiplierOf } from "../src/sim/weapons";
import type { SimEvent, World } from "../src/sim/world";

export type Wake = "hit" | "aggro";
/**
 * How the player plays: "policy" is the shared weapon policy as the bots and the weapon harness play it (a shooter backs off
 * when the foe is close, so it can drag a mob out of its leash); "stand" is the same policy without the back-off: it closes in
 * to its weapon's range and stays there, so it measures the mob's strength without the leash coming into it.
 */
export type Style = "policy" | "stand";

export interface MobDuelSpec {
  /** The player's faction (its hp, armor, shield, signature). */
  player: FactionId;
  /** The mob's region: its faction (scaled) and its weapon. */
  region: FactionId;
  elite: boolean;
  /** The scale for this kind of mob (MOB_K for a normal one, ELITE_K for an elite) when left out. */
  k?: number;
  seed: number;
  /** The player's weapon; SIGNATURE_WEAPONS[player] when left out. */
  weapon?: WeaponId;
  /** "hit": the player's own first landed hit wakes the mob (a mob is neutral until hurt). "aggro": woken at t = 0 with `aggro`. */
  wake?: Wake;
  style?: Style;
  /** Start distance, player to mob (centre to centre); 300 u. */
  distance?: number;
  capSeconds?: number;
  /**
   * Leash radius (u) to test instead of MOB_LEASH_RADIUS (>= it). A constant has no seam, so this is an emulation: a system
   * that runs just before thinkMobs moves the fighting mob's `brain.home` out along the line from the camp spot to the mob by
   * (leash - MOB_LEASH_RADIUS), so thinkMobs' own "farther than MOB_LEASH_RADIUS from home" test fires exactly when the mob is
   * `leash` from the real camp spot; in every other mode the home is the real one. The walk home is along the same line.
   */
  leash?: number;
  /**
   * What-if, off by default (true = as shipped): false makes a ranged mob (bow, wand) stand and shoot instead of backing away
   * from a foe that is too close. mobAI plays its weapon with POLICIES[weapon] (shared/policies.ts), so this sets
   * POLICIES.bow/wand.retreatBelow to 0 for the duel and puts it back; the player keeps its own copy of the spacing.
   */
  mobRetreat?: boolean;
  /** Called after every step (debugging). */
  onTick?: (world: World, tick: number, mobId: string, events: readonly SimEvent[]) => void;
}

export type Outcome = "won" | "lost" | "trade" | "timeout";

export interface MobDuelResult {
  spec: MobDuelSpec;
  /** "won": the mob died and the player stood. "lost": the player went down. "trade": both fell in the same tick. "timeout": neither by the cap. */
  outcome: Outcome;
  /** Seconds from the start to the end of the duel. */
  seconds: number;
  /** The player's hp share at the end (0 when it fell), and the lowest it reached. A share, so the kill's own hp-stack drop (which raises max hp and hp together) doesn't move it. */
  hpLeft: number;
  minHp: number;
  /** The mob's hp share at the end (0 when it died). */
  mobHp: number;
  /** Whether and when (s) the mob woke, and the seconds from waking to its death (won/trade only). */
  wokeAt: number | null;
  killSeconds: number | null;
  /** Times the mob gave up the chase (fight -> return, or fight -> idle when it was at its camp already) and the seconds it spent walking home (untouchable). */
  gaveUp: number;
  evadeSeconds: number;
  /** The farthest the mob got from its camp spot (u). */
  maxFromHome: number;
  /** Damage after mitigation, as the `hit` fx reported it (damage over time is reported in chunks, so the last chunk can be missing). */
  mobDealt: number;
  playerDealt: number;
  /** Ticks a fighter wanted to walk, was free to and did not move: walking into a wall or into the other body. */
  stuck: { player: number; mob: number };
}

/** The player's spacing, copied at load: a what-if that changes POLICIES for the mobs (mobRetreat: false) must not change the player. */
const PLAYER_SPACING: Readonly<Record<WeaponId, SpacingPolicy>> = Object.fromEntries(
  WEAPON_IDS.map((w) => [w, { ...POLICIES[w] }]),
) as Record<WeaponId, SpacingPolicy>;

const ARENA_TILES = 40;
const CENTER = (ARENA_TILES * TILE) / 2;
const DEFAULT_DISTANCE = 300;
const DEFAULT_CAP = 60;
const NEVER_SECONDS = 1_000_000;
const PLAYER_ID = "p";

/** What a seed changes (see the file header). */
interface Variant { angle: number; distance: number; delayTicks: number; facing: "toward" | "side" | "away" }

export function variantOf(seed: number, distance: number): Variant {
  const rng = mulberry32(Math.imul(seed, 7919) + 13);
  const angle = rng() * Math.PI * 2;
  const jitter = (rng() - 0.5) * 40;
  const delayTicks = Math.floor(rng() * 4);
  return { angle, distance: distance + jitter, delayTicks, facing: (["toward", "side", "away"] as const)[Math.abs(seed) % 3]! };
}

/** The player's brain: the weapon policy, fed what a client sees (the render-time view), sending its inputs like a socket. */
class PlayerClient {
  private triggerDown = false;
  private sent: Vec2 | "stop" | null = null;
  private lastPos: Vec2 | null = null;
  stuck = 0;

  constructor(private readonly mobId: string, private readonly style: Style) {}

  private view(c: Combatant, now: number): { pos: Vec2; vel: Vec2; at: number } {
    const at = now - INTERP_DELAY_MS;
    const pos = positionAt(c.rt, c.s, at);
    const before = positionAt(c.rt, c.s, at - TICK_MS);
    const dt = TICK_MS / 1000;
    return { pos, vel: { x: (pos.x - before.x) / dt, y: (pos.y - before.y) / dt }, at };
  }

  noteMovement(world: World): void {
    const me = combatant(world, PLAYER_ID);
    if (!me || me.s.status !== "alive") return;
    const pos = { x: me.s.x, y: me.s.y };
    const last = this.lastPos;
    this.lastPos = pos;
    if (!last || !this.sent || this.sent === "stop") return;
    const wants = Math.hypot(this.sent.x - pos.x, this.sent.y - pos.y) > 40;
    if (wants && moveMultiplierOf(world, me) > 0 && Math.hypot(pos.x - last.x, pos.y - last.y) < 0.5) this.stuck++;
  }

  act(world: World): void {
    const me = combatant(world, PLAYER_ID);
    const foe = combatant(world, this.mobId);
    if (!me || !foe || me.s.status !== "alive" || foe.s.status !== "alive") return;
    const weapon = activeWeapon(me.s);
    const tm = weapon ? timingsOf(me.s, weapon) : null;
    if (!weapon || !tm) return;
    const now = world.state.serverTime;
    const mine = this.view(me, now);
    const theirs = this.view(foe, now);
    const map = world.map;
    const input: PolicyInput = {
      self: mine.pos, target: theirs.pos, targetVel: theirs.vel, selfVel: mine.vel,
      los: hasLineOfSight(map, mine.pos, theirs.pos),
      weapon,
      ready: now >= me.s.readyAt,
      walkable: (a, b) => segmentClear(map, a, b, PLAYER_RADIUS),
      time: now / 1000,
    };
    input.spacing = this.style === "stand" ? { ...PLAYER_SPACING[weapon], retreatBelow: 0 } : PLAYER_SPACING[weapon];
    if (isRanged(weapon)) {
      input.viewLag = INTERP_DELAY_MS / 1000;
      input.inputDelay = TICK_MS / 1000;
      input.windup = tm.windup;
    }
    const out = decide(input);
    const q = me.rt.inputs;
    enqueueClientMessage(q, "aim", { a: out.aim });
    if (out.move === "stop") {
      if (this.sent !== "stop") enqueueClientMessage(q, "stop", {});
      this.sent = "stop";
    } else if (out.move) {
      const last = this.sent;
      if (last === null || last === "stop" || Math.hypot(last.x - out.move.x, last.y - out.move.y) > 2) {
        enqueueClientMessage(q, "move", out.move);
        this.sent = out.move;
      }
    }
    const t = mine.at;
    if (out.hold && !this.triggerDown) {
      enqueueClientMessage(q, "attack", { a: out.aim, t });
      this.triggerDown = true;
    } else if (!out.hold && this.triggerDown) {
      enqueueClientMessage(q, "release", { a: out.aim, t });
      this.triggerDown = false;
    }
  }
}

export function runMobDuel(spec: MobDuelSpec): MobDuelResult {
  const cap = spec.capSeconds ?? DEFAULT_CAP;
  const wake = spec.wake ?? "hit";
  const style = spec.style ?? "policy";
  const v = variantOf(spec.seed, spec.distance ?? DEFAULT_DISTANCE);
  const weapon = spec.weapon ?? SIGNATURE_WEAPONS[spec.player];
  const kind = spec.elite ? "elite" : "mob";

  // The mob's scale for this duel: placeMob builds its hp from it and the sim fights it at it. Always put back.
  const savedRetreat = { bow: POLICIES.bow.retreatBelow, wand: POLICIES.wand.retreatBelow };
  if (spec.mobRetreat === false) {
    POLICIES.bow.retreatBelow = 0;
    POLICIES.wand.retreatBelow = 0;
  }
  if (spec.k !== undefined) setMobScalesForHarness(spec.elite ? undefined : spec.k, spec.elite ? spec.k : undefined);
  try {
    const home = { x: CENTER, y: CENTER };
    const start = { x: CENTER + Math.cos(v.angle) * v.distance, y: CENTER + Math.sin(v.angle) * v.distance };
    const toPlayer = Math.atan2(start.y - home.y, start.x - home.x);
    const mobFacing = v.facing === "toward" ? toPlayer : v.facing === "side" ? toPlayer + Math.PI / 2 : toPlayer + Math.PI;

    const world = createGameWorld({
      seed: spec.seed,
      random: mulberry32(spec.seed + 1),
      config: {
        minPlayers: 1, lobbySeconds: 1, fillSeconds: 0, patienceSeconds: NEVER_SECONDS, patienceMinSeconds: NEVER_SECONDS,
        suddenDeathSeconds: NEVER_SECONDS, mobs: false,
      },
      map: { ...buildArena("open", [home, start], spec.seed), spawns: [start] },
    }, { signatures: true });

    const p = addPlayer(world, PLAYER_ID, PLAYER_ID, { faction: spec.player });
    p.weapon0 = weapon;
    p.weapon1 = "";
    step(world, TICK_MS); // lobby -> active (no mobs: config.mobs is off, the one below is placed by hand)
    if (world.state.phase !== "active") throw new Error("mobDuel: the run did not start");

    const mobId = placeMob(world, { region: spec.region, elite: spec.elite, at: home, facing: mobFacing });
    const mob = combatant(world, mobId);
    if (!mob || mob.kind !== "mob" || !mob.rt.brain) throw new Error("mobDuel: no mob placed");
    const prt = world.players.get(PLAYER_ID)!;
    p.x = start.x;
    p.y = start.y;
    p.facing = Math.atan2(home.y - start.y, home.x - start.x);
    prt.history = [{ t: world.state.serverTime, x: p.x, y: p.y }];

    const client = new PlayerClient(mobId, spec.style ?? "policy");
    const extraLeash = Math.max(0, (spec.leash ?? MOB_LEASH_RADIUS) - MOB_LEASH_RADIUS);
    if (extraLeash > 0) {
      world.systems.unshift(() => {
        const b = mob.rt.brain!;
        const dx = mob.s.x - home.x;
        const dy = mob.s.y - home.y;
        const d = Math.hypot(dx, dy);
        const shift = b.mode === "fight" && d > 1e-6 ? Math.min(extraLeash, d) / d : 0;
        b.home.x = home.x + dx * shift;
        b.home.y = home.y + dy * shift;
      });
    }
    const t0 = world.state.raidStartedAt;
    const maxTicks = Math.round((cap * 1000) / TICK_MS);
    if (wake === "aggro") aggro(world, mob, PLAYER_ID, 1);

    let wokeAt: number | null = wake === "aggro" ? 0 : null;
    let gaveUp = 0;
    let evadeTicks = 0;
    let maxFromHome = 0;
    let mobDealt = 0;
    let playerDealt = 0;
    let minHp = 1;
    let mobStuck = 0;
    let lastMobPos: Vec2 = { x: mob.s.x, y: mob.s.y };
    let lastMode = mob.rt.brain.mode;
    let outcome: Outcome = "timeout";
    let deadAt: number | null = null;

    for (let tick = 0; tick < maxTicks; tick++) {
      if (tick >= v.delayTicks) client.act(world);
      const events = step(world, TICK_MS);
      const now = (world.state.serverTime - t0) / 1000;
      for (const e of events) {
        if (e.type !== "fx" || e.fx.kind !== "hit") continue;
        if (e.fx.by === mobId && e.fx.id === PLAYER_ID) mobDealt += e.fx.amount;
        else if (e.fx.by === PLAYER_ID && e.fx.id === mobId) playerDealt += e.fx.amount;
      }
      const brain = mob.rt.brain;
      if (wokeAt === null && brain.mode !== "idle") wokeAt = now;
      // A give-up at the camp spot goes straight from fight to idle in one tick (it is home already), so count both.
      if (lastMode === "fight" && brain.mode !== "fight" && mob.s.status === "alive") gaveUp++;
      lastMode = brain.mode;
      if (brain.mode === "return") evadeTicks++;
      maxFromHome = Math.max(maxFromHome, Math.hypot(mob.s.x - home.x, mob.s.y - home.y));
      if (brain.mode === "fight" && mob.rt.path.length > 0 && moveMultiplierOf(world, mob) > 0
        && Math.hypot(mob.s.x - lastMobPos.x, mob.s.y - lastMobPos.y) < 0.3) mobStuck++;
      lastMobPos = { x: mob.s.x, y: mob.s.y };
      client.noteMovement(world);
      minHp = Math.min(minHp, Math.max(0, p.hp) / p.maxHp);
      spec.onTick?.(world, tick, mobId, events);

      const mobDead = mob.s.status !== "alive";
      const playerDown = p.status !== "alive" || world.state.phase !== "active";
      if (mobDead && playerDown) { outcome = "trade"; deadAt = now; break; }
      if (mobDead) { outcome = "won"; deadAt = now; break; }
      if (playerDown) { outcome = "lost"; break; }
    }

    const seconds = (world.state.serverTime - t0) / 1000;
    const standing = p.status === "alive" && world.state.phase === "active";
    return {
      spec: { ...spec, weapon, wake, style, k: spec.k ?? (kind === "elite" ? ELITE_K : MOB_K) },
      outcome,
      seconds,
      hpLeft: standing ? Math.max(0, p.hp) / p.maxHp : 0,
      minHp,
      mobHp: mob.s.status === "alive" ? mob.s.hp / mob.s.maxHp : 0,
      wokeAt,
      killSeconds: deadAt !== null && wokeAt !== null ? deadAt - wokeAt : null,
      gaveUp,
      evadeSeconds: (evadeTicks * TICK_MS) / 1000,
      maxFromHome,
      mobDealt,
      playerDealt,
      stuck: { player: client.stuck, mob: mobStuck },
    };
  } finally {
    if (spec.k !== undefined) setMobScalesForHarness();
    POLICIES.bow.retreatBelow = savedRetreat.bow;
    POLICIES.wand.retreatBelow = savedRetreat.wand;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Aggregation and tables
// ---------------------------------------------------------------------------------------------------------------------

export interface CellStats {
  n: number;
  /** Share of duels the player won (a trade is not a win). */
  winRate: number;
  /** Mean player hp left over all duels (0 where it lost or timed out), and over the won ones only. */
  mean: number;
  meanWon: number;
  /** The worst duel (0 when one was lost). */
  worst: number;
  lost: number;
  timeouts: number;
  /** Mean seconds from waking to the kill, over won duels. */
  killSeconds: number;
  /** Duels in which the mob gave up the chase at least once. */
  gaveUpDuels: number;
}

export function cellStats(rs: readonly MobDuelResult[]): CellStats {
  const won = rs.filter((r) => r.outcome === "won");
  const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
  const kills = won.map((r) => r.killSeconds).filter((x): x is number => x !== null);
  return {
    n: rs.length,
    winRate: won.length / rs.length,
    mean: sum(rs.map((r) => (r.outcome === "won" ? r.hpLeft : 0))) / rs.length,
    meanWon: won.length ? sum(won.map((r) => r.hpLeft)) / won.length : 0,
    worst: Math.min(...rs.map((r) => (r.outcome === "won" ? r.hpLeft : 0))),
    lost: rs.filter((r) => r.outcome === "lost" || r.outcome === "trade").length,
    timeouts: rs.filter((r) => r.outcome === "timeout").length,
    killSeconds: kills.length ? sum(kills) / kills.length : NaN,
    gaveUpDuels: rs.filter((r) => r.gaveUp > 0).length,
  };
}

export interface Grid {
  elite: boolean;
  k: number;
  wake: Wake;
  seeds: number;
  /** cells[player][region] */
  cells: Record<FactionId, Record<FactionId, { results: MobDuelResult[]; stats: CellStats }>>;
}

export interface GridOpts {
  elite: boolean; k?: number; seeds?: number; wake?: Wake; style?: Style; capSeconds?: number; leash?: number; mobRetreat?: boolean;
  weapon?: (player: FactionId) => WeaponId; log?: (s: string) => void;
}

/** The 25 pairings (player faction x mob region), `seeds` duels each. */
export function runGrid(o: GridOpts): Grid {
  const seeds = o.seeds ?? 3;
  const k = o.k ?? (o.elite ? ELITE_K : MOB_K);
  const cells = {} as Grid["cells"];
  for (const player of FACTION_IDS) {
    cells[player] = {} as Grid["cells"][FactionId];
    for (const region of FACTION_IDS) {
      const results: MobDuelResult[] = [];
      for (let seed = 1; seed <= seeds; seed++) {
        results.push(runMobDuel({ player, region, elite: o.elite, k, seed, wake: o.wake, style: o.style, capSeconds: o.capSeconds, leash: o.leash, mobRetreat: o.mobRetreat, weapon: o.weapon?.(player) }));
      }
      cells[player][region] = { results, stats: cellStats(results) };
    }
    o.log?.(`${o.elite ? "elite" : "normal"} k=${k}: ${player} done`);
  }
  return { elite: o.elite, k, wake: o.wake ?? "hit", seeds, cells };
}

export function allResults(g: Grid): MobDuelResult[] {
  return FACTION_IDS.flatMap((p) => FACTION_IDS.flatMap((r) => g.cells[p][r].results));
}

const pct = (x: number): string => String(Math.round(x * 100));

export interface Verdict {
  /** Normal mob: every pairing winnable in at least 90% of its duels, the overall mean hp left within 55..85%, and the worst pairing's mean at least 25%. */
  pairingsBelow90: number;
  overallMean: number;
  worstPairingMean: number;
  /** The same two, over the pairings the player wins (at least 90% of their duels): the structural stalemates (a shield against a shield) don't pull them down. */
  meanOfWinnable: number;
  worstWinnableMean: number;
  /** Elite: pairings the player wins (at least half of the duels), the share of all duels won, and the mean hp left in the won pairings. */
  pairingsWon: number;
  winRate: number;
  meanInWonPairings: number;
  overallMeanAll: number;
  worstDuel: number;
  normalOk: boolean;
  eliteOk: boolean;
}

export function verdict(g: Grid): Verdict {
  const cells = FACTION_IDS.flatMap((p) => FACTION_IDS.map((r) => g.cells[p][r].stats));
  const all = allResults(g);
  const won = cells.filter((c) => c.winRate >= 0.5);
  const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const overallMean = mean(cells.map((c) => c.mean));
  const worstPairingMean = Math.min(...cells.map((c) => c.mean));
  const pairingsBelow90 = cells.filter((c) => c.winRate < 0.9).length;
  const winnable = cells.filter((c) => c.winRate >= 0.9);
  const meanInWon = mean(won.map((c) => c.mean));
  return {
    pairingsBelow90,
    overallMean,
    worstPairingMean,
    meanOfWinnable: mean(winnable.map((c) => c.mean)),
    worstWinnableMean: winnable.length ? Math.min(...winnable.map((c) => c.mean)) : 0,
    pairingsWon: won.length,
    winRate: all.filter((r) => r.outcome === "won").length / all.length,
    meanInWonPairings: meanInWon,
    overallMeanAll: overallMean,
    worstDuel: Math.min(...all.map((r) => (r.outcome === "won" ? r.hpLeft : 0))),
    normalOk: pairingsBelow90 === 0 && overallMean >= 0.55 && overallMean <= 0.85 && worstPairingMean >= 0.25,
    eliteOk: won.length >= 18 && meanInWon >= 0.25 && meanInWon <= 0.6 && won.length < 25,
  };
}

/** Rows: the player's faction; columns: the mob's region. Each cell: win% / mean hp left % / worst hp left % (losses count as 0). */
export function gridTable(g: Grid, what: "wmw" | "time" | "gaveup" | "outcomes" = "wmw"): string {
  const head = `| player \\ mob | ${FACTION_IDS.join(" | ")} |`;
  const sep = `|---|${FACTION_IDS.map(() => "---").join("|")}|`;
  const rows = FACTION_IDS.map((p) => {
    const cells = FACTION_IDS.map((r) => {
      const s = g.cells[p][r].stats;
      if (what === "time") return Number.isNaN(s.killSeconds) ? "-" : s.killSeconds.toFixed(1);
      if (what === "gaveup") return `${s.gaveUpDuels}/${s.n}`;
      if (what === "outcomes") return `${Math.round(s.winRate * s.n)}W ${s.lost}L ${s.timeouts}T`;
      return `${pct(s.winRate)}/${pct(s.mean)}/${pct(s.worst)}`;
    });
    return `| ${p} (${SIGNATURE_WEAPONS[p]}) | ${cells.join(" | ")} |`;
  });
  return [head, sep, ...rows].join("\n");
}

/** Pairings the player does not win: under 90% of their duels for a normal mob, under half for an elite. */
export function failing(g: Grid): string[] {
  const bar = g.elite ? 0.5 : 0.9;
  return FACTION_IDS.flatMap((p) => FACTION_IDS.filter((r) => g.cells[p][r].stats.winRate < bar).map((r) => `${p}>${r}`));
}

export function summaryLine(g: Grid): string {
  const v = verdict(g);
  const w = v.winRate;
  const fails = failing(g);
  return (g.elite
    ? `elite k=${g.k.toFixed(2)}: pairings won ${v.pairingsWon}/25, duels won ${pct(w)}%, mean hp left ${pct(v.overallMeanAll)}% (won pairings ${pct(v.meanInWonPairings)}%), worst duel ${pct(v.worstDuel)}%`
    : `normal k=${g.k.toFixed(2)}: pairings under 90% wins ${v.pairingsBelow90}, duels won ${pct(w)}%, mean hp left ${pct(v.overallMean)}% (winnable pairings ${pct(v.meanOfWinnable)}%), worst pairing mean ${pct(v.worstPairingMean)}% (winnable ${pct(v.worstWinnableMean)}%)`)
    + (fails.length ? ` [not won: ${fails.join(" ")}]` : "");
}

// ---------------------------------------------------------------------------------------------------------------------
// The continuous reference (shared/factions.ts duel(), no weapon layer, no signatures module, no movement)
// ---------------------------------------------------------------------------------------------------------------------

const DAMAGE_PARAMS = ["burn", "backlash", "plague", "execute", "mark_ramp", "mark_cap"];

/** A faction with its damage numbers (hit and the damage params) times `m`: the weapon's dpsMult folded in. */
function foldDps(spec: FactionSpec, m: number): FactionSpec {
  const params: Record<string, number> = {};
  for (const [key, v] of Object.entries(spec.params)) params[key] = DAMAGE_PARAMS.includes(key) ? v * m : v;
  return { ...spec, hit: spec.hit * m, params };
}

/** The old continuous reference: player on the plain faction sheet against the mob at scale k; `fold` multiplies in each side's weapon dpsMult. */
export function referenceDuel(player: FactionId, region: FactionId, k: number, fold: boolean): { won: boolean; left: number } {
  let a = FACTIONS[player];
  let b = scaledFaction(FACTIONS[region], k);
  if (fold) {
    a = foldDps(a, WEAPONS[SIGNATURE_WEAPONS[player]].dpsMult);
    b = foldDps(b, WEAPONS[REGION_WEAPONS[region]].dpsMult);
  }
  const r = duel(a, b);
  return { won: r.winner === 0, left: r.winner === 0 ? r.hpA / a.hp : 0 };
}

export function referenceTable(k: number, fold: boolean): { text: string; wins: number; mean: number; worst: number } {
  const lefts: number[] = [];
  let wins = 0;
  const rows = FACTION_IDS.map((p) => {
    const cells = FACTION_IDS.map((r) => {
      const d = referenceDuel(p, r, k, fold);
      lefts.push(d.left);
      if (d.won) wins++;
      return d.won ? pct(d.left) : "LOSS";
    });
    return `| ${p} | ${cells.join(" | ")} |`;
  });
  const text = [`| player \\ mob | ${FACTION_IDS.join(" | ")} |`, `|---|${FACTION_IDS.map(() => "---").join("|")}|`, ...rows].join("\n");
  return { text, wins, mean: lefts.reduce((a, b) => a + b, 0) / lefts.length, worst: Math.min(...lefts) };
}

/** Real sim minus the dpsMult-folded continuous reference, in points of hp left (LOSS = 0 on both sides), per pairing. */
export function compareTable(g: Grid): string {
  const rows = FACTION_IDS.map((p) => {
    const cells = FACTION_IDS.map((r) => {
      const ref = referenceDuel(p, r, g.k, true);
      const d = Math.round((g.cells[p][r].stats.mean - (ref.won ? ref.left : 0)) * 100);
      return d > 0 ? `+${d}` : String(d);
    });
    return `| ${p} | ${cells.join(" | ")} |`;
  });
  return [`| player \\ mob | ${FACTION_IDS.join(" | ")} |`, `|---|${FACTION_IDS.map(() => "---").join("|")}|`, ...rows].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------------------------

const NORMAL_SWEEP = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6];
const ELITE_SWEEP = [0.5, 0.6, 0.7, 0.8, 0.9];

function parseFlags(argv: string[]): { flags: Map<string, string>; bools: Set<string> } {
  const flags = new Map<string, string>();
  const bools = new Set<string>();
  const valued = new Set(["--seeds", "--wake", "--cap", "--k", "--elite-k", "--json", "--one", "--seed", "--weapon", "--leash", "--leashes", "--ks", "--eks", "--style"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (valued.has(a)) flags.set(a, argv[++i] ?? "");
    else bools.add(a);
  }
  return { flags, bools };
}

function main(): void {
  const { flags, bools } = parseFlags(process.argv.slice(2));
  const seeds = flags.has("--seeds") ? Number(flags.get("--seeds")) : 3;
  const wake = (flags.get("--wake") ?? "hit") as Wake;
  if (wake !== "hit" && wake !== "aggro") throw new Error(`--wake takes hit or aggro, not "${wake}"`);
  const capSeconds = flags.has("--cap") ? Number(flags.get("--cap")) : undefined;
  const log = (s: string): void => console.error(`[mobDuel] ${s}`);
  const out: Record<string, unknown> = {};

  if (flags.has("--one")) {
    const [player, region] = flags.get("--one")!.split(":");
    if (!isFactionId(player) || !isFactionId(region)) throw new Error("--one takes player:region, e.g. fire:holy");
    const weaponFlag = flags.get("--weapon");
    if (weaponFlag !== undefined && !isWeaponId(weaponFlag)) throw new Error(`unknown weapon "${weaponFlag}"`);
    const elite = bools.has("--elite");
    const trace = bools.has("--trace");
    const r = runMobDuel({
      player, region, elite, seed: flags.has("--seed") ? Number(flags.get("--seed")) : 1, wake, capSeconds,
      k: flags.has("--k") ? Number(flags.get("--k")) : undefined, weapon: weaponFlag as WeaponId | undefined,
      leash: flags.has("--leash") ? Number(flags.get("--leash")) : undefined,
      style: (flags.get("--style") ?? "policy") as Style,
      mobRetreat: bools.has("--mobs-stand") ? false : undefined,
      onTick: trace
        ? (world, tick, mobId) => {
          if (tick % 10 !== 0) return;
          const p = world.state.players.get(PLAYER_ID)!;
          const m = world.state.mobs.get(mobId)!;
          const b = world.mobs.get(mobId)!.brain!;
          console.log(
            `t=${((tick + 1) * TICK_MS / 1000).toFixed(1).padStart(5)} player (${p.x.toFixed(0)},${p.y.toFixed(0)}) hp ${(p.hp / p.maxHp * 100).toFixed(0).padStart(3)}%` +
            ` | mob (${m.x.toFixed(0)},${m.y.toFixed(0)}) hp ${(m.hp / m.maxHp * 100).toFixed(0).padStart(3)}% ${b.mode} ` +
            `d=${Math.hypot(p.x - m.x, p.y - m.y).toFixed(0)} home=${Math.hypot(m.x - b.home.x, m.y - b.home.y).toFixed(0)}`,
          );
        }
        : undefined,
    });
    const { spec: _spec, ...rest } = r;
    console.log(JSON.stringify(rest, (_k, v: unknown) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v), 1));
    return;
  }

  const style = (flags.get("--style") ?? "policy") as Style;
  if (style !== "policy" && style !== "stand") throw new Error(`--style takes policy or stand, not "${style}"`);
  const mobRetreat = bools.has("--mobs-stand") ? false : undefined;
  const leash = flags.has("--leash") ? Number(flags.get("--leash")) : undefined;
  const gridOf = (elite: boolean, k?: number, weapon?: (p: FactionId) => WeaponId, leashOverride?: number): Grid =>
    runGrid({ elite, k, seeds, wake, style, capSeconds, weapon, leash: leashOverride ?? leash, mobRetreat, log });
  const print = (title: string, body: string): void => { console.log(`\n### ${title}\n\n${body}`); };

  if (bools.has("--reference")) {
    for (const fold of [false, true]) {
      for (const [label, k] of [["normal", MOB_K], ["elite", ELITE_K]] as const) {
        const t = referenceTable(k, fold);
        print(`continuous duel(), ${label} k=${k}, ${fold ? "dpsMult folded" : "plain faction sheet"}: wins ${t.wins}/25, mean hp left ${pct(t.mean)}%, worst ${pct(t.worst)}%`, t.text);
      }
    }
    return;
  }

  if (bools.has("--sweep")) {
    // --leashes 224,288,352 x --ks / --eks (comma lists) override the default k lists; one summary line per (leash, k).
    const list = (name: string, dflt: number[]): number[] => (flags.has(name) ? flags.get(name)!.split(",").map(Number) : dflt);
    const leashes = list("--leashes", [leash ?? MOB_LEASH_RADIUS]);
    const lines: string[] = [];
    for (const l of leashes) {
      for (const k of list("--ks", NORMAL_SWEEP)) { const g = gridOf(false, k, undefined, l); const t = `leash ${l}: ${summaryLine(g)}`; lines.push(t); log(t); }
      for (const k of list("--eks", ELITE_SWEEP)) { const g = gridOf(true, k, undefined, l); const t = `leash ${l}: ${summaryLine(g)}`; lines.push(t); log(t); }
    }
    print(`k sweep (wake=${wake}, ${seeds} seeds)`, lines.join("\n"));
    return;
  }

  if (bools.has("--weapons")) {
    // The player on each weapon (its faction's stats unchanged): the weapon-edge variants.
    const lines: string[] = [];
    for (const elite of [false, true]) {
      for (const w of WEAPON_IDS) {
        const g = gridOf(elite, undefined, () => w);
        lines.push(`${w}: ${summaryLine(g)}`);
        print(`${elite ? "elite" : "normal"} mob, every player faction on the ${w}`, gridTable(g));
      }
    }
    print("weapon summary", lines.join("\n"));
    return;
  }

  const k = flags.has("--k") ? Number(flags.get("--k")) : undefined;
  const ek = flags.has("--elite-k") ? Number(flags.get("--elite-k")) : undefined;
  const normal = gridOf(false, k);
  const elite = gridOf(true, ek);
  print(`normal mob k=${normal.k} (wake=${wake}, ${seeds} seeds): win% / mean hp left % / worst hp left %`, gridTable(normal));
  console.log(`\n${summaryLine(normal)}`);
  print("normal: real sim minus the dpsMult-folded continuous duel(), points of hp left", compareTable(normal));
  print("normal: outcomes per pairing (W won, L lost or traded, T neither by the cap)", gridTable(normal, "outcomes"));
  print("normal: mean seconds from wake to kill", gridTable(normal, "time"));
  print("normal: duels in which the mob gave up the chase", gridTable(normal, "gaveup"));
  print(`elite k=${elite.k} (wake=${wake}, ${seeds} seeds): win% / mean hp left % / worst hp left %`, gridTable(elite));
  console.log(`\n${summaryLine(elite)}`);
  print("elite: real sim minus the dpsMult-folded continuous duel(), points of hp left", compareTable(elite));
  print("elite: outcomes per pairing", gridTable(elite, "outcomes"));
  print("elite: mean seconds from wake to kill", gridTable(elite, "time"));
  print("elite: duels in which the mob gave up the chase", gridTable(elite, "gaveup"));
  out.normal = { k: normal.k, verdict: verdict(normal) };
  out.elite = { k: elite.k, verdict: verdict(elite) };
  if (flags.has("--json")) {
    writeFileSync(flags.get("--json")!, JSON.stringify(out, null, 1));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
