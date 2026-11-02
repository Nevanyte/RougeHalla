import { describe, expect, it } from "vitest";
import { mulberry32, TICK_MS } from "@raid/shared";
import {
  PHASE_GAP_MAX_MS, PHASE_MIN_SAMPLES, PHASE_QUIET_MS, PHASE_SLEW_MS, PHASE_SWEEP_MS, PHASE_WINDOW_MS, TickPhase, phaseSlot,
  type PhaseStatus,
} from "../src/net/tickPhase";

/**
 * A server that wakes on its grid: the step stamped T runs at client clock T - down (the clock is the newest stamp at its
 * arrival), a send at client clock c arrives at c + up (+- jitter), and the first step to run after that applies it.
 */
function gridServer(o: { up?: number; down?: number; jitter?: number; grid?: number; seed?: number } = {}) {
  const up = o.up ?? 45, down = o.down ?? 45, jitter = o.jitter ?? 0, grid = o.grid ?? 0;
  const rnd = mulberry32(o.seed ?? 1);
  const arrival = (c: number) => c + up + (rnd() * 2 - 1) * jitter;
  return {
    up, down, grid, arrival,
    /** The stamp of the step that applies a send arriving at client clock `a`. */
    stampFor: (a: number) => grid + TICK_MS * Math.ceil((a + down - grid) / TICK_MS),
    /** The ack of a send at `c`: what LocalMotion hands the phase (the patch arrives at client clock t). */
    ack(c: number) {
      const t = grid + TICK_MS * Math.ceil((arrival(c) + down - grid) / TICK_MS);
      return { d: t - TICK_MS - c, c, t, at: t };
    },
  };
}

/** Feeds `n` acks of sends at random phases, the k-th sent at about `start + k * every`. */
function feed(phase: TickPhase, server: ReturnType<typeof gridServer>, n: number, start = 10_000, every = 113, seed = 2): number {
  const rnd = mulberry32(seed);
  let c = start;
  for (let k = 0; k < n; k++) {
    c += every * (0.5 + rnd());
    const s = server.ack(c);
    phase.push(s.d, s.c, s.t, s.at, TICK_MS);
  }
  return c;
}

