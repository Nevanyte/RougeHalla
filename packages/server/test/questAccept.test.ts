// Accepting a quest at its giver (`questAccept`, sim/quests.ts handleQuestAccept): the message, every refusal, and the rule it
// introduces: nothing counts for a player until they accepted (kills, tokens, the parcel, the turn-in). The other quest tests
// accept through the rig (support/questRig.ts `accept`); this file is the one that sends the real message.
import { describe, expect, it } from "vitest";
import { Decoder, Encoder, Reflection } from "@colyseus/schema";
import {
  mapFromTiles, mulberry32, QUEST_ACCEPT_RANGE, QUEST_REFUSAL, QUEST_REVEAL_HEAD_START_MS, QUEST_REVEAL_RADIUS, questAcceptedText,
  questAcceptFirstText, questDefById, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, type FactionId, type Vec2,
} from "@raid/shared";
import type { PlayerState, RaidState } from "@raid/shared/schema";
import { downPlayer } from "../src/sim/arena";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { handlePickup } from "../src/sim/loot";
import { hurtMob, placeMob } from "../src/sim/mobLife";
import { handleQuestAccept, offerQuest, type QuestRuntime } from "../src/sim/quests";
import { addStatus } from "../src/sim/status";
import { addPlayer, step } from "../src/sim/step";
import type { LedgerEntry, SimConfig, SimEvent, World } from "../src/sim/world";

const NAMES = ["alice", "bob", "carol"];
const GIVER: Vec2 = { x: 6 * TILE, y: 6 * TILE };

function openMap(side = 24, walls: ReadonlyArray<readonly [number, number]> = []) {
  const tiles = new Uint8Array(side * side).fill(TILE_FLOOR);
  for (let i = 0; i < side; i++) {
    for (const [x, y] of [[i, 0], [i, side - 1], [0, i], [side - 1, i]] as const) tiles[y * side + x] = TILE_WALL;
  }
  for (const [x, y] of walls) tiles[y * side + x] = TILE_WALL;
  return mapFromTiles(side, side, tiles);
}

/** An active run of two (or `players`) players on an open 24x24 map with no regional mobs and no rolled roster: every offer here is placed by hand. */
function makeRun(walls: ReadonlyArray<readonly [number, number]> = [], players = 2): World {
  const config: SimConfig = {
    minPlayers: players, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
    suddenDeathSeconds: 60, mobs: false, quests: true,
  };
  const world = createGameWorld({ config, random: mulberry32(100), map: openMap(24, walls) });
  NAMES.slice(0, players).forEach((name, i) => addPlayer(world, `p${i}`, name));
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  // The open test map has no camps, so no roster was rolled (spawnQuests): offerQuest builds the runtime on the first offer.
  expect(world.quests).toBeNull();
  world.events = [];
  return world;
}

const P = (w: World, i = 0): PlayerState => w.state.players.get(`p${i}`)!;
const RT = (w: World, i = 0) => w.players.get(`p${i}`)!;

function offer(w: World, defId: string, extra: { tokens?: Vec2[]; parcel?: Vec2; known?: boolean; at?: Vec2 } = {}): QuestRuntime {
  return offerQuest(w, questDefById(defId)!, extra.known ?? true, { at: extra.at ?? GIVER, tokens: extra.tokens, parcel: extra.parcel });
}

function stand(w: World, i: number, at: Vec2): void {
  P(w, i).x = at.x;
  P(w, i).y = at.y;
  RT(w, i).path = [];
}

const toastsTo = (events: readonly SimEvent[], to: string): string[] =>
  events.flatMap((e) => (e.type === "toast" && e.to === to ? [e.text] : []));

/** Sends the real message and runs one tick: the events of that tick. */
function sendAccept(w: World, i: number, quest: string): SimEvent[] {
  expect(enqueueClientMessage(RT(w, i).inputs, "questAccept", { quest })).toBe(true);
  return step(w, TICK_MS);
}

const accepted = (qt: QuestRuntime, i = 0): boolean => qt.s.accepted.get(`p${i}`) === true;

const entry = (victim: string, by: string, raw: number): LedgerEntry => ({
  victim, by: { id: by, name: by }, packet: { raw, phys: 1, magic: 0, true: 0 }, weapon: "sword", scale: 1, stagger: false,
});

function killMobOf(w: World, region: FactionId, by: string, elite = false): void {
  const id = placeMob(w, { region, elite, at: { x: 18 * TILE, y: 18 * TILE }, facing: 0 });
  const c = combatant(w, id);
  if (!c || c.kind !== "mob") throw new Error("mob missing");
  hurtMob(w, c, [c.s.maxHp + 1], [entry(id, by, c.s.maxHp + 1)]);
}

