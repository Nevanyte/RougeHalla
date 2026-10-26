// The FPS / ping readout (ui/perfMeter.ts): the text and colour rules, the FPS windows, the ping schedule against a fake room,
// and the DOM being written only when something changed.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FPS_GAP_MS, FPS_WINDOW_MS, FpsCounter, PING_EVERY_MS, PING_TIMEOUT_MS, PerfMeter, PingProbe,
  formatFps, formatPerf, formatPing, fpsTone, pingTone, type PerfSettings, type PingRoom,
} from "../src/ui/perfMeter";
import { fake, installChromeDom } from "./chromeDom";

afterEach(() => { vi.unstubAllGlobals(); });

describe("formatting", () => {
  it("reads like 144 fps · 32 ms", () => {
    expect(formatPerf(144, 32)).toBe("144 fps · 32 ms");
    expect(formatPerf(59.6, 31.7)).toBe("60 fps · 32 ms");
  });

  it("shows -- for a number it does not have", () => {
    expect(formatFps(null)).toBe("-- fps");
    expect(formatPing(null)).toBe("-- ms");
    expect(formatPerf(null, null)).toBe("-- fps · -- ms");
  });

  it("leaves out a part that is switched off, and gives nothing when both are", () => {
    expect(formatPerf(60, 20, { fps: true, ping: false })).toBe("60 fps");
    expect(formatPerf(60, 20, { fps: false, ping: true })).toBe("20 ms");
    expect(formatPerf(60, 20, { fps: false, ping: false })).toBe("");
  });

  it("keeps a huge ping three digits wide", () => {
    expect(formatPing(999)).toBe("999 ms");
    expect(formatPing(1234)).toBe("999+ ms");
    expect(formatPing(0)).toBe("0 ms");
  });
});

describe("colour classes", () => {
  it("ping: good under 50 ms, warn under 100, bad beyond, idle without a value", () => {
    expect(pingTone(0)).toBe("good");
    expect(pingTone(49)).toBe("good");
    expect(pingTone(50)).toBe("warn");
    expect(pingTone(99)).toBe("warn");
    expect(pingTone(100)).toBe("bad");
    expect(pingTone(900)).toBe("bad");
    expect(pingTone(null)).toBe("idle");
  });

  it("fps: good from 50, warn from 30, bad below, idle without a value", () => {
    expect(fpsTone(144)).toBe("good");
    expect(fpsTone(50)).toBe("good");
    expect(fpsTone(49)).toBe("warn");
    expect(fpsTone(30)).toBe("warn");
    expect(fpsTone(29)).toBe("bad");
    expect(fpsTone(null)).toBe("idle");
  });
});

describe("FpsCounter", () => {
  /** Frames every `dt` ms from `from` to `to`; the last answer that was not null. */
  function run(counter: FpsCounter, from: number, to: number, dt: number): number | null {
    let last: number | null = null;
    for (let t = from; t <= to; t += dt) last = counter.frame(t) ?? last;
    return last;
  }

  it("says nothing until a window has closed, then reports the rate", () => {
    const c = new FpsCounter();
    expect(c.frame(0)).toBeNull();
    expect(c.frame(100)).toBeNull();
    expect(c.frame(499)).toBeNull();
    expect(run(new FpsCounter(), 0, 2000, 1000 / 60)).toBeCloseTo(60, 0);
  });

  it("measures a 144 Hz display and a 30 fps stall alike", () => {
    expect(run(new FpsCounter(), 0, 3000, 1000 / 144)).toBeCloseTo(144, 0);
    expect(run(new FpsCounter(), 0, 3000, 1000 / 30)).toBeCloseTo(30, 0);
  });

  it("answers once per window, about every half second", () => {
    const c = new FpsCounter();
    let answers = 0;
    for (let t = 0; t <= 5000; t += 16) if (c.frame(t) !== null) answers++;
    expect(answers).toBeGreaterThanOrEqual(8);
    expect(answers).toBeLessThanOrEqual(10);
    expect(FPS_WINDOW_MS).toBe(500);
  });

  it("smooths: one slow window moves the number only part of the way", () => {
    const c = new FpsCounter();
    run(c, 0, 2000, 1000 / 60);
    // A window at 20 fps: the displayed value lands between 20 and 60.
    const slow = run(c, 2000 + 50, 2000 + 700, 50)!;
    expect(slow).toBeGreaterThan(20);
    expect(slow).toBeLessThan(60);
  });

  it("drops the window that spans a hidden tab instead of reporting a tiny rate", () => {
    const c = new FpsCounter();
    run(c, 0, 1000, 1000 / 60);
    const back = 1000 + FPS_GAP_MS * 20;
    expect(c.frame(back)).toBeNull();
    const after = run(c, back, back + 1500, 1000 / 60)!;
    expect(after).toBeGreaterThan(50);
  });

  it("reset forgets the smoothing", () => {
    const c = new FpsCounter();
    run(c, 0, 2000, 1000 / 60);
    c.reset();
    expect(run(c, 5000, 6500, 50)).toBeCloseTo(20, 0);
  });
});

