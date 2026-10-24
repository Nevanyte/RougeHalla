// The harness report: the weapon matrix, how each duel ended, the two edges to watch, how much a weaker view of the
// world or a cluttered arena moves the results, and the parity block. Report-only: nothing here asserts an outcome.
import {
  FACTION_IDS, FACTIONS, POLICIES, TICK_RATE, TILE, WEAPON_BEATS, type FactionId, type WeaponId,
} from "@raid/shared";
import type { Arena, DuelResult, Perception } from "./duel";
import {
  cellsOf, DEFAULT_CAPS, edgeName, fullSetups, formatEnds, formatHp, formatMatrix, isWatched, pooled, quickSetups,
  runMatrix, statsOf, stylesOf, WATCH, type Cell, type Edge, type MatrixOptions, type Setup, type Style,
} from "./matrix";
import { kitingReport } from "./kiting";
import { formatParity, parityReport, type ParityReport } from "./parity";

export interface ReportOptions {
  /** Three setups instead of eighteen, and no style grids, sensitivity or cluttered-arena passes. */
  quick?: boolean;
  /** The full matrix, the style grids, the edge verdicts and the kiting table, without the client-view and cluttered-arena passes (tuning runs). */
  core?: boolean;
  /** Exactly these setups (a test's reduced matrix). */
  setups?: readonly Setup[];
  edges?: readonly Edge[];
  factions?: readonly FactionId[];
  /** One cap for every faction instead of DEFAULT_CAPS. */
  capSeconds?: number;
  perception?: Perception;
  /**
   * The arena of the main pass. Left out (or "both"), the main pass is the open arena and the full report adds a second pass
   * on an arena with pillars to compare it with.
   */
  arena?: Arena | "both";
  /** Progress lines while it runs. */
  log?: (line: string) => void;
}

export interface HarnessReport {
  edges: readonly Edge[];
  factions: readonly FactionId[];
  /** The main pass: every edge x faction x setup in the open arena. */
  cells: Cell[];
  /** Whether each designed edge holds (see verdictOf). */
  verdicts: EdgeVerdict[];
  parity: ParityReport;
  text: string;
}

const ARENA_UNITS = 40 * TILE;
const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;
const pct = (x: number): string => `${Math.round(x * 100)}%`;
const secs = (x: number | null): string => (x === null ? "-" : `${x.toFixed(1)}s`);
const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function winRateBy<K>(results: readonly DuelResult[], key: (r: DuelResult) => K): Array<[K, number, number]> {
  const groups = new Map<K, DuelResult[]>();
  for (const r of results) {
    const k = key(r);
    const g = groups.get(k);
    if (g) g.push(r); else groups.set(k, [r]);
  }
  return [...groups].sort((a, b) => (a[0] as number) - (b[0] as number)).map(([k, rs]) => [k, statsOf(rs).winRate, rs.length]);
}

function sum(rs: readonly DuelResult[], f: (r: DuelResult) => number): number {
  return rs.reduce((a, r) => a + f(r), 0);
}

/** The first hit the designed winner (fighter 0) lands, in seconds into the duel, or null if it never did. */
function firstHit(r: DuelResult, by: 0 | 1): number | null {
  return r.hitLog.find((h) => h.by === by)?.t ?? null;
}

