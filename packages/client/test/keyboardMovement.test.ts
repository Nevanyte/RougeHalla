import { describe, expect, it } from "vitest";
import { mapFromTiles, TILE_FLOOR, TILE_WALL } from "@raid/shared";
import { keyboardMoveGoal } from "../src/net/keyboardMovement";
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
