// The zone duel harness (zone-shapes contract 8.3): duels fought where the terrain is, not on the weapon harness's bare floor.
//
//   npm run harness:zones -w @raid/server [-- --source rows|map|both] [--variants] [--seeds N] [--pairs P] [--zone a,b] [--edge a>b,..]
//                                         [--cap SECONDS] [--rows-setups full|quick] [--quiet]
//
// (a) THE ROWS CONDITION. The Gallows' fence rows (zoneStyle/gallows.ts) let everyone see and shoot across them and send a walker to
//     a gate, so the zone is only approved while Fire (axe) still beats Sentenced (bow) at a fence. Both fighters hold their
//     signature weapons, signatures on, and both lock the other (the game client's controls: a click, then the server chases,
//     attacks and aims), perception "client". They start on opposite sides of one row, 4, 6 and 7.5 tiles apart (the bow reaches
//     7.5), the line between them crossing the row 0, 2, 4 and 6 tiles from the centre of the nearest gate (6 is as far from a gate
//     as a row of period 12 gets), the line tilted 4 ways, and each fighter in turn as the one further from the gate: 96 setups. The
//     same 96 setups on the open floor are the control. HOLDS when Fire wins at least half of the 96 pooled. When it does not, the three
//     mitigations the contract names are run the same way (gate spacing 12 -> 10, gate width 3 -> 4, four rows -> three) and the first
//     that holds is the proposed change. Nothing is switched: the verdict goes to the owner.
// (b) REAL ZONES (`--source map`). For seeds 1..N the generator's map; in every zone pairs of floor tiles 4 to 7.5 tiles apart; every
//     designed faction edge (BEATS) fought on both fighters' signature weapons, signatures on, both locking; the designed winner's win
//     rate there against the same duels on the open floor. It reads whatever generateMap builds, so it runs on the old stylers now
//     and on the final maps in phase C.
//
// Report-only: no outcome is asserted and no number is changed. It exits 0 unless the arguments are invalid or a run throws.
import { pathToFileURL } from "node:url";
import {
  FACTIONS,
  BEATS, circleClear, FACTION_IDS, findPath, generateMap, hasLineOfSight, mulberry32, moveComponents, pathLength, PLAYER_RADIUS, PLAYER_SPEED,
  isRanged, raycast, REGION_IDS, segmentClear, SIGNATURE_WEAPONS, TERRAIN_FENCE, TICK_MS, TILE, TILE_LOW, worldToTile,
  type FactionId, type GameMap, type Vec2,
} from "@raid/shared";
import { wilson as wilsonScore } from "../bots/tournament/report";
import { spacingFor, type Style } from "./matrix";
import {
  ARENA_TILES, buildArena, isRowsArena, ROWS_LAYOUTS, ROWS_S_LO, rowsGateOpen, runDuel, startPoints, type Arena, type DuelResult, type DuelSpec,
  type RowsArena,
} from "./duel";

// ---------------------------------------------------------------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------------------------------------------------------------

/** A Wilson 95% interval for `k` of `n`, in [0, 1] (everything when there is no data). */
export function wilson(k: number, n: number): [number, number] {
  if (n <= 0) return [0, 1];
  const w = wilsonScore(k, n);
  return [w.lo, w.hi];
}

const pct = (x: number, digits = 0): string => `${(x * 100).toFixed(digits)}%`;
const mean = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
const num = (x: number | null, digits = 2, unit = ""): string => (x === null ? "-" : `${x.toFixed(digits)}${unit}`);

// ---------------------------------------------------------------------------------------------------------------------------------
// (a) The Rows condition
// ---------------------------------------------------------------------------------------------------------------------------------

/** The Rows condition's fighters: the designed winner of Fire > Sentenced (an axe) against its designed loser (a bow). */
export const ROWS_FIGHTERS = { fire: "fire", sentenced: "sentenced" } as const;
/** The condition's time cap: the faction cycle's policy-mode cap (a Sentenced duel is a long one). */
export const ROWS_CAP_SECONDS = 150;
/** Fire must win at least this share of the pooled setups for the Rows to hold. */
export const ROWS_HOLD = 0.5;
/** Tiles between the two fighters, centre to centre: three starts up to the bow's reach (7.5 tiles = 240 u). */
export const ROWS_ACROSS = [4, 6, 7.5] as const;
/** Tiles from the centre of the nearest gate to where the line between the fighters crosses the row (6 = halfway to the next gate). */
export const ROWS_LATERAL = [0, 2, 4, 6] as const;
/** Radians between the line from the closer fighter to the further one and the row's normal. 0.9 keeps a 4-tile start off the fence. */
export const ROWS_ANGLES = [0, 0.3, 0.6, 0.9] as const;

export interface RowsSetup {
  /** Tiles between the fighters. */
  across: number;
  /** Tiles from the centre of the nearest gate to the crossing of the row. */
  lateral: number;
  /** Radians off the row's normal; the further fighter is the one this tilts away from the gate. */
  angle: number;
  /** Which fighter is the one further from the gate: Fire (the melee fighter) or Sentenced (the shooter). */
  furtherIs: "fire" | "sentenced";
}

/** The 96 setups of the condition (3 x 4 x 4 x 2), or a quarter of them (angles 0 and 0.6 only, 48) for a quick look. */
export function rowsSetups(size: "full" | "quick" = "full"): RowsSetup[] {
  const out: RowsSetup[] = [];
  const angles = size === "full" ? ROWS_ANGLES : ROWS_ANGLES.filter((_, i) => i % 2 === 0);
  for (const across of ROWS_ACROSS) {
    for (const lateral of ROWS_LATERAL) {
      for (const angle of angles) for (const furtherIs of ["fire", "sentenced"] as const) out.push({ across, lateral, angle, furtherIs });
    }
  }
  return out;
}

/** The row the condition is fought at: the second one, an odd row, in the middle of both layouts. */
const ROW_INDEX = 1;

/**
 * Centre (in tiles along y) of the gate of the condition's row that lies nearest the arena's middle. A gate is a run of consecutive
 * gate tiles; its centre is its first tile plus half its width.
 */