/** How a watched edge went: by start distance, and what the weapons did to each other. */
function watchLines(cells: readonly Cell[], edge: Edge, why: string): string[] {
  const rs = pooled(cellsOf(cells, edge));
  const [win, lose] = edge;
  const s = statsOf(rs);
  const lines: string[] = [];
  lines.push(`${edgeName(edge)} (${why}): designed winner wins ${pct(s.winRate)} of ${s.n}, loses ${pct(s.n ? s.losses / s.n : 0)}, ` +
    `timeouts ${pct(s.n ? s.caps / s.n : 0)}, median ${secs(s.medianSeconds)}`);
  lines.push(`  by start distance: ${winRateBy(rs, (r) => r.spec.distance).map(([d, w, n]) => `${d} u ${pct(w)} (n=${n})`).join("  ")}`);
  lines.push(`  by who waits at the start: ${winRateBy(rs, (r) => (r.spec.delayTicks?.[0] ? 0 : r.spec.delayTicks?.[1] ? 2 : 1))
    .map(([k, w, n]) => `${k === 0 ? "winner waits 0.35 s" : k === 2 ? "loser waits 0.35 s" : "both start together"} ${pct(w)} (n=${n})`).join("  ")}`);
  const proj = (k: string): number => sum(rs, (r) => r.counts.projectiles[k] ?? 0);
  if (win === "wand" && lose === "bow") {
    const arrows = sum(rs, (r) => r.counts.shots[1]);
    const balls = sum(rs, (r) => r.counts.shots[0]);
    lines.push(`  arrows loosed ${arrows}: ${pct(proj("arrow:deleted") / Math.max(1, arrows))} deleted by a ball, ${pct(proj("arrow:hit") / Math.max(1, arrows))} landed; ` +
      `balls loosed ${balls}: ${pct(proj("ball:hit") / Math.max(1, balls))} landed`);
  } else if (lose === "wand") {
    // The wand's kiting: how long the melee fighter takes to land a first hit, and what the wand got in before it.
    const free: number[] = [];
    const firstContact: number[] = [];
    for (const r of rs) {
      const t1 = firstHit(r, 0);
      if (t1 === null) continue;
      firstContact.push(t1);
      const hpMax = FACTIONS[r.spec.faction].hp;
      free.push(r.hitLog.filter((h) => h.by === 1 && h.t < t1).reduce((a, h) => a + h.amount, 0) / hpMax);
    }
    lines.push(`  first ${win} hit lands at a median ${secs(median(firstContact))}; the wand's balls before it cost the ${win} ` +
      `${pct(avg(free))} of its hp on average (${pct(Math.max(0, ...free))} worst)`);
    const balls = sum(rs, (r) => r.counts.shots[1]);
    lines.push(`  balls loosed ${balls}: ${pct(proj("ball:hit") / Math.max(1, balls))} landed` +
      (win === "axe" ? `, ${pct(proj("ball:destroyed") / Math.max(1, balls))} destroyed by a swing` : ""));
  }
  return lines;
}

/** What each side did in an edge's duels, per duel on average: attacks, hits, damage dealt, staggers taken, hits blocked. */
function tradeLines(cells: readonly Cell[], edge: Edge): string[] {
  const rs = pooled(cellsOf(cells, edge));
  const per = (f: (r: DuelResult) => number): number => sum(rs, f) / Math.max(1, rs.length);
  const side = (i: 0 | 1): string => {
    const w = edge[i];
    const started = w === "bow" ? per((r) => r.counts.shots[i]) : per((r) => r.counts.attacks[i]);
    return `${i === 0 ? "winner" : "loser"} ${w}: ${started.toFixed(1)} ${w === "bow" ? "shots" : "attacks"}, ` +
      `${per((r) => r.counts.hits[i]).toFixed(1)} hits for ${per((r) => r.counts.damage[i]).toFixed(0)} damage, ` +
      `staggered ${per((r) => r.counts.staggers[i]).toFixed(1)}x, blocked ${per((r) => r.counts.blocks[i]).toFixed(1)}x`;
  };
  return [`  per duel: ${side(0)}; ${side(1)}`];
}

/**
 * How much the result depends on how the weapons are played: the designed winner's win% for each way the winner and the
 * loser can play their weapon (stand, strafe, kite: matrix.ts Style), pooled over the setups, with the factions after it.
 */
interface StyleGrid {
  lines: string[];
  /** For each way the loser can play: the winner's best reply (the style, and its pooled win rate). */
  replies: Array<{ loser: Style; winner: Style; rate: number }>;
}

