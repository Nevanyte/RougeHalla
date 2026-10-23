// Wire-level check of the state a run produces: what a client reconstructs from the schema stream must equal the
// server's state after every step. Exercises the loot flow ("an ItemState has one parent, so items are re-created
// when they move") and the arena lifecycle (patience timer, teleport and gates, immunity, sudden death, GV, the
// winner) through the real Encoder/Decoder, including array splices and map deletes.
import { describe, expect, it } from "vitest";
import { Decoder, Encoder, Reflection } from "@colyseus/schema";
import { GV_KILL, mulberry32, TICK_MS, type ItemDTO } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { applyDamage } from "../src/sim/arena";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
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

// The wire carries fractional `t.number()` fields as float32, so both sides are compared at that precision.
const f32 = Math.fround;

/** Everything a run can touch, as plain data. Works on the server state and on a decoded one alike. */
function snapshot(state: RaidState) {
  const items = (list: Iterable<{ uid: string; def: string }>) => Array.from(list, (i) => ({ uid: i.uid, def: i.def }));
  const players = [...state.players]
    .map(([id, p]) => ({
      id, name: p.name, x: f32(p.x), y: f32(p.y), facing: f32(p.facing), hp: f32(p.hp), maxHp: f32(p.maxHp),
      status: p.status, kills: p.kills, gv: p.gv, bounty: p.bounty, immuneUntil: p.immuneUntil, inventory: items(p.inventory),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const containers = [...state.containers]
    .map(([key, c]) => ({ key, id: c.id, kind: c.kind, x: f32(c.x), y: f32(c.y), label: c.label, items: items(c.items) }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return {
    phase: state.phase, seed: state.seed, tick: state.tick, serverTime: state.serverTime, lobbyEndsAt: state.lobbyEndsAt,
    raidStartedAt: state.raidStartedAt, minPlayers: state.minPlayers, startedWith: state.startedWith,
    patienceEndsAt: state.patienceEndsAt, inColiseum: state.inColiseum, gatesLocked: state.gatesLocked,
    suddenDeathAt: state.suddenDeathAt, winner: state.winner, players, containers,
  };
}

/** A client the way the SDK builds one: schema classes come from the handshake's reflection, then full state, then patches. */
function connect(encoder: Encoder<RaidState>): Decoder<RaidState> {
  const decoder = Reflection.decode(Reflection.encode(encoder)) as Decoder<RaidState>;
  decoder.decode(encoder.encodeAll());
  return decoder;
}

/** One server encoder shared by every connected client, like a Room's. */
class Wire {
  readonly encoder: Encoder<RaidState>;
  private readonly clients: Array<Decoder<RaidState>> = [];

  constructor(world: World) {
    this.encoder = new Encoder(world.state);
  }

  join(): RaidState {
    const decoder = connect(this.encoder);
    this.clients.push(decoder);
    return decoder.state;
  }

  /** One tick's patch to every connected client, then the server forgets what it just sent. */
  flush(): void {
    const patch = this.encoder.encode();
    for (const c of this.clients) c.decode(patch);
    this.encoder.discardChanges();
  }
}

/** A lethal hit from `by` (a player id) on `id`, between ticks, the way the Room's leave handling does it. */
function slay(world: World, by: string, id: string): void {
  const attacker = { id: by, p: world.state.players.get(by)!, rt: world.players.get(by)! };
  applyDamage(world, world.state.players.get(id)!, world.players.get(id)!, 10_000, attacker);
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
    expect(client.players.get("a")!.inventory.length).toBeGreaterThan(0); // the start kit came across
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

  it.each([1, 2, 3, 4])("seed %i: loot fuzz through a kill, a leave, two teleports and a win keeps every client equal", (seed) => {
    const rnd = mulberry32(seed * 7919);
    const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    const world = makeWorld(seed, 4);
    addPlayer(world, "a", "alice");
    addPlayer(world, "b", "bob");
    addPlayer(world, "c", "carol");
    addPlayer(world, "d", "dave");

    const wire = new Wire(world);
    const early = wire.join();
    expect(snapshot(early)).toEqual(snapshot(world.state));

    const send = (id: string, type: string, msg: unknown) => {
      const rt = world.players.get(id);
      if (rt) enqueueClientMessage(rt.inputs, type, msg);
    };
    const events: SimEvent[] = [];
    let late: RaidState | null = null;
    let takes = 0;
    // What the client was shown at some point; each is a state the fuzz must actually have passed through.
    const seen = { timer: false, locked: false, unlockedAgain: false, coliseum: false, suddenDeath: false, immune: false, gv: false };

    for (let tick = 0; tick < 160; tick++) {
      // Out-of-step events first: they happen between ticks, as a Room callback would.
      if (tick === 12) slay(world, "a", "b"); // alice kills bob: GV, a body, the timer restarts
      if (tick === 60) removePlayer(world, "c"); // carol leaves in the coliseum (MIA): the gates open again
      if (tick === 138) {
        // Alice finishes the last one off, once his teleport immunity has run out (the hp the fuzz sets is for the heal
        // tests, not for her to lose to).
        world.state.players.get("a")!.hp = 100;
        slay(world, "a", "d");
      }
      if (tick === 20) late = wire.join(); // joins mid-run: full state, then the same patches as everyone

      const containers = [...world.state.containers.values()];
      for (const [id, p] of world.state.players) {
        // Dead players keep spamming: their input must be a no-op, never corrupt state.
        const near = rnd() < 0.8 ? pick(containers) : null;
        if (near) { p.x = near.x + (rnd() - 0.5) * 20; p.y = near.y + (rnd() - 0.5) * 20; }
        if (rnd() < 0.15) p.hp = 10 + Math.floor(rnd() * 80);
        const n = Math.floor(rnd() * 4);
        for (let k = 0; k < n; k++) {
          const roll = rnd();
          if (roll < 0.5) {
            const c = near ?? pick(containers);
            const uid = c.items.length > 0 && rnd() < 0.9 ? pick(Array.from(c.items, (i) => i.uid)) : "no-such-uid";
            send(id, "take", { containerId: rnd() < 0.95 ? c.id : "no-such-container", uid });
          } else if (roll < 0.75) {
            send(id, "drop", { uid: p.inventory.length > 0 && rnd() < 0.9 ? pick(Array.from(p.inventory, (i) => i.uid)) : "no-such-uid" });
          } else {
            send(id, "use", { uid: p.inventory.length > 0 && rnd() < 0.9 ? pick(Array.from(p.inventory, (i) => i.uid)) : "no-such-uid" });
          }
        }
      }

      const before = new Map([...world.state.players].map(([id, p]) => [id, p.inventory.length]));
      events.push(...step(world, TICK_MS));
      for (const [id, p] of world.state.players) takes += Math.max(0, p.inventory.length - (before.get(id) ?? 0));
      wire.flush();

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
    }

    // A client that connects now, from nothing, agrees with the ones that followed every patch.
    const fresh = connect(wire.encoder).state;
    expect(snapshot(fresh)).toEqual(snapshot(world.state));

    // The fuzz actually moved things: otherwise equality above proves little.
    expect(seen).toEqual({ timer: true, locked: true, unlockedAgain: true, coliseum: true, suddenDeath: true, immune: true, gv: true });
    const heals = events.filter((e) => e.type === "fx" && e.fx.kind === "heal").length;
    const bodies = [...world.state.containers.values()].filter((c) => c.kind === "body");
    const dropped = world.idCounter - (world.map.crateSpots.length + world.map.groundSpots.length) - bodies.length;
    expect(takes).toBeGreaterThan(10);
    expect(heals).toBeGreaterThan(3);
    expect(dropped).toBeGreaterThan(5);
    expect(bodies).toHaveLength(3); // bob (killed), carol (left), dave (killed)

    // The run ended in a win, and every client was told.
    expect(early.phase).toBe("ended");
    expect(early.winner).toBe("alice");
    expect(early.startedWith).toBe(4); // leavers are removed from `players`, but the run's N stays
    expect(early.players.size).toBe(3);
    expect(early.players.has("c")).toBe(false);
    expect(early.players.get("a")!.status).toBe("alive");
    expect(early.players.get("a")!.gv).toBe(2 * GV_KILL);
    expect(early.players.get("b")!.status).toBe("dead");
    expect(early.players.get("d")!.status).toBe("dead");
    expect(events.filter((e) => e.type === "resolved")).toHaveLength(4);
  });
});
