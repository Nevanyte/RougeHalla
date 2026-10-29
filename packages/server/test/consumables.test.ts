import { describe, expect, it } from "vitest";
import { CANNON_COOLDOWN_MS, CAMP_WARD_MS, POTION_HEAL_MS, SPEED_BOOST_MS, TICK_MS, TILE, WIND_EMBLEM_DEF, mapFromTiles, mulberry32 } from "@raid/shared";
import { combatant } from "../src/sim/combatant";
import { dropConsumable, grantConsumable, handleUseConsumable, install, updateConsumables, updateWindEmblems, WIND_EMBLEM_LIMIT } from "../src/sim/consumables";
import { enqueueClientMessage } from "../src/sim/inputs";
import { addContainer, handlePickup, spawnLoot } from "../src/sim/loot";
import { install as installMods } from "../src/sim/mods";
import { addPlayer } from "../src/sim/step";
import { payCampHeal } from "../src/sim/campHeal";
import { createWorld } from "../src/sim/world";

function rig() {
  const map = mapFromTiles(40, 40, new Uint8Array(1600));
  map.spawns = [{ x: 100, y: 100 }];
  map.groundSpots = [{ x: 300, y: 300 }, { x: 500, y: 500 }];
  const w = createWorld({ map, random: mulberry32(2), config: { minPlayers: 1, lobbySeconds: 0, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600 } });
  install(w); installMods(w);
  addPlayer(w, "p", "p", { faction: "holy" });
  const c = combatant(w, "p")!;
  if (c.kind !== "player") throw new Error("player missing");
  c.s.status = "alive"; c.s.hp = 100; c.s.maxHp = 1000; c.s.x = 100; c.s.y = 100;
  w.state.phase = "active";
  return { w, c };
}

describe("stored potions", () => {
  it("stores a picked-up large potion without healing, then pays 40% in ten steps across five seconds", () => {
    const { w, c } = rig();
    const box = dropConsumable(w, c.s, "potionLarge");
    handlePickup(w, c, { kind: "pickup", containerId: box.id });
    expect(c.s.potionLarge).toBe(1); expect(c.s.hp).toBe(100);
    handleUseConsumable(w, c, { kind: "useConsumable", consumable: "heal" });
    expect(c.s.potionLarge).toBe(0); expect(c.s.hp).toBe(100);
    w.state.serverTime = 499; updateConsumables(w); expect(c.s.hp).toBe(100);
    w.state.serverTime = 500; updateConsumables(w); expect(c.s.hp).toBe(140);
    w.state.serverTime = POTION_HEAL_MS; updateConsumables(w);
    expect(c.s.hp).toBe(500); expect(c.s.healingUntil).toBe(0);
  });
  it("uses small potions for 25%, prevents stacking, and keeps items at full health", () => {
    const { w, c } = rig();
    grantConsumable(w, c, "potionSmall", 2);
    handleUseConsumable(w, c, { kind: "useConsumable", consumable: "heal" });
    handleUseConsumable(w, c, { kind: "useConsumable", consumable: "heal" });
    expect(c.s.potionSmall).toBe(1);
    w.state.serverTime = 5000; updateConsumables(w); expect(c.s.hp).toBe(350);
    c.s.hp = c.s.maxHp;
    handleUseConsumable(w, c, { kind: "useConsumable", consumable: "heal" });
    expect(c.s.potionSmall).toBe(1);
    expect(enqueueClientMessage(c.rt.inputs, "useConsumable", { kind: "speed" })).toBe(false);
  });
  it("puts a small potion in weapon chests", () => {
    const { w } = rig();
    w.map.crateSpots = [{ x: 100, y: 100 }]; spawnLoot(w);
    const chest = [...w.state.containers.values()].find(c => c.kind === "chest")!;
    expect(chest.items.map(i => i.def)).toContain("potionSmall");
  });

  it("camp clears store a large potion automatically without a ground drop or changing HP", () => {
    const { w, c } = rig();
    w.map.camps = [{ id: "c", zone: "holy", x: 100, y: 100, r: 96, spots: [], eliteSpot: -1, chest: { x: 100, y: 100 }, area: 0, radius: 96 }];
    w.campContrib = new Map([[0, new Set([c.id])]]);
    payCampHeal(w, 0);
    expect(c.s.potionLarge).toBe(1);
    expect([...w.state.containers.values()].some(c => c.items[0]?.def === "potionLarge")).toBe(false);
    expect(c.s.hp).toBe(100);
  });
});

describe("wind emblems", () => {
  it("spawns at timed random intervals, consumes by proximity exactly once and expires after 5 seconds", () => {
    const { w, c } = rig();
    w.state.serverTime = 15000; updateWindEmblems(w);
    const emblem = [...w.state.containers.values()].find(c => c.items[0]?.def === WIND_EMBLEM_DEF)!;
    expect(emblem).toBeDefined();
    c.s.x = emblem.x; c.s.y = emblem.y;
    w.state.serverTime = 15050; updateConsumables(w);
    expect(w.state.containers.has(emblem.id)).toBe(false);
    expect(c.s.speedBoostUntil).toBe(15050 + SPEED_BOOST_MS);
    expect(c.s.speedMult).toBe(1500);
    w.state.serverTime = 15050 + SPEED_BOOST_MS; updateConsumables(w);
    expect(c.s.speedBoostUntil).toBe(0); expect(c.s.speedMult).toBe(1000);
  });
  it("never grants inventory and ignores F, caps map clutter", () => {
    const { w, c } = rig();
    const box = addContainer(w, "consumable", c.s, "Wind emblem", [{ uid: "wind", def: WIND_EMBLEM_DEF }]);
    handlePickup(w, c, { kind: "pickup", containerId: box.id });
    expect(w.state.containers.has(box.id)).toBe(true);
    expect(c.s.speedBoostUntil).toBe(0);
    for (let i = 0; i < 30; i++) { w.state.serverTime += 20_000; updateWindEmblems(w); }
    expect([...w.state.containers.values()].filter(c => c.items[0]?.def === WIND_EMBLEM_DEF).length).toBeLessThanOrEqual(WIND_EMBLEM_LIMIT);
  });
});

describe("travel cannons", () => {
  it("checks proximity, uses a shared long cooldown and marks teleport discontinuity", () => {
    const { w, c } = rig();
    const cannon = addContainer(w, "cannon", { x: 500, y: 500 }, "Cannon", []);
    cannon.targetX = 900; cannon.targetY = 900;
    handlePickup(w, c, { kind: "pickup", containerId: cannon.id }); expect(c.s.x).toBe(100);
    c.s.x = 500; c.s.y = 500;
    handlePickup(w, c, { kind: "pickup", containerId: cannon.id });
    expect(c.s.x).toBe(900); expect(c.s.displaceSeq).toBe(1); expect(cannon.readyAt).toBe(CANNON_COOLDOWN_MS);
    c.s.x = 500; c.s.y = 500;
    handlePickup(w, c, { kind: "pickup", containerId: cannon.id }); expect(c.s.x).toBe(500);
    w.state.serverTime = cannon.readyAt; w.state.gatesLocked = true;
    handlePickup(w, c, { kind: "pickup", containerId: cannon.id }); expect(c.s.x).toBe(500);
  });
});
