// How a bot plays with the target lock (bots/BotClient.ts): it clicks the foe (`target`) once the foe is within the server's
// reach, walks (`move`) until then and to fetch things, and never streams aim or the trigger. The brain is driven by hand over a
// fake room and a fake clock; nothing here touches a socket.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapFromTiles, TARGET_RANGE, TILE, TILE_FLOOR, TILE_WALL } from "@raid/shared";
import { BotClient, ORBIT_JITTER_MS, ORBIT_MS } from "../src/bots/BotClient";

interface FakeFighter { x: number; y: number; status: string; weapon0: string; weapon1: string; slot: number; attackTarget: string }
type Sent = Array<{ type: string; msg: Record<string, unknown> }>;

/** The private parts of the brain the test reaches into. */
interface Brain {
  room: unknown;
  map: unknown;
  attacking: boolean;
  maxStall: number;
  avoidId: string | null;
  think(): void;
}

const W = 60;
const H = 20;
/** Walls round the edge, and a floor everywhere else; `wall` adds a vertical wall at that tile column (a gap of two tiles at the top and bottom is not left: it is solid). */
function arena(wall?: number): ReturnType<typeof mapFromTiles> {
  const tiles = new Uint8Array(W * H).fill(TILE_FLOOR);
  for (let i = 0; i < W; i++) { tiles[i] = TILE_WALL; tiles[(H - 1) * W + i] = TILE_WALL; }
  for (let i = 0; i < H; i++) { tiles[i * W] = TILE_WALL; tiles[i * W + W - 1] = TILE_WALL; }
  if (wall !== undefined) for (let y = 0; y < H; y++) tiles[y * W + wall] = TILE_WALL;
  return mapFromTiles(W, H, tiles);
}

const NOW = 100_000;

interface Scene {
  b: Brain;
  sent: Sent;
  me: FakeFighter;
  players: Map<string, FakeFighter>;
  mobs: Map<string, Record<string, unknown>>;
  containers: Map<string, Record<string, unknown>>;
  /** One think, then `ms` of the clock. */
  tick(ms?: number): void;
  types(): string[];
}

function scene(opts: { wall?: number; foes?: Record<string, Partial<FakeFighter>>; me?: Partial<FakeFighter> } = {}): Scene {
  const players = new Map<string, FakeFighter>();
  const base = (o: Partial<FakeFighter>): FakeFighter => ({ x: 600, y: 300, status: "alive", weapon0: "sword", weapon1: "", slot: 0, attackTarget: "", ...o });
  const me = base(opts.me ?? {});
  Object.assign(me, { faction: "fire", hp: 500, maxHp: 500, stacksHp: 0, stacksAs: 0, stacksMs: 0, mobKills: 0, drawStartedAt: 0, readyAt: 0 });
  players.set("me", me);
  for (const [id, o] of Object.entries(opts.foes ?? {})) players.set(id, Object.assign(base(o), { weapon0: "sword" }));
  const mobs = new Map<string, Record<string, unknown>>();
  const containers = new Map<string, Record<string, unknown>>();
  const sent: Sent = [];
  const b = new BotClient() as unknown as Brain;
  b.map = arena(opts.wall);
  b.room = {
    sessionId: "me",
    send: (type: string, msg: Record<string, unknown>) => sent.push({ type, msg }),
    state: { phase: "active", serverTime: 0, raidStartedAt: 0, inColiseum: false, gatesLocked: false, players, mobs, containers },
  };
  return {
    b, sent, me, players, mobs, containers,
    tick(ms = 50) { b.think(); vi.advanceTimersByTime(ms); },
    types() { return sent.map((m) => m.type); },
  };
}

