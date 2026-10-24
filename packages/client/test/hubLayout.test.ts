import { describe, expect, it } from "vitest";
import { FACTION_IDS, PLAYER_RADIUS, TILE, mulberry32 } from "@raid/shared";
import { KIOSK_HEIGHT, PILLAR_HEIGHT } from "../src/hub/hubArt";
import {
  HUB_LAYOUT, INTERACT_REACH, KIOSK_LABEL_GAP, distanceToStation, frameAxis, isFree, kioskLabelAnchor, moveWithCollision,
  nearestStation, spawnPoint, stationById, stationRect, type HubLayout, type HubStation, type Rect, type Vec,
} from "../src/hub/hubLayout";
import { projY } from "../src/render/projection";

const R = PLAYER_RADIUS;
const L = HUB_LAYOUT;

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function inside(inner: Rect, outer: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

describe("the hub layout", () => {
  it("is a room of about 28 x 18 tiles", () => {
    expect(L.bounds.w).toBe(28 * TILE);
    expect(L.bounds.h).toBe(18 * TILE);
    expect(inside(L.floor, L.bounds)).toBe(true);
  });

  it("has every station the hub needs, once each, with one pedestal per faction in FACTION_IDS order", () => {
    const ids = L.stations.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["arena", "training", "shop", "wardrobe", "achievements", "leaderboard", "counters"] as const) {
      expect(ids).toContain(id);
    }
    const pedestals = L.stations.filter((s) => s.kind === "pedestal");
    expect(pedestals.map((s) => s.faction)).toEqual([...FACTION_IDS]);
    expect(pedestals.map((s) => s.id)).toEqual(FACTION_IDS.map((f) => `faction:${f}`));
    expect(L.stations.every((s) => s.key === "E")).toBe(true);
  });

  it("puts the stairs in the north wall and the training door in the east wall", () => {
    const stairs = stationRect(stationById(L, "arena")!);
    expect(stairs.y + stairs.h).toBeLessThanOrEqual(L.floor.y);
    expect(stairs.x + stairs.w / 2).toBe(L.bounds.w / 2);
    const door = stationRect(stationById(L, "training")!);
    expect(door.x).toBeGreaterThanOrEqual(L.floor.x + L.floor.w);
    // The east wall is split around the doorway, so the opening is not drawn over.
    const east = L.walls.filter((w) => w.x === L.bounds.w - TILE);
    expect(east.length).toBe(2);
    for (const w of east) expect(overlaps(w, door)).toBe(false);
  });

  it("keeps every station inside the room and clear of the solids it doesn't stand for", () => {
    for (const s of L.stations) {
      expect(inside(stationRect(s), L.bounds)).toBe(true);
      // A kiosk is its own obstacle; nothing else may overlap one.
      if (s.kind !== "kiosk") for (const o of L.obstacles) expect(overlaps(stationRect(s), o)).toBe(false);
    }
    for (const s of L.stations.filter((st) => st.kind === "kiosk")) {
      expect(L.obstacles.some((o) => o.x === stationRect(s).x && o.y === stationRect(s).y)).toBe(true);
    }
    for (const o of L.obstacles) expect(inside(o, L.floor)).toBe(true);
  });

  it("has a free stand point per station that selects exactly that station", () => {
    for (const s of L.stations) {
      expect(isFree(s.stand, R, L), s.id).toBe(true);
      expect(nearestStation(s.stand, L)?.id, s.id).toBe(s.id);
    }
  });

  it("spawns the avatar on free floor with no station prompt", () => {
    const spawn = spawnPoint(L);
    expect(isFree(spawn, R, L)).toBe(true);
    expect(nearestStation(spawn, L)).toBeNull();
    // A copy, so a caller can't move the spawn by walking the returned point.
    spawn.x += 100;
    expect(spawnPoint(L).x).not.toBe(spawn.x);
  });
});

/** Walks a grid of positions with moveWithCollision (one exact step at a time) and returns the reachable cells. */
function reachableCells(layout: HubLayout, from: Vec, step: number): Set<string> {
  const x0 = layout.floor.x + R;
  const y0 = layout.floor.y + R;
  const key = (i: number, j: number): string => `${i},${j}`;
  const start = { i: Math.round((from.x - x0) / step), j: Math.round((from.y - y0) / step) };
  const seen = new Set([key(start.i, start.j)]);
  const queue = [start];
  while (queue.length > 0) {
    const { i, j } = queue.pop()!;
    const here = { x: x0 + i * step, y: y0 + j * step };
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        if (di === 0 && dj === 0) continue;
        const ni = i + di;
        const nj = j + dj;
        if (seen.has(key(ni, nj))) continue;
        const to = moveWithCollision(here, { x: di * step, y: dj * step }, R, layout);
        if (Math.abs(to.x - (x0 + ni * step)) > 1e-9 || Math.abs(to.y - (y0 + nj * step)) > 1e-9) continue;
        seen.add(key(ni, nj));
        queue.push({ i: ni, j: nj });
      }
    }
  }
  return seen;
}