export function nearestGateCentre(arena: RowsArena): number {
  const layout = ROWS_LAYOUTS[arena];
  let best = Infinity, bestCentre = ARENA_TILES / 2;
  for (let s = ROWS_S_LO; s < ARENA_TILES - 1; s++) {
    if (!rowsGateOpen(layout, ROW_INDEX, s) || (s > ROWS_S_LO && rowsGateOpen(layout, ROW_INDEX, s - 1))) continue;
    let w = 0;
    while (s + w < ARENA_TILES - 1 && rowsGateOpen(layout, ROW_INDEX, s + w)) w++;
    const centre = s + w / 2;
    if (Math.abs(centre - ARENA_TILES / 2) < best) { best = Math.abs(centre - ARENA_TILES / 2); bestCentre = centre; }
  }
  return bestCentre;
}

/**
 * Where [Fire, Sentenced] stand for `setup` in the layout `arena` (any rows arena; the open control uses the same points). The line
 * between them crosses the condition's row at lateral tiles from the nearest gate's centre, Fire on one side and Sentenced on the
 * other; the fighter on the +y side is the one further from the gate (the gate lies at lower y).
 */
export function rowsStarts(arena: RowsArena, setup: RowsSetup): [Vec2, Vec2] {
  const gate = nearestGateCentre(arena);
  const rowX = ROWS_LAYOUTS[arena].xs[ROW_INDEX]! + 0.5;
  const px = rowX, py = gate + setup.lateral;
  const h = setup.across / 2;
  const near = { x: (px - h * Math.cos(setup.angle)) * TILE, y: (py - h * Math.sin(setup.angle)) * TILE };
  const far = { x: (px + h * Math.cos(setup.angle)) * TILE, y: (py + h * Math.sin(setup.angle)) * TILE };
  // Both ends of the line are on opposite sides of the row; `near` is the closer to the gate (it has the lower y).
  return setup.furtherIs === "fire" ? [far, near] : [near, far];
}

/** What one Rows duel records beyond the duel's own result. */
export interface RowsOutcome {
  setup: RowsSetup;
  result: DuelResult;
  /** Fire (fighter 0) stood last. */
  fireWon: boolean;
  /** Fire's hp share minus Sentenced's at the end (positive: Fire ahead). */
  margin: number;
  /** Seconds of the walk Fire has to make around the row beyond the straight line: (path length - straight) / PLAYER_SPEED. 0 in the open. */
  detourStatic: number | null;
  /** Seconds from the start to Fire's first axe hit on Sentenced, or null when it never landed one. */
  firstAxeHit: number | null;
  /** Arrows Sentenced loosed, and those loosed with a fence tile on the straight line to Fire (the arrow flies over it). */
  arrows: number;
  arrowsThroughFence: number;
  /** Sentenced's bow hits on Fire, how many of them landed with a fence between the two at that tick, and the damage of those. */
  bowHits: number;
  bowHitsThroughFence: number;
  bowDamageThroughFence: number;
}

/** Is a fence (a LOW tile) on the straight line a-b? Arrows and balls fly over it; swings and walkers do not. */
const fenceBetween = (map: GameMap, a: Vec2, b: Vec2): boolean => !hasLineOfSight(map, a, b, TILE_LOW);

export interface RowsDuelOptions {
  capSeconds?: number;
  /** Duels per setup (default 1): the setups are repeated with other seeds, which change the shuffled order the sim breaks ties in. */
  seedsPerSetup?: number;
  /**
   * How Sentenced plays its bow. "lock" (the default, the contract's condition) clicks Fire and lets the server chase and shoot; the
   * others are the weapon harness's styles, a STRESS beyond the contract: a shooter that stands, sidesteps, backs off sooner or
   * orb-walks while Fire still locks it.
   */
  shooter?: Style;
}

/** One duel of the Rows condition in `arena` (a rows arena, or "open" for the control) at `starts`, seeded by `seed`. */
export function runRowsDuel(arena: Arena, setup: RowsSetup, starts: readonly [Vec2, Vec2], seed: number, opts: RowsDuelOptions = {}): RowsOutcome {
  const capSeconds = opts.capSeconds ?? ROWS_CAP_SECONDS;
  const shooter = opts.shooter ?? "lock";
  let firstAxeHit: number | null = null;
  let arrows = 0, arrowsThroughFence = 0, bowHits = 0, bowHitsThroughFence = 0, bowDamageThroughFence = 0;
  const seen = new Set<string>();
  const result = runDuel({
    faction: ROWS_FIGHTERS.fire, factions: [ROWS_FIGHTERS.fire, ROWS_FIGHTERS.sentenced],
    weapons: [SIGNATURE_WEAPONS[ROWS_FIGHTERS.fire], SIGNATURE_WEAPONS[ROWS_FIGHTERS.sentenced]],
    signatures: true, locks: [true, shooter === "lock"], perception: "client", arena, starts, distance: setup.across * TILE, capSeconds, seed,
    spacing: [undefined, shooter === "lock" ? undefined : spacingFor(SIGNATURE_WEAPONS.sentenced, shooter)],
    onTick: (world, tick, events) => {
      const f0 = world.state.players.get("f0"), f1 = world.state.players.get("f1");
      if (!f0 || !f1) return;
      for (const [id, pr] of world.projectiles) {
        if (seen.has(id)) continue;
        seen.add(id);
        if (pr.owner !== "f1") continue;
        arrows++;
        if (fenceBetween(world.map, { x: pr.x, y: pr.y }, { x: f0.x, y: f0.y })) arrowsThroughFence++;
      }
      for (const e of events) {
        if (e.type !== "fx" || e.fx.kind !== "hit") continue;
        const fx = e.fx;
        if (fx.by === "f0" && fx.weapon === SIGNATURE_WEAPONS.fire && !fx.sig && firstAxeHit === null) firstAxeHit = (tick + 1) * TICK_MS / 1000;
        if (fx.by === "f1" && fx.id === "f0" && fx.weapon === SIGNATURE_WEAPONS.sentenced && !fx.sig) {
          bowHits++;
          if (fenceBetween(world.map, { x: f1.x, y: f1.y }, { x: f0.x, y: f0.y })) { bowHitsThroughFence++; bowDamageThroughFence += fx.amount; }
        }
      }
    },
  });
  const straight = Math.hypot(starts[1].x - starts[0].x, starts[1].y - starts[0].y);
  const map = isRowsArena(arena) ? buildArena(arena, starts, seed) : null;
  let detourStatic: number | null = 0;
  if (map) {
    const path = findPath(map, starts[0], starts[1]);
    detourStatic = path.length === 0 ? null : Math.max(0, pathLength(starts[0], path) - straight) / PLAYER_SPEED;
  }
  return {
    setup, result, fireWon: result.winner === 0, margin: result.hpFrac[0] - result.hpFrac[1], detourStatic, firstAxeHit,
    arrows, arrowsThroughFence, bowHits, bowHitsThroughFence, bowDamageThroughFence,
  };
}

