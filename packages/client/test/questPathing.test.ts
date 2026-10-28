import { describe, expect, it } from "vitest";
import { MASK_MOVE, PLAYER_RADIUS, TILE, circleClear, findPath, generateMap, segmentClear, tileToWorldCenter, worldToTile, withGates, type GameMap } from "@raid/shared";
import { questMinimapBlips, type QuestContainerLike, type QuestStateLike } from "../src/ui/questModel";

function quests(q: QuestStateLike[]) {
  return { forEach(cb: (quest: QuestStateLike, id: string) => void) { for (const row of q) cb(row, row.id); } };
}

const noContainers = { forEach(_cb: (container: QuestContainerLike, id: string) => void) {} };

function offer(over: Partial<QuestStateLike> = {}): QuestStateLike {
  return {
    id: "tracked", def: "cull-fire", x: 300, y: 400, status: "open", doneBy: "", expiresAt: 90_000,
    carrier: "", progress: new Map(), accepted: new Map([["me", true]]), ...over,
  };
}

function mobsFromMap(map: GameMap) {
  return map.camps.flatMap((camp) => camp.spots.map((spot, i) => ({
    ...spot, kind: i === camp.eliteSpot ? "elite" : "mob", status: "alive", faction: camp.zone,
  })));
}

describe("quest minimap pathing against generated maps and server movement", () => {
  it("routes kill, elite, tour, collect, and fetch objectives across 100 generated maps", () => {
    let paths = 0;
    const seeds = Array.from({ length: 100 }, (_, i) => i + 1);
    const started = performance.now();
    for (const seed of seeds) {
      const map = generateMap(seed);
      const from = map.spawnPool[0]!;
      const mobs = mobsFromMap(map);
      const cases = [
        { q: offer(), eligible: (m: ReturnType<typeof mobsFromMap>[number]) => m.faction === "fire" },
        { q: offer({ def: "elite-hunt" }), eligible: (m: ReturnType<typeof mobsFromMap>[number]) => m.kind === "elite" },
        { q: offer({ def: "grand-tour", progress: new Map([["me", 0]]) }), eligible: (m: ReturnType<typeof mobsFromMap>[number]) => true },
      ];
      for (const { q, eligible } of cases) {
        const data = questMinimapBlips(quests([q]), noContainers, "me", from, new Map(), map,
          { trackedId: "tracked", mobs });
        const blip = data.find((item) => item.role === "objective");
        expect(blip, `seed ${seed}, ${q.def}: living eligible target`).toBeDefined();
        expect(blip).toMatchObject({ tracked: true, waypoint: { step: 1, total: q.def === "cull-fire" ? 3 : q.def === "grand-tour" ? 3 : 1 } });
        expect(mobs.filter(eligible)).toContainEqual(expect.objectContaining({ x: blip!.x, y: blip!.y, status: "alive" }));
        expect(blip!.route?.[0]).toMatchObject({ x: from.x, y: from.y });
        expect(blip!.route?.at(-1)).toMatchObject({ x: blip!.x, y: blip!.y });
        for (let i = 1; i < (blip!.route?.length ?? 0); i++) {
          expect(segmentClear(map, blip!.route![i - 1]!, blip!.route![i]!, PLAYER_RADIUS, MASK_MOVE), `seed ${seed}, ${q.def}, segment ${i}`).toBe(true);
          paths++;
        }
      }
      const itemAt = from;
      const item = { id: "item", kind: "quest", x: itemAt.x, y: itemAt.y, label: "Token", items: { length: 1, at: () => ({ def: "quest:tracked" }) } };
      for (const q of [offer({ def: "bloom-plague" }), offer({ def: "banner-fire" })]) {
        const data = questMinimapBlips(quests([q]), { forEach: (cb) => cb(item, item.id) }, "me", from, new Map(), map,
          { trackedId: "tracked" });
        expect(data.find((blip) => blip.role === "objective"), `seed ${seed}, ${q.def}: accepted ground item`).toMatchObject({
          tracked: true, x: from.x, y: from.y,
        });
      }
    }
    expect(seeds).toHaveLength(100);
    expect(paths).toBeGreaterThan(100);
    console.info(`Quest path sweep: ${seeds.length} seeds, ${paths} valid MASK_MOVE route segments, ${(performance.now() - started).toFixed(0)} ms`);
  }, 30_000);

  it("never routes to dead, wrong-region, non-elite or already-visited tour targets", () => {
    const map = generateMap(29);
    const from = map.spawnPool[0]!;
    const fire = map.camps.find((camp) => camp.zone === "fire")!;
    const spot = fire.spots[0]!;
    const wrongRegion = { ...spot, faction: "holy", kind: "mob", status: "alive" };
    const deadElite = { ...spot, x: spot.x + 1, faction: "fire", kind: "elite", status: "dead" };
    const ordinaryFire = { ...spot, x: spot.x + 2, faction: "fire", kind: "mob", status: "alive" };
    const accepted = offer({ def: "elite-hunt" });
    const data = questMinimapBlips(quests([accepted]), noContainers, "me", from, new Map(), map,
      { trackedId: accepted.id, mobs: [wrongRegion, deadElite, ordinaryFire] });
    expect(data.some((item) => item.role === "objective")).toBe(false);

    const tour = offer({ def: "grand-tour", visitedRegions: new Map([["me", "fire,holy"]]), progress: new Map([["me", 2]]) });
    const visitedFire = { ...spot, kind: "mob", status: "alive", faction: "fire" };
    const unvisitedCamp = map.camps.find((camp) => camp.zone !== "fire" && camp.zone !== "holy")!;
    const unvisited = { ...unvisitedCamp.spots[0]!, kind: "mob", status: "alive", faction: unvisitedCamp.zone };
    const tourData = questMinimapBlips(quests([tour]), noContainers, "me", from, new Map(), map,
      { trackedId: tour.id, mobs: [visitedFire, unvisited] });
    expect(tourData.find((item) => item.role === "objective")).toMatchObject({ x: unvisited.x, y: unvisited.y, waypoint: { step: 3, total: 3 } });
  });

  it("retains a selected mob by stable id and retargets when that mob dies", () => {
    const map = generateMap(37);
    const from = map.spawnPool[0]!;
    const camp = map.camps.find((row) => row.zone === "fire")!;
    const first = { ...camp.spots[0]!, id: "first", kind: "mob", status: "alive", faction: "fire" };
    const closer = { ...camp.spots[1]!, id: "closer", kind: "mob", status: "alive", faction: "fire" };
    const q = offer();
    const model = (mobs: typeof first[]) => questMinimapBlips(quests([q]), noContainers, "me", from, new Map(), map,
      { trackedId: q.id, mobs });
    const initial = model([first]);
    expect(initial.find((blip) => blip.role === "objective")).toMatchObject({ x: first.x, y: first.y });
    // New nearer targets do not make the active route flicker between camps every render frame.
    expect(model([first, closer]).find((blip) => blip.role === "objective")).toMatchObject({ x: first.x, y: first.y });
    const hotStarted = performance.now();
    for (let i = 0; i < 100; i++) model([first, closer]);
    console.info(`Quest target cache: 100 retained-target updates ${(performance.now() - hotStarted).toFixed(0)} ms`);
    expect(model([{ ...first, status: "dead" }, closer]).find((blip) => blip.role === "objective")).toMatchObject({ x: closer.x, y: closer.y });
  });

  it("caches static item destinations, changes when picked up, and isolates mob caches by local player", () => {
    const map = generateMap(79);
    const from = map.spawnPool[0]!;
    const other = map.spawnPool.at(-1)!;
    const q = offer({ def: "bloom-plague" });
    const box = (id: string, at: { x: number; y: number }) => ({ id, kind: "quest", x: at.x, y: at.y, label: "Token", items: { length: 1, at: () => ({ def: "quest:tracked" }) } });
    const first = box("first", map.camps[0]!.spots[0]!);
    const closer = box("closer", { x: from.x, y: from.y });
    const model = (rows: typeof first[]) => questMinimapBlips(quests([q]), { forEach: (cb) => rows.forEach((item) => cb(item, item.id)) }, "me", from, new Map(), map,
      { trackedId: q.id });
    const initial = model([first]);
    expect(initial.find((blip) => blip.role === "objective")).toMatchObject({ targetId: "item:first", x: first.x, y: first.y });
    expect(model([first, closer]).find((blip) => blip.role === "objective")).toMatchObject({ targetId: "item:first" });
    const cacheStarted = performance.now();
    for (let i = 0; i < 100; i++) model([first, closer]);
    console.info(`Quest static-item route cache: 100 retained-target updates ${(performance.now() - cacheStarted).toFixed(0)} ms`);
    expect(model([closer]).find((blip) => blip.role === "objective")).toMatchObject({ targetId: "item:closer" });

    const fireCamps = map.camps.filter((camp) => camp.zone === "fire");
    const firstMob = { ...fireCamps[0]!.spots[0]!, id: "local-near", kind: "mob", status: "alive", faction: "fire" };
    const secondMob = { ...fireCamps.at(-1)!.spots.at(-1)!, id: "other-near", kind: "mob", status: "alive", faction: "fire" };
    const kill = offer({ accepted: new Map([["me", true], ["other", true]]) });
    const mobBlip = (localId: string, at: { x: number; y: number }) => questMinimapBlips(quests([kill]), noContainers, localId, at, new Map(), map,
      { trackedId: kill.id, mobs: [firstMob, secondMob] }).find((blip) => blip.role === "objective");
    expect(mobBlip("me", firstMob)).toMatchObject({ targetId: "mob:local-near" });
    expect(mobBlip("other", secondMob)).toMatchObject({ targetId: "mob:other-near" });
  });

  it("does not hide a reachable fifth item behind four closer blocked or disconnected candidates", () => {
    const map = generateMap(89);
    const from = map.spawnPool[0]!;
    const blockedIndex = map.tiles.findIndex((tile) => (tile & MASK_MOVE) !== 0);
    const blocked = {
      x: (blockedIndex % map.w) * TILE + TILE / 2,
      y: Math.floor(blockedIndex / map.w) * TILE + TILE / 2,
    };
    const rows = [0, 1, 2, 3].map((i) => ({ id: `blocked-${i}`, kind: "quest", ...blocked, label: "Token", items: { length: 1, at: () => ({ def: "quest:tracked" }) } }));
    rows.push({ id: "reachable", kind: "quest", ...from, label: "Token", items: { length: 1, at: () => ({ def: "quest:tracked" }) } });
    const q = offer({ def: "bloom-plague" });
    const result = questMinimapBlips(quests([q]), { forEach: (cb) => rows.forEach((item) => cb(item, item.id)) }, "me", from, new Map(), map,
      { trackedId: q.id });
    expect(result.find((blip) => blip.role === "objective")).toMatchObject({ targetId: "item:reachable", x: from.x, y: from.y });
  });

  it("revalidates the actual first and last route segments as both player and moving target shift", () => {
    let fixture: { map: GameMap; from: { x: number; y: number }; target: { x: number; y: number }; nextFrom: { x: number; y: number }; nextTarget: { x: number; y: number } } | undefined;
    for (const seed of [7, 19, 31, 43, 59]) {
      const map = generateMap(seed);
      const floorNear = (at: { x: number; y: number }) => {
        const tx = worldToTile(at.x), ty = worldToTile(at.y);
        const out: Array<{ x: number; y: number }> = [];
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const x = tileToWorldCenter(tx + dx), y = tileToWorldCenter(ty + dy), p = { x, y };
          if (circleClear(map, p, PLAYER_RADIUS, MASK_MOVE)) out.push(p);
        }
        return out;
      };
      const froms = floorNear(map.spawnPool[0]!);
      for (const camp of map.camps) for (const target of camp.spots) {
        const path = findPath(map, map.spawnPool[0]!, target, PLAYER_RADIUS);
        if (path.length !== 1) continue;
        const starts = froms.filter((p) => Math.hypot(p.x - map.spawnPool[0]!.x, p.y - map.spawnPool[0]!.y) <= TILE * 2);
        const targets = floorNear(target);
        for (const nextFrom of starts) for (const nextTarget of targets) {
          if (nextFrom.x === map.spawnPool[0]!.x && nextFrom.y === map.spawnPool[0]!.y) continue;
          if (nextTarget.x === target.x && nextTarget.y === target.y) continue;
          if (!segmentClear(map, nextFrom, target, PLAYER_RADIUS, MASK_MOVE)
            || !segmentClear(map, map.spawnPool[0]!, nextTarget, PLAYER_RADIUS, MASK_MOVE)
            || segmentClear(map, nextFrom, nextTarget, PLAYER_RADIUS, MASK_MOVE)) continue;
          fixture = { map, from: map.spawnPool[0]!, target, nextFrom, nextTarget };
          break;
        }
        if (fixture) break;
      }
      if (fixture) break;
    }
    expect(fixture, "find a one-segment route whose independently moved endpoints cut a wall corner").toBeDefined();
    const { map, from, target, nextFrom, nextTarget } = fixture!;
    const q = offer({ def: "banner-fire", carrier: "remote" });
    const model = (local: { x: number; y: number }, remote: { x: number; y: number }) => questMinimapBlips(
      quests([q]), noContainers, "me", local, new Map([["remote", remote]]), map, { trackedId: q.id },
    ).find((blip) => blip.role === "objective");
    expect(model(from, target)?.route).toHaveLength(2);
    const route = model(nextFrom, nextTarget)?.route;
    expect(route?.[0]).toMatchObject(nextFrom);
    expect(route?.at(-1)).toMatchObject(nextTarget);
    expect(route?.length).toBeGreaterThanOrEqual(3); // it detours around the blocked direct connector
    for (let i = 1; i < (route?.length ?? 0); i++) {
      expect(segmentClear(map, route![i - 1]!, route![i]!, PLAYER_RADIUS, MASK_MOVE)).toBe(true);
    }
  });

  it("respects closed coliseum gates, open gates, and blocked target tiles without stale mask caches", () => {
    const map = generateMap(53);
    const from = map.spawnPool[0]!;
    const inside = map.coliseum.innerSpawns[0]!;
    const target = { ...inside, faction: "fire", kind: "mob", status: "alive" };
    const q = offer();
    const make = (collisionMap: GameMap, mob = target) => questMinimapBlips(
      quests([q]), noContainers, "me", from, new Map(), collisionMap,
      { trackedId: q.id, mobs: [mob] },
    );
    expect(make(withGates(map)).some((item) => item.role === "objective")).toBe(false);
    expect(make(map).find((item) => item.role === "objective")?.route?.length).toBeGreaterThan(1);
    const blockedTile = map.tiles.findIndex((tile) => (tile & MASK_MOVE) !== 0);
    expect(blockedTile).toBeGreaterThanOrEqual(0);
    const blocked = {
      x: (blockedTile % map.w) * TILE + TILE / 2,
      y: Math.floor(blockedTile / map.w) * TILE + TILE / 2,
      faction: "fire", kind: "mob", status: "alive",
    };
    expect(make(map, blocked).some((item) => item.role === "objective")).toBe(false);
  });

  it("keeps explicit unaccepted tracking at the giver and hides unaccepted ground objectives", () => {
    const map = generateMap(61);
    const from = map.spawnPool[0]!;
    const q = offer({ accepted: new Map(), x: from.x, y: from.y });
    const parcelAt = map.camps[0]!.spots[0]!;
    const item = { id: "parcel", kind: "quest", x: parcelAt.x, y: parcelAt.y,
      label: "Parcel", items: { length: 1, at: () => ({ def: "quest:tracked" }) } };
    const data = questMinimapBlips(quests([q]), { forEach: (cb) => cb(item, item.id) }, "me", from, new Map(), map,
      { trackedId: q.id });
    expect(data.find((blip) => blip.role === "objective")).toMatchObject({ x: q.x, y: q.y, waypoint: { label: expect.stringContaining("Talk to") } });
    expect(data.some((blip) => blip.x === item.x && blip.y === item.y)).toBe(false);
  });

  it("does not guide a player-kill quest toward mobs and suppresses offers at the server expiry time", () => {
    const map = generateMap(83);
    const from = map.spawnPool[0]!;
    const headhunter = offer({ def: "headhunter" });
    const mobs = mobsFromMap(map).map((mob, i) => ({ ...mob, id: String(i) }));
    const data = questMinimapBlips(quests([headhunter]), noContainers, "me", from, new Map(), map,
      { trackedId: headhunter.id, mobs });
    expect(data.some((blip) => blip.role === "objective")).toBe(false);
    expect(questMinimapBlips(quests([offer()]), noContainers, "me", from, new Map(), map,
      { trackedId: "tracked", mobs, serverNow: 90_000 })).toEqual([]);
  });
});
