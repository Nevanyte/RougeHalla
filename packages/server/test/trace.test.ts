// The movement trace (sim/trace.ts) and its file writer (rooms/traceWriter.ts): what a row holds, that recording changes nothing
// the sim does, that it costs nothing when it is off, and the three places main differs from the tree it was written for
// (an empty hand is "fists", a Plague zombie or a quest giver is not an enemy, and the walk multiplier must not count a bog second twice).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  mapFromTiles, mulberry32, PLAYER_SPEED, TERRAIN_BOG, TICK_MS, TILE_FLOOR, TILE_WALL, type FactionId, type GameMap, type Vec2,
} from "@raid/shared";
import { loadConfig } from "../src/config";
import { TraceWriter, traceWritesSettled } from "../src/rooms/traceWriter";
import { combatant } from "../src/sim/combatant";
import { displace } from "../src/sim/displace";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage, InputQueue } from "../src/sim/inputs";
import { addMob } from "../src/sim/mobs";
import { addPlayer, step } from "../src/sim/step";
import { installTrace, ordersOf, type TraceRow } from "../src/sim/trace";
import type { SimConfig, World } from "../src/sim/world";

const BASE: SimConfig = {
  minPlayers: 3, fillSeconds: 0, lobbySeconds: 0.5, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600,
  planSeconds: 0, firstPatienceSeconds: 0, pvpRules: false,
};

function openMap(): GameMap {
  return { ...mapFromTiles(50, 30, new Uint8Array(1500).fill(TILE_FLOOR)), spawns: [{ x: 200, y: 320 }, { x: 500, y: 320 }] };
}

/** Two players on an open floor; the lobby lasts 10 ticks (minPlayers 3 is never reached), then the run starts. */
function world(traced: boolean, map: GameMap = openMap(), factions: FactionId[] = ["fire", "frost"]): { w: World; rows: TraceRow[] } {
  let uid = 0;
  const w = createGameWorld({ random: mulberry32(8), newItemUid: () => `u${uid++}`, map, config: BASE }, { signatures: false });
  factions.forEach((faction, i) => addPlayer(w, `p${i}`, i === 0 ? "walker" : "stander", { faction }));
  const rows: TraceRow[] = [];
  if (traced) installTrace(w, (r) => rows.push(r), { run: "r1" });
  return { w, rows };
}

/** A Plague companion as the trace sees one: a mob of kind "zombie" with an owner (the zombie systems only drive one that has a runtime `zombie`). */
function zombie(w: World, name: string, ownerId: string, at: Vec2): string {
  const id = addMob(w, { kind: "dummy", name, faction: "plague", at });
  const m = w.state.mobs.get(id)!;
  m.kind = "zombie";
  m.ownerId = ownerId;
  return id;
}

const send = (w: World, id: string, type: string, msg: unknown) => expect(enqueueClientMessage(w.players.get(id)!.inputs, type, msg)).toBe(true);
const tick = (w: World) => step(w, TICK_MS);
function untilActive(w: World): void {
  for (let i = 0; i < 40 && w.state.phase !== "active"; i++) tick(w);
  expect(w.state.phase).toBe("active");
}
const rowOf = (rows: TraceRow[], w: World, id: string): TraceRow => rows.find((r) => r.id === id && r.tick === w.state.tick)!;