/** The numbers of one arena over the whole set of setups. */
export interface RowsStats {
  arena: Arena;
  n: number;
  fireWins: number;
  sentencedWins: number;
  /** Duels with no winner: both fell together, or nobody had by the cap. They count against Fire's rate. */
  noWinner: number;
  caps: number;
  rate: number;
  ci: [number, number];
  /** Mean of Fire's hp share minus Sentenced's, over every duel; and Fire's mean hp share left over the duels it won. */
  margin: number | null;
  fireHpWhenWon: number | null;
  /** The least hp share Fire had left in any duel it won: how close the closest win came. */
  fireHpWorstWin: number | null;
  medianSeconds: number | null;
  /** Mean static detour (s) over the setups that have a path; the mean paired difference (rows - open) of the time to Fire's first axe hit, when both landed one. */
  detourStatic: number | null;
  detourStaticMax: number | null;
  detourFirstHit: number | null;
  arrows: number;
  arrowsThroughFence: number;
  bowHits: number;
  bowHitsThroughFence: number;
  bowDamageThroughFence: number;
  outcomes: RowsOutcome[];
}

export function rowsStats(arena: Arena, outcomes: RowsOutcome[], control?: RowsOutcome[]): RowsStats {
  const fireWins = outcomes.filter((o) => o.fireWon).length;
  const sentencedWins = outcomes.filter((o) => o.result.winner === 1).length;
  const won = outcomes.filter((o) => o.fireWon);
  const paired: number[] = [];
  if (control) {
    outcomes.forEach((o, i) => {
      const c = control[i];
      if (c && o.firstAxeHit !== null && c.firstAxeHit !== null) paired.push(o.firstAxeHit - c.firstAxeHit);
    });
  }
  const sum = (f: (o: RowsOutcome) => number): number => outcomes.reduce((a, o) => a + f(o), 0);
  return {
    arena, n: outcomes.length, fireWins, sentencedWins, noWinner: outcomes.length - fireWins - sentencedWins,
    caps: outcomes.filter((o) => o.result.end === "cap").length,
    rate: outcomes.length ? fireWins / outcomes.length : 0, ci: wilson(fireWins, outcomes.length),
    margin: mean(outcomes.map((o) => o.margin)), fireHpWhenWon: mean(won.map((o) => o.result.hpFrac[0])),
    fireHpWorstWin: won.length ? Math.min(...won.map((o) => o.result.hpFrac[0])) : null,
    medianSeconds: median(outcomes.map((o) => o.result.seconds)),
    detourStatic: mean(outcomes.map((o) => o.detourStatic).filter((x): x is number => x !== null)),
    detourStaticMax: outcomes.reduce<number | null>((m, o) => (o.detourStatic === null ? m : m === null ? o.detourStatic : Math.max(m, o.detourStatic)), null),
    detourFirstHit: control ? mean(paired) : null,
    arrows: sum((o) => o.arrows), arrowsThroughFence: sum((o) => o.arrowsThroughFence),
    bowHits: sum((o) => o.bowHits), bowHitsThroughFence: sum((o) => o.bowHitsThroughFence),
    bowDamageThroughFence: sum((o) => o.bowDamageThroughFence), outcomes,
  };
}

/**
 * Every setup in `arena`, `seedsPerSetup` times over, each duel seeded by its place in the list (the same seed in the control, so a pair
 * differs by the fences alone). The list is the setups once per seed in turn.
 */
export function runRowsArena(arena: RowsArena | "open", layout: RowsArena, setups: readonly RowsSetup[], opts: RowsDuelOptions = {}, log?: (line: string) => void): RowsOutcome[] {
  const repeats = Math.max(1, Math.floor(opts.seedsPerSetup ?? 1));
  const out: RowsOutcome[] = [];
  for (let k = 0; k < repeats; k++) {
    setups.forEach((setup, i) => {
      if (log && (k * setups.length + i) % 48 === 0) log(`${arena}: duel ${k * setups.length + i + 1}/${repeats * setups.length}`);
      out.push(runRowsDuel(arena, setup, rowsStarts(layout, setup), 1 + i + k * 1000, opts));
    });
  }
  return out;
}

export interface RowsReport {
  /** The design ("rows") and the control ("open"), and the variants when they were run. */
  stats: Record<string, RowsStats>;
  holds: boolean;
  /** The first variant (in the contract's order: gate spacing, gate width, row count) that holds, when "rows" does not. */
  proposal: RowsArena | null;
  text: string[];
}

const VARIANT_ORDER: readonly RowsArena[] = ["rows10", "rows4w", "rows6"];
const VARIANT_CHANGE: Readonly<Record<RowsArena, string>> = {
  rows: "the design: four rows, a gate every 12 tiles, 3 wide",
  rows10: "gate spacing 12 -> 10 tiles",
  rows4w: "gate width 3 -> 4 tiles",
  rows6: "three rows (x = 10, 20, 30) instead of four",
};

function rowsLine(label: string, s: RowsStats): string {
  const rate = `${pct(s.rate)} (${s.fireWins}/${s.n}, 95% ${pct(s.ci[0])}-${pct(s.ci[1])})`;
  return [
    label.padEnd(8), rate.padEnd(34), num(s.margin === null ? null : s.margin * 100, 0, "%").padStart(7),
    num(s.fireHpWhenWon === null ? null : s.fireHpWhenWon * 100, 0, "%").padStart(8), num(s.fireHpWorstWin === null ? null : s.fireHpWorstWin * 100, 0, "%").padStart(7), num(s.medianSeconds, 1, "s").padStart(8),
    `${num(s.detourStatic, 2)}/${num(s.detourStaticMax, 2, "s")}`.padStart(12), num(s.detourFirstHit, 2, "s").padStart(9),
    `${s.arrowsThroughFence}/${s.arrows}`.padStart(11), `${s.bowHitsThroughFence}/${s.bowHits}`.padStart(9),
    String(s.noWinner).padStart(5),
  ].join("  ");
}

