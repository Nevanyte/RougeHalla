import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hud } from "../src/ui/hud";
import { installFakeDom } from "./fakes";

beforeEach(() => { installFakeDom(); });
afterEach(() => vi.unstubAllGlobals());

describe("Hud.plate (what the J quest log docks under)", () => {
  it("is the HUD block's own box in overlay pixels, so it grows with the buff strip", () => {
    const hud = new Hud();
    const root = (hud as unknown as { root: Record<string, number> }).root;
    Object.assign(root, { offsetLeft: 12, offsetTop: 10, offsetWidth: 278, offsetHeight: 74 });
    expect(hud.plate).toEqual({ left: 12, top: 10, right: 290, bottom: 84 });
    root.offsetHeight = 430;
    expect(hud.plate.bottom).toBe(440);
    hud.destroy();
  });
});
