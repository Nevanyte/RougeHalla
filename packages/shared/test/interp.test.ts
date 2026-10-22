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
    expect(c.now(1234)).toBe(1234);
    expect(c.renderTime(1234)).toBe(1234 - INTERP_DELAY_MS);
  });

  it("snaps to the first observation exactly", () => {
    const c = new ServerClock();
    c.observe(1000, 400); // offset 600
    expect(c.synced).toBe(true);
    expect(c.now(500)).toBe(1100);
  });

  it("smooths small deviations with an EMA", () => {
    const c = new ServerClock(0.1, 250);
    c.observe(1000, 400); // offset 600
    c.observe(1050 + 600 + 50, 1050); // sample offset 650: +50 -> +5
    expect(c.now(0)).toBeCloseTo(605, 9);
    c.observe(1100 + 600 + 50, 1100); // sample 650 again: 605 + 45*0.1
    expect(c.now(0)).toBeCloseTo(609.5, 9);
  });

  it("resyncs hard when the deviation exceeds the threshold", () => {
    const c = new ServerClock(0.1, 250);
    c.observe(1000, 400); // 600
    c.observe(2000 + 600 + 251, 2000); // offset 851: > 250 away
    expect(c.now(0)).toBe(851);
  });

  it("smooths (does not resync) at exactly the threshold", () => {
    const c = new ServerClock(0.1, 250);
    c.observe(1000, 400); // 600
    c.observe(2000 + 850, 2000); // offset 850: exactly 250 away
    expect(c.now(0)).toBeCloseTo(625, 9);
  });

  it("resyncs on large negative deviations too", () => {
    const c = new ServerClock(0.1, 250);
    c.observe(1000, 400); // 600
    c.observe(5000 + 100, 5000); // offset 100: 500 below
    expect(c.now(0)).toBe(100);
  });

  it("supports negative offsets (local clock ahead of server)", () => {
    const c = new ServerClock();
    c.observe(100, 5000);
    expect(c.now(5050)).toBe(150);
  });

  it("honours custom smoothing and threshold", () => {
    const c = new ServerClock(0.5, 10);
    c.observe(100, 0); // 100
    c.observe(108, 0); // 8 away: smoothed by 0.5 -> 104
    expect(c.now(0)).toBeCloseTo(104, 9);
    c.observe(200, 0); // 96 away > 10: resync
    expect(c.now(0)).toBe(200);
  });

  it("converges to a new steady offset and keeps now() monotonic in localNow", () => {
    const c = new ServerClock(0.1, 250);
    c.observe(0, 0);
    for (let i = 1; i <= 200; i++) c.observe(i * 50 + 100, i * 50); // steady +100 offset
    expect(c.now(0)).toBeCloseTo(100, 3);
    expect(c.now(1000)).toBeLessThan(c.now(1001));
  });

  it("settles on the late edge of symmetric jitter instead of the mean (min filter)", () => {
    const c = new ServerClock(0.1, 250);
    c.observe(500, 0); // true offset 500
    const seen: number[] = [];
    for (let i = 1; i <= 400; i++) {
      const jitter = i % 2 === 0 ? 20 : -20; // arrival delay error, ms
      c.observe(i * 50 + 500, i * 50 + jitter); // sample offset: 520 on odd i (early), 480 on even i (late)
      seen.push(c.now(0));
    }
    // Every late patch snaps to 480; every early patch only creeps 10% of the way back up (484).
    for (const offset of seen.slice(2)) {
      expect(offset).toBeGreaterThanOrEqual(480 - 1e-9);
      expect(offset).toBeLessThanOrEqual(484 + 1e-9);
    }
    expect(c.now(0)).toBeCloseTo(480, 9); // the last patch (i = 400) was a late one
    expect(c.now(0)).toBeLessThan(500); // not the mean of the jitter
  });

  describe("late vs. early patches (min filter with slow upward drift)", () => {
    // A sample is serverTime - localNow; with localNow = 0 it is the serverTime itself.
    const clockAt600 = (smoothing = 0.1, threshold = 250) => {
      const c = new ServerClock(smoothing, threshold);
      c.observe(600, 0);
      return c;
    };

    it("a late patch (smaller sample) lowers the offset immediately and exactly", () => {
      const c = clockAt600();
      c.observe(560, 0);
      expect(c.now(0)).toBe(560);
      c.observe(559.5, 0);
      expect(c.now(0)).toBe(559.5);
    });

    it("an early patch (larger sample) moves the offset up by only `smoothing` of the gap", () => {
      const c = clockAt600();
      c.observe(640, 0);
      expect(c.now(0)).toBeCloseTo(604, 9);
      const c2 = clockAt600(0.5);
      c2.observe(640, 0);
      expect(c2.now(0)).toBeCloseTo(620, 9);
    });

    it("equal-sized deviations are asymmetric: down is immediate, up is damped", () => {
      const late = clockAt600();
      const early = clockAt600();
      late.observe(600 - 40, 0);
      early.observe(600 + 40, 0);
      expect(600 - late.now(0)).toBeCloseTo(40, 9);
      expect(early.now(0) - 600).toBeCloseTo(4, 9);
    });

    it("an identical sample leaves the offset where it is", () => {
      const c = clockAt600();
      c.observe(600, 0);
      expect(c.now(0)).toBe(600);
    });

    it("after a late patch, early patches creep back up geometrically and never overshoot", () => {
      const c = clockAt600();
      c.observe(560, 0); // late: 560
      let prev = c.now(0);
      for (let n = 1; n <= 60; n++) {
        c.observe(600, 0); // the network is back to normal
        const cur = c.now(0);
        expect(cur).toBeGreaterThan(prev);
        expect(cur).toBeLessThanOrEqual(600);
        expect(cur).toBeCloseTo(600 - 40 * 0.9 ** n, 9);
        prev = cur;
      }
    });

    it("one late patch dominates a long run of on-time ones for a while", () => {
      const c = clockAt600();
      c.observe(570, 0);
      for (let n = 0; n < 5; n++) c.observe(600, 0);
      // 5 steps of 10%: still ~41% of the gap remains
      expect(600 - c.now(0)).toBeCloseTo(30 * 0.9 ** 5, 9);
      expect(c.now(0)).toBeLessThan(590);
    });

    it("small early spikes barely move it; only an early spike beyond the threshold resyncs", () => {
      const c = clockAt600(0.1, 250);
      c.observe(600 + 200, 0); // 200 early: within threshold
      expect(c.now(0)).toBeCloseTo(620, 9);
      const d = clockAt600(0.1, 250);
      d.observe(600 + 251, 0); // beyond threshold: hard resync upward
      expect(d.now(0)).toBe(851);
    });

    it("a late patch within the threshold and one beyond it both land exactly on the sample", () => {
      const near = clockAt600(0.1, 250);
      near.observe(600 - 249, 0);
      expect(near.now(0)).toBe(351);
      const far = clockAt600(0.1, 250);
      far.observe(600 - 251, 0);
      expect(far.now(0)).toBe(349);
    });

    it("never estimates a server time ahead of the newest patch it has seen (no starving)", () => {
      const rng = mulberry(4242);
      const c = new ServerClock(0.1, 250);
      for (let i = 0; i < 500; i++) {
        const serverTime = 1000 + i * 50;
        // Arrival delay: mostly small, with occasional spikes; always >= 0.
        const delay = 20 + (rng() < 0.1 ? rng() * 120 : rng() * 15);
        const localNow = serverTime + delay - 700; // arbitrary local epoch
        c.observe(serverTime, localNow);
        expect(c.now(localNow)).toBeLessThanOrEqual(serverTime + 1e-9);
      }
    });

    it("a delay spike is absorbed immediately, then forgotten slowly", () => {
      const c = new ServerClock(0.1, 250);
      const feed = (i: number, delay: number) => c.observe(i * 50, i * 50 + delay);
      for (let i = 0; i < 20; i++) feed(i, 10); // steady: offset -10
      expect(c.now(0)).toBeCloseTo(-10, 9);
      feed(20, 90); // a patch arrives 80ms later than usual
      expect(c.now(0)).toBeCloseTo(-90, 9);
      feed(21, 10); // back to normal: only 10% of the gap recovered
      expect(c.now(0)).toBeCloseTo(-82, 9);
    });
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
