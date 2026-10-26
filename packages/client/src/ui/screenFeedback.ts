// Full-screen feedback laid over the canvas (behind the HUD): a red vignette when the local player takes a real hit, and a
// soft green or red tint for the matchup against the nearest enemy in sight (GAME_DESIGN 15). Display only: the numbers
// come from the shared helpers (damageFlash, matchupScore, matchupTint), styling is inline so no stylesheet is needed.
import {
  MATCHUP_HZ, MATCHUP_RANGE, TICK_MS, damageFlash, suddenDeathShare,
  hasLineOfSight, isFactionId, matchupScore, matchupTint, withGates,
  type FactionId, type GameMap, type SignatureKind, type WeaponId,
} from "@raid/shared";
import { heldWeapon } from "../render/FighterArt";
import { targetable } from "../render/targeting";
import { el, uiRoot } from "./dom";

/** A vignette decays to nothing over this long. */
export const VIGNETTE_DECAY_MS = 350;
/** Opacity of the matchup tint at full strength (|tint| = 1). */
export const TINT_MAX_ALPHA = 0.16;
/** Time constant of the tint's ease toward its target, so the 5 Hz samples don't show as steps. */
export const TINT_TAU_MS = 160;
/** Within this of its target the eased tint lands on it, so a settled screen stops repainting. */
const TINT_SNAP = 0.002;

/** The vignette's strength now: `strength` at the moment of the hit, falling linearly to 0 after VIGNETTE_DECAY_MS. */
export function decayed(strength: number, elapsedMs: number): number {
  if (!(strength > 0)) return 0;
  return Math.max(0, strength * (1 - Math.max(0, elapsedMs) / VIGNETTE_DECAY_MS));
}

/**
 * The hp sudden death takes from a player with `maxHp` in the tick that ended at server time `patchT`, 0 before it starts
 * (`suddenDeathAt` 0 = not scheduled). It mirrors the server's own burn (sim/arena.ts suddenDeath: a share of max hp per
 * second, growing each whole second, over the tick that began at `patchT - TICK_MS`). The arena sends no `hit` fx, and the
 * hp the state loses also holds damage over time and hits that already flashed, so the loss is derived rather than measured.
 */
export function suddenDeathLoss(maxHp: number, patchT: number, suddenDeathAt: number): number {
  const tickStart = patchT - TICK_MS;
  if (!(suddenDeathAt > 0) || !(maxHp > 0) || tickStart < suddenDeathAt) return 0;
  const share = suddenDeathShare(tickStart - suddenDeathAt);
  return share * (TICK_MS / 1000) * maxHp;
}

/** One decaying pulse; overlapping hits keep the stronger of what is left and what just landed. */
export class DamagePulse {
  private strength = 0;
  private at = 0;

  value(now: number): number {
    return decayed(this.strength, now - this.at);
  }

  hit(strength: number, now: number): void {
    this.strength = Math.max(this.value(now), Math.min(1, strength));
    this.at = now;
  }
}

/** Eases `current` toward `target` (exponential, time constant `tauMs`); lands exactly on it once it is close. */
export function approach(current: number, target: number, dtMs: number, tauMs = TINT_TAU_MS): number {
  const next = current + (target - current) * (1 - Math.exp(-Math.max(0, dtMs) / tauMs));
  return Math.abs(next - target) < TINT_SNAP ? target : next;
}

/** The tint overlay's colour and opacity for a signed tint in -1..1: green when you counter them, red when they counter you. */
export function tintStyle(tint: number): { color: string; opacity: number } {
  const mag = Math.min(1, Math.abs(tint));
  return { color: tint >= 0 ? "rgb(70, 200, 90)" : "rgb(230, 50, 50)", opacity: mag * TINT_MAX_ALPHA };
}

/** What the matchup needs of a fighter: where it is drawn and what it brings. */
export interface Matchup { x: number; y: number; faction: FactionId; weapon: WeaponId | null }

/**
 * The signed tint (-1..1) for the nearest foe within MATCHUP_RANGE that `me` has a clear line to; 0 for none. Only foes
 * closer than the best one found so far are ray-cast, so a crowd costs a handful of rays.
 */
export function nearestFoeTint(me: Matchup, foes: Iterable<Matchup>, sees: (a: Matchup, b: Matchup) => boolean): number {
  let best: Matchup | null = null;
  let bestDist = MATCHUP_RANGE;
  for (const foe of foes) {
    const d = Math.hypot(foe.x - me.x, foe.y - me.y);
    if (!(d < bestDist) || !sees(me, foe)) continue;
    best = foe;
    bestDist = d;
  }
  return best ? matchupTint(matchupScore(me, best), bestDist) : 0;
}