describe("TickPhase", () => {
  it("refuses a patch after a gap or a double step, non-finite numbers and delays at LocalMotion's clamps", () => {
    const phase = new TickPhase();
    for (let i = 0; i < 20; i++) {
      phase.push(90 + i, 1000 + i * 7, 2000, 2100, 2 * TICK_MS);
      phase.push(Number.NaN, 1000 + i * 7, 2000, 2100, TICK_MS);
      phase.push(90, Number.POSITIVE_INFINITY, 2000, 2100, TICK_MS);
      phase.push(-TICK_MS, 1000 + i * 7, 2000, 2100, TICK_MS);
      phase.push(400, 1000 + i * 7, 2000, 2100, TICK_MS);
    }
    expect(phase.status(2100).n).toBe(0);
    phase.push(90, 1000, 2000, 2100, TICK_MS);
    expect(phase.status(2100).n).toBe(1);
  });

  it("finds the deadline of a server on its grid: the lead is the round trip, and a send at the deadline makes its wake", () => {
    // The lead is a quantile of 64 samples, so one seed can under-read it by a few ms: the rate is judged over twenty.
    let made = 0;
    let total = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const server = gridServer({ up: 45, down: 45, jitter: 3, seed });
      const phase = new TickPhase();
      const end = feed(phase, server, 64, 10_000, 113, seed + 50);
      const st = phase.status(end);
      expect(st.ready).toBe(true);
      // The 95th percentile of d, which spans the round trip less a tick to the round trip: just under it.
      expect(st.leadMs).toBeGreaterThan(90 - 8);
      expect(st.leadMs).toBeLessThanOrEqual(90 + 3);
      expect(st.marginMs).toBeGreaterThanOrEqual(4);
      expect(st.marginMs).toBeLessThanOrEqual(16);
      const rnd = mulberry32(seed + 90);
      for (let i = 0; i < 200; i++) {
        const slot = phase.slot(end + rnd() * 5000, TICK_MS);
        // The step that slot is for is stamped id * TICK_MS + grid; it runs at that stamp - down on the client clock. The send
        // leaves in the last frame before the deadline (144 Hz); the aim's backup half a tick before it.
        const runs = slot.id * TICK_MS + st.gridMs - server.down;
        const primary = server.arrival(slot.deadline - rnd() * 6.9) <= runs;
        total++;
        if (primary) made++;
        // Whatever the primary did, the backup makes the wake: no tick is left with an aim a tick old.
        else expect(server.arrival(slot.deadline - TICK_MS / 2 - rnd() * 6.9)).toBeLessThanOrEqual(runs);
      }
    }
    expect(made / total).toBeGreaterThanOrEqual(0.95);
  });

  it("is not ready on a tick that drifts or runs two steps at once", () => {
    const rnd = mulberry32(3);
    const drifting = new TickPhase();
    for (let k = 0; k < 64; k++) {
      // The wakes wander +-25 ms against the stamps (a timer that runs a little slow and catches up).
      const drift = 25 * Math.sin(k / 5);
      const c = 10_000 + k * 113 + rnd() * 50;
      const d = 40 + rnd() * TICK_MS + drift;
      drifting.push(d, c, 50 * Math.ceil((c + d) / 50) + TICK_MS, c + 200, TICK_MS);
    }
    expect(drifting.status(20_000).spreadMs).toBeGreaterThan(80);
    expect(drifting.status(20_000).ready).toBe(false);
    expect(drifting.sweepMs()).toBe(0); // the phases are covered: sweeping would not help

    // A double step publishes the later stamp: the order looks a tick later than it was, for half of them here.
    const bimodal = new TickPhase();
    const server = gridServer();
    for (let k = 0; k < 64; k++) {
      const s = server.ack(10_000 + k * 113 + rnd() * 50);
      const late = k % 2 === 0 ? TICK_MS : 0;
      bimodal.push(s.d + late, s.c, s.t + late, s.at + late, TICK_MS);
    }
    expect(bimodal.status(20_000).ready).toBe(false);
  });

  it("is not ready while every sample was sent at one phase, asks a repeat to sweep, and is ready once the phases spread", () => {
    const server = gridServer();
    const phase = new TickPhase();
    // A 100 ms repeat at 60 Hz: six frames, two ticks, the same phase every time.
    let c = 10_007;
    for (let k = 0; k < 32; k++) {
      c += 100;
      const s = server.ack(c);
      phase.push(s.d, s.c, s.t, s.at, TICK_MS);
    }
    const st = phase.status(c + 100);
    expect(st.n).toBeGreaterThanOrEqual(PHASE_MIN_SAMPLES);
    expect(st.gapMs).toBeGreaterThan(PHASE_GAP_MAX_MS);
    expect(st.ready).toBe(false);
    expect(phase.sweepMs()).toBe(PHASE_SWEEP_MS);
    for (let k = 0; k < 32; k++) {
      c += 100 + phase.sweepMs();
      const s = server.ack(c);
      phase.push(s.d, s.c, s.t, s.at, TICK_MS);
    }
    expect(phase.status(c + 100).ready).toBe(true);
    expect(phase.sweepMs()).toBe(0);
    expect(new TickPhase().sweepMs()).toBe(0);
  });

  it("drops its samples on a clock step, with age, and on reset", () => {
    const server = gridServer();
    const phase = new TickPhase();
    let end = feed(phase, server, 40);
    expect(phase.status(end).ready).toBe(true);
    phase.noteClock(-30);
    phase.noteClock(-32); // the clock's slew: kept
    expect(phase.status(end).n).toBe(40);
    phase.noteClock(-37);
    expect(phase.status(end).n).toBe(0);
    expect(phase.status(end).ready).toBe(false);

    end = feed(phase, server, 40, end);
    expect(phase.status(end).ready).toBe(true);
    expect(phase.status(end + PHASE_WINDOW_MS + 500).n).toBe(0);
    expect(phase.status(end + PHASE_WINDOW_MS + 500).ready).toBe(false);

    end = feed(phase, server, 40, end + 20_000);
    expect(phase.status(end).ready).toBe(true);
    phase.reset();
    expect(phase.status(end).n).toBe(0);
    phase.noteClock(500); // the first offset after a reset is no step
    feed(phase, server, 10, end);
    expect(phase.status(end + 2000).n).toBe(10);
  });

  it("drops everything on a catch-up step and stays not ready for PHASE_QUIET_MS, whatever the samples after it say", () => {
    const server = gridServer();
    const phase = new TickPhase();
    let end = feed(phase, server, 40);
    expect(phase.status(end).ready).toBe(true);
    phase.notePatch(TICK_MS, end); // an ordinary patch
    expect(phase.status(end).ready).toBe(true);
    phase.notePatch(2 * TICK_MS, end);
    expect(phase.status(end).n).toBe(0);
    const caughtUpAt = end;
    end = feed(phase, server, 40, end, 113);
    expect(end - caughtUpAt).toBeLessThan(PHASE_QUIET_MS);
    expect(phase.status(end).n).toBe(40);
    expect(phase.status(end).ready).toBe(false);
    expect(phase.status(caughtUpAt + PHASE_QUIET_MS).ready).toBe(true);
    phase.reset();
    feed(phase, server, 20, caughtUpAt + PHASE_QUIET_MS);
    expect(phase.status(caughtUpAt + PHASE_QUIET_MS + 3000).ready).toBe(true);
  });

  it("reads where the wakes sit on the grid from the stamps, not assuming a multiple of the tick", () => {
    const server = gridServer({ grid: 7, jitter: 1 });
    const phase = new TickPhase();
    const end = feed(phase, server, 48);
    const st = phase.status(end);
    expect(st.gridMs).toBe(7);
    expect(st.ready).toBe(true);
    const rnd = mulberry32(4);
    let made = 0;
    for (let i = 0; i < 500; i++) {
      const slot = phase.slot(end + rnd() * 3000, TICK_MS);
      if (server.arrival(slot.deadline) <= slot.id * TICK_MS + 7 - server.down) made++;
    }
    expect(made).toBeGreaterThanOrEqual(475);
  });

  it("gives integer slots that a frame loop sends exactly once each while the lead moves", () => {
    for (const frame of [6.9, 16.7]) {
      const server = gridServer({ jitter: 2, seed: 5 });
      const phase = new TickPhase();
      let c = feed(phase, server, 40);
      const sent = new Map<number, number>();
      let last = Number.NaN;
      const rnd = mulberry32(6);
      for (let f = 0; f < 3000; f++) {
        c += frame;
        if (f % 7 === 0) {
          // Acks keep coming (the uplink drifts a little), moving the lead and the margin under the loop.
          const s = server.ack(c - 200 - rnd() * 50);
          phase.push(s.d + (f > 1500 ? 4 : 0), s.c, s.t, c, TICK_MS);
        }
        const st = phase.status(c);
        expect(st.ready).toBe(true);
        const slot = phase.slot(c, TICK_MS / 2);
        if (slot.id !== last && c + frame >= slot.deadline) {
          sent.set(slot.id, (sent.get(slot.id) ?? 0) + 1);
          last = slot.id;
        }
      }
      const ids = [...sent.keys()].sort((a, b) => a - b);
      expect([...sent.values()].every((v) => v === 1)).toBe(true);
      const skipped = ids[ids.length - 1]! - ids[0]! + 1 - ids.length;
      expect(skipped).toBeLessThanOrEqual(Math.ceil(ids.length * 0.01));
    }
  });

  it("moves the lead by at most a millisecond a sample once ready", () => {
    const server = gridServer();
    const phase = new TickPhase();
    let c = feed(phase, server, 40);
    const before = phase.status(c).leadMs;
    // The uplink grows by 20 ms: the lead follows one millisecond per sample.
    const slow = gridServer({ up: 65 });
    const leads: number[] = [];
    const rnd = mulberry32(8);
    for (let k = 0; k < 30; k++) {
      c += 113 * (0.5 + rnd());
      const s = slow.ack(c);
      phase.push(s.d, s.c, s.t, s.at, TICK_MS);
      const st = phase.status(c);
      if (st.ready) leads.push(st.leadMs);
    }
    let prev = before;
    for (const l of leads) {
      expect(Math.abs(l - prev)).toBeLessThanOrEqual(PHASE_SLEW_MS + 1e-9);
      prev = l;
    }
    expect(leads[leads.length - 1]!).toBeGreaterThan(before + 5);
  });

  it("phaseSlot is the slot at or after c: its deadline is never before c", () => {
    const st: PhaseStatus = { ready: true, n: 20, leadMs: 93.4, marginMs: 6.2, gridMs: 13, spreadMs: 52, gapMs: 6 };
    for (let c = 0; c < 500; c += 3.7) {
      const s = phaseSlot(st, c, 25);
      expect(s.deadline).toBeGreaterThanOrEqual(c - 1e-9);
      expect(s.deadline - c).toBeLessThan(25);
      expect(Number.isInteger(s.id)).toBe(true);
    }
  });

  it("ignores the ack of a send it was told was aligned", () => {
    const server = gridServer();
    const phase = new TickPhase();
    const s = server.ack(12_345.25);
    phase.noteAlignedSend(12_345.5);
    phase.push(s.d, s.c, s.t, s.at, TICK_MS);
    expect(phase.status(s.at).n).toBe(0);
    const s2 = server.ack(12_400);
    phase.push(s2.d, s2.c, s2.t, s2.at, TICK_MS);
    expect(phase.status(s2.at).n).toBe(1);
  });
});
