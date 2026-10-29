import { describe, expect, it } from "vitest";
import { CampState } from "@raid/shared/schema";
import {
  circleClear, FACTIONS, mapFromTiles, mulberry32, plagueZombieStats, PLAGUE_ZOMBIE_ASSIST_MS, TICK_MS,
  TILE_FLOOR, TILE_WALL,
} from "@raid/shared";
import { downPlayer, teleportToColiseum } from "../src/sim/arena";
import { campContribOf } from "../src/sim/campHeal";
import { grantCard } from "../src/sim/chests";
import { combatant, factionOf, hostile } from "../src/sim/combatant";
import { displace } from "../src/sim/displace";
import { noteContact } from "../src/sim/factions";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { applyLedger, pvpScale, recordHit } from "../src/sim/ledger";
import { placeMob } from "../src/sim/mobLife";
import { addMob } from "../src/sim/mobs";
import { updateZombies } from "../src/sim/plagueZombies";
import { getVisionMemory } from "../src/sim/vision";
import { statusesOf } from "../src/sim/status";
import { addPlayer, removePlayer, step } from "../src/sim/step";
import { packetFor } from "../src/sim/weapons";
import { collisionMap, type World } from "../src/sim/world";

const P = (w: World, id = "owner") => w.state.players.get(id)!;
function arena(wall = false): World {
  const tiles = new Uint8Array(40 * 30).fill(TILE_FLOOR);
  for (let x = 0; x < 40; x++) tiles[x] = tiles[29 * 40 + x] = TILE_WALL;
  for (let y = 0; y < 30; y++) { tiles[y * 40] = tiles[y * 40 + 39] = TILE_WALL; if (wall && y !== 15) tiles[y * 40 + 12] = TILE_WALL; }
  const map = mapFromTiles(40, 30, tiles);
  map.spawns = [{ x: 300, y: 300 }, { x: 900, y: 300 }, { x: 900, y: 600 }, { x: 1000, y: 800 }];
  const w = createGameWorld({ map, random: mulberry32(23), config: {
    minPlayers: 4, fillSeconds: 0, lobbySeconds: 0, patienceSeconds: 1e9, patienceMinSeconds: 1e9,
    suddenDeathSeconds: 1e9, mobs: false, pvpRules: false,
  } });
  for (const [id, faction] of [["owner", "plague"], ["victim", "fire"], ["foe", "holy"], ["spare", "frost"]] as const) addPlayer(w, id, id, { faction });
  step(w, TICK_MS);
  for (const [id, x, y] of [["owner",300,300],["victim",320,300],["foe",900,600],["spare",1000,800]] as const) put(w, id, x, y);
  return w;
}
function put(w: World, id: string, x: number, y: number): void {
  const c = combatant(w, id)!; c.s.x = x; c.s.y = y; c.rt.path = []; c.rt.history = [{ t: w.state.serverTime, x, y }];
}
function harvest(w: World, victim = "victim"): void {
  put(w, victim, P(w).x + 20, P(w).y);
  downPlayer(w, P(w, victim), w.players.get(victim)!, "died");
  expect(enqueueClientMessage(w.players.get("owner")!.inputs, "consumeCorpse", { corpseId: `pc:${victim}` })).toBe(true);
  step(w, TICK_MS);
}
const pet = (w: World) => combatant(w, P(w).plagueZombieId)!;
const run = (w: World, n: number) => { for (let i = 0; i < n; i++) step(w, TICK_MS); };
function hit(w: World, by: string, victim: string, raw: number): void {
  recordHit(w, { by: { id: by, name: by }, victim, packet: { raw, phys: 1, magic: 0, true: 0 }, weapon: "fists", stagger: false });
  applyLedger(w);
}