function pickup(w: World, i: number, containerId: string): SimEvent[] {
  const c = combatant(w, `p${i}`);
  if (!c || c.kind !== "player") throw new Error("player missing");
  step(w, TICK_MS);
  step(w, TICK_MS);
  w.events = [];
  handlePickup(w, c, { kind: "pickup", containerId });
  return w.events;
}

describe("accepting at the giver", () => {
  it("records the player in the public accepted set and tells them alone", () => {
    const w = makeRun();
    const qt = offer(w, "cull-fire");
    stand(w, 0, { x: GIVER.x + 40, y: GIVER.y });
    expect(accepted(qt)).toBe(false);
    const events = sendAccept(w, 0, qt.id);
    expect(accepted(qt)).toBe(true);
    expect(qt.s.accepted.get("p1")).toBeUndefined();
    expect(w.state.quests.get(qt.id)!.accepted.get("p0")).toBe(true);
    expect(toastsTo(events, "p0")).toEqual([questAcceptedText(qt.def)]);
    expect(toastsTo(events, "p1")).toEqual([]);
    expect(qt.s.status).toBe("open");
  });

  it("is per player: two players accept in the same tick, and each is listed", () => {
    const w = makeRun();
    const qt = offer(w, "cull-fire");
    stand(w, 0, { x: GIVER.x + 30, y: GIVER.y });
    stand(w, 1, { x: GIVER.x - 30, y: GIVER.y });
    expect(enqueueClientMessage(RT(w, 0).inputs, "questAccept", { quest: qt.id })).toBe(true);
    expect(enqueueClientMessage(RT(w, 1).inputs, "questAccept", { quest: qt.id })).toBe(true);
    step(w, TICK_MS);
    expect(accepted(qt, 0)).toBe(true);
    expect(accepted(qt, 1)).toBe(true);
    expect(qt.s.accepted.size).toBe(2);
  });

  it("works exactly inside QUEST_ACCEPT_RANGE and not a unit outside it", () => {
    const w = makeRun();
    const qt = offer(w, "cull-fire");
    stand(w, 0, { x: GIVER.x + QUEST_ACCEPT_RANGE + 1, y: GIVER.y });
    expect(toastsTo(sendAccept(w, 0, qt.id), "p0")).toEqual([QUEST_REFUSAL.far]);
    expect(accepted(qt)).toBe(false);
    stand(w, 0, { x: GIVER.x + QUEST_ACCEPT_RANGE - 1, y: GIVER.y });
    sendAccept(w, 0, qt.id);
    expect(accepted(qt)).toBe(true);
  });

  it("refuses a second accept with a toast and changes nothing", () => {
    const w = makeRun();
    const qt = offer(w, "cull-fire");
    stand(w, 0, GIVER);
    sendAccept(w, 0, qt.id);
    const events = sendAccept(w, 0, qt.id);
    expect(toastsTo(events, "p0")).toEqual([QUEST_REFUSAL.already]);
    expect(qt.s.accepted.size).toBe(1);
  });
});

