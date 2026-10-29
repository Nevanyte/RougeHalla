import { describe, expect, it } from "vitest";
import { Decoder, Encoder, Reflection } from "@colyseus/schema";
import { CAMP_RESPAWN_MS, elitesOf, mapFromTiles, mulberry32, TILE, VISION_TRAIL_MS } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { CAMP_CLEARED, CAMP_IDLE, install as installCamps } from "../src/sim/camps";
import { combatant } from "../src/sim/combatant";
import { hurtMob, install as installMobLife, killMob, reapMobs, respawnCamps, spawnRegionalMobs, type MobCombatant } from "../src/sim/mobLife";
import { addPlayer, removePlayer } from "../src/sim/step";
import { canPlayerSee, getVisionMemory, install as installVision, refreshVision } from "../src/sim/vision";
import { createWorld, type LedgerEntry, type SimConfig, type World } from "../src/sim/world";

const at = (x: number, y: number) => ({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE });
const CONFIG: SimConfig = {
  minPlayers: 2, lobbySeconds: 0, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 60, mobs: true,
};
function make(twoEliteCamps = false): World {
  const map = mapFromTiles(120, 16, new Uint8Array(1920), 42);
  map.camps = [2, 60].map((x, i) => ({
    id: `fire-${i}`, zone: "fire", ...at(x, 6), r: 100, eliteSpot: i === 0 || twoEliteCamps ? 0 : -1,
    spots: [at(x, 5), at(x + 1, 6), at(x, 7)], chest: at(x, 6), area: 0, radius: 0,
  }));
  const w = createWorld({ seed: 42, config: { ...CONFIG }, random: mulberry32(3), rewardSalt: 817, map });
  installCamps(w); installMobLife(w); installVision(w);
  for (const id of ["p0", "p1"]) {
    const p = addPlayer(w, id, id);
    p.status = "alive";
    Object.assign(p, at(110, id === "p0" ? 4 : 8));
  }
  w.state.phase = "active";
  w.state.serverTime = 1000;
  spawnRegionalMobs(w);
  return w;
}
const mobs = (w: World, camp: number): MobCombatant[] => [...w.state.mobs]
  .filter(([, s]) => s.camp === camp + 1)
  .map(([id]) => combatant(w, id) as MobCombatant);
const hit = (victim: string, by: string, raw: number): LedgerEntry => ({
  victim, by: { id: by, name: by }, packet: { raw, phys: 1, magic: 0, true: 0 }, weapon: "sword", scale: 1, stagger: false,
});
function clear(w: World, camp = 0, owner = "p0"): void {
  for (const mob of mobs(w, camp)) hurtMob(w, mob, [mob.s.maxHp], [hit(mob.id, owner, mob.s.maxHp)]);
}