interface FighterLike {
  faction: string;
  weapon0: string;
  weapon1: string;
  slot: number;
  status: string;
  /** The synced EFFECT_* bits (a hidden or untargetable fighter is not a foe the tint may show). */
  effects?: number;
}

/** The slice of RaidState the matchup reads (PlayerState and MobState satisfy FighterLike). */
export interface MatchupWorld {
  phase: string;
  gatesLocked: boolean;
  players: { get(id: string): FighterLike | undefined; forEach(cb: (p: FighterLike, id: string) => void): void };
  mobs: { forEach(cb: (m: FighterLike, id: string) => void): void };
}

type Drawn = { x: number; y: number };

/**
 * The matchup tint for the local player right now: 0 unless they are alive in an active run. `drawn` is where the
 * scene draws each fighter (the interpolated positions), `map` the open map (gates are sealed while they are locked).
 */
export function matchupTarget(world: MatchupWorld, localId: string, drawn: ReadonlyMap<string, Drawn>, map: GameMap | undefined): number {
  if (world.phase !== "active" || !map) return 0;
  const p = world.players.get(localId);
  const at = drawn.get(localId);
  if (!p || p.status !== "alive" || !at || !isFactionId(p.faction)) return 0;
  const me: Matchup = { x: at.x, y: at.y, faction: p.faction, weapon: heldWeapon(p) };

  const foes: Matchup[] = [];
  const add = (f: FighterLike, id: string) => {
    const pos = drawn.get(id);
    if (id === localId || f.status !== "alive" || !pos || !isFactionId(f.faction)) return;
    // The screen must not tell that a hidden (Swarm) enemy is near, or how near: the same rule as the cursor's pick.
    if (!targetable(f.effects ?? 0)) return;
    foes.push({ x: pos.x, y: pos.y, faction: f.faction, weapon: heldWeapon(f) });
  };
  world.players.forEach(add);
  world.mobs.forEach(add);

  const sight = world.gatesLocked ? withGates(map) : map;
  return nearestFoeTint(me, foes, (a, b) => hasLineOfSight(sight, a, b));
}

/** The vignette: clear in the middle, deepening to blood red at the screen's edge. */
const VIGNETTE_BG = "radial-gradient(ellipse at center, rgba(180,0,0,0) 42%, rgba(200,10,10,0.55) 78%, rgba(230,0,0,0.9) 100%)";

const FILL = "position:absolute;inset:0;pointer-events:none;";

export class ScreenFeedback {
  private readonly root = el("div");
  private readonly tint = el("div");
  private readonly vignette = el("div");
  private readonly pulse = new DamagePulse();
  private tintValue = 0;
  private tintTarget = 0;
  private sampledAt = -Infinity;
  private frameAt = -1;
  private paintedVignette = -1;
  private paintedTint = "";

  constructor() {
    // pointer-events inline: index.html's "#ui > *" rule would otherwise make the overlay swallow clicks.
    this.root.style.cssText = `${FILL}overflow:hidden;`;
    this.tint.style.cssText = `${FILL}opacity:0;`;
    this.vignette.style.cssText = `${FILL}opacity:0;background:${VIGNETTE_BG};`;
    this.root.append(this.tint, this.vignette);
    // First in #ui: every HUD and menu element that follows paints over the overlay.
    uiRoot().prepend(this.root);
  }

  /** The local player took `amount` (after mitigation) with `maxHp`; damage over time and tiny hits do not flash. */
  hit(amount: number, maxHp: number, sig?: SignatureKind, now = performance.now()): void {
    const strength = damageFlash(amount, maxHp, sig);
    if (strength > 0) this.pulse.hit(strength, now);
  }

  /** Once per frame. `sample` returns the matchup tint target; it is called at most MATCHUP_HZ times a second. */
  update(now: number, sample: () => number, hz = MATCHUP_HZ): void {
    if (now - this.sampledAt >= 1000 / hz) {
      this.sampledAt = now;
      this.tintTarget = sample();
    }
    // Clamped: a hidden tab resumes with a huge gap, and the tint should ease, not jump.
    const dt = this.frameAt < 0 ? 0 : Math.min(100, now - this.frameAt);
    this.frameAt = now;
    this.tintValue = approach(this.tintValue, this.tintTarget, dt);
    this.paint(now);
  }

  private paint(now: number): void {
    const v = Math.round(this.pulse.value(now) * 100) / 100;
    if (v !== this.paintedVignette) {
      this.paintedVignette = v;
      this.vignette.style.opacity = String(v);
    }
    const { color, opacity } = tintStyle(this.tintValue);
    const key = `${color}|${opacity.toFixed(3)}`;
    if (key !== this.paintedTint) {
      this.paintedTint = key;
      this.tint.style.background = color;
      this.tint.style.opacity = opacity.toFixed(3);
    }
  }

  destroy(): void {
    this.root.remove();
  }
}
