import { describe, expect, it } from "vitest";
import { radioStep } from "../src/ui/factionPicker";

describe("radioStep", () => {
  it("moves along the radios, wrapping at both ends", () => {
    expect(radioStep(5, 0, "ArrowDown")).toBe(1);
    expect(radioStep(5, 4, "ArrowRight")).toBe(0);
    expect(radioStep(5, 0, "ArrowUp")).toBe(4);
    expect(radioStep(5, 3, "ArrowLeft")).toBe(2);
  });

  it("jumps to the ends with Home and End", () => {
    expect(radioStep(5, 2, "Home")).toBe(0);
    expect(radioStep(5, 2, "End")).toBe(4);
  });

  it("ignores every other key (Tab, Enter and Space keep their own behaviour)", () => {
    for (const key of ["Tab", "Enter", " ", "a", "Escape"]) expect(radioStep(5, 2, key)).toBeNull();
    expect(radioStep(0, 0, "ArrowDown")).toBeNull();
  });
});
