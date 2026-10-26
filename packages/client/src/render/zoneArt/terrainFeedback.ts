// What a fighter standing on a hazard shows (part D 7.5), derived entirely from the shared map: the tile under a fighter's centre
// and its faction (`surfaceAt`, the table the sim reads) say whether it is burning, slowed, sliding or resting, so there is no
// new wire and every client agrees. The local player gets HUD chips (ui/terrainChips.ts) and every fighter gets effects at its
// feet (FeetFx). Resting is shown only out of combat: the client approximates the server's 3 s heal lockout from the hit fx it
// sees, and a `heal` fx on the fighter is the truth that overrides it. Presentation only.
import Phaser from "phaser";
import {
  HEAL_LOCKOUT_SECONDS, PLAYER_RADIUS, TERRAINS, TERRAIN_LIGHT, Y_SCALE, hazardsOf, surfaceAt, terrainAt,
  type FxEvent, type GameMap,
} from "@raid/shared";
import { juiceScale } from "../juice";
import { depthFor, projX, projY } from "../projection";
import { life, pulse } from "../signatureLook";
import { TERRAIN_PALETTE } from "./palette";

export interface TerrainStates {
  /** The terrain kind under the fighter's centre (0 = plain ground). */
  kind: number;
  burning: boolean;
  slowed: boolean;
  sliding: boolean;
  resting: boolean;
  /** 1, or 2 for the faction the light is a boost for (Holy). */
  restBoost: number;
  /** The tile is a hazard of the fighter's own zone and the fighter is exempt from it ("Home ground"). */
  home: boolean;
}

export const NO_STATES: Readonly<TerrainStates> = Object.freeze({
  kind: 0, burning: false, slowed: false, sliding: false, resting: false, restBoost: 1, home: false,
});

export interface StateContext {
  /** A player (light heals players only). */
  player: boolean;
  alive: boolean;
  /** Below full hp (nothing to heal otherwise). */
  hurt: boolean;
  /** Dealt or took damage within the heal lockout. */
  combat: boolean;
  /** A `heal` fx on it within the last second and a half: the server is healing it now. */
  healing: boolean;
}

/** The four states of a fighter at (x, y): `surfaceAt` with the home rule applied, light only when it can actually heal. */
export function terrainStates(map: GameMap, x: number, y: number, faction: string, ctx: StateContext): TerrainStates {
  const kind = terrainAt(map, x, y);
  if (kind === 0) return NO_STATES;
  const eff = surfaceAt(map, x, y, faction);
  const spec = TERRAINS[kind];
  const resting = eff.healShare > 0 && ctx.player && ctx.alive && (ctx.healing || (!ctx.combat && ctx.hurt));
  const burning = eff.burnShare > 0;
  const slowed = eff.speedMult < 1;
  const sliding = eff.accel > 0;
  const exempt = spec.homeRule === "exempt" && spec.home === faction;
  const states: TerrainStates = {
    kind, burning, slowed, sliding, resting,
    restBoost: resting && spec.healShare > 0 ? Math.round(eff.healShare / spec.healShare) : 1,
    home: exempt && !burning && !slowed && !sliding && kind !== 0,
  };
  return states.burning || states.slowed || states.sliding || states.resting || states.home ? states : NO_STATES;
}

export type ChipId = "burning" | "slowed" | "ice" | "resting";

export interface Chip {
  id: ChipId;
  /** A glyph and a word: colour is never the only cue. */
  glyph: string;
  text: string;
  /** The explanation (a tooltip). */
  title: string;
}

const pct = (share: number): string => `${Math.round(share * 1000) / 10}%`;

