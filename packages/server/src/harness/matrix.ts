// The weapon matrix: every designed weapon edge (WEAPON_BEATS) x every faction as a mirror (both fighters the same
// faction, so only the weapon differs) x a handful of starting setups, one headless duel each (duel.ts). The report
// is information for the owner: nothing here asserts an outcome or changes a number.
import {
  FACTION_IDS, isRanged, POLICIES, WEAPON_BEATS, WEAPONS, type FactionId, type SpacingPolicy, type WeaponId,
} from "@raid/shared";
import { runDuel, type Arena, type DuelResult, type Perception } from "./duel";

export type Edge = readonly [winner: WeaponId, loser: WeaponId];

/** One starting setup. The designed winner is fighter 0. */
export interface Setup {
  distance: number;
  /** Ticks the winner / the loser waits before it starts acting. */
  delayTicks: readonly [number, number];
  /** Direction from the winner to the loser (radians): which wall each backs into differs with it. */
  angle: number;
}

/**
 * How a weapon is played. "stand" is the shared policy (POLICIES): ranged fighters stand and shoot at a good range. "strafe"
 * sidesteps while standing (changing side every 0.8 s); "kite" keeps a longer distance and backs off sooner. Melee
 * weapons have only "stand". "post" is not in the grids: a shooter that never moves, the standing shooter the design's
 * kiting check assumes (kiting.ts).
 */
export type Style = "stand" | "strafe" | "kite" | "post";

export function stylesOf(w: WeaponId): readonly Style[] {
  return isRanged(w) ? ["stand", "strafe", "kite"] : ["stand"];
}

/** The spacing for `w` played in `style`; undefined for the shared default. */
export function spacingFor(w: WeaponId, style: Style): SpacingPolicy | undefined {
  const base = POLICIES[w];
  if (style === "stand" || !isRanged(w)) return undefined;
  if (style === "post") return { ...base, far: Infinity, retreatBelow: 0 };
  if (style === "strafe") return { ...base, strafe: 0.8 };
  // Shares of the weapon's range (the bow keeps a little past its range to approach, the wand a third of it back).
  const range = WEAPONS[w].shape.kind === "projectile" ? WEAPONS[w].shape.range : 0;
  return w === "bow"
    ? { ...base, far: range * (500 / 480), retreatBelow: range * (400 / 480) }
    : { ...base, far: range * (330 / 420), retreatBelow: range * (280 / 420) };
}

export interface MatrixOptions {
  /** How the designed winner and loser play their weapon (default: both "stand"). */
  styles?: readonly [Style, Style];
  edges?: readonly Edge[];
  factions?: readonly FactionId[];
  setups?: readonly Setup[];
  arena?: Arena;
  perception?: Perception;
  /** A cap for every duel, or one per faction (their mirror fights last very different times). */
  capSeconds?: number | Readonly<Record<FactionId, number>>;
}

export interface Cell {
  edge: Edge;
  faction: FactionId;
  results: DuelResult[];
}

export interface CellStats {
  n: number;
  /** The designed winner stood last / the designed loser did / both fell together / neither fell by the cap. */
  wins: number;
  losses: number;
  draws: number;
  caps: number;
  /** At the cap, how many had the designed winner ahead on hp. */
  capAhead: number;
  winRate: number;
  /** Median seconds of the duels somebody finished, or null when none was. */
  medianSeconds: number | null;
  /** Hp share the designed winner had left, over the duels it won. */
  hpMean: number | null;
  hpWorst: number | null;
}

/**
 * The distances, start offsets and directions of the full report: 3 x 3 x 2 = 18 setups. An offset of 7 ticks (0.35 s)
 * makes one fighter start later, which shifts the two cadences against each other. The directions are a few degrees off
 * an arena axis and a few degrees off the diagonal, so no alignment is exact.
 */
