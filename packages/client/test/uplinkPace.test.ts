import { describe, expect, it } from "vitest";
import { TICK_MS } from "@raid/shared";
import {
  AIM_ALIGN_FRAME_MS, AIM_BACKUP_MS, AIM_BUDGET_SLOW, AIM_BUDGET_STOP, AIM_FLOOR_MS, AIM_KEEPALIVE_MS, AIM_STARVE_MS, AimGate, FramePace,
  HOLD_KEEPALIVE_MS, HOLD_MOVE_MIN, HOLD_REPEAT_MS, HoldGate, MessageMeter,
} from "../src/net/uplinkPace";
import { phaseSlot, type PhaseSource, type PhaseStatus } from "../src/net/tickPhase";

/** A learner that knows the deadline: the wake stamped 50k runs `lead` after a send must leave, `margin` kept. */
function knownPhase(ready = true, leadMs = 90, marginMs = 6, gridMs = 0): PhaseSource & { st: PhaseStatus } {
  const st: PhaseStatus = { ready, n: 32, leadMs, marginMs, gridMs, spreadMs: 52, gapMs: 4 };
  return { st, status: () => st, slot: (c, period) => phaseSlot(st, c, period) };
}

/**
 * Runs `ms` of frames every `frame` ms (local time = client clock + `offset`) through an AimGate, sending whenever it is due
 * (the cursor always turning), and returns the client clocks of the sends.
 */
function stream(gate: AimGate, o: { frame: number; ms: number; phase?: PhaseSource | null; synced?: boolean; perSecond?: number; start?: number; offset?: number }): number[] {
  const sent: number[] = [];
  const offset = o.offset ?? 1000;
  for (let c = o.start ?? 10_000; c < (o.start ?? 10_000) + o.ms; c += o.frame) {
    const now = c - offset;
    gate.frames.frame(now);
    if (gate.due(now, c, o.synced ?? true, o.perSecond ?? 20, o.phase ?? null)) {
      gate.sent(now);
      sent.push(c);
    }
  }
  return sent;
}

const gaps = (xs: number[]) => xs.slice(1).map((x, i) => x - xs[i]!);