describe("Plague's single zombie", () => {
  it("raises exactly one companion from the first player body, then grows that same actor and both max-health pools", () => {
    const w = arena(), base = P(w).maxHp;
    harvest(w);
    const z = pet(w), first = z.s.maxHp;
    expect(z.s).toMatchObject({ kind: "zombie", ownerId: "owner", status: "alive", camp: 0, type: "" });
    expect(P(w).maxHp).toBeCloseTo(base + FACTIONS.plague.hp * .03);
    expect(z.s.maxHp).toBeCloseTo(plagueZombieStats(P(w).maxHp, 1).maxHp);
    z.s.hp = 100;
    harvest(w, "spare");
    expect(pet(w).id).toBe(z.id);
    expect([...w.state.mobs.values()].filter(m => m.kind === "zombie")).toHaveLength(1);
    expect(P(w).maxHp).toBeCloseTo(base + 2 * FACTIONS.plague.hp * .03);
    expect(z.s.maxHp).toBeCloseTo(plagueZombieStats(P(w).maxHp, 2).maxHp);
    expect(z.s.hp).toBeCloseTo(100 + z.s.maxHp - first);
    expect(packetFor(z, "fists").raw).toBeCloseTo(plagueZombieStats(P(w).maxHp, 2).damage);
  });

  it("reads later owner max-health growth and never leaves an injured living zombie at zero when max health shrinks", () => {
    const w = arena(); harvest(w); const z = pet(w);
    P(w).maxHp = 3000; updateZombies(w); z.s.hp = 20;
    P(w).maxHp = 1400; updateZombies(w);
    expect(z.s.hp).toBe(20); expect(z.s.status).toBe("alive"); expect(z.s.maxHp).toBeCloseTo(490);
    expect(packetFor(z, "fists").raw).toBeCloseTo(42);
  });

  it("follows instead of attacking nearby unengaged camps, and paths through the gap rather than through walls", () => {
    const w = arena(true); harvest(w); const z = pet(w);
    const mob = placeMob(w, { region: "fire", elite: false, at: { x: 320, y: 350 } });
    run(w, 20); expect(w.mobs.get(mob)!.brain!.mode).toBe("idle");
    put(w, "owner", 600, 300);
    let previous = { x: z.s.x, y: z.s.y };
    for (let i = 0; i < 220; i++) {
      step(w, TICK_MS);
      expect(circleClear(collisionMap(w), z.s, 12)).toBe(true);
      expect(Math.hypot(z.s.x - previous.x, z.s.y - previous.y)).toBeLessThan(12);
      previous = { x: z.s.x, y: z.s.y };
    }
    expect(Math.hypot(z.s.x - P(w).x, z.s.y - P(w).y)).toBeLessThan(58);
    expect(w.mobs.get(mob)!.brain!.mode).toBe("idle");
  });

  it("keeps up with a boosted owner using ordinary collision movement, then closes the gap", () => {
    const w = arena(); harvest(w); const z = pet(w);
    grantCard(w, combatant(w, "owner") as any, "fleet3");
    P(w).speedBoostUntil = w.state.serverTime + 5000;
    enqueueClientMessage(w.players.get("owner")!.inputs, "move", { x: 1000, y: 300 });
    run(w, 45);
    expect(P(w).x).toBeGreaterThan(800);
    expect(Math.hypot(z.s.x - P(w).x, z.s.y - P(w).y)).toBeLessThan(120);
    run(w, 30); expect(Math.hypot(z.s.x - P(w).x, z.s.y - P(w).y)).toBeLessThan(58);
  });

  it("assists a directional sword hit, then returns to following after the owner's combat intent expires", () => {
    const w = arena(); harvest(w); const z = pet(w);
    put(w, "foe", 360, 300); P(w).weapon0 = "sword";
    enqueueClientMessage(w.players.get("owner")!.inputs, "attack", { a: 0 });
    enqueueClientMessage(w.players.get("owner")!.inputs, "release", { a: 0 });
    let petHits = 0;
    for (let i = 0; i < 60; i++) {
      step(w, TICK_MS); petHits += w.combat.landed.filter(e => e.by === z.id && e.victim === "foe").length;
    }
    expect(petHits).toBeGreaterThan(0); expect(P(w).attackTarget).toBe(""); expect(factionOf(z.s)).toBeNull();
    put(w, "owner", 300, 450);
    run(w, Math.ceil(PLAGUE_ZOMBIE_ASSIST_MS / TICK_MS) + 30);
    expect(z.rt.weapon.held).toBe(false);
    expect(Math.hypot(z.s.x - P(w).x, z.s.y - P(w).y)).toBeLessThan(58);
  });

  it.each([420, 920])("assists a wand enemy at x=%s, while owner and pet cannot target or damage each other", x => {
    const w = arena(); harvest(w); const z = pet(w);
    P(w).weapon0 = "wand"; put(w, "foe", x, 300);
    if (x > 600) { // a visited patch supplies vision at the full wand's range
      put(w, "owner", x, 300); getVisionMemory(w, "owner"); put(w, "owner", 300, 300);
    }
    enqueueClientMessage(w.players.get("owner")!.inputs, "target", { id: "foe" }); run(w, 2);
    expect(P(w).attackTarget).toBe("foe"); expect(z.rt.path.length).toBeGreaterThan(0);
    expect(hostile(combatant(w, "owner")!, z)).toBe(false); expect(hostile(z, combatant(w, "owner")!)).toBe(false);
    const before = [P(w).hp, z.s.hp];
    hit(w, z.id, "owner", 1e8); hit(w, "owner", z.id, 1e8);
    expect([P(w).hp, z.s.hp]).toEqual(before);
    enqueueClientMessage(w.players.get("owner")!.inputs, "target", { id: z.id }); step(w, TICK_MS);
    expect(P(w).attackTarget).not.toBe(z.id);
  });

  it("the owner's arrows pass through their own zombie and still hit the intended enemy", () => {
    const w = arena(); harvest(w); const z = pet(w);
    put(w, z.id, 340, 300); put(w, "foe", 460, 300); P(w).weapon0 = "bow";
    const hp = z.s.hp;
    enqueueClientMessage(w.players.get("owner")!.inputs, "attack", { a: 0 });
    enqueueClientMessage(w.players.get("owner")!.inputs, "release", { a: 0 });
    run(w, 12);
    expect(z.s.hp).toBe(hp); expect(P(w, "foe").hp).toBeLessThan(P(w, "foe").maxHp);
  });

  it("applies owner PvP growth and player-hit guards without inheriting owner on-hits or another disease", () => {
    const w = arena(); harvest(w); const z = pet(w); w.config.pvpRules = true;
    grantCard(w, combatant(w, "owner") as any, "hemorrhage");
    for (let i = 0; i < 4; i++) grantCard(w, combatant(w, "owner") as any, "ad3");
    const scale = pvpScale(w, "owner", "foe"), before = P(w, "foe").hp;
    expect(scale).toBeGreaterThan(1); expect(pvpScale(w, z.id, "foe")).toBe(scale);
    const damage = packetFor(z, "fists").raw;
    hit(w, z.id, "foe", damage);
    expect(before - P(w, "foe").hp).toBeCloseTo(damage * scale);
    expect(statusesOf(combatant(w, "foe")!).filter(s => s.tag?.startsWith("bleed:"))).toHaveLength(0);
    const max = P(w, "foe").maxHp; P(w, "foe").hp = max;
    hit(w, z.id, "foe", 1e9);
    expect(P(w, "foe").status).toBe("alive"); expect(P(w, "foe").hp).toBeGreaterThan(0);
  });

  it("credits pet kills and camp contribution to the owner, with no independent zombie reward identity", () => {
    const w = arena(); harvest(w); const z = pet(w);
    const camp = new CampState(); camp.alive = 1; w.state.camps.push(camp);
    const m = placeMob(w, { region: "fire", elite: false, at: { x: 330, y: 350 }, camp: 0 });
    hit(w, z.id, m, 5);
    expect(campContribOf(w, 0).has("owner")).toBe(true);
    expect(w.mobs.get(m)!.brain!.threat.has("owner")).toBe(true);
    hit(w, z.id, m, 1e8);
    expect(P(w).mobKills).toBe(1); expect(P(w).mobStats.size).toBe(1);
    expect(P(w).potionLarge).toBe(1);
    hit(w, z.id, "foe", 1e8);
    expect(P(w).kills).toBe(1); expect(w.state.plagueCorpses.has("pc:foe")).toBe(true);
  });

  it.each([false, true])("a simultaneous owner death preserves pet kill credit regardless of victim order (%s)", reverse => {
    const w = arena(); harvest(w); const z = pet(w);
    const entries = [{ by: "foe", victim: "owner" }, { by: z.id, victim: "spare" }];
    if (reverse) entries.reverse();
    w.actions.pickup = () => {
      for (const e of entries) recordHit(w, { by: { id: e.by, name: e.by }, victim: e.victim,
        packet: { raw: 1e9, phys: 1, magic: 0, true: 0 }, weapon: "fists", stagger: false });
    };
    w.players.get("owner")!.inputs.pushAction({ kind: "pickup", containerId: "test" });
    step(w, TICK_MS);
    expect(P(w).status).toBe("dead"); expect(P(w, "spare").status).toBe("dead");
    expect(P(w).kills).toBe(1); expect(w.state.mobs.has(z.id)).toBe(false);
  });

  it("a zombie death pays no GV, bounty, loot or corpse and only another harvested player body revives it", () => {
    const w = arena(); harvest(w); const z = pet(w);
    const rewards = [P(w, "foe").gv, P(w, "foe").kills, P(w, "foe").mobKills, w.state.containers.size, w.state.plagueCorpses.size];
    hit(w, "foe", z.id, 1e9);
    expect(z.s.status).toBe("dead"); expect(z.s.hp).toBe(0);
    run(w, 150);
    expect(z.s.status).toBe("dead");
    expect([P(w, "foe").gv, P(w, "foe").kills, P(w, "foe").mobKills, w.state.containers.size, w.state.plagueCorpses.size]).toEqual(rewards);
    harvest(w, "spare");
    expect(pet(w).id).toBe(z.id); expect(z.s.status).toBe("alive"); expect(P(w).corpseStacks).toBe(2);
    expect(z.s.hp).toBeCloseTo(plagueZombieStats(P(w).maxHp, 2).maxHp);
  });

  it("follows forced displacement and the locked coliseum teleport, sharing arrival immunity, then disappears on owner death", () => {
    const w = arena(); harvest(w); const z = pet(w); const seq = z.s.displaceSeq;
    displace(w, combatant(w, "owner")!, { x: 700, y: 400 }); step(w, TICK_MS);
    expect(z.s.displaceSeq).not.toBe(seq); expect(Math.hypot(z.s.x - 700, z.s.y - 400)).toBeLessThan(40);
    teleportToColiseum(w);
    expect(w.state.gatesLocked).toBe(true); expect(Math.hypot(z.s.x - P(w).x, z.s.y - P(w).y)).toBeLessThan(40);
    const hp = z.s.hp; hit(w, "foe", z.id, 1e9); expect(z.s.hp).toBe(hp);
    downPlayer(w, P(w), w.players.get("owner")!, "died");
    expect(w.state.mobs.has(z.id)).toBe(false); expect(P(w).plagueZombieId).toBe("");
  });

  it("removes the actor and runtime on owner disconnect and on run end", () => {
    const w = arena(); harvest(w); const id = pet(w).id; removePlayer(w, "owner");
    expect(w.mobs.has(id)).toBe(false); expect(w.state.mobs.has(id)).toBe(false);
    const v = arena(); harvest(v); const other = pet(v).id; v.hooks.runEnded?.(v);
    expect(v.state.mobs.has(other)).toBe(false); expect(P(v).plagueZombieId).toBe("");
  });

  it("corpse growth leaves Rat King's base disease and execute damage unchanged", () => {
    const sample = (stacks: number) => {
      const w = arena(); P(w).corpseStacks = stacks;
      const id = addMob(w, { kind: "dummy", name: "bag", at: { x: 330, y: 300 } });
      w.state.mobs.get(id)!.hp = w.state.mobs.get(id)!.maxHp * .3;
      noteContact(w, "owner", id); step(w, TICK_MS);
      return w.combat.landed.filter(e => e.by === "owner" && e.sig === "disease").map(e => e.amount);
    };
    const base = sample(0); expect(base.length).toBeGreaterThan(0); expect(sample(4)).toEqual(base);
  });
});
