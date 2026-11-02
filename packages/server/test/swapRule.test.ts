// The swap rule the client predicts from (shared swapAllowed) and the one the server applies (sim/weapons.ts handleSwap) are the
// same function: over every pair of hands, slot in hand and slot asked for, with and without Committed's locked second slot, the
// server changes the slot exactly when swapAllowed says so. The statuses that refuse a swap before the rule (stun, a cast) are
// status.test.ts's.
import { describe, expect, it } from "vitest";
import { mapFromTiles, mulberry32, swapAllowed, SWAP_SECONDS, TICK_MS, TILE, TILE_FLOOR, TILE_WALL } from "@raid/shared";
import { grantCard } from "../src/sim/chests";
import { combatant, handIsEmpty, slotItem, slotWeapon, type Combatant, type FighterState } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { addPlayer, step } from "../src/sim/step";
import { handleSwap } from "../src/sim/weapons";
import type { World } from "../src/sim/world";

function startRun(): World {
  const w = 40, h = 20;
  const tiles = new Uint8Array(w * h).fill(TILE_FLOOR);
  for (let x = 0; x < w; x++) { tiles[x] = TILE_WALL; tiles[(h - 1) * w + x] = TILE_WALL; }
  for (let y = 0; y < h; y++) { tiles[y * w] = TILE_WALL; tiles[y * w + w - 1] = TILE_WALL; }
  const spawns = Array.from({ length: 8 }, (_, i) => ({ x: (3 + 3 * i) * TILE + TILE / 2, y: 10 * TILE + TILE / 2 }));
  const world = createGameWorld({
    config: { minPlayers: 1, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600, pvpRules: false },
    random: mulberry32(6),
    map: { ...mapFromTiles(w, h, tiles), spawns },
  }, { signatures: false });
  addPlayer(world, "p0", "name0", { faction: "fire" });
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  return world;
}

const HANDS = ["", "sword", "wand", "fists", "spear"];

/** The rule handleSwap applied before it called swapAllowed, from the combatant helpers: the refactor must not move a single case. */
function earlierRule(s: FighterState, target: number, secondLocked: boolean): boolean {
  if (target === s.slot || slotWeapon(s, target) === null) return false;
  if (target === 1 && secondLocked) return false;
  return !(slotItem(s, target) === null && handIsEmpty(s));
}

describe("handleSwap and the shared swapAllowed rule", () => {
  it.each([false, true])("agree over every hand, slot and target (Committed %s)", (committed) => {
    const world = startRun();
    const c = combatant(world, "p0")! as Extract<Combatant, { kind: "player" }>;
    if (committed) expect(grantCard(world, c, "committed")).toBe(1);
    const p = world.state.players.get("p0")!;
    let allowed = 0;
    let refused = 0;
    for (const weapon0 of HANDS) for (const weapon1 of HANDS) for (const slot of [0, 1] as const) for (const target of [0, 1, undefined] as const) {
      p.weapon0 = weapon0; p.weapon1 = weapon1; p.slot = slot; p.readyAt = 0;
      const to = target ?? (slot === 0 ? 1 : 0);
      handleSwap(world, c, target === undefined ? { kind: "swap" } : { kind: "swap", slot: target });
      const label = `${JSON.stringify({ weapon0, weapon1, slot, target })} locked ${committed}`;
      const expected = swapAllowed({ weapon0, weapon1, slot }, to, committed);
      expect(expected, label).toBe(earlierRule({ ...p, weapon0, weapon1, slot } as FighterState, to, committed));
      expect(p.slot, label).toBe(expected ? to : slot);
      // An accepted swap costs the swap time on the shared cooldown; a refused one costs nothing.
      expect(p.readyAt, label).toBe(expected ? world.state.serverTime + SWAP_SECONDS * 1000 : 0);
      if (expected) allowed++; else refused++;
    }
    expect(allowed).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
  });
});