describe("accept refusals", () => {
  it("through a wall: no line of sight, \"Can't reach that\"; in the open the same spot works", () => {
    // A giver at tile (7, 6), a wall column at tile 8: a player at tile 9 is 52 u from it, inside the range.
    const giver: Vec2 = { x: 240, y: 200 };
    const behind: Vec2 = { x: 292, y: 200 };
    expect(Math.hypot(behind.x - giver.x, behind.y - giver.y)).toBeLessThanOrEqual(QUEST_ACCEPT_RANGE);
    const walled = makeRun([[8, 5], [8, 6], [8, 7]]);
    const blocked = offer(walled, "cull-fire", { at: giver });
    stand(walled, 0, behind);
    expect(toastsTo(sendAccept(walled, 0, blocked.id), "p0")).toEqual([QUEST_REFUSAL.blocked]);
    expect(accepted(blocked)).toBe(false);

    const open = makeRun();
    const clear = offer(open, "cull-fire", { at: giver });
    stand(open, 0, behind);
    sendAccept(open, 0, clear.id);
    expect(accepted(clear)).toBe(true);
  });

  it("a stunned player is refused: \"Can't do that now\"", () => {
    const w = makeRun();
    const qt = offer(w, "cull-fire");
    stand(w, 0, GIVER);
    addStatus(w, combatant(w, "p0")!, { kind: "stun", source: { id: "x", name: "x" }, ms: 2000 });
    expect(toastsTo(sendAccept(w, 0, qt.id), "p0")).toEqual([QUEST_REFUSAL.busy]);
    expect(accepted(qt)).toBe(false);
  });

  it("an unknown id, a closed offer and a giver that is gone are all \"That quest is over\"", () => {
    const w = makeRun();
    const closed = offer(w, "cull-fire");
    const orphan = offer(w, "cull-sentenced", { at: { x: 10 * TILE, y: 10 * TILE } });
    stand(w, 0, GIVER);
    expect(toastsTo(sendAccept(w, 0, "quest999"), "p0")).toEqual([QUEST_REFUSAL.over]);

    closed.s.status = "expired";
    expect(toastsTo(sendAccept(w, 0, closed.id), "p0")).toEqual([QUEST_REFUSAL.over]);
    expect(accepted(closed)).toBe(false);

    stand(w, 0, { x: 10 * TILE, y: 10 * TILE });
    w.state.mobs.delete(orphan.npcId);
    w.mobs.delete(orphan.npcId);
    expect(toastsTo(sendAccept(w, 0, orphan.id), "p0")).toEqual([QUEST_REFUSAL.over]);
    expect(accepted(orphan)).toBe(false);
  });

  it("a hidden offer answers exactly like an unknown id, so probing ids learns nothing", () => {
    const w = makeRun();
    const hidden = offer(w, "cull-fire", { known: false });
    expect(hidden.published).toBe(false);
    // Far from the giver, so scouting it does not add its own toast to the answer.
    stand(w, 0, { x: 22 * TILE, y: 22 * TILE });
    const real = toastsTo(sendAccept(w, 0, hidden.id), "p0");
    const made = toastsTo(sendAccept(w, 0, "quest999"), "p0");
    expect(real).toEqual([QUEST_REFUSAL.over]);
    expect(real).toEqual(made);
    expect(hidden.s.accepted.size).toBe(0);
  });

  it("a hidden offer can be accepted once it went public, by the finder like anyone", () => {
    const w = makeRun();
    const hidden = offer(w, "bloom-plague", { known: false, tokens: [{ x: 14 * TILE, y: 14 * TILE }] });
    stand(w, 0, { x: GIVER.x + QUEST_REVEAL_RADIUS - 8, y: GIVER.y });
    const events = step(w, TICK_MS);
    expect(events.some((e) => e.type === "questReveal" && e.to === "p0")).toBe(true);
    expect(hidden.published).toBe(false);
    stand(w, 0, GIVER);
    expect(toastsTo(sendAccept(w, 0, hidden.id), "p0")).toEqual([QUEST_REFUSAL.over]);
    for (let t = 0; t < QUEST_REVEAL_HEAD_START_MS / TICK_MS + 2; t++) step(w, TICK_MS);
    expect(hidden.published).toBe(true);
    stand(w, 0, GIVER);
    sendAccept(w, 0, hidden.id);
    expect(accepted(hidden)).toBe(true);
  });

  it("is ignored silently outside an active run, for a player who is down, and for a fill bot", () => {
    const w = makeRun();
    const qt = offer(w, "cull-fire");
    stand(w, 0, GIVER);
    stand(w, 1, GIVER);
    const cmd = (quest: string) => ({ kind: "questAccept", quest }) as const;

    w.state.phase = "planning";
    handleQuestAccept(w, combatant(w, "p0")!, cmd(qt.id));
    w.state.phase = "active";
    expect(accepted(qt, 0)).toBe(false);
    expect(toastsTo(w.events, "p0")).toEqual([]);

    RT(w, 1).bot = true;
    expect(toastsTo(sendAccept(w, 1, qt.id), "p1")).toEqual([]);
    expect(accepted(qt, 1)).toBe(false);
    expect(qt.s.accepted.size).toBe(0);

    downPlayer(w, P(w, 0), RT(w, 0), "died");
    handleQuestAccept(w, combatant(w, "p0")!, cmd(qt.id));
    expect(accepted(qt, 0)).toBe(false);
    expect(toastsTo(w.events, "p0")).toEqual([]);
  });

  it("a training room has no quests and so no handler: the message does nothing there", () => {
    const config: SimConfig = {
      minPlayers: 1, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
      suddenDeathSeconds: 60, mobs: false, quests: true, training: true,
    };
    const w = createGameWorld({ config, random: mulberry32(5), map: openMap() });
    addPlayer(w, "p0", "alice");
    step(w, TICK_MS);
    expect(w.quests).toBeNull();
    expect(w.actions.questAccept).toBeUndefined();
    expect(enqueueClientMessage(RT(w, 0).inputs, "questAccept", { quest: "quest1" })).toBe(true);
    expect(() => step(w, TICK_MS)).not.toThrow();
  });
});