describe("camp clear clocks and wards", () => {
  it("starts its public respawn and owner ward only when the final mob dies", () => {
    const w = make(), camp = w.state.camps[0]!, group = mobs(w, 0);
    hurtMob(w, group[0]!, [group[0]!.s.maxHp], [hit(group[0]!.id, "p0", group[0]!.s.maxHp)]);
    expect(camp.alive).toBe(2);
    expect(camp.clearedAt).toBe(0);
    expect(camp.respawnAt).toBe(0);
    expect(camp.wardOwner).toBe("");
    w.state.serverTime = 4000;
    for (const mob of group.slice(1)) hurtMob(w, mob, [mob.s.maxHp], [hit(mob.id, "p0", mob.s.maxHp)]);
    expect(camp.alive).toBe(0);
    expect(camp.state).toBe(CAMP_CLEARED);
    expect(camp.clearedAt).toBe(4000);
    expect(camp.respawnAt).toBe(4000 + CAMP_RESPAWN_MS);
    expect(camp.wardOwner).toBe("p0");
    expect(camp.wardExpiresAt).toBe(camp.respawnAt);
    expect(w.state.camps[1]!.state).toBe(CAMP_IDLE);
    // Corpses and repeated kills do not reset the timer or hand off ownership.
    w.state.serverTime += 1000;
    killMob(w, group[2]!, [hit(group[2]!.id, "p1", 99999)], [99999]);
    reapMobs(w, 50);
    expect(camp.clearedAt).toBe(4000);
    expect(camp.wardOwner).toBe("p0");
  });

  it("credits the final mob's whole-fight killer, even if another player lands the final hit", () => {
    const w = make(), group = mobs(w, 0);
    for (const mob of group.slice(0, -1)) killMob(w, mob, [], []);
    const last = group[2]!;
    last.rt.brain!.threat.set("p0", last.s.maxHp * 0.9);
    last.s.hp = last.s.maxHp * 0.1;
    hurtMob(w, last, [last.s.hp], [hit(last.id, "p1", last.s.hp)]);
    expect(w.state.camps[0]!.wardOwner).toBe("p0");
  });

  it("gives only the clearing player live ward vision and ends it exactly at the deadline, without residual trail", () => {
    const w = make(), site = w.map.camps[0]!;
    clear(w);
    const deadline = w.state.camps[0]!.respawnAt;
    expect(canPlayerSee(w, "p0", site)).toBe(true);
    expect(canPlayerSee(w, "p1", site)).toBe(false);
    expect(getVisionMemory(w, "p0")!.canSee(site, w.state.serverTime)).toBe(false);
    w.state.serverTime = deadline - 1;
    expect(canPlayerSee(w, "p0", site)).toBe(true);
    w.state.serverTime = deadline;
    // Even before the due-spawn system runs, a stale ward timestamp cannot leak vision beyond its deadline.
    expect(w.state.camps[0]!.state).toBe(CAMP_CLEARED);
    expect(canPlayerSee(w, "p0", site)).toBe(false);
    w.state.serverTime = deadline + VISION_TRAIL_MS;
    expect(canPlayerSee(w, "p0", site)).toBe(false);
  });

  it("environmental clears get a public deadline and no owned ward", () => {
    const w = make();
    for (const mob of mobs(w, 0)) killMob(w, mob, [], []);
    expect(w.state.camps[0]!.respawnAt).toBe(1000 + CAMP_RESPAWN_MS);
    expect(w.state.camps[0]!.wardOwner).toBe("");
    expect(w.state.camps[0]!.wardExpiresAt).toBe(0);
  });

  it("publishes clocks, alive count and ward ownership in schema patches", () => {
    const w = make(), encoder = new Encoder(w.state);
    const decoder = Reflection.decode(Reflection.encode(encoder)) as Decoder<RaidState>;
    decoder.decode(encoder.encodeAll()); encoder.discardChanges();
    clear(w);
    decoder.decode(encoder.encode()); encoder.discardChanges();
    const camp = decoder.state.camps[0]!;
    expect(camp.alive).toBe(0);
    expect(camp.clearedAt).toBe(1000);
    expect(camp.respawnAt).toBe(181000);
    expect(camp.wardExpiresAt).toBe(181000);
    expect(camp.wardOwner).toBe("p0");
    w.state.serverTime = camp.respawnAt; respawnCamps(w);
    decoder.decode(encoder.encode()); encoder.discardChanges();
    expect(decoder.state.camps[0]!.alive).toBe(3);
    expect(decoder.state.camps[0]!.respawnAt).toBe(0);
    expect(decoder.state.camps[0]!.wardOwner).toBe("");
  });
});

