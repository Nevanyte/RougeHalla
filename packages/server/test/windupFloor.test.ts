// "Floor the windup" (owner ruling, testing/TUNING_ROGUE.md section 7): a windup mod below 1 (Quickdraw, windupMult 0.92 and
// 0.88) shortens the ranged windups only down to min(windup, floor): the bow's 0.55 s, the wand's whole 0.4 s. The sim reads
// the same shared scaleWindup as the client's bow gauge (timingsOf), so these tests read the sim's own attack: the landing
// time an attack records when it starts. Melee windups are not part of the lever and scale freely.
import { describe, expect, it } from "vitest";
import {
  attackInterval, BOW_WINDUP, BOW_WINDUP_FLOOR, decodeMult, encodeMult, FACTION_IDS, FACTIONS, mapFromTiles, mulberry32,
  TICK_MS, TILE, TILE_FLOOR, TILE_WALL, WAND_WINDUP, WAND_WINDUP_FLOOR, weaponTimings, type FactionId, type GameMap, type SkillId,
  type WeaponId,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { grantSkill } from "../src/sim/chests";
import { runDuel } from "../src/harness/duel";
import { shooterBuffText } from "../src/harness/kiting";
import { combatant, timingsOf, type Combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { recomputeMods } from "../src/sim/mods";
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

/** Two players in an active run: p0 of `faction` (the one under test), p1 a Frost bystander out of range. */
function startRun(faction: FactionId): World {
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
  return world;
}

const P = (w: World): PlayerState => w.state.players.get("p0")!;
const C = (w: World): Extract<Combatant, { kind: "player" }> => combatant(w, "p0")! as Extract<Combatant, { kind: "player" }>;

function quickdraw(w: World, rank: 0 | 1 | 2): void {
  for (let r = 1; r <= rank; r++) expect(grantSkill(w, C(w), "quickdraw" as SkillId)).toBe(r);
}

/** Holds `weapon`, presses once and returns the windup the sim recorded for that attack, in ms (landsAt - startedAt). */
function windupMs(w: World, weapon: WeaponId): number {
  const p = P(w);
  p.weapon0 = weapon;
  p.weapon1 = "";
  p.slot = 0;
  expect(enqueueClientMessage(w.players.get("p0")!.inputs, "attack", { a: 0 })).toBe(true);
  step(w, TICK_MS);
  const act = w.players.get("p0")!.weapon.action;
  expect(act, `${weapon} started an attack`).not.toBeNull();
  return act!.landsAt - act!.startedAt;
}

describe("a bow with Quickdraw", () => {
  it("draws the full 0.6 s without it, 0.552 s at rank 1 and exactly 0.55 s at rank 2 (0.528 s without the floor)", () => {
    const rates: Array<[0 | 1 | 2, number]> = [[0, 600], [1, 552], [2, 550]];
    for (const [rank, ms] of rates) {
      const w = startRun("fire");
      quickdraw(w, rank);
      expect(windupMs(w, "bow"), `rank ${rank}`).toBeCloseTo(ms, 6);
    }
    expect(BOW_WINDUP * 0.88).toBeLessThan(BOW_WINDUP_FLOOR); // the floor is what holds rank 2 at 0.55
  });

  it("synced pull and timingsOf agree: the windup is the floor, the draw start is where the attack began", () => {
    const w = startRun("frost");
    quickdraw(w, 2);
    expect(P(w).windupMult).toBe(encodeMult(0.88));
    expect(timingsOf(P(w), "bow")!.windup).toBe(BOW_WINDUP_FLOOR);
    const ms = windupMs(w, "bow");
    expect(ms).toBeCloseTo(BOW_WINDUP_FLOOR * 1000, 6);
    expect(P(w).drawStartedAt).toBe(w.players.get("p0")!.weapon.action!.startedAt);
  });

  it("the arrow leaves on the first tick at or after the floored windup", () => {
    const w = startRun("fire");
    quickdraw(w, 2);
    const start = w.state.serverTime + TICK_MS; // the tick the press is applied in
    windupMs(w, "bow");
    let left = -1;
    for (let i = 0; i < 20 && left < 0; i++) {
      step(w, TICK_MS);
      if (w.projectiles.size > 0) left = w.state.serverTime;
    }
    expect(left - start).toBe(Math.ceil((BOW_WINDUP_FLOOR * 1000) / TICK_MS - 1e-9) * TICK_MS);
  });

  it("a bow already under the floor is left alone: Sentenced's, Plague's and Holy's draws do not shorten", () => {
    for (const faction of ["sentenced", "plague", "holy"] as const) {
      const plain = startRun(faction);
      const fast = startRun(faction);
      quickdraw(fast, 2);
      expect(windupMs(fast, "bow"), faction).toBeCloseTo(windupMs(plain, "bow"), 6);
      expect(timingsOf(P(fast), "bow")!.windup, faction).toBeLessThan(BOW_WINDUP_FLOOR);
    }
  });

  it("at the 1.5 attack-speed cap the cap-bound Frost bow still draws 0.55 s, not 0.528 s", () => {
    const w = startRun("frost");
    quickdraw(w, 2);
    w.modSources.push(() => ({ asMult: 1.5 }));
    recomputeMods(w, C(w));
    expect(decodeMult(P(w).asMult)).toBe(1.5);
    const t = timingsOf(P(w), "bow")!;
    expect(t.windup).toBe(BOW_WINDUP_FLOOR);
    expect(t.windup).toBeLessThan(t.interval);
  });
});

describe("a wand with Quickdraw", () => {
  it("keeps its whole 0.4 s at rank 1 and rank 2, whoever holds it (the real sim has no headroom below it)", () => {
    expect(WAND_WINDUP_FLOOR).toBe(WAND_WINDUP);
    for (const faction of ["fire", "frost", "sentenced", "holy"] as const) {
      for (const rank of [0, 1, 2] as const) {
        const w = startRun(faction);
        quickdraw(w, rank);
        expect(windupMs(w, "wand"), `${faction} rank ${rank}`).toBeCloseTo(WAND_WINDUP * 1000, 6);
      }
    }
  });
});

describe("melee windups are not part of the lever", () => {
  it("the sword scales freely with Quickdraw (0.088 s at rank 2) and so does the axe's windup and root", () => {
    const w = startRun("fire");
    quickdraw(w, 2);
    expect(windupMs(w, "sword")).toBeCloseTo(88, 6);
    const base = weaponTimings("axe", attackInterval(FACTIONS.fire, "axe"));
    const t = timingsOf(P(w), "axe")!;
    expect(t.windup).toBeCloseTo(base.windup * 0.88, 9);
    expect(t.root).toBeCloseTo(base.root * 0.88, 9);
  });
});

describe("the floor in the sim's timings, every faction", () => {
  it("rank 1 and 2 never take a bow or wand windup under min(windup, floor), nor above what it was", () => {
    for (const faction of FACTION_IDS) {
      for (const rank of [1, 2] as const) {
        const w = startRun(faction);
        const base = { bow: timingsOf(P(w), "bow")!, wand: timingsOf(P(w), "wand")! };
        quickdraw(w, rank);
        for (const weapon of ["bow", "wand"] as const) {
          const t = timingsOf(P(w), weapon)!;
          const floor = Math.min(base[weapon].windup, weapon === "bow" ? BOW_WINDUP_FLOOR : WAND_WINDUP_FLOOR);
          expect(t.windup, `${faction} ${weapon} rank ${rank}`).toBeGreaterThanOrEqual(floor - 1e-12);
          expect(t.windup, `${faction} ${weapon} rank ${rank}`).toBeLessThanOrEqual(base[weapon].windup + 1e-12);
        }
      }
    }
  });

  it("a windup mod above 1 (a future slow) still lengthens, ranged included, never past the interval", () => {
    const w = startRun("frost");
    w.modSources.push(() => ({ windupMult: 1.5 }));
    recomputeMods(w, C(w));
    expect(timingsOf(P(w), "bow")!.windup).toBeCloseTo(0.9, 9);
    expect(timingsOf(P(w), "wand")!.windup).toBeCloseTo(0.6, 9);
    expect(timingsOf(P(w), "bow")!.windup).toBeLessThanOrEqual(timingsOf(P(w), "bow")!.interval);
  });
});

describe("the harness's shooter options (--shooter-windup, --shooter-speed)", () => {
  it("give the shooter the mirrors through a mod source, the floors applied by the same scaleWindup, and the chaser nothing", () => {
    let seen = false;
    runDuel({
      faction: "fire", weapons: ["sword", "bow"], distance: 200, capSeconds: 1, seed: 3,
      windupMult: [undefined, 0.88], speedMult: [undefined, 1.1],
      onTick: (world) => {
        const chaser = world.state.players.get("f0")!;
        const shooter = world.state.players.get("f1")!;
        expect([chaser.windupMult, chaser.speedMult]).toEqual([1000, 1000]);
        expect([shooter.windupMult, shooter.speedMult]).toEqual([encodeMult(0.88), encodeMult(1.1)]);
        expect(timingsOf(shooter, "bow")!.windup).toBe(BOW_WINDUP_FLOOR);
        seen = true;
      },
    });
    expect(seen).toBe(true);
  });

  it("names them in the report header", () => {
    expect(shooterBuffText({ windupMult: 0.88 })).toBe("windup x0.88");
    expect(shooterBuffText({ asMult: 1.5, windupMult: 0.92, speedMult: 1.06 })).toBe("attack speed x1.5, windup x0.92, move speed x1.06");
    expect(shooterBuffText({ windupMult: 1, speedMult: 1 })).toBe("none");
  });
});
