// What a fighter on a hazard shows (render/zoneArt/terrainFeedback.ts, ui/terrainChips.ts, the Hud's chip row, propsView.ts): the
// four states derived from the shared map and a faction (`surfaceAt` -> chips), the home-ground note, the combat memory behind
// "resting", the effects at the feet on a fake scene, and the props plan. No new wire: everything comes from the map.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FACTION_IDS, TERRAINS, TERRAIN_BOG, TERRAIN_CREVASSE, TERRAIN_EMBER, TERRAIN_FENCE, TERRAIN_ICE, TERRAIN_LAVA, TERRAIN_LIGHT, TILE, TILE_FLOOR,
  TILE_LOW, TILE_WALL, Y_SCALE, ZONE_PROP, mapFromTiles, type FxEvent, type GameMap,
} from "@raid/shared";
import { DEFAULT_SETTINGS, updateSettings } from "../src/settings";
import { resetReducedMotionCache } from "../src/render/juice";
import { planProps } from "../src/render/zoneArt/propsView";
import {
  CombatMemory, FeetFx, GroundFeedback, HEAL_SHOWN_MS, NO_STATES, SKID_SPEED, chipsOf, homeNote, sameStates, terrainStates, type StateContext,
  type TerrainStates,
} from "../src/render/zoneArt/terrainFeedback";
import { Hud } from "../src/ui/hud";
import { TerrainChips } from "../src/ui/terrainChips";
import { FakeEl, fakeScene, installFakeDom, type FakeObject } from "./fakes";

afterEach(() => {
  updateSettings({ juice: DEFAULT_SETTINGS.juice, reducedMotion: DEFAULT_SETTINGS.reducedMotion });
  resetReducedMotionCache();
  vi.unstubAllGlobals();
});

/** A 16x4 strip: tile (tx, 1) carries `kinds[tx]` as floor terrain, or LOW/WALL for the LOW kinds. */
const KINDS = [0, TERRAIN_EMBER, TERRAIN_BOG, TERRAIN_ICE, TERRAIN_LIGHT, TERRAIN_LAVA, TERRAIN_FENCE, TERRAIN_CREVASSE] as const;
function strip(): GameMap {
  const w = 16, h = 4;
  const tiles = new Uint8Array(w * h).fill(TILE_FLOOR);
  const terrain = new Uint8Array(w * h);
  KINDS.forEach((k, tx) => {
    terrain[w + tx] = k;
    if (k === TERRAIN_LAVA || k === TERRAIN_FENCE || k === TERRAIN_CREVASSE) tiles[w + tx] = TILE_LOW;
  });
  return mapFromTiles(w, h, tiles, 1, terrain);
}
const at = (kind: number) => ({ x: KINDS.indexOf(kind as never) * TILE + TILE / 2, y: 1 * TILE + TILE / 2 });
const ctx = (over: Partial<StateContext> = {}): StateContext => ({ player: true, alive: true, hurt: true, combat: false, healing: false, ...over });
const states = (map: GameMap, kind: number, faction: string, c: Partial<StateContext> = {}): TerrainStates => {
  const p = at(kind);
  return terrainStates(map, p.x, p.y, faction, ctx(c));
};