describe("a bot with the target lock", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  it("clicks a foe in reach once and leaves the chase, the attacks and the aim to the server", () => {
    const s = scene({ foes: { foe: { x: 600 + 5 * TILE } } });
    s.tick();
    expect(s.sent).toEqual([{ type: "target", msg: { id: "foe" } }]);
    // The server took it: from now on the bot sends nothing, however long the fight lasts.
    s.me.attackTarget = "foe";
    for (let i = 0; i < 40; i++) s.tick();
    expect(s.sent).toHaveLength(1);
    expect(s.b.attacking, "the foe is in reach of a sword: 160 u is not, so it is still chasing").toBe(false);
    s.players.get("foe")!.x = 600 + 60;
    s.tick();
    expect(s.b.attacking).toBe(true);
  });

  it("never sends aim, attack or release, whoever it fights", () => {
    const s = scene({ me: { weapon0: "bow" }, foes: { foe: { x: 600 + 150 } } });
    for (let i = 0; i < 20; i++) { s.tick(); if (i === 2) s.me.attackTarget = "foe"; }
    expect(s.types().filter((t) => t === "aim" || t === "attack" || t === "release")).toEqual([]);
    const bot = s.b as unknown as { sent: Record<string, number> };
    expect(bot.sent.target).toBe(1);
    expect(bot.sent.aim + bot.sent.attack + bot.sent.release).toBe(0);
  });

  it("sends the order again only when the server has not taken it, no sooner than every 300 ms", () => {
    const s = scene({ foes: { foe: { x: 600 + 200 } } });
    s.tick(100); // t = 0
    s.tick(100); // t = 100
    s.tick(100); // t = 200
    expect(s.types()).toEqual(["target"]);
    s.tick(100); // t = 300: still not locked: the order is sent again
    expect(s.types()).toEqual(["target", "target"]);
    s.me.attackTarget = "foe";
    for (let i = 0; i < 20; i++) s.tick(100);
    expect(s.types()).toEqual(["target", "target"]);
  });

  it("walks to a foe that is out of the server's reach, and locks it when it can", () => {
    const far = scene({ foes: { foe: { x: 600 + TARGET_RANGE + 100 } } });
    far.tick();
    expect(far.sent).toEqual([{ type: "move", msg: { x: 600 + TARGET_RANGE + 100, y: 300 } }]);
    far.players.get("foe")!.x = 600 + TARGET_RANGE - 100;
    far.tick(300);
    expect(far.types()).toEqual(["move", "target"]);
  });

  it("clicks a foe behind a wall too: the server walks round to it, and the bot is not attacking until it sees it", () => {
    const walled = scene({ wall: 25, foes: { foe: { x: 26 * TILE + 16 } } });
    walled.me.x = 24 * TILE;
    walled.tick();
    expect(walled.types()).toEqual(["target"]);
    walled.me.attackTarget = "foe";
    walled.tick();
    expect(walled.b.attacking, "a wall between").toBe(false);
    // Both on the same side of the wall, in reach: it is attacked.
    walled.me.x = 27 * TILE + 16;
    walled.tick();
    expect(walled.b.attacking).toBe(true);
  });

  it("switches its lock when another foe is clearly nearer, and says so once", () => {
    const s = scene({ foes: { near: { x: 600 + 100 }, far: { x: 600 + 400 } } });
    s.me.attackTarget = "far";
    s.tick();
    expect(s.sent).toEqual([{ type: "target", msg: { id: "near" } }]);
  });

  it("walks up to a foe that will not be locked after three orders, then clicks again", () => {
    const s = scene({ foes: { foe: { x: 600 + 300 } } });
    for (let i = 0; i < 12; i++) s.tick(100); // t = 0 .. 1100
    // Orders at t = 0, 300, 600; then it walks (at t = 900) for a second instead of sending a fourth.
    expect(s.types().slice(0, 3)).toEqual(["target", "target", "target"]);
    expect(s.types()[3]).toBe("move");
    expect(s.types().filter((t) => t === "target")).toHaveLength(3);
    for (let i = 0; i < 10; i++) s.tick(100); // past the walk
    expect(s.types().filter((t) => t === "target").length).toBeGreaterThanOrEqual(4);
  });

  it("sends a stop when there is nobody to fight, and only once", () => {
    const s = scene();
    for (let i = 0; i < 10; i++) s.tick();
    expect(s.sent).toEqual([{ type: "stop", msg: {} }]);
  });

  it("a walk to the goal it walked to before the lock is sent again: the lock replaced it", () => {
    // A weapon lies 8 tiles away: the bot walks to it, a foe arrives and is locked, the foe goes, and the same walk must be re-sent.
    const s = scene();
    s.containers.set("c1", { id: "c1", kind: "ground", x: 600 + 200, y: 300, items: [{ def: "bow" }] });
    s.tick(300);
    expect(s.types()).toEqual(["move"]);
    s.players.set("foe", Object.assign({ x: 600 - 100, y: 300, status: "alive", weapon0: "sword", weapon1: "", slot: 0, attackTarget: "" }));
    s.tick(300);
    expect(s.types().at(-1)).toBe("target");
    s.me.attackTarget = "foe";
    s.players.get("foe")!.status = "dead";
    s.me.attackTarget = "";
    s.tick(300);
    expect(s.types().at(-1)).toBe("move");
    expect(s.types().filter((t) => t === "move")).toHaveLength(2);
  });

  it("is not a chase going nowhere while the lock holds the foe in reach of the weapon, and is when the lock never takes", () => {
    // A bow at 200 u from the foe it has locked: it stands and shoots, which the orbit breaker must leave alone however long it lasts.
    const fighting = scene({ me: { weapon0: "bow" }, foes: { foe: { x: 600 + 200 } } });
    fighting.me.attackTarget = "foe";
    for (let t = 0; t < ORBIT_MS + ORBIT_JITTER_MS + 2000; t += 50) fighting.tick();
    expect(fighting.b.attacking).toBe(true);
    expect(fighting.b.avoidId).toBeNull();
    // The same standoff with a server that never takes the order is a stand-off, and the bot turns on someone else.
    const refused = scene({ me: { weapon0: "bow" }, foes: { foe: { x: 600 + 200 } } });
    for (let t = 0; t < ORBIT_MS + ORBIT_JITTER_MS + 2000; t += 50) refused.tick();
    expect(refused.b.avoidId).toBe("foe");
  });
});