function styleGrid(edge: Edge, base: MatrixOptions, factions: readonly FactionId[]): StyleGrid {
  const winnerStyles = stylesOf(edge[0]);
  const loserStyles = stylesOf(edge[1]);
  const lines = [`  ${edgeName(edge)}: designed winner's win% (${factions.join("/")}); rows: how the ${edge[0]} plays, columns: how the ${edge[1]} plays`];
  lines.push(["".padEnd(18), ...loserStyles.map((l) => `${edge[1]} ${l}`.padStart(34))].join(""));
  const rate: number[][] = [];
  for (const ws of winnerStyles) {
    const row = [`  ${edge[0]} ${ws}`.padEnd(18)];
    const rates: number[] = [];
    for (const ls of loserStyles) {
      const cells = runMatrix({ ...base, edges: [edge], styles: [ws, ls] });
      const all = statsOf(pooled(cells));
      const per = factions.map((f) => Math.round(statsOf(pooled(cellsOf(cells, edge, f))).winRate * 100)).join("/");
      row.push(`${Math.round(all.winRate * 100)}% (${per})`.padStart(34));
      rates.push(all.winRate);
    }
    rate.push(rates);
    lines.push(row.join(""));
  }
  const replies = loserStyles.map((ls, j) => {
    const col = rate.map((r) => r[j]!);
    const best = col.indexOf(Math.max(...col));
    return { loser: ls, winner: winnerStyles[best]!, rate: col[best]! };
  });
  // The edge as a choice of play: the loser's best way to play against a winner that stands, and what the winner can do about it.
  if (loserStyles.length === 1 && winnerStyles.length > 1) {
    const col = rate.map((r) => r[0]!);
    const best = col.indexOf(Math.max(...col));
    lines.push(`  -> the ${edge[0]}'s best style against a ${edge[1]} (${winnerStyles[best]}) wins ${pct(col[best]!)}; standing it wins ${pct(col[0]!)}`);
  }
  if (loserStyles.length > 1) {
    const worst = rate[0]!.indexOf(Math.min(...rate[0]!));
    const reply = rate.map((r) => r[worst]!);
    const best = reply.indexOf(Math.max(...reply));
    lines.push(`  -> both standing: ${pct(rate[0]![0]!)}. Worst case for a standing ${edge[0]}: ${pct(rate[0]![worst]!)}, against a ${edge[1]} that plays "${loserStyles[worst]}";` +
      ` the ${edge[0]}'s best reply to that ("${winnerStyles[best]}") gets ${pct(reply[best]!)}`);
  }
  return { lines, replies };
}

/** An edge holds (GAME_DESIGN 9.4, "Tuning (9.1)") when the designed winner wins this much overall, in every faction, and with a reply to every style. */
export const HOLD_OVERALL = 0.6;
export const HOLD_FACTION = 0.5;
export const HOLD_REPLY = 0.5;

export interface EdgeVerdict {
  edge: Edge;
  overall: number;
  /** The weakest faction column of the main matrix, and which. */
  worstFaction: { faction: FactionId; rate: number };
  /** The style-grid replies (empty for an edge with no ranged weapon, or in a quick report). */
  replies: StyleGrid["replies"];
  mainHolds: boolean;
  gridHolds: boolean;
  holds: boolean;
}

/** Does each designed edge hold? Pure bookkeeping over the matrix and the grids: a threshold check, nothing is asserted. */
export function verdictOf(
  cells: readonly Cell[], edge: Edge, factions: readonly FactionId[], replies: StyleGrid["replies"],
): EdgeVerdict {
  const overall = statsOf(pooled(cellsOf(cells, edge))).winRate;
  const per = factions.map((f) => ({ faction: f, rate: statsOf(pooled(cellsOf(cells, edge, f))).winRate }));
  const worstFaction = per.reduce((a, b) => (b.rate < a.rate ? b : a));
  const mainHolds = overall >= HOLD_OVERALL && worstFaction.rate >= HOLD_FACTION;
  const gridHolds = replies.every((r) => r.rate >= HOLD_REPLY);
  return { edge, overall, worstFaction, replies, mainHolds, gridHolds, holds: mainHolds && gridHolds };
}

