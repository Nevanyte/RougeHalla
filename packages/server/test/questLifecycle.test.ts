import { describe, expect, it } from "vitest";
import {
  generateMap, mapFromTiles, mulberry32, normalTypesOf, questDefById, eliteTypeOf, TICK_MS, TILE,
  type FactionId, type GameMap,
} from "@raid/shared";
import { teleportToColiseum } from "../src/sim/arena";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { hurtMob, placeMob } from "../src/sim/mobLife";
import { offerQuest, type QuestRuntime } from "../src/sim/quests";
import { addPlayer, step } from "../src/sim/step";
import { chainHook, type LedgerEntry, type SimConfig, type SimEvent, type World } from "../src/sim/world";

const GIVER = { x: 6 * TILE, y: 6 * TILE };

interface RunOpts { map?: GameMap; mobs?: boolean; players?: number }

function makeRun(o: RunOpts = {}): World {
  const players = o.players ?? 1;
  const config: SimConfig = {
    minPlayers: players, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
    suddenDeathSeconds: 60, mobs: o.mobs ?? false, quests: true, hazards: false,
  };
  const map = o.map ?? mapFromTiles(24, 24, new Uint8Array(24 * 24));
  const world = createGameWorld({ map, config, random: mulberry32(8), rewardSalt: [5, 6, 7, 8] });
  for (let i = 0; i < players; i++) addPlayer(world, `p${i}`, ["alice", "bob", "carol"][i]!);
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  if (o.mobs) closeRolledRoster(world);
  return world;
}

/**
 * A world with camps rolls the real ten offers at raid start. Closing them through the production run-end path (unpaid,
 * silent) leaves the test's own offers as the only open ones, so a "N quests expired" toast counts only those.
 */
function closeRolledRoster(world: World): void {
  world.hooks.runEnded?.(world);
  world.events = [];
}

function offer(world: World, id: string, known = true): QuestRuntime {
  return offerQuest(world, questDefById(id)!, known, { at: GIVER });
}

function run(world: World, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...step(world, TICK_MS));
  return events;
}

const hit = (victim: string, raw: number, by = "p0"): LedgerEntry => ({
  victim, by: { id: by, name: by }, packet: { raw, phys: 1, magic: 0, true: 0 },
  weapon: "sword", scale: 1, stagger: false,
});

/** Kills one placed mob the way the ledger would: through hurtMob, so the camp, the spoils and the hooks all run. */
function slay(world: World, id: string, by = "p0"): void {
  const mob = combatant(world, id);
  if (!mob || mob.kind !== "mob") throw new Error(`mob ${id} missing`);
  hurtMob(world, mob, [mob.s.maxHp + 1], [hit(id, mob.s.maxHp + 1, by)]);
}

function liveMobs(world: World, where: (zone: FactionId, elite: boolean) => boolean = () => true): string[] {
  const out: string[] = [];
  for (const rt of world.mobs.values()) {
    const s = world.state.mobs.get(rt.id);
    if (rt.brain && s && s.status === "alive" && (s.kind === "mob" || s.kind === "elite") && where(rt.brain.region, rt.brain.elite)) {
      out.push(rt.id);
    }
  }
  return out;
}

