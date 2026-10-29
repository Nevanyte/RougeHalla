import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateMap, mapFromTiles, TILE, TILE_FLOOR } from "@raid/shared";
import { Minimap } from "../src/ui/minimap";
import { COLOR_ENEMY, COLOR_ZOMBIE_FRIEND, COLOR_ZOMBIE_ENEMY } from "../src/ui/minimapMarkers";
import { mapSpan } from "../src/ui/minimapMath";
import { setView } from "../src/view/viewState";
import { computeLayout } from "../src/view/viewport";
import { argsOf, installFakeDom, type FakeEl, type FakeObject } from "./fakes";

beforeEach(() => setView(computeLayout({ cssW: 1280, cssH: 800, dpr: 1, hiDpi: true })));
afterEach(() => vi.unstubAllGlobals());

function rig() {
  const { ui } = installFakeDom();
  const minimap = new Minimap({}, { reducedMotion: () => true });
  const map = mapFromTiles(8, 8, new Uint8Array(64).fill(TILE_FLOOR));
  minimap.setMap(map);
  const canvas = ui.children[0] as FakeEl;
  const ctx = canvas.getContext() as FakeObject;
  let now = 0;
  const paint = () => minimap.update(now += 200, undefined, true);
  const tick = (at: number, player?: { x: number; y: number }) => minimap.update(at, player, true);
  return { minimap, map, canvas, ctx, paint, tick, paints: () => argsOf(ctx, "drawImage").length };
}

