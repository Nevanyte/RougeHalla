// Wire-level check of the state a run produces: what a client reconstructs from the schema stream must equal the
// server's state after every step. Exercises the loot flow ("a container has one parent per item, so items are
// re-created when they move"), the weapon fields (slots, the bow draw, the cooldown), mobs, projectiles (not in the state
// at all: announced by the fx batches, and by a batch of their own to a client that joins mid-flight) and the arena
// lifecycle (patience timer, teleport and gates, immunity, sudden death, GV, the winner) through the real Encoder/Decoder,
// including array splices and map deletes.
import { describe, expect, it } from "vitest";
import { Decoder, Encoder, Reflection } from "@colyseus/schema";
import {
  buffViews, CLIENT_MESSAGE_TYPES, damageShares, decodeMult, DUMMY_HP, DUMMY_RESET_SECONDS, FACTIONS, GV_KILL, mulberry32, raycast,
  SIGNATURE_WEAPONS, SWAP_SECONDS, TICK_MS, unpackFx, unpackLaunches, type FxEvent, type ProjectileLaunch, type TimedFx, type Vec2,
} from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { FxChannel } from "../src/rooms/FxChannel";
import { applyDamage } from "../src/sim/arena";
import { grantBarrier, grantBuff } from "../src/sim/buffs";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { dropWeapon } from "../src/sim/loot";
import { addMob, damageMob } from "../src/sim/mobs";
import { spawnProjectiles } from "../src/sim/projectiles";
import { addPlayer, removePlayer, step } from "../src/sim/step";
import type { SimConfig, SimEvent, World } from "../src/sim/world";

/** Short timers so a whole lifecycle (kill, teleport, a leave, a second teleport, the end) fits in 160 ticks. */
function makeWorld(seed: number, players: number, timers: Partial<SimConfig> = {}): World {
  let n = 0;
  return createGameWorld({
    seed,
    config: {
      minPlayers: players, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 2, patienceMinSeconds: 2, suddenDeathSeconds: 1, ...timers,
    },
    random: mulberry32(seed + 1),
    newItemUid: () => `L${++n}`,
  });
}

// The wire narrows some fields (schema.ts): float32 for positions, angles and hp, whole uint32 ms for the timers. The
// server keeps full doubles, so both sides are compared at the wire's precision.
const f32 = Math.fround;
const u32 = (v: number): number => v >>> 0;
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
      key, name: p.name, bot: p.bot, ...fighter(p), status: p.status, kills: p.kills, gv: p.gv, bounty: p.bounty, immuneUntil: u32(p.immuneUntil),
      mobKills: p.mobKills, buffs: [...p.buffs].map(([id, n]) => [id, f32(n)] as const).sort(([a], [b]) => a.localeCompare(b)),
      barrier: f32(p.barrier),
      // The stat mirrors are exact on the wire: the client decodes the very value the sim used.
      asMult: p.asMult, windupMult: p.windupMult, speedMult: p.speedMult, armorBonus: p.armorBonus, shieldBonus: p.shieldBonus,
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

