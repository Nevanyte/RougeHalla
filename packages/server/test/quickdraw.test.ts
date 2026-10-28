// Quickdraw, owner ruling "Melee windups only" (testing/TUNING_ROGUE.md section 7): it shortens the sword's, the shield bash's
// and the axe's windups and NEVER a ranged one. The ranged windups are the anti-kiting
// lever, so a bow or wand attack with Quickdraw is the same attack without it. The axe has no post-launch recovery root. Windups are tick-quantized (an attack lands on the
// first 50 ms tick at or after start + windup, never in the tick it started in), so the numbers are sized to remove whole ticks:
// the sword and the bash 2 -> 1 at both ranks, the Fire/Frost axe 5 -> 3 -> 2. Since the balance pass Quickdraw is
// a card (one copy, -50% windup, the old rank 1); "rank 2" below is that card plus a second halving from a mod source (what a future relic
// could add), so the tick arithmetic of the deeper cut stays pinned.
import { describe, expect, it } from "vitest";
import {
  attackInterval, cardRows, decodeMult, encodeMult, FACTION_IDS, FACTIONS, mapFromTiles, mulberry32, pacedFaction,
  TICK_MS, TILE, TILE_FLOOR, TILE_WALL, weaponTimings, type FactionId, type GameMap, type WeaponId,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { grantCard } from "../src/sim/chests";
import { runDuel } from "../src/harness/duel";
import { shooterBuffText } from "../src/harness/kiting";
import { combatant, timingsOf, type Combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { recomputeMods } from "../src/sim/mods";
import { addPlayer, step } from "../src/sim/step";
import { moveMultiplierOf } from "../src/sim/weapons";
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
  if (rank >= 1) expect(grantCard(w, C(w), "quickdraw")).toBe(1);
  if (rank === 2) {
    w.modSources.push(() => ({ windupMult: 0.5 }));
    recomputeMods(w, C(w));
  }
}

/** Holds `weapon`, presses once, and returns the recorded windup (ms) and the ticks the sim took to land it and to free the walk. */
function attackOf(w: World, weapon: WeaponId): { windupMs: number; landTicks: number; freeTicks: number } {
  const p = P(w);
  p.weapon0 = weapon;
  p.weapon1 = "";
  p.slot = 0;
  expect(enqueueClientMessage(w.players.get("p0")!.inputs, "attack", { a: 0 })).toBe(true);
  expect(enqueueClientMessage(w.players.get("p0")!.inputs, "release", { a: 0 })).toBe(true);
  step(w, TICK_MS); // the attack starts in this tick
  const rt = w.players.get("p0")!.weapon;
  const act = rt.action;
  expect(act, `${weapon} started an attack`).not.toBeNull();
  const windupMs = act!.landsAt - act!.startedAt;
  let landTicks = -1;
  let freeTicks = -1;
  for (let i = 1; i <= 40 && (landTicks < 0 || freeTicks < 0); i++) {
    step(w, TICK_MS);
    if (landTicks < 0 && rt.action === null) landTicks = i;
    if (freeTicks < 0 && moveMultiplierOf(w, C(w)) === 1) freeTicks = i;
  }
  return { windupMs, landTicks, freeTicks };
}

const ticksOf = (cut: number | undefined): number | undefined => (cut === undefined ? undefined : Math.ceil(cut - 1e-9));

describe("Quickdraw's rows", () => {
  it("are -50% windup, on the melee weapons (the card's text says melee windups)", () => {
    expect(cardRows("quickdraw")).toEqual([{ k: "stat", stat: "windup", v: -0.5 }]);
  });
});

describe("a bow or wand with Quickdraw is the same attack as without it", () => {
  it("every faction, both ranks: the timings, the recorded windup and the ticks to land are unchanged", () => {
    for (const faction of FACTION_IDS) {
      for (const weapon of ["bow", "wand"] as const) {
        const plain = startRun(faction);
        const base = timingsOf(P(plain), weapon)!;
        const baseAttack = attackOf(plain, weapon);
        for (const rank of [1, 2] as const) {
          const w = startRun(faction);
          quickdraw(w, rank);
          expect(timingsOf(P(w), weapon), `${faction} ${weapon} rank ${rank}`).toEqual(base);
          const got = attackOf(w, weapon);
          expect(got, `${faction} ${weapon} rank ${rank}`).toEqual(baseAttack);
        }
      }
    }
  });

  it("the cap-bound draws stay unchanged under Quickdraw, and the synced pull starts where the attack began", () => {
    const w = startRun("frost");
    quickdraw(w, 2);
    expect(P(w).windupMult).toBe(encodeMult(0.25));
    const spec = pacedFaction(FACTIONS.frost);
    const bowWindup = weaponTimings("bow", attackInterval(spec, "bow")).windup;
    const wandWindup = weaponTimings("wand", attackInterval(spec, "wand")).windup;
    expect(timingsOf(P(w), "bow")!.windup).toBeCloseTo(bowWindup, 9);
    expect(timingsOf(P(w), "wand")!.windup).toBeCloseTo(wandWindup, 9);
    expect(attackOf(w, "bow").windupMs).toBeCloseTo(bowWindup * 1000, 6);
    expect(P(w).drawStartedAt).toBe(0); // the bow has landed and cleared its pull
  });

  it("at the attack-speed cap, the Frost bow follows its shortened interval share", () => {
    const w = startRun("frost");
    quickdraw(w, 2);
    w.modSources.push(() => ({ asMult: 1.5 }));
    recomputeMods(w, C(w));
    expect(decodeMult(P(w).asMult)).toBe(1.5);
    const t = timingsOf(P(w), "bow")!;
    const spec = pacedFaction(FACTIONS.frost);
    expect(t.windup).toBeCloseTo(weaponTimings("bow", attackInterval(spec, "bow", 1.5)).windup, 9);
    expect(t.windup).toBeLessThan(t.interval);
  });

  it("a windup mod above 1 (a future slow) still lengthens a ranged windup, never past the interval", () => {
    const w = startRun("frost");
    w.modSources.push(() => ({ windupMult: 1.5 }));
    recomputeMods(w, C(w));
    const bow = timingsOf(P(w), "bow")!;
    const wand = timingsOf(P(w), "wand")!;
    const base = startRun("frost");
    expect(bow.windup).toBeCloseTo(Math.min(bow.interval, timingsOf(P(base), "bow")!.windup * 1.5), 9);
    expect(wand.windup).toBeCloseTo(Math.min(wand.interval, timingsOf(P(base), "wand")!.windup * 1.5), 9);
    expect(bow.windup).toBeLessThanOrEqual(bow.interval);
  });
});

describe("the melee windups, in ticks (an attack starting on the tick grid)", () => {
  it("the sword and the shield bash land one tick after starting instead of two, at both ranks", () => {
    for (const weapon of ["sword", "shield"] as const) {
      const plain = attackOf(startRun("fire"), weapon);
      expect(plain.windupMs, weapon).toBeCloseTo(100, 6);
      expect(plain.landTicks, weapon).toBe(2);
      const r1 = startRun("fire");
      quickdraw(r1, 1);
      const a1 = attackOf(r1, weapon);
      expect(a1.windupMs, `${weapon} rank 1`).toBeCloseTo(50, 6);
      expect(a1.landTicks, `${weapon} rank 1`).toBe(1);
      const r2 = startRun("fire");
      quickdraw(r2, 2);
      const a2 = attackOf(r2, weapon);
      expect(a2.windupMs, `${weapon} rank 2`).toBeCloseTo(25, 6);
      expect(a2.landTicks, `${weapon} rank 2`).toBe(1); // a tick is the floor
    }
  });

  it("the Fire and Frost axe lands faster with Quickdraw and has no post-launch recovery root", () => {
    for (const faction of ["fire", "frost"] as const) {
      const plain = attackOf(startRun(faction), "axe");
      expect([plain.windupMs, plain.landTicks, plain.freeTicks], `${faction} plain`).toEqual([250, 5, 5]);
      const r1 = startRun(faction);
      quickdraw(r1, 1);
      const a1 = attackOf(r1, "axe");
      expect([a1.windupMs, a1.landTicks, a1.freeTicks], `${faction} rank 1`).toEqual([125, 3, 3]);
      const r2 = startRun(faction);
      quickdraw(r2, 2);
      const a2 = attackOf(r2, "axe");
      expect([a2.windupMs, a2.landTicks, a2.freeTicks], `${faction} rank 2`).toEqual([62.5, 2, 2]);
    }
  });

  it("the share-bound axes (Sentenced, Holy, Plague) gain ticks too, and rank 2 removes more than rank 1", () => {
    for (const faction of ["sentenced", "holy", "plague"] as const) {
      const iv = attackInterval(pacedFaction(FACTIONS[faction]), "axe");
      const t = weaponTimings("axe", iv);
      const plain = attackOf(startRun(faction), "axe");
      expect(plain.landTicks, faction).toBe(Math.max(1, ticksOf((t.windup * 1000) / TICK_MS)!));
      const r1 = startRun(faction);
      quickdraw(r1, 1);
      const a1 = attackOf(r1, "axe");
      const r2 = startRun(faction);
      quickdraw(r2, 2);
      const a2 = attackOf(r2, "axe");
      expect(a1.landTicks, `${faction} rank 1`).toBeLessThan(plain.landTicks);
      expect(a2.landTicks, `${faction} rank 2`).toBeLessThanOrEqual(a1.landTicks);
      expect(a1.freeTicks, `${faction} rank 1`).toBeLessThan(plain.freeTicks);
      expect(a2.freeTicks, `${faction} rank 2`).toBe(a2.landTicks); // recovery root is zero; tick rounding may tie ranks
      expect(a2.freeTicks, `${faction} rank 2`).toBeGreaterThanOrEqual(a2.landTicks);
    }
  });

  it("a held trigger, whose swings start between ticks, still lands the sword in one tick instead of two, every swing", () => {
    const run = (rank: 0 | 1): number[] => {
      const w = startRun("fire"); // the sword's 0.775 s interval is 15.5 ticks: the starts drift off the grid
      quickdraw(w, rank);
      P(w).weapon0 = "sword";
      P(w).weapon1 = "";
      P(w).slot = 0;
      const rt = w.players.get("p0")!.weapon;
      enqueueClientMessage(w.players.get("p0")!.inputs, "attack", { a: 0 });
      const landed: number[] = [];
      let startedTick = -1;
      for (let i = 0; i < 160; i++) {
        const before = rt.action;
        step(w, TICK_MS);
        if (rt.action !== null && before === null) startedTick = i;
        if (rt.action === null && before !== null && startedTick >= 0) landed.push(i - startedTick);
      }
      return landed;
    };
    const plain = run(0);
    const quick = run(1);
    expect(plain.length).toBeGreaterThanOrEqual(8);
    expect(quick.length).toBeGreaterThanOrEqual(8);
    expect(new Set(plain)).toEqual(new Set([2]));
    expect(new Set(quick)).toEqual(new Set([1]));
  });

  it("the axe has no post-launch recovery root at either Quickdraw rank", () => {
    for (const faction of FACTION_IDS) {
      for (const rank of [1, 2] as const) {
        const w = startRun(faction);
        quickdraw(w, rank);
        const t = timingsOf(P(w), "axe")!;
        expect(t.root, `${faction} rank ${rank}`).toBe(0);
      }
    }
  });
});

describe("the harness's Quickdraw options", () => {
  it("--chaser-cards / --shooter-cards grant the real card; a bare multiplier is a mod source; the shooter's ranged windups do not move", () => {
    let seen = false;
    runDuel({
      faction: "fire", weapons: ["sword", "bow"], distance: 200, capSeconds: 1, seed: 3,
      cards: [["quickdraw"], ["quickdraw"]], windupMult: [0.5, undefined],
      onTick: (world) => {
        const chaser = world.state.players.get("f0")!;
        const shooter = world.state.players.get("f1")!;
        expect(chaser.build.get("quickdraw")).toBe(1);
        expect(shooter.build.get("quickdraw")).toBe(1);
        expect(chaser.windupMult).toBe(encodeMult(0.25));
        expect(shooter.windupMult).toBe(encodeMult(0.5));
        expect(timingsOf(chaser, "sword")!.windup).toBeCloseTo(0.025, 12);
        const bowWindup = weaponTimings("bow", attackInterval(pacedFaction(FACTIONS.fire), "bow")).windup;
        expect(timingsOf(shooter, "bow")!.windup).toBeCloseTo(bowWindup, 9);
        seen = true;
      },
    });
    expect(seen).toBe(true);
    let bare = false;
    runDuel({
      faction: "fire", weapons: ["sword", "bow"], distance: 200, capSeconds: 1, seed: 3,
      windupMult: [0.5, undefined],
      onTick: (world) => {
        expect(world.state.players.get("f0")!.windupMult).toBe(encodeMult(0.5));
        expect(world.state.players.get("f1")!.windupMult).toBe(1000);
        bare = true;
      },
    });
    expect(bare).toBe(true);
  });

  it("names a fighter's kit in the report header", () => {
    expect(shooterBuffText({ windupMult: 0.5 })).toBe("windup x0.5");
    expect(shooterBuffText({ cards: ["quickdraw", "fleet1"] })).toBe("quickdraw, fleet1");
    expect(shooterBuffText({ asMult: 1.5, windupMult: 0.5, speedMult: 1.06 })).toBe("attack speed x1.5, windup x0.5, move speed x1.06");
    expect(shooterBuffText({ windupMult: 1, speedMult: 1 })).toBe("none");
  });
});