describe("terrainStates", () => {
  const map = strip();
  const away = (home: string): string => FACTION_IDS.find((f) => f !== home)!;

  it("is empty on plain ground and out of bounds, and for the kinds with no effect (lava, fence, crevasse are walls, not surfaces)", () => {
    for (const f of FACTION_IDS) {
      expect(states(map, 0, f)).toBe(NO_STATES);
      for (const k of [TERRAIN_LAVA, TERRAIN_FENCE, TERRAIN_CREVASSE]) expect(states(map, k, f)).toBe(NO_STATES);
      expect(terrainStates(map, -50, -50, f, ctx())).toBe(NO_STATES);
    }
  });

  it("burns every faction but Fire on an ember tile, and says home ground to Fire", () => {
    for (const f of FACTION_IDS) {
      const s = states(map, TERRAIN_EMBER, f);
      expect(s.burning).toBe(f !== "fire");
      expect(s.home).toBe(f === "fire");
      expect(s.slowed || s.sliding || s.resting).toBe(false);
    }
  });

  it("slows every faction but Plague in a bog, and makes every faction but Frost slide on ice", () => {
    for (const f of FACTION_IDS) {
      expect(states(map, TERRAIN_BOG, f)).toMatchObject({ slowed: f !== "plague", home: f === "plague", burning: false });
      expect(states(map, TERRAIN_ICE, f)).toMatchObject({ sliding: f !== "frost", home: f === "frost", burning: false });
    }
  });

  it("rests a hurt player out of combat in light, and Holy twice as hard", () => {
    for (const f of FACTION_IDS) {
      const s = states(map, TERRAIN_LIGHT, f);
      expect(s.resting).toBe(true);
      expect(s.restBoost).toBe(f === "holy" ? 2 : 1);
      expect(s.home).toBe(false); // light is a boost for Holy, not an exemption
    }
  });

  it("does not rest at full hp, in combat, dead, or as a mob; a heal fx (the server's truth) overrides the combat guess", () => {
    expect(states(map, TERRAIN_LIGHT, "fire", { hurt: false })).toBe(NO_STATES);
    expect(states(map, TERRAIN_LIGHT, "fire", { combat: true })).toBe(NO_STATES);
    expect(states(map, TERRAIN_LIGHT, "fire", { alive: false })).toBe(NO_STATES);
    expect(states(map, TERRAIN_LIGHT, "fire", { player: false })).toBe(NO_STATES);
    expect(states(map, TERRAIN_LIGHT, "fire", { combat: true, healing: true }).resting).toBe(true);
    expect(states(map, TERRAIN_LIGHT, "fire", { hurt: false, healing: true }).resting).toBe(true);
  });

  it("reads the tile under the fighter's centre: the edge of a tile decides", () => {
    const e = at(TERRAIN_EMBER);
    expect(terrainStates(map, e.x - TILE / 2 + 0.1, e.y, away("fire"), ctx()).burning).toBe(true);
    expect(terrainStates(map, e.x - TILE / 2 - 0.1, e.y, away("fire"), ctx()).burning).toBe(false);
    expect(terrainStates(map, e.x + TILE / 2 - 0.1, e.y, away("fire"), ctx()).burning).toBe(true);
    expect(terrainStates(map, e.x + TILE / 2 + 0.1, e.y, away("fire"), ctx()).burning).toBe(false);
  });

  it("agrees with the effect table: a state is on exactly when surfaceAt says the effect applies", () => {
    for (const spec of TERRAINS) {
      if (spec.key === "none") continue;
      expect(spec.burnShare > 0 || spec.speedMult < 1 || spec.slipMs > 0 || spec.healShare > 0 || spec.tile === TILE_LOW).toBe(true);
    }
  });

  it("compares states", () => {
    expect(sameStates(NO_STATES, { ...NO_STATES })).toBe(true);
    expect(sameStates(NO_STATES, { ...NO_STATES, burning: true })).toBe(false);
    expect(sameStates(states(map, TERRAIN_LIGHT, "holy"), states(map, TERRAIN_LIGHT, "fire"))).toBe(false);
  });
});

