import { describe, expect, it } from "vitest";
import { FACTIONS, PLAGUE_CORPSE_DISEASE_BONUS_PER_STACK, PLAGUE_CORPSE_HP_SHARE, PLAGUE_CORPSE_LIFETIME_MS, PLAGUE_CORPSE_INTERACT_RANGE, TILE, TILE_FLOOR, TILE_WALL, TICK_MS, generateMap, mapFromTiles, mulberry32, type GameMap } from "@raid/shared";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { downPlayer } from "../src/sim/arena";
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
  it("leaves a timed corpse on death and grants max health, one explicit heal, and one disease stack", () => {
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
    expect(PLAGUE_CORPSE_DISEASE_BONUS_PER_STACK).toBe(0.02);
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

  it("requires an open movement-mask line to a corpse inside the 70-unit reach", () => {
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

    corpse.x = 4.5 * TILE; corpse.y = 4.5 * TILE;
    consume(w, "plague-a", id);
    expect(w.state.plagueCorpses.has(id)).toBe(false);
    expect(p.corpseStacks).toBe(1);
  });
});
