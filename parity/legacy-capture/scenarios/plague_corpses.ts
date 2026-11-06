import { HOLY_MODULES } from "./holy";
import type { Scenario } from "./types";

function modules(): string[] {
  const out = [...HOLY_MODULES];
  const mods = out.indexOf("mods");
  out.splice(mods, 0, "plagueCorpses");
  out.splice(mods + 1, 0, "plagueZombies");
  return out;
}

const rows = Array.from({ length: 24 }, (_, y) =>
  y === 0 || y === 23 ? "#".repeat(40) : `#${".".repeat(38)}#`,
);

function base(name: string, description: string): Scenario {
  return {
    name, description,
    parity: "slice",
    packet: "P-FACTION-3",
    factionSlice: "plague-corpses/1",
    rows,
    randomSeed: 31,
    maxTicks: 90,
    modules: modules(),
    record: ["corpses"],
    requires: ["hit", "death"],
    players: [
      { id: "p0", faction: "plague", at: { x: 400, y: 320 }, hp: 1000, weapon0: "sword" },
      { id: "p1", faction: "holy", at: { x: 410, y: 320 }, hp: 1, weapon0: "sword" },
      { id: "p2", faction: "holy", at: { x: 600, y: 320 }, hp: 5000, weapon0: "sword" },
    ],
    drive: ({ tick, world, send }) => {
      if (tick === 2) {
        const a = Math.atan2(
          (world.state.players.get("p1")?.y ?? 320) - (world.state.players.get("p0")?.y ?? 320),
          (world.state.players.get("p1")?.x ?? 410) - (world.state.players.get("p0")?.x ?? 400),
        );
        send("p0", "attack", { a, t: 100 });
      }
    },
  };
}

export const scenarios: Scenario[] = [
  base(
    "corpse_death_auto_raise",
    "A sword kill leaves one corpse and the living Plague standing on it auto-harvests next tick, raising one owned zombie.",
  ),
  {
    ...base(
      "corpse_marker_persists_and_explicit_consume",
      "A Holy kill far from the Plague leaves the corpse marker; the Plague walks in and an explicit consumeCorpse wins before auto-harvest.",
    ),
    players: [
      { id: "p0", faction: "plague", at: { x: 400, y: 320 }, hp: 1000, weapon0: "sword" },
      { id: "p1", faction: "holy", at: { x: 520, y: 320 }, hp: 1, weapon0: "sword" },
      { id: "p2", faction: "holy", at: { x: 600, y: 320 }, hp: 5000, weapon0: "sword" },
    ],
    maxTicks: 60,
    drive: ({ tick, send }) => {
      if (tick === 2) send("p2", "attack", { a: Math.PI, t: 100 });
      if (tick === 4) send("p0", "consumeCorpse", { corpseId: "pc:p1" });
      if (tick === 5) {
        send("p0", "move", { x: 500, y: 320 });
        send("p0", "consumeCorpse", { corpseId: "pc:p1" });
      }
    },
  },
  {
    ...base(
      "corpse_zombie_assists_owner_target",
      "A wand kill raises the zombie; the owner locks a fresh target and the zombie follows and attacks it.",
    ),
    parity: "capture-only",
    players: [
      { id: "p0", faction: "plague", at: { x: 400, y: 320 }, hp: 1000, weapon0: "wand" },
      { id: "p1", faction: "holy", at: { x: 410, y: 320 }, hp: 1, weapon0: "sword" },
      { id: "p2", faction: "holy", at: { x: 520, y: 320 }, hp: 5000, weapon0: "sword" },
    ],
    maxTicks: 110,
    drive: ({ tick, send }) => {
      if (tick === 2) send("p0", "target", { id: "p1" });
      if (tick === 20) send("p0", "target", { id: "p2" });
    },
  },
];
