// The hand (docs/BOTS.md 2.3): where a click lands, and what the game client makes of it. A left click goes through a port of
// the client's own picker over the candidates the client offers; a right click on the ground is scattered and stays on
// screen. Pure given the streams handed in: when anything is clicked is the humanizer's business.
import { TARGET_SNAP_RADIUS, WORLD_H, WORLD_W, isSolidAt, type GameMap, type Rng, type Vec2 } from "@raid/shared";
import { chance, gaussian } from "./random";
import { BOT_VIEW, type FighterId, type Percept, type TierParams } from "./types";

export interface TargetPoint { x: number; y: number }
export interface TargetCandidate extends TargetPoint { id: string }

/**
 * A port of the client's `pickTarget` (client render/targeting.ts), pinned equal to it by test/bots/clicks.test.ts: the
 * candidate drawn nearest the cursor's ground point within `radius`, a tie to the lower id, or null.
 */
export function pickTarget(cursor: TargetPoint, candidates: Iterable<TargetCandidate>, radius = TARGET_SNAP_RADIUS): string | null {
  let best: string | null = null;
  let bestSq = radius * radius;
  for (const c of candidates) {
    const dx = c.x - cursor.x;
    const dy = c.y - cursor.y;
    const sq = dx * dx + dy * dy;
    if (sq < bestSq || (sq === bestSq && best !== null && c.id < best)) {
      best = c.id;
      bestSq = sq;
    }
  }
  return best;
}

/**
 * Every fighter a left click could lock, as the client offers them (RaidScene.targetCandidates): the other players and the
 * mobs that are alive and drawn, mobs not while the coliseum gates are locked. A fighter that is untargetable is not offered
 * (the server would refuse it); the percept never holds the bot itself.
 */
export function lockCandidates(p: Pick<Percept, "fighters" | "mobs" | "hud">): TargetCandidate[] {
  const list: TargetCandidate[] = [];
  for (const f of p.fighters) if (f.status === "alive" && f.targetable) list.push({ id: f.id, x: f.x, y: f.y });
  if (!p.hud.gatesLocked) for (const m of p.mobs) if (m.status === "alive") list.push({ id: m.id, x: m.x, y: m.y });
  return list;
}

interface Drawn { x: number; y: number; vx: number; vy: number }

function drawnAt(p: Pick<Percept, "fighters" | "mobs">, id: FighterId): Drawn | null {
  for (const f of p.fighters) if (f.id === id) return f;
  for (const m of p.mobs) if (m.id === id) return m;
  return null;
}

export interface LockClick {
  /** Where the cursor landed on the ground. */
  readonly cursor: Vec2;
  /** The fighter the client would lock, or null when the click was on empty ground (nothing is sent). */
  readonly picked: FighterId | null;
  /** The sigma was multiplied by slipMult (a mis-aimed flick). */
  readonly slipped: boolean;
}

/**
 * A left click meant for `target`: the cursor is where it is drawn now (or `target.at` when it has left the percept) minus its
 * velocity x lagS, since the hand trails a mover, plus a 2D Gaussian; with chance slipP the sigma is slipMult times larger.
 * The scatter is the motor stream's, the slip the lapse stream's.
 */
export function lockClick(
  motor: Rng, lapse: Rng, tier: TierParams, p: Percept, target: { readonly id: FighterId; readonly at: Vec2 },
  snapRadius = TARGET_SNAP_RADIUS,
): LockClick {
  const s = tier.targetScatter;
  const seen = drawnAt(p, target.id);
  const slipped = chance(lapse, s.slipP);
  const sigma = slipped ? s.sigma * s.slipMult : s.sigma;
  const cursor = {
    x: (seen ? seen.x - seen.vx * s.lagS : target.at.x) + gaussian(motor, 0, sigma),
    y: (seen ? seen.y - seen.vy * s.lagS : target.at.y) + gaussian(motor, 0, sigma),
  };
  return { cursor, picked: pickTarget(cursor, lockCandidates(p), snapRadius), slipped };
}

/** On the screen: within the window around the bot (BOT_VIEW). */
export function inWindow(self: Vec2, pt: Vec2): boolean {
  return Math.abs(pt.x - self.x) <= BOT_VIEW.halfW && Math.abs(pt.y - self.y) <= BOT_VIEW.halfH;
}