const ROWS_HEAD = [
  "arena".padEnd(8), "Fire wins".padEnd(34), "margin".padStart(7), "Fire hp".padStart(8), "worst".padStart(7), "median".padStart(8), "detour mean/max".padStart(12), "d.1st hit".padStart(9),
  "thru-fence".padStart(11), "hits thru".padStart(9), "no win".padStart(5),
].join("  ");

/** Fire's win rate and mean hp margin (Fire's share minus Sentenced's, in points) by one setup dimension, for the design and the control side by side. */
function breakdown(title: string, keys: readonly (number | string)[], pick: (s: RowsSetup) => number | string, rows: RowsStats, open: RowsStats): string[] {
  const cell = (s: RowsStats, key: number | string): string => {
    const xs = s.outcomes.filter((o) => pick(o.setup) === key);
    const w = xs.filter((o) => o.fireWon).length;
    const m = mean(xs.map((o) => o.margin));
    return `${pct(xs.length ? w / xs.length : 0)} ${m === null ? "-" : `${m >= 0 ? "+" : ""}${(m * 100).toFixed(0)}`}`.padStart(11);
  };
  const n = (s: RowsStats, key: number | string): number => s.outcomes.filter((o) => pick(o.setup) === key).length;
  return [
    `  by ${title}:   (Fire wins, hp margin in points)`,
    `    ${"".padEnd(6)}${keys.map((k) => String(k).padStart(11)).join("")}`,
    `    ${"rows".padEnd(6)}${keys.map((k) => cell(rows, k)).join("")}    (n = ${n(rows, keys[0]!)} each)`,
    `    ${"open".padEnd(6)}${keys.map((k) => cell(open, k)).join("")}`,
  ];
}

export interface RowsRunOptions {
  setups?: "full" | "quick";
  /** An explicit list of setups instead (tests, one-off looks). */
  setupList?: readonly RowsSetup[];
  /** Run the three variants even when the design holds. */
  variants?: boolean;
  capSeconds?: number;
  /** Sentenced's play: the contract's "lock" or a harness style (a stress). */
  shooter?: Style;
  /** Duels per setup (default 1; RowsDuelOptions.seedsPerSetup). */
  seedsPerSetup?: number;
  /** The line for HOLDS (ROWS_HOLD, 0.5); tests move it to reach the FAILS branch. */
  hold?: number;
  log?: (line: string) => void;
}

/**
 * The first variant, in the order the contract lists the mitigations (gate spacing, gate width, row count), whose Fire win rate reaches
 * `hold`; null when none does. `rates` holds the rates of the variants that were run.
 */
export function proposeMitigation(rates: Partial<Record<RowsArena, number>>, hold = ROWS_HOLD): RowsArena | null {
  for (const v of VARIANT_ORDER) if ((rates[v] ?? -1) >= hold) return v;
  return null;
}