export function fullSetups(): Setup[] {
  const out: Setup[] = [];
  const delays: Array<[number, number]> = [[0, 0], [0, 7], [7, 0]];
  for (const distance of [120, 300, 450]) {
    for (const delayTicks of delays) for (const angle of [0.1, 0.8]) out.push({ distance, delayTicks, angle });
  }
  return out;
}

/** One setup per distance, no offsets: the quick report. */
export function quickSetups(): Setup[] {
  return [120, 300, 450].map((distance) => ({ distance, delayTicks: [0, 0] as const, angle: 0.1 }));
}

/**
 * A cap per faction long enough that a duel finishes even when only about a third of one side's shots land (a ranged
 * fighter against a strafing one): roughly four times the mirror duel (Frost and Sentenced hit slowly or lightly).
 */
export const DEFAULT_CAPS: Readonly<Record<FactionId, number>> = { fire: 90, sentenced: 600, plague: 150, frost: 240, holy: 120 };

function capFor(cap: MatrixOptions["capSeconds"], faction: FactionId): number {
  if (typeof cap === "number") return cap;
  return (cap ?? DEFAULT_CAPS)[faction];
}

/** A stable seed per cell and setup, so a report repeats exactly. */
function seedOf(edgeIndex: number, factionIndex: number, setupIndex: number): number {
  return 1 + edgeIndex * 10_007 + factionIndex * 101 + setupIndex * 7;
}

export function duelOf(
  edge: Edge, faction: FactionId, setup: Setup,
  opts: { arena?: Arena; perception?: Perception; cap: number; seed: number; styles?: readonly [Style, Style] },
): DuelResult {
  return runDuel({
    faction,
    weapons: [edge[0], edge[1]],
    distance: setup.distance,
    angle: setup.angle,
    delayTicks: setup.delayTicks,
    arena: opts.arena ?? "open",
    perception: opts.perception ?? "client",
    capSeconds: opts.cap,
    seed: opts.seed,
    spacing: opts.styles ? [spacingFor(edge[0], opts.styles[0]), spacingFor(edge[1], opts.styles[1])] : undefined,
  });
}

