import { describe, expect, it } from "vitest";
import {
  EFFECT_HIDDEN, EFFECT_STUNNED, EFFECT_UNTARGETABLE, MATCHUP_FULL_RANGE, MATCHUP_RANGE, SUDDEN_DEATH_RAMP_FRACTION, SUDDEN_DEATH_START_FRACTION, TICK_MS, TILE, TILE_WALL,
  damageFlash, mapFromTiles, matchupTint,
  type GameMap, type WeaponId,
} from "@raid/shared";
import {
  DamagePulse, TINT_MAX_ALPHA, VIGNETTE_DECAY_MS, approach, decayed, matchupTarget, nearestFoeTint, suddenDeathLoss, tintStyle,
  type Matchup, type MatchupWorld,
} from "../src/ui/screenFeedback";

describe("damage vignette", () => {
  it("decays linearly to nothing over VIGNETTE_DECAY_MS", () => {
    expect(decayed(0.8, 0)).toBe(0.8);
    expect(decayed(0.8, VIGNETTE_DECAY_MS / 2)).toBeCloseTo(0.4, 9);
    expect(decayed(0.8, VIGNETTE_DECAY_MS)).toBe(0);
    expect(decayed(0.8, VIGNETTE_DECAY_MS * 3)).toBe(0);
    expect(decayed(0, 10)).toBe(0);
    expect(decayed(Number.NaN, 10)).toBe(0);
  });

  it("overlapping hits keep the stronger of what is left and what landed", () => {
    const p = new DamagePulse();
    p.hit(0.4, 1000);
    expect(p.value(1000)).toBeCloseTo(0.4, 9);
    // A weaker hit 100 ms later does not pull it down...
    p.hit(0.1, 1100);
    expect(p.value(1100)).toBeCloseTo(0.4 * (1 - 100 / VIGNETTE_DECAY_MS), 9);
    // ...a stronger one takes over and restarts the decay.
    p.hit(0.9, 1200);
    expect(p.value(1200)).toBeCloseTo(0.9, 9);
    expect(p.value(1200 + VIGNETTE_DECAY_MS)).toBe(0);
  });

  it("is fed by damageFlash, so damage over time and tiny hits leave it at 0", () => {
    const p = new DamagePulse();
    for (const [amount, sig] of [[500, "burn"], [500, "disease"], [500, "mark"], [1, undefined]] as const) {
      const s = damageFlash(amount, 700, sig);
      expect(s).toBe(0);
      if (s > 0) p.hit(s, 0);
    }
    expect(p.value(0)).toBe(0);
    expect(damageFlash(500, 700, "backlash")).toBeGreaterThan(0);
  });
});

describe("suddenDeathLoss", () => {
  const at = 100_000;
  const tickShare = TICK_MS / 1000;

  it("is 0 before sudden death is scheduled or started", () => {
    expect(suddenDeathLoss(1000, at + TICK_MS, 0)).toBe(0);
    // The tick that ended at `at` began before it.
    expect(suddenDeathLoss(1000, at, at)).toBe(0);
    expect(suddenDeathLoss(0, at + 5000, at)).toBe(0);
  });

  it("burns the start share of max hp per second in the first second, then ramps by whole seconds", () => {
    expect(suddenDeathLoss(1000, at + TICK_MS, at)).toBeCloseTo(1000 * SUDDEN_DEATH_START_FRACTION * tickShare, 9);
    expect(suddenDeathLoss(1000, at + TICK_MS + 999, at)).toBeCloseTo(1000 * SUDDEN_DEATH_START_FRACTION * tickShare, 9);
    expect(suddenDeathLoss(1000, at + TICK_MS + 1000, at))
      .toBeCloseTo(1000 * (SUDDEN_DEATH_START_FRACTION + SUDDEN_DEATH_RAMP_FRACTION) * tickShare, 9);
  });

  it("flashes only once the ramp makes a tick cost damageFlash's threshold (and never at the start)", () => {
    expect(damageFlash(suddenDeathLoss(700, at + TICK_MS, at), 700)).toBe(0);
    expect(damageFlash(suddenDeathLoss(700, at + 40_000, at), 700)).toBeGreaterThan(0);
  });
});