function formatVerdicts(verdicts: readonly EdgeVerdict[], quick: boolean): string[] {
  const lines = [`${"edge".padEnd(16)}${"overall".padStart(9)}  ${"weakest faction".padEnd(22)}${"best reply to each style of the loser".padEnd(52)}verdict`];
  for (const v of verdicts) {
    const replies = v.replies.length
      ? v.replies.map((r) => `${r.loser}: ${pct(r.rate)} (${r.winner})`).join("  ")
      : quick && stylesOf(v.edge[0]).length + stylesOf(v.edge[1]).length > 2 ? "(no grid in a quick report)" : "-";
    lines.push(
      `${edgeName(v.edge).padEnd(16)}${pct(v.overall).padStart(9)}  ${`${v.worstFaction.faction} ${pct(v.worstFaction.rate)}`.padEnd(22)}${replies.padEnd(52)}` +
      `${v.holds ? "HOLDS" : `FAILS${v.mainHolds ? "" : " (matrix)"}${v.gridHolds ? "" : " (styles)"}`}`,
    );
  }
  const held = verdicts.filter((v) => v.holds).length;
  lines.push(`${held} of ${verdicts.length} edges hold`);
  return lines;
}

/** Overall win % of each edge in a pass, for the sensitivity tables. */
function passTable(columns: Array<{ name: string; cells: readonly Cell[] }>, edges: readonly Edge[]): string[] {
  const lines: string[] = [];
  lines.push(["edge".padEnd(16), ...columns.map((c) => c.name.padStart(12))].join(""));
  for (const edge of edges) {
    const row = [edgeName(edge).padEnd(16)];
    for (const c of columns) row.push(pct(statsOf(pooled(cellsOf(c.cells, edge))).winRate).padStart(12));
    lines.push(row.join(""));
  }
  return lines;
}

