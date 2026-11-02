// The streamed aim against the REAL sim: aims and orders go through the input parser and the fixed step, with latency each way,
// and the client's own gate and deadline learner (client/src/net/uplinkPace.ts, tickPhase.ts, fed by LocalMotion's acks under the
// adaptive RenderClock) decide when they leave. Each aim carries its own angle, so the facing a step leaves says which aim it
// applied: its age at the step is the lag measured. Two servers: one that wakes on its 50 ms grid (what the tick pacer gives),
// and one like the setTimestep accumulator today (a wake every 50-53 ms, a double step when it falls behind), on which the
// learner must stay off and the gate be no worse than the half-tick floor.
import { describe, expect, it } from "vitest";
import { mapFromTiles, mulberry32, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, RenderClock, type GameMap } from "@raid/shared";
import { LocalPrediction } from "../../client/src/net/localPrediction";
import { AimGate, MessageMeter } from "../../client/src/net/uplinkPace";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { addPlayer, step } from "../src/sim/step";

function room(): GameMap {
  const W = 40, H = 30;
  const tiles = new Uint8Array(W * H).fill(TILE_FLOOR);
  for (let x = 0; x < W; x++) { tiles[x] = TILE_WALL; tiles[(H - 1) * W + x] = TILE_WALL; }
  for (let y = 0; y < H; y++) { tiles[y * W] = TILE_WALL; tiles[y * W + W - 1] = TILE_WALL; }
  return { ...mapFromTiles(W, H, tiles), spawns: [{ x: 10 * TILE + 16, y: 10 * TILE + 16 }] };
}

/** The k-th aim's angle: distinct, exact in a double, inside parseAngle's range, and a turn past AIM_MIN_DELTA every time. */
const angleOf = (k: number): number => -3 + (k % 545) * 0.011;
const indexOf = (a: number): number => Math.round((a + 3) / 0.011);

interface Result { mean: number; p99: number; stalePct: number; aimPerSec: number; peakPerSec: number; readyPct: number }

/**
 * `ms` of play: a client at `fps` (144) holding a movement key (a `stop` with an order number every 100 ms plus the learner's
 * sweep: acks for the learner, and nothing that turns the fighter) and moving the mouse all the time (an aim whenever `gate` lets
 * one go, judged 2-6 ms into the frame as the scene's streamAim is).
 */
function play(gate: AimGate, o: { up: number; down: number; jitter: number; paced: boolean; aligned: boolean; ms: number; seed: number; fps?: number }): Result {
  const rnd = mulberry32(o.seed);
  const map = room();
  const world = createGameWorld({
    seed: 3,
    config: { minPlayers: 1, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600 },
    random: mulberry32(4),
  }, { signatures: false });
  world.map = map;
  const p = addPlayer(world, "me", "me");
  p.faction = "plague";
  p.weapon0 = "sword";
  p.hp = p.maxHp = 1e9;
  step(world, TICK_MS);
  const rt = world.players.get("me")!;
  const predict = new LocalPrediction();
  const motion = predict.motion;
  const rc = new RenderClock();
  const meter = new MessageMeter();
  const jit = () => (rnd() * 2 - 1) * o.jitter;
  // One TCP stream each way: arrivals keep their order.
  const up: Array<{ at: number; type: string; msg: unknown }> = [];
  const down: Array<{ at: number; t: number; dt: number; x: number; y: number; moveSeq: number }> = [];
  let upLast = 0, downLast = 0;
  const sendUp = (now: number, type: string, msg: unknown) => {
    upLast = Math.max(upLast + 0.01, now + o.up + jit());
    up.push({ at: upLast, type, msg });
    meter.note(now);
  };
  const sentAt = new Map<number, number>();
  let aims = 0;
  let peak = 0;
  // The server's wakes: the grid, or an interval timer that runs a little slow and catches up with a double step.
  let nextWake = 1000;
  let acc = 0;
  let prevT = world.state.serverTime;
  // The client's frames.
  const frameMs = 1000 / (o.fps ?? 144);
  let nextFrame = 1000 + rnd() * frameMs;
  let lastSteer = -Infinity;
  let synced = false;
  const ages: number[] = [];
  let stale = 0;
  let lastApplied = -1;
  let readyFrames = 0;
  let frames = 0;
  const start = 1000, warm = 6000, end = start + o.ms;
  while (true) {
    const tDown = down.length ? down[0]!.at : Infinity;
    const now = Math.min(nextWake, nextFrame, tDown);
    if (now > end) break;
    if (now === nextWake) {
      // Inputs that reached the server by now are applied by this wake's first step.
      while (up.length && up[0]!.at <= now) { const m = up.shift()!; enqueueClientMessage(rt.inputs, m.type, m.msg); }
      let steps = 1;
      if (o.paced) nextWake += TICK_MS;
      else {
        const interval = TICK_MS + rnd() * 3;
        acc += interval;
        steps = Math.min(3, Math.floor(acc / TICK_MS));
        acc -= steps * TICK_MS;
        nextWake += interval;
      }
      for (let s = 0; s < steps; s++) step(world, TICK_MS);
      if (steps === 0) continue;
      const k = indexOf(p.facing);
      if (now >= start + warm && lastApplied >= 0) {
        const at = sentAt.get(k);
        if (at !== undefined) ages.push(now - at);
        if (k === lastApplied) stale++;
      }
      if (sentAt.has(k)) lastApplied = k;
      const t = world.state.serverTime;
      downLast = Math.max(downLast + 0.01, now + o.down + jit());
      down.push({ at: downLast, t, dt: t - prevT, x: p.x, y: p.y, moveSeq: p.moveSeq });
      prevT = t;
    } else if (now === tDown) {
      const s = down.shift()!;
      rc.onPatch(s.t, now);
      synced = true;
      motion.observe({ x: s.x, y: s.y, t: s.t, moveSeq: s.moveSeq, displaceSeq: 0 }, rc.clock.now(now));
    } else {
      nextFrame += frameMs + (rnd() - 0.5) * 0.4;
      if (!synced) continue;
      rc.renderTime(now);
      const measuring = now >= start + warm;
      if (measuring) frames++;
      const c0 = rc.clock.now(now);
      motion.frame(c0, frameMs, { alive: true, speedMult: 1, rooted: false, aiming: true });
      if (now - lastSteer >= 100 + (o.aligned ? motion.phase.sweepMs() : 0)) {
        lastSteer = now;
        const seq = predict.nextSeq();
        motion.order("stop", seq, c0, undefined, map);
        sendUp(now, "stop", { seq });
      }
      // The aim is judged a few ms into the frame, as the scene's streamAim runs after the frame's other work.
      const at = now + 2 + rnd() * 4;
      gate.frames.frame(at);
      motion.phase.noteClock(rc.clock.offsetMs);
      const c = rc.clock.now(at);
      if (motion.phase.status(c).ready && measuring) readyFrames++;
      if (gate.due(at, c, true, meter.perSecond(at), o.aligned ? motion.phase : null)) {
        const k = aims++;
        sentAt.set(k % 545, at);
        sendUp(at, "aim", { a: angleOf(k) });
        gate.sent(at);
      }
      peak = Math.max(peak, meter.perSecond(now));
    }
  }
  ages.sort((a, b) => a - b);
  const mean = ages.reduce((a, b) => a + b, 0) / ages.length;
  return {
    mean, p99: ages[Math.floor(0.99 * (ages.length - 1))]!, stalePct: (100 * stale) / ages.length,
    aimPerSec: aims / (o.ms / 1000), peakPerSec: peak, readyPct: (100 * readyFrames) / frames,
  };
}