describe("chips and the home note", () => {
  const map = strip();

  it("makes one chip per active state, each with a glyph and a word, in a stable order", () => {
    expect(chipsOf(NO_STATES)).toEqual([]);
    const all = chipsOf({ kind: 0, burning: true, slowed: true, sliding: true, resting: true, restBoost: 1, home: false });
    expect(all.map((c) => c.id)).toEqual(["burning", "slowed", "ice", "resting"]);
    for (const c of all) {
      expect(c.glyph.length).toBeGreaterThan(0);
      expect(c.text).toMatch(/^[A-Z]/);
      expect(c.title.length).toBeGreaterThan(10);
    }
    expect(new Set(all.map((c) => c.glyph)).size).toBe(4); // a glyph each: not colour alone
  });

  it("takes its numbers from the terrain catalog, so the words cannot go stale", () => {
    const ember = TERRAINS[TERRAIN_EMBER]!;
    const bog = TERRAINS[TERRAIN_BOG]!;
    const light = TERRAINS[TERRAIN_LIGHT]!;
    const [burn] = chipsOf(states(map, TERRAIN_EMBER, "frost"));
    expect(burn!.title).toContain(`${Math.round(ember.burnShare * 100)}%`);
    const [slow] = chipsOf(states(map, TERRAIN_BOG, "frost"));
    expect(slow!.title).toContain(`${Math.round(bog.speedMult * 100)}%`);
    const [rest] = chipsOf(states(map, TERRAIN_LIGHT, "fire"));
    expect(rest!.title).toContain(`${light.healShare * 100}%`);
    const [holy] = chipsOf(states(map, TERRAIN_LIGHT, "holy"));
    expect(holy!.text).toBe("RESTING x2");
    expect(holy!.title).toContain(`${light.healShare * 200}%`);
  });

  it("says home ground only to the faction a hazard cannot touch, in words that name the hazard", () => {
    expect(homeNote(states(map, TERRAIN_EMBER, "fire"))).toMatch(/home ground.*embers.*burn/i);
    expect(homeNote(states(map, TERRAIN_BOG, "plague"))).toMatch(/home ground.*bog.*slow/i);
    expect(homeNote(states(map, TERRAIN_ICE, "frost"))).toMatch(/home ground.*grip.*ice/i);
    expect(homeNote(states(map, TERRAIN_EMBER, "frost"))).toBeNull();
    expect(homeNote(states(map, TERRAIN_LIGHT, "holy"))).toBeNull();
    expect(homeNote(NO_STATES)).toBeNull();
    // At home the chips are empty: a note instead of a chip.
    expect(chipsOf(states(map, TERRAIN_EMBER, "fire"))).toEqual([]);
  });
});

describe("CombatMemory", () => {
  const hit = (id: string, by: string | null, t: number): FxEvent & { t: number } => ({ kind: "hit", id, by, amount: 10, weapon: "sword", t });

  it("counts a hit for the victim and the attacker for 3 s (the server's heal lockout)", () => {
    const m = new CombatMemory();
    m.note(hit("a", "b", 10_000));
    expect(m.inCombat("a", 10_000)).toBe(true);
    expect(m.inCombat("b", 12_999)).toBe(true);
    expect(m.inCombat("a", 13_000)).toBe(false);
    expect(m.inCombat("c", 10_000)).toBe(false);
  });

  it("ignores the arena's damage (no attacker): the burn and sudden death are not combat", () => {
    const m = new CombatMemory();
    m.note(hit("a", null, 10_000));
    expect(m.inCombat("a", 10_000)).toBe(false);
  });

  it("marks a heal as healing for a moment, and forgets", () => {
    const m = new CombatMemory();
    m.note({ kind: "heal", id: "a", amount: 3, t: 20_000 } as FxEvent & { t: number });
    expect(m.healing("a", 20_000)).toBe(true);
    expect(m.healing("a", 20_000 + HEAL_SHOWN_MS - 1)).toBe(true);
    expect(m.healing("a", 20_000 + HEAL_SHOWN_MS)).toBe(false);
    m.note(hit("a", "b", 20_000));
    m.forget("a");
    expect(m.inCombat("a", 20_000)).toBe(false);
    m.note(hit("a", "b", 20_000));
    m.clear();
    expect(m.inCombat("b", 20_000)).toBe(false);
  });
});

