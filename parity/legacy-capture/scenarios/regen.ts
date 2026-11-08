import type { Scenario } from "./types";

const rows = Array.from({ length: 24 }, (_, y) =>
  y === 0 || y === 23 ? "#".repeat(40) : `#${".".repeat(38)}#`,
);

/** Player regeneration's combat clock and its two shares (legacy `sim/regen.ts`). */
export const regenScenarios: Scenario[] = [
  {
    name: "regen_clock",
    description:
      "Passive player regeneration: an untouched fighter is out of combat at once, a landed hit stamps its victim and its attacker, and exactly three seconds after the last hit both switch from the in-fight share to the out-of-fight one.",
    parity: "slice",
    packet: "P-MOBS-2",
    requires: ["windup", "hit"],
    rows,
    randomSeed: 31,
    config: { regen: true },
    players: [
      { id: "p0", faction: "holy", at: { x: 400, y: 320 }, hp: 400, weapon0: "sword" },
      { id: "p1", faction: "frost", at: { x: 432, y: 320 }, hp: 900 },
      { id: "p2", faction: "fire", at: { x: 900, y: 600 }, hp: 400 },
    ],
    maxTicks: 200,
    drive: ({ tick, send, pos, world }) => {
      if (tick === 3) {
        const a = pos("p0");
        const b = pos("p1");
        send("p0", "attack", { a: Math.atan2(b.y - a.y, b.x - a.x), t: world.state.serverTime - 50 });
      }
      if (tick === 8) send("p0", "release", { a: 0 });
    },
  },
];
