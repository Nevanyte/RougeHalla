// The draw-ahead of remote fighters (net/remoteDraw.ts; docs/PLAYER_PREDICTION.md Stage 2), driven through the real
// EntityInterpolator and RenderClock with patches every 50 ms and frames at 60, 120 and 144 Hz. What it may draw (along the walk hint
// only, one tick at most, never into a wall, a root, a death or a cut), how it corrects (toward the truth, never past it, never
// turning a walker round, snapping only past 32 u), and that with the setting off it is exactly sample().
import { describe, expect, it } from "vitest";
import {
  circleClear, EFFECT_CASTING, EFFECT_ROOTED, EFFECT_STUNNED, encodeWalkDir, EXTRAPOLATE_MS, mapFromTiles, MIN_INTERP_DELAY_MS,
  MOB_EXTRAPOLATE_MS, mulberry32, PATCH_MS, PLAYER_RADIUS, TILE, TILE_FLOOR, TILE_WALL, type FxEvent, type GameMap, type TimedFx,
} from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { EntityInterpolator } from "../src/net/interpolation";
import { REMOTE_MAX_AHEAD_U, RemoteDraw, type RemoteDrawInfo, type RemoteDrawOptions } from "../src/net/remoteDraw";

const ID = "r";

function roomMap(w = 160, h = 160, wall?: (tx: number, ty: number) => boolean): GameMap {
  const tiles = new Uint8Array(w * h).fill(TILE_FLOOR);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || wall?.(x, y)) tiles[y * w + x] = TILE_WALL;
    }
  }
  return mapFromTiles(w, h, tiles);
}
const OPEN = roomMap();

/** The server's state of the remote fighter at one tick. */
interface Truth {
  x: number; y: number;
  walkDir?: number; walkTicks?: number;
  /** False: the patch carries no walk hint at all (an older server). */
  hinted?: boolean;
  effects?: number; status?: string; displaceSeq?: number; drawStartedAt?: number;
}

interface Frame {
  now: number; r: number; c: number; x: number; y: number;
  info: RemoteDrawInfo | undefined;
  newest: { t: number; x: number; y: number };
}

interface PlayOpts {
  ticks: number;
  hz?: number;
  latency?: number;
  jitter?: number;
  seed?: number;
  kind?: "player" | "mob";
  on?: boolean;
  map?: GameMap | null;
  options?: Partial<RemoteDrawOptions>;
  /** The fx of tick k (they arrive with its patch, just before it). */
  fx?: (k: number, t: number) => FxEvent[];
  /** Tick k's patch follows a teleport fx (a cut for everyone). */
  teleport?: (k: number) => boolean;
  /** Called after every frame drawn. */
  onFrame?: (f: Frame, ctx: { remote: RemoteDraw; interp: EntityInterpolator; now: number }) => void;
}

function stateOf(t: number, s: Truth, kind: "player" | "mob"): RaidState {
  const e = {
    x: s.x, y: s.y, displaceSeq: s.displaceSeq ?? 0,
    ...(kind === "player" && s.hinted !== false ? { extra: { walkDir: s.walkDir ?? 0, walkTicks: s.walkTicks ?? 0 } } : {}),
  };
  const one = new Map([[ID, e]]);
  return { serverTime: t, players: kind === "player" ? one : new Map(), mobs: kind === "mob" ? one : new Map() } as unknown as RaidState;
}