const toasts = (events: readonly SimEvent[]): string[] =>
  events.flatMap((e) => (e.type === "toast" ? [e.text] : []));

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

  it("stops the timer of a closed row: a done or early-closed offer no longer counts down", () => {
    const world = makeRun();
    const done = offer(world, "cull-fire");
    const early = offer(world, "cull-plague");
    done.s.progress.set("p0", done.def.count);
    const p = world.state.players.get("p0")!;
    p.x = GIVER.x;
    p.y = GIVER.y;
    const lapsesAt = done.s.expiresAt;
    expect(lapsesAt).toBeGreaterThan(world.state.serverTime + 100_000);

    step(world, TICK_MS);
    expect(done.s.status).toBe("done");
    expect(done.s.expiresAt).toBeLessThanOrEqual(world.state.serverTime);

    teleportToColiseum(world);
    expect(early.s.status).toBe("expired");
    expect(early.s.expiresAt).toBeLessThanOrEqual(world.state.serverTime);
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

  it("never starts a reveal while the gates are locked, even for an offer that is still open", () => {
    const world = makeRun();
    const hidden = offer(world, "elite-hunt", false);
    world.state.gatesLocked = true;
    const p = world.state.players.get("p0")!;
    p.x = hidden.s.x;
    p.y = hidden.s.y;

    expect(run(world, 3).some((e) => e.type === "questReveal")).toBe(false);
    expect(hidden.publishAt).toBe(0);

    world.state.gatesLocked = false;
    expect(run(world, 1).some((e) => e.type === "questReveal")).toBe(true);
  });

  it("tells the room once, in one toast, that the teleport closed its quests", () => {
    const world = makeRun();
    offer(world, "cull-fire");
    offer(world, "cull-plague");
    offer(world, "elite-hunt", false);
    world.events = [];

    teleportToColiseum(world);

    expect(toasts(world.events)).toEqual(["2 quests expired"]);
  });

  it("closes every open offer at run end without paying it, and says nothing", () => {
    const world = makeRun();
    const published = offer(world, "cull-fire");
    const hidden = offer(world, "elite-hunt", false);
    published.s.progress.set("p0", published.def.count);
    world.events = [];

    world.hooks.runEnded?.(world);

    expect(published.s.status).toBe("expired");
    expect(world.quests!.quests.has(hidden.id)).toBe(false);
    expect(world.players.get("p0")!.gv.quest).toBe(0);
    expect(world.state.players.get("p0")!.buffs.size).toBe(0);
    expect(toasts(world.events)).toEqual([]);
  });

  it("chains mobKilled with type, zone, camp, and elite", () => {
    const world = makeRun();
    const qt = offer(world, "cull-fire");
    const type = normalTypesOf("fire")[0]!.id;
    let payload: { type: string; zone: string; camp: number; elite: boolean } | null = null;
    chainHook(world, "mobKilled", (_w, _killer, mob) => { payload = mob; });
    const id = placeMob(world, { region: "fire", elite: false, type, camp: 0, at: { x: 18 * TILE, y: 18 * TILE } });

    slay(world, id);

    expect(payload).toEqual({ type, zone: "fire", camp: 0, elite: false });
    expect(qt.s.progress.get("p0")).toBe(1);
  });
});

describe("the mobKilled payload", () => {
  function recorded(world: World): Array<{ type: string; zone: string; camp: number; elite: boolean }> {
    const seen: Array<{ type: string; zone: string; camp: number; elite: boolean }> = [];
    chainHook(world, "mobKilled", (_w, _killer, mob) => { seen.push({ ...mob }); });
    return seen;
  }
  const AT = { x: 18 * TILE, y: 18 * TILE };

  it("names the elite type, its zone, its camp index and the elite flag for an elite of a camp", () => {
    const world = makeRun();
    const seen = recorded(world);
    const type = eliteTypeOf("frost").id;

    slay(world, placeMob(world, { region: "frost", elite: true, type, camp: 7, at: AT }));

    expect(seen).toEqual([{ type, zone: "frost", camp: 7, elite: true }]);
  });

  it("reports camp -1 for a mob placed with no camp, and the zone's default type for a mob with no type", () => {
    const world = makeRun();
    const seen = recorded(world);

    slay(world, placeMob(world, { region: "plague", elite: false, at: AT }));

    expect(seen).toEqual([{ type: normalTypesOf("plague")[0]!.id, zone: "plague", camp: -1, elite: false }]);
  });

  it("does not fire for a practice mob in a training room: it pays nothing", () => {
    const config: SimConfig = {
      minPlayers: 1, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
      suddenDeathSeconds: 60, training: true, quests: true,
    };
    const world = createGameWorld({ map: mapFromTiles(24, 24, new Uint8Array(24 * 24)), config, random: mulberry32(8) });
    addPlayer(world, "p0", "alice");
    step(world, TICK_MS);
    const seen = recorded(world);

    slay(world, placeMob(world, { region: "fire", elite: false, camp: 100, at: AT }));

    expect(seen).toEqual([]);
    expect(world.quests).toBeNull();
  });
});