describe("AimGate", () => {
  it("sends every half tick while the deadline is not known, and the old gate is one tick", () => {
    expect(AIM_FLOOR_MS).toBe(TICK_MS / 2);
    const floor = stream(new AimGate(), { frame: 1000 / 144, ms: 2000, phase: knownPhase(false) });
    expect(Math.min(...gaps(floor))).toBeGreaterThanOrEqual(AIM_FLOOR_MS - 1e-9);
    expect(Math.max(...gaps(floor))).toBeLessThan(AIM_FLOOR_MS + 1000 / 144);
    const legacy = stream(new AimGate({ floorMs: TICK_MS, aligned: false }), { frame: 1000 / 144, ms: 2000, phase: knownPhase() });
    expect(Math.min(...gaps(legacy))).toBeGreaterThanOrEqual(TICK_MS - 1e-9);
    expect(Math.max(...gaps(legacy))).toBeLessThan(TICK_MS + 1000 / 144);
    // No learner, no clock yet, or switched off: the floor.
    expect(gaps(stream(new AimGate(), { frame: 1000 / 144, ms: 2000, phase: knownPhase(), synced: false }))).toEqual(gaps(floor));
    expect(gaps(stream(new AimGate(), { frame: 1000 / 144, ms: 2000, phase: null }))).toEqual(gaps(floor));
    expect(gaps(stream(new AimGate({ aligned: false }), { frame: 1000 / 144, ms: 2000, phase: knownPhase() }))).toEqual(gaps(floor));
  });

  it("steps back near the message cap: one a tick from AIM_BUDGET_SLOW a second, keepalives only from AIM_BUDGET_STOP", () => {
    const slow = stream(new AimGate(), { frame: 1000 / 144, ms: 2000, phase: knownPhase(), perSecond: AIM_BUDGET_SLOW });
    expect(Math.min(...gaps(slow))).toBeGreaterThanOrEqual(TICK_MS - 1e-9);
    const stop = stream(new AimGate(), { frame: 1000 / 144, ms: 3000, phase: knownPhase(), perSecond: AIM_BUDGET_STOP });
    expect(Math.min(...gaps(stop))).toBeGreaterThanOrEqual(AIM_KEEPALIVE_MS - 1e-9);
    expect(stream(new AimGate(), { frame: 1000 / 144, ms: 2000, phase: knownPhase(), perSecond: AIM_BUDGET_SLOW - 1 }).length).toBeGreaterThan(70);
  });

  /** Which deadline a send at client clock `c` was for (the wakes' deadlines sit at 50k - 96 here), and whether it was the backup. */
  const slotOf = (c: number) => {
    const deadline = Math.ceil((c + 96) / TICK_MS) * TICK_MS - 96;
    return { id: deadline, backup: deadline - c >= AIM_BACKUP_MS - 1e-9, early: deadline - c };
  };

  it("sends twice a tick once the deadline is known and frames are short: in the last frame before it, and a backup", () => {
    for (const frame of [1000 / 144, 1000 / 100]) {
      const sent = stream(new AimGate(), { frame, ms: 5000, phase: knownPhase(true, 90, 6, 0) });
      const slots = sent.map(slotOf);
      // One primary and one backup per deadline, each in the last frame before its instant.
      expect(new Set(slots.map((s) => `${s.id}:${s.backup}`)).size).toBe(slots.length);
      for (const s of slots) {
        const before = s.backup ? s.early - AIM_BACKUP_MS : s.early;
        expect(before).toBeGreaterThanOrEqual(-1e-9);
        expect(before).toBeLessThan(frame + 1e-6);
      }
      expect(sent.length).toBeGreaterThanOrEqual(2 * (5000 / TICK_MS) - 2);
      expect(sent.length).toBeLessThanOrEqual(2 * (5000 / TICK_MS) + 1);
    }
  });

  it("keeps the floor at 60 fps, where a send in the last frame before the deadline is no better", () => {
    expect(1000 / 60).toBeGreaterThanOrEqual(AIM_ALIGN_FRAME_MS);
    const sent = stream(new AimGate(), { frame: 1000 / 60, ms: 2000, phase: knownPhase() });
    expect(gaps(sent)).toEqual(gaps(stream(new AimGate({ aligned: false }), { frame: 1000 / 60, ms: 2000, phase: knownPhase() })));
  });

  it("uses a slot up even when nothing is sent, and sends anyway after AIM_STARVE_MS", () => {
    const gate = new AimGate();
    const phase = knownPhase();
    const frame = 1000 / 144;
    let c = 10_000;
    gate.sent(c);
    const due: number[] = [];
    // The cursor stands still: the gate is asked, nothing is sent.
    for (; c < 10_000 + AIM_STARVE_MS; c += frame) {
      gate.frames.frame(c);
      if (gate.due(c, c, true, 20, phase)) due.push(c);
    }
    // One slot each, never twice: a turn a frame after a slot waits for the next one.
    expect(new Set(due.map((x) => `${slotOf(x).id}:${slotOf(x).backup}`)).size).toBe(due.length);
    gate.sent(c);
    let after = 0;
    for (const end = c + AIM_STARVE_MS + 2 * frame; c < end; c += frame) {
      gate.frames.frame(c);
      if (gate.due(c, c, true, 20, phase)) after++;
    }
    // Past the starvation limit every frame is due until something is sent.
    expect(after).toBeGreaterThan(5 + 2);
    gate.reset();
    gate.frames.frame(0);
    gate.frames.frame(7);
    expect(gate.due(7, 7, true, 20, phase)).toBe(true);
  });

  it("falls back to the floor when frames are long (below 40 fps), and FramePace clamps what it reads", () => {
    const slow = stream(new AimGate(), { frame: 26, ms: 2000, phase: knownPhase() });
    expect(Math.min(...gaps(slow))).toBeGreaterThanOrEqual(AIM_FLOOR_MS);
    const pace = new FramePace();
    expect(pace.ms).toBe(Infinity);
    pace.frame(0);
    pace.frame(0.2);
    expect(pace.ms).toBe(1);
    pace.frame(5000);
    expect(pace.ms).toBe(50);
    for (let t = 5000, i = 0; i < 6; i++) pace.frame((t += 7));
    expect(pace.ms).toBeCloseTo(7);
  });
});