describe("walking the hub", () => {
  it("reaches the interaction zone of every station from the spawn", () => {
    const step = 4;
    const cells = reachableCells(L, spawnPoint(L), step);
    const x0 = L.floor.x + R;
    const y0 = L.floor.y + R;
    const at = (cell: string): Vec => {
      const [i, j] = cell.split(",").map(Number);
      return { x: x0 + i! * step, y: y0 + j! * step };
    };
    for (const s of L.stations) {
      const reached = [...cells].some((cell) => distanceToStation(at(cell), s) <= INTERACT_REACH);
      expect(reached, `${s.id} is unreachable`).toBe(true);
      expect(cells.has(`${Math.round((s.stand.x - x0) / step)},${Math.round((s.stand.y - y0) / step)}`), `${s.id} stand point`).toBe(true);
    }
  });

  it("never ends inside an obstacle or off the floor, whatever the delta", () => {
    const rng = mulberry32(20260424);
    const scales = [3, 40, 400, 5000];
    const free = (): Vec => {
      for (;;) {
        const p = { x: L.floor.x + rng() * L.floor.w, y: L.floor.y + rng() * L.floor.h };
        if (isFree(p, R, L)) return p;
      }
    };
    for (let n = 0; n < 4000; n++) {
      const scale = scales[n % scales.length]!;
      const start = free();
      const delta = { x: (rng() * 2 - 1) * scale, y: (rng() * 2 - 1) * scale };
      const end = moveWithCollision(start, delta, R, L);
      expect(isFree(end, R, L), `start ${start.x},${start.y} delta ${delta.x},${delta.y}`).toBe(true);
      // It only ever moves the way it was asked to, and never further.
      expect((end.x - start.x) * delta.x).toBeGreaterThanOrEqual(0);
      expect((end.y - start.y) * delta.y).toBeGreaterThanOrEqual(0);
      expect(Math.abs(end.x - start.x)).toBeLessThanOrEqual(Math.abs(delta.x) + 1e-9);
      expect(Math.abs(end.y - start.y)).toBeLessThanOrEqual(Math.abs(delta.y) + 1e-9);
    }
  });

  it("stays valid over a long random walk of frame-sized steps", () => {
    const rng = mulberry32(7);
    let p = spawnPoint(L);
    for (let n = 0; n < 5000; n++) {
      const a = rng() * Math.PI * 2;
      p = moveWithCollision(p, { x: Math.cos(a) * 8.5, y: Math.sin(a) * 8.5 }, R, L);
      expect(isFree(p, R, L)).toBe(true);
    }
  });

  it("does not mutate the position it is given", () => {
    const p = { x: 300, y: 300 };
    moveWithCollision(p, { x: 20, y: -20 }, R, L);
    expect(p).toEqual({ x: 300, y: 300 });
  });

  it("slides along a wall instead of stopping dead", () => {
    // The north edge of the floor: the vertical part of the move is lost, the horizontal part is kept.
    const top = L.floor.y + R;
    expect(moveWithCollision({ x: 300, y: top }, { x: 20, y: -20 }, R, L)).toEqual({ x: 320, y: top });
    // The shop counter's east face: x is stopped at the face, y carries on.
    const shop = stationRect(stationById(L, "shop")!);
    const face = shop.x + shop.w + R;
    const at = shop.y + shop.h / 2;
    expect(moveWithCollision({ x: face, y: at }, { x: -10, y: 10 }, R, L)).toEqual({ x: face, y: at + 10 });
    // And arriving at it from afar stops at the face, not inside.
    expect(moveWithCollision({ x: face + 40, y: at }, { x: -100, y: 0 }, R, L)).toEqual({ x: face, y: at });
  });

  it("cannot tunnel through a thin wall, however large the delta", () => {
    const thin: HubLayout = { ...L, obstacles: [{ x: 400, y: 40, w: 2, h: 500 }] };
    const wall = thin.obstacles[0]!;
    for (const dx of [88, 500, 10_000, 1e9]) {
      const east = moveWithCollision({ x: 300, y: 300 }, { x: dx, y: 0 }, R, thin);
      expect(east.x).toBe(wall.x - R);
    }
    const west = moveWithCollision({ x: 700, y: 300 }, { x: -1e6, y: 12 }, R, thin);
    expect(west).toEqual({ x: wall.x + wall.w + R, y: 312 });
    // A diagonal huge delta can't skip it either: the x leg stops at the face.
    expect(moveWithCollision({ x: 300, y: 300 }, { x: 5000, y: 5000 }, R, thin).x).toBe(wall.x - R);
    // The real room's edges hold for a huge delta too.
    const out = moveWithCollision(spawnPoint(L), { x: 1e7, y: -1e7 }, R, L);
    expect(isFree(out, R, L)).toBe(true);
  });

  it("pushes a start that is inside a solid out to its nearest edge", () => {
    const pillar = L.obstacles.find((o) => o.w === 32 && o.h === 32)!;
    const inside = { x: pillar.x + pillar.w / 2, y: pillar.y + pillar.h / 2 };
    const out = moveWithCollision(inside, { x: 0, y: 0 }, R, L);
    expect(isFree(out, R, L)).toBe(true);
  });
});

