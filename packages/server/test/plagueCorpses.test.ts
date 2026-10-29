import { describe, expect, it } from "vitest";
import { FACTIONS, plagueZombieStats, PLAGUE_CORPSE_AUTO_RANGE, PLAGUE_CORPSE_HP_SHARE, PLAGUE_CORPSE_LIFETIME_MS, PLAGUE_CORPSE_INTERACT_RANGE, TILE, TILE_FLOOR, TILE_LOW, TILE_WALL, TICK_MS, generateMap, mapFromTiles, mulberry32, type GameMap } from "@raid/shared";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { downPlayer } from "../src/sim/arena";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { dropWeapon } from "../src/sim/loot";
import { addPlayer, step } from "../src/sim/step";
import type { World } from "../src/sim/world";

function world(map: GameMap = generateMap(23)): World {
  const w = createGameWorld({
    config: { minPlayers: 4, lobbySeconds: 0, fillSeconds: 0, patienceSeconds: 1e9, patienceMinSeconds: 1e9, suddenDeathSeconds: 1e9, pvpRules: false, mobs: false },
    random: mulberry32(23), map,
  });
  addPlayer(w, "victim", "Victim", { faction: "fire" });
  addPlayer(w, "plague-a", "Plague A", { faction: "plague" });
  addPlayer(w, "plague-b", "Plague B", { faction: "plague" });
  addPlayer(w, "other", "Other", { faction: "holy" });
  step(w, TICK_MS);
  return w;
}

function die(w: World, id = "victim"): string {
  const p = w.state.players.get(id)!;
  p.x = 500; p.y = 500;
  downPlayer(w, p, w.players.get(id)!, "died");
  const corpse = [...w.state.plagueCorpses.values()].find((c) => c.playerId === id);
  if (!corpse) throw new Error("death did not leave a Plague corpse");
  return corpse.id;
}
function consume(w: World, player: string, corpseId: string): void {
  expect(enqueueClientMessage(w.players.get(player)!.inputs, "consumeCorpse", { corpseId })).toBe(true);
  step(w, TICK_MS);
}

