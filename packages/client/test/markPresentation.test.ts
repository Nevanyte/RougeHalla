import { describe, expect, it } from "vitest";
import { markDimmed, trialFieldRadius, trialTelegraphRadius } from "../src/render/markPresentation";

describe("Sentenced presentation", () => {
  it("dims marks only beyond 300 units and keeps them bright inside their Trial", () => {
    expect(markDimmed(300 ** 2, false)).toBe(false);
    expect(markDimmed(301 ** 2, false)).toBe(true);
    expect(markDimmed(500 ** 2, true)).toBe(false);
  });

  it("contracts the landed Trial from its 300-unit telegraph to the server's 200-unit radius", () => {
    expect(trialTelegraphRadius(1, 300)).toBe(300);
    expect(trialFieldRadius(200, 0)).toBe(300);
    expect(trialFieldRadius(200, 175)).toBe(250);
    expect(trialFieldRadius(200, 350)).toBe(200);
    expect(trialFieldRadius(300, 120)).toBe(300);
  });
});