const RUN_MS = 36_000;

describe("aim lag against the real sim", () => {
  it("on a server that wakes on its grid: the half-tick floor beats the old gate, and the aligned slots beat the floor", () => {
    for (const jitter of [0, 2]) {
      const base = { up: 45, down: 45, jitter, paced: true, ms: RUN_MS, seed: 7 };
      const legacy = play(new AimGate({ floorMs: TICK_MS, aligned: false }), { ...base, aligned: false });
      const floor = play(new AimGate({ aligned: false }), { ...base, aligned: false });
      const aligned = play(new AimGate(), { ...base, aligned: true });
      const tag = `jitter ${jitter}: legacy ${legacy.mean.toFixed(1)} floor ${floor.mean.toFixed(1)} aligned ${aligned.mean.toFixed(1)} (ready ${aligned.readyPct.toFixed(0)}%)`;
      expect(floor.mean, tag).toBeLessThan(legacy.mean - 8);
      expect(aligned.mean, tag).toBeLessThanOrEqual(floor.mean - 3);
      expect(aligned.readyPct, tag).toBeGreaterThan(80);
      // The backup: no tick is left with an aim a tick old, and the slowest ticks are faster than the floor's.
      expect(aligned.stalePct, tag).toBeLessThan(0.5);
      expect(aligned.p99, tag).toBeLessThan(floor.p99);
      for (const r of [floor, aligned]) {
        expect(r.aimPerSec, tag).toBeLessThanOrEqual(41);
        expect(r.peakPerSec, tag).toBeLessThan(70);
      }
    }
  });

  it("at 60 fps the aligned slots are no better, so the gate keeps the floor", () => {
    // The same play on both (the learner fed and sweeping alike); only the gate differs. At 60 fps the frames lock to the ticks
    // (three frames a tick), so the age depends on that phase more than on any gate: the two are compared on one phase.
    const base = { up: 45, down: 45, jitter: 2, paced: true, ms: RUN_MS, seed: 7, fps: 60, aligned: true };
    const floor = play(new AimGate({ aligned: false }), base);
    const aligned = play(new AimGate(), base);
    expect(aligned.readyPct).toBeGreaterThan(80);
    expect(Math.abs(aligned.mean - floor.mean)).toBeLessThan(0.5);
  });

  it("on today's accumulator tick the learner stays off and the gate is the floor: never worse than the old gate", () => {
    // The same play on all three (the learner fed and sweeping alike); only the gate differs.
    const base = { up: 45, down: 45, jitter: 2, paced: false, ms: RUN_MS, seed: 11, aligned: true };
    const legacy = play(new AimGate({ floorMs: TICK_MS, aligned: false }), base);
    const floor = play(new AimGate({ aligned: false }), base);
    const aligned = play(new AimGate(), base);
    const tag = `legacy ${legacy.mean.toFixed(1)} floor ${floor.mean.toFixed(1)} aligned ${aligned.mean.toFixed(1)} (ready ${aligned.readyPct.toFixed(0)}%)`;
    // Its catch-up steps keep the learner quiet (PHASE_QUIET_MS), so the aligned gate is the floor (the runs part only in the
    // first seconds, before the first catch-up step, and then in the random draws that follow).
    expect(aligned.readyPct, tag).toBe(0);
    expect(Math.abs(aligned.mean - floor.mean), tag).toBeLessThan(1.5);
    expect(aligned.mean, tag).toBeLessThan(legacy.mean - 8);
  });
});
