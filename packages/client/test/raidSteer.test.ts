// WASD is sent from the key events, not from the next frame (RaidScene.handleKey / onKeyUp -> steerKeyboard), and orderMove puts
// its message on the wire before the prediction plans the path. The scene is driven through its private methods with phaser
// mocked, as raidControls.test.ts does; update()'s steering call is `steerKeyboard(now)`, so the frame path is that call.
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("phaser", () => ({ default: { Scene: class {} } }));
import { findPath, mapFromTiles, PLAYER_RADIUS, TILE, TILE_FLOOR, TILE_WALL, type GameMap } from "@raid/shared";
import { STEER_COALESCE_MS, STEER_REPEAT_MS } from "../src/net/keyboardMovement";
import { LocalPrediction } from "../src/net/localPrediction";
import { unproject } from "../src/render/projection";
import { RaidScene } from "../src/scenes/RaidScene";

interface SteerScene {
  room: { sessionId: string; send: ReturnType<typeof vi.fn>; state: { phase: string; gatesLocked: boolean; players: Map<string, { status: string; attackTarget: string }> } };
  mapView: { map: GameMap } | null;
  predict: LocalPrediction;
  time: { now: number };
  teleportAt: number;
  keyboardChanged: boolean;
  movementKeys: Set<string>;
  localClock: (now: number) => number;
  cancelLocalAutos: ReturnType<typeof vi.fn>;
  fx: { dropWindups: ReturnType<typeof vi.fn> };
  onKeyDown(e: unknown): void;
  onKeyUp(e: unknown): void;
  steerKeyboard(now: number, fromEvent?: boolean): void;
  holdMove(pointer: unknown): void;
  cameras: unknown;
  orderMove(kind: "move" | "attackMove" | "stop", point?: { x: number; y: number }): void;
}

const at = { x: 160, y: 160 };
const floor = (): GameMap => mapFromTiles(12, 12, new Uint8Array(144).fill(TILE_FLOOR));

