// clicks.ts (docs/BOTS.md 2.3): the port of the client's picker, the cursor model and the right-click rules.
import { describe, expect, it } from "vitest";
import { isWallAt, mapFromTiles, mulberry32, TARGET_SNAP_RADIUS, TILE, WORLD_H, WORLD_W, type Vec2 } from "@raid/shared";
import { pickTarget as clientPick } from "../../../client/src/render/targeting";
import {
  clampToWindow, edgeToward, groundClick, groundSigma, inWindow, lockCandidates, lockClick, moveClick, pickTarget,
} from "../../src/bots/brain/clicks";
import { BOT_VIEW, TIER_IDS, TIERS } from "../../src/bots/brain/types";
import { fighter, hudView, mobView, percept, rngs, selfView, testMap } from "./fixtures";

const sd = (xs: number[]): number => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

describe("pickTarget is the client's picker", () => {
  it("returns what render/targeting.ts returns, for random clicks, radii and iteration orders", () => {
    const r = mulberry32(5);
    for (let n = 0; n < 3000; n++) {
      const cands = Array.from({ length: Math.floor(r() * 7) }, (_, i) => ({
        id: `f${Math.floor(r() * 12)}-${i}`, x: Math.round(r() * 200), y: Math.round(r() * 200),
      }));
      const cursor = { x: Math.round(r() * 200), y: Math.round(r() * 200) };
      const radius = r() < 0.5 ? undefined : r() * 150;
      expect(pickTarget(cursor, cands, radius)).toBe(clientPick(cursor, cands, radius));
      expect(pickTarget(cursor, [...cands].reverse(), radius)).toBe(clientPick(cursor, [...cands].reverse(), radius));
    }
  });

  it("breaks an exact tie to the lower id whatever the order", () => {
    const cands = [{ id: "m", x: 3, y: 4 }, { id: "c", x: -3, y: -4 }, { id: "x", x: 5, y: 0 }, { id: "b", x: 0, y: -5 }];
    for (const order of [cands, [...cands].reverse(), [cands[2]!, cands[0]!, cands[3]!, cands[1]!]]) {
      expect(pickTarget({ x: 0, y: 0 }, order)).toBe("b");
      expect(clientPick({ x: 0, y: 0 }, order)).toBe("b");
    }
  });

  it("snaps within TARGET_SNAP_RADIUS and not beyond", () => {
    const c = [{ id: "a", x: 100, y: 0 }];
    expect(pickTarget({ x: 100 + TARGET_SNAP_RADIUS - 0.1, y: 0 }, c)).toBe("a");
    expect(pickTarget({ x: 100 + TARGET_SNAP_RADIUS, y: 0 }, c)).toBeNull();
  });
});

describe("lockCandidates is the client's candidate rule", () => {
  it("offers alive, targetable players and alive mobs", () => {
    const p = percept({
      fighters: [fighter({ id: "a" }), fighter({ id: "dead", status: "dead" }), fighter({ id: "ghost", targetable: false }), fighter({ id: "mia", status: "mia" })],
      mobs: [mobView({ id: "m1" }), mobView({ id: "m2", status: "dead" })],
    });
    expect(lockCandidates(p).map((c) => c.id).sort()).toEqual(["a", "m1"]);
  });

  it("offers no mob while the coliseum gates are locked, and the players still", () => {
    const p = percept({ fighters: [fighter({ id: "a" })], mobs: [mobView({ id: "m1" })], hud: hudView({ gatesLocked: true }) });
    expect(lockCandidates(p).map((c) => c.id)).toEqual(["a"]);
  });

  it("never offers a quest giver, as the client does not (the server refuses a lock on one)", () => {
    const p = percept({ fighters: [fighter({ id: "a" })], mobs: [mobView({ id: "m1" }), mobView({ id: "giver", kind: "quest", faction: null })] });
    expect(lockCandidates(p).map((c) => c.id).sort()).toEqual(["a", "m1"]);
  });

  it("uses the drawn position, not a remembered one", () => {
    const p = percept({ fighters: [fighter({ id: "a", x: 321, y: 123 })] });
    expect(lockCandidates(p)).toEqual([{ id: "a", x: 321, y: 123 }]);
  });
});

/** P(a click on a lone target is empty ground): the snap disc missed by the plain draw or by the slipped one. */
function expectedMiss(sigma: number, slipP: number, slipMult: number): number {
  const miss = (s: number) => Math.exp(-(TARGET_SNAP_RADIUS ** 2) / (2 * s * s));
  return (1 - slipP) * miss(sigma) + slipP * miss(sigma * slipMult);
}

