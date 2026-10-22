// Wire-level check of the loot flow: what a client reconstructs from the schema stream must equal the
// server's state after every step. Exercises the "an ItemState has one parent, so items are re-created
// when they move" rule through the real Encoder/Decoder, including array splices and map deletes.
import { describe, expect, it } from "vitest";
import { Decoder, Encoder, Reflection } from "@colyseus/schema";
import { mulberry32, TICK_MS, type ItemDTO } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { addPlayer, removePlayer, resolvePlayer, step } from "../src/sim/step";
import type { SimEvent, World } from "../src/sim/world";

function makeWorld(seed: number, players: number): World {
  let n = 0;
  return createGameWorld({
    seed,
    config: { minPlayers: players, lobbySeconds: 15, fillSeconds: 0, raidSeconds: 360, extractSeconds: 5 },
    random: mulberry32(seed + 1),
    newItemUid: () => `L${++n}`,
  });
}

const gear = (...defs: string[]): ItemDTO[] => defs.map((def, i) => ({ uid: `${def}#${i}`, def }));

// The wire carries fractional `t.number()` fields as float32, so both sides are compared at that precision.
const f32 = Math.fround;

/** Everything the loot flow can touch, as plain data. Works on the server state and on a decoded one alike. */
function snapshot(state: RaidState) {
  const items = (list: Iterable<{ uid: string; def: string }>) => Array.from(list, (i) => ({ uid: i.uid, def: i.def }));
  const players = [...state.players]
    .map(([id, p]) => ({
      id, name: p.name, x: f32(p.x), y: f32(p.y), facing: f32(p.facing), hp: f32(p.hp), maxHp: f32(p.maxHp),
      status: p.status, kills: p.kills, extractProgress: f32(p.extractProgress), inventory: items(p.inventory),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const containers = [...state.containers]
    .map(([key, c]) => ({ key, id: c.id, kind: c.kind, x: f32(c.x), y: f32(c.y), label: c.label, items: items(c.items) }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return { phase: state.phase, tick: state.tick, serverTime: state.serverTime, players, containers };
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

describe("schema round trip", () => {
  it("a fresh client decodes the full initial state", () => {
    const world = makeWorld(11, 2);
    addPlayer(world, "a", "alice", gear("bandage", "knife"));
    addPlayer(world, "b", "bob", gear("medkit"));
    const client = new Wire(world).join();
    expect(snapshot(client)).toEqual(snapshot(world.state));
    expect(client.containers.size).toBe(world.state.containers.size);
    expect(client.containers.size).toBeGreaterThan(10);
  });

  it.each([1, 2, 3, 4])("seed %i: take/drop/use fuzz with a death, an extraction and a disconnect keeps every client equal", (seed) => {
    const rnd = mulberry32(seed * 7919);
    const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    const world = makeWorld(seed, 4);
    addPlayer(world, "a", "alice", gear("bandage", "knife", "watch"));
    addPlayer(world, "b", "bob", gear("medkit", "vest"));
    addPlayer(world, "c", "carol", gear("gold", "pistol", "bandage"));
    addPlayer(world, "d", "dave", gear("rifle"));

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
    let bodies = 0;

    for (let tick = 0; tick < 160; tick++) {
      // Out-of-step events first: they happen between ticks, as a Room callback would.
      if (tick === 30) { resolvePlayer(world, world.state.players.get("b")!, world.players.get("b")!, "died"); bodies++; }
      if (tick === 55) { resolvePlayer(world, world.state.players.get("d")!, world.players.get("d")!, "extracted"); }
      if (tick === 80) { removePlayer(world, "c"); bodies++; } // MIA: body, then the player entry goes
      if (tick === 20) late = wire.join(); // joins mid-raid: full state, then the same patches as everyone

      const containers = [...world.state.containers.values()];
      for (const [id, p] of world.state.players) {
        // Dead and extracted players keep spamming: their input must be a no-op, never corrupt state.
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
    }

    // A client that connects now, from nothing, agrees with the ones that followed every patch.
    const fresh = connect(wire.encoder).state;
    expect(snapshot(fresh)).toEqual(snapshot(world.state));

    // The fuzz actually moved things: otherwise equality above proves little.
    const heals = events.filter((e) => e.type === "fx" && e.fx.kind === "heal").length;
    const dropped = world.idCounter - (world.map.crateSpots.length + world.map.groundSpots.length) - bodies;
    expect(takes).toBeGreaterThan(20);
    expect(heals).toBeGreaterThan(3);
    expect(dropped).toBeGreaterThan(10);
    expect(world.state.players.has("c")).toBe(false);
    expect(early.players.has("c")).toBe(false);
    expect(early.players.get("b")!.status).toBe("dead");
    expect(early.players.get("d")!.status).toBe("extracted");
    expect([...early.containers.values()].filter((c) => c.kind === "body")).toHaveLength(bodies);
  });
});