describe("closing a kill offer early (the camps are cleared for good)", () => {
  const map = generateMap(81);

  it("keeps the offer when the clearing kill is the one that finishes it", () => {
    const world = makeRun({ map, mobs: true });
    const zoneMobs = liveMobs(world, (zone) => zone === "fire");
    const qt = offer(world, "cull-fire");
    expect(zoneMobs.length).toBeGreaterThan(3);
    // The zone's other mobs fall first; the player is then put one kill short, and the last mob of the last camp is theirs.
    // The campCleared hook runs before that kill's own mobKilled, so a check made in the hook would see 2 of 3.
    for (const id of zoneMobs.slice(0, -1)) slay(world, id);
    qt.s.progress.set("p0", qt.def.count - 1);

    slay(world, zoneMobs.at(-1)!);
    expect(liveMobs(world, (zone) => zone === "fire")).toEqual([]);
    step(world, TICK_MS);

    expect(qt.s.progress.get("p0")).toBe(qt.def.count);
    expect(qt.s.status).toBe("open");
  });

  it("closes offers nobody can finish in one batched toast, and keeps those that still can be", () => {
    const world = makeRun({ map, mobs: true });
    for (const id of liveMobs(world, (zone) => zone !== "fire")) slay(world, id);
    world.events = [];

    const fire = offer(world, "cull-fire");
    const frost = offer(world, "cull-frost");
    const tour = offer(world, "grand-tour");
    const elite = offer(world, "elite-hunt");
    const unseen = offer(world, "cull-plague", false);
    expect(world.state.unknownQuests).toBe(1);
    const events = step(world, TICK_MS);

    expect(frost.s.status).toBe("expired");
    expect(tour.s.status).toBe("expired");
    expect(fire.s.status).toBe("open");
    expect(elite.s.status).toBe("open");
    // The hidden cull of the emptied plague zone is as impossible as the frost one, but the camp clear must not delete it:
    // that would drop the public unknownQuests count and tell every client a hidden offer of that zone existed.
    expect(world.quests!.quests.get(unseen.id)).toBe(unseen);
    expect(unseen.s.status).toBe("open");
    expect(world.state.unknownQuests).toBe(1);
    expect(toasts(events).filter((t) => t.includes("expired"))).toEqual(["2 quests expired"]);
    expect(world.state.mobs.has(frost.npcId)).toBe(false);
  });

  it("never changes the public unknown count by a camp clear: hidden offers close only at their own deadline, publication or the end", () => {
    const world = makeRun({ map, mobs: true });
    const cull = offer(world, "cull-plague", false);
    const hunt = offer(world, "elite-hunt", false);
    const hiddenIds = [cull.id, hunt.id];
    expect(world.state.unknownQuests).toBe(2);
    const p0 = world.state.players.get("p0")!;
    p0.maxHp = 1e9;
    p0.hp = 1e9;

    // Every camp of every zone falls, one tick at a time: each clear sets the re-check, and the count never moves.
    const counts: number[] = [];
    for (const id of liveMobs(world)) {
      slay(world, id);
      step(world, TICK_MS);
      counts.push(world.state.unknownQuests);
    }
    expect(liveMobs(world)).toEqual([]);
    expect(p0.status, "a standing player is what would make the offers impossible rather than moot").toBe("alive");
    expect(counts.length).toBeGreaterThan(10);
    expect(new Set(counts)).toEqual(new Set([2]));
    for (const id of hiddenIds) {
      expect(world.quests!.quests.get(id)?.s.status).toBe("open");
      expect(world.state.quests.has(id)).toBe(false);
    }
    expect(world.state.unknownQuests).toBe(2);

    // Their own deadline is the only thing left that takes one: it still drops the count, as it always did.
    cull.s.expiresAt = world.state.serverTime + TICK_MS;
    step(world, TICK_MS);
    expect(world.quests!.quests.has(cull.id)).toBe(false);
    expect(world.state.unknownQuests).toBe(1);
  });

  it("closes a hidden offer that is already impossible the moment it goes public, as an ordinary expired row", () => {
    const world = makeRun({ map, mobs: true });
    for (const id of liveMobs(world, (zone) => zone === "plague")) slay(world, id);
    const dead = offer(world, "cull-plague", false);
    const p = world.state.players.get("p0")!;
    p.maxHp = 1e9;
    p.hp = 1e9;
    step(world, TICK_MS);
    expect(dead.s.status).toBe("open");
    expect(world.state.unknownQuests).toBe(1);

    // Scouted: the first ticks reveal it to the finder only; nothing public happens before the head start ends.
    p.x = dead.s.x;
    p.y = dead.s.y;
    const events = step(world, TICK_MS);
    expect(events.some((e) => e.type === "questReveal")).toBe(true);
    expect(world.state.quests.has(dead.id)).toBe(false);
    let published = events;
    while (world.state.serverTime < dead.publishAt) published = step(world, TICK_MS);

    // Public, so its closure is the ordinary one: an expired row the log shows, a toast, no giver.
    expect(dead.published).toBe(true);
    expect(world.state.quests.get(dead.id)?.status).toBe("expired");
    expect(world.state.mobs.has(dead.npcId)).toBe(false);
    expect(toasts(published).some((t) => t.includes("Quest expired") && t.includes(dead.def.name))).toBe(true);
    expect(world.state.unknownQuests).toBe(0);
  });

  it("looks at the supply a player still lacks: two kills short with only one mob left closes it", () => {
    const world = makeRun({ map, mobs: true });
    const zoneMobs = liveMobs(world, (zone) => zone === "fire");
    for (const id of zoneMobs.slice(0, -1)) slay(world, id);
    for (const id of liveMobs(world, (zone) => zone !== "fire")) slay(world, id);
    const qt = offer(world, "cull-fire");
    qt.s.progress.set("p0", 1);

    step(world, TICK_MS);
    expect(qt.s.status).toBe("expired");

    const ready = offer(world, "cull-fire");
    ready.s.progress.set("p0", ready.def.count);
    world.quests!.recheck = true;
    step(world, TICK_MS);
    expect(ready.s.status).toBe("open");
  });

  it("counts only the zones a touring player has not been to", () => {
    const world = makeRun({ map, mobs: true });
    for (const id of liveMobs(world, (zone) => zone !== "fire" && zone !== "frost")) slay(world, id);
    const lost = offer(world, "grand-tour");
    lost.s.progress.set("p0", 2);
    lost.tours.set("p0", new Set(["fire", "frost"]));
    const open = offer(world, "grand-tour");
    open.s.progress.set("p0", 2);
    open.tours.set("p0", new Set(["fire", "plague"]));

    step(world, TICK_MS);

    expect(lost.s.status).toBe("expired");
    expect(open.s.status).toBe("open");
  });

  it("does not let a dead player's progress keep an impossible offer open", () => {
    const world = makeRun({ map, mobs: true, players: 3 });
    for (const id of liveMobs(world, (zone) => zone !== "fire")) slay(world, id);
    const qt = offer(world, "cull-frost");
    qt.s.progress.set("p1", qt.def.count);
    world.state.players.get("p1")!.status = "dead";
    world.quests!.recheck = true;

    step(world, TICK_MS);

    expect(qt.s.status).toBe("expired");
  });
});