/** Plays a scripted remote fighter through the client: `truth(k, t)` is its state at tick k (server time t). */
function play(truth: (k: number, t: number) => Truth, o: PlayOpts) {
  const kind = o.kind ?? "player";
  const interp = new EntityInterpolator();
  const remote = new RemoteDraw(interp, o.options);
  if (o.on !== false) remote.setEnabled(true);
  const rng = mulberry32(o.seed ?? 1);
  const ticks: Array<{ t: number; s: Truth; at: number; k: number; cut: boolean }> = [];
  let last = -Infinity;
  let prevSeq = -1;
  for (let k = 0; k < o.ticks; k++) {
    const t = 1000 + k * PATCH_MS;
    const s = truth(k, t);
    let at = 500 + k * PATCH_MS + (o.latency ?? 15) + (o.jitter ? -o.jitter * Math.log(1 - rng()) : 0);
    if (at < last) at = last;
    last = at;
    const seq = s.displaceSeq ?? 0;
    ticks.push({ t, s, at, k, cut: (prevSeq >= 0 && seq !== prevSeq) || (o.teleport?.(k) ?? false) });
    prevSeq = seq;
  }
  const map = o.map === undefined ? OPEN : o.map;
  const frames: Frame[] = [];
  const out = { x: 0, y: 0 };
  let i = 0;
  let latest: Truth | null = null;
  const end = ticks[ticks.length - 1]!.at + 150;
  for (let now = ticks[0]!.at; now <= end; now += 1000 / (o.hz ?? 144)) {
    while (i < ticks.length && ticks[i]!.at <= now) {
      const a = ticks[i]!;
      for (const fx of o.fx?.(a.k, a.t) ?? []) remote.noteFx({ ...fx, t: a.t } as TimedFx);
      if (o.teleport?.(a.k)) interp.markCut(a.t);
      interp.onPatch(stateOf(a.t, a.s, kind), a.at);
      latest = a.s;
      i++;
    }
    const r = interp.renderTime(now);
    remote.beginFrame(map, r);
    if (!latest) continue;
    const f = { x: latest.x, y: latest.y, status: latest.status ?? "alive", effects: latest.effects ?? 0, drawStartedAt: latest.drawStartedAt ?? 0 };
    if (!remote.draw(ID, kind, f, r, out)) continue;
    const n = interp.buffer(ID)!.latest!;
    const info = remote.lastOf(ID);
    const frame: Frame = { now, r, c: interp.clock.now(now), x: out.x, y: out.y, info: info ? { ...info } : undefined, newest: { t: n.t, x: n.x, y: n.y } };
    frames.push(frame);
    o.onFrame?.(frame, { remote, interp, now });
  }
  /** The server's position at time t: its tick positions lerped, a cut held until its tick. */
  const truthAt = (t: number): { x: number; y: number } => {
    if (t <= ticks[0]!.t) return ticks[0]!.s;
    for (let k = 1; k < ticks.length; k++) {
      const b = ticks[k]!;
      if (t > b.t) continue;
      const a = ticks[k - 1]!;
      if (b.cut) return t < b.t ? a.s : b.s;
      const q = (t - a.t) / (b.t - a.t);
      return { x: a.s.x + (b.s.x - a.s.x) * q, y: a.s.y + (b.s.y - a.s.y) * q };
    }
    return ticks[ticks.length - 1]!.s;
  };
  const lastT = ticks[ticks.length - 1]!.t;
  const err = (f: Frame): number => {
    const p = truthAt(f.info ? f.info.tDrawn : Math.min(f.r, f.newest.t));
    return Math.hypot(f.x - p.x, f.y - p.y);
  };
  /** Frames from 2.5 s on whose claimed time the truth still covers (the last tick ends the script). */
  const judged = (from = 2500): Frame[] => frames.filter((f) => f.now >= from && (f.info ? f.info.tDrawn : Math.min(f.r, f.newest.t)) <= lastT);
  return { frames, truthAt, err, judged, remote, interp };
}

/** A straight walk along angle `a` at `speed` u/s from (1000, 2500), with the walk hint `hint(k)` (3 by default). */
const straight = (speed: number, a = 0, hint: (k: number) => number = () => 3) => (k: number): Truth => ({
  x: 1000 + Math.cos(a) * speed * k * PATCH_MS / 1000, y: 2500 + Math.sin(a) * speed * k * PATCH_MS / 1000, walkDir: encodeWalkDir(a), walkTicks: hint(k),
});

const settled = (frames: Frame[], fromNow = 2500) => frames.filter((f) => f.now >= fromNow);
const pct = (v: number[], q: number) => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(q * v.length))]!;
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

describe("RemoteDraw, off", () => {
  it("is interp.sample, bit for bit, with no state kept", () => {
    const interp = new EntityInterpolator();
    const remote = new RemoteDraw(interp);
    expect(remote.enabled).toBe(false);
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    for (let k = 0; k < 60; k++) {
      const t = 1000 + k * PATCH_MS;
      interp.onPatch(stateOf(t, straight(170)(k), "player"), 500 + k * PATCH_MS + 15);
      for (let f = 0; f < 7; f++) {
        const now = 500 + k * PATCH_MS + 15 + f * 7;
        const r = interp.renderTime(now);
        remote.beginFrame(OPEN, r);
        expect(remote.draw(ID, "player", { x: 0, y: 0, status: "alive", effects: 0 }, r, a)).toBe(interp.sample(ID, r, b));
        expect(Object.is(a.x, b.x) && Object.is(a.y, b.y)).toBe(true);
      }
    }
    expect(remote.lastOf(ID)).toBeUndefined();
    expect(interp.delayMs).toBeGreaterThanOrEqual(MIN_INTERP_DELAY_MS - 1);
  });
});

