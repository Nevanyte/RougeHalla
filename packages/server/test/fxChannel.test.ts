// rooms/FxChannel.ts: what RaidRoom sends as the `fxs` message of a step, and the roster and launch bookkeeping behind it.
// No Colyseus room here: the channel only reads a state and the projectiles in flight, so a bare RaidState and a Map stand
// in for the world.
import { describe, expect, it } from "vitest";
import { getMessageBytes, Protocol } from "@colyseus/core";
import { Encoder } from "@colyseus/schema";
import { unpackFx, unpackLaunches, type FxEvent, type ProjectileEnd, type ProjectileLaunch } from "@raid/shared";
import { MobState, PlayerState, RaidState } from "@raid/shared/schema";
import { FxChannel } from "../src/rooms/FxChannel";

const SESSION = "Ab3dEf9hI";
const T = 5000;

function stateWith(players: string[], mobs: string[] = []): RaidState {
  const state = new RaidState();
  for (const id of players) state.players.set(id, fighter("alive"));
  for (const id of mobs) state.mobs.set(id, new MobState());
  return state;
}

function fighter(status: string): PlayerState {
  const p = new PlayerState();
  p.status = status;
  return p;
}

type Flying = Map<string, { launch: ProjectileLaunch }>;

function loose(flying: Flying, id: string, over: Partial<ProjectileLaunch> = {}): ProjectileLaunch {
  const launch: ProjectileLaunch = { id, kind: "arrow", x: 100.04, y: 200, vx: 900, vy: -12.5, t: T, range: 240, ...over };
  flying.set(id, { launch });
  return launch;
}

const hit: FxEvent = { kind: "hit", id: SESSION, by: "mob1a", amount: 33.3, weapon: "sword" };
const projEnd = (id: string, reason: ProjectileEnd = "hit"): FxEvent => ({
  kind: "projEnd", id, proj: "arrow", x0: 100, y0: 200, t0: T, x: 150, y: 190, reason,
});

/** Pushes the roster the way RaidRoom.tick does around a patch. */
function patch(channel: FxChannel, state: RaidState): void {
  channel.extendRoster(state);
  channel.rosterSent();
}

describe("FxChannel: what a step sends", () => {
  it("nothing for a step with no fx and no new projectile", () => {
    const flying: Flying = new Map();
    const channel = new FxChannel();
    expect(channel.batch([], T, flying)).toBeNull();
    loose(flying, "p1");
    expect(channel.batch([], T, flying)).not.toBeNull();
    expect(channel.batch([], T + 50, flying)).toBeNull(); // announced once
  });

  it("the step's fx in order, stamped with the step's time", () => {
    const channel = new FxChannel();
    const fx: FxEvent[] = [{ kind: "stagger", id: SESSION }, hit, { kind: "teleport" }];
    const batch = channel.batch(fx, T, new Map())!;
    expect(batch.p).toBeUndefined();
    expect(unpackFx(batch, [])).toEqual(fx.map((f) => ({ ...f, t: T })));
  });
});