describe("nearestStation", () => {
  const station = (id: string, x: number): HubStation => ({
    id: id as HubStation["id"], kind: "pedestal", label: id, verb: id, key: "E", x, y: 50, w: 20, h: 20,
    stand: { x, y: 50 }, color: 0,
  });
  const two: HubLayout = { ...L, stations: [station("a", 10), station("b", 70)] };

  it("picks the station whose zone is closest", () => {
    expect(nearestStation({ x: 30, y: 50 }, two, 100)?.id).toBe("a");
    expect(nearestStation({ x: 41, y: 50 }, two, 100)?.id).toBe("b");
    expect(nearestStation({ x: 40, y: 50 }, two, 100)?.id).toBe("a");
  });

  it("is zero inside a footprint and measures to its edge outside", () => {
    expect(distanceToStation({ x: 10, y: 50 }, station("a", 10))).toBe(0);
    expect(distanceToStation({ x: 30, y: 50 }, station("a", 10))).toBe(10);
    expect(distanceToStation({ x: 30, y: 70 }, station("a", 10))).toBeCloseTo(Math.hypot(10, 10));
  });

  it("returns null out of reach and includes the reach itself", () => {
    const one: HubLayout = { ...L, stations: [station("a", 10)] };
    expect(nearestStation({ x: 400, y: 400 }, two, 30)).toBeNull();
    expect(nearestStation({ x: 50, y: 50 }, one, 30)?.id).toBe("a");
    expect(nearestStation({ x: 50.5, y: 50 }, one, 30)).toBeNull();
  });

  it("reaches the real stations from just outside a wall-mounted prop", () => {
    const arena = stationById(L, "arena")!;
    // The closest the avatar's centre can get to the stairs is a radius below the north wall.
    expect(nearestStation({ x: arena.x, y: L.floor.y + R }, L)?.id).toBe("arena");
    const door = stationById(L, "training")!;
    expect(nearestStation({ x: L.floor.x + L.floor.w - R, y: door.y }, L)?.id).toBe("training");
  });
});

describe("frameAxis", () => {
  it("centres a room that fits in the view", () => {
    expect(frameAxis(10, 1000, 0, 400)).toBe(-300);
    expect(frameAxis(390, 1000, 0, 400)).toBe(-300);
  });

  it("follows the focus in a room bigger than the view and stops at its edges", () => {
    expect(frameAxis(500, 200, 0, 1000)).toBe(400);
    expect(frameAxis(10, 200, 0, 1000)).toBe(0);
    expect(frameAxis(990, 200, 0, 1000)).toBe(800);
  });
});

describe("kiosk signs", () => {
  // Screen-space boxes (projected pixels). Text widths are a generous 8 px a letter at the scene's 11 px bold caps.
  const SIGN_HEIGHT = 16;
  const SIGN_LIFT = 24;
  const FLAME = 18;
  const kiosks = L.stations.filter((s) => s.kind === "kiosk");
  const signBox = (s: HubStation): Rect => {
    const at = kioskLabelAnchor(s);
    return { x: at.x, y: projY(at.y) - SIGN_LIFT - SIGN_HEIGHT / 2, w: s.label.length * 8, h: SIGN_HEIGHT };
  };
  const solidBox = (o: Rect, rise: number): Rect => ({ x: o.x, y: projY(o.y) - rise, w: o.w, h: projY(o.y + o.h) - projY(o.y) + rise });

  it("starts east of its own counter, on its centre line", () => {
    for (const s of kiosks) {
      const at = kioskLabelAnchor(s);
      expect(at).toEqual({ x: stationRect(s).x + stationRect(s).w + KIOSK_LABEL_GAP, y: s.y });
    }
  });

  it("overlaps no other kiosk, no pillar with its flame, and no other sign", () => {
    const pillars = L.obstacles.filter((o) => !kiosks.some((k) => stationRect(k).x === o.x && stationRect(k).y === o.y));
    expect(pillars.length).toBe(4);
    for (const s of kiosks) {
      const box = signBox(s);
      for (const k of kiosks) expect(overlaps(box, solidBox(stationRect(k), KIOSK_HEIGHT + 46)), `${s.id} over ${k.id}`).toBe(false);
      for (const p of pillars) expect(overlaps(box, solidBox(p, PILLAR_HEIGHT + FLAME)), `${s.id} over a pillar`).toBe(false);
      for (const other of kiosks) if (other !== s) expect(overlaps(box, signBox(other))).toBe(false);
      // And it stays inside the room.
      expect(box.x + box.w).toBeLessThan(L.floor.x + L.floor.w);
    }
  });
});