/** The chips for a set of states, in a stable order. */
export function chipsOf(s: TerrainStates): Chip[] {
  const out: Chip[] = [];
  if (s.burning) {
    const ember = TERRAINS.find((t) => t.burnShare > 0)!;
    out.push({ id: "burning", glyph: "▲", text: "BURNING", title: `Embers burn ${pct(ember.burnShare)} of your max hp every second` });
  }
  if (s.slowed) {
    const bog = TERRAINS.find((t) => t.speedMult < 1)!;
    out.push({ id: "slowed", glyph: "▼", text: "SLOWED", title: `${bog.name} slows you to ${Math.round(bog.speedMult * 100)}% speed` });
  }
  if (s.sliding) out.push({ id: "ice", glyph: "◇", text: "ICE", title: "Slippery: you slide when you start, turn or stop" });
  if (s.resting) {
    const light = TERRAINS[TERRAIN_LIGHT]!;
    out.push({
      id: "resting", glyph: "+", text: s.restBoost > 1 ? `RESTING x${s.restBoost}` : "RESTING",
      title: `Light heals ${pct(light.healShare * s.restBoost)} of your max hp every second while you are out of combat`,
    });
  }
  return out;
}

/** The "Home ground" line for a fighter on a hazard of its own zone, or null. */
export function homeNote(s: TerrainStates): string | null {
  if (!s.home) return null;
  const spec = TERRAINS[s.kind];
  if (!spec) return null;
  if (spec.burnShare > 0) return `Home ground: ${spec.name.toLowerCase()} can't burn you`;
  if (spec.speedMult < 1) return `Home ground: ${spec.name.toLowerCase()} can't slow you`;
  if (spec.slipMs > 0) return `Home ground: full grip on ${spec.name.toLowerCase()}`;
  return null;
}

/** Whether two sets of states would show the same chips (a HUD frame that matches the last one touches nothing). */
export function sameStates(a: TerrainStates, b: TerrainStates): boolean {
  return a.kind === b.kind && a.burning === b.burning && a.slowed === b.slowed && a.sliding === b.sliding && a.resting === b.resting
    && a.restBoost === b.restBoost && a.home === b.home;
}

// ------------------------------------------------------------------------------------------------------------------ combat memory

/** How long a `heal` fx keeps a fighter "resting" (the light heals once a second). */
export const HEAL_SHOWN_MS = 1500;

/**
 * Who was in combat when, from the fx the client saw: a hit by a fighter counts for both (the server's `combatAt` is the last time a
 * fighter dealt or took damage); the arena's damage (no attacker) does not. A `heal` fx marks the fighter as being healed.
 */
export class CombatMemory {
  private readonly combatAt = new Map<string, number>();
  private readonly healedAt = new Map<string, number>();

  note(fx: FxEvent & { t?: number }, fallbackT = 0): void {
    const t = fx.t ?? fallbackT;
    if (fx.kind === "hit" && fx.by !== null) {
      this.combatAt.set(fx.id, t);
      this.combatAt.set(fx.by, t);
    } else if (fx.kind === "heal") {
      this.healedAt.set(fx.id, t);
    }
  }

  inCombat(id: string, serverNow: number): boolean {
    const t = this.combatAt.get(id);
    return t !== undefined && serverNow - t < HEAL_LOCKOUT_SECONDS * 1000;
  }

  healing(id: string, serverNow: number): boolean {
    const t = this.healedAt.get(id);
    return t !== undefined && serverNow - t < HEAL_SHOWN_MS && serverNow >= t - HEAL_SHOWN_MS;
  }

  forget(id: string): void {
    this.combatAt.delete(id);
    this.healedAt.delete(id);
  }

  clear(): void {
    this.combatAt.clear();
    this.healedAt.clear();
  }
}

/** What the scene keeps for the ground feedback: the map, the combat memory, and the frames it hands out. */
export class GroundFeedback {
  private map: GameMap | null = null;
  private hazards = false;
  readonly combat = new CombatMemory();

  setMap(map: GameMap | null): void {
    this.map = map;
    this.hazards = map !== null && (() => { const h = hazardsOf(map); return h.burn || h.slow || h.slip || h.heal; })();
    this.combat.clear();
  }

  /** True when the map has any hazard terrain at all: with none, every frame is the empty one and nothing draws. */
  get active(): boolean {
    return this.hazards;
  }