describe("nothing counts before the accept", () => {
  it("a mob kill before the accept never counts, and kills after it do", () => {
    const w = makeRun();
    const qt = offer(w, "cull-fire");
    killMobOf(w, "fire", "p0");
    killMobOf(w, "fire", "p0");
    expect(qt.s.progress.get("p0") ?? 0).toBe(0);
    stand(w, 0, GIVER);
    sendAccept(w, 0, qt.id);
    expect(qt.s.progress.get("p0") ?? 0).toBe(0);
    killMobOf(w, "fire", "p0");
    expect(qt.s.progress.get("p0")).toBe(1);
    // p1 never accepted: the same kill is nothing to them.
    killMobOf(w, "fire", "p1");
    expect(qt.s.progress.get("p1") ?? 0).toBe(0);
  });

  it("an elite hunt and a tour count from the accept on", () => {
    const w = makeRun();
    const elite = offer(w, "elite-hunt");
    const tour = offer(w, "grand-tour", { at: { x: 12 * TILE, y: 6 * TILE } });
    killMobOf(w, "frost", "p0", true);
    killMobOf(w, "fire", "p0");
    expect(elite.s.progress.get("p0") ?? 0).toBe(0);
    expect(tour.s.progress.get("p0") ?? 0).toBe(0);
    stand(w, 0, GIVER);
    sendAccept(w, 0, elite.id);
    stand(w, 0, { x: 12 * TILE, y: 6 * TILE });
    sendAccept(w, 0, tour.id);
    killMobOf(w, "plague", "p0");
    // The tour has seen only the plague region since the accept (the earlier fire kill is not remembered).
    expect(tour.s.progress.get("p0")).toBe(1);
    killMobOf(w, "frost", "p0", true);
    expect(elite.s.progress.get("p0")).toBe(1);
  });

  it("a player kill counts for the headhunter only once accepted", () => {
    const w = makeRun();
    const hh = offer(w, "headhunter");
    w.hooks.playerKilled?.(w, RT(w, 0), RT(w, 1), "died");
    expect(hh.s.progress.get("p0") ?? 0).toBe(0);
    stand(w, 0, GIVER);
    sendAccept(w, 0, hh.id);
    w.hooks.playerKilled?.(w, RT(w, 0), RT(w, 1), "died");
    expect(hh.s.progress.get("p0")).toBe(1);
  });

  it("a token is refused with a toast, stays on the ground, and is taken after the accept", () => {
    const w = makeRun();
    const at = { x: 10 * TILE, y: 10 * TILE };
    const qt = offer(w, "bloom-plague", { tokens: [at, { x: 12 * TILE, y: 10 * TILE }, { x: 14 * TILE, y: 10 * TILE }] });
    const first = qt.containers[0]!;
    stand(w, 0, at);
    const events = pickup(w, 0, first);
    expect(toastsTo(events, "p0")).toEqual([questAcceptFirstText(qt.def)]);
    expect(qt.s.progress.get("p0") ?? 0).toBe(0);
    expect(w.state.containers.has(first)).toBe(true);
    expect(qt.containers).toContain(first);

    stand(w, 0, GIVER);
    sendAccept(w, 0, qt.id);
    stand(w, 0, at);
    pickup(w, 0, first);
    expect(qt.s.progress.get("p0")).toBe(1);
    expect(w.state.containers.has(first)).toBe(false);
  });

  it("a parcel stays on the ground for a player who has not accepted, and is carried after the accept", () => {
    const w = makeRun();
    const parcel = { x: 16 * TILE, y: 14 * TILE };
    const qt = offer(w, "banner-frost", { parcel });
    const box = qt.containers[0]!;
    stand(w, 0, parcel);
    const events = pickup(w, 0, box);
    expect(toastsTo(events, "p0")).toEqual([questAcceptFirstText(qt.def)]);
    expect(qt.s.carrier).toBe("");
    expect(w.quests!.carried.size).toBe(0);
    expect(w.state.containers.has(box)).toBe(true);

    stand(w, 0, GIVER);
    sendAccept(w, 0, qt.id);
    stand(w, 0, parcel);
    pickup(w, 0, box);
    expect(qt.s.carrier).toBe("p0");
    expect(w.state.containers.has(box)).toBe(false);
  });

  it("a player who accepted the parcel's quest lifts it, and one who did not still cannot take it back from the ground", () => {
    const w = makeRun([], 3);
    const parcel = { x: 16 * TILE, y: 14 * TILE };
    const qt = offer(w, "banner-frost", { parcel });
    stand(w, 0, GIVER);
    sendAccept(w, 0, qt.id);
    stand(w, 0, parcel);
    pickup(w, 0, qt.containers[0]!);
    expect(qt.s.carrier).toBe("p0");
    // It falls where its carrier does; p1 has not accepted and so cannot lift it.
    downPlayer(w, P(w, 0), RT(w, 0), "died");
    expect(qt.s.carrier).toBe("");
    const dropped = qt.containers[0]!;
    stand(w, 1, parcel);
    const events = pickup(w, 1, dropped);
    expect(toastsTo(events, "p1")).toEqual([questAcceptFirstText(qt.def)]);
    expect(qt.s.carrier).toBe("");
  });

  it("the turn-in needs the accept: a finished objective at the giver does nothing until the player accepted", () => {
    const w = makeRun();
    const qt = offer(w, "cull-fire");
    qt.s.progress.set("p0", qt.def.count);
    stand(w, 0, GIVER);
    for (let i = 0; i < 3; i++) step(w, TICK_MS);
    expect(qt.s.status).toBe("open");
    expect(RT(w, 0).gv.quest).toBe(0);
    // The accept lands in the tick's inputs and the turn-in reads it in the same tick, after the ledger.
    sendAccept(w, 0, qt.id);
    expect(qt.s.status).toBe("done");
    expect(qt.s.doneBy).toBe("alice");
    expect(RT(w, 0).gv.quest).toBe(qt.def.reward.gv);
  });

  it("a carried parcel is delivered only by an accepted carrier", () => {
    const w = makeRun();
    const qt = offer(w, "banner-frost", { parcel: { x: 16 * TILE, y: 14 * TILE } });
    // A forced carrier (not possible through pickup any more): without the accept the giver does not take it.
    qt.s.carrier = "p0";
    w.quests!.carried.set("p0", qt.id);
    stand(w, 0, GIVER);
    for (let i = 0; i < 3; i++) step(w, TICK_MS);
    expect(qt.s.status).toBe("open");
    sendAccept(w, 0, qt.id);
    expect(qt.s.status).toBe("done");
  });

  it("accepting one offer says nothing for another", () => {
    const w = makeRun();
    const a = offer(w, "cull-fire");
    const b = offer(w, "cull-sentenced", { at: { x: 12 * TILE, y: 6 * TILE } });
    stand(w, 0, GIVER);
    sendAccept(w, 0, a.id);
    killMobOf(w, "fire", "p0");
    killMobOf(w, "sentenced", "p0");
    expect(a.s.progress.get("p0")).toBe(1);
    expect(b.s.progress.get("p0") ?? 0).toBe(0);
  });
});

