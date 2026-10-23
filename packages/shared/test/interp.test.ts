import { describe, expect, it } from "vitest";
import { INTERP_DELAY_MS, ServerClock, SnapshotBuffer, TELEPORT_DISTANCE } from "../src/index";

const out = () => ({ x: NaN, y: NaN });

describe("SnapshotBuffer", () => {
  describe("empty / single sample", () => {
    it("reports no data and leaves `out` untouched when empty", () => {
      const b = new SnapshotBuffer();
      const o = { x: 7, y: 8 };
      expect(b.sample(100, o)).toBe(false);
      expect(o).toEqual({ x: 7, y: 8 });
      expect(b.size).toBe(0);
      expect(b.latest).toBeUndefined();
    });

    it("holds the only sample for any query time", () => {
      const b = new SnapshotBuffer();
      b.push(100, 5, 6);
      for (const t of [-1000, 0, 100, 5000]) {
        const o = out();
        expect(b.sample(t, o)).toBe(true);
        expect(o).toEqual({ x: 5, y: 6 });
      }
    });

    it("clear() empties the buffer and it is reusable afterwards", () => {
      const b = new SnapshotBuffer();
      b.push(0, 1, 1);
      b.push(50, 2, 2);
      b.clear();
      expect(b.size).toBe(0);
      expect(b.sample(25, out())).toBe(false);
      // An older timestamp than the cleared data must be accepted again.
      b.push(10, 9, 9);
      expect(b.size).toBe(1);
      expect(b.latest).toEqual({ t: 10, x: 9, y: 9 });
    });

    it("clear() forgets a pending cut, so the next push is not judged against old data", () => {
      const b = new SnapshotBuffer();
      b.push(0, 0, 0);
      b.push(50, 5000, 0); // cut
      b.clear();
      b.push(100, -3000, 0); // would be a teleport relative to the old samples
      expect(b.size).toBe(1);
      expect(b.latest!.cut).toBeFalsy();
      const o = out();
      b.sample(0, o);
      expect(o).toEqual({ x: -3000, y: 0 });
    });
  });

  describe("interpolation", () => {
    it("lerps linearly between the bracketing samples", () => {
      const b = new SnapshotBuffer();
      b.push(0, 0, 0);
      b.push(100, 100, 120); // |d| ~= 156, under the teleport threshold
      const o = out();
      b.sample(50, o);
      expect(o).toEqual({ x: 50, y: 60 });
      b.sample(25, o);
      expect(o.x).toBeCloseTo(25);
      expect(o.y).toBeCloseTo(30);
    });

    it("returns the exact sample when t lands on a sample time", () => {
      const b = new SnapshotBuffer();
      b.push(0, 0, 0);
      b.push(50, 10, 20);
      b.push(100, 30, 60);
      const o = out();
      b.sample(50, o);
      expect(o).toEqual({ x: 10, y: 20 });
    });

    it("picks the correct segment among several, including uneven spacing", () => {
      const b = new SnapshotBuffer();
      b.push(0, 0, 0);
      b.push(50, 50, 0);
      b.push(60, 50, 100); // short, fast segment
      b.push(200, 190, 100);
      const o = out();
      // Ascending query times, like a render clock (sampling prunes older history).
      b.sample(25, o); // first segment
      expect(o.x).toBeCloseTo(25);
      expect(o.y).toBeCloseTo(0);
      b.sample(55, o); // short segment
      expect(o.x).toBeCloseTo(50);
      expect(o.y).toBeCloseTo(50);
      b.sample(130, o); // halfway through the last segment (60..200)
      expect(o.x).toBeCloseTo(50 + 140 * 0.5);
      expect(o.y).toBeCloseTo(100);
    });

    it("clamps to the oldest sample before the buffer starts", () => {
      const b = new SnapshotBuffer();
      b.push(100, 10, 10);
      b.push(200, 20, 20);
      const o = out();
      b.sample(0, o);
      expect(o).toEqual({ x: 10, y: 10 });
    });

    it("holds the newest sample when starved (no extrapolation)", () => {
      const b = new SnapshotBuffer();
      b.push(0, 0, 0);
      b.push(100, 100, 0);
      const o = out();
      b.sample(100, o);
      expect(o).toEqual({ x: 100, y: 0 });
      b.sample(100_000, o);
      expect(o).toEqual({ x: 100, y: 0 });
    });

    it("handles negative coordinates and decreasing motion", () => {
      const b = new SnapshotBuffer();
      b.push(0, 60, -60);
      b.push(100, -60, 60);
      const o = out();
      b.sample(50, o);
      expect(o.x).toBeCloseTo(0);
      expect(o.y).toBeCloseTo(0);
    });
  });

  describe("push ordering", () => {
    it("ignores out-of-order samples", () => {
      const b = new SnapshotBuffer();
      b.push(100, 1, 1);
      b.push(50, 99, 99);
      expect(b.size).toBe(1);
      expect(b.latest).toEqual({ t: 100, x: 1, y: 1 });
    });

    it("does not let an out-of-order sample trigger a teleport cut", () => {
      const b = new SnapshotBuffer();
      b.push(0, 0, 0);
      b.push(100, 10, 0);
      b.push(50, 5000, 5000); // stale and far away
      expect(b.size).toBe(2);
      expect(b.latest).toEqual({ t: 100, x: 10, y: 0 });
      expect(b.latest!.cut).toBeFalsy();
      const o = out();
      b.sample(50, o);
      expect(o.x).toBeCloseTo(5);
    });

    it("overwrites in place on a duplicate timestamp", () => {
      const b = new SnapshotBuffer();
      b.push(0, 0, 0);
      b.push(100, 10, 10);
      b.push(100, 30, 40);
      expect(b.size).toBe(2);
      expect(b.latest).toEqual({ t: 100, x: 30, y: 40 });
      expect(b.latest!.cut).toBeFalsy();
      const o = out();
      b.sample(50, o);
      expect(o).toEqual({ x: 15, y: 20 });
    });

    it("a duplicate timestamp on a lone sample just replaces it (nothing to teleport from)", () => {
      const b = new SnapshotBuffer();
      b.push(100, 0, 0);
      b.push(100, 5000, 5000);
      expect(b.size).toBe(1);
      expect(b.latest).toEqual({ t: 100, x: 5000, y: 5000 });
      expect(b.latest!.cut).toBeFalsy();
    });
  });

  // A teleport is a cut: the entity holds its pre-teleport position until render time reaches the
  // cut sample's timestamp, then snaps. History before the previous sample is dropped.
  describe("teleports (cut)", () => {
    const FAR = 10 + TELEPORT_DISTANCE + 1;

    /** (0,0) -> (10,0) -> cut to (FAR,0) at t=100. */
    const cutBuffer = () => {
      const b = new SnapshotBuffer();
      b.push(0, 0, 0);
      b.push(50, 10, 0);
      b.push(100, FAR, 0);
      return b;
    };

    it("keeps only the pre-teleport sample and stores the new one with cut: true", () => {
      const b = cutBuffer();
      expect(b.size).toBe(2);
      expect(b.latest).toEqual({ t: 100, x: FAR, y: 0, cut: true });
      // The (0,0) history is gone: the oldest retained sample is the pre-teleport one.
      const o = out();
      b.sample(0, o);
      expect(o).toEqual({ x: 10, y: 0 });
    });

    it("does not flag ordinary samples as cuts", () => {
      const b = new SnapshotBuffer();
      b.push(0, 0, 0);
      b.push(50, 10, 0);
      expect(b.latest!.cut).toBeFalsy();
    });

    it("holds the pre-teleport position for any render time before the cut sample", () => {
      const b = cutBuffer();
      const o = out();
      for (const t of [-100, 0, 50, 51, 75, 99, 99.999]) {
        expect(b.sample(t, o)).toBe(true);
        expect(o).toEqual({ x: 10, y: 0 });
      }
    });

    it("snaps to the new position exactly at the cut time and stays there", () => {
      const b = cutBuffer();
      const o = out();
      for (const t of [100, 100.001, 150, 1e6]) {
        expect(b.sample(t, o)).toBe(true);
        expect(o).toEqual({ x: FAR, y: 0 });
      }
    });

    it("never produces a position between the two ends of the cut", () => {
      const b = cutBuffer();
      const o = out();
      for (let t = 0; t <= 200; t += 0.5) {
        b.sample(t, o);
        expect([10, FAR]).toContain(o.x);
        expect(o.y).toBe(0);
      }
    });

    it("resumes normal lerping between two post-cut samples", () => {
      const b = cutBuffer();
      b.push(150, FAR + 10, 0);
      b.push(200, FAR + 30, 20);
      const o = out();
      // Ascending render times, like a real clock (sampling prunes older history).
      b.sample(75, o); // still before the cut
      expect(o).toEqual({ x: 10, y: 0 });
      b.sample(100, o); // the cut itself
      expect(o).toEqual({ x: FAR, y: 0 });
      b.sample(125, o); // halfway between the cut sample and the next one: a lerp, not a hold
      expect(o.x).toBeCloseTo(FAR + 5);
      expect(o.y).toBeCloseTo(0);
      b.sample(150, o);
      expect(o).toEqual({ x: FAR + 10, y: 0 });
      b.sample(175, o);
      expect(o.x).toBeCloseTo(FAR + 20);
      expect(o.y).toBeCloseTo(10);
    });

    it("holds the cut destination when starved right after the cut (no extrapolation)", () => {
      const b = cutBuffer();
      const o = out();
      b.sample(100_000, o);
      expect(o).toEqual({ x: FAR, y: 0 });
    });

    it("handles two teleports in a row: only the latest pre-teleport sample survives", () => {
      const b = new SnapshotBuffer();
      b.push(0, 0, 0);
      b.push(50, 1000, 0); // cut #1
      b.push(100, 2000, 500); // cut #2, before render time ever reached cut #1
      expect(b.size).toBe(2);
      expect(b.latest).toEqual({ t: 100, x: 2000, y: 500, cut: true });
      const o = out();
      // Cut #2 holds the previous sample (cut #1's destination) and snaps at t=100.
      for (const t of [50, 51, 75, 99.9]) {
        b.sample(t, o);
        expect(o).toEqual({ x: 1000, y: 0 });
      }
      b.sample(100, o);
      expect(o).toEqual({ x: 2000, y: 500 });
      // Never an interpolated position anywhere on the way.
      for (let t = 50; t <= 150; t += 0.5) {
        b.sample(t, o);
        expect([1000, 2000]).toContain(o.x);
      }
    });

    it("after two teleports in a row, normal lerping resumes from the second destination", () => {
      const b = new SnapshotBuffer();
      b.push(0, 0, 0);
      b.push(50, 1000, 0);
      b.push(100, 2000, 500);
      b.push(150, 2010, 500);
      const o = out();
      b.sample(125, o);
      expect(o.x).toBeCloseTo(2005);
      expect(o.y).toBeCloseTo(500);
    });

    it("keeps working across teleports separated by normal movement", () => {
      const b = new SnapshotBuffer();
      const o = out();
      b.push(0, 0, 0);
      b.push(50, 1000, 0); // cut
      b.push(100, 1010, 0); // normal
      b.sample(75, o); // 1000 -> 1010 lerp
      expect(o.x).toBeCloseTo(1005);
      b.push(150, -500, 800); // second cut
      b.sample(125, o); // before it: hold the pre-teleport sample
      expect(o).toEqual({ x: 1010, y: 0 });
      b.push(200, -490, 800); // normal again
      b.sample(150, o);
      expect(o).toEqual({ x: -500, y: 800 });
      b.sample(175, o);
      expect(o.x).toBeCloseTo(-495);
      expect(o.y).toBeCloseTo(800);
    });

    it("treats a jump of exactly teleportDistance as normal movement", () => {
      const b = new SnapshotBuffer();
      b.push(0, 0, 0);
      b.push(50, TELEPORT_DISTANCE, 0);
      expect(b.size).toBe(2);
      expect(b.latest!.cut).toBeFalsy();
      const o = out();
      b.sample(25, o);
      expect(o.x).toBeCloseTo(TELEPORT_DISTANCE / 2);
    });

    it("measures the jump as euclidean distance (diagonal counts)", () => {
      const b = new SnapshotBuffer(40, 100);
      b.push(0, 0, 0);
      b.push(50, 70, 70); // |(70,70)| ~= 98.99 < 100
      expect(b.latest!.cut).toBeFalsy();
      b.push(100, 70 + 80, 70 + 80); // |(80,80)| ~= 113 > 100
      expect(b.latest).toEqual({ t: 100, x: 150, y: 150, cut: true });
      const o = out();
      b.sample(75, o);
      expect(o).toEqual({ x: 70, y: 70 });
      b.sample(100, o);
      expect(o).toEqual({ x: 150, y: 150 });
    });

    it("honours a custom teleportDistance", () => {
      const b = new SnapshotBuffer(40, 10);
      b.push(0, 0, 0);
      b.push(50, 10, 0); // exactly 10: still normal
      expect(b.latest!.cut).toBeFalsy();
      b.push(100, 21, 0); // 11 away
      expect(b.latest).toEqual({ t: 100, x: 21, y: 0, cut: true });
      const o = out();
      b.sample(75, o);
      expect(o).toEqual({ x: 10, y: 0 });
    });

    it("keeps default TELEPORT_DISTANCE semantics when constructed with only maxSamples", () => {
      const b = new SnapshotBuffer(5);
      b.push(0, 0, 0);
      b.push(50, TELEPORT_DISTANCE - 1, 0);
      expect(b.latest!.cut).toBeFalsy();
      b.push(100, TELEPORT_DISTANCE - 1 + TELEPORT_DISTANCE + 1, 0);
      expect(b.latest!.cut).toBe(true);
    });

    describe("same-timestamp pushes re-run the teleport rule against the sample before", () => {
      // Regression: a same-timestamp overwrite used to skip the teleport check and get lerped across.
      it("a far replacement of a near sample becomes a cut: hold, then snap", () => {
        const b = new SnapshotBuffer();
        b.push(0, 0, 0);
        b.push(50, 10, 0);
        b.push(50, 5000, 0);
        expect(b.size).toBe(2);
        expect(b.latest).toEqual({ t: 50, x: 5000, y: 0, cut: true });
        const o = out();
        b.sample(25, o);
        expect(o).toEqual({ x: 0, y: 0 });
        b.sample(49.9, o);
        expect(o).toEqual({ x: 0, y: 0 });
        b.sample(50, o);
        expect(o).toEqual({ x: 5000, y: 0 });
      });

      it("a near replacement of a cut sample cancels the cut and lerping resumes", () => {
        const b = new SnapshotBuffer();
        b.push(0, 0, 0);
        b.push(50, 5000, 0); // cut
        b.push(50, 10, 0); // corrected sample for the same tick
        expect(b.size).toBe(2);
        expect(b.latest!.cut).toBeFalsy();
        const o = out();
        b.sample(25, o);
        expect(o.x).toBeCloseTo(5);
      });

      it("a far replacement of a cut sample is still a cut, now at the new place", () => {
        const b = new SnapshotBuffer();
        b.push(0, 0, 0);
        b.push(50, 5000, 0);
        b.push(50, -7000, 300);
        expect(b.size).toBe(2);
        expect(b.latest).toEqual({ t: 50, x: -7000, y: 300, cut: true });
        const o = out();
        b.sample(25, o);
        expect(o).toEqual({ x: 0, y: 0 });
        b.sample(50, o);
        expect(o).toEqual({ x: -7000, y: 300 });
      });

      it("is judged against the sample before the replaced one, even after an earlier cut", () => {
        const b = new SnapshotBuffer();
        b.push(0, 0, 0);
        b.push(50, 1000, 0); // cut
        b.push(100, 1010, 0); // normal
        b.push(100, 3000, 0); // replacement: 1990 from (50,1000,0) -> cut
        expect(b.size).toBe(2);
        expect(b.latest).toEqual({ t: 100, x: 3000, y: 0, cut: true });
        const o = out();
        b.sample(75, o);
        expect(o).toEqual({ x: 1000, y: 0 });
      });
    });
  });

  describe("capacity and pruning", () => {
    it("caps the buffer at maxSamples, dropping the oldest", () => {
      const b = new SnapshotBuffer(3);
      for (let i = 0; i < 5; i++) b.push(i * 10, i, 0);
      expect(b.size).toBe(3);
      expect(b.latest).toEqual({ t: 40, x: 4, y: 0 });
      const o = out();
      b.sample(0, o); // older than anything retained: oldest retained is t=20
      expect(o).toEqual({ x: 2, y: 0 });
    });

    it("defaults to 40 samples", () => {
      const b = new SnapshotBuffer();
      for (let i = 0; i < 100; i++) b.push(i, i, 0);
      expect(b.size).toBe(40);
      expect(b.latest!.t).toBe(99);
    });

    it("prunes history older than the bracket when sampling near the end, keeping one sample before it", () => {
      const b = new SnapshotBuffer();
      for (let i = 0; i < 10; i++) b.push(i * 10, i * 10, 0);
      const o = out();
      b.sample(85, o); // bracket is t=80..90
      expect(o.x).toBeCloseTo(85);
      expect(b.size).toBe(3); // t=70, 80, 90
      b.sample(75, o); // still resolvable through the retained t=70 sample
      expect(o.x).toBeCloseTo(75);
    });

    it("does not prune when the bracket is within the first two segments", () => {
      const b = new SnapshotBuffer();
      for (let i = 0; i < 5; i++) b.push(i * 10, i * 10, 0);
      b.sample(15, out());
      expect(b.size).toBe(5);
    });

    it("pruning never changes the interpolated result for monotonic render times", () => {
      const rng = mulberry(12345);
      const pruned = new SnapshotBuffer(1000);
      const reference: Array<{ t: number; x: number; y: number }> = [];
      let t = 0;
      for (let i = 0; i < 200; i++) {
        t += 40 + Math.floor(rng() * 25); // jittery arrival spacing
        const x = rng() * 100; // stays under TELEPORT_DISTANCE between samples
        const y = rng() * 100;
        pruned.push(t, x, y);
        reference.push({ t, x, y });
      }
      const o = out();
      for (let q = reference[0].t; q < t; q += 7) {
        pruned.sample(q, o);
        const expected = naiveSample(reference, q);
        expect(o.x).toBeCloseTo(expected.x, 9);
        expect(o.y).toBeCloseTo(expected.y, 9);
      }
      expect(pruned.size).toBeLessThan(200);
    });

    it("a cut survives the smallest sensible cap (previous sample + cut)", () => {
      const b = new SnapshotBuffer(2);
      b.push(0, 0, 0);
      b.push(50, 10, 0);
      b.push(100, 5000, 0);
      expect(b.size).toBe(2);
      const o = out();
      b.sample(75, o);
      expect(o).toEqual({ x: 10, y: 0 });
      b.sample(100, o);
      expect(o).toEqual({ x: 5000, y: 0 });
    });

    it("pruning stays invisible across teleports (incremental buffer vs. a fresh replay per query)", () => {
      const rng = mulberry(777);
      const live = new SnapshotBuffer(1000);
      const log: Array<[number, number, number]> = [];
      let t = 0;
      let x = 500;
      let y = 500;
      let q = 0;
      let teleports = 0;
      let compared = 0;
      for (let i = 0; i < 150; i++) {
        t += 40 + Math.floor(rng() * 25);
        if (rng() < 0.12) {
          x = rng() * 2000;
          y = rng() * 2000;
          teleports++;
        } else {
          x += rng() * 60 - 30; // at most ~42 per step, far below TELEPORT_DISTANCE
          y += rng() * 60 - 30;
        }
        live.push(t, x, y);
        log.push([t, x, y]);
        // Render time trails the newest sample and only moves forward.
        while (q < t - 40) {
          q += 7;
          const replay = new SnapshotBuffer(1000);
          for (const [lt, lx, ly] of log) replay.push(lt, lx, ly);
          const expected = out();
          const got = out();
          replay.sample(q, expected);
          live.sample(q, got);
          expect(got).toEqual(expected);
          compared++;
        }
      }
      expect(teleports).toBeGreaterThan(5);
      expect(compared).toBeGreaterThan(100);
      expect(live.size).toBeLessThan(40);
    });

    it("backward scan resolves a query deep in the buffer", () => {
      const b = new SnapshotBuffer();
      for (let i = 0; i < 30; i++) b.push(i * 10, i * 3, 0);
      const o = out();
      b.sample(12, o); // between sample 1 and 2
      expect(o.x).toBeCloseTo(3.6);
    });
  });
});

