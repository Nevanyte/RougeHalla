import { describe, expect, it } from "vitest";
import {
  INTERACT_RANGE, mapFromTiles, mulberry32, QUEST_COUNT, QUEST_ITEM_PREFIX, QUEST_KNOWN_COUNT, questDefById,
  QUEST_REVEAL_RADIUS, QUEST_TURN_IN_RANGE, QUEST_UNKNOWN_COUNT, TICK_MS, TILE, TILE_FLOOR, TILE_WALL,
  type FactionId, type Vec2,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { downPlayer } from "../src/sim/arena";
import { combatant, hostile } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { handlePickup } from "../src/sim/loot";
import { hurtMob, placeMob } from "../src/sim/mobLife";
import { offerQuest, type QuestRuntime } from "../src/sim/quests";
import { addPlayer, step } from "../src/sim/step";
import type { LedgerEntry, SimConfig, World } from "../src/sim/world";
import { accept, rig } from "./support/questRig";

const NAMES = ["alice", "bob", "carol"];

function openMap(side = 24, walls: ReadonlyArray<readonly [number, number]> = []) {
  const tiles = new Uint8Array(side * side).fill(TILE_FLOOR);
  for (let i = 0; i < side; i++) {
    for (const [x, y] of [[i, 0], [i, side - 1], [0, i], [side - 1, i]] as const) tiles[y * side + x] = TILE_WALL;
  }
  for (const [x, y] of walls) tiles[y * side + x] = TILE_WALL;
  return mapFromTiles(side, side, tiles);
}

interface WorldOpts {
  players?: number; quests?: boolean; training?: boolean; seed?: number;
  /** Extra wall tiles [tx, ty] on the otherwise open map. */
  walls?: ReadonlyArray<readonly [number, number]>;
}

function makeLobby(o: WorldOpts = {}): World {
  const players = o.players ?? 2;
  const config: SimConfig = {
    minPlayers: players, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
    suddenDeathSeconds: 60, mobs: false, quests: o.quests ?? true, training: o.training,
  };
  const seed = o.seed ?? 99;
  const game = createGameWorld({ config, random: mulberry32(seed + 1), map: openMap(24, o.walls) });
  for (let i = 0; i < players; i++) addPlayer(game, `p${i}`, NAMES[i]!);
  return game;
}

function clearRoster(w: World): void {
  const q = w.quests;
  if (!q) return;
  for (const qt of [...q.quests.values()]) {
    for (const cid of qt.containers) w.state.containers.delete(cid);
    if (qt.npcId) {
      w.state.mobs.delete(qt.npcId);
      w.mobs.delete(qt.npcId);
    }
    w.state.quests.delete(qt.id);
  }
  q.quests.clear();
  q.carried.clear();
  w.state.unknownQuests = 0;
}

function makeRun(o: WorldOpts = {}): World {
  const world = makeLobby(o);
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  clearRoster(world);
  return world;
}

const P = (w: World, i: number): PlayerState => w.state.players.get(`p${i}`)!;
const RT = (w: World, i: number) => w.players.get(`p${i}`)!;

const GIVER: Vec2 = { x: 6 * TILE, y: 6 * TILE };

function offer(w: World, defId: string, extra: { tokens?: Vec2[]; parcel?: Vec2; known?: boolean; at?: Vec2; accepted?: boolean } = {}): QuestRuntime {
  const def = questDefById(defId);
  if (!def) throw new Error(`unknown quest ${defId}`);
  const qt = offerQuest(w, def, extra.known ?? true, { at: extra.at ?? GIVER, tokens: extra.tokens, parcel: extra.parcel });
  if (extra.accepted !== false) accept(w, qt);
  return qt;
}

const entry = (victim: string, by: string, raw: number): LedgerEntry => ({
  victim, by: { id: by, name: by }, packet: { raw, phys: 1, magic: 0, true: 0 }, weapon: "sword", scale: 1, stagger: false,
});

function killMobOf(w: World, region: FactionId, by: string, elite = false): void {
  const id = placeMob(w, { region, elite, at: { x: 18 * TILE, y: 18 * TILE }, facing: 0 });
  const c = combatant(w, id);
  if (!c || c.kind !== "mob") throw new Error("mob missing");
  hurtMob(w, c, [c.s.maxHp + 1], [entry(id, by, c.s.maxHp + 1)]);
}

function pickup(w: World, playerIndex: number, containerId: string): void {
  const c = combatant(w, `p${playerIndex}`);
  if (!c || c.kind !== "player") throw new Error("player missing");
  step(w, TICK_MS);
  step(w, TICK_MS);
  handlePickup(w, c, { kind: "pickup", containerId });
}

describe("the roster", () => {
  it("offers the full runtime roster but syncs only known quests and their living givers", () => {
    const config: SimConfig = {
      minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
      suddenDeathSeconds: 60, mobs: false, quests: true,
    };
    const world = createGameWorld({ seed: 77, config, random: mulberry32(78) });
    addPlayer(world, "p0", "alice");
    addPlayer(world, "p1", "bob");
    step(world, TICK_MS);
    expect(world.state.phase).toBe("active");
    expect(world.quests!.quests.size).toBe(QUEST_COUNT);
    expect(world.state.quests.size).toBe(QUEST_KNOWN_COUNT);
    expect(world.state.unknownQuests).toBe(QUEST_UNKNOWN_COUNT);
    for (const q of world.state.quests.values()) {
      const giver = [...world.state.mobs.values()].find((m) => m.x === q.x && m.y === q.y);
      expect(giver, `giver of ${q.def}`).toBeDefined();
      expect(giver!.kind).toBe("quest");
      expect(giver!.status).toBe("alive");
    }
  });

  it("is off unless the config asks for it, and always off in training", () => {
    const plain = makeRun({ quests: false });
    expect(plain.quests).toBeNull();
    expect(plain.state.quests.size).toBe(0);
    const training = makeRun({ quests: true, training: true });
    expect(training.quests).toBeNull();
    expect(training.state.quests.size).toBe(0);
  });
});

describe("quest givers", () => {
  it("are nobody's enemy and cannot be hurt", () => {
    const w = makeRun();
    const qt = offer(w, "cull-fire");
    const giver = combatant(w, qt.npcId);
    const player = combatant(w, "p0");
    if (!giver || !player || giver.kind !== "mob") throw new Error("missing");
    expect(hostile(player, giver)).toBe(false);
    expect(hostile(giver, player)).toBe(false);
    const before = giver.s.hp;
    hurtMob(w, giver, [100], [entry(qt.npcId, "p0", 100)]);
    expect(giver.s.hp).toBe(before);
  });

  it("an unknown quest is private at discovery and publicly synced after the head start", () => {
    const w = makeRun();
    const qt = offer(w, "cull-fire", { known: false });
    expect(qt.published).toBe(false);
    expect(w.state.quests.has(qt.id)).toBe(false);
    P(w, 0).x = qt.s.x + QUEST_REVEAL_RADIUS - 10;
    P(w, 0).y = qt.s.y;
    const ev = step(w, TICK_MS);
    expect(ev.some((e) => e.type === "questReveal" && e.to === "p0" && e.quest.id === qt.id)).toBe(true);
    expect(ev.some((e) => e.type === "toast" && e.to === "p0" && e.text.includes("Quest discovered"))).toBe(true);
    expect(w.state.quests.has(qt.id)).toBe(false);
    let publishedEvents = ev;
    while (w.state.serverTime < qt.publishAt) publishedEvents = step(w, TICK_MS);
    expect(qt.published).toBe(true);
    expect(w.state.quests.get(qt.id)?.def).toBe(qt.def.id);
    expect(publishedEvents.some((e) => e.type === "toast" && e.to === null && e.text.includes("alice") && e.text.includes(qt.def.name))).toBe(true);
  });
});

describe("kill quests", () => {
  it("count only kills of the quest's region, cap at the objective, and track the tour's distinct regions", () => {
    const w = makeRun({ players: 1 });
    const cull = offer(w, "cull-fire");
    const tour = offer(w, "grand-tour");
    killMobOf(w, "plague", "p0");
    expect(cull.s.progress.get("p0") ?? 0).toBe(0);
    expect(tour.s.progress.get("p0")).toBe(1);
    killMobOf(w, "fire", "p0");
    killMobOf(w, "fire", "p0");
    expect(cull.s.progress.get("p0")).toBe(2);
    killMobOf(w, "fire", "p0");
    killMobOf(w, "fire", "p0");
    expect(cull.s.progress.get("p0")).toBe(3);
    killMobOf(w, "frost", "p0");
    expect(tour.s.progress.get("p0")).toBe(3);
  });

  it("an elite counts for the elite hunt and for its region's cull alike", () => {
    const w = makeRun({ players: 1 });
    const hunt = offer(w, "elite-hunt");
    const cull = offer(w, "cull-frost");
    killMobOf(w, "frost", "p0", true);
    expect(hunt.s.progress.get("p0")).toBe(1);
    expect(cull.s.progress.get("p0")).toBe(1);
  });

  it("a player kill counts for the headhunter only", () => {
    const w = makeRun({ players: 2 });
    const hh = offer(w, "headhunter");
    const cull = offer(w, "cull-fire");
    w.hooks.playerKilled?.(w, RT(w, 0), RT(w, 1), "mia");
    expect(hh.s.progress.get("p0") ?? 0).toBe(0);
    w.hooks.playerKilled?.(w, RT(w, 0), RT(w, 1), "died");
    expect(hh.s.progress.get("p0")).toBe(1);
    expect(cull.s.progress.get("p0") ?? 0).toBe(0);
  });
});

describe("turn-in", () => {
  it("completes once: quest GV, the quest's card, a toast, and one winner", () => {
    const w = makeRun();
    const qt = offer(w, "cull-fire");
    for (let i = 0; i < 3; i++) killMobOf(w, "fire", "p0");
    for (let i = 0; i < 3; i++) killMobOf(w, "fire", "p1");
    P(w, 0).x = GIVER.x;
    P(w, 0).y = GIVER.y;
    P(w, 1).x = GIVER.x;
    P(w, 1).y = GIVER.y;
    const ev = step(w, TICK_MS);
    expect(qt.s.status).toBe("done");
    expect(["alice", "bob"]).toContain(qt.s.doneBy);
    const winner = qt.s.doneBy === "alice" ? 0 : 1;
    expect(RT(w, winner).gv.quest).toBe(qt.def.reward.gv);
    expect(RT(w, winner).gv.quest + RT(w, 1 - winner).gv.quest).toBe(qt.def.reward.gv);
    // A feed of 0.75 is nowhere near the brake: the nominal card, once, to the winner alone.
    expect(P(w, winner).build.get(qt.def.reward.card)).toBe(1);
    expect(P(w, 1 - winner).build.size).toBe(0);
    expect(ev.some((e) => e.type === "toast" && e.to === (winner === 0 ? "p0" : "p1") && e.text === "Quest complete: Attack Damage II")).toBe(true);
    expect(ev.some((e) => e.type === "gv" && e.reason === "quest" && e.amount === qt.def.reward.gv)).toBe(true);
    expect(ev.some((e) => e.type === "toast" && e.to === null && e.text.includes(qt.s.doneBy) && e.text.includes(qt.def.name))).toBe(true);
    step(w, TICK_MS);
    expect(P(w, 1 - winner).build.size).toBe(0);
    expect(P(w, winner).build.get(qt.def.reward.card)).toBe(1); // paid once
  });

  it.each([["p0", "p1"], ["p1", "p0"]])(
    "gives a same-tick finish to the lower tieRank, not the first to join: %s outranks %s",
    (low, high) => {
      const w = makeRun();
      const qt = offer(w, "cull-fire");
      for (const id of [low, high]) {
        qt.s.progress.set(id, qt.def.count);
        P(w, id === "p0" ? 0 : 1).x = GIVER.x;
        P(w, id === "p0" ? 0 : 1).y = GIVER.y;
      }
      rig(w, low, high);

      step(w, TICK_MS);

      expect(qt.s.status).toBe("done");
      expect(qt.s.doneBy).toBe(low === "p0" ? "alice" : "bob");
      expect(w.players.get(low)!.gv.quest).toBe(qt.def.reward.gv);
      expect(w.players.get(high)!.gv.quest).toBe(0);
      expect(w.state.players.get(high)!.build.get(qt.def.reward.card) ?? 0).toBe(0);
    },
  );

  // A giver at tile (7, 6) and a wall column at x tile 8: a player at tile 9 is 52 u from it, inside the 64 u turn-in range.
  const WALLED_GIVER: Vec2 = { x: 240, y: 200 };
  const BEHIND: Vec2 = { x: 292, y: 200 };

  it("needs line of sight: a player in range on the far side of a wall does not turn in, and does in the open", () => {
    const walled = makeRun({ players: 1, walls: [[8, 5], [8, 6], [8, 7]] });
    const blocked = offer(walled, "cull-fire", { at: WALLED_GIVER });
    blocked.s.progress.set("p0", blocked.def.count);
    P(walled, 0).x = BEHIND.x;
    P(walled, 0).y = BEHIND.y;
    expect(Math.hypot(BEHIND.x - WALLED_GIVER.x, BEHIND.y - WALLED_GIVER.y)).toBeLessThanOrEqual(QUEST_TURN_IN_RANGE);
    for (let i = 0; i < 5; i++) step(walled, TICK_MS);
    expect(blocked.s.status).toBe("open");
    expect(RT(walled, 0).gv.quest).toBe(0);

    // Control: the same positions with no wall between them complete it, so the wall is what stopped the turn-in.
    const open = makeRun({ players: 1 });
    const clear = offer(open, "cull-fire", { at: WALLED_GIVER });
    clear.s.progress.set("p0", clear.def.count);
    P(open, 0).x = BEHIND.x;
    P(open, 0).y = BEHIND.y;
    step(open, TICK_MS);
    expect(clear.s.status).toBe("done");
  });

  it("pays out through a resolution: the run result has a quest row", () => {
    const w = makeRun({ players: 2 });
    const qt = offer(w, "cull-fire");
    for (let i = 0; i < 3; i++) killMobOf(w, "fire", "p0");
    P(w, 0).x = GIVER.x;
    P(w, 0).y = GIVER.y;
    step(w, TICK_MS);
    expect(qt.s.status).toBe("done");
    downPlayer(w, P(w, 0), RT(w, 0), "died");
    const resolved = w.events.filter((e) => e.type === "resolved");
    expect(resolved.length).toBe(1);
    if (resolved[0]!.type !== "resolved") throw new Error("unreachable");
    expect(resolved[0]!.result.gv.quest).toBe(qt.def.reward.gv);
    expect(resolved[0]!.result.gv.total).toBeGreaterThanOrEqual(qt.def.reward.gv);
  });
});

describe("collect quests", () => {
  it("tokens are picked up like loot, count for the picker alone, and vanish", () => {
    const w = makeRun();
    const tokens: Vec2[] = [{ x: 10 * TILE, y: 10 * TILE }, { x: 11 * TILE, y: 10 * TILE }, { x: 12 * TILE, y: 10 * TILE }];
    const qt = offer(w, "bloom-plague", { tokens });
    expect(qt.containers.length).toBe(3);
    for (const id of qt.containers) {
      const box = w.state.containers.get(id)!;
      expect(box.kind).toBe("quest");
      expect(box.items.at(0)!.def).toBe(QUEST_ITEM_PREFIX + qt.id);
    }
    P(w, 0).x = tokens[0]!.x;
    P(w, 0).y = tokens[0]!.y;
    P(w, 0).weapon0 = "sword"; // a run starts empty-handed; the token must not touch what is carried
    const first = qt.containers[0]!;
    pickup(w, 0, first);
    expect(qt.s.progress.get("p0")).toBe(1);
    expect(w.state.containers.has(first)).toBe(false);
    expect(P(w, 0).weapon0).toBe("sword");
    expect(qt.s.progress.get("p1") ?? 0).toBe(0);
  });

  it("a player at the objective count leaves extra tokens for rivals", () => {
    const w = makeRun();
    const tokens: Vec2[] = [
      { x: 10 * TILE, y: 10 * TILE }, { x: 11 * TILE, y: 10 * TILE },
      { x: 12 * TILE, y: 10 * TILE }, { x: 13 * TILE, y: 10 * TILE },
    ];
    const qt = offer(w, "bloom-plague", { tokens });
    const ids = [...qt.containers];
    for (let i = 0; i < 3; i++) {
      P(w, 0).x = tokens[i]!.x;
      P(w, 0).y = tokens[i]!.y;
      pickup(w, 0, ids[i]!);
    }
    P(w, 0).x = tokens[3]!.x;
    P(w, 0).y = tokens[3]!.y;
    pickup(w, 0, ids[3]!);
    expect(qt.s.progress.get("p0")).toBe(3);
    expect(w.state.containers.has(ids[3]!)).toBe(true);
    expect(w.events.some((e) => e.type === "toast" && e.to === "p0" && e.text.includes("return to") && e.text.includes(qt.def.giver))).toBe(true);
    P(w, 1).x = tokens[3]!.x;
    P(w, 1).y = tokens[3]!.y;
    pickup(w, 1, ids[3]!);
    expect(qt.s.progress.get("p1")).toBe(1);
    expect(w.state.containers.has(ids[3]!)).toBe(false);
  });

  it("three tokens and a walk to the giver completes it", () => {
    const w = makeRun({ players: 1 });
    const tokens: Vec2[] = [{ x: 10 * TILE, y: 10 * TILE }, { x: 11 * TILE, y: 10 * TILE }, { x: 12 * TILE, y: 10 * TILE }];
    const qt = offer(w, "ashcap-fire", { tokens });
    const ids = [...qt.containers];
    tokens.forEach((t, i) => {
      P(w, 0).x = t.x;
      P(w, 0).y = t.y;
      pickup(w, 0, ids[i]!);
    });
    expect(qt.s.progress.get("p0")).toBe(3);
    P(w, 0).x = GIVER.x;
    P(w, 0).y = GIVER.y;
    step(w, TICK_MS);
    expect(qt.s.status).toBe("done");
    expect(P(w, 0).build.get(qt.def.reward.card)).toBe(1);
  });
});

describe("fetch quests", () => {
  it("the parcel is picked up (one per player), carried publicly, and turned in at the giver", () => {
    const w = makeRun();
    const parcel = { x: 20 * TILE, y: 6 * TILE };
    const qt = offer(w, "banner-frost", { parcel });
    P(w, 0).x = parcel.x;
    P(w, 0).y = parcel.y;
    pickup(w, 0, qt.containers[0]!);
    expect(qt.s.carrier).toBe("p0");
    expect(w.quests!.carried.get("p0")).toBe(qt.id);
    expect(w.state.containers.size).toBe(0);
    const qt2 = offer(w, "long-haul", { parcel });
    pickup(w, 0, qt2.containers[0]!);
    expect(qt2.s.carrier).toBe("");
    expect(w.state.containers.has(qt2.containers[0]!)).toBe(true);
    expect(w.events.some((e) => e.type === "toast" && e.to === "p0" && e.text === "you can carry one quest item")).toBe(true);
    P(w, 0).x = GIVER.x;
    P(w, 0).y = GIVER.y;
    step(w, TICK_MS);
    expect(qt.s.status).toBe("done");
    expect(w.quests!.carried.has("p0")).toBe(false);
    expect(P(w, 0).build.get(qt.def.reward.card)).toBe(1);
  });

  it("a carrier who goes down drops the parcel where they fell, and anyone may reclaim it", () => {
    const w = makeRun({ players: 3 });
    const parcel = { x: 20 * TILE, y: 6 * TILE };
    const qt = offer(w, "banner-plague", { parcel });
    P(w, 0).x = parcel.x;
    P(w, 0).y = parcel.y;
    pickup(w, 0, qt.containers[0]!);
    expect(qt.s.carrier).toBe("p0");
    const fell = { x: 15 * TILE, y: 14 * TILE };
    P(w, 0).x = fell.x;
    P(w, 0).y = fell.y;
    downPlayer(w, P(w, 0), RT(w, 0), "died");
    expect(qt.s.carrier).toBe("");
    expect(w.quests!.carried.has("p0")).toBe(false);
    expect(w.events.some((e) => e.type === "toast" && e.to === null && e.text.includes("alice") && e.text.includes("dropped parcel"))).toBe(true);
    const dropped = qt.containers.map((id) => w.state.containers.get(id)!).find((b) => b && b.kind === "quest");
    expect(dropped).toBeDefined();
    expect(dropped!.x).toBe(fell.x);
    expect(dropped!.y).toBe(fell.y);
    P(w, 1).x = fell.x;
    P(w, 1).y = fell.y;
    pickup(w, 1, dropped!.id);
    expect(qt.s.carrier).toBe("p1");
    expect(w.events.some((e) => e.type === "toast" && e.to === null && e.text.includes("bob") && e.text.includes("stole parcel"))).toBe(true);
    P(w, 1).x = GIVER.x;
    P(w, 1).y = GIVER.y;
    step(w, TICK_MS);
    expect(qt.s.status).toBe("done");
    expect(qt.s.doneBy).toBe("bob");
  });
});

describe("expiry", () => {
  it("a public lapsed quest stays synced as expired but loses its giver and ground items", () => {
    const w = makeRun({ players: 1 });
    const tokens: Vec2[] = [{ x: 10 * TILE, y: 10 * TILE }];
    const qt = offer(w, "bloom-plague", { tokens });
    const npcId = qt.npcId;
    qt.s.expiresAt = w.state.serverTime + TICK_MS;
    const ev = step(w, TICK_MS);
    expect(w.state.quests.get(qt.id)?.status).toBe("expired");
    expect(w.quests!.quests.get(qt.id)).toBe(qt);
    expect(ev.some((e) => e.type === "toast" && e.to === null && e.text.includes("expired") && e.text.includes(qt.def.name))).toBe(true);
    expect(w.state.mobs.has(npcId)).toBe(false);
    expect(w.mobs.has(npcId)).toBe(false);
    expect(w.state.containers.size).toBe(0);
  });

  it("a parcel of a lapsed public quest vanishes from its carrier's hands", () => {
    const w = makeRun({ players: 1 });
    const parcel = { x: 20 * TILE, y: 6 * TILE };
    const qt = offer(w, "banner-holy", { parcel });
    P(w, 0).x = parcel.x;
    P(w, 0).y = parcel.y;
    pickup(w, 0, qt.containers[0]!);
    expect(qt.s.carrier).toBe("p0");
    qt.s.expiresAt = w.state.serverTime + TICK_MS;
    step(w, TICK_MS);
    expect(w.quests!.carried.size).toBe(0);
    expect(qt.s.carrier).toBe("");
    expect(w.state.quests.get(qt.id)?.status).toBe("expired");
  });

  it("an unrevealed lapsed quest stays secret and only decrements the unknown count", () => {
    const w = makeRun({ players: 1 });
    const qt = offer(w, "cull-fire", { known: false });
    expect(w.state.unknownQuests).toBe(1);
    qt.s.expiresAt = w.state.serverTime + TICK_MS;
    const ev = step(w, TICK_MS);
    expect(w.state.quests.has(qt.id)).toBe(false);
    expect(w.quests!.quests.has(qt.id)).toBe(false);
    expect(w.state.unknownQuests).toBe(0);
    expect(ev.some((e) => e.type === "toast" || e.type === "questReveal")).toBe(false);
  });
});

describe("INTERACT_RANGE sanity", () => {
  it("a pickup still respects reach: a token across the map cannot be taken", () => {
    const w = makeRun({ players: 1 });
    const tokens: Vec2[] = [{ x: 20 * TILE, y: 20 * TILE }];
    const qt = offer(w, "tithe-holy", { tokens });
    P(w, 0).x = tokens[0]!.x - INTERACT_RANGE - 100;
    P(w, 0).y = tokens[0]!.y;
    pickup(w, 0, qt.containers[0]!);
    expect(qt.s.progress.get("p0") ?? 0).toBe(0);
    expect(w.state.containers.has(qt.containers[0]!)).toBe(true);
  });
});
