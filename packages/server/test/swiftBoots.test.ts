// Swift Boots, owner ruling "No boost while shooting" (testing/TUNING_ROGUE.md section 7.5): its move-speed bonus (x1.06 at rank 1,
// x1.10 at rank 2) is OFF from the moment a bow or wand attack starts until SWIFT_BOOTS_PAUSE_MS after the shot leaves, and on
// otherwise, for walking, chasing and melee. It is a stepped `while notShooting` row, so the `speedMult` mirror (the only thing
// the client's prediction reads) patches when the window opens and when it closes, and the walk the sim simulates is exactly the
// multiplier the mirror carries.
import { describe, expect, it } from "vitest";
import {
  decodeMult, encodeMult, mapFromTiles, mulberry32, PLAYER_SPEED, skillRows, skillText, SWIFT_BOOTS_PAUSE_MS, TICK_MS, TILE,
  TILE_FLOOR, TILE_WALL, type FactionId, type GameMap, type SkillId, type WeaponId,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { grantSkill } from "../src/sim/chests";
import { runDuel } from "../src/harness/duel";
import { combatant, type Combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { addPlayer, step } from "../src/sim/step";
import type { World } from "../src/sim/world";

const W_TILES = 40;
const H_TILES = 20;
const tileCentre = (t: number): number => t * TILE + TILE / 2;

function openMap(): GameMap {
  const tiles = new Uint8Array(W_TILES * H_TILES).fill(TILE_FLOOR);
  for (let tx = 0; tx < W_TILES; tx++) { tiles[tx] = TILE_WALL; tiles[(H_TILES - 1) * W_TILES + tx] = TILE_WALL; }
  for (let ty = 0; ty < H_TILES; ty++) { tiles[ty * W_TILES] = TILE_WALL; tiles[ty * W_TILES + W_TILES - 1] = TILE_WALL; }
  const spawns = Array.from({ length: 8 }, (_, i) => ({ x: tileCentre(3 + 3 * i), y: tileCentre(10) }));
  return { ...mapFromTiles(W_TILES, H_TILES, tiles), spawns };
}

/** p0 of `faction` holding Swift Boots at `rank` in an active run, p1 a bystander parked far away (out of every line of fire). */
function startRun(faction: FactionId, rank: 0 | 1 | 2): World {
  const world = createGameWorld({
    seed: 5,
    config: { minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600 },
    random: mulberry32(6),
    map: openMap(),
  }, { signatures: false });
  addPlayer(world, "p0", "name0", { faction });
  addPlayer(world, "p1", "name1", { faction: "frost" });
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  const p1 = world.state.players.get("p1")!;
  p1.x = tileCentre(36);
  p1.y = tileCentre(3);
  for (let r = 1; r <= rank; r++) expect(grantSkill(world, C(world), "swiftBoots" as SkillId)).toBe(r);
  return world;
}

const P = (w: World): PlayerState => w.state.players.get("p0")!;
const RT = (w: World) => w.players.get("p0")!;
const C = (w: World): Extract<Combatant, { kind: "player" }> => combatant(w, "p0")! as Extract<Combatant, { kind: "player" }>;
const ON = (rank: 1 | 2): number => encodeMult(1 + skillRows("swiftBoots", rank).map((e) => (e.k === "while" ? e.v : 0))[0]!);
const OFF = encodeMult(1);

function arm(w: World, weapon: WeaponId): void {
  const p = P(w);
  p.weapon0 = weapon;
  p.weapon1 = "";
  p.slot = 0;
}

/** Presses the trigger once (the attack starts in the next step). */
function press(w: World): void {
  enqueueClientMessage(RT(w).inputs, "attack", { a: 0 });
  enqueueClientMessage(RT(w).inputs, "release", { a: 0 });
}

describe("Swift Boots' rows", () => {
  it("are a `notShooting` while row of +6% / +10% move speed with the pause, and say so on the card", () => {
    expect(SWIFT_BOOTS_PAUSE_MS).toBeGreaterThan(0);
    expect(skillRows("swiftBoots", 1)).toEqual([{ k: "while", cond: "notShooting", arg: 0, stat: "moveSpeed", v: 0.06, ms: SWIFT_BOOTS_PAUSE_MS }]);
    expect(skillRows("swiftBoots", 2)).toEqual([{ k: "while", cond: "notShooting", arg: 0, stat: "moveSpeed", v: 0.1, ms: SWIFT_BOOTS_PAUSE_MS }]);
    expect(skillText("swiftBoots", 1)).toBe(`+6% move speed, but not while you shoot or for ${SWIFT_BOOTS_PAUSE_MS / 1000} s after a bow or wand shot`);
  });
});

describe("the boots' bonus around a bow or wand shot", () => {
  for (const rank of [1, 2] as const) {
    for (const [weapon, faction] of [["bow", "frost"], ["wand", "fire"]] as const) {
      it(`${weapon}, rank ${rank}: on at rest, off from the tick the attack starts, back on exactly the pause after the shot left`, () => {
        const w = startRun(faction, rank);
        arm(w, weapon);
        expect(P(w).speedMult).toBe(ON(rank));
        press(w);
        step(w, TICK_MS); // the attack starts; the mirror is refolded at the end of this same tick
        expect(RT(w).weapon.action, "winding up").not.toBeNull();
        expect(P(w).speedMult).toBe(OFF);
        const rt = RT(w).weapon;
        let landedAt = -1;
        let backAt = -1;
        let wasOff = true;
        for (let i = 0; i < 120 && backAt < 0; i++) {
          step(w, TICK_MS);
          if (landedAt < 0 && rt.lastShotAt > -Infinity) landedAt = rt.lastShotAt;
          if (P(w).speedMult === ON(rank)) backAt = w.state.serverTime;
          else wasOff &&= P(w).speedMult === OFF;
        }
        expect(landedAt, "the shot left").toBeGreaterThan(0);
        expect(wasOff, "off for the whole windup and the pause").toBe(true);
        expect(backAt - landedAt, "the pause, counted from the shot").toBe(SWIFT_BOOTS_PAUSE_MS);
        expect(rt.action).toBeNull();
      });
    }
  }

  it("holding the trigger keeps it off through a whole bout of shooting: one patch off, one back on", () => {
    const w = startRun("frost", 2);
    arm(w, "bow");
    enqueueClientMessage(RT(w).inputs, "attack", { a: 0 });
    const seen: number[] = [P(w).speedMult];
    let shots = 0;
    let last = -Infinity;
    for (let i = 0; i < 120; i++) { // 6 s: five bow shots
      step(w, TICK_MS);
      if (RT(w).weapon.lastShotAt !== last) { last = RT(w).weapon.lastShotAt; shots++; }
      if (P(w).speedMult !== seen.at(-1)) seen.push(P(w).speedMult);
    }
    expect(shots).toBeGreaterThanOrEqual(4);
    expect(seen).toEqual([ON(2), OFF]);
    enqueueClientMessage(RT(w).inputs, "release", { a: 0 });
    for (let i = 0; i < 100; i++) {
      step(w, TICK_MS);
      if (P(w).speedMult !== seen.at(-1)) seen.push(P(w).speedMult);
    }
    expect(seen).toEqual([ON(2), OFF, ON(2)]);
  });

  it("a windup that is cancelled never shoots, so it leaves no pause: the bonus is back the tick after", () => {
    const w = startRun("fire", 1);
    arm(w, "wand");
    P(w).weapon1 = "sword";
    press(w);
    step(w, TICK_MS);
    expect(P(w).speedMult).toBe(OFF);
    step(w, TICK_MS);
    expect(RT(w).weapon.action).not.toBeNull();
    expect(P(w).speedMult).toBe(OFF);
    enqueueClientMessage(RT(w).inputs, "swap", {});
    step(w, TICK_MS); // the swap cancels the cast; no ball leaves
    expect(RT(w).weapon.action).toBeNull();
    expect(RT(w).weapon.lastShotAt).toBe(-Infinity);
    expect(P(w).speedMult).toBe(ON(1));
    expect(w.projectiles.size).toBe(0);
  });

  it("a melee swing never turns it off, not the sword's, the bash's nor the axe's", () => {
    for (const weapon of ["sword", "shield", "axe"] as const) {
      const w = startRun("fire", 2);
      arm(w, weapon);
      enqueueClientMessage(RT(w).inputs, "attack", { a: 0 });
      let swings = 0;
      for (let i = 0; i < 60; i++) {
        const before = RT(w).weapon.action;
        step(w, TICK_MS);
        if (before === null && RT(w).weapon.action !== null) swings++;
        expect(P(w).speedMult, `${weapon} tick ${i}`).toBe(ON(2));
      }
      expect(swings, weapon).toBeGreaterThan(2);
    }
  });
});

describe("the walk is the mirror, tick by tick", () => {
  it("what the sim moves per tick is the speedMult the client reads: x1 inside the window, the bonus outside it", () => {
    for (const rank of [1, 2] as const) {
      const w = startRun("frost", rank);
      arm(w, "bow");
      const rt = RT(w);
      press(w);
      rt.path = [{ x: P(w).x + 800, y: P(w).y }]; // a directional windup keeps the walk and takes it up once the arrow has left
      const seen = { inside: 0, outside: 0 };
      let lastX = P(w).x;
      for (let i = 0; i < 80; i++) {
        const mirror = decodeMult(P(w).speedMult); // the value the movement of this tick reads (it is refolded at the tick's end)
        step(w, TICK_MS);
        const moved = P(w).x - lastX;
        lastX = P(w).x;
        if (moved <= 0) continue; // rooted
        const ratio = moved / (PLAYER_SPEED * (TICK_MS / 1000));
        expect(ratio, `rank ${rank} tick ${i}`).toBeCloseTo(mirror, 9);
        if (mirror === 1) seen.inside++; else seen.outside++;
      }
      expect(seen.inside, "walked inside the pause").toBeGreaterThan(0);
      expect(seen.outside, "walked with the bonus after it").toBeGreaterThan(0);
      // The pause is whole ticks of unboosted walking (the refold lags the condition by the one tick of updateMods).
      expect(Math.abs(seen.inside * TICK_MS - SWIFT_BOOTS_PAUSE_MS)).toBeLessThanOrEqual(TICK_MS);
    }
  });
});

describe("the harness measures the shipped passive", () => {
  it("--shooter-skill swiftBoots grants the real rank, so the pause is part of every kiting measurement", () => {
    let seen = 0;
    runDuel({
      faction: "fire", weapons: ["sword", "wand"], distance: 200, capSeconds: 4, seed: 3,
      skills: [undefined, [{ id: "swiftBoots" as SkillId, rank: 2 }]],
      locks: [false, true],
      onTick: (world) => {
        const shooter = world.state.players.get("f1")!;
        const chaser = world.state.players.get("f0")!;
        expect(shooter.build.get("swiftBoots")).toBe(2);
        expect(chaser.speedMult).toBe(1000);
        const shooting = world.players.get("f1")!.weapon.action !== null;
        if (shooting) { expect(shooter.speedMult).toBe(1000); seen++; }
      },
    });
    expect(seen).toBeGreaterThan(0);
  });
});