describe("the accepted set on the wire", () => {
  it("reaches a client's decoded state, is kept for each player, and stays through completion", () => {
    const w = makeRun();
    const qt = offer(w, "cull-fire");
    const encoder = new Encoder<RaidState>(w.state);
    const decoder = Reflection.decode(Reflection.encode(encoder)) as Decoder<RaidState>;
    decoder.decode(encoder.encodeAll());
    const row = () => decoder.state.quests.get(qt.id)!;
    expect(row().accepted.size).toBe(0);

    stand(w, 0, GIVER);
    stand(w, 1, GIVER);
    sendAccept(w, 0, qt.id);
    decoder.decode(encoder.encode());
    encoder.discardChanges();
    expect(row().accepted.get("p0")).toBe(true);
    expect(row().accepted.get("p1")).toBeUndefined();

    sendAccept(w, 1, qt.id);
    decoder.decode(encoder.encode());
    encoder.discardChanges();
    expect([...row().accepted.keys()].sort()).toEqual(["p0", "p1"]);

    // Done: the row lingers for the log, with who accepted it intact.
    qt.s.progress.set("p0", qt.def.count);
    step(w, TICK_MS);
    expect(qt.s.status).toBe("done");
    decoder.decode(encoder.encode());
    encoder.discardChanges();
    expect(row().status).toBe("done");
    expect([...row().accepted.keys()].sort()).toEqual(["p0", "p1"]);
  });

  it("a client that joins late is sent the set in its first sync", () => {
    const w = makeRun();
    const qt = offer(w, "cull-fire");
    stand(w, 0, GIVER);
    sendAccept(w, 0, qt.id);
    const encoder = new Encoder<RaidState>(w.state);
    const decoder = Reflection.decode(Reflection.encode(encoder)) as Decoder<RaidState>;
    decoder.decode(encoder.encodeAll());
    expect(decoder.state.quests.get(qt.id)!.accepted.get("p0")).toBe(true);
  });
});
