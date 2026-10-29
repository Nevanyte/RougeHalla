import { describe, expect, it, vi } from "vitest";
import { mapFromTiles, mulberry32, TILE, VISION_TRAIL_MS } from "@raid/shared";
import { visionSnapshot } from "../src/rooms/visionSync";
import { RaidRoom } from "../src/rooms/RaidRoom";
import { createGameWorld } from "../src/sim/gameplay";
import { addPlayer, startRaid } from "../src/sim/step";
import { getVisionMemory } from "../src/sim/vision";

function fixture() {
  const world = createGameWorld({ seed: 7, random: mulberry32(8), config: {
    minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600,
    patienceMinSeconds: 3600, suddenDeathSeconds: 3600,
  } });
  const w = 80, h = 8;
  const tiles = new Uint8Array(w * h);
  // Split the players' areas completely to make privacy independent of distance rounding.
  for (let y = 0; y < h; y++) tiles[y * w + 40] = 1;
  world.map = mapFromTiles(w, h, tiles, 7);
  addPlayer(world, "a", "Alice");
  addPlayer(world, "b", "Bob");
  startRaid(world, new Map([
    ["a", { x: 4.5 * TILE, y: 4.5 * TILE }],
    ["b", { x: 75.5 * TILE, y: 4.5 * TILE }],
  ]));
  return world;
}

describe("reconnect vision snapshots", () => {
  it("contains only the recipient's unexpired trail and is absent from public state", () => {
    const world = fixture();
    const own = visionSnapshot(world, "a")!;
    const other = visionSnapshot(world, "b")!;
    expect(own).toMatchObject({ seed: 7, w: 80, h: 8, at: world.state.serverTime });
    expect(own.cells.length).toBeGreaterThan(0);
    expect(own.cells.every(([i, until]) => i % 80 < 40 && until > own.at && until <= own.at + VISION_TRAIL_MS)).toBe(true);
    expect(other.cells.every(([i]) => i % 80 > 40)).toBe(true);
    const memory = getVisionMemory(world, "a")!;
    const hiddenCell = 75 + 4 * 80;
    memory.expiresAt[hiddenCell] = own.at;
    expect(visionSnapshot(world, "a")!.cells.some(([i]) => i === hiddenCell)).toBe(false);
    expect(world.state.toJSON()).not.toHaveProperty("vision");
    expect(world.state.toJSON()).not.toHaveProperty("expiresAt");
    expect(visionSnapshot(world, "missing")).toBeNull();
  });

  it("returns independent cell tuples and preserves the server trail after snapshot edits", () => {
    const world = fixture();
    const first = visionSnapshot(world, "a")!;
    const [index, original] = first.cells[0]!;
    first.cells[0]![1] = -1;
    expect(getVisionMemory(world, "a")!.expiresAt[index]).toBe(original);
  });

  it("sends a private snapshot to the reconnecting socket without broadcasting it", () => {
    const world = fixture();
    const room = Object.create(RaidRoom.prototype) as RaidRoom;
    Object.assign(room, { built: world, pendingResults: new Map(), fxChannel: { inFlight: vi.fn() } });
    const send = vi.fn();
    const broadcast = vi.fn();
    Object.assign(room, { broadcast });
    room.onReconnect({ sessionId: "a", send } as unknown as Parameters<RaidRoom["onReconnect"]>[0]);
    expect(send).toHaveBeenCalledWith("vision", visionSnapshot(world, "a"));
    expect(broadcast).not.toHaveBeenCalled();
  });
});
