import { describe, expect, it } from "vitest";
import { PlayerState } from "@raid/shared/schema";
import { FireRoamHud } from "../src/ui/fireRoamHud";
import { FakeEl, installFakeDom } from "./fakes";

function find(root: FakeEl, className: string): FakeEl | undefined {
  if (root.className.split(" ").includes(className)) return root;
  for (const child of root.children) if (child instanceof FakeEl) {
    const result = find(child, className);
    if (result) return result;
  }
  return undefined;
}

describe("Fire roaming HUD", () => {
  it("shows progress and the armed cue only for a living Fire in play", () => {
    const dom = installFakeDom();
    const hud = new FireRoamHud(dom.ui as unknown as HTMLElement);
    const root = find(dom.ui, "fire-roam-hud")!;
    const charge = find(root, "fire-roam-value")!;
    const ready = find(root, "fire-roam-ready")!;
    const fill = find(root, "fire-roam-fill")!;
    const me = new PlayerState();
    me.faction = "fire";
    me.status = "alive";
    me.roamCharge = 500;

    hud.update(me, "active", false);
    expect(root.hidden).toBe(false);
    expect(charge.textContent).toBe(" 50%");
    expect(fill.style.props.transform).toBe("scaleX(0.5)");
    expect(ready.hidden).toBe(true);

    me.roamCharge = 1000;
    me.roamReady = true;
    hud.update(me, "active", false);
    expect(charge.textContent).toBe("100%");
    expect(ready.hidden).toBe(false);
    expect(root.classList.contains("ready")).toBe(true);

    me.faction = "holy";
    hud.update(me, "active", false);
    expect(root.hidden).toBe(true);
    hud.destroy();
  });

  it("treats missing fields from an older or partial player state as an empty, unarmed meter", () => {
    const dom = installFakeDom();
    const hud = new FireRoamHud(dom.ui as unknown as HTMLElement);
    const root = find(dom.ui, "fire-roam-hud")!;
    const charge = find(root, "fire-roam-value")!;
    const ready = find(root, "fire-roam-ready")!;
    const partial = { faction: "fire", status: "alive", roamCharge: undefined, roamReady: undefined } as unknown as PlayerState;
    hud.update(partial, "active", false);
    expect(root.hidden).toBe(false);
    expect(charge.textContent).toBe("  0%");
    expect(ready.hidden).toBe(true);
    expect(root.classList.contains("ready")).toBe(false);
    hud.destroy();
  });
});
