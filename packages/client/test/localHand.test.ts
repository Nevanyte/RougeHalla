import { describe, expect, it } from "vitest";
import { SWAP_SECONDS, swapReadyAt, TICK_MS } from "@raid/shared";
import { LocalHand, predictedReadyAt, SWAP_SETTLE_SLACK_MS, weaponInSlot } from "../src/net/localHand";
import { ORDER_EXPIRE_MS } from "../src/net/localMotion";

// The press: client clock 10_000 (the estimated server time), order delay 120, the newest patch stamped 9_950 showing slot 0.
const C = 10_000;
const DELAY = 120;
const PATCH_T = 9_950;
const APPLY_AT = C + DELAY + TICK_MS; // the patch stamped from here on shows the swap
const SETTLE_AT = APPLY_AT + SWAP_SETTLE_SLACK_MS;

function pressed(slot = 1): LocalHand {
  const hand = new LocalHand();
  hand.predict(slot, 0, PATCH_T, 5_000, C, DELAY);
  return hand;
}

describe("LocalHand", () => {
  it("shows the server's slot until a swap is predicted, and the predicted one after", () => {
    const hand = new LocalHand();
    expect(hand.predicting).toBe(false);
    expect(hand.slotOf(0)).toBe(0);
    expect(hand.slotOf(1)).toBe(1);
    expect(hand.observe(0, 10_000, 5_000)).toBe("none");
    hand.predict(1, 0, PATCH_T, 5_000, C, DELAY);
    expect(hand.predicting).toBe(true);
    expect(hand.slotOf(0)).toBe(1);
    expect(hand.applyAt).toBe(APPLY_AT);
  });

  it("is confirmed by the first patch that shows the predicted slot, and hands back to the server's slot", () => {
    const hand = pressed();
    expect(hand.observe(1, APPLY_AT, 5_300)).toBe("confirmed");
    expect(hand.predicting).toBe(false);
    expect(hand.slotOf(1)).toBe(1);
    expect(hand.counts).toEqual({ confirmed: 1, refused: 0, expired: 0 });
    expect(hand.observe(1, APPLY_AT + 50, 5_350)).toBe("none");
  });

  it("stays pending while the patches still show the old slot before the swap should have been applied", () => {
    const hand = pressed();
    expect(hand.observe(0, PATCH_T + 50, 5_050)).toBe("pending");
    expect(hand.observe(0, APPLY_AT, 5_200)).toBe("pending");
    expect(hand.observe(0, SETTLE_AT - 1, 5_300)).toBe("pending");
    expect(hand.slotOf(0)).toBe(1);
  });

  it("snaps back at the first patch stamped at or after the settle time that still shows the old slot (a refusal)", () => {
    const hand = pressed();
    expect(hand.observe(0, SETTLE_AT, 5_330)).toBe("refused");
    expect(hand.predicting).toBe(false);
    expect(hand.slotOf(0)).toBe(0);
    expect(hand.counts).toEqual({ confirmed: 0, refused: 1, expired: 0 });
  });

  it("gives up after ORDER_EXPIRE_MS when no patch settles it", () => {
    const hand = pressed();
    expect(hand.observe(0, PATCH_T + 50, 5_000 + ORDER_EXPIRE_MS - 1)).toBe("pending");
    expect(hand.observe(0, PATCH_T + 50, 5_000 + ORDER_EXPIRE_MS)).toBe("expired");
    expect(hand.slotOf(0)).toBe(0);
    expect(hand.counts.expired).toBe(1);
  });

  it("never refuses on a patch that is not newer than the one the key was pressed against", () => {
    const hand = new LocalHand();
    // A clock estimate that runs ahead of the patches could put the settle time under the newest patch; that patch says nothing.
    hand.predict(1, 0, 20_000, 5_000, C, 0);
    expect(hand.observe(0, 20_000, 5_010)).toBe("pending");
    expect(hand.observe(0, 20_050, 5_060)).toBe("refused");
  });

  it("a second press replaces the first: a patch with the intermediate slot is not an answer, the final one is", () => {
    const hand = pressed(1);
    hand.predict(0, 0, PATCH_T, 5_050, C + 50, DELAY); // Q Q: back to slot 0
    expect(hand.slotOf(0)).toBe(0);
    // The first swap's patch shows slot 1, which is not the target; the second's shows slot 0, which is, but only at the settle time.
    expect(hand.observe(1, APPLY_AT, 5_200)).toBe("pending");
    expect(hand.slotOf(1)).toBe(0);
    expect(hand.observe(0, APPLY_AT + 50, 5_250)).toBe("pending"); // the same slot as the start, but before the settle: not yet an answer
    expect(hand.observe(0, APPLY_AT + 50 + SWAP_SETTLE_SLACK_MS, 5_360)).toBe("confirmed");
    expect(hand.counts).toEqual({ confirmed: 1, refused: 0, expired: 0 });
  });

  it("three presses: an intermediate patch that equals the last target does not end it early", () => {
    const hand = pressed(1);
    hand.predict(0, 0, PATCH_T, 5_020, C + 20, DELAY);
    hand.predict(1, 0, PATCH_T, 5_040, C + 40, DELAY);
    const settle = C + 40 + DELAY + TICK_MS + SWAP_SETTLE_SLACK_MS;
    expect(hand.observe(1, APPLY_AT, 5_200)).toBe("pending"); // after the first swap: slot 1 = the last target
    expect(hand.observe(0, APPLY_AT + 50, 5_250)).toBe("pending");
    expect(hand.observe(1, settle, 5_400)).toBe("confirmed");
  });

  it("a second press that the server refuses (a stun in between) snaps back to where the hand really is", () => {
    const hand = pressed(1);
    hand.predict(0, 0, PATCH_T, 5_050, C + 50, DELAY);
    // The first swap landed, the second did not: the server holds slot 1 past the settle time of the second.
    expect(hand.observe(1, C + 50 + DELAY + TICK_MS + SWAP_SETTLE_SLACK_MS, 5_400)).toBe("refused");
    expect(hand.slotOf(1)).toBe(1);
  });

  it("clear and reset forget the prediction; reset also zeroes the counts", () => {
    const hand = pressed();
    hand.clear();
    expect(hand.predicting).toBe(false);
    expect(hand.applyAt).toBe(0);
    expect(hand.counts.confirmed).toBe(0);
    const used = pressed();
    used.observe(1, APPLY_AT, 5_300);
    used.reset();
    expect(used.counts).toEqual({ confirmed: 0, refused: 0, expired: 0 });
  });

  it("a negative order delay counts as none, and the swap is applied no sooner than the next tick", () => {
    const hand = new LocalHand();
    hand.predict(1, 0, PATCH_T, 5_000, C, -TICK_MS);
    expect(hand.applyAt).toBe(C + TICK_MS);
  });
});

describe("weaponInSlot", () => {
  it("reads the slot's weapon, fists for an empty slot or an id the catalog lacks", () => {
    const hand = { weapon0: "wand", weapon1: "" };
    expect(weaponInSlot(hand, 0)).toBe("wand");
    expect(weaponInSlot(hand, 1)).toBe("fists");
    expect(weaponInSlot({ weapon0: "spear", weapon1: "axe" }, 0)).toBe("fists");
    expect(weaponInSlot({ weapon0: "spear", weapon1: "axe" }, 1)).toBe("axe");
  });
});

describe("predictedReadyAt", () => {
  it("is the shared cooldown still running, or the apply time, plus the swap time", () => {
    expect(predictedReadyAt(10_900, 10_170)).toBe(10_900 + SWAP_SECONDS * 1000);
    expect(predictedReadyAt(9_000, 10_170)).toBe(10_170 + SWAP_SECONDS * 1000);
    expect(predictedReadyAt(10_900, 10_170)).toBe(swapReadyAt(10_900, 10_170));
  });
});