  /** The states of fighter `id` at (x, y); the shared empty states when the map has no hazards. */
  statesOf(id: string, x: number, y: number, faction: string, serverNow: number, hp: number, maxHp: number, player: boolean, alive = true): TerrainStates {
    if (!this.hazards || !this.map) return NO_STATES;
    return terrainStates(this.map, x, y, faction, {
      player, alive, hurt: hp < maxHp - 0.5, combat: this.combat.inCombat(id, serverNow), healing: this.combat.healing(id, serverNow),
    });
  }
}

// ------------------------------------------------------------------------------------------------------------------ feet effects

const R = PLAYER_RADIUS;
const TAU = Math.PI * 2;
/** A drawn speed above this on ice leaves a skid streak (u/s): a walk is 170. */
export const SKID_SPEED = 45;
const FLAME_OUTER = 0xff7043;
const FLAME_INNER = 0xffca28;
const GOLD_RING = 0xffd54f;
const RIPPLE = TERRAIN_PALETTE.bog.surface;
const SKID = TERRAIN_PALETTE.ice.highlight;

/**
 * The effects at a fighter's feet: flames while burning, ripples in a bog, a skid streak on ice, a gold ring while resting (Holy's
 * larger). One Graphics at the fighter's ground position, one depth under the fighter, redrawn only while something shows.
 * Colour effects scale with `juiceScale("flash")` and movement with `juiceScale("motion")`.
 */
