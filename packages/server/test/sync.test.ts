// Wire-level check of the state a run produces: what a client reconstructs from the schema stream must equal the
// server's state after every step. Exercises the loot flow ("a container has one parent per item, so items are
// re-created when they move"), the weapon fields (slots, the bow draw, the cooldown), mobs, projectiles (synced once
// and never patched) and the arena lifecycle (patience timer, teleport and gates, immunity, sudden death, GV, the
// winner) through the real Encoder/Decoder, including array splices and map deletes.
import { describe, expect, it } from "vitest";
import { $childType, Decoder, Encoder, getRawChangesCallback, Reflection, type DataChange } from "@colyseus/schema";
import {
  CLIENT_MESSAGE_TYPES, DUMMY_HP, DUMMY_RESET_SECONDS, FACTIONS, GV_KILL, mulberry32, raycast, SIGNATURE_WEAPONS,
  SWAP_SECONDS, TICK_MS, unpackFx, unpackLaunches, type FxEvent, type ProjectileLaunch, type TimedFx, type Vec2,
} from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { FxChannel } from "../src/rooms/FxChannel";
import { applyDamage } from "../src/sim/arena";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { dropWeapon } from "../src/sim/loot";
import { addMob, damageMob } from "../src/sim/mobs";
import { addPlayer, removePlayer, step } from "../src/sim/step";
import type { SimEvent, World } from "../src/sim/world";

/** Short timers so a whole lifecycle (kill, teleport, a leave, a second teleport, the end) fits in 160 ticks. */
function makeWorld(seed: number, players: number): World {
  let n = 0;
  return createGameWorld({
    seed,
    config: { minPlayers: players, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 2, patienceMinSeconds: 2, suddenDeathSeconds: 1 },
    random: mulberry32(seed + 1),
    newItemUid: () => `L${++n}`,
  });
}

// The wire narrows some fields (schema.ts): float32 for positions, angles and hp, whole uint32 ms for the timers, uint16
// for a projectile's range. The server keeps full doubles, so both sides are compared at the wire's precision.
const f32 = Math.fround;
const u32 = (v: number): number => v >>> 0;
const u16 = (v: number): number => v & 0xffff;
/** A projectile's launch tuple keeps x, y, vx and vy to a tenth: the most one of them moves. */
const FLIGHT_STEP = 0.05;

/** The fields players and mobs share (the sim's fighters). */
interface Fighter {
  x: number; y: number; facing: number; hp: number; maxHp: number; faction: string;
  weapon0: string; weapon1: string; slot: number; drawStartedAt: number; readyAt: number;
}

function fighter(s: Fighter) {
  return {
    x: f32(s.x), y: f32(s.y), facing: f32(s.facing), hp: f32(s.hp), maxHp: f32(s.maxHp), faction: s.faction,
    weapon0: s.weapon0, weapon1: s.weapon1, slot: s.slot, drawStartedAt: u32(s.drawStartedAt), readyAt: u32(s.readyAt),
  };
}

/** Everything a run can touch, as plain data. Works on the server state and on a decoded one alike. */
function snapshot(state: RaidState) {
  const items = (list: Iterable<{ uid: string; def: string }>) => Array.from(list, (i) => ({ uid: i.uid, def: i.def }));
  const byKey = (a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key);
  const players = [...state.players]
    .map(([key, p]) => ({
      key, name: p.name, ...fighter(p), status: p.status, kills: p.kills, gv: p.gv, bounty: p.bounty, immuneUntil: u32(p.immuneUntil),
    }))
    .sort(byKey);
  const mobs = [...state.mobs]
    .map(([key, m]) => ({ key, kind: m.kind, name: m.name, status: m.status, ...fighter(m) }))
    .sort(byKey);
  const containers = [...state.containers]
    .map(([key, c]) => ({ key, id: c.id, kind: c.kind, x: f32(c.x), y: f32(c.y), label: c.label, items: items(c.items) }))
    .sort(byKey);
  return {
    phase: state.phase, seed: state.seed, serverTime: state.serverTime, lobbyEndsAt: state.lobbyEndsAt,
    raidStartedAt: state.raidStartedAt, minPlayers: state.minPlayers, startedWith: state.startedWith,
    patienceEndsAt: state.patienceEndsAt, inColiseum: state.inColiseum, gatesLocked: state.gatesLocked,
    suddenDeathAt: state.suddenDeathAt, winner: state.winner, players, mobs, containers, roster: [...state.roster],
  };
}

/**
 * The projectiles in a state, at the wire's precision. Patches never carry them (a live client is told by an `fxs` batch, see
 * Wire.flying), so only a client that has just joined, from the full state, can be compared with this. `owner` and
 * `tick` are not synced at all: the server's own, no client reads them.
 */
