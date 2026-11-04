// Passive player regeneration (sim/regen.ts): slow, quiet, off unless SimConfig.regen.
import { describe, expect, it } from "vitest";
import {
  mapFromTiles, mulberry32, PLAYER_REGEN_SHARE_IN, PLAYER_REGEN_SHARE_OUT, TICK_MS, TILE, TILE_FLOOR, TILE_WALL,
} from "@raid/shared";
import { downPlayer } from "../src/sim/arena";
import { createGameWorld } from "../src/sim/gameplay";
import { recordHit } from "../src/sim/ledger";
import { addPlayer, step } from "../src/sim/step";
import type { SimConfig, World } from "../src/sim/world";

const N = 30;
function rig(config: Partial<SimConfig> = {}): World {
  const tiles = new Uint8Array(N * N).fill(TILE_FLOOR);
  for (let i = 0; i < N; i++) { tiles[i] = TILE_WALL; tiles[(N - 1) * N + i] = TILE_WALL; tiles[i * N] = TILE_WALL; tiles[i * N + N - 1] = TILE_WALL; }
  const map = mapFromTiles(N, N, tiles);
  map.spawns = Array.from({ length: 8 }, (_, i) => ({ x: (3 + i * 2) * TILE, y: 3 * TILE }));
  const world = createGameWorld({
    config: {
      minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600,
      mobs: false, quests: false, regen: true, ...config,
    },
    random: mulberry32(12),
    rewardSalt: 99,
    map,
  });
  addPlayer(world, "p0", "alice", { faction: "sentenced" });
  addPlayer(world, "p1", "bob", { faction: "fire" });
  step(world, TICK_MS);
  return world;
}
const P = (w: World, id: string) => w.state.players.get(id)!;
const run = (w: World, n: number) => { for (let i = 0; i < n; i++) step(w, TICK_MS); };

describe("passive regen", () => {
  it("heals a slow share of max hp a second out of combat", () => {
    const w = rig();
    const p = P(w, "p0");
    p.hp = p.maxHp / 2;
    const h0 = p.hp;
    run(w, 20);
    expect(p.hp - h0).toBeCloseTo(PLAYER_REGEN_SHARE_OUT * p.maxHp, 6);
  });

  it("heals nothing in combat (out of combat only) and never passes max hp", () => {
    const w = rig();
    const p = P(w, "p0");
    p.hp = p.maxHp / 2;
    let hit = true;
    w.beforeDamage.push((x) => {
      if (hit) recordHit(x, { victim: "p0", by: { id: "p1", name: "bob" }, packet: { raw: 1, phys: 0, magic: 0, true: 1 }, weapon: "sword", stagger: false });
      hit = false;
    });
    step(w, TICK_MS);
    const h0 = p.hp;
    run(w, 20);
    expect(PLAYER_REGEN_SHARE_IN).toBe(0);
    expect(p.hp - h0).toBe(0);
    p.hp = p.maxHp - 1;
    run(w, 400);
    expect(p.hp).toBe(p.maxHp);
  });

  it("never heals a downed player", () => {
    const w = rig();
    const q = P(w, "p1");
    q.hp = q.maxHp / 2;
    downPlayer(w, q, w.players.get("p1")!, "died");
    const dead = q.hp;
    run(w, 20);
    expect(q.hp).toBe(dead);
  });

  it("is off unless the config asks", () => {
    const w = rig({ regen: false });
    const p = P(w, "p0");
    p.hp = p.maxHp / 2;
    const h0 = p.hp;
    run(w, 40);
    expect(p.hp).toBe(h0);
  });
});