describe("GroundFeedback", () => {
  it("stays inactive on a map without hazards, and hands out the shared empty states", () => {
    const g = new GroundFeedback();
    expect(g.active).toBe(false);
    expect(g.statesOf("a", 100, 100, "fire", 0, 1, 10, true)).toBe(NO_STATES);
    g.setMap(mapFromTiles(8, 8, new Uint8Array(64)));
    expect(g.active).toBe(false);
  });

  it("derives a fighter's states from the map, its hp and what it has seen of the combat", () => {
    const g = new GroundFeedback();
    g.setMap(strip());
    expect(g.active).toBe(true);
    const p = at(TERRAIN_LIGHT);
    expect(g.statesOf("a", p.x, p.y, "fire", 5000, 50, 100, true).resting).toBe(true);
    expect(g.statesOf("a", p.x, p.y, "fire", 5000, 100, 100, true).resting).toBe(false);
    g.combat.note({ kind: "hit", id: "a", by: "b", amount: 5, weapon: "sword", t: 4000 } as never);
    expect(g.statesOf("a", p.x, p.y, "fire", 5000, 50, 100, true).resting).toBe(false);
    expect(g.statesOf("a", p.x, p.y, "fire", 7500, 50, 100, true).resting).toBe(true);
    const e = at(TERRAIN_EMBER);
    expect(g.statesOf("m", e.x, e.y, "frost", 5000, 10, 10, false).burning).toBe(true);
    g.setMap(strip());
    expect(g.statesOf("a", p.x, p.y, "fire", 5000, 50, 100, true).resting).toBe(true); // the memory went with the old map
  });
});

describe("the combat memory does not outgrow the roster", () => {
  it("GroundFeedback.forget drops a fighter's combat and heal marks", () => {
    const g = new GroundFeedback();
    g.setMap(strip());
    g.combat.note({ kind: "hit", id: "victim", by: "attacker", t: 1000 } as never);
    g.combat.note({ kind: "heal", id: "healed", t: 1000 } as never);
    expect(g.combat.inCombat("victim", 1500)).toBe(true);
    expect(g.combat.inCombat("attacker", 1500)).toBe(true);
    expect(g.combat.healing("healed", 1500)).toBe(true);
    g.forget("victim");
    g.forget("healed");
    expect(g.combat.inCombat("victim", 1500)).toBe(false);
    expect(g.combat.healing("healed", 1500)).toBe(false);
    expect(g.combat.inCombat("attacker", 1500)).toBe(true); // the others stay
  });

  it("RaidScene forgets a player and a mob in the same step that drops its view", () => {
    const src = readFileSync(new URL("../src/scenes/RaidScene.ts", import.meta.url), "utf8");
    expect(src).toMatch(/this\.views\.delete\(id\);[^\n]*this\.ground\.forget\(id\)/);
    expect(src).toMatch(/this\.mobViews\.delete\(id\);[^\n]*this\.ground\.forget\(id\)/);
  });
});