describe("FxChannel: projectiles", () => {
  it("announces a projectile in the first batch after it left, once, with what the client flies it from", () => {
    const flying: Flying = new Map();
    const channel = new FxChannel();
    loose(flying, "p1");
    const first = channel.batch([], T, flying)!;
    expect(unpackLaunches(first)).toEqual([{ id: "p1", kind: "arrow", x: 100, y: 200, vx: 900, vy: -12.5, t: T, range: 240 }]);
    loose(flying, "p2", { kind: "ball", vx: 380, vy: 0, range: 220 });
    const second = channel.batch([], T + 50, flying)!;
    expect(unpackLaunches(second).map((l) => l.id)).toEqual(["p2"]);
  });

  it("a projectile that was announced ends without its start", () => {
    const flying: Flying = new Map();
    const channel = new FxChannel();
    loose(flying, "p1");
    channel.batch([], T, flying);
    flying.delete("p1");
    const batch = channel.batch([projEnd("p1")], T + 100, flying)!;
    expect(batch.l[0]).toHaveLength(6);
    expect(unpackFx(batch, [])).toEqual([{ ...projEnd("p1"), x0: 150, y0: 190, t0: T + 100, t: T + 100 }]);
  });

  it("a projectile loosed and stopped within the step was never announced: its end carries the start", () => {
    const channel = new FxChannel();
    const batch = channel.batch([projEnd("p9")], T, new Map())!;
    expect(batch.l[0]).toHaveLength(9);
    expect(unpackFx(batch, [])).toEqual([{ ...projEnd("p9"), t: T }]);
  });

  it("forgets an id once it left the world, so a later projEnd for it would carry its start again", () => {
    const flying: Flying = new Map();
    const channel = new FxChannel();
    loose(flying, "p1");
    channel.batch([], T, flying);
    flying.delete("p1");
    channel.batch([], T + 50, flying);
    const batch = channel.batch([projEnd("p1")], T + 100, flying)!;
    expect(batch.l[0]).toHaveLength(9);
  });

  it("a launch in the same step as another projectile's end announces the one and shortens the other", () => {
    const flying: Flying = new Map();
    const channel = new FxChannel();
    loose(flying, "p1");
    channel.batch([], T, flying);
    flying.delete("p1"); // reflected: the old arrow ends and a new one leaves in the same step
    loose(flying, "p2");
    const batch = channel.batch([projEnd("p1", "reflected")], T + 50, flying)!;
    expect(batch.l[0]).toHaveLength(6);
    expect(unpackLaunches(batch).map((l) => l.id)).toEqual(["p2"]);
  });
});

describe("FxChannel: the projectiles a joining client is sent", () => {
  it("is every projectile in flight, announced or not, with how long each has flown", () => {
    const flying: Flying = new Map();
    const channel = new FxChannel();
    loose(flying, "p1", { t: T - 250 });
    channel.batch([], T - 200, flying); // everyone else has p1 already
    loose(flying, "p2", { kind: "ball", vx: 380, vy: 0, range: 220, t: T - 570 });
    loose(flying, "p3", { t: T });
    const batch = channel.inFlight(flying, T);
    expect(batch.t).toBe(T);
    expect(batch.l).toEqual([]);
    const sent = unpackLaunches(batch);
    expect(sent.map((l) => l.id)).toEqual(["p1", "p2", "p3"]);
    expect(sent.map((l) => T - l.t)).toEqual([250, 570, 0]); // `back`, as a launch tuple's own field
    expect(sent[1]).toMatchObject({ kind: "ball", range: 220 });
    // A ball's whole flight is the longest `back` there is; each tuple stays small (the longest field is 3 bytes).
    for (const tuple of batch.p!) expect(tuple.length).toBeLessThanOrEqual(8);
    const bytes = getMessageBytes.raw(Protocol.ROOM_DATA, "fxs", batch).length;
    expect(bytes).toBeLessThan(80);
  });

  it("changes nothing the channel tells everyone else: the next batch still announces only what is new", () => {
    const flying: Flying = new Map();
    const channel = new FxChannel();
    loose(flying, "p1");
    channel.inFlight(flying, T);
    expect(unpackLaunches(channel.batch([], T, flying)!).map((l) => l.id)).toEqual(["p1"]); // not yet announced to them
    channel.inFlight(flying, T + 50);
    expect(channel.batch([], T + 50, flying)).toBeNull();
  });

  it("is an empty batch when nothing flies", () => {
    expect(new FxChannel().inFlight(new Map(), T)).toEqual({ t: T, l: [] });
  });
});