describe("tint easing and style", () => {
  it("approach moves toward the target without overshooting and lands on it", () => {
    let v = 0;
    let prev = 0;
    for (let i = 0; i < 100; i++) {
      v = approach(v, 0.8, 16);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(0.8);
      prev = v;
    }
    expect(v).toBe(0.8);
    expect(approach(0.5, 0.2, 0)).toBe(0.5);
  });

  it("approach is smooth across a 200 ms step (no single-frame jump)", () => {
    let v = 0;
    let biggest = 0;
    for (let t = 0; t < 600; t += 16) {
      const next = approach(v, 1, 16);
      biggest = Math.max(biggest, next - v);
      v = next;
    }
    expect(biggest).toBeLessThan(0.11);
  });

  it("tints green for a positive matchup and red for a negative one, up to TINT_MAX_ALPHA", () => {
    expect(tintStyle(1)).toEqual({ color: "rgb(70, 200, 90)", opacity: TINT_MAX_ALPHA });
    expect(tintStyle(-1)).toEqual({ color: "rgb(230, 50, 50)", opacity: TINT_MAX_ALPHA });
    expect(tintStyle(0).opacity).toBe(0);
    expect(tintStyle(-0.5).opacity).toBeCloseTo(TINT_MAX_ALPHA / 2, 9);
    expect(tintStyle(3).opacity).toBe(TINT_MAX_ALPHA);
  });
});

const fire = (x: number, y: number, weapon: WeaponId | null = null): Matchup => ({ x, y, faction: "fire", weapon });
const sentenced = (x: number, y: number, weapon: WeaponId | null = null): Matchup => ({ x, y, faction: "sentenced", weapon });
const plague = (x: number, y: number, weapon: WeaponId | null = null): Matchup => ({ x, y, faction: "plague", weapon });
const always = () => true;

describe("nearestFoeTint", () => {
  it("is 0 with no foes, out of range, or on a mirror", () => {
    expect(nearestFoeTint(fire(0, 0), [], always)).toBe(0);
    expect(nearestFoeTint(fire(0, 0), [sentenced(MATCHUP_RANGE + 1, 0)], always)).toBe(0);
    expect(nearestFoeTint(fire(0, 0), [fire(50, 0)], always)).toBe(0);
  });

  it("is green for a faction you beat and red for one that beats you, at half strength per point of score", () => {
    expect(nearestFoeTint(fire(0, 0), [sentenced(100, 0)], always)).toBeCloseTo(0.5, 9);
    expect(nearestFoeTint(sentenced(0, 0), [fire(100, 0)], always)).toBeCloseTo(-0.5, 9);
  });

  it("adds the weapon edge only when both hold a weapon", () => {
    // Fire beats Sentenced (+1); an axe beats a wand (+1) but means nothing against an empty hand.
    expect(nearestFoeTint(fire(0, 0, "axe"), [sentenced(100, 0, "wand")], always)).toBeCloseTo(1, 9);
    expect(nearestFoeTint(fire(0, 0, "axe"), [sentenced(100, 0, null)], always)).toBeCloseTo(0.5, 9);
    expect(nearestFoeTint(fire(0, 0, null), [sentenced(100, 0, "wand")], always)).toBeCloseTo(0.5, 9);
  });

  it("uses the nearest foe that can be seen, not the nearest one", () => {
    const near = sentenced(60, 0); // +1 for fire, but behind a wall
    const far = plague(200, 0, null); // fire beats plague too: +1
    const sees = (_a: Matchup, b: Matchup) => b !== near;
    expect(nearestFoeTint(fire(0, 0), [near, far], sees)).toBeCloseTo(matchupTint(1, 200), 9);
    // With both visible the nearer one wins.
    expect(nearestFoeTint(fire(0, 0), [far, near], always)).toBeCloseTo(0.5, 9);
  });

  it("fades with distance beyond MATCHUP_FULL_RANGE", () => {
    const close = nearestFoeTint(fire(0, 0), [sentenced(MATCHUP_FULL_RANGE, 0)], always);
    const mid = nearestFoeTint(fire(0, 0), [sentenced((MATCHUP_FULL_RANGE + MATCHUP_RANGE) / 2, 0)], always);
    expect(close).toBeCloseTo(0.5, 9);
    expect(mid).toBeCloseTo(0.25, 9);
  });

  it("only ray-casts foes closer than the best one so far", () => {
    const asked: Matchup[] = [];
    const foes = [sentenced(100, 0), sentenced(200, 0), sentenced(300, 0)];
    nearestFoeTint(fire(0, 0), foes, (_a, b) => { asked.push(b); return true; });
    expect(asked).toEqual([foes[0]]);
  });
});

