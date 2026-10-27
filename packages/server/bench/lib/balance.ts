// The shared definitions of the balance benches (BALANCE_CONTRACT 1.1): one duel, the noise model, the statistics. ttkCurve.ts,
// matchups.ts and farmVsFight.ts are thin drivers on top of it, so "a duel", "TTK" and "win %" mean the same in all three.
//
//   Duel    runDuel (harness/duel.ts), arena "open", perception "client", signatures on, seed 1 + 7 i for setup i of the 18
//           fullSetups(), every ordered pair in both seats; style `lock` (both fighters click each other: the controls the game
//           client has) is the acceptance style; cap 300 s at minute 0 and 200 s after.
//   TTK     seconds from the first landed hit to the end; finished duels only (the approach, about 1.2 s, is not in it).
//   Noise   each fighter's PvP outgoing damage is multiplied by exp(0.45 Z), Z ~ N(0, 1) per duel and seat (Box-Muller on
//           mulberry32(seed x 7919 + draw x 104729 + 1 + seat)): the play-variance model behind every win % ("sigma 0.45" is the
//           value at which the owner's two bands coincide: h 35% <=> r 1.54 <=> the underdog wins 25%). It reaches the sim as
//           `DuelSpec.damageScale`, i.e. `World.combat.duelScale`, next to the PvP factor.
//   h       the favourite's hp / max hp at the end of its wins, noise off; median over the duels.
//   r       the smallest multiplier on the underdog's PvP outgoing damage that makes it win (bisection); with constant rates
//           h = 1 - 1/r, and P(favourite wins) = Phi(ln r / 0.636) under the noise model.
//   Win %   favourite wins / duels over the noise draws x setups x both seats; a draw or a cap counts half.
import { mulberry32, type FactionId, type WeaponId } from "@raid/shared";
import { runDuel, type DuelResult } from "../../src/harness/duel";
import type { Setup } from "../../src/harness/matrix";

export const SIGMA = 0.45;

/** `--name value` from argv (`def` when absent). */
export function opt(args: readonly string[], name: string, def: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1]! : def;
}

export const flag = (args: readonly string[], name: string): boolean => args.includes(`--${name}`);

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export const mean = (xs: readonly number[]): number => (xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length);