/** A room whose ping the test answers by hand. */
function fakeRoom(open = true) {
  const pending: Array<(ms: number) => void> = [];
  const room = {
    pings: 0,
    connection: { isOpen: open },
    ping: vi.fn((cb: (ms: number) => void) => { room.pings++; pending.push(cb); }),
    reply(ms: number) { pending.shift()?.(ms); },
    replyAt(i: number, ms: number) { pending[i]?.(ms); },
  };
  return room satisfies PingRoom & Record<string, unknown>;
}

describe("PingProbe", () => {
  it("has no value without a room, and asks nothing", () => {
    const probe = new PingProbe(() => null);
    probe.tick(0);
    probe.tick(5000);
    expect(probe.value).toBeNull();
  });

  it("pings at once, then every PING_EVERY_MS, and keeps the last answer", () => {
    const room = fakeRoom();
    const probe = new PingProbe(() => room);
    probe.tick(0);
    expect(room.ping).toHaveBeenCalledTimes(1);
    room.reply(31.6);
    expect(probe.value).toBeCloseTo(31.6);
    probe.tick(PING_EVERY_MS - 1);
    expect(room.ping).toHaveBeenCalledTimes(1);
    probe.tick(PING_EVERY_MS);
    expect(room.ping).toHaveBeenCalledTimes(2);
    expect(probe.value).toBeCloseTo(31.6);
    room.reply(40);
    expect(probe.value).toBe(40);
  });

  it("never has two pings in flight (the SDK keeps one callback)", () => {
    const room = fakeRoom();
    const probe = new PingProbe(() => room);
    for (let t = 0; t < PING_TIMEOUT_MS; t += 100) probe.tick(t);
    expect(room.ping).toHaveBeenCalledTimes(1);
  });

  it("shows no value when a ping gets no reply for PING_TIMEOUT_MS, then tries again", () => {
    const room = fakeRoom();
    const probe = new PingProbe(() => room);
    probe.tick(0);
    room.reply(20);
    probe.tick(PING_EVERY_MS);
    expect(probe.value).toBe(20);
    probe.tick(PING_EVERY_MS + PING_TIMEOUT_MS - 1);
    expect(probe.value).toBe(20);
    probe.tick(PING_EVERY_MS + PING_TIMEOUT_MS);
    expect(probe.value).toBeNull();
    probe.tick(PING_EVERY_MS + PING_TIMEOUT_MS + 1);
    expect(room.ping).toHaveBeenCalledTimes(3);
    room.replyAt(1, 55);
    expect(probe.value).toBe(55);
  });

  it("takes a late reply if no newer ping went out, and ignores one from an older ping", () => {
    const room = fakeRoom();
    const probe = new PingProbe(() => room);
    probe.tick(0);
    probe.tick(PING_TIMEOUT_MS);
    expect(probe.value).toBeNull();
    room.replyAt(0, 4200);
    expect(probe.value).toBe(4200);

    const room2 = fakeRoom();
    const probe2 = new PingProbe(() => room2);
    probe2.tick(0);
    probe2.tick(PING_TIMEOUT_MS);
    probe2.tick(PING_TIMEOUT_MS + PING_EVERY_MS);
    expect(room2.ping).toHaveBeenCalledTimes(2);
    room2.replyAt(0, 9999);
    expect(probe2.value).toBeNull();
    room2.replyAt(1, 33);
    expect(probe2.value).toBe(33);
  });

  it("shows no value and sends nothing while the socket is closed, and resumes when it opens", () => {
    const room = fakeRoom(false);
    const probe = new PingProbe(() => room);
    probe.tick(0);
    probe.tick(3000);
    expect(room.ping).not.toHaveBeenCalled();
    expect(probe.value).toBeNull();
    room.connection.isOpen = true;
    probe.tick(3100);
    expect(room.ping).toHaveBeenCalledTimes(1);
    room.reply(18);
    expect(probe.value).toBe(18);
    room.connection.isOpen = false;
    probe.tick(3200);
    expect(probe.value).toBeNull();
  });

  it("starts over with a new room and ignores the old room's late answer", () => {
    const a = fakeRoom();
    const b = fakeRoom();
    let current: PingRoom | null = a;
    const probe = new PingProbe(() => current);
    probe.tick(0);
    current = b;
    probe.tick(100);
    expect(b.ping).toHaveBeenCalledTimes(1);
    a.reply(999);
    expect(probe.value).toBeNull();
    b.reply(12);
    expect(probe.value).toBe(12);
    current = null;
    probe.tick(200);
    expect(probe.value).toBeNull();
  });

  it("survives a room whose ping throws", () => {
    const room = { ping: vi.fn(() => { throw new Error("closed"); }), connection: { isOpen: true } };
    const probe = new PingProbe(() => room);
    expect(() => probe.tick(0)).not.toThrow();
    expect(probe.value).toBeNull();
    expect(() => probe.tick(PING_EVERY_MS)).not.toThrow();
    expect(room.ping).toHaveBeenCalledTimes(2);
  });

  it("ignores a reply that is not a number", () => {
    const room = fakeRoom();
    const probe = new PingProbe(() => room);
    probe.tick(0);
    room.reply(Number.NaN);
    expect(probe.value).toBeNull();
  });
});