describe("Plague corpse harvest", () => {
  it("leaves a timed corpse on death and grants max health, one explicit heal, and one zombie", () => {
    const w = world();
    const id = die(w);
    const corpse = w.state.plagueCorpses.get(id)!;
    expect(corpse).toMatchObject({ playerId: "victim", playerName: "Victim", x: 500, y: 500 });
    expect(corpse.expiresAt - w.state.serverTime).toBe(PLAGUE_CORPSE_LIFETIME_MS);
    const p = w.state.players.get("plague-a")!;
    p.x = 500; p.y = 500; p.hp = p.maxHp / 2;
    const beforeHp = p.hp, beforeMax = p.maxHp;
    consume(w, "plague-a", id);
    expect(w.state.plagueCorpses.has(id)).toBe(false);
    expect(p.corpseStacks).toBe(1);
    expect(p.maxHp - beforeMax).toBeCloseTo(FACTIONS.plague.hp * PLAGUE_CORPSE_HP_SHARE, 5);
    expect(p.hp - beforeHp).toBeCloseTo(FACTIONS.plague.hp * PLAGUE_CORPSE_HP_SHARE, 5);
    const zombie = w.state.mobs.get(p.plagueZombieId)!;
    expect(zombie.kind).toBe("zombie");
    expect(zombie.ownerId).toBe("plague-a");
    expect(zombie.maxHp).toBeCloseTo(plagueZombieStats(p.maxHp, 1).maxHp, 8);
  });

  it("allows exactly one Plague to win simultaneous consumption and rejects outsiders and distant players", () => {
    const w = world();
    const id = die(w);
    for (const who of ["plague-a", "plague-b", "other"]) {
      const p = w.state.players.get(who)!; p.x = 500; p.y = 500;
    }
    enqueueClientMessage(w.players.get("plague-a")!.inputs, "consumeCorpse", { corpseId: id });
    enqueueClientMessage(w.players.get("plague-b")!.inputs, "consumeCorpse", { corpseId: id });
    step(w, TICK_MS);
    expect(w.state.players.get("plague-a")!.corpseStacks + w.state.players.get("plague-b")!.corpseStacks).toBe(1);

    const second = die(w, "other");
    w.state.players.get("other")!.status = "dead";
    w.state.players.get("plague-a")!.x = 500 + PLAGUE_CORPSE_INTERACT_RANGE + 1;
    w.state.players.get("plague-b")!.x = 900;
    consume(w, "plague-a", second);
    expect(w.state.players.get("plague-a")!.corpseStacks).toBe(1);
    expect(w.state.plagueCorpses.has(second)).toBe(true);
  });

  it("expires corpses and leaves no corpse for MIA removals", () => {
    const w = world();
    const id = die(w);
    const corpse = w.state.plagueCorpses.get(id)!;
    w.state.serverTime = corpse.expiresAt - TICK_MS;
    const p = w.state.players.get("plague-a")!; p.x = corpse.x; p.y = corpse.y;
    consume(w, "plague-a", id);
    expect(w.state.plagueCorpses.has(id)).toBe(false);
    expect(p.corpseStacks).toBe(0);

    const mia = w.state.players.get("other")!;
    downPlayer(w, mia, w.players.get("other")!, "mia");
    expect([...w.state.plagueCorpses.values()].some((c) => c.playerId === "other")).toBe(false);
  });

  it("requires an open movement-mask line, with the legacy message limited to the same 24-unit overlap", () => {
    const side = 16;
    const tiles = new Uint8Array(side * side).fill(TILE_FLOOR);
    tiles[5 * side + 5] = TILE_WALL;
    const w = world(mapFromTiles(side, side, tiles));
    const id = die(w);
    const p = w.state.players.get("plague-a")!;
    const corpse = w.state.plagueCorpses.get(id)!;
    p.x = 4.5 * TILE; p.y = 5.5 * TILE;
    corpse.x = 6.5 * TILE; corpse.y = 5.5 * TILE;
    consume(w, "plague-a", id);
    expect(w.state.plagueCorpses.has(id)).toBe(true);
    expect(p.corpseStacks).toBe(0);

    corpse.x = 4.5 * TILE; corpse.y = 5 * TILE;
    consume(w, "plague-a", id);
    expect(w.state.plagueCorpses.has(id)).toBe(false);
    expect(p.corpseStacks).toBe(1);
  });
});

/** A quiet open floor; nobody begins on top of a later death marker by accident. */
function autoWorld(blocked = false): World {
  const tiles = new Uint8Array(40 * 30).fill(TILE_FLOOR);
  if (blocked) tiles[5 * 40 + 5] = TILE_LOW;
  const w = world(mapFromTiles(40, 30, tiles));
  for (const p of w.state.players.values()) { p.x = 900; p.y = 800; }
  return w;
}