describe("lock clicks", () => {
  // The expectation is the closed form of BOTS.md 2.2: exp(-64^2 / 2 sigma^2) for the plain draw, the same at 3 sigma for a slip.
  const DOC = { easy: 0.074, normal: 0.012, hard: 0.002 };

  it.each(TIER_IDS)("%s: a lone static target is missed about as often as the tier table says", (id) => {
    const tier = TIERS[id];
    const p = percept({ fighters: [fighter({ id: "foe" })] });
    const r = rngs(11);
    const N = 30000;
    let missed = 0;
    let wrong = 0;
    for (let i = 0; i < N; i++) {
      const c = lockClick(r.motor, r.lapse, tier, p, { id: "foe", at: { x: p.fighters[0]!.x, y: p.fighters[0]!.y } });
      if (c.picked === null) missed++;
      else if (c.picked !== "foe") wrong++;
    }
    const rate = missed / N;
    const s = tier.targetScatter;
    expect(Math.abs(rate - expectedMiss(s.sigma, s.slipP, s.slipMult))).toBeLessThan(0.01);
    expect(Math.abs(rate - DOC[id])).toBeLessThan(0.015);
    expect(wrong).toBe(0);
  });

  it("the cursor trails a mover by velocity x lagS, so a runner is missed more often", () => {
    const tier = TIERS.easy;
    const still = percept({ fighters: [fighter({ id: "foe", vx: 0 })] });
    const fast = percept({ fighters: [fighter({ id: "foe", vx: 340 })] });
    const r = rngs(12);
    const count = (p: ReturnType<typeof percept>) => {
      let m = 0;
      for (let i = 0; i < 8000; i++) if (lockClick(r.motor, r.lapse, tier, p, { id: "foe", at: p.fighters[0]! }).picked === null) m++;
      return m / 8000;
    };
    const lag = tier.targetScatter.lagS * 340;
    expect(lag).toBeGreaterThan(25);
    expect(count(fast)).toBeGreaterThan(count(still) + 0.03);
  });

  it("aims at the position the caller last saw when the target has left the percept", () => {
    const tier = { ...TIERS.hard, targetScatter: { ...TIERS.hard.targetScatter, sigma: 0.001, slipP: 0 } };
    const r = rngs(13);
    const c = lockClick(r.motor, r.lapse, tier, percept(), { id: "gone", at: { x: 500, y: 600 } });
    expect(c.cursor.x).toBeCloseTo(500, 1);
    expect(c.cursor.y).toBeCloseTo(600, 1);
    expect(c.picked).toBeNull();
  });

  it("in a crowd the nearest fighter to the cursor is locked, so a wrong pick sends the neighbour", () => {
    const tier = TIERS.normal;
    const me = selfView();
    const p = percept({
      fighters: [fighter({ id: "a", x: me.x + 200, y: me.y }), fighter({ id: "b", x: me.x + 230, y: me.y })],
    });
    const r = rngs(14);
    const N = 10000;
    const got: Record<string, number> = { a: 0, b: 0, none: 0 };
    for (let i = 0; i < N; i++) {
      const c = lockClick(r.motor, r.lapse, tier, p, { id: "a", at: p.fighters[0]! });
      got[c.picked ?? "none"]!++;
    }
    // 30 u apart, sigma 18: the cursor is nearer b than a when it lands 15 u past the midpoint, about 20% of the time.
    expect(got.b! / N).toBeGreaterThan(0.12);
    expect(got.b! / N).toBeLessThan(0.3);
    expect(got.a! / N).toBeGreaterThan(0.65);
    // Hard, a long way apart: no wrong pick to speak of.
    const far = percept({ fighters: [fighter({ id: "a", x: me.x + 200, y: me.y }), fighter({ id: "b", x: me.x + 350, y: me.y })] });
    let wrong = 0;
    for (let i = 0; i < N; i++) if (lockClick(r.motor, r.lapse, TIERS.hard, far, { id: "a", at: far.fighters[0]! }).picked === "b") wrong++;
    expect(wrong / N).toBeLessThan(0.005);
  });

  it("a mob behind the locked coliseum gates is not clickable", () => {
    const tier = TIERS.hard;
    const r = rngs(15);
    const open = percept({ mobs: [mobView({ id: "m" })] });
    const locked = percept({ mobs: [mobView({ id: "m" })], hud: hudView({ gatesLocked: true }) });
    let hits = 0;
    for (let i = 0; i < 200; i++) {
      if (lockClick(r.motor, r.lapse, tier, open, { id: "m", at: open.mobs[0]! }).picked === "m") hits++;
      expect(lockClick(r.motor, r.lapse, tier, locked, { id: "m", at: locked.mobs[0]! }).picked).toBeNull();
    }
    expect(hits).toBeGreaterThan(190);
  });
});

