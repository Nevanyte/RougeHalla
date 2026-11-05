import { DEFAULT_MODULES } from "../world";
import type { Scenario, PlayerDef } from "./types";

const rows = Array.from({ length: 24 }, (_, y) => (y === 0 || y === 23 ? "#".repeat(42) : `#${".".repeat(40)}#`));
const wall = rows.map((row, y) => (y >= 5 && y <= 18 ? row.slice(0, 15) + "#" + row.slice(16) : row));
const player = (id: string, x: number, y: number, weapon0?: string): PlayerDef => ({
  id,
  faction: "holy",
  at: { x, y },
  weapon0,
});
function scene(
  name: string,
  description: string,
  players: PlayerDef[],
  drive: Scenario["drive"],
  extras: Partial<Scenario> = {},
): Scenario {
  return {
    name,
    description,
    parity: "slice",
    packet: "P-COMBAT-3",
    rows,
    randomSeed: 27,
    maxTicks: 70,
    players,
    drive,
    modules: DEFAULT_MODULES.filter((m) => m !== "consumables"),
    record: ["locks", "combat", "containers", "statuses"],
    requires: ["input:target"],
    ...extras,
  };
}
const duel = [player("p0", 400, 320, "wand"), player("p1", 600, 320)];
export const targetingScenarios: Scenario[] = [
  ...(["move", "stop"] as const).map((order) =>
    scene(
      `locked_cast_preserves_${order}`,
      `A committed wand shot keeps its target through a following ${order}.`,
      duel,
      ({ tick, send }) => {
        if (tick === 3) send("p0", "target", { id: "p1" });
        if (tick === 4) send("p0", order, order === "stop" ? { seq: 9 } : { x: 200, y: 500, seq: 9 });
      },
      { requires: ["launch", "projEnd", "input:target", "input:" + order] },
    ),
  ),
  scene(
    "locked_cast_preserves_attackMove",
    "The target steps behind a wall during the cast. The attack-move releases the lock but the committed targeted ball still leaves.",
    [player("p0", 96, 400, "wand"), player("p1", 560, 102)],
    ({ tick, send }) => {
      if (tick === 3) {
        send("p0", "target", { id: "p1" });
        send("p1", "move", { x: 560, y: 450 });
      }
      if (tick === 5) send("p0", "attackMove", { x: 100, y: 600, seq: 9 });
    },
    { rows: wall, requires: ["input:target", "input:attackMove", "launch", "projEnd"] },
  ),
  scene(
    "wand_lock_retarget",
    "A same-target re-click and unknown target preserve the cast; an accepted retarget refunds and cancels it.",
    [...duel, player("p2", 550, 400)],
    ({ tick, send }) => {
      if (tick === 3 || tick === 4) send("p0", "target", { id: "p1" });
      if (tick === 5) send("p0", "target", { id: "nobody" });
      if (tick === 6) send("p0", "target", { id: "p2" });
    },
    { requires: ["input:target", "cancel", "launch"] },
  ),
  scene(
    "wand_attack_move_acquire",
    "A point order breaks equidistant target ties by cursor distance, then resumes after the foe leaves.",
    [player("p0", 400, 320, "wand"), player("p1", 500, 320), player("p2", 400, 420), player("p3", 1200, 500)],
    ({ tick, send }) => {
      if (tick === 3) send("p0", "attackMove", { x: 400, y: 600, seq: 19 });
    },
    {
      requires: ["input:attackMove", "launch"],
      actions: [
        { tick: 21, player: "p2", kind: "remove" },
        { tick: 22, player: "p1", kind: "remove" },
      ],
    },
  ),
  scene(
    "wand_lock_chase_wall",
    "The bootstrap trail admits a target across a wall; the chase continues without a first-sight timeout.",
    [player("p0", 400, 384, "wand"), player("p1", 576, 384)],
    ({ tick, send }) => {
      if (tick === 3) send("p0", "target", { id: "p1" });
    },
    { rows: wall, maxTicks: 125 },
  ),
  scene(
    "wand_path_search_throttle",
    "Alternating point stops and wall-hidden trail targets cannot reset either 250ms path clock.",
    [player("p0", 400, 384, "wand"), player("p1", 576, 384), player("p2", 576, 410)],
    ({ tick, send }) => {
      if (tick >= 3 && tick < 24) {
        send("p0", "stop", {});
        send("p0", "target", { id: tick % 2 ? "p1" : "p2" });
      }
    },
    { rows: wall },
  ),
  scene(
    "wand_lock_range_and_swap",
    "A 641-unit target is refused; 640 units is accepted. Swapping and targeting in arrival order select the actual held weapon.",
    [{ ...player("p0", 100, 320, "wand"), weapon1: "sword" }, player("p1", 740, 320), player("p2", 741, 320)],
    ({ tick, send }) => {
      if (tick === 3) send("p0", "target", { id: "p2" });
      if (tick === 4) send("p0", "target", { id: "p1" });
      if (tick === 7) {
        send("p0", "swap", { slot: 1 });
        send("p0", "target", { id: "p2" });
      }
      if (tick === 10) {
        send("p0", "swap", { slot: 0 });
        send("p0", "target", { id: "p1" });
      }
    },
  ),
  scene(
    "wand_attack_move_id_tie",
    "With identical viewer and cursor distances attack-move consistently selects the smaller actor ID.",
    [player("p0", 400, 320, "wand"), player("p1", 500, 260), player("p2", 500, 380)],
    ({ tick, send }) => {
      if (tick === 3) send("p0", "attackMove", { x: 700, y: 320 });
    },
    { requires: ["input:attackMove", "launch"] },
  ),
  scene(
    "nonwand_attack_move",
    "A sword walks to its attack-move point, passes an eligible hostile, and finishes inside the arrival radius.",
    [player("p0", 400, 320, "sword"), player("p1", 500, 320)],
    ({ tick, send }) => {
      if (tick === 3) send("p0", "attackMove", { x: 560, y: 320, seq: 9 });
    },
    { requires: ["input:attackMove"] },
  ),
  scene(
    "wand_lock_los_grace",
    "A visible target walks into a remembered area behind a long wall. Grace starts on first lost physical sight.",
    [player("p0", 96, 400, "wand"), player("p1", 560, 102)],
    ({ tick, send }) => {
      if (tick === 3) send("p0", "target", { id: "p1" });
      if (tick === 7) send("p1", "move", { x: 560, y: 470 });
    },
    { rows: wall, maxTicks: 100 },
  ),
];