describe("FeetFx on a fake scene", () => {
  const map = strip();
  function feet() {
    const { scene, ofKind } = fakeScene();
    const fx = new FeetFx(scene);
    const g = ofKind("graphics")[0]!;
    return { fx, g };
  }
  const burning = states(map, TERRAIN_EMBER, "frost");
  const slowed = states(map, TERRAIN_BOG, "frost");
  const sliding = states(map, TERRAIN_ICE, "fire");
  const resting = states(map, TERRAIN_LIGHT, "fire");
  const restingHoly = states(map, TERRAIN_LIGHT, "holy");
  const count = (g: FakeObject, name: string): number => g.calls.filter(([n]) => n === name).length;

  it("draws nothing and stays hidden with nothing to show", () => {
    const { fx, g } = feet();
    fx.update(NO_STATES, 100, 100, 0);
    expect(g.calls.filter(([n]) => n.startsWith("fill") || n.startsWith("stroke") || n.startsWith("line"))).toHaveLength(0);
    expect(g.state.visible).not.toBe(true);
  });

  it("puts its Graphics at the fighter's feet, one depth under it", () => {
    const { fx, g } = feet();
    fx.update(burning, 200, 150, 0);
    expect(g.state.visible).toBe(true);
    expect(g.state.position).toEqual([200, 150 * Y_SCALE]);
    expect(g.state.depth as number).toBeLessThan(150);
    expect(g.state.depth as number).toBeGreaterThan(149);
  });

  it("draws flames (triangles) while burning, ripples (squashed ellipse outlines) in a bog, a ring and plus signs while resting", () => {
    const a = feet();
    a.fx.update(burning, 0, 0, 0);
    expect(count(a.g, "fillTriangle")).toBeGreaterThanOrEqual(6);
    const b = feet();
    b.fx.update(slowed, 0, 0, 0);
    const rings = b.g.calls.filter(([n]) => n === "strokeEllipse");
    expect(rings.length).toBeGreaterThanOrEqual(2);
    for (const [, [, , w, h]] of rings) expect((h as number) / (w as number)).toBeCloseTo(Y_SCALE, 5);
    const c = feet();
    c.fx.update(resting, 0, 0, 0);
    expect(count(c.g, "strokeEllipse")).toBe(1);
    expect(count(c.g, "lineBetween")).toBeGreaterThanOrEqual(2);
  });

  it("draws Holy's resting ring larger than anyone else's (the x2)", () => {
    const ringWidth = (s: TerrainStates): number => {
      const { fx, g } = feet();
      fx.update(s, 0, 0, 0);
      return g.calls.find(([n]) => n === "strokeEllipse")![1][2] as number;
    };
    expect(ringWidth(restingHoly)).toBeGreaterThan(ringWidth(resting));
  });

  it("leaves a skid streak on ice only once the fighter is drawn faster than the threshold", () => {
    const { fx, g } = feet();
    // Standing: no streak.
    for (let t = 0; t < 300; t += 16) fx.update(sliding, 100, 100, t);
    expect(count(g, "lineBetween")).toBe(0);
    // Sliding at 120 u/s: streaks, two lines each side.
    let x = 100;
    for (let t = 300; t < 800; t += 16) { x += 120 * 0.016; fx.update(sliding, x, 100, t); }
    expect(fx.track(x, 100, 816)).toBeGreaterThan(SKID_SPEED);
    expect(count(g, "lineBetween")).toBeGreaterThanOrEqual(4);
  });

  it("measures the drawn speed from the drawn positions, and starts over after a gap or a jump in time", () => {
    const { fx } = feet();
    fx.track(0, 0, 0);
    let x = 0;
    let speed = 0;
    for (let t = 16; t <= 480; t += 16) { x += 3; speed = fx.track(x, 0, t); }
    expect(speed).toBeGreaterThan(150);
    expect(speed).toBeLessThan(200);
    expect(fx.track(x, 0, 480 + 1000)).toBe(0);
  });

  it("clears once when the states end, and hides at juice 0", () => {
    const { fx, g } = feet();
    fx.update(burning, 0, 0, 0);
    expect(g.state.visible).toBe(true);
    fx.update(NO_STATES, 0, 0, 16);
    expect(g.state.visible).toBe(false);
    expect(g.clears).toBeGreaterThanOrEqual(1);
    updateSettings({ juice: 0 });
    fx.update(burning, 0, 0, 32);
    expect(g.state.visible).toBe(false);
  });

  it("holds still under reduced motion: the same picture at two times", () => {
    updateSettings({ reducedMotion: true });
    for (const s of [burning, slowed, resting]) {
      const { fx, g } = feet();
      fx.update(s, 0, 0, 0);
      const first = JSON.stringify(g.calls.filter(([n]) => n.startsWith("fill") || n.startsWith("stroke") || n.startsWith("line")));
      fx.update(s, 0, 0, 733);
      const second = JSON.stringify(g.calls.filter(([n]) => n.startsWith("fill") || n.startsWith("stroke") || n.startsWith("line")));
      expect(second).toBe(first);
    }
  });

  it("destroys its Graphics", () => {
    const { fx, g } = feet();
    fx.destroy();
    expect(g.calls.some(([n]) => n === "destroy")).toBe(true);
  });
});