export class FeetFx {
  readonly g: Phaser.GameObjects.Graphics;
  private drawn = false;
  private lastX = NaN;
  private lastY = NaN;
  private lastT = 0;
  /** The drawn velocity, smoothed over a few frames. */
  private vx = 0;
  private vy = 0;
  /** One counter hands each fighter its own phase so a crowd does not flicker in step. */
  private static nextPhase = 0;
  private readonly phase = (FeetFx.nextPhase++ * 0.37) % 1;

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setVisible(false);
  }

  /** The speed the fighter is drawn at, from its drawn positions: call every frame it is drawn. */
  track(x: number, y: number, nowMs: number): number {
    const dt = nowMs - this.lastT;
    if (Number.isFinite(this.lastX) && dt > 0 && dt < 250) {
      const k = Math.min(1, dt / 90);
      this.vx += ((x - this.lastX) / (dt / 1000) - this.vx) * k;
      this.vy += ((y - this.lastY) / (dt / 1000) - this.vy) * k;
    } else {
      this.vx = 0;
      this.vy = 0;
    }
    this.lastX = x;
    this.lastY = y;
    this.lastT = nowMs;
    return Math.hypot(this.vx, this.vy);
  }

  /** Draws the states at (x, y) (ground units). Hides itself when there is nothing to show. */
  update(states: TerrainStates, x: number, y: number, nowMs: number): void {
    const speed = this.track(x, y, nowMs);
    const flash = juiceScale("flash");
    const any = flash > 0 && (states.burning || states.slowed || states.sliding || states.resting);
    if (!any) {
      this.hide();
      return;
    }
    const motion = juiceScale("motion");
    const g = this.g;
    g.setPosition(projX(x), projY(y)).setDepth(depthFor(y) - 0.01).setVisible(true).clear();
    this.drawn = true;
    const now = nowMs + this.phase * 1000;
    if (states.burning) this.flames(g, now, flash, motion);
    if (states.slowed) this.ripples(g, now, flash, motion);
    if (states.sliding && speed > SKID_SPEED) this.skid(g, speed, flash);
    if (states.resting) this.ring(g, now, flash, motion, states.restBoost);
  }

  hide(): void {
    if (!this.drawn) return;
    this.drawn = false;
    this.g.clear().setVisible(false);
  }

  destroy(): void {
    this.g.destroy();
  }

  /** Flames licking up around the feet (from terrain, not a signature bit): a ring of flickering tongues over a warm glow. */
  private flames(g: Phaser.GameObjects.Graphics, now: number, flash: number, motion: number): void {
    g.fillStyle(FLAME_OUTER, 0.2 * flash).fillEllipse(0, 0, (R + 8) * 2, (R + 8) * 2 * Y_SCALE);
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + 0.3;
      const bx = Math.cos(a) * (R * 0.8);
      const by = Math.sin(a) * (R * 0.8) * Y_SCALE;
      const lick = motion > 0 ? 0.5 + 0.5 * Math.sin(now / 130 + i * 2.1) : 0.6;
      const h = 6 + 7 * lick * (0.6 + 0.4 * motion);
      g.fillStyle(FLAME_OUTER, 0.85 * flash).fillTriangle(bx - 2.6, by, bx + 2.6, by, bx + (motion > 0 ? Math.sin(now / 210 + i) : 0) * 1.5, by - h);
      g.fillStyle(FLAME_INNER, 0.9 * flash).fillTriangle(bx - 1.2, by, bx + 1.2, by, bx, by - h * 0.55);
    }
  }

  /** Ripple rings spreading from the feet in a bog; a still pair under reduced motion. */
  private ripples(g: Phaser.GameObjects.Graphics, now: number, flash: number, motion: number): void {
    for (let i = 0; i < 2; i++) {
      const p = motion > 0 ? life(now, 1500, i, 2) : 0.3 + 0.4 * i;
      const rx = R * 0.7 + R * 1.1 * p;
      g.lineStyle(1.6, RIPPLE, (1 - p) * 0.85 * flash).strokeEllipse(0, 0, rx * 2, rx * 2 * Y_SCALE);
    }
    g.fillStyle(TERRAIN_PALETTE.bog.sludge, 0.35 * flash).fillEllipse(0, 1, R * 1.6, R * 1.6 * Y_SCALE);
  }

  /** Two short fading skid lines behind a fighter that is sliding. */
  private skid(g: Phaser.GameObjects.Graphics, speed: number, flash: number): void {
    const len = Math.min(34, 8 + speed * 0.12);
    const dx = -this.vx / speed;
    const dy = -this.vy / speed;
    const nx = -dy;
    const ny = dx;
    for (const side of [-1, 1]) {
      const ox = nx * side * 5;
      const oy = ny * side * 5 * Y_SCALE;
      g.lineStyle(1.6, SKID, 0.75 * flash).lineBetween(ox, oy, ox + dx * len, oy + dy * len * Y_SCALE);
      g.lineStyle(1, SKID, 0.35 * flash).lineBetween(ox, oy, ox + dx * len * 1.7, oy + dy * len * 1.7 * Y_SCALE);
    }
  }

  /** A soft gold ring on the ground (Holy's wider: the x2) and rising plus signs. */
  private ring(g: Phaser.GameObjects.Graphics, now: number, flash: number, motion: number, boost: number): void {
    const r = R + (boost > 1 ? 15 : 8);
    const a = (motion > 0 ? pulse(now, 0.8, 0.45, 0.7) : 0.55) * flash;
    g.fillStyle(GOLD_RING, 0.12 * flash).fillEllipse(0, 0, r * 2, r * 2 * Y_SCALE);
    g.lineStyle(boost > 1 ? 2.5 : 2, GOLD_RING, a).strokeEllipse(0, 0, r * 2, r * 2 * Y_SCALE);
    const crosses = boost > 1 ? 4 : 3;
    for (let i = 0; i < crosses; i++) {
      const p = motion > 0 ? life(now, 1700, i, crosses) : (i + 0.5) / crosses;
      const x = Math.sin(i * 2.3 + 1) * r * 0.6;
      const y = -2 - p * 22 * (0.4 + 0.6 * motion);
      const k = Math.sin(Math.PI * p);
      g.lineStyle(1.5, GOLD_RING, k * 0.9 * flash).lineBetween(x - 2.5, y, x + 2.5, y).lineBetween(x, y - 2.5, x, y + 2.5);
    }
  }
}
