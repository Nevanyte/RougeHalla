import { describe, expect, it } from "vitest";
import {
  decodeMult, FIRE_ROAM_BURST_BASE, FIRE_ROAM_RAMP_MS, TICK_MS, mapFromTiles, mitigateShares, mulberry32, TILE_FLOOR, TILE_WALL,
} from "@raid/shared";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { addMob } from "../src/sim/mobs";
import { addPlayer, step } from "../src/sim/step";
import { factionOf } from "../src/sim/combatant";
import type { DamagePacket, World } from "../src/sim/world";

function makeWorld(): World {
  const side = 32;
  const tiles = new Uint8Array(side * side).fill(TILE_FLOOR);
  for (let i = 0; i < side; i++) {
    tiles[i] = tiles[(side - 1) * side + i] = TILE_WALL;
    tiles[i * side] = tiles[i * side + side - 1] = TILE_WALL;
  }
  const map = mapFromTiles(side, side, tiles);
  map.spawns = [{ x: 200, y: 200 }, { x: 300, y: 200 }, { x: 400, y: 200 }];
  const world = createGameWorld({
    config: {
      minPlayers: 2, lobbySeconds: 0, fillSeconds: 0, patienceSeconds: 1e9, patienceMinSeconds: 1e9,
      suddenDeathSeconds: 1e9, pvpRules: false, mobs: false,
    },
    random: mulberry32(1), map,
  });
  addPlayer(world, "fire", "Fire", { faction: "fire" });
  addPlayer(world, "foe-a", "Foe A", { faction: "frost" });
  addPlayer(world, "foe-b", "Foe B", { faction: "holy" });
  step(world, TICK_MS);
  for (const p of world.state.players.values()) {
    p.hp = p.maxHp = 1e6;
  }
  return world;
}

function ageToFullCharge(world: World): void {
  step(world, FIRE_ROAM_RAMP_MS);
  expect(world.state.players.get("fire")!.roamCharge).toBe(1000);
  expect(world.state.players.get("fire")!.roamReady).toBe(true);
}

function packet(raw: number): DamagePacket {
  return { raw, phys: 0, magic: 1, true: 0 };
}

function place(world: World, id: string, x: number, y: number): void {
  const p = world.state.players.get(id)!;
  p.x = x;
  p.y = y;
  const rt = world.players.get(id)!;
  rt.path = [];
  rt.history = [{ t: world.state.serverTime, x, y }];
}

function armAuto(world: World): DamagePacket {
  const c = combatant(world, "fire")!;
  const hit = packet(1);
  c.rt.weapon.action = {
    kind: "swing", weapon: "sword", startedAt: world.state.serverTime, landsAt: world.state.serverTime + 500, a: 0, packet: hit,
  };
  world.hooks.attackStarted?.(world, c);
  return hit;
}

