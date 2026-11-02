import { describe, expect, it } from "vitest";
import { mapFromTiles, TILE_FLOOR, TILE_WALL } from "@raid/shared";
import { keyboardMoveGoal, STEER_COALESCE_MS, STEER_REPEAT_MS, steerDue } from "../src/net/keyboardMovement";
const map = () => mapFromTiles(12, 12, new Uint8Array(144).fill(TILE_FLOOR));
describe("WASD steering", () => {
  it("normalizes diagonals to the same speed", () => {
    const p = { x: 160, y: 160 }, m = map();
    const d = keyboardMoveGoal(m, p, new Set(["KeyW", "KeyD"]))!;
    expect(Math.hypot(d.x-p.x,d.y-p.y)).toBeCloseTo(64);
    expect(keyboardMoveGoal(m,p,new Set(["KeyD"]))!.x-p.x).toBe(64);
  });
  it("opposite keys stop; arrow keys steer too", () => {
    expect(keyboardMoveGoal(map(),{x:160,y:160},new Set(["KeyW","KeyS"]))).toBeNull();
    expect(keyboardMoveGoal(map(),{x:160,y:160},new Set(["ArrowRight"]))).toEqual({x:224,y:160});
  });
  it("slides beside walls instead of pathfinding around them", () => {
    const m=map();for(let y=0;y<12;y++)m.tiles[y*12+6]=TILE_WALL;
    const p=keyboardMoveGoal(m,{x:176,y:160},new Set(["KeyD","KeyS"]))!;
    expect(p.x).toBeLessThan(181);expect(p.y).toBeGreaterThan(160);
  });
});

describe("when the keyboard sends an order (steerDue)", () => {
  it("a key event sends at once when something changed and the last send is not too close", () => {
    expect(steerDue({ changed: true, lastAt: 1000 }, 1010, true)).toBe(true);
    expect(steerDue({ changed: true, lastAt: -Infinity }, 5, true)).toBe(true);
    expect(steerDue({ changed: true, lastAt: 1000 }, 1000 + STEER_COALESCE_MS, true)).toBe(true);
  });

  it("a key event within the coalesce guard waits for the frame, which sends it because the change is still set", () => {
    const state = { changed: true, lastAt: 1000 };
    expect(steerDue(state, 1002, true)).toBe(false);
    expect(steerDue(state, 1002, false)).toBe(true);
  });

  it("an event with nothing changed sends nothing", () => {
    expect(steerDue({ changed: false, lastAt: 0 }, 5000, true)).toBe(false);
  });

  it("a frame sends when something changed, and otherwise only as the repeat", () => {
    expect(steerDue({ changed: true, lastAt: 1000 }, 1001, false)).toBe(true);
    expect(steerDue({ changed: false, lastAt: 1000 }, 1000 + STEER_REPEAT_MS - 1, false)).toBe(false);
    expect(steerDue({ changed: false, lastAt: 1000 }, 1000 + STEER_REPEAT_MS, false)).toBe(true);
  });

  it("a clock that stepped back is never a reason to send from an event", () => {
    expect(steerDue({ changed: true, lastAt: 1000 }, 990, true)).toBe(false);
    expect(steerDue({ changed: false, lastAt: 1000 }, 990, true)).toBe(false);
  });
});