describe("walking over Plague corpses", () => {
  it("harvests while walking with no consume input, raises a zombie, and leaves the move order running", () => {
    const w = autoWorld(), id = die(w), p = w.state.players.get("plague-a")!;
    p.x = 450; p.y = 500;
    w.players.get("plague-a")!.history = [{ t: w.state.serverTime, x: p.x, y: p.y }];
    expect(enqueueClientMessage(w.players.get("plague-a")!.inputs, "move", { x: 560, y: 500 })).toBe(true);
    for (let n = 0; w.state.plagueCorpses.has(id) && n < 20; n++) step(w, TICK_MS);
    expect(w.state.plagueCorpses.has(id)).toBe(false); expect(p.corpseStacks).toBe(1);
    expect(Math.abs(p.x - 500)).toBeLessThanOrEqual(PLAGUE_CORPSE_AUTO_RANGE);
    expect(w.players.get("plague-a")!.path.length).toBeGreaterThan(0);
    expect(w.state.mobs.get(p.plagueZombieId)?.status).toBe("alive");
    for (let n = 0; n < 20; n++) step(w, TICK_MS);
    expect(p.x).toBeCloseTo(560); expect(p.corpseStacks).toBe(1);
  });

  it("harvests multiple overlapping bodies in one step and grows the same single zombie", () => {
    const w = autoWorld(); die(w); die(w, "other");
    const p = w.state.players.get("plague-a")!; p.x = 500; p.y = 500;
    step(w, TICK_MS);
    expect(w.state.plagueCorpses.size).toBe(0); expect(p.corpseStacks).toBe(2);
    const zombies = [...w.state.mobs.values()].filter(m => m.kind === "zombie");
    expect(zombies).toHaveLength(1); expect(zombies[0]!.maxHp).toBeCloseTo(plagueZombieStats(p.maxHp, 2).maxHp);
  });

  it("settles two overlapping Plagues by shuffled tick rank and grants the corpse exactly once", () => {
    const w = autoWorld(), id = die(w);
    for (const who of ["plague-a", "plague-b"]) {
      const p = w.state.players.get(who)!; p.x = 500; p.y = 500;
    }
    step(w, TICK_MS);
    const order = ["plague-a", "plague-b"].sort((a, b) => w.combat.rank.get(a)! - w.combat.rank.get(b)!);
    expect(w.state.players.get(order[0]!)!.corpseStacks).toBe(1);
    expect(w.state.players.get(order[1]!)!.corpseStacks).toBe(0);
    expect(w.state.plagueCorpses.has(id)).toBe(false);
    expect([...w.state.mobs.values()].filter(m => m.kind === "zombie")).toHaveLength(1);
  });

  it("requires the 24-unit overlap for both automatic and legacy messages, and rejects non-Plague actors", () => {
    const w = autoWorld(), id = die(w), p = w.state.players.get("plague-a")!;
    p.x = 500 + PLAGUE_CORPSE_AUTO_RANGE + 1; p.y = 500;
    const other = w.state.players.get("other")!; other.x = 500; other.y = 500;
    step(w, TICK_MS); expect(p.corpseStacks).toBe(0); expect(other.corpseStacks).toBe(0);
    consume(w, "plague-a", id); expect(w.state.plagueCorpses.has(id)).toBe(true);
    p.x = 500 + PLAGUE_CORPSE_AUTO_RANGE;
    step(w, TICK_MS); expect(p.corpseStacks).toBe(1); expect(w.state.plagueCorpses.has(id)).toBe(false);
  });

  it("does not harvest through a movement-blocking fence even when a corpse lies within overlap radius", () => {
    const w = autoWorld(true), id = die(w), p = w.state.players.get("plague-a")!;
    const corpse = w.state.plagueCorpses.get(id)!;
    p.x = 5 * TILE - 12; p.y = 5.5 * TILE;
    corpse.x = 5 * TILE + 8; corpse.y = p.y; // an old body under a closed fence/gate tile
    expect(Math.hypot(p.x - corpse.x, p.y - corpse.y)).toBeLessThan(PLAGUE_CORPSE_AUTO_RANGE);
    step(w, TICK_MS);
    expect(p.corpseStacks).toBe(0); expect(w.state.plagueCorpses.has(id)).toBe(true);
  });

  it("another walk-over body revives the dead zombie with all accumulated growth", () => {
    const w = autoWorld(), p = w.state.players.get("plague-a")!;
    die(w); p.x = 500; p.y = 500; step(w, TICK_MS);
    const id = p.plagueZombieId, z = w.state.mobs.get(id)!;
    recordHit(w, { by: { id: "other", name: "Other" }, victim: id, weapon: "fists", stagger: false,
      packet: { raw: 1e9, phys: 1, magic: 0, true: 0 } });
    applyLedger(w); expect(z.status).toBe("dead");
    die(w, "other"); step(w, TICK_MS);
    expect(p.plagueZombieId).toBe(id); expect(p.corpseStacks).toBe(2); expect(z.status).toBe("alive");
    expect(z.hp).toBeCloseTo(plagueZombieStats(p.maxHp, 2).maxHp);
  });

  it("ordinary loot overlap and ordinary pickup messages grant no corpse stack or zombie", () => {
    const w = autoWorld(), p = w.state.players.get("plague-a")!; p.x = 500; p.y = 500;
    const loot = dropWeapon(w, { x: p.x, y: p.y }, "sword");
    step(w, TICK_MS); expect(p.corpseStacks).toBe(0); expect(p.plagueZombieId).toBe("");
    expect(enqueueClientMessage(w.players.get("plague-a")!.inputs, "pickup", { containerId: loot.id })).toBe(true);
    step(w, TICK_MS); expect(p.weapon0).toBe("sword"); expect(p.corpseStacks).toBe(0); expect(p.plagueZombieId).toBe("");
  });
});