export function rowsReport(opts: RowsRunOptions = {}): RowsReport {
  const setups = opts.setupList ?? rowsSetups(opts.setups ?? "full");
  const run: RowsDuelOptions = { capSeconds: opts.capSeconds ?? ROWS_CAP_SECONDS, shooter: opts.shooter, seedsPerSetup: opts.seedsPerSetup };
  const repeats = Math.max(1, Math.floor(run.seedsPerSetup ?? 1));
  const hold = opts.hold ?? ROWS_HOLD;
  const log = opts.log;
  const control = runRowsArena("open", "rows", setups, run, log);
  const design = runRowsArena("rows", "rows", setups, run, log);
  const stats: Record<string, RowsStats> = { open: rowsStats("open", control), rows: rowsStats("rows", design, control) };
  const holds = stats.rows!.rate >= hold;
  let proposal: RowsArena | null = null;
  if (!holds || opts.variants) {
    for (const v of VARIANT_ORDER) {
      // A variant's control is the open floor at the variant's own starts, so the paired detour is read against it.
      const ctl = runRowsArena("open", v, setups, run, log);
      stats[v] = rowsStats(v, runRowsArena(v, v, setups, run, log), ctl);
    }
    if (!holds) proposal = proposeMitigation(Object.fromEntries(VARIANT_ORDER.map((v) => [v, stats[v]!.rate])), hold);
  }
  const size = opts.setupList ? "custom" : (opts.setups ?? "full");
  const text: string[] = [];
  text.push(`THE ROWS CONDITION  Fire (axe) vs Sentenced (bow), signatures on, Fire locks Sentenced and ${run.shooter && run.shooter !== "lock" ? `Sentenced plays the bow in the "${run.shooter}" style (a STRESS beyond the contract)` : "Sentenced locks Fire"}, perception client`);
  const seedsText = repeats === 1 ? "one seed per setup" : `${repeats} seeds per setup (${setups.length * repeats} duels in each arena)`;
  text.push(size === "custom"
    ? `${setups.length} setups from a list; cap ${run.capSeconds} s; ${seedsText}, the same in every arena`
    : `${setups.length} setups: ${ROWS_ACROSS.join("/")} tiles apart x crossing ${ROWS_LATERAL.join("/")} tiles from the nearest gate's centre x ${size === "full" ? ROWS_ANGLES.length : 2} tilts x each fighter as the one further from the gate; cap ${run.capSeconds} s; ${seedsText}, the same in every arena`);
  text.push(`Fire wins = stands last; a draw or a cap counts against it. margin = Fire hp share minus Sentenced's, mean over all duels; Fire hp = its mean share left in its wins; worst = the least it had left in a win`);
  text.push(`detour = the extra walk the row costs Fire to the foe's start, in seconds at ${PLAYER_SPEED} u/s (mean / worst setup); d.1st hit = the paired change (rows - open) of the time to Fire's first axe hit`);
  text.push(`thru-fence = arrows loosed with a fence tile on the line to Fire / all arrows; hits thru = Sentenced's bow hits that landed with a fence between the two / all its bow hits`);
  text.push(`only the second row of an arena is crossed by these setups, so "rows6" (which changes the other rows) differs from "rows" only through where that row stands`);
  text.push("");
  text.push(`  ${ROWS_HEAD}`);
  text.push(`  ${rowsLine("open", stats.open!)}`);
  text.push(`  ${rowsLine("rows", stats.rows!)}`);
  for (const v of VARIANT_ORDER) if (stats[v]) text.push(`  ${rowsLine(v, stats[v]!)}   ${VARIANT_CHANGE[v]}`);
  text.push("");
  const tilts = size === "full" ? ROWS_ANGLES : size === "quick" ? [0, 0.6] : [...new Set(setups.map((s) => s.angle))];
  text.push(...breakdown("tiles apart", [...new Set(setups.map((s) => s.across))], (s) => s.across, stats.rows!, stats.open!));
  text.push(...breakdown("crossing tiles from the gate", [...new Set(setups.map((s) => s.lateral))], (s) => s.lateral, stats.rows!, stats.open!));
  text.push(...breakdown("tilt (rad)", tilts, (s) => s.angle, stats.rows!, stats.open!));
  text.push(...breakdown("who is further from the gate", ["fire", "sentenced"], (s) => s.furtherIs, stats.rows!, stats.open!));
  text.push("");
  const r = stats.rows!;
  const shotShare = r.arrows ? r.arrowsThroughFence / r.arrows : 0;
  text.push(`VERDICT  The Rows ${holds ? "HOLD" : "FAIL"}: Fire wins ${pct(r.rate)} of ${r.n} pooled (the line is ${pct(hold)}; the open control ${pct(stats.open!.rate)}).`
    + ` Fire's closest win left it ${num(r.fireHpWorstWin === null ? null : r.fireHpWorstWin * 100, 0, "%")} of its hp. ${pct(shotShare)} of Sentenced's arrows crossed a fence.`);
  if (!holds) {
    if (proposal) text.push(`PROPOSED MITIGATION  ${VARIANT_CHANGE[proposal]} (${pct(stats[proposal]!.rate)}); the first of gate spacing, gate width and row count that holds. Not switched.`);
    else text.push(`PROPOSED MITIGATION  none of the three single changes holds (${VARIANT_ORDER.map((v) => `${v} ${pct(stats[v]!.rate)}`).join(", ")}); a combination or a different lever is needed. Not switched.`);
  }
  return { stats, holds, proposal, text };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// (b) Real zones of generated maps
// ---------------------------------------------------------------------------------------------------------------------------------

export const PAIR_MIN_TILES = 4;
export const PAIR_MAX_TILES = 7.5;
/** Tries per pair wanted; an "obstructed" draw on a map with few obstacles needs many. */
const PAIR_TRIES_EACH = 400;
export const ZONE_CAP_SECONDS = 150;

export interface ZonePair {
  a: Vec2;
  b: Vec2;
  /** Tiles between them. */
  tiles: number;
  /** Radians from a to b. */
  angle: number;
  /** A body cannot walk the straight line from a to b (a wall, a fence, lava or a crevasse is on or beside it): the pairs terrain can change. */
  obstructed: boolean;
}

/**
 * Which pairs to draw: any, only those a body cannot walk straight ("obstructed"), only those it can ("clear"), or only those with a
 * fence on the straight line between them ("fenced": a fence row between the two, the Gallows' own case on a real map).
 */
export type PairKind = "any" | "obstructed" | "clear" | "fenced";

/**
 * `count` pairs of floor tiles in `zone` of `map`, 4 to 7.5 tiles apart, both with room for a body, both in the zone and in one walkable
 * piece (so the two can reach each other). Deterministic in (map seed, zone, salt). The start of a pair is a tile centre. A zone that
 * cannot seat `count` pairs in the tries it gets returns fewer.
 */
export function zonePairs(map: GameMap, zone: FactionId, count: number, salt = 0, kind: PairKind = "any"): ZonePair[] {
  const code = REGION_IDS.indexOf(zone);
  const comp = moveComponents(map);
  const rng = mulberry32((map.seed ^ (FACTION_IDS.indexOf(zone) + 1) * 0x9e3779b1 ^ salt * 0x85ebca6b) >>> 0);
  const out: ZonePair[] = [];
  const centre = (t: number): number => (t + 0.5) * TILE;
  for (let tries = 0; tries < PAIR_TRIES_EACH * count && out.length < count; tries++) {
    const tx = Math.floor(rng() * map.w), ty = Math.floor(rng() * map.h);
    const i = ty * map.w + tx;
    if (map.regionGrid[i] !== code || map.tiles[i] !== 0) continue;
    const a = { x: centre(tx), y: centre(ty) };
    if (!circleClear(map, a, PLAYER_RADIUS)) continue;
    const tiles = PAIR_MIN_TILES + rng() * (PAIR_MAX_TILES - PAIR_MIN_TILES);
    const angle = rng() * Math.PI * 2;
    // The second start is the tile nearest the point `tiles` away, so the pair is a whole-tile pair.
    const bx = worldToTile(a.x + Math.cos(angle) * tiles * TILE), by = worldToTile(a.y + Math.sin(angle) * tiles * TILE);
    if (bx < 0 || by < 0 || bx >= map.w || by >= map.h) continue;
    const j = by * map.w + bx;
    if (map.regionGrid[j] !== code || map.tiles[j] !== 0 || comp[i] !== comp[j]) continue;
    const b = { x: centre(bx), y: centre(by) };
    if (!circleClear(map, b, PLAYER_RADIUS)) continue;
    const d = Math.hypot(b.x - a.x, b.y - a.y) / TILE;
    if (d < PAIR_MIN_TILES || d > PAIR_MAX_TILES) continue;
    const obstructed = !segmentClear(map, a, b, PLAYER_RADIUS);
    if ((kind === "obstructed" && !obstructed) || (kind === "clear" && obstructed)) continue;
    if (kind === "fenced") {
      const hit = raycast(map, a.x, a.y, b.x, b.y, TILE_LOW);
      if (!hit.hit || map.terrain[worldToTile(hit.y) * map.w + worldToTile(hit.x)] !== TERRAIN_FENCE) continue;
    }
    out.push({ a, b, tiles: d, angle: Math.atan2(b.y - a.y, b.x - a.x), obstructed });
  }
  return out;
}

export interface MapDuelRecord {
  zone: FactionId;
  seed: number;
  edge: readonly [FactionId, FactionId];
  pair: number;
  /** Tiles between the two starts, and whether a body can walk the straight line between them (ZonePair.obstructed). */
  tiles: number;
  obstructed: boolean;
  /** The designed winner is fighter 0 of both duels: in the zone at the pair's tiles, and in the open control at the same distance and tilt. */
  inZone: DuelResult;
  open: DuelResult;
}

export interface MapRunOptions {
  seeds: readonly number[];
  pairsPerZone: number;
  /** Which pairs to draw (default any). */
  pairKind?: PairKind;
  zones?: readonly FactionId[];
  edges?: ReadonlyArray<readonly [FactionId, FactionId]>;
  capSeconds?: number;
  log?: (line: string) => void;
  /** Called with each map before its duels (the generator's output); lets a test hand in a hand-built map. */
  mapOf?: (seed: number) => GameMap;
}

/** The duel of one designed edge on its signature weapons: the designed winner is fighter 0. */
function edgeSpec(edge: readonly [FactionId, FactionId], starts: readonly [Vec2, Vec2], seed: number, cap: number): DuelSpec {
  return {
    faction: edge[0], factions: [edge[0], edge[1]], weapons: [SIGNATURE_WEAPONS[edge[0]], SIGNATURE_WEAPONS[edge[1]]],
    signatures: true, locks: [true, true], perception: "client", distance: 0, starts, capSeconds: cap, seed,
  };
}

export function runMapDuels(opts: MapRunOptions): MapDuelRecord[] {
  const cap = opts.capSeconds ?? ZONE_CAP_SECONDS;
  const zones = opts.zones ?? FACTION_IDS;
  const edges = opts.edges ?? BEATS;
  const out: MapDuelRecord[] = [];
  for (const seed of opts.seeds) {
    const map = opts.mapOf ? opts.mapOf(seed) : generateMap(seed);
    for (const zone of zones) {
      const pairs = zonePairs(map, zone, opts.pairsPerZone, 0, opts.pairKind ?? "any");
      opts.log?.(`seed ${seed} ${zone}: ${pairs.length} pairs x ${edges.length} edges`);
      pairs.forEach((p, pi) => {
        edges.forEach((edge, ei) => {
          // The designed winner stands at the pair's first tile on even pairs and at the second on odd ones, so neither end is favoured.
          const flip = (pi + ei) % 2 === 1;
          const zoneStarts: [Vec2, Vec2] = flip ? [p.b, p.a] : [p.a, p.b];
          const open = startPoints(p.tiles * TILE, flip ? p.angle + Math.PI : p.angle);
          const s = seed * 1009 + pi * 31 + ei;
          out.push({
            zone, seed, edge, pair: pi, tiles: p.tiles, obstructed: p.obstructed,
            inZone: runDuel({ ...edgeSpec(edge, zoneStarts, s, cap), map }),
            open: runDuel({ ...edgeSpec(edge, open, s, cap), arena: "open" }),
          });
        });
      });
    }
  }
  return out;
}

export interface MapCell { n: number; wins: number; caps: number; noWinner: number; margin: number | null }
const cellOf = (rs: readonly DuelResult[]): MapCell => ({
  n: rs.length, wins: rs.filter((r) => r.winner === 0).length, caps: rs.filter((r) => r.end === "cap").length,
  noWinner: rs.filter((r) => r.winner === null).length, margin: mean(rs.map((r) => r.hpFrac[0] - r.hpFrac[1])),
});
const rate = (c: MapCell): number => (c.n ? c.wins / c.n : 0);

export interface MapReport {
  records: MapDuelRecord[];
  /** The designed winner's win rate in the zone and in the control, pooled over every edge: by zone (every pair), and over the obstructed pairs alone. */
  byZone: Map<FactionId, { zone: MapCell; open: MapCell; obstructed: { zone: MapCell; open: MapCell } }>;
  text: string[];
}

export function mapReport(opts: MapRunOptions): MapReport {
  const records = runMapDuels(opts);
  const zones = opts.zones ?? FACTION_IDS;
  const edges = opts.edges ?? BEATS;
  const byZone: MapReport["byZone"] = new Map();
  const text: string[] = [];
  const nMaps = opts.seeds.length;
  const kind = opts.pairKind ?? "any";
  text.push(`REAL ZONES  ${nMaps} generated map${nMaps === 1 ? "" : "s"} (seeds ${opts.seeds[0]}..${opts.seeds[nMaps - 1]}), up to ${opts.pairsPerZone} ${kind === "any" ? "" : `${kind} `}pairs of floor tiles ${PAIR_MIN_TILES}-${PAIR_MAX_TILES} tiles apart per zone and map, every designed edge on its signature weapons`);
  text.push("signatures on, both lock the other, perception client, mobs off; the designed winner stands at either end of the pair in turn. open = the same pairs (distance and tilt) on the bare 40x40 floor");
  text.push("margin = the designed winner's hp share minus the loser's at the end, mean over all duels; obstructed = a body cannot walk the straight line between the pair (a wall, fence, lava or crevasse on or beside it)");
  text.push("");
  const head = `  ${"zone".padEnd(10)}${"in the zone".padEnd(28)}${"open control".padEnd(28)}${"delta".padStart(6)}${"margin zone/open".padStart(19)}   caps`;
  const add = (a: MapCell, b: MapCell): MapCell => ({ n: a.n + b.n, wins: a.wins + b.wins, caps: a.caps + b.caps, noWinner: a.noWinner + b.noWinner, margin: null });
  const empty = (): MapCell => ({ n: 0, wins: 0, caps: 0, noWinner: 0, margin: null });
  const show = (c: MapCell): string => {
    const [lo, hi] = wilson(c.wins, c.n);
    return `${pct(rate(c))} (${c.wins}/${c.n}, ${pct(lo)}-${pct(hi)})`.padEnd(28);
  };
  const marginText = (z: MapCell, o: MapCell): string => `${num(z.margin === null ? null : z.margin * 100, 0, "%")}/${num(o.margin === null ? null : o.margin * 100, 0, "%")}`.padStart(19);
  const block = (title: string, pick: (r: MapDuelRecord) => boolean): void => {
    text.push(`  ${title}`);
    text.push(head);
    let allZ = empty(), allO = empty();
    const rsAll = records.filter(pick);
    for (const zone of zones) {
      const rs = rsAll.filter((r) => r.zone === zone);
      const z = cellOf(rs.map((r) => r.inZone)), o = cellOf(rs.map((r) => r.open));
      allZ = add(allZ, z); allO = add(allO, o);
      text.push(`  ${zone.padEnd(10)}${show(z)}${show(o)}${`${((rate(z) - rate(o)) * 100).toFixed(0)}%`.padStart(6)}${marginText(z, o)}   ${z.caps}/${o.caps}`);
    }
    const z = cellOf(rsAll.map((r) => r.inZone)), o = cellOf(rsAll.map((r) => r.open));
    text.push(`  ${"all".padEnd(10)}${show(z)}${show(o)}${`${((rate(z) - rate(o)) * 100).toFixed(0)}%`.padStart(6)}${marginText(z, o)}   ${z.caps}/${o.caps}`);
    text.push("");
  };
  for (const zone of zones) {
    const rs = records.filter((r) => r.zone === zone);
    const ob = rs.filter((r) => r.obstructed);
    byZone.set(zone, {
      zone: cellOf(rs.map((r) => r.inZone)), open: cellOf(rs.map((r) => r.open)),
      obstructed: { zone: cellOf(ob.map((r) => r.inZone)), open: cellOf(ob.map((r) => r.open)) },
    });
  }
  const pairs = new Set(records.map((r) => `${r.seed}/${r.zone}/${r.pair}`)).size;
  const obstructedPairs = new Set(records.filter((r) => r.obstructed).map((r) => `${r.seed}/${r.zone}/${r.pair}`)).size;
  text.push(`  ${pairs} pairs drawn, ${obstructedPairs} of them obstructed (${pct(pairs ? obstructedPairs / pairs : 0)}), ${records.length} duels in the zones and as many in the control`);
  text.push("");
  block("EVERY PAIR", () => true);
  block("OBSTRUCTED PAIRS ONLY", (r) => r.obstructed);
  // Melee against ranged: how long the melee fighter needs for its first hit and what the shooter lands before that, in the zone and in the control.
  const meleeRanged = records.filter((r) => isRanged(SIGNATURE_WEAPONS[r.edge[0]]) !== isRanged(SIGNATURE_WEAPONS[r.edge[1]]));
  if (meleeRanged.length > 0) {
    const stats = (r: DuelResult, meleeIdx: 0 | 1): { contact: number | null; free: number } => {
      const first = r.hitLog.find((h) => h.by === meleeIdx && h.weapon !== null);
      const shooterIdx = meleeIdx === 0 ? 1 : 0;
      const free = r.hitLog.filter((h) => h.by === shooterIdx && (first === undefined || h.t <= first.t)).reduce((a, h) => a + h.amount, 0);
      return { contact: first?.t ?? null, free };
    };
    text.push("  MELEE AGAINST RANGED (the designed pairs where exactly one side shoots): seconds until the melee fighter's first hit, and the shooter's damage before it as a share of the melee fighter's hp");
    text.push(`  ${"zone".padEnd(10)}${"duels".padStart(6)}${"contact zone/open".padStart(20)}${"shooter free dmg zone/open".padStart(30)}${"melee side wins zone/open".padStart(28)}`);
    const rowsFor = (label: string, rs: MapDuelRecord[]): void => {
      const meleeIdxOf = (r: MapDuelRecord): 0 | 1 => (isRanged(SIGNATURE_WEAPONS[r.edge[0]]) ? 1 : 0);
      const get = (pick: (r: MapDuelRecord) => DuelResult): { c: number | null; f: number | null; w: number } => {
        const cs: number[] = [], fs: number[] = [];
        let wins = 0;
        for (const r of rs) {
          const mi = meleeIdxOf(r), res = pick(r), st = stats(res, mi);
          if (st.contact !== null) cs.push(st.contact);
          fs.push(st.free / FACTIONS[r.edge[mi]].hp);
          if (res.winner === mi) wins++;
        }
        return { c: mean(cs), f: mean(fs), w: rs.length ? wins / rs.length : 0 };
      };
      const z = get((r) => r.inZone), o = get((r) => r.open);
      text.push(`  ${label.padEnd(10)}${String(rs.length).padStart(6)}${`${num(z.c, 2, "s")}/${num(o.c, 2, "s")}`.padStart(20)}${`${pct(z.f ?? 0)}/${pct(o.f ?? 0)}`.padStart(30)}${`${pct(z.w)}/${pct(o.w)}`.padStart(28)}`);
    };
    for (const zone of zones) rowsFor(zone, meleeRanged.filter((r) => r.zone === zone));
    rowsFor("all", meleeRanged);
    text.push("");
  }
  text.push("  designed winner's win rate by edge, every pair: in the zone / open control");
  text.push(`  ${"edge".padEnd(20)}${zones.map((z) => z.padStart(13)).join("")}${"all zones".padStart(13)}`);
  const worst: Array<{ label: string; delta: number; n: number }> = [];
  for (const edge of edges) {
    const cells = zones.map((zone) => {
      const rs = records.filter((r) => r.zone === zone && r.edge[0] === edge[0] && r.edge[1] === edge[1]);
      const z = cellOf(rs.map((r) => r.inZone)), o = cellOf(rs.map((r) => r.open));
      if (rs.length >= 4) worst.push({ label: `${edge[0]} > ${edge[1]} in ${zone}`, delta: rate(z) - rate(o), n: rs.length });
      return { z, o, n: rs.length };
    });
    const rs = records.filter((r) => r.edge[0] === edge[0] && r.edge[1] === edge[1]);
    const z = cellOf(rs.map((r) => r.inZone)), o = cellOf(rs.map((r) => r.open));
    text.push(`  ${`${edge[0]} > ${edge[1]}`.padEnd(20)}${cells.map((c) => (c.n ? `${pct(rate(c.z))}/${pct(rate(c.o))}` : "-").padStart(13)).join("")}${`${pct(rate(z))}/${pct(rate(o))}`.padStart(13)}`);
  }
  worst.sort((a, b) => a.delta - b.delta);
  text.push("");
  const drops = worst.filter((w) => w.delta < 0).slice(0, 5);
  text.push(`  largest drops against the open control (cells of 4+ duels): ${drops.length ? drops.map((w) => `${w.label} ${(w.delta * 100).toFixed(0)}% (n ${w.n})`).join("; ") : "none"}`);
  const drift = records.filter((r) => r.inZone.winner !== r.open.winner).length;
  text.push(`  duels whose winner changed between the zone and the control: ${drift} of ${records.length}`);
  return { records, byZone, text };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------------------------------------

const USAGE = [
  "usage: npm run harness:zones -w @raid/server [-- options]",
  "  --source s            rows (default: the Rows condition), map (real zones of generated maps) or both",
  "  --variants            rows: also run rows10, rows4w and rows6 when the design holds (they always run when it fails)",
  "  --rows-setups s       full (96, default) or quick (48)",
  "  --rows-seeds N        rows: duels per setup (default 1; N seeds change the shuffled order the sim breaks ties in)",
  "  --seeds N[,M..] | a-b map: the map seeds, N meaning 1..N (default 4)",
  "  --pairs P             map: pairs of floor tiles per zone and map (default 2)",
  "  --pair-kind k         map: any (default), obstructed (a body cannot walk the straight line between the pair), clear, or fenced (a fence on the line)",
  "  --shooter s           rows: lock (default, the contract's condition) or stand, strafe, kite, orbwalk: a STRESS where Sentenced plays that style",
  "  --zone a,b            map: only these zones (fire, sentenced, plague, frost, holy)",
  "  --edge w>l,..         map: only these designed faction edges",
  "  --cap seconds         one time cap for every duel (default 150)",
  "  --quiet               no progress lines",
].join("\n");

class UsageError extends Error {}

export interface ZoneCli {
  source: "rows" | "map" | "both";
  variants: boolean;
  rowsSetups: "full" | "quick";
  rowsSeeds: number;
  seeds: number[];
  pairs: number;
  pairKind: PairKind;
  shooter: Style | undefined;
  zones: FactionId[] | undefined;
  edges: Array<readonly [FactionId, FactionId]> | undefined;
  cap: number | undefined;
  quiet: boolean;
  help: boolean;
}

export function parseZoneArgs(argv: readonly string[]): ZoneCli {
  const cli: ZoneCli = { source: "rows", variants: false, rowsSetups: "full", rowsSeeds: 1, seeds: [1, 2, 3, 4], pairs: 2, pairKind: "any", shooter: undefined, zones: undefined, edges: undefined, cap: undefined, quiet: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    const inline = eq > 0 ? arg.slice(eq + 1) : undefined;
    const value = (): string => {
      const v = inline ?? argv[++i];
      if (v === undefined || v === "" || v.startsWith("--")) throw new UsageError(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case "--source": {
        const v = value();
        if (v !== "rows" && v !== "map" && v !== "both") throw new UsageError(`--source takes rows, map or both, not "${v}"`);
        cli.source = v;
        break;
      }
      case "--variants": cli.variants = true; break;
      case "--rows-setups": {
        const v = value();
        if (v !== "full" && v !== "quick") throw new UsageError(`--rows-setups takes full or quick, not "${v}"`);
        cli.rowsSetups = v;
        break;
      }
      case "--rows-seeds": {
        const n = Number(value());
        if (!Number.isInteger(n) || n < 1 || n > 50) throw new UsageError("--rows-seeds takes 1..50");
        cli.rowsSeeds = n;
        break;
      }
      case "--seeds": {
        const v = value();
        const range = /^(\d+)-(\d+)$/.exec(v);
        let seeds: number[];
        if (range) {
          const lo = Number(range[1]), hi = Number(range[2]);
          if (hi < lo || hi - lo > 999) throw new UsageError(`--seeds ${v} is not a range of at most 1000 seeds`);
          seeds = Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
        } else if (/^\d+$/.test(v)) {
          const n = Number(v);
          if (n < 1 || n > 1000) throw new UsageError("--seeds N takes 1..1000");
          seeds = Array.from({ length: n }, (_, k) => k + 1);
        } else {
          seeds = v.split(",").map(Number);
          if (seeds.some((s) => !Number.isInteger(s) || s < 0)) throw new UsageError(`--seeds "${v}" is not N, a-b or a list of seeds`);
        }
        cli.seeds = seeds;
        break;
      }
      case "--pairs": {
        const n = Number(value());
        if (!Number.isInteger(n) || n < 1 || n > 64) throw new UsageError("--pairs takes 1..64");
        cli.pairs = n;
        break;
      }
      case "--pair-kind": {
        const v = value();
        if (v !== "any" && v !== "obstructed" && v !== "clear" && v !== "fenced") throw new UsageError(`--pair-kind takes any, obstructed, clear or fenced, not "${v}"`);
        cli.pairKind = v;
        break;
      }
      case "--shooter": {
        const v = value();
        if (!["lock", "stand", "strafe", "kite", "orbwalk"].includes(v)) throw new UsageError(`--shooter takes lock, stand, strafe, kite or orbwalk, not "${v}"`);
        cli.shooter = v === "lock" ? undefined : (v as Style);
        break;
      }
      case "--zone": {
        const ids = value().split(",");
        const bad = ids.find((f) => !(FACTION_IDS as readonly string[]).includes(f));
        if (bad) throw new UsageError(`unknown zone "${bad}"`);
        cli.zones = ids as FactionId[];
        break;
      }
      case "--edge": {
        const edges: Array<readonly [FactionId, FactionId]> = [];
        for (const spec of value().split(",")) {
          const [w, l] = spec.split(">");
          const edge = BEATS.find(([a, b]) => a === w && b === l);
          if (!edge) throw new UsageError(`"${spec}" is not a designed faction edge (winner>loser)`);
          edges.push(edge);
        }
        cli.edges = edges;
        break;
      }
      case "--cap": {
        const n = Number(value());
        if (!(n > 0)) throw new UsageError("--cap needs a positive number of seconds");
        cli.cap = n;
        break;
      }
      case "--quiet": cli.quiet = true; break;
      case "--help": case "-h": cli.help = true; break;
      default: throw new UsageError(`unknown option ${arg}`);
    }
  }
  return cli;
}

export function runZoneCli(argv: readonly string[]): string {
  const cli = parseZoneArgs(argv);
  if (cli.help) return USAGE;
  const log = cli.quiet ? undefined : (line: string) => console.error(`[zones] ${line}`);
  const t0 = Date.now();
  const lines: string[] = ["ZONE DUEL HARNESS (the real sim at 20 Hz, duel pace k = 2; fenced and real terrain)", "Report-only: no outcome is asserted and no number is changed.", ""];
  if (cli.source === "rows" || cli.source === "both") {
    lines.push(...rowsReport({ setups: cli.rowsSetups, variants: cli.variants, capSeconds: cli.cap, shooter: cli.shooter, seedsPerSetup: cli.rowsSeeds, log }).text, "");
  }
  if (cli.source === "map" || cli.source === "both") {
    lines.push(...mapReport({ seeds: cli.seeds, pairsPerZone: cli.pairs, pairKind: cli.pairKind, zones: cli.zones, edges: cli.edges, capSeconds: cli.cap, log }).text, "");
  }
  lines.push(`${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return lines.join("\n");
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  try {
    console.log(runZoneCli(process.argv.slice(2)));
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`${err.message}\n${USAGE}`);
      process.exit(2);
    }
    throw err;
  }
}