describe("right clicks", () => {
  const open = mapFromTiles(64, 64, new Uint8Array(64 * 64));
  const self: Vec2 = { x: 1024, y: 1024 };

  it.each(TIER_IDS)("%s: a click on screen scatters with base + perUnit x distance", (id) => {
    const tier = TIERS[id];
    const r = rngs(21);
    const to = { x: 1324, y: 1100 };
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < 6000; i++) {
      const c = moveClick(r.motor, tier, open, self, to);
      expect(c.kind).toBe("ground");
      xs.push(c.to.x - to.x);
      ys.push(c.to.y - to.y);
    }
    const sigma = groundSigma(tier, self, to);
    expect(sd(xs)).toBeGreaterThan(sigma * 0.94);
    expect(sd(xs)).toBeLessThan(sigma * 1.06);
    expect(sd(ys)).toBeGreaterThan(sigma * 0.94);
    expect(sd(ys)).toBeLessThan(sigma * 1.06);
  });

  it("clamps to the world at its corners and to the window around the bot", () => {
    const r = rngs(22);
    const corner = { x: 6, y: 6 };
    for (let i = 0; i < 2000; i++) {
      const p = moveClick(r.motor, TIERS.easy, open, corner, { x: 1, y: 2 }).to;
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
    }
    const far = { x: WORLD_W - 3, y: WORLD_H - 3 };
    for (let i = 0; i < 2000; i++) {
      const p = moveClick(r.motor, TIERS.easy, open, far, { x: WORLD_W - 1, y: WORLD_H - 1 }).to;
      expect(p.x).toBeLessThanOrEqual(WORLD_W);
      expect(p.y).toBeLessThanOrEqual(WORLD_H);
    }
    // A destination a hair inside the window edge never scatters off the screen.
    const edge = { x: self.x + BOT_VIEW.halfW - 1, y: self.y };
    for (let i = 0; i < 2000; i++) expect(inWindow(self, moveClick(r.motor, TIERS.easy, open, self, edge).to)).toBe(true);
  });

  it.each(TIER_IDS)("%s: an off-screen walk is an edge click edgeClickP of the time, else a minimap click, and stays in range", (id) => {
    const tier = TIERS[id];
    const r = rngs(23);
    const to = { x: 1950, y: 1500 };
    expect(inWindow(self, to)).toBe(false);
    const N = 6000;
    let edges = 0;
    let off = 0;
    for (let i = 0; i < N; i++) {
      const c = moveClick(r.motor, tier, open, self, to);
      expect(c.to.x).toBeGreaterThanOrEqual(0);
      expect(c.to.x).toBeLessThanOrEqual(WORLD_W);
      expect(c.to.y).toBeGreaterThanOrEqual(0);
      expect(c.to.y).toBeLessThanOrEqual(WORLD_H);
      if (c.kind === "edge") {
        edges++;
        expect(inWindow(self, c.to)).toBe(true);
        // toward the destination, not just somewhere on the screen
        expect(c.to.x).toBeGreaterThan(self.x);
        expect(c.to.y).toBeGreaterThan(self.y);
      } else {
        expect(c.kind).toBe("minimap");
        off++;
        expect(Math.hypot(c.to.x - to.x, c.to.y - to.y)).toBeLessThan(tier.minimapSigma * 6);
      }
    }
    expect(Math.abs(edges / N - tier.edgeClickP)).toBeLessThan(0.03);
    expect(edges + off).toBe(N);
  });

  it("edge clicks stay on screen from anywhere in the world, toward any off-screen heading", () => {
    const r = rngs(24);
    const pick = mulberry32(25);
    let edges = 0;
    for (let i = 0; i < 6000; i++) {
      const me = { x: pick() * WORLD_W, y: pick() * WORLD_H };
      const to = { x: pick() * WORLD_W, y: pick() * WORLD_H };
      const c = moveClick(r.motor, TIERS.normal, open, me, to);
      if (inWindow(me, to)) {
        expect(c.kind).toBe("ground");
        expect(inWindow(me, c.to)).toBe(true);
      } else if (c.kind === "edge") {
        edges++;
        expect(inWindow(me, c.to)).toBe(true);
      }
      expect(c.to.x).toBeGreaterThanOrEqual(0);
      expect(c.to.x).toBeLessThanOrEqual(WORLD_W);
      expect(c.to.y).toBeGreaterThanOrEqual(0);
      expect(c.to.y).toBeLessThanOrEqual(WORLD_H);
    }
    expect(edges).toBeGreaterThan(500);
  });

  it("the edge point lies on the heading and just inside the border", () => {
    const e = edgeToward(open, self, { x: self.x + 1600, y: self.y });
    expect(e.y).toBeCloseTo(self.y, 6);
    expect(e.x - self.x).toBeGreaterThan(BOT_VIEW.halfW * 0.9);
    expect(e.x - self.x).toBeLessThanOrEqual(BOT_VIEW.halfW);
    const diag = edgeToward(open, self, { x: self.x + 2000, y: self.y - 1000 });
    expect((diag.y - self.y) / (diag.x - self.x)).toBeCloseTo(-0.5, 6);
    expect(inWindow(self, diag)).toBe(true);
  });

  it("backs the edge point off a wall so the order has floor under it", () => {
    const tiles = new Uint8Array(64 * 64);
    for (let ty = 0; ty < 64; ty++) for (let tx = 49; tx < 64; tx++) tiles[ty * 64 + tx] = 1;
    const m = mapFromTiles(64, 64, tiles);
    const me = { x: 900, y: 1000 };
    const e = edgeToward(m, me, { x: 2000, y: 1000 });
    expect(isWallAt(m, e.x, e.y)).toBe(false);
  });

  it("re-aims a click that lands in a wall when the point it meant is floor", () => {
    const tiles = new Uint8Array(64 * 64);
    for (let ty = 0; ty < 64; ty++) for (let tx = 40; tx < 64; tx++) tiles[ty * 64 + tx] = 1;
    const m = mapFromTiles(64, 64, tiles);
    const me = { x: 800, y: 1000 };
    const beside = { x: 40 * TILE - 3, y: 1000 };
    const r = rngs(26);
    let inWall = 0;
    for (let i = 0; i < 3000; i++) {
      const to = moveClick(r.motor, TIERS.easy, m, me, beside).to;
      if (isWallAt(m, to.x, to.y)) inWall++;
    }
    expect(inWall).toBe(0);
    // A destination that is itself a wall is clicked as aimed.
    const inside = { x: 45 * TILE, y: 1000 };
    let hit = 0;
    for (let i = 0; i < 500; i++) {
      const to = moveClick(r.motor, TIERS.easy, m, { x: 1100, y: 1000 }, inside).to;
      if (isWallAt(m, to.x, to.y)) hit++;
    }
    expect(hit).toBeGreaterThan(400);
  });

  it("clampToWindow keeps a point in the world and on screen", () => {
    expect(clampToWindow(self, { x: 5000, y: -5000 })).toEqual({ x: self.x + BOT_VIEW.halfW, y: self.y - BOT_VIEW.halfH });
    expect(clampToWindow({ x: 10, y: 10 }, { x: -500, y: -500 })).toEqual({ x: 0, y: 0 });
  });

  it("a ground cast is aimed like a ground click", () => {
    const r = rngs(27);
    const to = { x: 1200, y: 1000 };
    const xs: number[] = [];
    for (let i = 0; i < 4000; i++) xs.push(groundClick(r.motor, TIERS.normal, open, self, to).x - to.x);
    const sigma = groundSigma(TIERS.normal, self, to);
    expect(sd(xs)).toBeGreaterThan(sigma * 0.93);
    expect(sd(xs)).toBeLessThan(sigma * 1.07);
  });

  it("replays from the same streams", () => {
    const run = (seed: number) => {
      const r = rngs(seed);
      const p = percept({ fighters: [fighter({ id: "a" })] });
      return [
        ...Array.from({ length: 50 }, () => moveClick(r.motor, TIERS.normal, testMap(), selfView(), { x: 1500, y: 1500 })),
        ...Array.from({ length: 50 }, () => lockClick(r.motor, r.lapse, TIERS.normal, p, { id: "a", at: p.fighters[0]! })),
      ];
    };
    expect(run(3)).toEqual(run(3));
    expect(run(3)).not.toEqual(run(4));
  });
});
