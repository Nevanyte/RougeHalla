import { describe, expect, it } from "vitest";
import { CameraFollow } from "../src/render/CameraFollow";

describe("camera follow", () => {
  it("damps small alternating prediction corrections while a fighter walks", () => {
    const camera = new CameraFollow();
    camera.update({ x: 400, y: 400 }, 0);
    const errors: number[] = [];
    for (let i = 1; i <= 120; i++) {
      const ideal = 400 + i * 3;
      const at = camera.update({ x: ideal + (i % 2 ? 2 : -2), y: 400 }, i * 16);
      if (i > 20) errors.push(at.x - ideal);
      expect(at.y).toBe(400);
    }
    expect(Math.max(...errors) - Math.min(...errors)).toBeLessThan(1);
    expect(Math.max(...errors.map(Math.abs))).toBeLessThan(11);
  });

  it("snaps on teleport, tab stall, minimap peek and release", () => {
    const camera = new CameraFollow();
    expect(camera.update({ x: 100, y: 100 }, 1000)).toEqual({ x: 100, y: 100 });
    expect(camera.update({ x: 2000, y: 2000 }, 1016)).toEqual({ x: 2000, y: 2000 });
    expect(camera.update({ x: 2010, y: 2000 }, 1500)).toEqual({ x: 2010, y: 2000 });
    expect(camera.update({ x: 2050, y: 2000 }, 1516, true)).toEqual({ x: 2050, y: 2000 });
    expect(camera.update({ x: 2010, y: 2000 }, 1532)).toEqual({ x: 2010, y: 2000 });
    camera.reset();
    expect(camera.update({ x: 0, y: 0 }, 1548)).toEqual({ x: 0, y: 0 });
  });
});
