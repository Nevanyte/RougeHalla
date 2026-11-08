import type { Scenario } from "./types";
import { HOLY_MODULES } from "./holy";

/** The explicit legacy module list of the Fire roam slice: the five-faction foundation plus the auxiliary Fire roam
 * installer at its `createGameWorld` position (after `cardHooks`, before `mods`). */
export const FIRE_ROAM_MODULES = (() => {
  const out: string[] = [];
  for (const m of HOLY_MODULES) {
    if (m === "mods") out.push("fireRoam");
    out.push(m);
  }
  return out;
})();

const rows = Array.from({ length: 24 }, (_, y) => (y === 0 || y === 23 ? "#".repeat(40) : `#${".".repeat(38)}#`));
const SLICE = "player-engagement-holy-plague-fire-frost-sentenced-fireroam/1" as const;
const base: Scenario = {
  name: "",
  description: "",
  packet: "P-FACTION-2",
  parity: "slice",
  factionSlice: SLICE,
  modules: FIRE_ROAM_MODULES,
  rows,
  randomSeed: 12,
  maxTicks: 480,
  record: ["combat", "statuses", "containers", "plague", "roam"],
  players: [],
  drive: () => {},
};

export const fireRoamScenarios: Scenario[] = [
  {
    ...base,
    name: "fire_roam_charge_burst",
    description:
      "Fire roams out of combat for the full 20 s ramp while walking early (charge-scaled movement), then a landed sword auto consumes the one armed burst as a next-tick derived physical hit; a later hit cannot repeat it.",
    requires: ["hit", "input:move", "input:stop"],
    players: [
      { id: "p0", faction: "fire", at: { x: 400, y: 320 }, hp: 900, weapon0: "sword" },
      { id: "p1", faction: "holy", at: { x: 456, y: 320 }, hp: 900 },
    ],
    drive: ({ tick, send }) => {
      if (tick === 5) send("p0", "move", { x: 344, y: 320, seq: 1 });
      if (tick === 60) send("p0", "stop", { seq: 2 });
      if (tick === 90) send("p0", "move", { x: 400, y: 320, seq: 3 });
      if (tick === 150) send("p0", "stop", { seq: 4 });
      // Charged at serverTime 20050 (tick 401): tick 405's sword auto consumes the burst, paid next tick.
      if (tick === 405) send("p0", "attack", { a: 0 });
      if (tick === 406) send("p0", "release", { a: 0 });
      // The charge restarts on the hit, so this later hit cannot pay a second burst.
      if (tick === 440) send("p0", "attack", { a: 0 });
      if (tick === 441) send("p0", "release", { a: 0 });
    },
  },
  {
    ...base,
    name: "fire_roam_ranged_arm",
    description:
      "Arming is decided at the attack start: a bow draw begun one tick before full charge is not armed even though it lands after the ramp completes; the next draw, started while armed, lands its burst across the arrow's flight.",
    maxTicks: 470,
    requires: ["hit", "launch"],
    players: [
      { id: "p0", faction: "fire", at: { x: 400, y: 320 }, hp: 900, weapon0: "bow" },
      { id: "p1", faction: "holy", at: { x: 620, y: 320 }, hp: 900 },
    ],
    drive: ({ tick, send }) => {
      // Draw starts at 19.75 s: not armed; the ramp completes while the arrow is in flight, so the hit must not burst.
      if (tick === 396) send("p0", "attack", { a: 0 });
      if (tick === 397) send("p0", "release", { a: 0 });
      // This draw starts while armed and lands after the flight: the burst is paid on its hit.
      if (tick === 420) send("p0", "attack", { a: 0 });
      if (tick === 421) send("p0", "release", { a: 0 });
    },
  },
];
