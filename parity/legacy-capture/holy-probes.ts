// Direct trusted helper probe, not a gameplay fixture or a made-up heal command.
// Run with the same runtime as capture.ts. The clock assignments isolate exact lockout boundaries.
import assert from "node:assert/strict";
import { mapFromTiles, TILE_FLOOR, TICK_MS } from "@raid/shared";
import { createScenarioWorld } from "./world";
import { HOLY_MODULES } from "./scenarios/holy";
import { addPlayer, step } from "../../packages/server/src/sim/step";
import { combatant } from "../../packages/server/src/sim/combatant";
import { heal, signatureState } from "../../packages/server/src/sim/factions";
import { createIntake } from "./intake";
const world = createScenarioWorld(
  {
    name: "helper",
    description: "",
    parity: "slice",
    rows: [],
    randomSeed: 12,
    modules: HOLY_MODULES,
    maxTicks: 4,
    players: [
      { id: "p0", faction: "holy", at: { x: 400, y: 320 } },
      { id: "p1", faction: "holy", at: { x: 456, y: 320 } },
    ],
    drive: () => {},
  },
  mapFromTiles(40, 24, new Uint8Array(40 * 24).fill(TILE_FLOOR), 11),
);
for (const id of ["p0", "p1"]) addPlayer(world, id, id.toUpperCase(), { faction: "holy" });
step(world, TICK_MS);
for (const [i, id] of ["p0", "p1"].entries()) {
  const p = world.state.players.get(id)!;
  p.x = 400 + i * 56;
  p.y = 320;
  p.hp = 500;
  world.players.get(id)!.history = [{ t: 50, x: p.x, y: p.y }];
}
step(world, TICK_MS);
createIntake(false)("p0", world.players.get("p0")!.inputs, "attack", { a: 0 }, world.state.serverTime, false);
step(world, TICK_MS);
const c = combatant(world, "p1")!;
assert.equal(signatureState(world, "p1")!.combatAt, 150);
const out: number[] = [];
world.state.serverTime = 3149;
out.push(heal(world, c, 10));
world.state.serverTime = 3150;
out.push(heal(world, c, 10));
world.state.serverTime = 150;
c.s.hp = c.s.maxHp - 2;
out.push(heal(world, c, 5, { lifesteal: true }));
out.push(heal(world, c, 5, { lifesteal: true }));
c.s.status = "dead";
c.s.hp = 0;
out.push(heal(world, c, 5, { lifesteal: true }));
assert.deepEqual(out, [0, 10, 2, 0, 0]);
console.log(JSON.stringify({ helper: "actual factions.heal", gains: out }));
