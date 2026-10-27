import { describe, expect, it } from "vitest";
import {
  generateMap, mapFromTiles, mulberry32, normalTypesOf, questDefById, TICK_MS, TILE, type GameMap,
} from "@raid/shared";
import { teleportToColiseum } from "../src/sim/arena";
import { rollRosters } from "../src/sim/camps";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { hurtMob, placeMob } from "../src/sim/mobLife";
import { offerQuest, type QuestRuntime } from "../src/sim/quests";
import { addPlayer, step } from "../src/sim/step";
import { chainHook, type LedgerEntry, type SimConfig, type World } from "../src/sim/world";

const GIVER = { x: 6 * TILE, y: 6 * TILE };

function makeRun(map: GameMap = mapFromTiles(24, 24, new Uint8Array(24 * 24))): World {
  const config: SimConfig = {
    minPlayers: 1, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
    suddenDeathSeconds: 60, mobs: false, quests: true,
  };
  const world = createGameWorld({ map, config, random: mulberry32(8), rewardSalt: [5, 6, 7, 8] });
  addPlayer(world, "p0", "alice");
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  return world;
}

function offer(world: World, id: string, known = true): QuestRuntime {
  return offerQuest(world, questDefById(id)!, known, { at: GIVER });
}

function run(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(world, TICK_MS);
}

const hit = (victim: string, raw: number): LedgerEntry => ({
  victim, by: { id: "p0", name: "alice" }, packet: { raw, phys: 1, magic: 0, true: 0 },
  weapon: "sword", scale: 1, stagger: false,
});

describe("quest lifecycle", () => {
  it("removes a completed giver immediately and its synced entry after twenty seconds", () => {
    const world = makeRun();
    const qt = offer(world, "cull-fire");
    const npcId = qt.npcId;
    qt.s.progress.set("p0", qt.def.count);
    const p = world.state.players.get("p0")!;
    p.x = GIVER.x;
    p.y = GIVER.y;

    step(world, TICK_MS);
    expect(qt.s.status).toBe("done");
    expect(world.state.mobs.has(npcId)).toBe(false);
    expect(world.mobs.has(npcId)).toBe(false);
    expect(world.state.quests.has(qt.id)).toBe(true);

    run(world, 399);
    expect(world.quests!.quests.has(qt.id)).toBe(true);
    step(world, TICK_MS);
    expect(world.quests!.quests.has(qt.id)).toBe(false);
    expect(world.state.quests.has(qt.id)).toBe(false);
  });

  it("retains an expired public entry for twenty seconds, then deletes it", () => {
    const world = makeRun();
    const qt = offer(world, "cull-fire");
    qt.s.expiresAt = world.state.serverTime + TICK_MS;

    step(world, TICK_MS);
    expect(qt.s.status).toBe("expired");
    run(world, 399);
    expect(world.state.quests.has(qt.id)).toBe(true);
    step(world, TICK_MS);
    expect(world.state.quests.has(qt.id)).toBe(false);
    expect(world.quests!.quests.has(qt.id)).toBe(false);
  });

  it("closes public and hidden offers at teleport without pay and never reveals behind locked gates", () => {
    const world = makeRun();
    const published = offer(world, "cull-fire");
    const hidden = offer(world, "elite-hunt", false);
    const npcId = published.npcId;

    teleportToColiseum(world);
    expect(published.s.status).toBe("expired");
    expect(world.quests!.quests.has(hidden.id)).toBe(false);
    expect(world.state.unknownQuests).toBe(0);
    expect(world.state.mobs.has(npcId)).toBe(false);
    expect(world.players.get("p0")!.gv.quest).toBe(0);
    expect(world.state.players.get("p0")!.buffs.size).toBe(0);

    const p = world.state.players.get("p0")!;
    p.x = hidden.s.x;
    p.y = hidden.s.y;
    const events = step(world, TICK_MS);
    expect(events.some((e) => e.type === "questReveal")).toBe(false);
  });

  it("closes every open offer at run end without paying it", () => {
    const world = makeRun();
    const published = offer(world, "cull-fire");
    const hidden = offer(world, "elite-hunt", false);
    published.s.progress.set("p0", published.def.count);

    world.hooks.runEnded?.(world);

    expect(published.s.status).toBe("expired");
    expect(world.quests!.quests.has(hidden.id)).toBe(false);
    expect(world.players.get("p0")!.gv.quest).toBe(0);
    expect(world.state.players.get("p0")!.buffs.size).toBe(0);
  });

  it("expires kill quests when their remaining camps cannot satisfy them", () => {
    const world = makeRun(generateMap(81));
    rollRosters(world);
    const fire = offer(world, "cull-fire");
    const frost = offer(world, "cull-frost");
    const elite = offer(world, "elite-hunt");
    const tour = offer(world, "grand-tour");
    const eliteMob = placeMob(world, { region: "frost", elite: true, at: { x: 18 * TILE, y: 18 * TILE } });

    world.map.camps.forEach((camp, i) => {
      if (camp.zone === "fire") world.state.camps[i]!.alive = 0;
    });
    world.hooks.campCleared?.(world, 0);
    expect(fire.s.status).toBe("expired");
    expect(frost.s.status).toBe("open");
    expect(elite.s.status).toBe("open");
    expect(tour.s.status).toBe("open");

    for (const camp of world.state.camps) camp.alive = 0;
    world.state.mobs.get(eliteMob)!.status = "dead";
    world.hooks.campCleared?.(world, 0);
    expect(frost.s.status).toBe("expired");
    expect(elite.s.status).toBe("expired");
    expect(tour.s.status).toBe("expired");
  });

  it("chains mobKilled with type, zone, camp, and elite", () => {
    const world = makeRun();
    const qt = offer(world, "cull-fire");
    const type = normalTypesOf("fire")[0]!.id;
    let payload: { type: string; zone: string; camp: number; elite: boolean } | null = null;
    chainHook(world, "mobKilled", (_w, _killer, mob) => { payload = mob; });
    const id = placeMob(world, { region: "fire", elite: false, type, camp: 0, at: { x: 18 * TILE, y: 18 * TILE } });
    const mob = combatant(world, id);
    if (!mob || mob.kind !== "mob") throw new Error("mob missing");

    hurtMob(world, mob, [mob.s.maxHp + 1], [hit(id, mob.s.maxHp + 1)]);

    expect(payload).toEqual({ type, zone: "fire", camp: 0, elite: false });
    expect(qt.s.progress.get("p0")).toBe(1);
  });
});
