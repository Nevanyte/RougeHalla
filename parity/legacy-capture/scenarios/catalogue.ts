import type { FactionId } from "@raid/shared";
import { MODULES } from "../world";
import type { Scenario, Ctx } from "./types";

const rows = Array.from({ length: 24 }, (_, y) => y === 0 || y === 23 ? "#".repeat(40) : `#${".".repeat(38)}#`);
const base = (name: string, packet: string, description: string): Scenario => ({
  name, packet, description, parity: "capture-only", rows, randomSeed: 12,
  players: [{ id: "p0", faction: "fire", at: { x: 400, y: 320 } }, { id: "p1", faction: "holy", at: { x: 456, y: 320 } }],
  maxTicks: 100, drive: () => {},
});
const duel = ({ tick, send, pos, world }: Ctx) => {
  if (tick !== 3) return;
  for (const [id, target] of [["p0", "p1"], ["p1", "p0"]]) {
    const a = pos(id!), b = pos(target!);
    send(id!, "attack", { a: Math.atan2(b.y - a.y, b.x - a.x), t: world.state.serverTime - 50 });
  }
};

/** Executable baseline cases. Each packet expands its own cases and promotes them only when every stream compares. */
export const catalogue: Scenario[] = [
  {
    ...base("swap_pickup", "P-COMBAT-1", "Swap from sword to axe, then pick up a loose bow through the real loot validator."),
    containers: [{ weapon: "bow", at: { x: 400, y: 320 } }],
    record: ["containers"], requires: ["input:swap", "input:pickup"],
    players: [{ id: "p0", faction: "fire", at: { x: 400, y: 320 }, weapon0: "sword", weapon1: "axe" }, { id: "p1", faction: "holy", at: { x: 650, y: 320 } }],
    drive: ({ tick, send, world }) => {
      if (tick === 3) send("p0", "swap", {});
      if (tick === 5) send("p0", "pickup", { containerId: [...world.state.containers.keys()][0] });
    },
  },
  ...["sword", "axe", "shield"].map((weapon): Scenario => ({
    ...base(`${weapon}_duel`, "P-COMBAT-1", `${weapon} against a front-facing shield: windup, swing and shield interactions.`),
    requires: ["windup", "swing"],
    players: [{ id: "p0", faction: "fire", at: { x: 400, y: 320 }, weapon0: weapon }, { id: "p1", faction: "holy", at: { x: 456, y: 320 }, weapon0: "shield" }],
    drive: duel,
  })),
  {
    ...base("wand_lock", "P-COMBAT-3", "Wand target lock follows a moving enemy, then stop cancels the lock."),
    parity: "slice", record: ["locks", "combat", "containers", "statuses"],
    requires: ["input:target", "projEnd", "launch"],
    players: [{ id: "p0", faction: "fire", at: { x: 400, y: 320 }, weapon0: "wand" }, { id: "p1", faction: "holy", at: { x: 600, y: 320 } }],
    drive: ({ tick, send }) => {
      if (tick === 3) send("p0", "target", { id: "p1" });
      if (tick === 20) send("p1", "move", { x: 700, y: 350 });
      if (tick === 80) send("p0", "stop", {});
    },
  },
  ...(["fire", "frost", "holy", "plague", "sentenced"] as FactionId[]).map((faction): Scenario => ({
    ...base(`signature_${faction}`, "P-FACTION-1", `${faction} signature in sustained close combat; full faction module order, including passives.`),
    modules: Object.keys(MODULES).filter(name => name !== "walkHint"),
    record: ["statuses", "fields"], requires: ["hit"], maxTicks: 160,
    players: [{ id: "p0", faction, at: { x: 400, y: 320 } }, { id: "p1", faction: "holy", at: { x: 456, y: 320 } }],
    drive: duel,
  })),
  {
    ...base("planning", "P-ARENA-1", "A short planning deal expires into the run; private plan payloads are preserved."),
    config: { planSeconds: 1 }, requires: ["raidStarted"], maxTicks: 25,
  },
  {
    ...base("coliseum_sudden_death", "P-ARENA-1", "Scheduled coliseum teleport followed by the accelerated sudden-death clock."),
    config: { firstPatienceSeconds: 0.1, patienceSeconds: 0.1, patienceMinSeconds: 0.1, suddenDeathSeconds: 0.1, coliseumSchedule: { firstSeconds: 0.1, secondSeconds: 10, repeatSeconds: 10, minGapSeconds: 0 } },
    requires: ["teleport", "death", "victory"], maxTicks: 2000,
  },
  {
    ...base("mob_camp", "P-MOBS-1", "A real generated map spawns regional camp rosters; a fighter approaches the first camp."),
    generatedMapSeed: 1, config: { mobs: true }, record: ["mobs", "containers"], requires: ["state:mobs"], maxTicks: 4,
    drive: ({ tick, send, world }) => {
      if (tick === 3) {
        const mob = [...world.state.mobs.values()][0];
        if (!mob) throw new Error("mob_camp: generated map spawned no mobs");
        send("p0", "move", { x: mob.x, y: mob.y });
      }
    },
  },
];