function projectilesOf(state: RaidState) {
  return [...state.projectiles]
    .map(([key, p]) => ({
      key, kind: p.kind, x: f32(p.x), y: f32(p.y), vx: f32(p.vx), vy: f32(p.vy), t: u32(p.t), range: u16(p.range),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** The launches a live client holds, as `projectilesOf` lists the server's: what ProjectileView flies. */
function flightsOf(flying: ReadonlyMap<string, ProjectileLaunch>) {
  return [...flying.values()]
    .map((l) => ({ key: l.id, kind: l.kind, x: l.x, y: l.y, vx: l.vx, vy: l.vy, t: l.t, range: l.range }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** The server's projectiles against a live client's flights: the same ids, every number within a launch tuple's precision. */
function expectFlights(world: World, flying: ReadonlyMap<string, ProjectileLaunch>, label: string): void {
  const server = [...world.state.projectiles].sort((a, b) => a[0].localeCompare(b[0]));
  const client = flightsOf(flying);
  expect(client.map((c) => c.key), label).toEqual(server.map(([id]) => id));
  server.forEach(([, st], i) => {
    const c = client[i]!;
    expect({ kind: c.kind, t: c.t, range: c.range }, label).toEqual({ kind: st.kind, t: st.t, range: Math.round(st.range) });
    for (const key of ["x", "y", "vx", "vy"] as const) expect(Math.abs(c[key] - st[key]), `${label} ${key}`).toBeLessThanOrEqual(FLIGHT_STEP + 1e-9);
  });
}

/** A client the way the SDK builds one: schema classes come from the handshake's reflection, then full state, then patches. */
function connect(encoder: Encoder<RaidState>, onChanges?: (changes: DataChange[]) => void): Decoder<RaidState> {
  const decoder = Reflection.decode(Reflection.encode(encoder)) as Decoder<RaidState>;
  if (onChanges) getRawChangesCallback(decoder, onChanges);
  decoder.decode(encoder.encodeAll());
  return decoder;
}

/** One server encoder shared by every connected client, like a Room's, with the Room's fx channel in front of it. */
class Wire {
  readonly encoder: Encoder<RaidState>;
  private readonly clients: Array<Decoder<RaidState>> = [];
  private readonly channel = new FxChannel();
  /** What the first client's ProjectileView flies: announced by a batch, ended by a projEnd. */
  readonly flying = new Map<string, ProjectileLaunch>();
  /** Every fx that client was shown, decoded as RaidScene does it (with its own copy of the roster). */
  readonly shown: TimedFx[] = [];

  constructor(private readonly world: World) {
    this.encoder = new Encoder(world.state);
  }

  /** `onChanges` is called with every field and collection change this client decodes (see ProjectileWatch). */
  join(onChanges?: (changes: DataChange[]) => void): RaidState {
    const decoder = connect(this.encoder, onChanges);
    this.clients.push(decoder);
    return decoder.state;
  }

  /**
   * What RaidRoom does after a step: the step's `events` become one batch (sent first, so a client reads it against the roster
   * of the patches before this one), then the tick's patch goes to every connected client, and the server forgets what it sent.
   */
  flush(events: readonly SimEvent[] = []): void {
    const fxs = events.flatMap((e) => (e.type === "fx" ? [e.fx] : []));
    const batch = this.channel.batch(fxs, this.world.state.serverTime, this.world.state.projectiles);
    const live = this.clients[0]?.state;
    if (batch && live) {
      for (const launch of unpackLaunches(batch)) this.flying.set(launch.id, launch);
      for (const fx of unpackFx(batch, live.roster)) {
        this.shown.push(fx);
        if (fx.kind === "projEnd") this.flying.delete(fx.id);
      }
    }
    this.channel.extendRoster(this.world.state);
    const patch = this.encoder.encode();
    for (const c of this.clients) c.decode(patch);
    this.encoder.discardChanges();
    this.channel.rosterSent();
  }
}

/**
 * Watches the ProjectileState fields one client decodes. A projectile is synced once when loosed: every field arrives in
 * the decode that first shows it (the full state for a client joining mid-flight, else the tick's patch), and nothing
 * touches it afterwards, because every client computes the flight from (x, y, vx, vy, t) itself.
 */
class ProjectileWatch {
  /** Decode calls so far: the full state a client gets on joining is the first, then one per patch. */
  decodes = 0;
  /** refId of each ProjectileState -> the decode its fields first arrived in. */
  readonly firstSeen = new Map<number, number>();
  /** Fields that changed on a ProjectileState after the decode it first arrived in. Must stay empty. */
  readonly patched: string[] = [];
  /** The class this client decoded for the `projectiles` map's children (reflection names every class "_"). */
  private projectileClass: (abstract new () => object) | undefined;

  readonly onChanges = (changes: DataChange[]): void => {
    this.decodes++;
    for (const ch of changes) {
      if (ch.field === "projectiles") this.projectileClass = (ch.value as Record<symbol, never>)[$childType];
      if (ch.field === undefined || !this.projectileClass || !(ch.ref instanceof this.projectileClass)) continue;
      const first = this.firstSeen.get(ch.refId);
      if (first === undefined) this.firstSeen.set(ch.refId, this.decodes);
      else if (first !== this.decodes) this.patched.push(`ref ${ch.refId} ${ch.field} in decode ${this.decodes} (first seen in ${first})`);
    }
  };
}

/** A lethal hit from `by` (a player id) on `id`, between ticks, the way the Room's leave handling does it. */
function slay(world: World, by: string, id: string): void {
  const attacker = { id: by, p: world.state.players.get(by)!, rt: world.players.get(by)! };
  applyDamage(world, world.state.players.get(id)!, world.players.get(id)!, 10_000, attacker);
}

/** Distance from `p` to the segment a-b. */
function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const u = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
}

/** The angle from `from` with the longest open run (at most 400 u), not passing near `other`: an arrow along it flies a while. */
function openAim(world: World, from: Vec2, other: Vec2): number {
  let best = { a: 0, free: -1 };
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * 2 * Math.PI - Math.PI;
    const end = { x: from.x + Math.cos(a) * 400, y: from.y + Math.sin(a) * 400 };
    const ray = raycast(world.map, from.x, from.y, end.x, end.y);
    const free = ray.hit ? ray.dist : 400;
    if (free > best.free && distToSegment(other, from, { x: from.x + Math.cos(a) * free, y: from.y + Math.sin(a) * free }) > 60) {
      best = { a, free };
    }
  }
  expect(best.free, "an open line to shoot along").toBeGreaterThan(200);
  return best.a;
}

describe("schema round trip", () => {
  it("a fresh client decodes the full initial state", () => {
    const world = makeWorld(11, 2);
    addPlayer(world, "a", "alice");
    addPlayer(world, "b", "bob");
    const client = new Wire(world).join();
    expect(snapshot(client)).toEqual(snapshot(world.state));
    expect(client.containers.size).toBe(world.state.containers.size);
    expect(client.containers.size).toBeGreaterThan(10);
    // Everyone gets a faction by join order, its hp, and its signature weapon in the first slot: nothing else.
    const [alice, bob] = [client.players.get("a")!, client.players.get("b")!];
    expect(alice).toMatchObject({
      faction: "fire", hp: FACTIONS.fire.hp, maxHp: FACTIONS.fire.hp, weapon0: SIGNATURE_WEAPONS.fire, weapon1: "", slot: 0,
      drawStartedAt: 0, readyAt: 0,
    });
    expect(bob).toMatchObject({
      faction: "sentenced", hp: FACTIONS.sentenced.hp, maxHp: FACTIONS.sentenced.hp, weapon0: SIGNATURE_WEAPONS.sentenced,
      weapon1: "", slot: 0,
    });
    expect(client.mobs.size).toBe(0);
    expect(client.projectiles.size).toBe(0);
  });

  it("decodes the arena fields by reflection: the timer, the gates, sudden death, the winner and each player's GV and immunity", () => {
    const world = makeWorld(21, 2);
    addPlayer(world, "a", "alice");
    addPlayer(world, "b", "bob");
    const wire = new Wire(world);
    const client = wire.join();
    const tick = () => { step(world, TICK_MS); wire.flush(); };

    // Lobby: nothing about a run yet.
    expect([client.startedWith, client.patienceEndsAt, client.inColiseum, client.gatesLocked, client.suddenDeathAt, client.winner])
      .toEqual([0, 0, false, false, 0, ""]);

    // The run starts on the first step: N, and the first teleport is scheduled patienceSeconds away.
    tick();
    expect(client.phase).toBe("active");
    expect(client.startedWith).toBe(2);
    expect(client.patienceEndsAt).toBe(world.state.serverTime + 2000);
    expect(client.patienceEndsAt).toBeGreaterThan(client.serverTime);
    expect([client.inColiseum, client.gatesLocked, client.suddenDeathAt]).toEqual([false, false, 0]);

    // A kill: the killer's GV (a uint16 on the wire) and kills appear on the client.
    slay(world, "a", "b");
    tick();
    expect(client.players.get("a")!.gv).toBe(GV_KILL);
    expect(client.players.get("a")!.kills).toBe(1);

    // The run ended with a winner and everything locked or reset: the client reads the winner's display name.
    expect(client.phase).toBe("ended");
    expect(client.winner).toBe("alice");
    expect(client.patienceEndsAt).toBe(0);
    expect(snapshot(client)).toEqual(snapshot(world.state));
  });

  it("decodes each player's bounty as it rises, and the GV (kill and bounty) a claim pays", () => {
    const world = makeWorld(31, 5);
    for (const [id, name] of [["a", "alice"], ["b", "bob"], ["c", "carol"], ["d", "dave"], ["e", "erin"]] as const) addPlayer(world, id, name);
    const wire = new Wire(world);
    const client = wire.join();
    const tick = () => { step(world, TICK_MS); wire.flush(); };
    const bounty = (id: string) => client.players.get(id)!.bounty;

    tick(); // the run starts
    slay(world, "a", "b");
    slay(world, "a", "c");
    tick();
    expect([bounty("a"), client.players.get("a")!.kills]).toEqual([0, 2]);
    slay(world, "a", "d"); // the third kill: a bounty of 10, a uint16 on the wire
    tick();
    expect([bounty("a"), client.players.get("a")!.kills, client.players.get("a")!.gv]).toEqual([10, 3, 3 * GV_KILL]);
    expect(snapshot(client)).toEqual(snapshot(world.state));

    slay(world, "e", "a"); // erin collects it and is the last one standing
    tick();
    expect([client.players.get("e")!.gv, client.players.get("e")!.kills, bounty("e")]).toEqual([GV_KILL + 10, 1, 0]);
    expect(bounty("a")).toBe(10); // the dead keep their bounty: the scoreboard still shows what it was
    expect(client.winner).toBe("erin");
    expect(snapshot(client)).toEqual(snapshot(world.state));
    expect(snapshot(connect(wire.encoder).state)).toEqual(snapshot(world.state)); // and so does a client joining now
  });

  it("decodes a teleport and sudden death: gates, coliseum, immunity and the timers", () => {
    const world = makeWorld(22, 3);
    addPlayer(world, "a", "alice");
    addPlayer(world, "b", "bob");
    addPlayer(world, "c", "carol");
    const wire = new Wire(world);
    const client = wire.join();
    const tick = () => { step(world, TICK_MS); wire.flush(); };
    const runUntil = (pred: () => boolean, what: string) => {
      for (let i = 0; i < 400 && !pred(); i++) tick();
      expect(pred(), what).toBe(true);
    };

    runUntil(() => client.gatesLocked, "the teleport");
    expect(client.inColiseum).toBe(true);
    expect(client.patienceEndsAt).toBe(0);
    expect(client.suddenDeathAt).toBe(world.state.serverTime + 1000);
    for (const p of client.players.values()) expect(p.immuneUntil).toBe(world.state.serverTime + 1500);

    runUntil(() => client.serverTime >= client.suddenDeathAt + 1500, "sudden death to have burnt for a while");
    for (const [id, p] of client.players) expect(p.hp, id).toBeLessThan(p.maxHp);

    // A death in the coliseum unlocks the gates and restarts the timer; the coliseum flag stays.
    slay(world, "a", "b");
    tick();
    expect(client.gatesLocked).toBe(false);
    expect(client.inColiseum).toBe(true);
    expect(client.suddenDeathAt).toBe(0);
    expect(client.patienceEndsAt).toBeGreaterThan(client.serverTime);
    expect(client.players.get("b")!.status).toBe("dead");
    expect(snapshot(client)).toEqual(snapshot(world.state));
  });

  it("decodes the weapon fields: a pickup into the free slot, a swap, the bow draw and the cooldown it leaves", () => {
    const world = makeWorld(51, 2);
    addPlayer(world, "a", "alice"); // fire: axe
    addPlayer(world, "b", "bob"); // sentenced: bow
    const wire = new Wire(world);
    const client = wire.join();
    const tick = () => { step(world, TICK_MS); wire.flush(); };
    const send = (id: string, type: string, msg: unknown) => expect(enqueueClientMessage(world.players.get(id)!.inputs, type, msg)).toBe(true);
    const alice = () => client.players.get("a")!;
    const bob = () => client.players.get("b")!;

    tick(); // the run starts
    expect(alice()).toMatchObject({ weapon0: "axe", weapon1: "", slot: 0, readyAt: 0 });
    expect(bob()).toMatchObject({ weapon0: "bow", weapon1: "", slot: 0, drawStartedAt: 0 });

    // A loose sword at alice's feet goes into her free slot and vanishes; the axe stays in hand.
    const sword = dropWeapon(world, world.state.players.get("a")!, "sword");
    tick(); // published; nobody can take a container in the tick it appears
    expect(client.containers.has(sword.id)).toBe(true);
    send("a", "pickup", { containerId: sword.id });
    tick();
    expect(alice()).toMatchObject({ weapon0: "axe", weapon1: "sword", slot: 0 });
    expect(client.containers.has(sword.id)).toBe(false);

    // A swap puts the sword in hand and charges SWAP_SECONDS to the shared cooldown.
    send("a", "swap", {});
    tick();
    expect(alice().slot).toBe(1);
    expect(alice().readyAt).toBe(client.serverTime + SWAP_SECONDS * 1000);
    send("a", "swap", { slot: 0 });
    tick();
    expect(alice().slot).toBe(0);
    expect(snapshot(client)).toEqual(snapshot(world.state));

    // The bow draw: drawStartedAt is the server time the pull began, and goes back to 0 when the arrow leaves.
    const a = openAim(world, world.state.players.get("b")!, world.state.players.get("a")!);
    send("b", "attack", { a });
    tick();
    expect(bob().drawStartedAt).toBeGreaterThan(0);
    expect(bob().drawStartedAt).toBeLessThanOrEqual(client.serverTime);
    expect(snapshot(client)).toEqual(snapshot(world.state));
    send("b", "release", { a });
    for (let i = 0; i < 20 && bob().drawStartedAt !== 0; i++) tick();
    expect(bob().drawStartedAt).toBe(0);
    expect(bob().readyAt).toBeGreaterThan(client.serverTime); // the cooldown the shot left
    expect(snapshot(client)).toEqual(snapshot(world.state));
  });

  it("decodes a training dummy: its spawn, a hit, the heal DUMMY_RESET_SECONDS later and its removal", () => {
    const world = makeWorld(61, 2);
    addPlayer(world, "a", "alice");
    addPlayer(world, "b", "bob");
    const id = addMob(world, { kind: "dummy", name: "Dummy", at: world.map.spawns[0]!, facing: 1.5, weapon: "shield" });
    const wire = new Wire(world);
    const client = wire.join();
    const late = () => wire.join();
    const tick = () => { step(world, TICK_MS); wire.flush(); };

    expect(client.mobs.get(id)).toMatchObject({
      kind: "dummy", name: "Dummy", hp: DUMMY_HP, maxHp: DUMMY_HP, status: "alive", faction: "", weapon0: "shield", weapon1: "", slot: 0,
    });
    expect(snapshot(client)).toEqual(snapshot(world.state));

    tick(); // the run starts
    const mob = combatant(world, id)!;
    expect(mob.kind).toBe("mob");
    if (mob.kind !== "mob") return;
    damageMob(world, mob, [1200, 300]);
    tick();
    expect(client.mobs.get(id)!.hp).toBe(DUMMY_HP - 1500);
    expect(snapshot(client)).toEqual(snapshot(world.state));
    expect(snapshot(late())).toEqual(snapshot(world.state));

    for (let i = 0; i < (DUMMY_RESET_SECONDS * 1000) / TICK_MS + 2; i++) tick();
    expect(client.mobs.get(id)!.hp).toBe(DUMMY_HP);

    // A mob that is removed from the state is removed on every client.
    world.state.mobs.delete(id);
    world.mobs.delete(id);
    tick();
    expect(client.mobs.size).toBe(0);
    expect(snapshot(client)).toEqual(snapshot(world.state));
    expect(snapshot(late())).toEqual(snapshot(world.state));
  });

  it("a projectile reaches a live client in the batch of the step that loosed it and is never patched; a client that joins mid-flight gets it with the full state", () => {
    const world = makeWorld(71, 2);
    addPlayer(world, "a", "alice");
    addPlayer(world, "b", "bob"); // sentenced: a bow
    const wire = new Wire(world);
    const earlyWatch = new ProjectileWatch();
    const lateWatch = new ProjectileWatch();
    const early = wire.join(earlyWatch.onChanges);
    let late: RaidState | null = null;
    const events: SimEvent[] = [];
    const tick = () => { const out = step(world, TICK_MS); events.push(...out); wire.flush(out); };

    tick(); // the run starts
    const bob = world.state.players.get("b")!;
    const aim = openAim(world, bob, world.state.players.get("a")!);
    const inputs = world.players.get("b")!.inputs;
    enqueueClientMessage(inputs, "attack", { a: aim });
    enqueueClientMessage(inputs, "release", { a: aim });

    // The arrow is announced by the batch of the very step it was loosed in; the patch of that tick has no trace of it.
    for (let i = 0; i < 20 && world.state.projectiles.size === 0; i++) tick();
    expect(world.state.projectiles.size).toBe(1);
    const [id, st] = [...world.state.projectiles][0]!;
    expect(early.projectiles.size).toBe(0);
    expect([...wire.flying.keys()]).toEqual([id]);
    expectFlights(world, wire.flying, "at launch");
    const sent = wire.flying.get(id)!;
    expect(sent).toMatchObject({ kind: "arrow", t: st.t, range: st.range });
    const decodedAtLaunch = earlyWatch.decodes;

    // It flies for several ticks, announced once. A client that joins mid-flight gets it with the full state, and no more patches than the others.
    let flight = 0;
    while (world.projectiles.has(id) && flight < 40) {
      if (flight === 1) {
        late = wire.join(lateWatch.onChanges);
        expect(projectilesOf(late)).toEqual(projectilesOf(world.state));
        expect(late.projectiles.size).toBe(1);
      }
      tick();
      flight++;
      const rt = world.projectiles.get(id);
      if (!rt) break;
      expect(snapshot(early)).toEqual(snapshot(world.state));
      if (late) expect(snapshot(late)).toEqual(snapshot(world.state));
      expect(early.projectiles.size, "patches carry no projectile").toBe(0);
      // Everything a client needs to draw it is in what was announced once: position(T) = (x, y) + v * (T - t).
      const px = sent.x + sent.vx * (rt.simT - sent.t) / 1000;
      const py = sent.y + sent.vy * (rt.simT - sent.t) / 1000;
      expect(Math.hypot(px - rt.x, py - rt.y), `tick ${flight}`).toBeLessThan(0.2);
    }
    expect(flight, "the arrow flew for a few ticks").toBeGreaterThanOrEqual(3);
    expect(world.projectiles.has(id)).toBe(false);

    // Its end arrives as the fx that says where and why it stopped, and the client's flight is over. It carries no start:
    // the client has the launch.
    expect(wire.flying.size).toBe(0);
    const end = events.flatMap((e) => (e.type === "fx" && e.fx.kind === "projEnd" ? [e.fx] : []))[0] as Extract<FxEvent, { kind: "projEnd" }>;
    expect(end).toMatchObject({ id, proj: "arrow", x0: st.x, y0: st.y, t0: st.t });
    expect(["wall", "range"]).toContain(end.reason);
    const shownEnd = wire.shown.find((f) => f.kind === "projEnd") as Extract<TimedFx, { kind: "projEnd" }>;
    expect(shownEnd).toMatchObject({ id, proj: "arrow", reason: end.reason });
    expect(Math.hypot(shownEnd.x - end.x, shownEnd.y - end.y)).toBeLessThanOrEqual(Math.SQRT1_2 + 1e-9);
    expect({ x0: shownEnd.x0, y0: shownEnd.y0 }).toEqual({ x0: shownEnd.x, y0: shownEnd.y });

    // No client ever saw its fields in a patch.
    expect(earlyWatch.firstSeen.size).toBe(0);
    expect(earlyWatch.decodes - decodedAtLaunch).toBeGreaterThanOrEqual(3);
    expect(earlyWatch.patched).toEqual([]);
    expect(lateWatch.firstSeen.size).toBe(1);
    expect([...lateWatch.firstSeen.values()]).toEqual([1]); // in the full state it joined with
    expect(lateWatch.patched).toEqual([]);
    expect(projectilesOf(connect(wire.encoder).state)).toEqual([]); // and a client joining now sees none
  });

  it("a projectile loosed and stopped within one step is never announced: its end carries the start", () => {
    const world = makeWorld(71, 2);
    addPlayer(world, "a", "alice");
    addPlayer(world, "b", "bob");
    const wire = new Wire(world);
    wire.join();
    const out = step(world, TICK_MS);
    wire.flush(out);
    const channel = new FxChannel();
    const projEnd: FxEvent = { kind: "projEnd", id: "pgone", proj: "arrow", x0: 300, y0: 400, t0: 1000, x: 330, y: 400, reason: "reflected" };
    const batch = channel.batch([projEnd], 1000, world.state.projectiles)!;
    expect(batch.p).toBeUndefined();
    expect(unpackFx(batch, [])).toEqual([{ ...projEnd, t: 1000 }]);
  });

  it.each([1, 2, 3, 4])("seed %i: loot, weapon and mob fuzz through a kill, a leave, two teleports and a win keeps every client equal", (seed) => {
    const rnd = mulberry32(seed * 7919);
    const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    const world = makeWorld(seed, 4);
    addPlayer(world, "a", "alice"); // fire: axe
    addPlayer(world, "b", "bob"); // sentenced: bow
    addPlayer(world, "c", "carol"); // plague: bow
    addPlayer(world, "d", "dave"); // frost: shield
    let dummy = addMob(world, { kind: "dummy", name: "Dummy", at: world.map.spawns[0]!, facing: 1, weapon: "shield" });

    const wire = new Wire(world);
    const early = wire.join();
    expect(snapshot(early)).toEqual(snapshot(world.state));

    const send = (id: string, type: string, msg: unknown) => {
      const rt = world.players.get(id);
      if (rt) enqueueClientMessage(rt.inputs, type, msg);
    };
    const events: SimEvent[] = [];
    let late: RaidState | null = null;
    const initialContainers = new Set(world.state.containers.keys());
    const droppedWeapons = new Set<string>();
    let pickups = 0;
    // What the client was shown at some point; each is a state the fuzz must actually have passed through.
    const seen = {
      timer: false, locked: false, unlockedAgain: false, coliseum: false, suddenDeath: false, immune: false, gv: false,
      secondSlot: false, draw: false, cooldown: false, arrow: false, hurtMob: false,
    };

    for (let tick = 0; tick < 160; tick++) {
      // Out-of-step events first: they happen between ticks, as a Room callback would.
      if (tick === 12) slay(world, "a", "b"); // alice kills bob: GV, a body, the timer restarts
      if (tick === 60) removePlayer(world, "c"); // carol leaves in the coliseum (MIA): the gates open again
      if (tick === 90) {
        // The dummy is removed and another one appears, as the client sees mobs come and go.
        world.state.mobs.delete(dummy);
        world.mobs.delete(dummy);
        dummy = addMob(world, { kind: "dummy", name: "Dummy 2", at: world.map.spawns[1]! });
      }
      if (tick === 138) {
        // Alice finishes the last one off, once his teleport immunity has run out (the hp the fuzz sets is for the sync
        // checks, not for her to lose to).
        const alice = world.state.players.get("a")!;
        alice.hp = alice.maxHp;
        slay(world, "a", "d");
      }
      if (tick === 20) { // joins mid-run: full state, then the same patches as everyone
        late = wire.join();
        expect(projectilesOf(late), "the full state a late joiner gets has the projectiles in flight").toEqual(projectilesOf(world.state));
      }

      const containers = [...world.state.containers.values()];
      for (const [id, p] of world.state.players) {
        // Dead players keep spamming: their input must be a no-op, never corrupt state.
        const near = rnd() < 0.8 ? pick(containers) : null;
        if (near) { p.x = near.x + (rnd() - 0.5) * 20; p.y = near.y + (rnd() - 0.5) * 20; }
        if (p.status === "alive") {
          // Random hp, but never low enough for a stray hit or the burn to end the scripted run early.
          if (rnd() < 0.15) p.hp = p.maxHp * (0.5 + 0.5 * rnd());
          p.hp = Math.max(p.hp, p.maxHp * 0.5);
        }
        const n = Math.floor(rnd() * 4);
        for (let k = 0; k < n; k++) {
          const roll = rnd();
          const a = (rnd() * 2 - 1) * 4; // beyond +-PI too: the server wraps it
          if (roll < 0.10) {
            const c = near ?? pick(containers);
            send(id, "pickup", { containerId: rnd() < 0.95 ? c.id : "no-such-container" });
          } else if (roll < 0.13) {
            send(id, "swap", rnd() < 0.5 ? {} : { slot: rnd() < 0.5 ? 0 : 1 });
          } else if (roll < 0.50) {
            // A tap: a swing or a cast, or a bow loosed at its minimum draw.
            send(id, "attack", { a, t: world.state.serverTime - rnd() * 250 });
            send(id, "release", { a });
          } else if (roll < 0.58) {
            send(id, "attack", rnd() < 0.1 ? { a: "up" } : { a });
          } else if (roll < 0.66) {
            send(id, "release", { a });
          } else if (roll < 0.76) {
            send(id, "aim", { a });
          } else {
            send(id, rnd() < 0.8 ? "move" : "stop", pick(world.map.spawns));
          }
        }
      }
      const mob = world.state.mobs.get(dummy)!;
      if (rnd() < 0.2) mob.hp = Math.max(1, mob.maxHp * rnd());

      // Weapon slots only change by a pickup (a swap moves the slot index, a down player's are cleared).
      const slots = new Map([...world.state.players].map(([id, p]) => [id, [p.weapon0, p.weapon1]]));
      const stepEvents = step(world, TICK_MS);
      events.push(...stepEvents);
      for (const [id, p] of world.state.players) {
        const was = slots.get(id);
        if (p.status !== "alive" || !was) continue;
        pickups += Number(p.weapon0 !== was[0]) + Number(p.weapon1 !== was[1]);
      }
      for (const [id, c] of world.state.containers) if (!initialContainers.has(id) && c.kind === "ground") droppedWeapons.add(id);
      wire.flush(stepEvents);
      expectFlights(world, wire.flying, `seed ${seed} tick ${tick}`);

      const server = snapshot(world.state);
      expect(snapshot(early), `seed ${seed} tick ${tick}`).toEqual(server);
      if (late) expect(snapshot(late), `seed ${seed} tick ${tick} (late joiner)`).toEqual(server);

      if (early.patienceEndsAt > 0) seen.timer = true;
      if (early.gatesLocked) seen.locked = true;
      else if (seen.locked) seen.unlockedAgain = true;
      if (early.inColiseum) seen.coliseum = true;
      if (early.suddenDeathAt > 0) seen.suddenDeath = true;
      if ([...early.players.values()].some((p) => p.immuneUntil > early.serverTime)) seen.immune = true;
      if ([...early.players.values()].some((p) => p.gv > 0)) seen.gv = true;
      if ([...early.players.values()].some((p) => p.slot === 1)) seen.secondSlot = true;
      if ([...early.players.values()].some((p) => p.drawStartedAt > 0)) seen.draw = true;
      if ([...early.players.values()].some((p) => p.readyAt > early.serverTime)) seen.cooldown = true;
      if (world.state.projectiles.size > 0) seen.arrow = true;
      if ([...early.mobs.values()].some((m) => m.hp < m.maxHp)) seen.hurtMob = true;
    }

    // A client that connects now, from nothing, agrees with the ones that followed every patch.
    const fresh = connect(wire.encoder).state;
    expect(snapshot(fresh)).toEqual(snapshot(world.state));
    expect(projectilesOf(fresh)).toEqual(projectilesOf(world.state));

    // The fuzz actually moved things: otherwise equality above proves little.
    expect(seen).toEqual({
      timer: true, locked: true, unlockedAgain: true, coliseum: true, suddenDeath: true, immune: true, gv: true,
      secondSlot: true, draw: true, cooldown: true, arrow: true, hurtMob: true,
    });
    const bodies = [...world.state.containers.values()].filter((c) => c.kind === "body");
    const fx = (kind: FxEvent["kind"]) => events.filter((e) => e.type === "fx" && e.fx.kind === kind).length;
    expect(pickups).toBeGreaterThan(10);
    expect(droppedWeapons.size).toBeGreaterThan(3); // a pickup with both slots full drops the weapon in hand
    expect(fx("windup")).toBeGreaterThan(0); // swings and casts started
    expect(fx("projEnd")).toBeGreaterThan(0); // arrows and balls came to rest
    expect(bodies).toHaveLength(3); // bob (killed), carol (left), dave (killed)

    // The run ended in a win, and every client was told.
    expect(early.phase).toBe("ended");
    expect(early.winner).toBe("alice");
    expect(early.startedWith).toBe(4); // leavers are removed from `players`, but the run's N stays
    expect(early.players.size).toBe(3);
    expect(early.players.has("c")).toBe(false);
    expect(early.players.get("a")!.status).toBe("alive");
    // The two scripted kills, plus whatever the fuzz's own attacks added: a hit on carol just before she left is alice's kill too.
    expect(early.players.get("a")!.gv).toBeGreaterThanOrEqual(2 * GV_KILL);
    expect(early.players.get("a")!.kills).toBeGreaterThanOrEqual(2);
    expect(early.players.get("b")!.status).toBe("dead");
    expect(early.players.get("d")!.status).toBe("dead");
    expect(early.mobs.size).toBe(1); // the first dummy was replaced by the second
    expect(events.filter((e) => e.type === "resolved")).toHaveLength(4);
  });

  it("the wire's message set is the sim's: every client message type parses, anything else is refused", () => {
    const world = makeWorld(81, 1);
    addPlayer(world, "a", "alice");
    const inputs = world.players.get("a")!.inputs;
    const valid: Record<(typeof CLIENT_MESSAGE_TYPES)[number], unknown> = {
      move: { x: 100, y: 100 }, stop: {}, aim: { a: 1 }, attack: { a: 1 }, release: { a: 1 }, swap: {}, pickup: { containerId: "c1" },
    };
    for (const type of CLIENT_MESSAGE_TYPES) expect(enqueueClientMessage(inputs, type, valid[type]), type).toBe(true);
    for (const type of ["take", "drop", "use", "teleport"]) expect(enqueueClientMessage(inputs, type, { uid: "x", containerId: "c1" }), type).toBe(false);
  });
});