export function runMatrix(opts: MatrixOptions = {}, onCell?: (cell: Cell) => void): Cell[] {
  const edges = opts.edges ?? WEAPON_BEATS;
  const factions = opts.factions ?? FACTION_IDS;
  const setups = opts.setups ?? fullSetups();
  const cells: Cell[] = [];
  edges.forEach((edge, ei) => {
    factions.forEach((faction, fi) => {
      const results = setups.map((setup, si) => duelOf(edge, faction, setup, {
        arena: opts.arena, perception: opts.perception, cap: capFor(opts.capSeconds, faction), seed: seedOf(ei, fi, si),
        styles: opts.styles,
      }));
      const cell: Cell = { edge, faction, results };
      cells.push(cell);
      onCell?.(cell);
    });
  });
  return cells;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function statsOf(results: readonly DuelResult[]): CellStats {
  const wins = results.filter((r) => r.winner === 0);
  const losses = results.filter((r) => r.winner === 1);
  const draws = results.filter((r) => r.end === "draw");
  const caps = results.filter((r) => r.end === "cap");
  const hp = wins.map((r) => r.hpFrac[0]);
  return {
    n: results.length,
    wins: wins.length,
    losses: losses.length,
    draws: draws.length,
    caps: caps.length,
    capAhead: caps.filter((r) => r.lead === 0).length,
    winRate: results.length ? wins.length / results.length : 0,
    medianSeconds: median(results.filter((r) => r.end !== "cap").map((r) => r.seconds)),
    hpMean: hp.length ? hp.reduce((a, b) => a + b, 0) / hp.length : null,
    hpWorst: hp.length ? Math.min(...hp) : null,
  };
}

export const edgeName = (e: Edge): string => `${e[0]} > ${e[1]}`;

/** The edges the owner asked to watch first, and why. */
export const WATCH: ReadonlyArray<{ edge: Edge; why: string }> = [
  { edge: ["wand", "bow"], why: "balls delete arrows" },
  { edge: ["sword", "wand"], why: "melee closes on a kiting wand" },
  { edge: ["axe", "wand"], why: "melee closes on a kiting wand" },
];
export const isWatched = (e: Edge): boolean => WATCH.some((w) => w.edge[0] === e[0] && w.edge[1] === e[1]);

export function cellsOf(cells: readonly Cell[], edge: Edge, faction?: FactionId): Cell[] {
  return cells.filter((c) => c.edge[0] === edge[0] && c.edge[1] === edge[1] && (faction === undefined || c.faction === faction));
}

export function pooled(cells: readonly Cell[]): DuelResult[] {
  return cells.flatMap((c) => c.results);
}

// ----------------------------------------------------------------------------------------------------- formatting

const pct = (x: number): string => `${Math.round(x * 100)}`;
const secs = (x: number | null): string => (x === null ? "-" : x.toFixed(1));

function table(head: string[], rows: string[][], firstWidth: number, width: number): string[] {
  const out = [head.map((h, i) => (i === 0 ? h.padEnd(firstWidth) : h.padStart(width))).join("")];
  for (const r of rows) out.push(r.map((c, i) => (i === 0 ? c.padEnd(firstWidth) : c.padStart(width))).join(""));
  return out;
}

export interface MatrixView {
  cells: readonly Cell[];
  edges: readonly Edge[];
  factions: readonly FactionId[];
}

/** Rows: edges. Columns: factions and all together. Cell: designed winner's win % / median seconds. */
export function formatMatrix(v: MatrixView): string {
  const rows = v.edges.map((edge) => {
    const row = [edgeName(edge)];
    for (const f of v.factions) {
      const s = statsOf(pooled(cellsOf(v.cells, edge, f)));
      row.push(`${pct(s.winRate)}%/${secs(s.medianSeconds)}s${s.caps ? "*" : ""}`);
    }
    const all = statsOf(pooled(cellsOf(v.cells, edge)));
    row.push(`${pct(all.winRate)}%/${secs(all.medianSeconds)}s${all.caps ? "*" : ""}`);
    row.push(isWatched(edge) ? "<- watch" : "");
    return row;
  });
  return table(["edge", ...v.factions.map(String), "all", ""], rows, 16, 14).join("\n");
}

/** Hp the designed winner had left when it won: mean / worst, in % of max hp. */
export function formatHp(v: MatrixView): string {
  const rows = v.edges.map((edge) => {
    const row = [edgeName(edge)];
    const one = (s: CellStats): string => (s.hpMean === null ? "-" : `${pct(s.hpMean)}/${pct(s.hpWorst!)}`);
    for (const f of v.factions) row.push(one(statsOf(pooled(cellsOf(v.cells, edge, f)))));
    row.push(one(statsOf(pooled(cellsOf(v.cells, edge)))));
    return row;
  });
  return table(["edge", ...v.factions.map(String), "all"], rows, 16, 14).join("\n");
}

/** Per edge over every faction and setup: how the duels ended. */
export function formatEnds(v: MatrixView): string {
  const rows = v.edges.map((edge) => {
    const s = statsOf(pooled(cellsOf(v.cells, edge)));
    return [
      edgeName(edge), pct(s.winRate), pct(s.n ? s.losses / s.n : 0), pct(s.n ? s.draws / s.n : 0), pct(s.n ? s.caps / s.n : 0),
      s.caps ? `${s.capAhead}/${s.caps}` : "-", secs(s.medianSeconds), s.hpMean === null ? "-" : pct(s.hpMean), s.hpWorst === null ? "-" : pct(s.hpWorst),
    ];
  });
  return table(["edge", "win%", "lose%", "draw%", "timeout%", "ahead@cap", "median s", "win hp% avg", "win hp% worst"], rows, 16, 14).join("\n");
}
