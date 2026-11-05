import type { Scenario } from "./types";
import { DEFAULT_MODULES } from "../world";

// A one-sided trail gives live updates behind the wall, then expires while the viewer holds still.
// The centre tile is solid so the hand-placed scenario has no accidental lobby-spawn discoveries.
const rows = Array.from({ length: 28 }, (_, y) =>
  Array.from({ length: 100 }, (_, x) => {
    if (x === 0 || y === 0 || x === 99 || y === 27) return "#";
    if ((x === 20 && y >= 8 && y <= 16) || (x === 50 && y === 14)) return "#";
    return ".";
  }).join("")
);

export const visionScenarios: Scenario[] = [{
  name: "vision_trail_wall",
  description: "Installed gameplay vision reveals current motion on previously seen tiles behind a wall, to the discoverer only, until exclusive expiry.",
  parity: "slice",
  packet: "P-VISION-1",
  rows,
  randomSeed: 19,
  maxTicks: 670,
  modules: DEFAULT_MODULES.filter(m => m !== "consumables"),
  vision: {
    viewers: ["p0", "p1", "p2"],
    points: [{ x: 688, y: 464 }, { x: 656, y: 464 }, { x: 704, y: 496 }],
  },
  requires: ["state:vision", "input:move"],
  players: [
    { id: "p0", faction: "holy", at: { x: 576, y: 784 } },
    { id: "p1", faction: "fire", at: { x: 688, y: 464 } },
    { id: "p2", faction: "frost", at: { x: 2800, y: 750 } },
  ],
  drive: ({ tick, send }) => {
    if (tick === 6) send("p0", "move", { x: 576, y: 464 });
    if (tick === 60) send("p1", "move", { x: 704, y: 496 });
  },
}, {
  name: "vision_bush_coliseum",
  description: "Real seed-1 feature and region layers: bush occupants are actor-only hidden until their attack exposure takes effect, and a coliseum resident reveals its full rectangle.",
  packet: "P-VISION-1", parity: "slice", rows: [], generatedMapSeed: 1, randomSeed: 41, maxTicks: 50,
  // Isolate the installed authoritative visibility and weapon modules; this case does not
  // claim the generated camp/loot/terrain gameplay that other packets will supply.
  modules: ["weapons", "targeting", "projectiles", "abilities", "vision"],
  vision: {
    viewers: ["p0", "p1", "p2", "p3", "p4"], spawnSeed: 27,
    points: [{ x: 48, y: 208 }, { x: 2288, y: 2288 }, { x: 2256, y: 2288 }],
  },
  requires: ["state:vision", "input:attack", "launch", "projEnd"],
  players: [
    { id: "p0", faction: "holy", at: { x: 48, y: 112 } },
    { id: "p1", faction: "holy", weapon0: "wand", at: { x: 48, y: 208 } },
    { id: "p2", faction: "holy", at: { x: 48, y: 144 } },
    { id: "p3", faction: "holy", at: { x: 48, y: 304 } },
    { id: "p4", faction: "holy", at: { x: 2576, y: 2576 } },
  ],
  drive: ({tick,send}) => {
    if(tick===6) {
      send("p1", "attack", { a: Math.PI });
      send("p1", "release", { a: Math.PI });
    }
  },
}];
