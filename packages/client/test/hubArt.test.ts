import type Phaser from "phaser";
import { describe, expect, it } from "vitest";
import { FACTIONS, FACTION_WHEEL, SIGNATURE_WEAPONS, WEAPONS, WEAPON_WHEEL } from "@raid/shared";
import {
  drawDoor, drawFlame, drawFloorDecor, drawGem, drawKiosk, drawPedestal, drawPillar, drawShell, drawStairs, drawStationRing,
  drawWheel, shade,
} from "../src/hub/hubArt";
import { HUB_LAYOUT } from "../src/hub/hubLayout";

/** A Graphics stand-in that records every call and returns itself, so draw code runs without a canvas. */
function recorder(): { g: Phaser.GameObjects.Graphics; calls: Array<[string, unknown[]]> } {
  const calls: Array<[string, unknown[]]> = [];
  const g: unknown = new Proxy({}, {
    get: (_target, name) => (...args: unknown[]) => {
      calls.push([String(name), args]);
      return g;
    },
  });
  return { g: g as Phaser.GameObjects.Graphics, calls };
}

function expectFiniteDrawing(calls: Array<[string, unknown[]]>): void {
  expect(calls.length).toBeGreaterThan(0);
  for (const [name, args] of calls) {
    for (const arg of args) {
      if (typeof arg === "number") expect(Number.isFinite(arg), `${name}(${args.join(", ")})`).toBe(true);
    }
  }
}

describe("hub art", () => {
  it("draws the shell and the floor decor with finite coordinates", () => {
    const shell = recorder();
    drawShell(shell.g, HUB_LAYOUT);
    expectFiniteDrawing(shell.calls);
    const decor = recorder();
    drawFloorDecor(decor.g, HUB_LAYOUT);
    expectFiniteDrawing(decor.calls);
  });

  it("draws every station's prop and ring", () => {
    for (const s of HUB_LAYOUT.stations) {
      const { g, calls } = recorder();
      if (s.kind === "stairs") drawStairs(g, s, HUB_LAYOUT);
      else if (s.kind === "door") drawDoor(g, s);
      else if (s.kind === "kiosk") drawKiosk(g, s);
      else if (s.kind === "pedestal") {
        drawPedestal(g, s, false);
        drawPedestal(g, s, true);
        drawGem(g, s.color);
      }
      drawStationRing(g, s, 30);
      expectFiniteDrawing(calls);
    }
  });

  it("draws the pillars, their flames and both wheels with and without a pick", () => {
    for (const o of HUB_LAYOUT.obstacles) {
      const { g, calls } = recorder();
      drawPillar(g, o);
      drawFlame(g);
      expectFiniteDrawing(calls);
    }
    for (const faction of [null, ...Object.keys(FACTIONS)] as const) {
      const { g, calls } = recorder();
      const pick = faction === null ? null : (faction as keyof typeof SIGNATURE_WEAPONS);
      drawWheel(g, FACTION_WHEEL, 308, 288, 64, (id) => FACTIONS[id].color, pick);
      drawWheel(g, WEAPON_WHEEL, 588, 288, 64, (id) => WEAPONS[id].color, pick ? SIGNATURE_WEAPONS[pick] : null);
      expectFiniteDrawing(calls);
      // Ten edges and ten nodes per set of five, whatever the pick.
      expect(calls.filter(([name]) => name === "lineBetween").length).toBe(20);
      expect(calls.filter(([name]) => name === "fillEllipse").length).toBeGreaterThanOrEqual(10);
    }
  });

  it("shades toward white and black and keeps the channels in range", () => {
    expect(shade(0x808080, 1)).toBe(0xffffff);
    expect(shade(0x808080, -1)).toBe(0x000000);
    expect(shade(0x336699, 0)).toBe(0x336699);
    for (const amount of [-0.5, 0.25, 0.9]) {
      const c = shade(0xff7043, amount);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(0xffffff);
    }
  });
});
