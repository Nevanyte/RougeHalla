import { describe, expect, it } from "vitest";
import { mapFromTiles, mulberry32, TICK_MS, TILE, VISION_TRAIL_MS, VISION_UPDATE_MS } from "@raid/shared";
import { createGameWorld } from "../src/sim/gameplay";
import { addPlayer, startRaid } from "../src/sim/step";
import { getVisionMemory, refreshVision } from "../src/sim/vision";

describe("vision refresh stagger", () => {
  it("spreads players over the window and keeps every one on the update cadence", () => {
    const world = createGameWorld({ seed: 7, random: mulberry32(8), config: {
      minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600,
      patienceMinSeconds: 3600, suddenDeathSeconds: 3600,
    } });
    world.map = mapFromTiles(40, 8, new Uint8Array(40 * 8), 7);
    addPlayer(world, "a", "Alice");
    addPlayer(world, "b", "Bob");
    startRaid(world, new Map([["a", { x: 4.5 * TILE, y: 4.5 * TILE }], ["b", { x: 30.5 * TILE, y: 4.5 * TILE }]]));
    const memory = { a: getVisionMemory(world, "a")!, b: getVisionMemory(world, "b")! };
    const refreshed: Record<string, number[]> = { a: [], b: [] };
    for (let k = 1; k <= 12; k++) {
      world.state.serverTime += TICK_MS;
      for (const id of ["a", "b"]) { const p = world.state.players.get(id)!; p.x += 3; }
      const before = new Map(["a", "b"].map((id) => [id, memory[id as "a" | "b"].expiresAt.slice()]));
      refreshVision(world);
      for (const id of ["a", "b"]) {
        const after = memory[id as "a" | "b"].expiresAt;
        if (after.some((v, i) => v !== before.get(id)![i])) refreshed[id]!.push(k);
      }
    }
    expect(refreshed.a!.length).toBeGreaterThan(3);
    expect(refreshed.b!.length).toBeGreaterThan(3);
    for (const id of ["a", "b"]) {
      const ks = refreshed[id]!;
      for (let i = 1; i < ks.length; i++) expect((ks[i]! - ks[i - 1]!) * TICK_MS).toBe(VISION_UPDATE_MS);
    }
    expect(refreshed.a!.some((k) => refreshed.b!.includes(k))).toBe(false);
    expect(VISION_TRAIL_MS).toBeGreaterThan(VISION_UPDATE_MS);
  });
});