describe("movement trace", () => {
  it("records nothing in the lobby, then one row per standing player per active tick", () => {
    const { w, rows } = world(true);
    for (let i = 0; i < 5; i++) tick(w);
    expect(w.state.phase).toBe("lobby");
    expect(rows).toEqual([]);
    untilActive(w);
    // The tick that starts the run is the lobby's last: the first active tick is the next one.
    expect(rows).toEqual([]);
    tick(w);
    const startTick = w.state.tick;
    expect(rows.map((r) => r.id).sort()).toEqual(["p0", "p1"]);
    for (let i = 0; i < 4; i++) tick(w);
    expect(rows).toHaveLength(10);
    for (let t = startTick; t <= startTick + 4; t++) {
      expect(rows.filter((r) => r.tick === t).map((r) => r.id).sort()).toEqual(["p0", "p1"]);
    }
    const r = rows[rows.length - 1]!;
    expect(Object.keys(r).sort()).toEqual([
      "action", "bot", "displaceSeq", "effects", "enemy", "faction", "facing", "hp", "id", "lastHitAt", "lock", "orders", "path", "pathEnd",
      "pathLen", "rootFrom", "rootUntil", "rooted", "run", "serverTime", "slip", "speedMult", "tick", "vx", "vy", "walkMult", "walkedThisTick",
      "weapon", "x", "y",
    ].sort());
    const p0 = rows.find((x) => x.id === "p0" && x.tick === startTick + 4)!;
    const s0 = w.state.players.get("p0")!;
    // Both hands start empty, and an empty hand fights with fists (main), not with nothing.
    expect(s0.weapon0).toBe("");
    expect(p0).toMatchObject({
      run: "r1", serverTime: w.state.serverTime, faction: "fire", weapon: "fists", bot: false, slip: false, hp: 1, lock: null, action: null,
      rooted: false, effects: 0, speedMult: 1, walkMult: 1, walkedThisTick: false, orders: [],
    });
    expect(p0.x).toBeCloseTo(s0.x, 1);
    // The other player is the nearest enemy (no mobs here), standing still.
    const s1 = w.state.players.get("p1")!;
    expect(p0.enemy).toMatchObject({ id: "p1", kind: "player", vx: 0, vy: 0 });
    expect(p0.enemy!.dx).toBeCloseTo(s1.x - s0.x, 1);
    expect(p0.enemy!.dy).toBeCloseTo(s1.y - s0.y, 1);
  });

  it("names the weapon in hand, and marks a server-filled bot", () => {
    const { w, rows } = world(true);
    const stander = addPlayer(w, "p2", "botty", { faction: "holy", bot: true });
    stander.weapon0 = "bow";
    untilActive(w);
    tick(w);
    expect(rowOf(rows, w, "p2")).toMatchObject({ weapon: "bow", bot: true });
    expect(rowOf(rows, w, "p0")).toMatchObject({ weapon: "fists", bot: false });
  });

  it("records the orders a tick applied, in arrival order, only on that tick's row", () => {
    const { w, rows } = world(true);
    untilActive(w);
    const s0 = w.state.players.get("p0")!;
    const goal = { x: s0.x, y: s0.y + 200 };
    send(w, "p0", "aim", { a: 1 });
    send(w, "p0", "swap", { slot: 1 });
    send(w, "p0", "move", { x: goal.x, y: goal.y, seq: 3 });
    tick(w);
    const applied = rowOf(rows, w, "p0");
    expect(applied.orders).toEqual([{ k: "aim", a: 1 }, { k: "swap" }, { k: "move", x: goal.x, y: goal.y }]);
    expect(rowOf(rows, w, "p1").orders).toEqual([]);
    // It walked this tick, and the path in hand is the order's.
    expect(applied.walkedThisTick).toBe(true);
    expect(applied.pathEnd).toEqual(goal);
    expect(applied.pathLen).toBeCloseTo(200 - PLAYER_SPEED * TICK_MS / 1000, 1);
    expect(applied.path[applied.path.length - 1]).toEqual(goal);
    tick(w);
    const next = rowOf(rows, w, "p0");
    expect(next.orders).toEqual([]);
    expect(next.vy).toBeGreaterThan(0);
    send(w, "p0", "stop", {});
    tick(w);
    const stopped = rowOf(rows, w, "p0");
    expect(stopped.orders).toEqual([{ k: "stop" }]);
    expect(stopped.pathEnd).toBeNull();
    expect(stopped.pathLen).toBe(0);
    expect(stopped.walkedThisTick).toBe(false);
  });

  it("derives walkedThisTick from the position: true while walking, false at rest and after a forced move", () => {
    const { w, rows } = world(true);
    untilActive(w);
    const s0 = w.state.players.get("p0")!;
    send(w, "p0", "move", { x: s0.x + 300, y: s0.y });
    for (let i = 0; i < 3; i++) {
      tick(w);
      expect(rowOf(rows, w, "p0").walkedThisTick).toBe(true);
    }
    // A forced move resets the history: the jump is no walk, and a player standing after it has not walked.
    send(w, "p0", "stop", {});
    tick(w);
    const to = { x: s0.x, y: s0.y + 120 };
    displace(w, combatant(w, "p0")!, to);
    tick(w);
    const after = rowOf(rows, w, "p0");
    expect(after.x).toBeCloseTo(to.x, 1);
    expect(after.y).toBeCloseTo(to.y, 1);
    expect(after.walkedThisTick).toBe(false);
    expect(after.displaceSeq).toBe(1);
  });

  it("orders the drained queue the way applyInputs applies it, main's action kinds included", () => {
    const q = new InputQueue();
    q.pushAction({ kind: "target", id: "m1" });
    q.pushMove({ kind: "move", x: 10, y: 20, seq: 1 });
    q.pushAction({ kind: "cast", slot: "wish", x: 1, y: 2, id: "p9" });
    q.pushAction({ kind: "consumeCorpse", corpseId: "c1" });
    q.pushAim(0.5);
    q.pushAction({ kind: "huntTarget", id: "p3" });
    expect(ordersOf(q.drain())).toEqual([
      { k: "target", id: "m1" }, { k: "move", x: 10, y: 20 }, { k: "cast", slot: "wish", x: 1, y: 2, id: "p9" },
      { k: "consumeCorpse" }, { k: "aim", a: 0.5 }, { k: "huntTarget" },
    ]);
    q.pushMove({ kind: "attackMove", x: 3.456, y: 4 });
    q.pushAction({ kind: "attack", a: 1.23456 });
    expect(ordersOf(q.drain())).toEqual([{ k: "attackMove", x: 3.46, y: 4 }, { k: "attack", a: 1.235 }]);
    q.pushMove({ kind: "stop", seq: 9 });
    expect(ordersOf(q.drain())).toEqual([{ k: "stop" }]);
  });

  it("does not take a quest giver or the player's own Plague zombie for its nearest enemy", () => {
    const { w, rows } = world(true);
    untilActive(w);
    const s0 = w.state.players.get("p0")!;
    const giver = addMob(w, { kind: "quest", name: "giver", at: { x: s0.x + 20, y: s0.y } });
    const own = zombie(w, "own zombie", "p0", { x: s0.x + 30, y: s0.y });
    tick(w);
    // The other player is 300 u away and the only enemy.
    expect(rowOf(rows, w, "p0").enemy).toMatchObject({ id: "p1", kind: "player" });
    // Another player's zombie is an enemy, and the nearest one.
    const theirs = zombie(w, "their zombie", "p1", { x: s0.x + 50, y: s0.y });
    tick(w);
    expect(rowOf(rows, w, "p0").enemy).toMatchObject({ id: theirs, kind: "mob" });
    expect(giver).not.toBe(theirs);
  });

  it("leaves no other trace: the traced world plays out exactly like an untraced one", () => {
    const a = world(true);
    const b = world(false);
    const script = (w: World, t: number) => {
      if (t === 2) send(w, "p0", "move", { x: 500, y: 400 });
      if (t === 6) send(w, "p1", "move", { x: 200, y: 300 });
      if (t === 9) send(w, "p0", "aim", { a: -1 });
    };
    untilActive(a.w);
    untilActive(b.w);
    const evA: unknown[] = [];
    const evB: unknown[] = [];
    for (let t = 0; t < 40; t++) {
      script(a.w, t);
      script(b.w, t);
      evA.push(...tick(a.w));
      evB.push(...tick(b.w));
    }
    expect(a.rows.length).toBeGreaterThan(0);
    expect(b.rows).toEqual([]);
    expect(evA).toEqual(evB);
    expect(a.w.state.toJSON()).toEqual(b.w.state.toJSON());
    expect(a.w.hazards.stats).toEqual(b.w.hazards.stats);
    expect([...a.w.players.values()].map((r) => r.path)).toEqual([...b.w.players.values()].map((r) => r.path));
  });

  it("costs nothing when it is off: no hook is installed, and the config does not ask for one", () => {
    const { w } = world(false);
    expect(w.hooks.inputsApplied).toBeUndefined();
    expect(world(true).w.hooks.inputsApplied).toBeTypeOf("function");
    const off = loadConfig({});
    expect(off.traceFile).toBeUndefined();
    expect("traceFile" in off).toBe(false);
    expect(loadConfig({ TRACE_INPUTS: "" }).traceFile).toBeUndefined();
    expect(loadConfig({ TRACE_INPUTS: "trace.jsonl" }).traceFile).toBe(path.resolve("trace.jsonl"));
  });

  it("reads the walk multiplier without counting a bog second twice", () => {
    /** One Frost player walking 20 ticks across a bog floor, traced or not. */
    function bogRun(traced: boolean): { seconds: number; rows: TraceRow[] } {
      const w2 = 64, h = 30;
      const tiles = new Uint8Array(w2 * h).fill(TILE_FLOOR);
      const terrain = new Uint8Array(w2 * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w2; x++) {
          if (x === 0 || y === 0 || x === w2 - 1 || y === h - 1) tiles[y * w2 + x] = TILE_WALL;
          else terrain[y * w2 + x] = TERRAIN_BOG;
        }
      }
      const map = mapFromTiles(w2, h, tiles, 0, terrain);
      map.spawns = [{ x: 80, y: 200 }];
      const w = createGameWorld({ map, random: mulberry32(3), config: { ...BASE, minPlayers: 1 } }, { signatures: true });
      addPlayer(w, "p0", "waders", { faction: "frost" });
      const rows: TraceRow[] = [];
      if (traced) installTrace(w, (r) => rows.push(r));
      tick(w);
      expect(w.state.phase).toBe("active");
      const p = w.state.players.get("p0")!;
      send(w, "p0", "move", { x: p.x + 1500, y: p.y });
      for (let i = 0; i < 20; i++) tick(w);
      return { seconds: w.hazards.stats.seconds.bog, rows };
    }
    const off = bogRun(false);
    const on = bogRun(true);
    // 20 ticks of one fighter on bog: 1 fighter-second, however many times the trace asked what it walks at.
    expect(off.seconds).toBeCloseTo(1, 9);
    expect(on.seconds).toBe(off.seconds);
    expect(on.rows).toHaveLength(20);
    // Frost on bog walks at 119 of 170 u/s.
    expect(on.rows[19]!.walkMult).toBeCloseTo(0.7, 3);
  });

  it("TRACE_INPUTS turns recording on, and the writer appends the rows as JSONL", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-trace-"));
    try {
      const file = path.join(dir, "nested", "trace.jsonl");
      const { w, rows } = world(true);
      untilActive(w);
      for (let i = 0; i < 3; i++) tick(w);
      const writer = new TraceWriter(file);
      for (const r of rows.slice(0, 2)) writer.push(r);
      void writer.flush();
      for (const r of rows.slice(2)) writer.push(r);
      void writer.flush();
      await traceWritesSettled();
      const back = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l) as TraceRow);
      expect(back).toEqual(rows);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stops recording, once and loudly, at its byte cap instead of filling the disk", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-trace-cap-"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const file = path.join(dir, "trace.jsonl");
      const { w, rows } = world(true);
      untilActive(w);
      for (let i = 0; i < 6; i++) tick(w);
      const one = Buffer.byteLength(`${JSON.stringify(rows[0])}\n`);
      // Room for about two rows' worth: the first batch fits, the second does not and ends the trace.
      const writer = new TraceWriter(file, one * 2 + one / 2);
      writer.push(rows[0]!);
      writer.push(rows[1]!);
      void writer.flush();
      writer.push(rows[2]!);
      writer.push(rows[3]!);
      void writer.flush();
      writer.push(rows[4]!);
      void writer.flush();
      await traceWritesSettled();
      expect(fs.readFileSync(file, "utf8").trim().split("\n")).toHaveLength(2);
      expect(err).toHaveBeenCalledTimes(1);
    } finally {
      err.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