/** The settings the meter reads, changeable by the test. */
function fakeSettings(initial = { showFps: true, showPing: true }) {
  let value = { ...initial };
  const listeners = new Set<() => void>();
  const settings: PerfSettings & { set(patch: Partial<typeof value>): void } = {
    get: () => value,
    subscribe: (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    set(patch) { value = { ...value, ...patch }; for (const cb of [...listeners]) cb(); },
  };
  return settings;
}

/** A requestAnimationFrame the test steps by hand. */
function fakeFrames() {
  let next = 1;
  const queue = new Map<number, (t: number) => void>();
  return {
    requestFrame: (cb: (t: number) => void) => { const id = next++; queue.set(id, cb); return id; },
    cancelFrame: (id: number) => { queue.delete(id); },
    get pending() { return queue.size; },
    /** Runs the one scheduled frame at time `t`. */
    step(t: number) {
      const [id, cb] = [...queue.entries()][0] ?? [];
      if (id === undefined || !cb) throw new Error("no frame scheduled");
      queue.delete(id);
      cb(t);
    },
  };
}

function meterSetup(initial?: { showFps: boolean; showPing: boolean }, room: PingRoom | null = fakeRoom()) {
  installChromeDom();
  const settings = fakeSettings(initial);
  const frames = fakeFrames();
  const meter = new PerfMeter({ room: () => room, settings, requestFrame: frames.requestFrame, cancelFrame: frames.cancelFrame });
  const [fps, sep, ping] = fake(meter.element).children;
  return { meter, settings, frames, fps: fps!, sep: sep!, ping: ping!, room };
}

describe("PerfMeter", () => {
  it("starts as -- fps · -- ms, with the idle colour", () => {
    const { fps, ping, sep, meter } = meterSetup();
    expect(fps.textContent).toBe("-- fps");
    expect(ping.textContent).toBe("-- ms");
    expect(sep.textContent).toBe("·");
    expect(fps.className).toContain("perf-idle");
    expect(fake(meter.element).hidden).toBe(false);
  });

  it("shows the measured numbers with their colours", () => {
    const room = fakeRoom();
    const { fps, ping, frames } = meterSetup(undefined, room);
    for (let t = 0; t <= 1200; t += 1000 / 144) frames.step(t);
    room.reply(32);
    frames.step(1300);
    expect(fps.textContent).toBe("144 fps");
    expect(fps.className).toBe("perf-fps perf-good");
    expect(ping.textContent).toBe("32 ms");
    expect(ping.className).toBe("perf-ping perf-good");
    // A slow reply turns it red.
    for (let t = 1300; t <= 3500; t += 100) frames.step(t);
    room.reply(180);
    frames.step(3600);
    expect(ping.textContent).toBe("180 ms");
    expect(ping.className).toBe("perf-ping perf-bad");
  });

  it("writes the DOM only when the text changes", () => {
    const room = fakeRoom();
    const { fps, ping, frames } = meterSetup(undefined, room);
    for (let t = 0; t <= 1200; t += 1000 / 60) frames.step(t);
    room.reply(25);
    frames.step(1250);
    const fpsWrites = fps.textWrites;
    const pingWrites = ping.textWrites;
    const className = fps.className;
    // Many more frames at the same rate: the number holds, so nothing is written.
    for (let t = 1300; t <= 1900; t += 1000 / 60) frames.step(t);
    expect(ping.textWrites).toBe(pingWrites);
    expect(fps.textWrites).toBeLessThanOrEqual(fpsWrites + 1);
    expect(fps.className).toBe(className);
  });

  it("showFps off hides the FPS and the dot, and stops counting; the ping carries on", () => {
    const room = fakeRoom();
    const { settings, fps, sep, ping, frames, meter } = meterSetup(undefined, room);
    settings.set({ showFps: false });
    expect(fps.hidden).toBe(true);
    expect(sep.hidden).toBe(true);
    expect(ping.hidden).toBe(false);
    expect(fake(meter.element).hidden).toBe(false);
    frames.step(0);
    expect(room.ping).toHaveBeenCalledTimes(1);
    const writes = fps.textWrites;
    for (let t = 20; t <= 1500; t += 20) frames.step(t);
    expect(fps.textWrites).toBe(writes);
  });

  it("showPing off hides the ping and stops asking the server", () => {
    const room = fakeRoom();
    const { settings, ping, fps, frames } = meterSetup(undefined, room);
    settings.set({ showPing: false });
    expect(ping.hidden).toBe(true);
    expect(fps.hidden).toBe(false);
    for (let t = 0; t <= 6000; t += 100) frames.step(t);
    expect(room.ping).not.toHaveBeenCalled();
  });

  it("with both off, the readout is hidden and the frame loop is not running at all", () => {
    const { settings, frames, meter } = meterSetup();
    expect(meter.running).toBe(true);
    settings.set({ showFps: false, showPing: false });
    expect(fake(meter.element).hidden).toBe(true);
    expect(meter.running).toBe(false);
    expect(frames.pending).toBe(0);
    settings.set({ showFps: true });
    expect(fake(meter.element).hidden).toBe(false);
    expect(meter.running).toBe(true);
    expect(frames.pending).toBe(1);
  });

  it("starts hidden and idle when both are off from the start", () => {
    const { frames, meter } = meterSetup({ showFps: false, showPing: false });
    expect(fake(meter.element).hidden).toBe(true);
    expect(frames.pending).toBe(0);
  });

  it("shows -- for the ping when there is no room (the hub), and a number once there is one", () => {
    let room: PingRoom | null = null;
    installChromeDom();
    const frames = fakeFrames();
    const meter = new PerfMeter({ room: () => room, settings: fakeSettings(), requestFrame: frames.requestFrame, cancelFrame: frames.cancelFrame });
    const ping = fake(meter.element).children[2]!;
    frames.step(0);
    frames.step(16);
    expect(ping.textContent).toBe("-- ms");
    const joined = fakeRoom();
    room = joined;
    frames.step(32);
    joined.reply(41);
    frames.step(48);
    expect(ping.textContent).toBe("41 ms");
    room = null;
    frames.step(64);
    expect(ping.textContent).toBe("-- ms");
    expect(ping.className).toBe("perf-ping perf-idle");
  });

  it("destroy stops the loop and unsubscribes", () => {
    const { meter, frames, settings } = meterSetup();
    meter.destroy();
    expect(frames.pending).toBe(0);
    settings.set({ showFps: false });
    expect(frames.pending).toBe(0);
  });
});