describe("tactical minimap integration", () => {
  it("brightens exactly the visible tile runs, including expiry changes while all actors stand still", () => {
    const r = rig();
    let visible = true;
    const canSee = vi.fn((p: { x: number; y: number }) => visible && p.x < TILE * 2 && p.y < TILE);
    r.minimap.setVision(canSee);
    r.paint();
    const k = r.canvas.width / mapSpan();
    expect(argsOf(r.ctx, "fillRect")).toEqual([[0, 0, Math.round(TILE * 2 * k), Math.round(TILE * k)]]);
    const before = r.paints();
    r.paint();
    expect(r.paints()).toBe(before);
    r.ctx.calls.length = 0;
    visible = false;
    r.paint();
    expect(argsOf(r.ctx, "drawImage")).toHaveLength(1);
    expect(argsOf(r.ctx, "fillRect")).toHaveLength(0);
    r.minimap.setVision(null);
    r.paint();
    expect(argsOf(r.ctx, "fillRect")).toHaveLength(0);
    r.minimap.destroy();
  });

  it("shows distinctive enemy players, skips invalid points and clears them without stale contacts", () => {
    const r = rig();
    r.minimap.setEnemies([{ x: 2000, y: 2000 }, { x: NaN, y: 20 }]);
    r.paint();
    expect(argsOf(r.ctx, "fillStyle=").map(([c]) => c)).toContain(COLOR_ENEMY);
    expect(argsOf(r.ctx, "closePath")).toHaveLength(1);
    const before = r.paints();
    r.minimap.setEnemies([{ x: 2000, y: 2000 }]); r.paint();
    expect(r.paints()).toBe(before);
    r.ctx.calls.length = 0;
    r.minimap.setEnemies([]); r.paint();
    expect(argsOf(r.ctx, "closePath")).toHaveLength(0);
    expect(argsOf(r.ctx, "drawImage")).toHaveLength(1);
    r.minimap.destroy();
  });

  it("draws public corpses in green and clears them when the Plague player loses eligibility", () => {
    const r = rig();
    r.minimap.setCorpses([{ id: "pc1", x: 2000, y: 2100 }]);
    r.paint();
    expect(argsOf(r.ctx, "strokeStyle=").map(([c]) => c)).toContain("#8bff61");
    const before = r.paints();
    r.minimap.setCorpses([]); r.paint();
    expect(r.paints()).toBeGreaterThan(before);
    r.minimap.destroy();
  });

  it("shows companion skull contacts with a friendly owner color and removes dead companions", () => {
    const r = rig();
    const own = { x: 1600, y: 1700, kind: "zombie", status: "alive", faction: "plague", owned: true };
    const other = { ...own, x: 2200, owned: false };
    r.minimap.setMobs({ forEach: cb => { cb(own); cb(other); } });
    r.paint();
    const colors = argsOf(r.ctx, "fillStyle=").map(([c]) => c);
    expect(colors).toContain(COLOR_ZOMBIE_FRIEND);
    expect(colors).toContain(COLOR_ZOMBIE_ENEMY);
    r.ctx.calls.length = 0;
    own.status = "dead"; other.status = "dead";
    r.minimap.setMobs({ forEach: cb => { cb(own); cb(other); } });
    r.paint();
    expect(argsOf(r.ctx, "fillStyle=").map(([c]) => c)).not.toContain(COLOR_ZOMBIE_FRIEND);
    expect(argsOf(r.ctx, "fillStyle=").map(([c]) => c)).not.toContain(COLOR_ZOMBIE_ENEMY);
    r.minimap.destroy();
  });

  it("shows public respawn seconds, updates only on a whole-second change and removes clocks outside active play", () => {
    const r = rig();
    r.map.camps = generateMap(1).camps.slice(0, 1);
    r.minimap.setMap(r.map);
    const camps = [{ state: 2, alive: 0, respawnAt: 181000, wardOwner: "", wardExpiresAt: 0 }];
    r.ctx.calls.length = 0;
    r.minimap.setCampTimers(camps, 1000, true); r.paint();
    const firstClock = argsOf(r.ctx, "fillText")[0]!;
    expect(firstClock[0]).toBe("180");
    expect(argsOf(r.ctx, "fillRect")).toHaveLength(0);
    expect(argsOf(r.ctx, "strokeRect")).toHaveLength(0);
    const before = r.paints();
    r.minimap.setCampTimers(camps, 1100, true); r.paint();
    expect(r.paints()).toBe(before);
    r.minimap.setCampTimers(camps, 2000, true); r.paint();
    const nextClock = argsOf(r.ctx, "fillText").at(-1)!;
    expect(nextClock[0]).toBe("179");
    expect(nextClock.slice(1)).toEqual(firstClock.slice(1));
    r.ctx.calls.length = 0;
    r.minimap.setCampTimers(camps, 2100, false); r.paint();
    expect(argsOf(r.ctx, "fillText")).toHaveLength(0);
    r.minimap.destroy();
  });

  it("repaints subpixel actor movement without letting contacts displace a camp clock", () => {
    const r = rig();
    r.map.camps = generateMap(1).camps.slice(0, 1);
    r.minimap.setMap(r.map);
    const camp = r.map.camps[0]!;
    const mob = { x: camp.x, y: camp.y, kind: "mob", status: "alive", faction: "frost" };
    const setActors = (offset: number) => {
      mob.x = camp.x + offset;
      r.minimap.setMobs({ forEach: (cb) => cb(mob) });
      r.minimap.setEnemies([{ x: camp.x + offset, y: camp.y }]);
    };
    r.minimap.setCampTimers([{ state: 2, alive: 0, respawnAt: 181000, wardOwner: "", wardExpiresAt: 0 }], 1000, true);
    setActors(0);
    r.tick(0, camp);
    const playerArc = () => argsOf(r.ctx, "arc").filter((call) => Math.abs((call[2] as number) - 3.1 * r.canvas.width / 150) < 0.001).at(-1)!;
    const firstPlayer = playerArc();
    const firstTimer = argsOf(r.ctx, "fillText")[0]!;
    const before = r.paints();

    // Less than one backing-store pixel at ordinary map scales: exact movement still changes the actor signature.
    const delta = 0.1;
    setActors(delta);
    r.tick(33, { x: camp.x + delta, y: camp.y });
    const nextPlayer = playerArc();
    const nextTimer = argsOf(r.ctx, "fillText").at(-1)!;
    const timerDraw = r.ctx.calls.map(([name], index) => name === "fillText" ? index : -1).filter((index) => index >= 0).at(-1)!;
    const playerDraw = r.ctx.calls.map(([name, args], index) => name === "arc" && Math.abs((args[2] as number) - 3.1 * r.canvas.width / 150) < 0.001 ? index : -1)
      .filter((index) => index >= 0).at(-1)!;
    expect(r.paints()).toBeGreaterThan(before);
    const firstX = firstPlayer[0] as number;
    const nextX = nextPlayer[0] as number;
    expect(nextX).toBeGreaterThan(firstX);
    expect(nextX - firstX).toBeCloseTo(delta * r.canvas.width / mapSpan());
    expect(nextTimer.slice(1)).toEqual(firstTimer.slice(1));
    expect(playerDraw).toBeGreaterThan(timerDraw);
    r.minimap.destroy();
  });

  it("clips routes out of full contact/label boxes before drawing the foreground", () => {
    const r = rig();
    r.minimap.setEnemies([{ x: 1800, y: 1800 }]);
    r.minimap.setChests([{ x: 1800, y: 1800, left: 12 }]);
    r.minimap.setRoute({ points: [{ x: 1000, y: 1800 }, { x: 3000, y: 1800 }], stops: [], next: -1 });
    r.paint();
    expect(argsOf(r.ctx, "clip")).toEqual([["evenodd"]]);
    // Outer map, enemy marker, and full chest label. The rectangles include padding beyond the painted symbols.
    expect(argsOf(r.ctx, "rect")).toHaveLength(3);
    const calls = r.ctx.calls.map(([name]) => name);
    expect(calls.indexOf("clip")).toBeLessThan(calls.indexOf("setLineDash"));
    expect(calls.indexOf("restore")).toBeLessThan(calls.indexOf("fillText"));
    r.minimap.destroy();
  });
});
