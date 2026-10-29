import { describe, expect, it, vi } from "vitest";
import { RaidScene } from "../src/scenes/RaidScene";

vi.mock("phaser", () => ({ default: { Scene: class {} } }));

function rig(armed: boolean) {
  const scene = new RaidScene() as unknown as {
    attackMoveArmed: boolean;
    input: { setDefaultCursor: ReturnType<typeof vi.fn> };
    onWindowBlur(): void;
  };
  scene.attackMoveArmed = armed;
  scene.input = { setDefaultCursor: vi.fn() };
  return scene;
}

describe("attack-move window blur handling", () => {
  it("cancels the pending command and restores the cursor on window blur", () => {
    const scene = rig(true);
    scene.onWindowBlur();
    expect(scene.attackMoveArmed).toBe(false);
    expect(scene.input.setDefaultCursor).toHaveBeenCalledExactlyOnceWith("default");
    scene.onWindowBlur();
    expect(scene.input.setDefaultCursor).toHaveBeenCalledTimes(1);
  });

  it("leaves other cursor feedback untouched when no attack-move is armed", () => {
    const scene = rig(false);
    scene.onWindowBlur();
    expect(scene.attackMoveArmed).toBe(false);
    expect(scene.input.setDefaultCursor).not.toHaveBeenCalled();
  });
});