describe("HoldGate", () => {
  const at = (x: number) => ({ x, y: 100 });

  it("re-sends only a ground point that moved past HOLD_MOVE_MIN, at most every HOLD_REPEAT_MS, and a still one as a keepalive", () => {
    const gate = new HoldGate();
    gate.sent(at(100), 0);
    expect(gate.next(at(100 + HOLD_MOVE_MIN), 40, 40, true, null, 7)).toBe("none");
    expect(gate.next(at(100 + HOLD_MOVE_MIN + 1), 40, 40, true, null, 7)).toBe("none");
    expect(gate.next(at(100 + HOLD_MOVE_MIN + 1), HOLD_REPEAT_MS, HOLD_REPEAT_MS, true, null, 7)).toBe("now");
    gate.sent(at(100 + HOLD_MOVE_MIN + 1), HOLD_REPEAT_MS);
    expect(gate.next(at(107), HOLD_REPEAT_MS + HOLD_KEEPALIVE_MS - 1, 0, true, null, 7)).toBe("none");
    expect(gate.next(at(107), HOLD_REPEAT_MS + HOLD_KEEPALIVE_MS, 0, true, null, 7)).toBe("now");
  });

  it("sends a move after a quiet spell at once, then one a tick in the slot before each wake while the deadline is known", () => {
    const gate = new HoldGate();
    const phase = knownPhase(true, 90, 6, 0);
    const frame = 1000 / 144;
    let x = 0;
    gate.sent(at(x), 9000);
    const sends: Array<{ c: number; kind: string }> = [];
    for (let c = 10_000; c < 11_000; c += frame) {
      x += 1.5; // the camera follows the walk: the ground point under a still cursor moves every frame
      const kind = gate.next(at(x), c, c, true, phase, frame);
      if (kind !== "none") {
        sends.push({ c, kind });
        gate.sent(at(x), c);
      }
    }
    expect(sends[0]).toEqual({ c: 10_000, kind: "now" });
    const aligned = sends.slice(1);
    expect(aligned.every((s) => s.kind === "aligned")).toBe(true);
    const slots = aligned.map((s) => Math.ceil((s.c + 96) / TICK_MS));
    expect(new Set(slots).size).toBe(slots.length);
    for (const s of aligned) {
      const deadline = Math.ceil((s.c + 96) / TICK_MS) * TICK_MS - 96;
      expect(deadline - s.c).toBeLessThan(frame + 1e-6);
    }
    expect(aligned.length).toBeGreaterThanOrEqual(18);
    expect(aligned.length).toBeLessThanOrEqual(20);
  });

  it("falls back to HOLD_REPEAT_MS while the deadline is unknown, and forgets everything on reset", () => {
    const gate = new HoldGate();
    const phase = knownPhase(false);
    let x = 0;
    const sent: number[] = [];
    for (let c = 0; c < 1000; c += 1000 / 60) {
      x += 3;
      if (gate.next(at(x), c, c, true, phase, 1000 / 60) !== "none") { sent.push(c); gate.sent(at(x), c); }
    }
    expect(Math.min(...gaps(sent))).toBeGreaterThanOrEqual(HOLD_REPEAT_MS - 1e-9);
    gate.reset();
    expect(gate.next(at(x), 1000, 1000, true, phase, 16)).toBe("now");
  });
});

describe("MessageMeter", () => {
  it("counts the sends of the last second, and reads at most 128", () => {
    const m = new MessageMeter();
    expect(m.perSecond(0)).toBe(0);
    for (let t = 0; t < 1000; t += 25) m.note(t);
    expect(m.perSecond(999)).toBe(40);
    expect(m.perSecond(1100)).toBe(35);
    expect(m.perSecond(2000)).toBe(0);
    for (let i = 0; i < 300; i++) m.note(3000 + i);
    expect(m.perSecond(3300)).toBe(128);
    m.reset();
    expect(m.perSecond(3300)).toBe(0);
  });
});