describe("RemoteDraw, a walk with the hint", () => {
  it("a straight walk: within 0.5 u of the truth on every frame, and 50 ms fresher than with it off", () => {
    for (const hz of [60, 120, 144]) {
      const on = play(straight(170, 0.4), { ticks: 120, hz });
      const off = play(straight(170, 0.4), { ticks: 120, hz, on: false });
      const s = on.judged();
      expect(Math.max(...s.map(on.err)), `${hz} Hz`).toBeLessThan(0.5);
      expect(s.some((f) => f.info!.aheadMs > 0), `${hz} Hz`).toBe(true);
      const ageOn = mean(s.map((f) => f.c - f.info!.tDrawn));
      const ageOff = mean(settled(off.frames).map((f) => f.c - Math.min(f.r, f.newest.t)));
      expect(ageOff - ageOn, `${hz} Hz`).toBeGreaterThan(49);
      expect(on.remote.stats.snaps).toBe(0);
    }
  });

  it("holds the newest sample with hint 0, with a hint from another patch, and with no hint at all (an older server)", () => {
    const cases: Array<[string, (k: number) => Truth]> = [
      ["hint 0", straight(170, 0, () => 0)],
      ["stale hint", (k) => ({ ...straight(170)(k), hinted: k < 3 })],
      ["no hint", (k) => ({ ...straight(170)(k), hinted: false })],
    ];
    for (const [name, truth] of cases) {
      const all = play(truth, { ticks: 100 });
      const { remote } = all;
      // The first three patches of the stale case carry a hint of their own: from then on it is another patch's.
      const frames = all.frames.filter((f) => f.newest.t > 1000 + 3 * PATCH_MS);
      for (const f of frames) expect(f.x - f.newest.x, name).toBeLessThanOrEqual(1e-6);
      expect(frames.every((f) => f.info!.aheadMs === 0), name).toBe(true);
      expect(remote.stats.snaps, name).toBe(0);
    }
  });

  it("never past newest + EXTRAPOLATE_MS, and never more than REMOTE_MAX_AHEAD_U past the newest sample, at 255 and 340 u/s", () => {
    for (const speed of [170, 255, 340]) {
      const { frames } = play(straight(speed), { ticks: 100, jitter: 20 });
      for (const f of frames) {
        expect(f.info!.aheadMs).toBeLessThanOrEqual(EXTRAPOLATE_MS + 1e-9);
        expect(f.x - f.newest.x, `${speed}`).toBeLessThanOrEqual(REMOTE_MAX_AHEAD_U + 1e-6);
      }
      expect(frames.some((f) => f.info!.aheadMs > 0)).toBe(true);
    }
  });

  it("a stop it did not know of: an overshoot of one tick's walk at most, then straight back, never past the truth, never alternating", () => {
    for (const hz of [60, 144]) {
      const K = 60;
      const stopX = 1000 + 170 * (K - 1) * PATCH_MS / 1000;
      const { frames, remote } = play((k) => (k < K ? straight(170)(k) : { x: stopX, y: 2500, walkTicks: 0 }), { ticks: 100, hz });
      const over = frames.map((f) => f.x - stopX);
      const peak = over.indexOf(Math.max(...over));
      expect(over[peak]!, `${hz} Hz`).toBeGreaterThan(1);
      expect(over[peak]!, `${hz} Hz`).toBeLessThanOrEqual(Math.min(170 * EXTRAPOLATE_MS / 1000, REMOTE_MAX_AHEAD_U) + 1e-6);
      for (let k = peak + 1; k < frames.length; k++) {
        expect(frames[k]!.x, `${hz} Hz frame ${k}`).toBeLessThanOrEqual(frames[k - 1]!.x + 1e-9);
        expect(frames[k]!.x, `${hz} Hz frame ${k}`).toBeGreaterThanOrEqual(stopX - 1e-9);
      }
      expect(frames[frames.length - 1]!.x).toBeCloseTo(stopX, 3);
      expect(remote.stats.snaps).toBe(0);
      expect(remote.stats.reversals).toBe(0);
    }
  });

  it("a walker that slows (a chill) drawn ahead of where it is: pulled back slower than it walks, never turned round", () => {
    for (const hz of [60, 144]) {
      let x = 1000;
      const xs: number[] = [];
      for (let k = 0; k < 120; k++) { xs.push(x); x += (k < 50 ? 255 : 120) * PATCH_MS / 1000; }
      const { frames } = play((k) => ({ x: xs[k]!, y: 2500, walkDir: 0, walkTicks: 3 }), { ticks: 120, hz });
      for (let k = 1; k < frames.length; k++) expect(frames[k]!.x - frames[k - 1]!.x, `${hz} Hz frame ${k}`).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it("tap-strafing (a reversal every 250 ms) at 170 and 340 u/s with the hint: no snap, p99 error under 17 u", () => {
    for (const speed of [170, 340]) {
      for (const hz of [60, 144]) {
        let x = 1000;
        const xs: number[] = [];
        const dirs: number[] = [];
        for (let k = 0; k < 200; k++) {
          const sign = Math.floor(k / 5) % 2 === 0 ? 1 : -1;
          xs.push(x);
          dirs.push(sign > 0 ? 0 : Math.PI);
          x += sign * speed * PATCH_MS / 1000;
        }
        const run = play((k) => ({ x: xs[k]!, y: 2500, walkDir: encodeWalkDir(dirs[k]!), walkTicks: 3 }), { ticks: 200, hz });
        const errs = run.judged().map(run.err);
        expect(run.remote.stats.snaps, `${speed} u/s ${hz} Hz`).toBe(0);
        expect(pct(errs, 0.99), `${speed} u/s ${hz} Hz`).toBeLessThan(17);
      }
    }
  });
});

describe("RemoteDraw, a mover with no hint (held)", () => {
  it("is bounded and never snaps, at 170 and 255 u/s and 60, 120 and 144 Hz, and its catch-up never steps against the walk", () => {
    for (const speed of [170, 255]) {
      for (const hz of [60, 120, 144]) {
        const { frames, remote } = play(straight(speed, 0, () => 0), { ticks: 120, hz });
        const s = settled(frames);
        const worst = Math.max(...s.map((f) => f.info!.offset));
        expect(remote.stats.snaps, `${speed} u/s ${hz} Hz`).toBe(0);
        expect(worst, `${speed} u/s ${hz} Hz`).toBeLessThan(24);
        if (speed === 170 && hz === 144) expect(worst).toBeLessThan(12);
        for (let k = 1; k < frames.length; k++) expect(frames[k]!.x - frames[k - 1]!.x, `${speed} ${hz} ${k}`).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });

  it("with heldMoverMs 25 (measurement only) the same tracks' mean error is under 6 u", () => {
    for (const speed of [170, 255]) {
      const run = play(straight(speed, 0, () => 0), { ticks: 120, hz: 60, options: { heldMoverMs: 25 } });
      expect(mean(run.judged().map(run.err)), `${speed}`).toBeLessThan(6);
      expect(run.remote.stats.snaps).toBe(0);
    }
  });
});

describe("RemoteDraw, cuts and snaps", () => {
  it("a displaceSeq change: while it is pending the fighter stands exactly where it was drawn; at the cut it is sample() with no offset", () => {
    const K = 60;
    const run = play((k) => (k < K ? straight(170)(k) : { x: 1600, y: 2700, displaceSeq: 1, walkTicks: 0 }), { ticks: 90 });
    const cutT = 1000 + K * PATCH_MS;
    const arrived = run.frames.findIndex((f) => f.newest.t === cutT);
    const crossed = run.frames.findIndex((f) => f.r >= cutT);
    expect(arrived).toBeGreaterThan(0);
    expect(crossed).toBeGreaterThan(arrived);
    for (let k = arrived; k < crossed; k++) {
      expect(run.frames[k]!.x).toBe(run.frames[arrived]!.x);
      expect(run.frames[k]!.y).toBe(run.frames[arrived]!.y);
    }
    const c = run.frames[crossed]!;
    expect({ x: c.x, y: c.y }).toEqual({ x: 1600, y: 2700 });
    expect(c.info!.offset).toBe(0);
    expect(run.remote.stats.cutsCrossed).toBe(1);
    expect(run.remote.stats.frozenFrames).toBeGreaterThan(0);
  });

  it("a teleport's cut: held still from its fx, through its patch, until render time reaches it", () => {
    const K = 60;
    const run = play((k) => (k < K ? straight(170)(k) : { x: 3000, y: 3000, walkTicks: 0 }), { ticks: 90, teleport: (k) => k === K });
    const cutT = 1000 + K * PATCH_MS;
    const crossed = run.frames.findIndex((f) => f.r >= cutT);
    const arrived = run.frames.findIndex((f) => f.newest.t === cutT);
    for (let k = arrived; k < crossed; k++) expect(run.frames[k]!.x).toBe(run.frames[arrived]!.x);
    expect(run.frames[crossed]!.x).toBe(3000);
    expect(run.remote.stats.snaps).toBe(0);
  });

  it("a jump the server made without a cut, past 32 u, snaps once; nothing under 32 u is ever reset", () => {
    const K = 60;
    const run = play((k) => ({ x: k < K ? 1000 : 1150, y: 2500, walkTicks: 0 }), { ticks: 90 });
    expect(run.remote.stats.snaps).toBe(1);
    expect(run.remote.stats.resetsUnderSnap).toBe(0);
    expect(run.frames[run.frames.length - 1]!.x).toBe(1150);
  });
});

describe("RemoteDraw, roots and deaths", () => {
  it("the stun, rooted and casting bits hold it", () => {
    for (const bit of [EFFECT_STUNNED, EFFECT_ROOTED, EFFECT_CASTING]) {
      const { frames } = play((k) => ({ ...straight(170)(k), effects: bit }), { ticks: 60 });
      expect(frames.every((f) => f.info!.aheadMs === 0), String(bit)).toBe(true);
    }
  });

  it("a stun status fx stops the walk from its start", () => {
    const T = 1000 + 40 * PATCH_MS;
    const { frames } = play(straight(170), { ticks: 80, fx: (k) => (k === 40 ? [{ kind: "status", id: ID, status: "stun", ms: 600, by: null }] : []) });
    for (const f of frames) {
      if (f.newest.t >= T && f.newest.t < T + 600) expect(f.info!.aheadMs).toBe(0);
      else if (f.newest.t < T) expect(f.newest.t + f.info!.aheadMs).toBeLessThanOrEqual(T + 1e-6);
    }
  });

  it("a wand windup fx stops it where the release pause starts (t + ms - 200); a cancel fx clears it", () => {
    const T = 1000 + 40 * PATCH_MS;
    const windup = (k: number): FxEvent[] => (k === 40 ? [{ kind: "windup", by: ID, weapon: "wand", a: 0, ms: 450 }] : []);
    const held = play(straight(170), { ticks: 80, fx: windup });
    let reached = false;
    for (const f of held.frames) {
      if (f.newest.t >= T + 250 && f.newest.t < T + 450) expect(f.info!.aheadMs).toBe(0);
      else if (f.newest.t < T + 250) expect(f.newest.t + f.info!.aheadMs).toBeLessThanOrEqual(T + 250 + 1e-6);
      if (f.newest.t + f.info!.aheadMs > T + 200) reached = true;
    }
    expect(reached).toBe(true);
    const cancelled = play(straight(170), { ticks: 80, fx: (k) => (k === 42 ? [{ kind: "cancel", id: ID }] : windup(k)) });
    expect(cancelled.frames.some((f) => f.newest.t < T + 450 && f.newest.t + f.info!.aheadMs > T + 250)).toBe(true);
  });

  it("a death holds it from the death on", () => {
    const T = 1000 + 40 * PATCH_MS;
    // The patch of the death's own tick shows it dead (a training revive in that tick would show it alive, and hold nothing).
    const { frames } = play((k) => ({ ...straight(170)(k), status: k >= 40 ? "dead" : "alive" }), {
      ticks: 70, fx: (k) => (k === 40 ? [{ kind: "death", id: ID, x: 0, y: 0, by: null }] : []),
    });
    for (const f of frames) if (f.newest.t >= T) expect(f.info!.aheadMs).toBe(0);
  });

  it("walking into a wall on a hint that says it walks on: every drawn position is clear of the wall", () => {
    const map = roomMap(160, 160, (tx) => tx === 40);
    const wallX = 40 * TILE - PLAYER_RADIUS;
    const run = play((k) => ({ x: Math.min(wallX, 1000 + 170 * k * PATCH_MS / 1000), y: 2500, walkDir: 0, walkTicks: 3 }), { ticks: 90, map });
    for (const f of run.frames) expect(circleClear(map, f, PLAYER_RADIUS - 1), `x ${f.x} y ${f.y} newest ${f.newest.x} ahead ${f.info!.aheadMs} off ${f.info!.offset}`).toBe(true);
    expect(Math.max(...run.frames.map((f) => f.x))).toBeGreaterThan(wallX - 1.5);
  });
});

describe("RemoteDraw, mobs", () => {
  it("a moving mob walks on by its own velocity for at most MOB_EXTRAPOLATE_MS; one drawing a bow holds", () => {
    const run = play(straight(170, 1.1, () => 0), { ticks: 80, kind: "mob" });
    expect(Math.max(...run.frames.map((f) => f.info!.aheadMs))).toBeGreaterThan(MOB_EXTRAPOLATE_MS - 1);
    for (const f of run.frames) expect(f.info!.aheadMs).toBeLessThanOrEqual(MOB_EXTRAPOLATE_MS + 1e-9);
    expect(mean(run.judged().map(run.err))).toBeLessThan(1);
    const drawing = play((k) => ({ ...straight(170, 1.1)(k), drawStartedAt: 900 }), { ticks: 60, kind: "mob" });
    expect(drawing.frames.every((f) => f.info!.aheadMs === 0)).toBe(true);
  });
});

describe("RemoteDraw, the model and the frame", () => {
  it("modelAt is the draw-ahead's own position, without the correction offset", () => {
    let checked = 0;
    play(straight(170, 0, () => 0), {
      ticks: 80,
      onFrame: (f, { remote }) => {
        if (f.info!.offset < 1 || f.r <= f.newest.t) return;
        const m = { x: 0, y: 0 };
        expect(remote.modelAt(ID, f.r, m)).toBe(true);
        // Held (no hint): the model stands at the newest sample, and the offset is what is drawn on top of it.
        expect(m).toEqual({ x: f.newest.x, y: f.newest.y });
        expect(Math.hypot(f.x - m.x, f.y - m.y)).toBeCloseTo(f.info!.offset, 6);
        checked++;
      },
    });
    expect(checked).toBeGreaterThan(10);
  });

  it("beginFrame with an unchanged render time decays nothing", () => {
    let checked = 0;
    play(straight(170, 0, () => 0), {
      ticks: 80,
      onFrame: (f, { remote }) => {
        if (f.info!.offset < 1 || checked > 20) return;
        const out = { x: 0, y: 0 };
        remote.beginFrame(OPEN, f.r);
        remote.draw(ID, "player", { x: f.newest.x, y: f.newest.y, status: "alive", effects: 0 }, f.r, out);
        expect(out).toEqual({ x: f.x, y: f.y });
        checked++;
      },
    });
    expect(checked).toBeGreaterThan(10);
  });

  it("turned off mid-walk: draws ahead until the delay is back at the floor, then is sample() exactly; render time never reverses", () => {
    const toggleAt = 3000;
    let off = false;
    let drainedAt = Infinity;
    let prevR = -Infinity;
    let aheadWhileDraining = 0;
    let exact = 0;
    play(straight(170), {
      ticks: 160,
      onFrame: (f, { remote, interp, now }) => {
        expect(f.r).toBeGreaterThanOrEqual(prevR);
        prevR = f.r;
        if (!off && now >= toggleAt) { remote.setEnabled(false); off = true; return; }
        if (!off) return;
        if (f.info && f.info.aheadMs > 0) aheadWhileDraining++;
        if (!Number.isFinite(drainedAt) && interp.delayMs >= MIN_INTERP_DELAY_MS - 0.5) drainedAt = now;
        if (now > drainedAt + 20) {
          const a = { x: 0, y: 0 };
          const b = { x: 0, y: 0 };
          remote.draw(ID, "player", { x: 0, y: 0, status: "alive", effects: 0 }, f.r, a);
          interp.sample(ID, f.r, b);
          expect(a).toEqual(b);
          exact++;
        }
      },
    });
    expect(aheadWhileDraining).toBeGreaterThan(0);
    expect(drainedAt - toggleAt).toBeLessThan(1500);
    expect(exact).toBeGreaterThan(100);
  });
});
