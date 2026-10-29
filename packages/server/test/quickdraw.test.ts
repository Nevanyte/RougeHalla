// Player melee lands immediately while moving. Legacy Quickdraw modifiers cannot shorten a zero windup;
// ranged attack pauses remain the anti-kiting lever, so Quickdraw never shortens bow or wand draws.
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
  const events = step(w, TICK_MS); // an instant melee swing also lands in this tick
  const rt = w.players.get("p0")!.weapon;
  const act = rt.action;
  if (act === null) {
    expect(events.filter((fx) => fx.type === "fx" && fx.fx.kind === "swing" && fx.fx.by === "p0"), `${weapon} landed immediately`).toHaveLength(1);
    expect(moveMultiplierOf(w, C(w))).toBe(1);
    return { windupMs: 0, landTicks: 0, freeTicks: 0 };
  }
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

describe("instant player melee with legacy Quickdraw modifiers", () => {
  it("sword, shield and fists land immediately at both ranks, with no movement pause", () => {
    for (const weapon of ["sword", "shield", "fists"] as const) {
      for (const rank of [0, 1, 2] as const) {
        const w = startRun("fire");
        const interval = timingsOf(P(w), weapon)!.interval;
        quickdraw(w, rank);
        expect(attackOf(w, weapon), `${weapon} rank ${rank}`).toEqual({ windupMs: 0, landTicks: 0, freeTicks: 0 });
        expect(timingsOf(P(w), weapon)!.interval).toBe(interval);
      }
    }
  });

  it("Fire and Frost axes stay instant at both ranks with their cooldown unchanged", () => {
    for (const faction of ["fire", "frost"] as const) {
      for (const rank of [0, 1, 2] as const) {
        const w = startRun(faction);
        const interval = timingsOf(P(w), "axe")!.interval;
        quickdraw(w, rank);
        expect(attackOf(w, "axe"), `${faction} rank ${rank}`).toEqual({ windupMs: 0, landTicks: 0, freeTicks: 0 });
        expect(timingsOf(P(w), "axe")!.interval).toBe(interval);
      }
    }
  });

  it("Sentenced, Holy and Plague axes stay instant at both ranks", () => {
    for (const faction of ["sentenced", "holy", "plague"] as const) {
      for (const rank of [0, 1, 2] as const) {
        const w = startRun(faction);
        quickdraw(w, rank);
        expect(attackOf(w, "axe"), `${faction} rank ${rank}`).toEqual({ windupMs: 0, landTicks: 0, freeTicks: 0 });
      }
    }
  });

  it("a held trigger keeps the same carried cooldown and swing cadence with Quickdraw", () => {
    const run = (rank: 0 | 1): number[] => {
      const w = startRun("fire"); // the sword's 0.775 s interval drifts across the tick grid
      quickdraw(w, rank);
      P(w).weapon0 = "sword";
      P(w).weapon1 = "";
      P(w).slot = 0;
      enqueueClientMessage(w.players.get("p0")!.inputs, "attack", { a: 0 });
      const landed: number[] = [];
      for (let i = 0; i < 160; i++) {
        const events = step(w, TICK_MS);
        if (events.some((fx) => fx.type === "fx" && fx.fx.kind === "swing" && fx.fx.by === "p0")) landed.push(w.state.serverTime);
        expect(w.players.get("p0")!.weapon.action).toBeNull();
        expect(moveMultiplierOf(w, C(w))).toBe(1);
      }
      return landed;
    };
    const plain = run(0);
    const quick = run(1);
    expect(plain.length).toBeGreaterThanOrEqual(8);
    expect(quick).toEqual(plain);
    expect(new Set(plain.slice(1).map((at, i) => at - plain[i]!))).toEqual(new Set([750, 800]));
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
        expect(timingsOf(chaser, "sword")!.windup).toBe(0);
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
