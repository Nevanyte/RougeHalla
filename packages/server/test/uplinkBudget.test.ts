// The client's continuous streams (client/src/net/uplinkPace.ts) against the room's two network-edge limits: the per-player order
// budget (every message but `aim`, RaidRoom.orderAllowed through a TokenBucket of ORDER_BURST / ORDER_PER_SECOND, dropped past
// it) and the message caps that close a client: the room's own budget of every message (MESSAGE_BURST deep, MESSAGE_RATE a second)
// and Colyseus's window behind it (MAX_MESSAGES_PER_SECOND in a one-second window). The gates run on a
// learner that knows the deadline, the case where they send the most.
import { describe, expect, it } from "vitest";
import { LIVENESS_SWEEP_MS, LIVENESS_TIMEOUT_MS, TICK_MS, type Vec2 } from "@raid/shared";
import { phaseSlot, type PhaseSource, type PhaseStatus } from "../../client/src/net/tickPhase";
import { AimGate, FramePace, HoldGate, MessageMeter, StallWatch } from "../../client/src/net/uplinkPace";
import { STEER_REPEAT_MS } from "../../client/src/net/keyboardMovement";
import { loadConfig } from "../src/config";
import { TokenBucket } from "../src/guards/tokenBucket";
import { MAX_MESSAGES_PER_SECOND, MESSAGE_BURST, MESSAGE_RATE } from "../src/rooms/RaidRoom";

function readyPhase(): PhaseSource {
  const st: PhaseStatus = { ready: true, n: 32, leadMs: 90, marginMs: 6, gridMs: 0, spreadMs: 30, gapMs: 4 };
  return { status: () => st, slot: (c, period) => phaseSlot(st, c, period) };
}

describe("the held right button stays inside the order budget", () => {
  const { orderBurst, orderPerSecond } = loadConfig({});

  it.each([
    [144, 170], [144, 255], [100, 170], [60, 170], [60, 255],
  ])("at %d fps walking %d u/s, with a discrete order every second, for 30 s", (fps, speed) => {
    const phase = readyPhase();
    const gate = new HoldGate();
    const frames = new FramePace();
    const bucket = new TokenBucket(orderBurst, orderPerSecond, 0);
    const frame = 1000 / fps;
    const ground: Vec2 = { x: 0, y: 100 };
    let holds = 0, refusedHolds = 0, discrete = 0, refusedDiscrete = 0, nextClick = 500;
    gate.sent(ground, 0);
    bucket.take(0);
    for (let now = frame; now < 30_000; now += frame) {
      frames.frame(now);
      // The camera follows the walk: the ground point under a still cursor moves with it.
      ground.x += (speed * frame) / 1000;
      // The client clock runs 1 s ahead of local time, as the server's does of a client's.
      const c = now + 1000;
      if (gate.next(ground, now, c, true, phase, frames.ms) !== "none") {
        gate.sent(ground, now);
        holds++;
        if (!bucket.take(now)) refusedHolds++;
      }
      if (now >= nextClick) {
        nextClick += 1000;
        discrete++;
        if (!bucket.take(now)) refusedDiscrete++;
      }
    }
    expect(holds / 30).toBeLessThanOrEqual(10.5);
    expect(refusedHolds).toBe(0);
    expect(discrete).toBe(30);
    expect(refusedDiscrete).toBe(0);
  });
});

/**
 * A minute of the busiest honest mix at 144 fps (the aim always turning, a movement order every STEER_REPEAT_MS, 5 clicks a
 * second), 45 ms up, with the uplink stalled for `stallMs` at 20 s: what was held arrives at once when it clears. Returns the most
 * messages Colyseus counts in one window (its rule: a window opens at the first message after the last one ran out, on the room
 * clock, which moves once a tick), whether the room's own message budget (RaidRoom MESSAGE_BURST, MESSAGE_RATE) runs dry, and the
 * steady rate. `pause`: the scene's stall watch (net/uplinkPace.ts StallWatch) is on, fed the socket's bufferedAmount as if a stalled
 * TCP showed it from the first send into the stall (above 0 until it clears), and the aim and the keyboard's repeat stand back while
 * it says stalled; the clicks, discrete orders, always go. That is the watch's best case: a real socket shows bytes only once the
 * operating system's send buffer is full (tens of kilobytes, many seconds of this mix), and a stall of the server or of a hop past
 * the browser never shows at all (docs/NETWORK_INVESTIGATION_2026-11-04.md), which is why the room's budget has to carry the burst.
 */
