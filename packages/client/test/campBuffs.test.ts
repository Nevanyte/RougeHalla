import { describe, expect, it } from "vitest";
import { generateMap, MOB_STAT_REWARDS, Y_SCALE } from "@raid/shared";
import { CampBuffs, mobRewardIcon } from "../src/render/CampBuffs";
import { fakeScene } from "./fakes";

const MAP = generateMap(7);
const ONE_CAMP = { ...MAP, camps: [MAP.camps[0]!] };
const RUNTIME = [{ state: 0, type: "emberImp", elite: "wyrmling" }];
const MOBS = [
  { camp: 1, kind: "mob", status: "alive", type: "emberImp", x: 100, y: 120 },
  { camp: 1, kind: "elite", status: "alive", type: "wyrmling", x: 140, y: 160 },
  { camp: 1, kind: "mob", status: "dead", type: "emberImp", x: 300, y: 300 },
];

describe("CampBuffs", () => {
  it("shows one cached group marker with actual normal and living-elite rewards", () => {
    const { scene, ofKind } = fakeScene();
    const view = new CampBuffs(scene);
    view.update(ONE_CAMP, RUNTIME, true, () => true, MOBS as never);
    const root = ofKind("container")[0]!;
    expect(ofKind("container")).toHaveLength(1);
    expect(ofKind("graphics")).toHaveLength(1);
    expect(ofKind("text")).toHaveLength(1);
    expect(ofKind("text")[0]!.args[2]).toContain("Ember Imp: +1% damage per kill");
    expect(ofKind("text")[0]!.args[2]).toContain("Wyrmling: drops an Augment chest");
    expect(root.calls.filter(([name]) => name === "setPosition")[0]?.[1]).toEqual([120, 120 * Y_SCALE - 47 - 44]);
    const count = [ofKind("container").length, ofKind("graphics").length, ofKind("text").length];
    view.update(ONE_CAMP, RUNTIME, true, () => true, MOBS as never);
    expect([ofKind("container").length, ofKind("graphics").length, ofKind("text").length]).toEqual(count);
    view.update(ONE_CAMP, RUNTIME, true, () => true, [MOBS[0]!, { ...MOBS[1]!, status: "dead" }] as never);
    expect(ofKind("text").at(-1)!.args[2]).not.toContain("Wyrmling");
    view.destroy();
  });

  it("hides unknown, cleared, inactive, and unseen camps and resets cached marks", () => {
    const { scene, ofKind } = fakeScene();
    const view = new CampBuffs(scene);
    view.update(ONE_CAMP, RUNTIME, true, () => true, MOBS as never);
    const root = ofKind("container")[0]!;
    view.update(ONE_CAMP, [{ ...RUNTIME[0]!, state: 2 }], true, () => true, MOBS as never);
    expect(root.state.visible).toBe(false);
    view.update(ONE_CAMP, [{ ...RUNTIME[0]!, state: 0, type: "future-mob" }], true, () => true,
      [{ ...MOBS[0]!, type: "future-mob" }] as never);
    expect(root.state.visible).toBe(false);
    view.update(ONE_CAMP, RUNTIME, true, () => false, MOBS as never);
    expect(root.state.visible).toBe(false);
    view.update(ONE_CAMP, RUNTIME, false, () => true, MOBS as never);
    expect(root.state.visible).toBe(false);
    view.update(ONE_CAMP, RUNTIME, true, () => true, MOBS as never);
    expect(root.state.visible).toBe(true);
    view.reset();
    expect(root.state.visible).toBe(false);
    view.destroy();
  });

  it("maps every normal mob reward to its actual stat icon", () => {
    const expected = new Map([
      ["damage", "damage"], ["moveSpeed", "speed"], ["maxHp", "health"], ["armor", "armor"],
      ["shield", "mr"], ["attackSpeed", "attackSpeed"], ["lifesteal", "leech"], ["ad", "ad"], ["ap", "ap"],
    ]);
    for (const reward of MOB_STAT_REWARDS) {
      expect(mobRewardIcon(reward.effect.stat), reward.id).toBe(expected.get(reward.effect.stat));
    }
  });
});