describe("ServerClock", () => {
  it("is unsynced at first and falls back to the local clock", () => {
    const c = new ServerClock();
    expect(c.synced).toBe(false);
    expect(c.now(123)).toBe(123);
  });

  it("snaps to the first observation exactly", () => {
    const c = new ServerClock();
    c.observe(5000, 1000);
    expect(c.synced).toBe(true);
    expect(c.now(1000)).toBe(5000);
  });

  it("resyncs hard when the deviation exceeds the threshold, in either direction", () => {
    const c = new ServerClock(2, 250, 20);
    c.observe(1000, 0);
    c.observe(1000 + 251, 0); // way early
    expect(c.now(0)).toBe(1251);
    c.observe(1251 - 251, 0); // way late
    expect(c.now(0)).toBe(1000);
  });

  it("supports negative offsets (local clock ahead of server)", () => {
    const c = new ServerClock();
    c.observe(100, 10_000);
    expect(c.now(10_000)).toBe(100);
  });

  it("slews early patches by at most maxSlewMs per observation", () => {
    const c = new ServerClock(2, 250, 20);
    c.observe(0, 0);
    c.observe(50, 0); // 50 ms early
    expect(c.now(0)).toBe(2);
    c.observe(50, 0);
    expect(c.now(0)).toBe(4);
    c.observe(1, 0); // 3 ms behind the estimate of 4: slews down by at most 2
    expect(c.now(0)).toBe(2);
  });

  it("slews small late deviations down gradually but snaps on a clearly late patch", () => {
    const c = new ServerClock(2, 250, 20);
    c.observe(1000, 0);
    c.observe(1000 - 15, 0); // 15 ms late: jitter, slew
    expect(c.now(0)).toBe(998);
    c.observe(1000 - 40, 0); // 38 ms behind the estimate: real lag, snap
    expect(c.now(0)).toBe(960);
  });

  it("converges to a new steady offset and keeps now() monotonic in localNow", () => {
    const c = new ServerClock();
    c.observe(0, 0);
    for (let i = 1; i <= 200; i++) c.observe(i * 50 + 30, i * 50);
    expect(c.now(10_000)).toBeCloseTo(10_030, 6);
    let prev = -Infinity;
    for (let t = 0; t < 1000; t += 7) {
      const n = c.now(t);
      expect(n).toBeGreaterThan(prev);
      prev = n;
    }
  });

  it("keeps the render clock near real time when a step bunches two ticks into one patch", () => {
    // Server interval drifts to ~51.6 ms; every 32nd callback runs two 50 ms steps (one +100 patch).
    const c = new ServerClock();
    const patches: Array<{ t: number; at: number }> = [];
    let serverTime = 0;
    for (let i = 0; i < 300; i++) {
      serverTime += i > 0 && i % 32 === 0 ? 100 : 50;
      patches.push({ t: serverTime, at: i * 51.6 + 5 });
    }
    let p = 0;
    let prevRender: number | null = null;
    let minSpeed = Infinity;
    let maxSpeed = -Infinity;
    const frame = 1000 / 60;
    for (let now = 0; now < 300 * 51.6; now += frame) {
      while (p < patches.length && patches[p]!.at <= now) { c.observe(patches[p]!.t, patches[p]!.at); p++; }
      const r = c.renderTime(now);
      if (prevRender !== null && now > 2000) {
        const speed = (r - prevRender) / frame;
        minSpeed = Math.min(minSpeed, speed);
        maxSpeed = Math.max(maxSpeed, speed);
      }
      prevRender = r;
    }
    expect(maxSpeed).toBeLessThan(1.15);
    expect(minSpeed).toBeGreaterThan(0.85);
  });

  it("never estimates a server time more than lateSnapMs past the newest patch it has seen", () => {
    const rng = mulberry(4242);
    const c = new ServerClock(2, 250, 20);
    for (let i = 0; i < 500; i++) {
      const serverTime = 1000 + i * 50;
      const delay = 20 + (rng() < 0.1 ? rng() * 120 : rng() * 15);
      const localNow = serverTime + delay - 700;
      c.observe(serverTime, localNow);
      expect(c.now(localNow)).toBeLessThanOrEqual(serverTime + 20 + 1e-9);
    }
  });

  it("renderTime lags now by the default interpolation delay or a custom one", () => {
    const c = new ServerClock();
    c.observe(1000, 0);
    expect(c.renderTime(200)).toBe(1200 - INTERP_DELAY_MS);
    expect(c.renderTime(200, 250)).toBe(1200 - 250);
    expect(c.renderTime(200, 0)).toBe(1200);
  });
});

/** Deterministic PRNG so the property test is reproducible. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function naiveSample(
  s: Array<{ t: number; x: number; y: number }>, t: number,
): { x: number; y: number } {
  if (t <= s[0].t) return { x: s[0].x, y: s[0].y };
  const last = s[s.length - 1];
  if (t >= last.t) return { x: last.x, y: last.y };
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i], b = s[i + 1];
    if (t >= a.t && t <= b.t) {
      const k = (t - a.t) / (b.t - a.t);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
  }
  throw new Error("unreachable");
}