function stalled(stallMs: number, aligned: boolean, pause = false): { peakWindow: number; budgetEmpty: boolean; steadyPerSecond: number; sent: number } {
  const phase = readyPhase();
  const aim = new AimGate({ aligned });
  const meter = new MessageMeter();
  const watch = new StallWatch();
  const frame = 1000 / 144;
  const arrivals: number[] = [];
  const stallAt = 20_000;
  let last = 0, sent = 0, stuck = 0;
  const send = (now: number) => {
    sent++;
    if (now >= stallAt && now < stallAt + stallMs) stuck++;
    meter.note(now);
    const at = now >= stallAt && now < stallAt + stallMs ? stallAt + stallMs : now;
    last = Math.max(last, at + 45);
    arrivals.push(last);
  };
  let nextMove = 0, nextClick = 0, steady = 0;
  for (let now = 0; now < 60_000; now += frame) {
    aim.frames.frame(now);
    watch.sample(now, now >= stallAt && now < stallAt + stallMs && stuck > 0 ? 100 : 0);
    const hold = pause && watch.stalled(now);
    if (aim.due(now, now + 1000, true, meter.perSecond(now), phase, hold)) { aim.sent(now); send(now); }
    // The scene stamps the repeat at the send (lastKeyboardMoveAt): after a pause the next one is a repeat away, not a backlog of them.
    if (now >= nextMove && !hold) { nextMove = nextMove + STEER_REPEAT_MS > now ? nextMove + STEER_REPEAT_MS : now + STEER_REPEAT_MS; send(now); }
    if (now >= nextClick) { nextClick += 200; send(now); }
    if (now >= 10_000 && now < 10_000 + frame) steady = meter.perSecond(now);
  }
  let resetsAt = -Infinity, count = 0, peakWindow = 0;
  const budget = new TokenBucket(MESSAGE_BURST, MESSAGE_RATE, 0);
  let budgetEmpty = false;
  for (const arrival of arrivals) {
    const roomNow = Math.floor(arrival / TICK_MS) * TICK_MS;
    if (roomNow >= resetsAt) { count = 0; resetsAt = roomNow + 1000; }
    else count++;
    peakWindow = Math.max(peakWindow, count);
    if (!budget.take(arrival)) budgetEmpty = true;
  }
  return { peakWindow, budgetEmpty, steadyPerSecond: steady, sent };
}

/**
 * The shortest stall (ms, scanned in `step`s up to `max`) of the busiest mix whose burst closes the client: Colyseus's window over
 * `windowCap`, or the room's budget empty. Infinity if none up to `max`.
 */
function kickAt(aligned: boolean, pause: boolean, step = 250, max = 30_000, windowCap = MAX_MESSAGES_PER_SECOND): number {
  for (let stallMs = step; stallMs <= max; stallMs += step) {
    const r = stalled(stallMs, aligned, pause);
    if (r.peakWindow > windowCap || (windowCap === MAX_MESSAGES_PER_SECOND && r.budgetEmpty)) return stallMs;
  }
  return Infinity;
}

/** The cap the room used to leave to Colyseus's window alone. */
const OLD_WINDOW_CAP = 200;

describe("a stalled uplink's burst stays under the message cap", () => {
  it.each([[false], [true]])("aligned aim %s: a 2 s stall of the busiest mix", (aligned) => {
    const r = stalled(2000, aligned);
    expect(r.steadyPerSecond).toBeGreaterThanOrEqual(50);
    expect(r.steadyPerSecond).toBeLessThanOrEqual(60);
    expect(r.peakWindow, `steady ${r.steadyPerSecond}/s`).toBeLessThanOrEqual(MAX_MESSAGES_PER_SECOND);
    expect(r.budgetEmpty).toBe(false);
    // Without a stall the window holds a second of the steady rate.
    expect(stalled(0, aligned).peakWindow).toBeLessThanOrEqual(r.steadyPerSecond + 5);
  });
});

describe("what closes a client after a stall of its uplink", () => {
  it.each([[false], [true]])("aligned aim %s: Colyseus's window alone at the old 200 closed the busiest mix after a stall of 2 to 3 s", (aligned) => {
    // Honest traffic is 50-65 messages a second, so a stall of about 200 / 60 s plus the window's own steady rate tripped it
    // (2.1-2.6 s measured for the aligned aim in the deploy review, 3 s for the floor gate's lower rate). The drop harness
    // (bench/dropHarness.ts) saw the same against a real server: 3.3 s and 3.8 s uplink stalls sent the client to the menu.
    const old = kickAt(aligned, false, 250, 30_000, OLD_WINDOW_CAP);
    expect(old).toBeGreaterThanOrEqual(1750);
    expect(old).toBeLessThanOrEqual(3250);
  });

  it.each([[false], [true]])("aligned aim %s: the room's budget carries the backlog of any stall the liveness checks would let a socket ride out", (aligned) => {
    // Past LIVENESS_TIMEOUT_MS (and its sweep) of silence the server drops the client itself, into the reconnect grace; the
    // budget must never close it sooner, and with the margin of several such stalls.
    const kick = kickAt(aligned, false, 1000);
    expect(kick).toBeGreaterThanOrEqual(4 * (LIVENESS_TIMEOUT_MS + LIVENESS_SWEEP_MS));
    // With the stall watch's pause (its best case, see `stalled`) it is further out still.
    expect(kickAt(aligned, true, 1000)).toBeGreaterThanOrEqual(kick);
  });

  it.each([[false], [true]])("aligned aim %s: with no stall the pause never triggers, so the steady stream is the one it was", (aligned) => {
    expect(stalled(0, aligned, true)).toEqual(stalled(0, aligned, false));
  });
});