/** The launches a live client holds, as ProjectileView flies them: by id, sorted. */
function flightsOf(flying: ReadonlyMap<string, ProjectileLaunch>) {
  return [...flying.values()]
    .map((l) => ({ key: l.id, kind: l.kind, x: l.x, y: l.y, vx: l.vx, vy: l.vy, t: l.t, range: l.range }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** The server's projectiles against a live client's flights: the same ids, every number within a launch tuple's precision. */
function expectFlights(world: World, flying: ReadonlyMap<string, ProjectileLaunch>, label: string): void {
  const server = [...world.projectiles.values()].sort((a, b) => a.id.localeCompare(b.id));
  const client = flightsOf(flying);
  expect(client.map((c) => c.key), label).toEqual(server.map((pr) => pr.id));
  server.forEach(({ launch: st }, i) => {
    const c = client[i]!;
    expect({ kind: c.kind, t: c.t, range: c.range }, label).toEqual({ kind: st.kind, t: st.t, range: Math.round(st.range) });
    for (const key of ["x", "y", "vx", "vy"] as const) expect(Math.abs(c[key] - st[key]), `${label} ${key}`).toBeLessThanOrEqual(FLIGHT_STEP + 1e-9);
  });
}

/** A client the way the SDK builds one: schema classes come from the handshake's reflection, then full state, then patches. */
function connect(encoder: Encoder<RaidState>): Decoder<RaidState> {
  const decoder = Reflection.decode(Reflection.encode(encoder)) as Decoder<RaidState>;
  decoder.decode(encoder.encodeAll());
  return decoder;
}

/** One connected client: its copy of the state, and what its ProjectileView flies. */
interface Peer {
  decoder: Decoder<RaidState>;
  flying: Map<string, ProjectileLaunch>;
}

/** One server encoder shared by every connected client, like a Room's, with the Room's fx channel in front of it. */
class Wire {
  readonly encoder: Encoder<RaidState>;
  private readonly peers: Peer[] = [];
  private readonly channel = new FxChannel();
  /** Every fx the first client was shown, decoded as RaidScene does it (with its own copy of the roster). */
  readonly shown: TimedFx[] = [];

  constructor(private readonly world: World) {
    this.encoder = new Encoder(world.state);
  }

  /** What the first client's ProjectileView flies: announced by a batch, ended by a projEnd. */
  get flying(): ReadonlyMap<string, ProjectileLaunch> {
    return this.peers[0]!.flying;
  }

  /**
   * A client connects: the full state, and, as RaidRoom.onJoin sends it, a batch with the projectiles in flight. Every batch
   * after that reaches it too, as it does for a client that is still joining (core holds them behind the first two).
   */
  join(): RaidState {
    const decoder = connect(this.encoder);
    const peer: Peer = { decoder, flying: new Map() };
    for (const launch of unpackLaunches(this.channel.inFlight(this.world.projectiles, this.world.state.serverTime))) peer.flying.set(launch.id, launch);
    this.peers.push(peer);
    return decoder.state;
  }

  /** What `join` handed `state`'s client: the launches it holds. */
  flightsOf(state: RaidState): ReadonlyMap<string, ProjectileLaunch> {
    return this.peers.find((p) => p.decoder.state === state)!.flying;
  }

  /**
   * What RaidRoom does after a step: the step's `events` become one batch (sent first, so a client reads it against the roster
   * of the patches before this one), then the tick's patch goes to every connected client, and the server forgets what it sent.
   */
  flush(events: readonly SimEvent[] = []): void {
    const fxs = events.flatMap((e) => (e.type === "fx" ? [e.fx] : []));
    const batch = this.channel.batch(fxs, this.world.state.serverTime, this.world.projectiles);
    if (batch) {
      for (const [i, peer] of this.peers.entries()) {
        for (const launch of unpackLaunches(batch)) peer.flying.set(launch.id, launch);
        for (const fx of unpackFx(batch, peer.decoder.state.roster)) {
          if (i === 0) this.shown.push(fx);
          if (fx.kind === "projEnd") peer.flying.delete(fx.id);
        }
      }
    }
    this.channel.extendRoster(this.world.state);
    const patch = this.encoder.encode();
    for (const peer of this.peers) peer.decoder.decode(patch);
    this.encoder.discardChanges();
    this.channel.rosterSent();
  }

  /** Trees the server's encoder keeps track of: one per live schema object, plus whatever a leak holds on to. */
  get trees(): number {
    return Object.keys(this.encoder.root.changeTrees).length;
  }
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
    expect((client as unknown as Record<string, unknown>).projectiles).toBeUndefined(); // not part of the synced state
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

  it("decodes the bot flag: a bot's seat is marked for every client, one that joins later included, and a bot's kill pays no GV on the wire", () => {
    const world = makeWorld(61, 2); // minPlayers counts humans only: the two bots do not help the lobby start
    addPlayer(world, "a", "alice");
    addPlayer(world, "b", "Botley", { bot: true });
    addPlayer(world, "c", "carol");
    addPlayer(world, "d", "Botsworth", { bot: true });
    const wire = new Wire(world);
    const client = wire.join();
    const tick = () => { step(world, TICK_MS); wire.flush(); };
    const flags = (state: RaidState) => Object.fromEntries([...state.players].map(([id, p]) => [id, p.bot]));

    expect(flags(client)).toEqual({ a: false, b: true, c: false, d: true });
    tick(); // the run starts: the flag is fixed when the seat is created and never changes
    expect(flags(client)).toEqual({ a: false, b: true, c: false, d: true });

    slay(world, "a", "b");
    tick();
    expect([client.players.get("a")!.kills, client.players.get("a")!.gv]).toEqual([1, 0]); // counted, not paid
    slay(world, "a", "c");
    tick();
    expect([client.players.get("a")!.kills, client.players.get("a")!.gv]).toEqual([2, GV_KILL]);
    expect(flags(client)).toEqual({ a: false, b: true, c: false, d: true });
    expect(flags(connect(wire.encoder).state)).toEqual({ a: false, b: true, c: false, d: true });
    expect(snapshot(client)).toEqual(snapshot(world.state));
  });

  it("decodes the buffs map, the stat mirrors, the barrier and the mob kills, and the HUD reads the decoded stacks as the player earned them", () => {
    const world = makeWorld(41, 2);
    addPlayer(world, "a", "alice");
    addPlayer(world, "b", "bob");
    const wire = new Wire(world);
    const client = wire.join();
    const tick = () => { step(world, TICK_MS); wire.flush(); };
    tick(); // the run starts
    const [p, rt] = [world.state.players.get("a")!, world.players.get("a")!];
    expect(client.players.get("a")!.buffs.size).toBe(0);
    const baseMaxHp = p.maxHp;
    // 1.1 is what a mob drops; the map entries are added by the first grant of each buff.
    grantBuff(world, p, rt, "emberImp", 1.1); // damage: no mirror
    grantBuff(world, p, rt, "cinderHound", 0.7); // move speed while chasing a lock: the speedMult mirror stays 1
    grantBuff(world, p, rt, "plagueRat", 3.4); // attack speed: the asMult mirror
    grantBuff(world, p, rt, "iceGolem", 3.4); // max hp, and the hp that comes with it
    grantBarrier(p, rt, 40, world.state.serverTime + 5000);
    p.mobKills = 300; // more than a byte holds
    expect(p.barrier).toBe(40);
    expect(p.asMult).toBeGreaterThan(1000);
    expect(p.maxHp).toBeGreaterThan(baseMaxHp); // grown by the Ice Golem rows
    tick();

    const mine = client.players.get("a")!;
    expect(mine.mobKills).toBe(300);
    expect(mine.barrier).toBeCloseTo(p.barrier, 3);
    expect(mine.maxHp).toBeCloseTo(p.maxHp, 3);
    expect(mine.maxHp).toBeGreaterThan(baseMaxHp);
    expect(mine.asMult).toBe(p.asMult); // the mirrors are exact on the wire: the client decodes the value the sim used
    expect(decodeMult(mine.asMult)).toBeGreaterThan(1);
    expect(mine.speedMult).toBe(1000);
    expect([...mine.buffs].map(([id, n]) => [id, +n.toFixed(4)]).sort(([x], [y]) => String(x).localeCompare(String(y)))).toEqual([
      ["cinderHound", 0.7], ["emberImp", 1.1], ["iceGolem", 3.4], ["plagueRat", 3.4],
    ]);
    expect(snapshot(client)).toEqual(snapshot(world.state));
    expect(snapshot(connect(wire.encoder).state)).toEqual(snapshot(world.state)); // and a client joining now
    // What the HUD shows is read off the decoded player: 1.1 stays 1.1 (a narrower field would read 1.0), in catalog order.
    const rows = buffViews(mine.buffs);
    expect(rows.map((r) => [r.id, r.stacksText])).toEqual([["emberImp", "1.1"], ["cinderHound", "0.7"], ["plagueRat", "3.4"], ["iceGolem", "3.4"]]);

    // A later grant of a buff already held patches its entry in place (a map entry changes, nothing is added).
    grantBuff(world, p, rt, "emberImp", 1.1);
    tick();
    expect(mine.buffs.size).toBe(4);
    expect(mine.buffs.get("emberImp")!).toBeCloseTo(2.2, 5);
    expect(snapshot(client)).toEqual(snapshot(world.state));
    expect(buffViews(mine.buffs).find((r) => r.id === "emberImp")!.stacksText).toBe("2.2");
    // The other player is untouched.
    expect(client.players.get("b")!).toMatchObject({ mobKills: 0, barrier: 0, asMult: 1000, speedMult: 1000, windupMult: 1000 });
    expect(client.players.get("b")!.buffs.size).toBe(0);
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
    // Seed 57: the bow needs an open line of 200 u from bob's spawn, and a spawn on a zone-styled map is may be hemmed in by its structures.
    const world = makeWorld(57, 2);
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

  it("a projectile reaches a live client in the batch of the step that loosed it and is never patched; a client that joins mid-flight is sent the ones flying in a batch of its own", () => {
    const world = makeWorld(71, 2);
    addPlayer(world, "a", "alice");
    addPlayer(world, "b", "bob"); // sentenced: a bow
    const wire = new Wire(world);
    const early = wire.join();
    let late: RaidState | null = null;
    const events: SimEvent[] = [];
    const tick = () => { const out = step(world, TICK_MS); events.push(...out); wire.flush(out); };

    tick(); // the run starts
    const bob = world.state.players.get("b")!;
    const aim = openAim(world, bob, world.state.players.get("a")!);
    const inputs = world.players.get("b")!.inputs;
    enqueueClientMessage(inputs, "attack", { a: aim });
    enqueueClientMessage(inputs, "release", { a: aim });

    // The arrow is announced by the batch of the very step it was loosed in.
    for (let i = 0; i < 20 && world.projectiles.size === 0; i++) tick();
    expect(world.projectiles.size).toBe(1);
    const { id, launch: st } = [...world.projectiles.values()][0]!;
    expect([...wire.flying.keys()]).toEqual([id]);
    expectFlights(world, wire.flying, "at launch");
    const sent = wire.flying.get(id)!;
    expect(sent).toMatchObject({ kind: "arrow", t: st.t, range: st.range });

    // It flies for several ticks, announced once. A client that joins mid-flight is sent it with the batch of the ones flying.
    let flight = 0;
    while (world.projectiles.has(id) && flight < 40) {
      if (flight === 1) {
        late = wire.join();
        expectFlights(world, wire.flightsOf(late), "a client that joins mid-flight");
        expect(wire.flightsOf(late).size).toBe(1);
      }
      tick();
      flight++;
      const rt = world.projectiles.get(id);
      if (!rt) break;
      expect(snapshot(early)).toEqual(snapshot(world.state));
      if (late) expect(snapshot(late)).toEqual(snapshot(world.state));
      // Both clients fly the same projectile, from numbers announced once: position(T) = (x, y) + v * (T - t).
      expectFlights(world, wire.flying, `tick ${flight}`);
      if (late) expectFlights(world, wire.flightsOf(late), `tick ${flight} (late joiner)`);
      const px = sent.x + sent.vx * (rt.simT - sent.t) / 1000;
      const py = sent.y + sent.vy * (rt.simT - sent.t) / 1000;
      expect(Math.hypot(px - rt.x, py - rt.y), `tick ${flight}`).toBeLessThan(0.2);
    }
    expect(flight, "the arrow flew for a few ticks").toBeGreaterThanOrEqual(3);
    expect(world.projectiles.has(id)).toBe(false);

    // Its end arrives as the fx that says where and why it stopped, and every client's flight is over. It carries no start:
    // the clients have the launch.
    expect(wire.flying.size).toBe(0);
    expect(wire.flightsOf(late!).size).toBe(0);
    const end = events.flatMap((e) => (e.type === "fx" && e.fx.kind === "projEnd" ? [e.fx] : []))[0] as Extract<FxEvent, { kind: "projEnd" }>;
    expect(end).toMatchObject({ id, proj: "arrow", x0: st.x, y0: st.y, t0: st.t });
    expect(["wall", "range"]).toContain(end.reason);
    const shownEnd = wire.shown.find((f) => f.kind === "projEnd") as Extract<TimedFx, { kind: "projEnd" }>;
    expect(shownEnd).toMatchObject({ id, proj: "arrow", reason: end.reason });
    expect(Math.hypot(shownEnd.x - end.x, shownEnd.y - end.y)).toBeLessThanOrEqual(Math.SQRT1_2 + 1e-9);
    expect({ x0: shownEnd.x0, y0: shownEnd.y0 }).toEqual({ x0: shownEnd.x, y0: shownEnd.y });

    // A client joining now is sent none.
    expect(wire.flightsOf(wire.join()).size).toBe(0);
  });

  it("thousands of projectiles loosed and stopped leave nothing behind in the server's encoder", () => {
    // A map of them in the state, even one only the full state sends, kept every entry ever deleted from it (about 650 bytes
    // each, for as long as the room lives): the encoder only lets go of an object it sees in a tracked encode.
    const world = makeWorld(72, 2, { patienceSeconds: 100_000, patienceMinSeconds: 100_000, suddenDeathSeconds: 100_000 }); // a long run
    addPlayer(world, "a", "alice");
    addPlayer(world, "b", "bob");
    const wire = new Wire(world);
    wire.join();
    const send = (events: SimEvent[] = []) => wire.flush(events);
    send(step(world, TICK_MS)); // the run starts
    const owner = world.state.players.get("b")!;
    const aim = openAim(world, owner, world.state.players.get("a")!); // along an open line, away from alice: every arrow stops at a wall or its range
    const packet = { raw: 1, ...damageShares(FACTIONS.sentenced) };
    let launches = 0;
    let ends = 0;
    const flyOn = (n: number, perTick: number): void => {
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < perTick; k++) {
          world.combat.spawns.push({ owner: "b", weapon: "bow", kind: "arrow", a: aim, packet });
          launches++;
        }
        spawnProjectiles(world); // as the spawn phase of a step does, here between steps so the count is exact
        const out = step(world, TICK_MS);
        for (const e of out) if (e.type === "fx" && e.fx.kind === "projEnd") ends++;
        send(out);
      }
    };
    flyOn(40, 5); // warm-up: the steady state of this load
    const base = wire.trees;
    flyOn(600, 5); // 3000 more launches, five a step, each flying a few steps
    for (let i = 0; i < 40; i++) {
      const out = step(world, TICK_MS); // and the last ones land
      for (const e of out) if (e.type === "fx" && e.fx.kind === "projEnd") ends++;
      send(out);
    }
    expect(launches).toBe(3200);
    expect(ends, "they all ended").toBe(launches);
    expect(world.projectiles.size).toBe(0);
    expect(wire.trees - base, `trees ${base} -> ${wire.trees}`).toBeLessThanOrEqual(5);
    expect(wire.trees).toBeLessThan(500);
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
    const batch = channel.batch([projEnd], 1000, world.projectiles)!;
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
      if (tick === 20) { // joins mid-run: full state and the projectiles in flight, then the same patches and batches as everyone
        late = wire.join();
        expectFlights(world, wire.flightsOf(late), "the projectiles a late joiner is sent");
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

      if (tick === 30) {
        // One scripted shot, so an arrow is in the air at the end of a step whatever the fuzz's random aims did: the fuzz
        // stands players next to containers, and on a 96 x 96 zone map those are often tucked against a wall (seed 1: no
        // arrow ever outlived its step). Carol, alive until tick 60, stands on a spawn, which is open on every side, and
        // looses along the longest open line.
        const carol = world.state.players.get("c")!;
        carol.x = world.map.spawns[2]!.x;
        carol.y = world.map.spawns[2]!.y;
        const packet = { raw: 1, ...damageShares(FACTIONS.plague) };
        world.combat.spawns.push({ owner: "c", weapon: "bow", kind: "arrow", a: openAim(world, carol, world.state.players.get("a")!), packet });
        spawnProjectiles(world); // step() clears the queue first, so it is launched here, between steps, as the flight test does
      }

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
      if (late) expectFlights(world, wire.flightsOf(late), `seed ${seed} tick ${tick} (late joiner)`);

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
      if (world.projectiles.size > 0) seen.arrow = true;
      if ([...early.mobs.values()].some((m) => m.hp < m.maxHp)) seen.hurtMob = true;
    }

    // A client that connects now, from nothing, agrees with the ones that followed every patch.
    const fresh = connect(wire.encoder).state;
    expect(snapshot(fresh)).toEqual(snapshot(world.state));

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
      move: { x: 100, y: 100 }, stop: {}, target: { id: "p1" }, aim: { a: 1 }, attack: { a: 1 }, release: { a: 1 }, swap: {}, pickup: { containerId: "c1" },
      plan: { ready: true },
      cast: { slot: "wish", x: 100, y: 100 },
      choose: { chest: "c1", pick: 0 }, train: { cmd: "clear" },
    };
    // The arena world takes every type but the practice console's.
    for (const type of CLIENT_MESSAGE_TYPES) expect(enqueueClientMessage(inputs, type, valid[type]), type).toBe(type !== "train");
    expect(enqueueClientMessage(inputs, "train", valid.train, { training: true })).toBe(true);
    for (const type of ["take", "drop", "use", "teleport"]) expect(enqueueClientMessage(inputs, type, { uid: "x", containerId: "c1" }), type).toBe(false);
  });
});