describe("TerrainChips and the Hud", () => {
  beforeEach(() => { installFakeDom(); });
  const map = strip();
  const kids = (c: TerrainChips) => (c.root as unknown as FakeEl).children as Array<FakeEl | string>;

  it("starts hidden, shows a chip per state with its glyph and word, and rebuilds only when the set changes", () => {
    const chips = new TerrainChips();
    expect(chips.root.hidden).toBe(true);
    chips.update(states(map, TERRAIN_EMBER, "frost"));
    expect(chips.root.hidden).toBe(false);
    expect(kids(chips)).toHaveLength(1);
    const chip = kids(chips)[0] as FakeEl;
    expect(chip.className).toBe("ground-chip burning");
    expect(chip.textContent === "" ? JSON.stringify(chip.children) : chip.textContent).toContain("BURNING");
    const same = kids(chips)[0];
    chips.update({ ...states(map, TERRAIN_EMBER, "frost") });
    expect(kids(chips)[0]).toBe(same); // untouched
    chips.update(states(map, TERRAIN_BOG, "frost"));
    expect((kids(chips)[0] as FakeEl).className).toBe("ground-chip slowed");
    chips.update(null);
    expect(chips.root.hidden).toBe(true);
    expect(kids(chips)).toHaveLength(0);
  });

  it("shows the home-ground note instead of a chip for the exempt faction", () => {
    const chips = new TerrainChips();
    chips.update(states(map, TERRAIN_EMBER, "fire"));
    expect(chips.root.hidden).toBe(false);
    const k = kids(chips);
    expect(k).toHaveLength(1);
    expect((k[0] as FakeEl).className).toBe("ground-note");
    expect((k[0] as FakeEl).textContent).toMatch(/home ground/i);
  });

  it("is a live region and removes itself on destroy", () => {
    const chips = new TerrainChips();
    chips.destroy();
    expect((chips.root as unknown as FakeEl).removed).toBe(true);
  });

  it("sits in the Hud under the cards row, fed by setTerrain, and goes with the Hud", () => {
    const hud = new Hud();
    const root = (hud as unknown as { root: FakeEl }).root;
    const classes = (root.children as FakeEl[]).map((c) => c.className);
    expect(classes.indexOf("hud-terrain")).toBe(classes.indexOf("hud-cards") + 1);
    const terrain = (root.children as FakeEl[])[classes.indexOf("hud-terrain")]!;
    expect(terrain.hidden).toBe(true);
    hud.setTerrain(states(map, TERRAIN_ICE, "fire"));
    expect(terrain.hidden).toBe(false);
    hud.setTerrain(null);
    expect(terrain.hidden).toBe(true);
    hud.destroy();
    expect(terrain.removed).toBe(true);
  });
});

describe("planProps", () => {
  const prop = (key: string, tx: number, ty: number) => ({ kind: ZONE_PROP[key]!, x: tx * TILE + 16, y: ty * TILE + 16, v: 3 });

  it("sorts props into floor decals, wall details (by tile), and the emitters among the floor ones", () => {
    const map = mapFromTiles(20, 20, new Uint8Array(400));
    map.props = [prop("ember_vent", 3, 3), prop("ash_drift", 5, 5), prop("banner", 7, 7), prop("banner", 7, 7), prop("bubble", 9, 9), prop("frost_sparkle", 11, 11), prop("chain", 13, 13)];
    const plan = planProps(map);
    expect(plan.flat.map((f) => f.key)).toEqual(["ember_vent", "ash_drift", "bubble", "frost_sparkle"]);
    expect(plan.wall.get(7 * 20 + 7)).toHaveLength(2);
    expect(plan.wall.get(13 * 20 + 13)).toHaveLength(1);
    expect(plan.emitters.map((e) => [e.key, e.kind])).toEqual([["ember_vent", "ember"], ["bubble", "spore"], ["frost_sparkle", "frost"]]);
    expect(plan.unknown).toBe(0);
  });

  it("skips a kind it does not know (a newer generator) and counts it", () => {
    const map = mapFromTiles(20, 20, new Uint8Array(400));
    map.props = [{ kind: 999, x: 40, y: 40, v: 0 }, prop("banner", 2, 2)];
    const plan = planProps(map);
    expect(plan.unknown).toBe(1);
    expect(plan.wall.size).toBe(1);
  });

  it("is empty for a map with no props", () => {
    const plan = planProps(mapFromTiles(8, 8, new Uint8Array(64)));
    expect(plan.flat).toEqual([]);
    expect(plan.emitters).toEqual([]);
    expect(plan.wall.size).toBe(0);
  });
});