const clampAxis = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** The nearest point of the world that is also on screen. */
export function clampToWindow(self: Vec2, pt: Vec2): Vec2 {
  return {
    x: clampAxis(pt.x, Math.max(0, self.x - BOT_VIEW.halfW), Math.min(WORLD_W, self.x + BOT_VIEW.halfW)),
    y: clampAxis(pt.y, Math.max(0, self.y - BOT_VIEW.halfH), Math.min(WORLD_H, self.y + BOT_VIEW.halfH)),
  };
}

/** Tries before an aim that keeps landing in a wall gives up and clicks the point it meant. */
const WALL_RETRIES = 4;

/**
 * Scatter around `centre` with a 2D Gaussian and keep the click on the ground: a person aims at floor they can see, so a draw
 * that lands on a tile that blocks a body (a wall, or the low ground of a river, a fence or a crevasse: the move mask) is aimed
 * again (the server would otherwise path to the nearest floor, maybe on the other side). `fit` keeps the click where it can go: on screen for a ground click, in the world for a minimap one.
 */
function scatter(motor: Rng, map: GameMap, centre: Vec2, sigma: number, fit: (pt: Vec2) => Vec2): Vec2 {
  const onWall = isSolidAt(map, centre.x, centre.y);
  for (let i = 0; i < WALL_RETRIES; i++) {
    const pt = fit({ x: centre.x + gaussian(motor, 0, sigma), y: centre.y + gaussian(motor, 0, sigma) });
    if (onWall || !isSolidAt(map, pt.x, pt.y)) return pt;
  }
  return fit(centre);
}

/**
 * The point on the window's border along the heading from `self` toward `to`, pulled in a little (so the pointer is on the
 * screen, not on its last pixel) and further in until it is floor.
 */
export function edgeToward(map: GameMap, self: Vec2, to: Vec2): Vec2 {
  const dx = to.x - self.x;
  const dy = to.y - self.y;
  const t = Math.min(dx === 0 ? Infinity : BOT_VIEW.halfW / Math.abs(dx), dy === 0 ? Infinity : BOT_VIEW.halfH / Math.abs(dy));
  if (!Number.isFinite(t)) return { x: self.x, y: self.y };
  let pt = { x: self.x, y: self.y };
  for (const f of [0.97, 0.85, 0.7, 0.55, 0.4]) {
    pt = { x: self.x + dx * t * f, y: self.y + dy * t * f };
    if (!isSolidAt(map, pt.x, pt.y)) break;
  }
  return pt;
}

export type MoveClickKind = "ground" | "edge" | "minimap";

export interface MoveClick {
  readonly to: Vec2;
  readonly kind: MoveClickKind;
}

/** Sigma of a ground click: the cursor travels from the bot, so it grows with the distance. */
export function groundSigma(tier: TierParams, self: Vec2, pt: Vec2): number {
  return tier.moveScatter.base + tier.moveScatter.perUnit * Math.hypot(pt.x - self.x, pt.y - self.y);
}

/** A ground click at `pt` (on screen): scattered, clamped to the world and the window. A cast on the ground aims the same way. */
export function groundClick(motor: Rng, tier: TierParams, map: GameMap, self: Vec2, pt: Vec2): Vec2 {
  const on = clampToWindow(self, pt);
  return scatter(motor, map, on, groundSigma(tier, self, on), (q) => clampToWindow(self, q));
}

/**
 * A right click that orders a walk to `to`. On screen it lands on the ground with the tier's scatter. Off screen the bot
 * either clicks the window's edge toward it (and will click again as it walks; with chance edgeClickP) or the minimap, whose
 * dot is hit with minimapSigma. The edge is a ground click, so it never leaves the screen.
 */
export function moveClick(motor: Rng, tier: TierParams, map: GameMap, self: Vec2, to: Vec2): MoveClick {
  if (inWindow(self, to)) return { to: groundClick(motor, tier, map, self, to), kind: "ground" };
  if (chance(motor, tier.edgeClickP)) return { to: groundClick(motor, tier, map, self, edgeToward(map, self, to)), kind: "edge" };
  const world = (q: Vec2): Vec2 => ({ x: clampAxis(q.x, 0, WORLD_W), y: clampAxis(q.y, 0, WORLD_H) });
  return { to: scatter(motor, map, world(to), tier.minimapSigma, world), kind: "minimap" };
}