describe("authoritative Fire roaming charge", () => {
  it("uses a half ramp for 1.25x speed, then drops the movement bonus on the damage update without arming", () => {
    const world = makeWorld();
    step(world, FIRE_ROAM_RAMP_MS / 2);
    const fire = world.state.players.get("fire")!;
    expect(fire.roamCharge).toBe(500);
    expect(decodeMult(fire.speedMult)).toBeCloseTo(1.25, 3);

    recordHit(world, {
      victim: "fire", by: { id: "foe-a", name: "Foe A" }, packet: packet(10), weapon: "sword", stagger: false,
    });
    applyLedger(world);
    expect(fire.roamCharge).toBe(0);
    expect(fire.roamReady).toBe(false);
    step(world, TICK_MS);
    expect(decodeMult(fire.speedMult)).toBeCloseTo(1, 2);
    expect(fire.roamReady).toBe(false);
  });

  it("resets charge for real damage taken from and dealt to a regional mob", () => {
    const world = makeWorld();
    const mob = addMob(world, { kind: "dummy", name: "Mob", faction: "plague", at: { x: 600, y: 600 }, hp: 1e6 });
    const fire = world.state.players.get("fire")!;
    step(world, FIRE_ROAM_RAMP_MS / 2);
    expect(fire.roamCharge).toBe(500);

    recordHit(world, { victim: "fire", by: { id: mob, name: "Mob" }, packet: packet(10), weapon: "sword", stagger: false });
    applyLedger(world);
    expect(fire.roamCharge).toBe(0);
    expect(fire.roamReady).toBe(false);

    step(world, FIRE_ROAM_RAMP_MS / 2);
    expect(fire.roamCharge).toBe(500);
    recordHit(world, { victim: mob, by: { id: "fire", name: "Fire" }, packet: packet(10), weapon: "sword", stagger: false });
    applyLedger(world);
    expect(fire.roamCharge).toBe(0);
    expect(fire.roamReady).toBe(false);
  });

  it("arms at the real 20-second mark and the actual sword engine consumes one burst across its two-target arc", () => {
    const world = makeWorld();
    const fire = world.state.players.get("fire")!;
    fire.weapon0 = "sword";
    place(world, "fire", 400, 400);
    place(world, "foe-a", 435, 400);
    place(world, "foe-b", 435, 410);
    ageToFullCharge(world);

    expect(enqueueClientMessage(world.players.get("fire")!.inputs, "attack", { a: 0 })).toBe(true);
    expect(enqueueClientMessage(world.players.get("fire")!.inputs, "release", { a: 0 })).toBe(true);
    const events = step(world, TICK_MS);
    expect(world.players.get("fire")!.weapon.action).toBeNull();
    expect(events.filter(e => e.type === "fx" && e.fx.kind === "swing" && e.fx.by === "fire")).toHaveLength(1);
    const direct = world.combat.landed.filter(hit => hit.by === "fire" && hit.weapon === "sword" && !hit.sig && !hit.derived);
    expect(direct.map(hit => hit.victim).sort()).toEqual(["foe-a", "foe-b"]);

    expect(fire.roamReady).toBe(false);
    expect(world.combat.deferred).toHaveLength(1);
    const hitVictim = world.combat.deferred[0]!.victim;
    const victim = world.state.players.get(hitVictim)!;
    const hpBeforeBurst = victim.hp;
    const expected = mitigateShares(
      FIRE_ROAM_BURST_BASE,
      { phys: 0, magic: 1, true: 0 },
      factionOf(combatant(world, hitVictim)!.s)!,
    );
    step(world, TICK_MS);
    const landedBurst = world.combat.landed.find((hit) => hit.by === "fire" && hit.victim === hitVictim && hit.derived);
    expect(landedBurst?.amount).toBeCloseTo(expected, 3);
    expect(hpBeforeBurst - victim.hp).toBeGreaterThanOrEqual(expected);
    expect(expected).toBeLessThan(FIRE_ROAM_BURST_BASE);
    expect(world.combat.deferred).toHaveLength(0);
  });

  it("resets movement charge on damage while preserving an armed burst, which a landed auto consumes once", () => {
    const world = makeWorld();
    ageToFullCharge(world);
    recordHit(world, {
      victim: "fire", by: { id: "foe-a", name: "Foe A" }, packet: packet(10), weapon: "sword", stagger: false,
    });
    applyLedger(world);
    const fire = world.state.players.get("fire")!;
    expect(fire.roamCharge).toBe(0);
    expect(fire.roamReady).toBe(true);

    const chargedAuto = armAuto(world);
    recordHit(world, { victim: "foe-a", by: { id: "fire", name: "Fire" }, packet: chargedAuto, weapon: "sword", stagger: false });
    recordHit(world, { victim: "foe-b", by: { id: "fire", name: "Fire" }, packet: chargedAuto, weapon: "sword", stagger: false });
    applyLedger(world);
    expect(fire.roamReady).toBe(false);
    expect(world.combat.deferred).toHaveLength(1);
    expect(world.combat.deferred[0]!.packet.raw).toBe(FIRE_ROAM_BURST_BASE);
    expect(world.combat.deferred[0]!.packet.magic).toBe(1);

    const hpBeforeBurst = world.state.players.get("foe-a")!.hp;
    const expectedBurstDamage = mitigateShares(FIRE_ROAM_BURST_BASE, { phys: 0, magic: 1, true: 0 }, factionOf(combatant(world, "foe-a")!.s)!);
    step(world, TICK_MS);
    expect(hpBeforeBurst - world.state.players.get("foe-a")!.hp).toBeCloseTo(expectedBurstDamage, 4);
    expect(expectedBurstDamage).toBeGreaterThan(0);
    expect(expectedBurstDamage).toBeLessThan(FIRE_ROAM_BURST_BASE);
    expect(world.combat.deferred).toHaveLength(0);
  });

  it("keeps a full charge armed through a missed or blocked attack and applies speed only out of combat", () => {
    const world = makeWorld();
    ageToFullCharge(world);
    const fire = world.state.players.get("fire")!;
    expect(decodeMult(fire.speedMult)).toBeCloseTo(1.5, 3);

    armAuto(world); // no ledger entry: miss / blocked hit
    expect(fire.roamReady).toBe(true);
    expect(world.combat.deferred).toHaveLength(0);

    recordHit(world, {
      victim: "fire", by: { id: "foe-a", name: "Foe A" }, packet: packet(10), weapon: "sword", stagger: false,
    });
    applyLedger(world);
    step(world, TICK_MS);
    expect(decodeMult(fire.speedMult)).toBeCloseTo(1, 2);
    expect(fire.roamCharge).toBeLessThan(3); // the next fixed step has already begun the new out-of-combat ramp
    expect(fire.roamReady).toBe(true);
  });
});