describe("FxChannel: the roster", () => {
  it("appends every player and mob once, in the order first seen, and never reorders", () => {
    const state = stateWith(["pl1", "pl2"], ["mob1", "mob2"]);
    const channel = new FxChannel();
    patch(channel, state);
    expect([...state.roster]).toEqual(["pl1", "pl2", "mob1", "mob2"]);
    state.players.delete("pl1"); // leaves the run: the entry stays, so every index keeps meaning what it meant
    state.players.set("pl3", fighter("alive"));
    state.mobs.set("mob3", new MobState());
    patch(channel, state);
    patch(channel, state);
    expect([...state.roster]).toEqual(["pl1", "pl2", "mob1", "mob2", "pl3", "mob3"]);
  });

  it("leaves a player who is still in the lobby out until the run has started", () => {
    const state = stateWith([], ["mob1"]);
    state.players.set("lobby1", fighter("lobby"));
    state.players.set("lobby2", fighter("lobby"));
    const channel = new FxChannel();
    patch(channel, state);
    expect([...state.roster]).toEqual(["mob1"]);
    // The step that starts the run turns them alive; the patch right after it rosters them, in the order they are in.
    state.players.get("lobby1")!.status = "alive";
    state.players.get("lobby2")!.status = "alive";
    patch(channel, state);
    expect([...state.roster]).toEqual(["mob1", "lobby1", "lobby2"]);
    // A player who is dead is a player of the run, and keeps their entry.
    state.players.get("lobby1")!.status = "dead";
    patch(channel, state);
    expect([...state.roster]).toEqual(["mob1", "lobby1", "lobby2"]);
  });

  it("does not grow with a client that joins and leaves the lobby over and over, and the full state a joiner gets stays small", () => {
    const state = stateWith([], []);
    state.players.set("anchor", fighter("lobby"));
    const channel = new FxChannel();
    const encoder = new Encoder(state);
    const fullBytes = (): number => encoder.encodeAll().length;
    patch(channel, state);
    const before = fullBytes();
    for (let i = 0; i < 300; i++) {
      state.players.set(`churn${i}`, fighter("lobby"));
      patch(channel, state);
      state.players.delete(`churn${i}`);
      patch(channel, state);
    }
    expect(state.roster.length).toBe(0);
    expect(fullBytes()).toBeLessThanOrEqual(before);
    // The mobs are placed when the run starts: they come first in the roster, so every index stays one byte.
    for (let i = 0; i < 60; i++) state.mobs.set(`mob${i}`, new MobState());
    state.players.get("anchor")!.status = "alive";
    patch(channel, state);
    expect(state.roster.length).toBe(61);
    expect(Math.max(...[...state.mobs.keys()].map((id) => state.roster.indexOf(id)))).toBeLessThan(127);
  });

  it("names a fighter by index only once a patch has carried its entry", () => {
    const state = stateWith([SESSION], ["mob1a"]);
    const channel = new FxChannel();
    channel.extendRoster(state); // the tick's patch is about to go out...
    const before = channel.batch([hit], T, new Map())!; // ...but this step's batch was built before it
    expect(before.l[0]![1]).toBe(SESSION);
    channel.rosterSent();
    const after = channel.batch([hit], T + 50, new Map())!;
    expect(after.l[0]!.slice(1, 3)).toEqual([0, 1]);
    expect(unpackFx(after, [...state.roster])).toEqual([{ ...hit, t: T + 50 }]);
  });

  it("reads back against a roster that is not an Array", () => {
    const state = stateWith([SESSION], ["mob1a"]);
    const channel = new FxChannel();
    patch(channel, state);
    const batch = channel.batch([hit], T, new Map())!;
    expect(unpackFx(batch, state.roster)).toEqual([{ ...hit, t: T }]); // an ArraySchema, as the client has it
  });

  it("keeps a hit between two rostered fighters tiny on the wire", () => {
    const state = stateWith([SESSION], ["mob1a"]);
    const channel = new FxChannel();
    const empty = getMessageBytes.raw(Protocol.ROOM_DATA, "fxs", { t: T, l: [] }).length;
    const whole = getMessageBytes.raw(Protocol.ROOM_DATA, "fxs", channel.batch([hit], T, new Map())!).length - empty;
    patch(channel, state);
    const indexed = getMessageBytes.raw(Protocol.ROOM_DATA, "fxs", channel.batch([hit], T, new Map())!).length - empty;
    expect(whole).toBeGreaterThanOrEqual(16); // both ids spelled out
    expect(indexed).toBeLessThanOrEqual(8); // array header, kind, two indices, the amount (2 bytes), the flags
  });
});