function rig(map: GameMap = floor()) {
  const scene = new RaidScene() as unknown as SteerScene;
  scene.room = {
    sessionId: "me",
    send: vi.fn(),
    state: { phase: "active", gatesLocked: false, players: new Map([["me", { status: "alive", attackTarget: "" }]]) },
  };
  scene.mapView = { map };
  scene.time = { now: 0 };
  scene.localClock = (now) => now;
  scene.cancelLocalAutos = vi.fn();
  scene.fx = { dropWindups: vi.fn() };
  // The prediction is the real one, made ready the way a patch and a frame do, with `motion.order` watched.
  scene.predict.motion.observe({ x: at.x, y: at.y, t: 0, moveSeq: 0, displaceSeq: 0 }, 0);
  scene.predict.motion.frame(0, 16, { alive: true, speedMult: 1, rooted: false, aiming: false });
  const order = vi.spyOn(scene.predict.motion, "order");
  let t = 10_000;
  const clock = vi.spyOn(performance, "now").mockImplementation(() => t);
  const key = (kind: "down" | "up", code: string, extra: Record<string, unknown> = {}) => {
    const e = { code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: null, preventDefault: vi.fn(), ...extra };
    if (kind === "down") scene.onKeyDown(e); else scene.onKeyUp(e);
    return e;
  };
  /** What update() does for the keyboard each frame. */
  const frame = () => scene.steerKeyboard(performance.now());
  const sent = () => scene.room.send.mock.calls.map(([type, payload]) => ({ type, ...(payload as object) }) as { type: string; x?: number; y?: number; seq: number });
  return { scene, order, clock, key, frame, sent, advance: (ms: number) => { t += ms; }, at: () => t };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function withDocument() {
  vi.stubGlobal("document", { activeElement: null });
}

describe("a movement key sends its order from the key event", () => {
  it("a press sends the walk at once, with no frame in between, and the next frame sends nothing more", () => {
    withDocument();
    const r = rig();
    const e = r.key("down", "KeyD");
    expect(r.sent()).toEqual([{ type: "move", x: at.x + 64, y: at.y, seq: 1 }]);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(r.scene.keyboardChanged).toBe(false);
    r.advance(5);
    r.frame();
    expect(r.sent()).toHaveLength(1);
  });

  it("a release sends the stop at once", () => {
    withDocument();
    const r = rig();
    r.key("down", "KeyD");
    r.advance(10);
    r.key("up", "KeyD");
    expect(r.sent().map((m) => m.type)).toEqual(["move", "stop"]);
    expect(r.sent()[1]!.seq).toBe(2);
    expect(r.scene.keyboardChanged).toBe(false);
    r.advance(10);
    r.frame();
    expect(r.sent()).toHaveLength(2);
  });

  it("a tap shorter than the coalesce guard still sends the walk, and the next frame sends the stop", () => {
    withDocument();
    const r = rig();
    r.key("down", "KeyW");
    r.advance(STEER_COALESCE_MS - 1);
    r.key("up", "KeyW");
    expect(r.sent().map((m) => m.type)).toEqual(["move"]);
    expect(r.scene.keyboardChanged).toBe(true);
    r.advance(5);
    r.frame();
    expect(r.sent().map((m) => m.type)).toEqual(["move", "stop"]);
    expect(r.scene.keyboardChanged).toBe(false);
  });

  it("a second key inside the guard is sent by the next frame as the combined direction", () => {
    withDocument();
    const r = rig();
    r.key("down", "KeyW");
    r.advance(1);
    r.key("down", "KeyD");
    expect(r.sent()).toHaveLength(1);
    expect(r.sent()[0]).toMatchObject({ type: "move", x: at.x, y: at.y - 64 });
    r.advance(5);
    r.frame();
    expect(r.sent()).toHaveLength(2);
    const diagonal = r.sent()[1]!;
    expect(Math.hypot(diagonal.x! - at.x, diagonal.y! - at.y)).toBeCloseTo(64);
    expect(diagonal.x).toBeGreaterThan(at.x);
    expect(diagonal.y).toBeLessThan(at.y);
  });

  it("a second key past the guard is sent from its own event", () => {
    withDocument();
    const r = rig();
    r.key("down", "KeyW");
    r.advance(STEER_COALESCE_MS + 1);
    r.key("down", "KeyD");
    expect(r.sent()).toHaveLength(2);
  });

  it("the frame still repeats a held direction every STEER_REPEAT_MS", () => {
    withDocument();
    const r = rig();
    r.key("down", "KeyD");
    r.advance(STEER_REPEAT_MS - 1);
    r.frame();
    expect(r.sent()).toHaveLength(1);
    r.advance(1);
    r.frame();
    expect(r.sent().map((m) => m.type)).toEqual(["move", "move"]);
  });

  it.each([
    ["key repeat", { repeat: true }],
    ["ctrl", { ctrlKey: true }],
    ["meta", { metaKey: true }],
    ["alt", { altKey: true }],
    ["a text field", { target: { tagName: "INPUT", type: "text" } }],
  ])("%s sends nothing and holds no key", (_, extra) => {
    withDocument();
    const r = rig();
    r.key("down", "KeyD", extra);
    expect(r.sent()).toEqual([]);
    expect(r.scene.movementKeys.size).toBe(0);
    expect(r.scene.keyboardChanged).toBe(false);
  });

  it("the arrow keys are events too", () => {
    withDocument();
    const r = rig();
    r.key("down", "ArrowLeft");
    expect(r.sent()).toEqual([{ type: "move", x: at.x - 64, y: at.y, seq: 1 }]);
  });
});

describe("a key event the scene cannot act on yet stays pending for the frame", () => {
  it("before the teleport is drawn: nothing is sent, and the frame sends it once the teleport is past", () => {
    withDocument();
    const r = rig();
    r.scene.teleportAt = 1_000;
    r.key("down", "KeyD");
    expect(r.sent()).toEqual([]);
    expect(r.scene.keyboardChanged).toBe(true);
    r.advance(10);
    r.frame();
    expect(r.sent()).toEqual([]);
    r.scene.teleportAt = 0;
    r.advance(10);
    r.frame();
    expect(r.sent()).toEqual([{ type: "move", x: at.x + 64, y: at.y, seq: 1 }]);
    expect(r.scene.keyboardChanged).toBe(false);
  });

  it("after the fighter died with a key held: the release sends nothing", () => {
    withDocument();
    const r = rig();
    r.key("down", "KeyD");
    r.scene.room.state.players.get("me")!.status = "dead";
    r.advance(20);
    r.key("up", "KeyD");
    expect(r.sent().map((m) => m.type)).toEqual(["move"]);
    expect(r.scene.keyboardChanged).toBe(true);
  });

  it("while planning freezes the world: neither press nor release does anything", () => {
    withDocument();
    const r = rig();
    r.scene.room.state.phase = "planning";
    r.key("down", "KeyD");
    expect(r.sent()).toEqual([]);
    expect(r.scene.movementKeys.size).toBe(0);
  });

  it("before the map is built: nothing is sent, and the change is kept", () => {
    withDocument();
    const r = rig();
    r.scene.mapView = null;
    r.key("down", "KeyD");
    expect(r.sent()).toEqual([]);
    expect(r.scene.keyboardChanged).toBe(true);
  });
});

describe("the held right button yields to WASD steering", () => {
  it("sends no cursor move while a movement key steers, and resumes once the keys are up", () => {
    withDocument();
    const r = rig();
    r.scene.cameras = { main: {} };
    // The camera follows the walk, so the ground point under a still cursor moves every frame.
    const pointer = { worldX: 300, worldY: 120, updateWorldPoint: () => {} };
    const cursor = () => unproject(pointer.worldX, pointer.worldY);
    r.scene.holdMove(pointer);
    expect(r.sent()).toEqual([{ type: "move", ...cursor(), seq: 1 }]);
    r.key("down", "KeyD");
    // update()'s order: the hold, then the keyboard's frame.
    for (let i = 0; i < 144; i++) {
      r.advance(1000 / 144);
      pointer.worldX += 1.5;
      r.scene.holdMove(pointer);
      r.frame();
    }
    const steered = r.sent().slice(1);
    expect(steered.length).toBeGreaterThanOrEqual(9);
    expect(steered.every((m) => m.type === "move" && m.x === at.x + 64 && m.y === at.y)).toBe(true);
    r.key("up", "KeyD");
    expect(r.sent().at(-1)!.type).toBe("stop");
    r.advance(1000 / 144);
    r.scene.holdMove(pointer);
    expect(r.sent().at(-1)).toMatchObject({ type: "move", ...cursor() });
  });
});

describe("orderMove puts the message on the wire before the prediction plans", () => {
  const sameSeq = (r: ReturnType<typeof rig>, kind: "move" | "stop") => {
    const message = r.sent().find((m) => m.type === kind)!;
    const call = r.order.mock.calls[0]!;
    expect(call[0]).toBe(kind);
    expect(call[1]).toBe(message.seq);
    return message;
  };

  it("a move", () => {
    const r = rig();
    r.scene.orderMove("move", { x: 400, y: 160 });
    expect(r.scene.room.send.mock.invocationCallOrder[0]).toBeLessThan(r.order.mock.invocationCallOrder[0]!);
    expect(sameSeq(r, "move")).toMatchObject({ x: 400, y: 160 });
  });

  it("a stop", () => {
    const r = rig();
    r.scene.orderMove("stop");
    expect(r.scene.room.send.mock.invocationCallOrder[0]).toBeLessThan(r.order.mock.invocationCallOrder[0]!);
    sameSeq(r, "stop");
  });

  it("an attack-move is sent as itself and planned as a move", () => {
    const r = rig();
    r.scene.orderMove("attackMove", { x: 400, y: 160 });
    expect(r.scene.room.send).toHaveBeenCalledWith("attackMove", { x: 400, y: 160, seq: 1 });
    expect(r.order.mock.calls[0]!.slice(0, 2)).toEqual(["move", 1]);
  });

  it("a point outside the world is clamped for the message and the prediction alike", () => {
    const r = rig();
    r.scene.orderMove("move", { x: -500, y: 160 });
    const message = r.sent()[0]!;
    expect(message.x).toBe(0);
    expect(r.order.mock.calls[0]![3]).toEqual({ x: 0, y: 160 });
  });

  it("a point the prediction cannot reach is still sent, and still counted by the prediction", () => {
    const tiles = new Uint8Array(24 * 24).fill(TILE_FLOOR);
    const ring = [[10, 10], [11, 10], [12, 10], [10, 12], [11, 12], [12, 12], [10, 11], [12, 11]];
    for (const [x, y] of ring) tiles[y! * 24 + x!] = TILE_WALL;
    const map = mapFromTiles(24, 24, tiles);
    const inside = { x: 11 * TILE + TILE / 2, y: 11 * TILE + TILE / 2 };
    expect(findPath(map, at, inside, PLAYER_RADIUS)).toEqual([]);
    const r = rig(map);
    r.scene.orderMove("move", inside);
    expect(r.sent()).toEqual([{ type: "move", x: inside.x, y: inside.y, seq: 1 }]);
    expect(r.scene.predict.motion.orderPending(1)).toBe(true);
    expect(r.scene.predict.motion.walking).toBe(false);
  });

  it("the lock's windup is cancelled after the message goes, before the prediction plans", () => {
    const r = rig();
    r.scene.room.state.players.get("me")!.attackTarget = "foe";
    r.scene.orderMove("move", { x: 400, y: 160 });
    const sendAt = r.scene.room.send.mock.invocationCallOrder[0]!;
    expect(r.scene.cancelLocalAutos).toHaveBeenCalledTimes(1);
    expect(r.scene.fx.dropWindups).toHaveBeenCalledTimes(1);
    expect(sendAt).toBeLessThan(r.scene.cancelLocalAutos.mock.invocationCallOrder[0]!);
    expect(r.scene.cancelLocalAutos.mock.invocationCallOrder[0]!).toBeLessThan(r.order.mock.invocationCallOrder[0]!);
  });
});