/** A standard normal from one mulberry32 stream (Box-Muller). */
export function gauss(seed: number): number {
  const r = mulberry32(seed);
  const u = Math.max(1e-12, r());
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** The noise multipliers [seat 0, seat 1] of draw `draw` of the duel with this seed (all 1 when sigma is 0). */
export function noiseOf(seed: number, draw: number, sigma: number): [number, number] {
  if (!(sigma > 0)) return [1, 1];
  return [
    Math.exp(sigma * gauss(seed * 7919 + draw * 104729 + 1)),
    Math.exp(sigma * gauss(seed * 7919 + draw * 104729 + 2)),
  ];
}

/** Phi, the standard normal CDF (Abramowitz-Stegun 7.1.26 on erf). */
export function phi(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** P(the favourite wins) for a flip multiplier r under the noise model: Phi(ln r / (sigma sqrt 2)). */
export const favouriteShare = (r: number, sigma: number = SIGMA): number => phi(Math.log(r) / (sigma * Math.SQRT2));

export interface PlayOpts {
  a: FactionId;
  b: FactionId;
  weapons: readonly [WeaponId, WeaponId];
  setup: Setup;
  setupIndex: number;
  style: "lock" | "policy";
  cap: number;
  draw?: number;
  sigma?: number;
  /** Fixed per-seat outgoing multipliers (the flip bisection) on top of the noise. */
  scale?: readonly [number, number];
  cards?: readonly [readonly string[] | undefined, readonly string[] | undefined];
  startHp?: readonly [number | undefined, number | undefined];
}

export interface DuelRecord {
  a: FactionId;
  b: FactionId;
  setup: number;
  draw: number;
  winner: 0 | 1 | null;
  end: DuelResult["end"];
  /** From the first landed hit to the end. */
  ttk: number;
  seconds: number;
  hp: readonly [number, number];
  scale: readonly [number, number];
}

export function playDuel(o: PlayOpts): DuelRecord {
  const seed = 1 + o.setupIndex * 7;
  const draw = o.draw ?? 0;
  const noise = noiseOf(seed, draw, o.sigma ?? 0);
  const fixed = o.scale ?? [1, 1];
  const scale: [number, number] = [noise[0] * fixed[0], noise[1] * fixed[1]];
  const r = runDuel({
    faction: o.a, factions: [o.a, o.b], weapons: o.weapons, distance: o.setup.distance, angle: o.setup.angle,
    delayTicks: o.setup.delayTicks, arena: "open", perception: "client", capSeconds: o.cap, seed, signatures: true,
    ...(o.style === "lock" ? { locks: [true, true] as const } : {}),
    ...(o.cards ? { cards: o.cards } : {}),
    ...(o.startHp ? { startHp: o.startHp } : {}),
    ...(scale[0] !== 1 || scale[1] !== 1 ? { damageScale: scale } : {}),
  });
  const first = r.hitLog.length > 0 ? r.hitLog[0]!.t : 0;
  return { a: o.a, b: o.b, setup: o.setupIndex, draw, winner: r.winner, end: r.end, ttk: r.seconds - first, seconds: r.seconds, hp: r.hpFrac, scale };
}

/**
 * The flip multiplier r of one duel: the smallest multiplier on the underdog's damage (seat `underdog`) that makes it win,
 * 1 if it already wins, `hi` if even that is not enough. Bisection on the geometric scale.
 */
export function flipMultiplier(o: PlayOpts, underdog: 0 | 1, hi = 16): number {
  const wins = (m: number): boolean => {
    const scale: [number, number] = underdog === 0 ? [m, 1] : [1, m];
    return playDuel({ ...o, sigma: 0, scale }).winner === underdog;
  };
  if (wins(1)) return 1;
  if (!wins(hi)) return hi;
  let lo = 1;
  let up = hi;
  for (let i = 0; i < 12; i++) {
    const mid = Math.sqrt(lo * up);
    if (wins(mid)) up = mid;
    else lo = mid;
  }
  return Math.sqrt(lo * up);
}

/** The favourite's view of the duels of one edge (both seats pooled): wins, win % (a draw or cap counts half), h and TTK. */
export interface EdgeStats {
  n: number;
  favWin: number;
  underWin: number;
  caps: number;
  /** Median hp share the favourite keeps in its wins. */
  h: number;
  hMin: number;
  ttk: number;
  ttkFavKills: number;
}

export function edgeStats(records: readonly DuelRecord[], fav: FactionId, und: FactionId): EdgeStats {
  const rs = records.filter((r) => (r.a === fav && r.b === und) || (r.a === und && r.b === fav));
  const seat = (r: DuelRecord): 0 | 1 => (r.a === fav ? 0 : 1);
  const fw = rs.filter((r) => r.winner === seat(r));
  const uw = rs.filter((r) => r.winner === (1 - seat(r)));
  const draws = rs.filter((r) => r.end === "draw").length;
  const caps = rs.filter((r) => r.end === "cap").length;
  const h = fw.map((r) => r.hp[seat(r)]);
  return {
    n: rs.length,
    favWin: rs.length ? (fw.length + 0.5 * (draws + caps)) / rs.length : NaN,
    underWin: rs.length ? uw.length / rs.length : NaN,
    caps,
    h: median(h),
    hMin: h.length ? Math.min(...h) : NaN,
    ttk: median(rs.filter((r) => r.end !== "cap").map((r) => r.ttk)),
    ttkFavKills: median(fw.map((r) => r.ttk)),
  };
}

export const pct = (x: number, digits = 0): string => (Number.isFinite(x) ? (x * 100).toFixed(digits) : "--");
export const sec = (x: number): string => (Number.isFinite(x) ? x.toFixed(1) : "--");

/** One acceptance line: PASS inside the target, WARN inside the tolerance, FAIL outside; `n/a` when the value is NaN. */
export function verdict(id: string, label: string, value: number, target: readonly [number, number], tol: readonly [number, number], unit = ""): string {
  const fmt = (x: number): string => (Number.isFinite(x) ? (Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2)) : "--");
  const status = !Number.isFinite(value) ? "n/a " : value >= target[0] && value <= target[1] ? "PASS" : value >= tol[0] && value <= tol[1] ? "WARN" : "FAIL";
  return `${status} ${id} ${label}: ${fmt(value)}${unit} (target ${fmt(target[0])}-${fmt(target[1])}, tolerance ${fmt(tol[0])}-${fmt(tol[1])})`;
}
