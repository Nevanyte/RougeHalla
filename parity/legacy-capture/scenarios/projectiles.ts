import { DEFAULT_MODULES } from "../world";
import type { PlayerDef, Scenario } from "./types";

const rows = Array.from({ length: 24 }, (_, y) =>
  y === 0 || y === 23 ? "#".repeat(42) : `#${".".repeat(40)}#`
);

function player(id: string, x: number, weapon0?: string, y = 320): PlayerDef {
  return { id, faction: "holy", at: { x, y }, weapon0 };
}

function battle(
  name: string, description: string, players: PlayerDef[], requires: string[], drive: Scenario["drive"],
): Scenario {
  return {
    name, description, parity: "slice", packet: "P-COMBAT-2", rows, randomSeed: 27, maxTicks: 96,
    modules: DEFAULT_MODULES.filter(m => m !== "consumables"), record: ["combat", "containers", "statuses"],
    requires: ["launch", "projEnd", ...requires], players, drive,
  };
}

const trade: Scenario["drive"] = ({ tick, send }) => {
  if (tick === 3) {
    send("p0", "attack", { a: 0 });
    send("p1", "attack", { a: Math.PI });
  }
};

export const projectileScenarios: Scenario[] = [
  battle(
    "bow_duel", "Bows trade directional shots. The first archer walks through the start of a lagged draw, then corrects aim before release.",
    [player("p0", 320, "bow"), player("p1", 710, "bow")], ["hit", "end:hit"],
    ({ tick, send }) => {
      if (tick === 3) {
        send("p0", "move", { x: 430, y: 320 });
        send("p0", "attack", { a: 0.35, t: 0 });
        send("p1", "attack", { a: Math.PI });
      }
      if (tick === 6) send("p0", "aim", { a: 0 });
    },
  ),
  battle(
    "wand_duel", "Directional casts keep their starting aim; each shot lands through five swept substeps per tick.",
    [player("p0", 320, "wand"), player("p1", 710, "wand")], ["hit", "end:hit"], trade,
  ),
  battle(
    "ball_vs_arrow", "A head-on ball deletes an arrow and lands with reduced damage.",
    [player("p0", 320, "wand"), player("p1", 710, "bow")], ["end:deleted", "hit"], trade,
  ),
  battle(
    "sword_swing_ball", "A timed sword swing halves an approaching ball; an axe destroys later balls on the same path.",
    [player("p0", 320, "wand"), { ...player("p1", 550, "sword"), weapon1: "axe" }], ["swing", "hit", "end:destroyed"],
    ({ tick, send }) => {
      if (tick === 3) send("p0", "attack", { a: 0 });
      if (tick === 18) send("p1", "attack", { a: Math.PI });
      if (tick === 57) send("p1", "swap", { slot: 1 });
    },
  ),
  battle(
    "shield_arrow_reflect", "The shield holder takes the unreturned damage; the reflected arrow strikes its original owner.",
    [player("p0", 320, "bow"), player("p1", 660, "shield")], ["block", "end:reflected", "hit"],
    ({ tick, send }) => {
      if (tick === 3) {
        send("p0", "attack", { a: 0 });
        send("p1", "aim", { a: Math.PI });
      }
    },
  ),
  battle(
    "wand_splash_group", "One ball hits the primary and splashes the nearby bystander; a distant fourth player takes neither hit.",
    [player("p0", 320, "wand"), player("p1", 560), player("p2", 565, undefined, 352), player("p3", 870)], ["hit", "end:hit"],
    ({ tick, send }) => {
      if (tick === 3) send("p0", "attack", { a: 0 });
    },
  ),
  {
    ...battle(
      "projectile_outlives_owner", "An archer leaves with a shot in flight; the departed shooter's name still receives the kill.",
      [player("p0", 320, "bow"), { ...player("p1", 770), hp: 1 }, player("p2", 950)], ["action:remove", "hit", "death"],
      ({ tick, send }) => {
        if (tick === 3) {
          send("p0", "attack", { a: 0 });
          send("p0", "release", { a: 0 });
        }
      },
    ),
    actions: [{ tick: 15, player: "p0", kind: "remove" }],
  },
];
