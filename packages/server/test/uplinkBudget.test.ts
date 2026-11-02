// The client's continuous streams (client/src/net/uplinkPace.ts) against the room's two network-edge limits: the per-player order
// budget (every message but `aim`, RaidRoom.orderAllowed through a TokenBucket of ORDER_BURST / ORDER_PER_SECOND, dropped past
// it) and Colyseus's message cap (MAX_MESSAGES_PER_SECOND in a one-second window, a forced close past it). The gates run on a
// learner that knows the deadline, the case where they send the most.
import { describe, expect, it } from "vitest";
import { TICK_MS, type Vec2 } from "@raid/shared";
import { phaseSlot, type PhaseSource, type PhaseStatus } from "../../client/src/net/tickPhase";
import { AimGate, FramePace, HoldGate, MessageMeter } from "../../client/src/net/uplinkPace";
import { STEER_REPEAT_MS } from "../../client/src/net/keyboardMovement";
import { loadConfig } from "../src/config";
import { TokenBucket } from "../src/guards/tokenBucket";
import { MAX_MESSAGES_PER_SECOND } from "../src/rooms/RaidRoom";

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
 * clock, which moves once a tick) and the steady rate.
 */
function stalled(stallMs: number, aligned: boolean): { peakWindow: number; steadyPerSecond: number } {
  const phase = readyPhase();
  const aim = new AimGate({ aligned });
  const meter = new MessageMeter();
  const frame = 1000 / 144;
  const arrivals: number[] = [];
  const stallAt = 20_000;
  let last = 0;
  const send = (now: number) => {
    meter.note(now);
    const at = now >= stallAt && now < stallAt + stallMs ? stallAt + stallMs : now;
    last = Math.max(last, at + 45);
    arrivals.push(last);
  };
  let nextMove = 0, nextClick = 0, steady = 0;
  for (let now = 0; now < 60_000; now += frame) {
    aim.frames.frame(now);
    if (aim.due(now, now + 1000, true, meter.perSecond(now), phase)) { aim.sent(now); send(now); }
    if (now >= nextMove) { nextMove += STEER_REPEAT_MS; send(now); }
    if (now >= nextClick) { nextClick += 200; send(now); }
    if (now >= 10_000 && now < 10_000 + frame) steady = meter.perSecond(now);
  }
  let resetsAt = -Infinity, count = 0, peakWindow = 0;
  for (const arrival of arrivals) {
    const roomNow = Math.floor(arrival / TICK_MS) * TICK_MS;
    if (roomNow >= resetsAt) { count = 0; resetsAt = roomNow + 1000; }
    else count++;
    peakWindow = Math.max(peakWindow, count);
  }
  return { peakWindow, steadyPerSecond: steady };
}

describe("a stalled uplink's burst stays under the message cap", () => {
  it.each([[false], [true]])("aligned aim %s: a 2 s stall of the busiest mix", (aligned) => {
    const r = stalled(2000, aligned);
    expect(r.steadyPerSecond).toBeGreaterThanOrEqual(50);
    expect(r.steadyPerSecond).toBeLessThanOrEqual(60);
    expect(r.peakWindow, `steady ${r.steadyPerSecond}/s`).toBeLessThanOrEqual(MAX_MESSAGES_PER_SECOND);
    // Without a stall the window holds a second of the steady rate.
    expect(stalled(0, aligned).peakWindow).toBeLessThanOrEqual(r.steadyPerSecond + 5);
  });
});
