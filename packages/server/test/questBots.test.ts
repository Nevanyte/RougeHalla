// Fill bots (docs/BOTS.md) take no part in quests: they have no quest policy, a bot's death pays no GV, and a bot that won an
// offer would take it from a human who was racing for it. Every entry point is held here against one human and one bot
// doing the same thing, so the human case shows the test is not vacuous.
import { describe, expect, it } from "vitest";
import {
  mapFromTiles, mulberry32, QUEST_REVEAL_RADIUS, questDefById, TICK_MS, TILE, TILE_FLOOR, TILE_WALL,
  type FactionId, type Vec2,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { applyDamage } from "../src/sim/arena";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { handlePickup } from "../src/sim/loot";
import { hurtMob, placeMob } from "../src/sim/mobLife";
import { offerQuest, type QuestRuntime } from "../src/sim/quests";
import { addPlayer, step } from "../src/sim/step";
import type { LedgerEntry, SimConfig, SimEvent, World } from "../src/sim/world";
import { rig } from "./support/questRig";

const GIVER: Vec2 = { x: 6 * TILE, y: 6 * TILE };
/** Well outside QUEST_REVEAL_RADIUS of the giver. */
const FAR: Vec2 = { x: 22 * TILE, y: 22 * TILE };

function openMap(side = 24) {
  const tiles = new Uint8Array(side * side).fill(TILE_FLOOR);
  for (let i = 0; i < side; i++) {
    for (const [x, y] of [[i, 0], [i, side - 1], [0, i], [side - 1, i]] as const) tiles[y * side + x] = TILE_WALL;
  }
  return mapFromTiles(side, side, tiles);
}

/** Two humans (p0 alice, p1 bob) and one fill bot (b0 Botley) in an active run on a campless map: no rolled roster, only the test's offers. */
function makeRun(): World {
  const config: SimConfig = {
    minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
    suddenDeathSeconds: 60, mobs: false, quests: true,
  };
  const world = createGameWorld({ config, random: mulberry32(100), map: openMap() });
  addPlayer(world, "p0", "alice");
  addPlayer(world, "p1", "bob");
  addPlayer(world, "b0", "Botley", { bot: true });
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  expect(world.state.players.get("b0")!.bot).toBe(true);
  expect(world.players.get("b0")!.bot).toBe(true);
  for (const p of world.state.players.values()) { p.maxHp = 1e9; p.hp = 1e9; }
  return world;
}

const P = (w: World, id: string): PlayerState => w.state.players.get(id)!;
const RT = (w: World, id: string) => w.players.get(id)!;

function offer(w: World, defId: string, extra: { tokens?: Vec2[]; parcel?: Vec2; known?: boolean; at?: Vec2 } = {}): QuestRuntime {
  return offerQuest(w, questDefById(defId)!, extra.known ?? true, { at: extra.at ?? GIVER, tokens: extra.tokens, parcel: extra.parcel });
}

function place(w: World, id: string, at: Vec2): void {
  P(w, id).x = at.x;
  P(w, id).y = at.y;
}

/** A lethal blow, the way botRoom.test does it: between ticks, through applyDamage (so kill credit, GV and the hooks run). */
function slay(w: World, killer: string, victim: string): void {
  const v = P(w, victim);
  v.hp = 1;
  applyDamage(w, v, RT(w, victim), 1000, { id: killer, p: P(w, killer), rt: RT(w, killer) });
  expect(v.status).toBe("dead");
}

const entry = (victim: string, by: string, raw: number): LedgerEntry => ({
  victim, by: { id: by, name: by }, packet: { raw, phys: 1, magic: 0, true: 0 }, weapon: "sword", scale: 1, stagger: false,
});

function killMobOf(w: World, region: FactionId, by: string): void {
  const id = placeMob(w, { region, elite: false, at: { x: 18 * TILE, y: 18 * TILE }, facing: 0 });
  const c = combatant(w, id);
  if (!c || c.kind !== "mob") throw new Error("mob missing");
  hurtMob(w, c, [c.s.maxHp + 1], [entry(id, by, c.s.maxHp + 1)]);
}

function pickup(w: World, playerId: string, containerId: string): void {
  const c = combatant(w, playerId);
  if (!c || c.kind !== "player") throw new Error("player missing");
  step(w, TICK_MS);
  step(w, TICK_MS);
  handlePickup(w, c, { kind: "pickup", containerId });
}

const revealsTo = (events: readonly SimEvent[]): string[] => events.flatMap((e) => (e.type === "questReveal" ? [e.to] : []));
const nobodyProgressed = (qt: QuestRuntime): boolean => qt.s.progress.size === 0;

describe("a player kill (A Head for a Head)", () => {
  it("is not advanced, and pays no GV or buff, when a human kills a fill bot", () => {
    const w = makeRun();
    const hh = offer(w, "headhunter");
    place(w, "p0", GIVER);

    slay(w, "p0", "b0");
    expect(P(w, "p0").kills).toBe(1); // the kill itself still counts in the run, as on main
    expect(RT(w, "p0").gv.kills).toBe(0); // and pays no kill GV
    expect(nobodyProgressed(hh)).toBe(true);

    const events = step(w, TICK_MS);
    expect(hh.s.status).toBe("open");
    expect(RT(w, "p0").gv.quest).toBe(0);
    expect(P(w, "p0").buffs.get(hh.def.reward.buff) ?? 0).toBe(0);
    expect(events.some((e) => e.type === "gv" && e.reason === "quest")).toBe(false);
  });

  it("is not advanced when a bot kills a human", () => {
    const w = makeRun();
    const hh = offer(w, "headhunter");
    place(w, "b0", GIVER);

    slay(w, "b0", "p1");
    expect(nobodyProgressed(hh)).toBe(true);
    step(w, TICK_MS);
    expect(hh.s.status).toBe("open");
    expect(RT(w, "b0").gv.quest).toBe(0);
  });

  it("control: a human killing a human advances it, and the turn-in pays", () => {
    const w = makeRun();
    const hh = offer(w, "headhunter");
    place(w, "p0", GIVER);

    slay(w, "p0", "p1");
    expect(hh.s.progress.get("p0")).toBe(1);
    step(w, TICK_MS);
    expect(hh.s.status).toBe("done");
    expect(RT(w, "p0").gv.quest).toBe(hh.def.reward.gv);
  });
});

describe("mob kills and the objective of a bot", () => {
  it("a mob a bot kills advances no kill offer; the same kill by a human does", () => {
    const w = makeRun();
    const cull = offer(w, "cull-fire");
    const tour = offer(w, "grand-tour");

    killMobOf(w, "fire", "b0");
    expect(nobodyProgressed(cull)).toBe(true);
    expect(nobodyProgressed(tour)).toBe(true);

    killMobOf(w, "fire", "p0");
    expect(cull.s.progress.get("p0")).toBe(1);
    expect(tour.s.progress.get("p0")).toBe(1);
  });
});

describe("tokens and parcels", () => {
  it("a bot standing on a token neither takes it nor counts; a human right after does", () => {
    const w = makeRun();
    const tokens: Vec2[] = [{ x: 10 * TILE, y: 10 * TILE }, { x: 11 * TILE, y: 10 * TILE }, { x: 12 * TILE, y: 10 * TILE }];
    const qt = offer(w, "bloom-plague", { tokens });
    const first = qt.containers[0]!;

    place(w, "b0", tokens[0]!);
    pickup(w, "b0", first);
    expect(w.state.containers.has(first)).toBe(true);
    expect(nobodyProgressed(qt)).toBe(true);

    place(w, "p0", tokens[0]!);
    pickup(w, "p0", first);
    expect(w.state.containers.has(first)).toBe(false);
    expect(qt.s.progress.get("p0")).toBe(1);
    expect(qt.s.progress.get("b0")).toBeUndefined();
  });

  it("a bot cannot lift a parcel: nothing is carried and the parcel stays on the ground", () => {
    const w = makeRun();
    const parcel: Vec2 = { x: 20 * TILE, y: 6 * TILE };
    const qt = offer(w, "banner-frost", { parcel });
    const box = qt.containers[0]!;

    place(w, "b0", parcel);
    pickup(w, "b0", box);
    expect(qt.s.carrier).toBe("");
    expect(w.quests!.carried.size).toBe(0);
    expect(w.state.containers.has(box)).toBe(true);

    place(w, "p0", parcel);
    pickup(w, "p0", box);
    expect(qt.s.carrier).toBe("p0");
  });

  it("a bot at the giver with a finished objective (even forced) never turns in or wins; the human there does, whoever outranks", () => {
    const w = makeRun();
    const qt = offer(w, "cull-fire");
    qt.s.progress.set("b0", qt.def.count);
    qt.s.progress.set("p0", qt.def.count);
    place(w, "b0", GIVER);
    place(w, "p0", GIVER);
    rig(w, "b0", "p0"); // the bot would win the tie

    step(w, TICK_MS);
    expect(qt.s.status).toBe("done");
    expect(qt.s.doneBy).toBe("alice");
    expect(RT(w, "b0").gv.quest).toBe(0);
    expect(P(w, "b0").buffs.get(qt.def.reward.buff) ?? 0).toBe(0);
  });

  it("a bot alone at the giver with a finished objective leaves the offer open", () => {
    const w = makeRun();
    const qt = offer(w, "cull-fire");
    qt.s.progress.set("b0", qt.def.count);
    place(w, "b0", GIVER);

    for (let i = 0; i < 5; i++) step(w, TICK_MS);
    expect(qt.s.status).toBe("open");
    expect(qt.s.doneBy).toBe("");
    expect(RT(w, "b0").gv.quest).toBe(0);
  });
});

describe("a hidden giver", () => {
  it("is never found by a bot, even the one who outranks: the next human in range is the finder", () => {
    const w = makeRun();
    const qt = offer(w, "banner-frost", { known: false, parcel: { x: 20 * TILE, y: 6 * TILE } });
    for (const id of ["b0", "p0"]) place(w, id, { x: qt.s.x + QUEST_REVEAL_RADIUS - 10, y: qt.s.y });
    place(w, "p1", FAR); // a second human, out of range
    rig(w, "b0", "p0");

    const events = step(w, TICK_MS);
    expect(revealsTo(events)).toEqual(["p0"]);
    expect(qt.finder).toBe("p0");
    expect(events.some((e) => e.type === "toast" && e.to === "b0")).toBe(false);
  });

  it("is not revealed at all to a bot standing alone beside it", () => {
    const w = makeRun();
    const qt = offer(w, "banner-frost", { known: false, parcel: { x: 20 * TILE, y: 6 * TILE } });
    place(w, "b0", { x: qt.s.x, y: qt.s.y });
    place(w, "p0", FAR);
    place(w, "p1", FAR);

    const events: SimEvent[] = [];
    for (let i = 0; i < 100; i++) events.push(...step(w, TICK_MS));
    expect(revealsTo(events)).toEqual([]);
    expect(qt.finder).toBe("");
    expect(qt.published).toBe(false);
    expect(w.state.unknownQuests).toBe(1);
  });
});