describe("repeated full camp respawns", () => {
  it("respawns the same complete roster with full health, clean brains and fresh ids at each exact deadline", () => {
    const w = make(), other = mobs(w, 1).map((m) => m.id), seen = new Set<string>();
    const roster = mobs(w, 0).map((m) => [m.s.type, m.s.kind, m.s.maxHp]);
    for (let cycle = 0; cycle < 4; cycle++) {
      const previous = mobs(w, 0);
      for (const mob of previous) { expect(seen.has(mob.id)).toBe(false); seen.add(mob.id); }
      clear(w, 0, cycle % 2 === 0 ? "p0" : "p1");
      const deadline = w.state.camps[0]!.respawnAt;
      w.state.serverTime = deadline - 1; respawnCamps(w);
      expect(w.state.camps[0]!.alive).toBe(0);
      w.state.serverTime = deadline; respawnCamps(w);
      const fresh = mobs(w, 0);
      expect(fresh).toHaveLength(3);
      expect(fresh.map((m) => [m.s.type, m.s.kind, m.s.maxHp])).toEqual(roster);
      for (const [i, mob] of fresh.entries()) {
        expect(mob.s.hp).toBe(mob.s.maxHp);
        expect(mob.s.status).toBe("alive");
        expect(mob.rt.brain!.mode).toBe("idle");
        expect(mob.rt.brain!.threat.size).toBe(0);
        expect(mob.rt.path).toEqual([]);
        expect({ x: mob.s.x, y: mob.s.y }).toEqual(w.map.camps[0]!.spots[i]);
      }
      expect(previous.every((m) => !w.state.mobs.has(m.id) && !w.mobs.has(m.id))).toBe(true);
      expect(w.state.camps[0]!.state).toBe(CAMP_IDLE);
      expect(w.state.camps[0]!.clearedAt).toBe(0);
      expect(w.state.camps[0]!.wardExpiresAt).toBe(0);
      expect(w.state.camps[0]!.wardOwner).toBe("");
      respawnCamps(w); // idempotent if a system is invoked twice on the due tick
      expect(mobs(w, 0).map((m) => m.id)).toEqual(fresh.map((m) => m.id));
      expect(mobs(w, 1).map((m) => m.id)).toEqual(other);
    }
  });

  it("preserves the second published elite type when its full camp returns", () => {
    const w = make(true), camp = w.state.camps[1]!;
    expect(camp.elite).toBe(elitesOf("fire")[1]!.id);
    const roster = mobs(w, 1).map((mob) => [mob.s.type, mob.s.kind, mob.s.maxHp]);
    const firstCycle = mobs(w, 1).map((mob) => mob.id);
    clear(w, 1);
    w.state.serverTime = camp.respawnAt;
    respawnCamps(w);
    const returned = mobs(w, 1);
    expect(returned.map((mob) => [mob.s.type, mob.s.kind, mob.s.maxHp])).toEqual(roster);
    expect(returned.find((mob) => mob.s.kind === "elite")!.s.type).toBe(camp.elite);
    expect(returned.every((mob) => !firstCycle.includes(mob.id))).toBe(true);
  });

  it("does not resurrect partially cleared camps", () => {
    const w = make(), group = mobs(w, 0);
    killMob(w, group[0]!, [], []);
    w.state.serverTime += CAMP_RESPAWN_MS * 2;
    reapMobs(w, 50); respawnCamps(w);
    expect(w.state.camps[0]!.alive).toBe(2);
    expect(mobs(w, 0)).toHaveLength(2);
    expect(w.state.camps[0]!.respawnAt).toBe(0);
  });

  it("respawns at the deadline even while coliseum gates are locked", () => {
    const w = make(); clear(w);
    const deadline = w.state.camps[0]!.respawnAt;
    w.state.serverTime = deadline - 1;
    w.state.gatesLocked = true; respawnCamps(w);
    expect(w.state.camps[0]!.alive).toBe(0);
    expect(w.state.camps[0]!.respawnAt).toBe(deadline);
    w.state.serverTime = deadline; respawnCamps(w);
    expect(w.state.camps[0]!.alive).toBe(3);
    expect(w.state.camps[0]!.wardOwner).toBe("");
    expect(w.state.camps[0]!.wardExpiresAt).toBe(0);
    expect(mobs(w, 0).every((mob) => mob.s.status === "alive" && mob.s.hp === mob.s.maxHp)).toBe(true);
    expect(w.state.gatesLocked).toBe(true);
  });

  it("never spawns after the run ends, in training, or when regional mobs are disabled", () => {
    const w = make(); clear(w);
    w.state.serverTime = w.state.camps[0]!.respawnAt;
    w.state.phase = "ended"; respawnCamps(w);
    expect(w.state.camps[0]!.alive).toBe(0);
    w.state.phase = "active";
    w.config.training = true; respawnCamps(w);
    expect(w.state.camps[0]!.alive).toBe(0);
    w.config.training = false;
    w.config.mobs = false; respawnCamps(w);
    expect(w.state.camps[0]!.alive).toBe(0);
    w.config.mobs = true; respawnCamps(w);
    expect(w.state.camps[0]!.alive).toBe(3);
  });
});

describe("server private vision memory", () => {
  it("retains live trail per player and expires it exactly two minutes after a refresh", () => {
    const w = make(), p = w.state.players.get("p0")!, site = w.map.camps[0]!;
    Object.assign(p, site); refreshVision(w);
    expect(canPlayerSee(w, "p0", site)).toBe(true);
    expect(canPlayerSee(w, "p1", site)).toBe(false);
    Object.assign(p, at(110, 4));
    w.state.serverTime += VISION_TRAIL_MS - 1;
    expect(canPlayerSee(w, "p0", site)).toBe(true);
    w.state.serverTime++;
    expect(canPlayerSee(w, "p0", site)).toBe(false);
  });

  it("resets discovery on base map changes and removal but preserves it across gate changes and temporary reconnects", () => {
    const w = make(), p = w.state.players.get("p0")!, site = w.map.camps[0]!;
    Object.assign(p, site); refreshVision(w);
    const original = getVisionMemory(w, "p0")!;
    Object.assign(p, at(110, 4));
    w.state.gatesLocked = true;
    expect(getVisionMemory(w, "p0")).toBe(original);
    expect(original.canSee(site, w.state.serverTime)).toBe(true);
    w.map = { ...w.map, seed: 99 };
    expect(getVisionMemory(w, "p0")).not.toBe(original);
    expect(canPlayerSee(w, "p0", site)).toBe(false);
    removePlayer(w, "p0");
    expect(getVisionMemory(w, "p0")).toBeNull();
  });

  it("denies missing/down players and keeps training unrestricted", () => {
    const w = make();
    expect(canPlayerSee(w, "missing", at(110, 4))).toBe(false);
    w.state.players.get("p0")!.status = "dead";
    expect(canPlayerSee(w, "p0", at(110, 4))).toBe(false);
    w.config.training = true;
    expect(canPlayerSee(w, "p0", w.map.camps[0]!)).toBe(true);
  });
});