describe("matchupTarget", () => {
  const W = 40;
  /** An open 40x40 arena with one wall column at tile x = 5 (blocking the way from x < 160 to x >= 192). */
  function arena(): GameMap {
    const tiles = new Uint8Array(W * W);
    for (let y = 0; y < W; y++) tiles[y * W + 5] = TILE_WALL;
    return mapFromTiles(W, W, tiles);
  }

  interface F { faction: string; weapon0: string; weapon1: string; slot: number; status: string; effects?: number }
  const fighter = (faction: string, weapon: string, status = "alive", effects?: number): F => ({
    faction, weapon0: weapon, weapon1: "", slot: 0, status, ...(effects !== undefined ? { effects } : {}),
  });

  function world(opts: { phase?: string; locked?: boolean; players: Record<string, F>; mobs?: Record<string, F> }): MatchupWorld {
    const players = new Map(Object.entries(opts.players));
    const mobs = new Map(Object.entries(opts.mobs ?? {}));
    return { phase: opts.phase ?? "active", gatesLocked: opts.locked ?? false, players, mobs };
  }
  const at = (m: Record<string, [number, number]>) => new Map(Object.entries(m).map(([k, [x, y]]) => [k, { x, y }]));

  it("tints against the nearest enemy player in sight", () => {
    const w = world({ players: { me: fighter("fire", "axe"), foe: fighter("sentenced", "wand") } });
    const t = matchupTarget(w, "me", at({ me: [100, 100], foe: [180 - TILE * 2, 100] }), arena());
    expect(t).toBeCloseTo(1, 9);
  });

  it("is blocked by walls on the client's map", () => {
    const w = world({ players: { me: fighter("fire", "axe"), foe: fighter("sentenced", "wand") } });
    expect(matchupTarget(w, "me", at({ me: [100, 100], foe: [230, 100] }), arena())).toBe(0);
  });

  it("is 0 when the local player is dead, absent, or the run is not active", () => {
    const players = { me: fighter("fire", "axe"), foe: fighter("sentenced", "wand") };
    const pos = at({ me: [100, 100], foe: [140, 100] });
    expect(matchupTarget(world({ players }), "me", pos, arena())).toBeGreaterThan(0);
    expect(matchupTarget(world({ players: { ...players, me: fighter("fire", "axe", "dead") } }), "me", pos, arena())).toBe(0);
    expect(matchupTarget(world({ players }), "ghost", pos, arena())).toBe(0);
    expect(matchupTarget(world({ players, phase: "lobby" }), "me", pos, arena())).toBe(0);
    expect(matchupTarget(world({ players, phase: "resolved" }), "me", pos, arena())).toBe(0);
    expect(matchupTarget(world({ players }), "me", pos, undefined)).toBe(0);
  });

  it("ignores dead players, factionless mobs and the local player itself, and counts mobs that have a faction", () => {
    const base = { me: fighter("fire", "axe") };
    const pos = at({ me: [100, 100], dead: [120, 100], dummy: [130, 100], goblin: [140, 100] });
    const w = world({
      players: { ...base, dead: fighter("sentenced", "wand", "dead") },
      mobs: { dummy: fighter("", "sword"), goblin: fighter("sentenced", "wand") },
    });
    expect(matchupTarget(w, "me", pos, arena())).toBeCloseTo(1, 9);
    expect(matchupTarget(world({ players: base, mobs: { dummy: fighter("", "sword") } }), "me", pos, arena())).toBe(0);
  });

  it("ignores a hidden or untargetable foe: the tint must not show that an enemy is near, or how near", () => {
    const pos = at({ me: [100, 100], foe: [180 - TILE * 2, 100] });
    const me = fighter("fire", "axe");
    const visible = world({ players: { me, foe: fighter("sentenced", "wand") } });
    expect(matchupTarget(visible, "me", pos, arena())).toBeGreaterThan(0);
    for (const effects of [EFFECT_HIDDEN, EFFECT_UNTARGETABLE, EFFECT_HIDDEN | EFFECT_STUNNED]) {
      const w = world({ players: { me, foe: fighter("sentenced", "wand", "alive", effects) } });
      expect(matchupTarget(w, "me", pos, arena()), `effects ${effects}`).toBe(0);
    }
    // Other statuses (a stun) do not hide anyone, and the next foe in sight still counts.
    const stunned = world({ players: { me, foe: fighter("sentenced", "wand", "alive", EFFECT_STUNNED) } });
    expect(matchupTarget(stunned, "me", pos, arena())).toBeGreaterThan(0);
    const two = world({ players: { me, hid: fighter("sentenced", "wand", "alive", EFFECT_HIDDEN), foe: fighter("sentenced", "wand") } });
    const both = at({ me: [100, 100], hid: [110, 100], foe: [180 - TILE * 2, 100] });
    expect(matchupTarget(two, "me", both, arena())).toBeCloseTo(1, 9);
  });
});