export function buildReport(opts: ReportOptions = {}): HarnessReport {
  const t0 = performance.now();
  const log = opts.log ?? (() => {});
  const edges = opts.edges ?? WEAPON_BEATS;
  const factions = opts.factions ?? FACTION_IDS;
  const quick = opts.quick ?? false;
  const perception = opts.perception ?? "client";
  const capSeconds: MatrixOptions["capSeconds"] = opts.capSeconds ?? DEFAULT_CAPS;
  const setups: readonly Setup[] = opts.setups ?? (quick ? quickSetups() : fullSetups());
  const mainArena: Arena = opts.arena === "pillars" ? "pillars" : "open";
  const base: MatrixOptions = { edges, factions, setups, perception, capSeconds, arena: mainArena };
  // The extra passes use three setups (one per start distance); the sensitivity ones only run in the full report.
  const reduced = quickSetups();
  const view = (cells: readonly Cell[]) => ({ cells, edges, factions });
  const total = (cs: readonly Cell[]): number => cs.reduce((a, c) => a + c.results.length, 0);

  log(`main pass: ${edges.length} edges x ${factions.length} factions x ${setups.length} setups = ${edges.length * factions.length * setups.length} duels`);
  const cells = runMatrix(base);
  let duels = total(cells);
  const out: string[] = [];
  let section = 1;
  const heading = (text: string): string => `${section++}. ${text}`;

  out.push("WEAPON DUEL HARNESS (the real sim at 20 Hz, duel pace k = 2; two policy-driven clients; both fighters share a faction)");
  out.push(`arena: ${mainArena}, ${ARENA_UNITS} u square | perception: ${perception} | ${setups.length} setups per cell ` +
    `(start distances ${[...new Set(setups.map((s) => s.distance))].join("/")} u${setups.length > 3 ? ", start offsets 0 / 0.35 s for either fighter, two directions" : ""}) | ` +
    `time caps: ${typeof capSeconds === "number" ? `${capSeconds} s` : factions.map((f) => `${f} ${(capSeconds as Record<FactionId, number>)[f]} s`).join(", ")}`);
  out.push("Faction signatures (burn, backlash, mark, plague, chill, lifesteal) are Phase 10, so these duels are weapon hits only; a faction with");
  out.push("slow or light hits (Sentenced above all) fights for minutes. Report-only: no outcome is asserted and no number is changed.");
  out.push("");
  out.push(heading("MATRIX  the designed winner's win% / median seconds of the duels that finished   (* = some duels hit the time cap)"));
  out.push(formatMatrix(view(cells)));
  out.push("");
  out.push(heading("HP LEFT OF THE DESIGNED WINNER WHEN IT WON  mean% / worst%"));
  out.push(formatHp(view(cells)));
  out.push("");
  out.push(heading("HOW THE DUELS ENDED  (every faction and setup pooled)"));
  out.push(formatEnds(view(cells)));
  out.push("");

  out.push(heading("WATCH LIST  the two edges to watch first: Wand > Bow (balls delete arrows) and melee > wand (the wand kites)"));
  for (const w of WATCH) {
    if (!edges.some((e) => e[0] === w.edge[0] && e[1] === w.edge[1])) continue;
    out.push(...watchLines(cells, w.edge, w.why), ...tradeLines(cells, w.edge));
  }
  for (const e of edges) {
    const s = statsOf(pooled(cellsOf(cells, e)));
    if (isWatched(e) || s.winRate >= 0.75) continue;
    out.push(`${edgeName(e)} (not on the watch list, but the designed winner wins only ${pct(s.winRate)} of ${s.n}): by start distance ` +
      winRateBy(pooled(cellsOf(cells, e)), (r) => r.spec.distance).map(([d, w]) => `${d} u ${pct(w)}`).join(", "));
    out.push(...tradeLines(cells, e));
  }
  const ranked = edges.map((e) => ({ e, s: statsOf(pooled(cellsOf(cells, e))) })).sort((a, b) => a.s.winRate - b.s.winRate);
  const weak = ranked.filter(({ s }) => s.winRate < 1).slice(0, 3);
  out.push(`  weakest by result: ${weak.length ? weak.map(({ e, s }) => `${edgeName(e)} ${pct(s.winRate)}${isWatched(e) ? " (watched)" : ""}`).join(", ") : "none below 100%"}`);
  // Every edge with a ranged weapon on either side gets a style grid: the ranged fighter can stand, strafe or kite.
  const shown = edges.filter((e) => stylesOf(e[0]).length + stylesOf(e[1]).length > 2);
  const grids = new Map<string, StyleGrid>();
  if (!quick && shown.length > 0) {
    out.push("");
    out.push(`  How the weapons are played. stand = the shared policy (ranged fighters stand and shoot); strafe = sidestep, changing side every 0.8 s;`);
    out.push(`  kite = keep a longer distance and back off sooner. ${reduced.length} start distances x ${plural(factions.length, "faction")} per cell, ${mainArena} arena.`);
    for (const e of shown) {
      log(`style grid: ${edgeName(e)}`);
      const grid = styleGrid(e, { ...base, setups: reduced }, factions);
      grids.set(edgeName(e), grid);
      out.push(...grid.lines);
      duels += reduced.length * factions.length * stylesOf(e[0]).length * stylesOf(e[1]).length;
    }
  }
  out.push("");
  const verdicts = edges.map((e) => verdictOf(cells, e, factions, grids.get(edgeName(e))?.replies ?? []));
  out.push(heading(`EDGE VERDICTS  an edge holds when the designed winner wins at least ${pct(HOLD_OVERALL)} overall, at least ${pct(HOLD_FACTION)} in every faction column, and has a reply that wins at least ${pct(HOLD_REPLY)} against every style of the loser`));
  out.push(...formatVerdicts(verdicts, quick));
  out.push("");

  log("kiting");
  out.push(heading("KITING  the real sim: seconds until a melee fighter's first hit on a shooter that starts at the edge of its range, by how the shooter plays"));
  const kiting = kitingReport(factions);
  out.push(...kiting.text.map((l) => `  ${l}`));
  duels += kiting.cells.length * factions.length;
  out.push("");

  out.push(heading("WHAT EACH WEAPON DID  (main pass, per duel: swings, casts and shots started -> hits landed; the shield's hits include ripostes and reflected arrows)"));
  out.push(...weaponLines(cells));
  out.push("  spacing the clients play with (shared/policies.ts POLICIES, world units, centre to centre):");
  for (const w of ["sword", "axe", "shield", "bow", "wand"] as WeaponId[]) {
    const p = POLICIES[w];
    out.push(`    ${w.padEnd(7)} closes in past ${String(Math.round(p.far)).padStart(3)}, attacks within ${String(Math.round(p.attackRange)).padStart(3)}` +
      `${p.retreatBelow ? `, backs off under ${p.retreatBelow}` : ""}`);
  }
  out.push("");

  if (!quick && !opts.core) {
    const columns: Array<{ name: string; cells: readonly Cell[] }> = [];
    for (const p of ["client", "stale", "present"] as Perception[]) {
      log(`client view pass: ${p}`);
      columns.push({ name: p, cells: runMatrix({ ...base, setups: reduced, perception: p }) });
    }
    duels += columns.reduce((a, c) => a + total(c.cells), 0);
    out.push(heading(`WHAT THE CLIENT SEES  the designed winner's win%, ${reduced.length} start distances x ${plural(factions.length, "faction")}`));
    out.push("  How the bow and wand aim: client = lead for the stale view, the input tick and the cast; stale = aim at the stale view");
    out.push("  (what the bots do); present = read the true present (a cheat). Melee acts on its view in all three.");
    out.push(...passTable(columns, edges));
    out.push("");
    if (opts.arena === undefined || opts.arena === "both") {
      log("cluttered arena pass");
      // Every third setup, so the open column is the same duels without the pillars.
      const every = (i: number): boolean => i % 3 === 0;
      const pillars = runMatrix({ ...base, setups: setups.filter((_, i) => every(i)), arena: "pillars" });
      const open = cells.map((c) => ({ ...c, results: c.results.filter((_, i) => every(i)) }));
      duels += total(pillars);
      out.push(heading(`CLUTTERED ARENA  the designed winner's win%, ${Math.ceil(setups.length / 3)} setups x ${plural(factions.length, "faction")}: the same duels in the open arena and among ten 2x2 pillars`));
      out.push(...passTable([{ name: "open", cells: open }, { name: "pillars", cells: pillars }], edges));
      out.push("");
    }
  }

  const parity = parityReport();
  out.push(heading(formatParity(parity)));
  out.push("");
  out.push(`${duels} duels in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  return { edges, factions, cells, verdicts, parity, text: out.join("\n") };
}

/** Per weapon: swings, casts or shots started per duel, the hits that landed, and how many ticks went into walking into walls. */
function weaponLines(cells: readonly Cell[]): string[] {
  const rows = new Map<WeaponId, { duels: number; attacks: number; hits: number; stuck: number; atWall: number; ticks: number }>();
  for (const c of cells) {
    for (const r of c.results) {
      for (const i of [0, 1] as const) {
        const w = r.spec.weapons[i]!;
        const row = rows.get(w) ?? { duels: 0, attacks: 0, hits: 0, stuck: 0, atWall: 0, ticks: 0 };
        row.duels++;
        row.attacks += w === "bow" ? r.counts.shots[i] : r.counts.attacks[i];
        row.hits += r.counts.hits[i];
        row.stuck += r.counts.stuck[i];
        row.atWall += r.counts.atWall[i];
        row.ticks += r.seconds * TICK_RATE;
        rows.set(w, row);
      }
    }
  }
  const out = [["weapon".padEnd(10), "attacks".padStart(10), "hits".padStart(10), "hit rate".padStart(10), "ticks near a wall".padStart(19), "ticks stuck".padStart(13)].join("")];
  for (const w of ["sword", "axe", "shield", "bow", "wand"] as WeaponId[]) {
    const row = rows.get(w);
    if (!row) continue;
    out.push([
      w.padEnd(10), (row.attacks / row.duels).toFixed(1).padStart(10), (row.hits / row.duels).toFixed(1).padStart(10),
      (w === "shield" ? "-" : pct(row.hits / Math.max(1, row.attacks))).padStart(10),
      `${(100 * row.atWall / Math.max(1, row.ticks)).toFixed(1)}%`.padStart(19),`${(100 * row.stuck / Math.max(1, row.ticks)).toFixed(2)}%`.padStart(13),
    ].join(""));
  }
  return out;
}
