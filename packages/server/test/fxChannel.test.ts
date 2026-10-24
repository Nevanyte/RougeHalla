// rooms/FxChannel.ts: what RaidRoom sends as the `fxs` message of a step, and the roster and launch bookkeeping behind it.
// No Colyseus room here: the channel only reads a state, so a bare RaidState stands in for the world.
import { describe, expect, it } from "vitest";
import { getMessageBytes, Protocol } from "@colyseus/core";
import { unpackFx, unpackLaunches, type FxEvent, type ProjectileEnd } from "@raid/shared";
import { MobState, PlayerState, ProjectileState, RaidState } from "@raid/shared/schema";
import { FxChannel } from "../src/rooms/FxChannel";

const SESSION = "Ab3dEf9hI";
const T = 5000;

function stateWith(players: string[], mobs: string[] = []): RaidState {
  const state = new RaidState();
  for (const id of players) state.players.set(id, new PlayerState());
  for (const id of mobs) state.mobs.set(id, new MobState());
  return state;
}

function loose(state: RaidState, id: string, over: Partial<ProjectileState> = {}): ProjectileState {
  const p = new ProjectileState();
  Object.assign(p, { kind: "arrow", owner: SESSION, x: 100.04, y: 200, vx: 900, vy: -12.5, t: T, range: 240, ...over });
  state.projectiles.set(id, p);
  return p;
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
    const state = stateWith([SESSION]);
    const channel = new FxChannel();
    expect(channel.batch([], T, state.projectiles)).toBeNull();
    loose(state, "p1");
    expect(channel.batch([], T, state.projectiles)).not.toBeNull();
    expect(channel.batch([], T + 50, state.projectiles)).toBeNull(); // announced once
  });

  it("the step's fx in order, stamped with the step's time", () => {
    const state = stateWith([SESSION]);
    const channel = new FxChannel();
    const fx: FxEvent[] = [{ kind: "stagger", id: SESSION }, hit, { kind: "teleport" }];
    const batch = channel.batch(fx, T, state.projectiles)!;
    expect(batch.p).toBeUndefined();
    expect(unpackFx(batch, [])).toEqual(fx.map((f) => ({ ...f, t: T })));
  });
});

describe("FxChannel: projectiles", () => {
  it("announces a projectile in the first batch after it left, once, with what the client flies it from", () => {
    const state = stateWith([SESSION]);
    const channel = new FxChannel();
    loose(state, "p1");
    const first = channel.batch([], T, state.projectiles)!;
    expect(unpackLaunches(first)).toEqual([{ id: "p1", kind: "arrow", x: 100, y: 200, vx: 900, vy: -12.5, t: T, range: 240 }]);
    loose(state, "p2", { kind: "ball", vx: 380, vy: 0, range: 220 });
    const second = channel.batch([], T + 50, state.projectiles)!;
    expect(unpackLaunches(second).map((l) => l.id)).toEqual(["p2"]);
  });

  it("a projectile that was announced ends without its start", () => {
    const state = stateWith([SESSION]);
    const channel = new FxChannel();
    loose(state, "p1");
    channel.batch([], T, state.projectiles);
    state.projectiles.delete("p1");
    const batch = channel.batch([projEnd("p1")], T + 100, state.projectiles)!;
    expect(batch.l[0]).toHaveLength(6);
    expect(unpackFx(batch, [])).toEqual([{ ...projEnd("p1"), x0: 150, y0: 190, t0: T + 100, t: T + 100 }]);
  });

  it("a projectile loosed and stopped within the step was never announced: its end carries the start", () => {
    const state = stateWith([SESSION]);
    const channel = new FxChannel();
    const batch = channel.batch([projEnd("p9")], T, state.projectiles)!;
    expect(batch.l[0]).toHaveLength(9);
    expect(unpackFx(batch, [])).toEqual([{ ...projEnd("p9"), t: T }]);
  });

  it("forgets an id once it left the state, so a later projEnd for it would carry its start again", () => {
    const state = stateWith([SESSION]);
    const channel = new FxChannel();
    loose(state, "p1");
    channel.batch([], T, state.projectiles);
    state.projectiles.delete("p1");
    channel.batch([], T + 50, state.projectiles);
    const batch = channel.batch([projEnd("p1")], T + 100, state.projectiles)!;
    expect(batch.l[0]).toHaveLength(9);
  });

  it("a launch in the same step as another projectile's end announces the one and shortens the other", () => {
    const state = stateWith([SESSION]);
    const channel = new FxChannel();
    loose(state, "p1");
    channel.batch([], T, state.projectiles);
    state.projectiles.delete("p1"); // reflected: the old arrow ends and a new one leaves in the same step
    loose(state, "p2", { owner: "mob1a" });
    const batch = channel.batch([projEnd("p1", "reflected")], T + 50, state.projectiles)!;
    expect(batch.l[0]).toHaveLength(6);
    expect(unpackLaunches(batch).map((l) => l.id)).toEqual(["p2"]);
  });
});

describe("FxChannel: the roster", () => {
  it("appends every player and mob once, in the order first seen, and never reorders", () => {
    const state = stateWith(["pl1", "pl2"], ["mob1", "mob2"]);
    const channel = new FxChannel();
    patch(channel, state);
    expect([...state.roster]).toEqual(["pl1", "pl2", "mob1", "mob2"]);
    state.players.delete("pl1"); // leaves the run: the entry stays, so every index keeps meaning what it meant
    state.players.set("pl3", new PlayerState());
    state.mobs.set("mob3", new MobState());
    patch(channel, state);
    patch(channel, state);
    expect([...state.roster]).toEqual(["pl1", "pl2", "mob1", "mob2", "pl3", "mob3"]);
  });

  it("names a fighter by index only once a patch has carried its entry", () => {
    const state = stateWith([SESSION], ["mob1a"]);
    const channel = new FxChannel();
    channel.extendRoster(state); // the tick's patch is about to go out...
    const before = channel.batch([hit], T, state.projectiles)!; // ...but this step's batch was built before it
    expect(before.l[0]![1]).toBe(SESSION);
    channel.rosterSent();
    const after = channel.batch([hit], T + 50, state.projectiles)!;
    expect(after.l[0]!.slice(1, 3)).toEqual([0, 1]);
    expect(unpackFx(after, [...state.roster])).toEqual([{ ...hit, t: T + 50 }]);
  });

  it("reads back against a roster that is not an Array", () => {
    const state = stateWith([SESSION], ["mob1a"]);
    const channel = new FxChannel();
    patch(channel, state);
    const batch = channel.batch([hit], T, state.projectiles)!;
    expect(unpackFx(batch, state.roster)).toEqual([{ ...hit, t: T }]); // an ArraySchema, as the client has it
  });

  it("keeps a hit between two rostered fighters tiny on the wire", () => {
    const state = stateWith([SESSION], ["mob1a"]);
    const channel = new FxChannel();
    const empty = getMessageBytes.raw(Protocol.ROOM_DATA, "fxs", { t: T, l: [] }).length;
    const whole = getMessageBytes.raw(Protocol.ROOM_DATA, "fxs", channel.batch([hit], T, state.projectiles)!).length - empty;
    patch(channel, state);
    const indexed = getMessageBytes.raw(Protocol.ROOM_DATA, "fxs", channel.batch([hit], T, state.projectiles)!).length - empty;
    expect(whole).toBeGreaterThanOrEqual(16); // both ids spelled out
    expect(indexed).toBeLessThanOrEqual(8); // array header, kind, two indices, the amount (2 bytes), the flags
  });
});
