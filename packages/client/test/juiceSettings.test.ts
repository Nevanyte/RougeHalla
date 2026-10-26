// The settings panel's animation intensity and reduced-motion switch feed juiceScale.
import { afterEach, describe, expect, it } from "vitest";
import { juiceScale } from "../src/render/juice";
import { DEFAULT_SETTINGS, updateSettings } from "../src/settings";

afterEach(() => { updateSettings({ ...DEFAULT_SETTINGS }); });

describe("juiceScale follows the settings", () => {
  it("scales both kinds by the intensity slider", () => {
    updateSettings({ juice: 0.5 });
    expect(juiceScale("motion")).toBe(0.5);
    expect(juiceScale("flash")).toBe(0.5);
  });

  it("is off at 0", () => {
    updateSettings({ juice: 0 });
    expect(juiceScale("motion")).toBe(0);
    expect(juiceScale("flash")).toBe(0);
  });

  it("reduced motion switches off the motion kind only", () => {
    updateSettings({ reducedMotion: true });
    expect(juiceScale("motion")).toBe(0);
    expect(juiceScale("flash")).toBe(1);
  });
});
