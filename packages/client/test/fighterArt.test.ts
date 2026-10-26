import { describe, expect, it } from "vitest";
import { FACTIONS, attackInterval, buffMultiplier, encodeMult, weaponTimings } from "@raid/shared";
import { BARRIER_COLOR } from "../src/ui/buffTheme";
import { DrawTrack, FighterArt, HpBar, fullDrawSeconds, heldWeapon, type FighterFields } from "../src/render/FighterArt";
import { argsOf, fakeScene, type FakeObject } from "./fakes";

/** The weapon in hand is an Image of a baked drawing: `drawing()` reads what the bake it shows now drew. */
function setup() {
  const { scene, ofKind, baked } = fakeScene();
  const art = new FighterArt(scene);
  const held = ofKind("image")[1]!;
  const calls = () => (baked.get(String(held.state.texture))?.calls ?? []).map(([n]) => n);
  /** The bow shows a nocked arrow (a lineBetween from the nock to the arrowhead) only while a draw is on screen. */
  const drawing = () => calls().includes("lineBetween");
  return { art, drawing, calls };
}

const bowman = (drawStartedAt: number): FighterFields => ({
  facing: 0, faction: "sentenced", weapon0: "bow", weapon1: "", slot: 0, drawStartedAt,
});

describe("heldWeapon", () => {
  it("reads the slot in hand and ignores unknown ids", () => {
    expect(heldWeapon({ weapon0: "bow", weapon1: "axe", slot: 1 })).toBe("axe");
    expect(heldWeapon({ weapon0: "bow", weapon1: "", slot: 1 })).toBeNull();
    expect(heldWeapon({ weapon0: "spear", weapon1: "", slot: 0 })).toBeNull();
  });
});

describe("bow draw display", () => {
  it("shows the draw once render time reaches its start, not before", () => {
    const { art, drawing } = setup();
    art.update(bowman(1000), 900, 1050);
    expect(drawing()).toBe(false);
    art.update(bowman(1000), 1010, 1050);
    expect(drawing()).toBe(true);
  });

  it("keeps showing it when a chill pushes the start a few ms past render time", () => {
    const { art, drawing } = setup();
    art.update(bowman(1000), 1100, 1200);
    expect(drawing()).toBe(true);
    // The start moves 30 ms later at each patch; render time is only 10 ms past the old one.
    art.update(bowman(1090), 1100, 1250);
    expect(drawing()).toBe(true);
    art.update(bowman(1120), 1105, 1300);
    expect(drawing()).toBe(true);
  });

  it("treats a start far ahead (a stagger restart) as a new draw that waits for render time", () => {
    const { art, drawing } = setup();
    art.update(bowman(1000), 1100, 1200);
    expect(drawing()).toBe(true);
    art.update(bowman(1500), 1300, 1600);
    expect(drawing()).toBe(false);
    art.update(bowman(1500), 1520, 1600);
    expect(drawing()).toBe(true);
  });

  it("keeps the pull until render time reaches the moment the draw stopped, then drops it", () => {
    const { art, drawing } = setup();
    art.update(bowman(1000), 1100, 1200);
    art.update(bowman(0), 1150, 1250); // loosed at patch 1250
    expect(drawing()).toBe(true);
    art.update(bowman(0), 1260, 1300);
    expect(drawing()).toBe(false);
  });
});

describe("bow draw start under a chill", () => {
  // A chill pushes the start 30 ms later at every 50 ms tick; the patch at 1000 + 50k carries start 1000 + 30k.
  const patchT = (k: number) => 1000 + 50 * k;
  const startAt = (k: number) => 1000 + 30 * k;

  it("uses the start the server had at render time, not the newest one", () => {
    const t = new DrawTrack();
    for (let k = 0; k <= 30; k++) {
      // Render time trails the newest patch by 100 ms; three frames before the next patch arrives.
      for (const dt of [0, 16, 33]) {
        const renderT = patchT(k) - 100 + dt;
        const drawing = t.track(startAt(k), renderT, patchT(k));
        const j = Math.min(k, Math.max(0, Math.floor((renderT - 1000) / 50)));
        expect(t.start).toBe(startAt(j));
        expect(drawing).toBe(renderT >= startAt(j));
        // The old behaviour (the newest start) would understate the pull by 30 ms per tick of delay.
        if (k >= 3) expect(t.start).toBeLessThan(startAt(k));
      }
    }
  });

  it("an unchilled draw keeps its one start", () => {
    const t = new DrawTrack();
    for (let k = 0; k < 10; k++) {
      t.track(1000, patchT(k) - 100, patchT(k));
      expect(t.start).toBe(1000);
    }
  });

  it("a restart far ahead drops the old starts and waits for render time", () => {
    const t = new DrawTrack();
    for (let k = 0; k < 6; k++) t.track(startAt(k), patchT(k) - 100, patchT(k));
    expect(t.track(2000, 1400, 1500)).toBe(false);
    expect(t.start).toBe(2000);
    expect(t.track(2000, 2010, 2100)).toBe(true);
  });

  it("keeps the pull until render time reaches the end, then clears", () => {
    const t = new DrawTrack();
    t.track(1000, 1100, 1200);
    expect(t.track(0, 1150, 1250)).toBe(true);
    expect(t.track(0, 1260, 1300)).toBe(false);
    expect(t.start).toBe(0);
  });
});

describe("fullDrawSeconds", () => {
  // The server's bow windup (sim/combatant.ts timingsOf(...).windup on a real player of each faction, 9 decimals) for 0, 1.1, 3
  // and 7 attack-speed stacks. server/test/mobHunt.test.ts compares the bots' copy of the formula with timingsOf live; this is the
  // client's half: a draw gauge that drifts from the server's shows a full bow before (or after) it is. The client reads the
  // attack-speed MIRROR the server folds those stacks into (`asMult`), so each row is checked at the mirror the stacks give.
  // Regenerate with the weapon numbers (weapons.ts / factions.ts) when they change; BOW_WINDUP and BOW_WINDUP_SHARE (the controls
  // tuning lever) move every entry.
  const SERVER_FULL_DRAW: Record<string, readonly number[]> = {
    fire: [0.6, 0.6, 0.6, 0.535901332],
    sentenced: [0.524216524, 0.503405103, 0.427482716, 0.357267554],
    plague: [0.255024255, 0.24489978, 0.23, 0.23],
    frost: [0.6, 0.6, 0.6, 0.6],
    holy: [0.496626181, 0.476910097, 0.404983625, 0.338463999],
  };
  const STACKS = [0, 1.1, 3, 7];
  /** The mirror the server writes for `stacks` attack-speed stacks. */
  const mirror = (stacks: number) => encodeMult(buffMultiplier("attackSpeed", stacks));

  it("equals the server's full draw for every faction at the mirror of 0, 1.1, 3 and 7 attack-speed stacks", () => {
    for (const [faction, row] of Object.entries(SERVER_FULL_DRAW)) {
      STACKS.forEach((stacks, i) => expect(fullDrawSeconds(faction, mirror(stacks)), `${faction} with ${stacks} stacks`).toBeCloseTo(row[i]!, 8));
    }
  });

  it("a mirror of exactly 1 is the unbuffed draw, and so is a fighter with none (a mob) and 0 without a faction", () => {
    for (const [faction, row] of Object.entries(SERVER_FULL_DRAW)) {
      expect(fullDrawSeconds(faction, 1), faction).toBeCloseTo(row[0]!, 8);
      expect(fullDrawSeconds(faction, undefined), faction).toBeCloseTo(row[0]!, 8);
      expect(fullDrawSeconds(faction), faction).toBe(fullDrawSeconds(faction, 1));
    }
    expect(fullDrawSeconds("", 1.5)).toBe(0);
    expect(fullDrawSeconds("nobody", 1.5)).toBe(0);
  });

  it("shortens with the mirror until the bow's interval floor", () => {
    expect(fullDrawSeconds("sentenced", mirror(7))).toBeLessThan(fullDrawSeconds("sentenced", 1) - 0.1);
    expect(fullDrawSeconds("plague", mirror(7))).toBe(fullDrawSeconds("plague", mirror(20)));
  });

  it("follows the mirror alone: a mirror shortens it with no stacks anywhere", () => {
    // 1.5 is no stack count's multiplier in particular: any source of attack speed shows in the draw.
    expect(fullDrawSeconds("sentenced", 1.5)).toBeLessThan(fullDrawSeconds("sentenced", 1));
    expect(fullDrawSeconds("sentenced", 1.5)).toBeCloseTo(weaponTimings("bow", attackInterval(FACTIONS.sentenced, "bow", 1.5)).windup, 12);
  });

  it("is what the gauge uses: the same draw is full with the mirror and not without", () => {
    // 0.45 s into a Sentenced bow's draw: 86% of the unbuffed 0.524 s, but a full draw at 3 stacks' mirror (0.427 s), which glows.
    const glowing = (fields: Partial<FighterFields> & { stacksAs?: number }) => {
      const { art, calls } = setup();
      art.update({ ...bowman(1000), faction: "sentenced", ...fields }, 1450, 1450);
      return calls().includes("strokeCircle");
    };
    expect(glowing({})).toBe(false);
    expect(glowing({ asMult: 1 })).toBe(false);
    expect(glowing({ asMult: mirror(3) })).toBe(true);
    // Stacks without the mirror (a stale or unknown field) do not shorten the gauge: the mirror is what the server simulated with.
    expect(glowing({ stacksAs: 3, asMult: 1 })).toBe(false);
  });
});

describe("HpBar", () => {
  const GREEN = 0x66bb6a;
  const YELLOW = 0xffca28;
  const RED = 0xef5350;
  function bar() {
    const { scene, ofKind } = fakeScene();
    const hp = new HpBar(scene);
    const root = ofKind("container")[0]!;
    const [back, fill, barrier] = root.args[2] as FakeObject[];
    /** The sizes the hp rectangle was given, in order: one per repaint. */
    const sizes = () => argsOf(fill!, "setDisplaySize");
    /** The colours it was tinted with, in order. */
    const tints = () => argsOf(fill!, "setTint").map((a) => a[0]);
    return { hp, root, back: back!, fill: fill!, barrier: barrier!, sizes, tints };
  }

  it("repaints when hp changes by half a pixel and not before", () => {
    const { hp, sizes } = bar();
    hp.draw(1000, 1000, 0, 0);
    expect(sizes()).toHaveLength(1);
    hp.draw(1000, 1000, 0, 0);
    expect(sizes()).toHaveLength(1);
    hp.draw(999, 1000, 0, 0); // 28 px bar: 56 half pixels, one is 17.9 hp
    expect(sizes()).toHaveLength(1);
    hp.draw(900, 1000, 0, 0);
    expect(sizes()).toHaveLength(2);
    expect(sizes()[1]).toEqual([25, 4]); // 90% of the 28 px bar, to the half pixel
  });

  it("repaints with the new colour when hp crosses 50% or 25% inside the same half pixel", () => {
    const { hp, sizes, tints } = bar();
    hp.draw(501, 1000, 0, 0);
    expect(tints()).toEqual([GREEN]);
    hp.draw(499, 1000, 0, 0); // the same 28 half pixels
    expect(sizes()).toHaveLength(2);
    expect(tints()).toEqual([GREEN, YELLOW]);
    hp.draw(251, 1000, 0, 0);
    hp.draw(249, 1000, 0, 0);
    expect(tints().at(-1)).toBe(RED);
  });

  it("colours by hp against max hp, so a barrier that shrinks the bar leaves healthy hp green", () => {
    const { hp, tints, barrier } = bar();
    hp.draw(700, 1000, 800, 0); // hp is 70% of max hp but 47% of the shrunken bar
    expect(tints()).toEqual([GREEN]);
    expect(barrier.state.visible).toBe(true);
    expect(argsOf(barrier, "setTint")[0]).toEqual([BARRIER_COLOR]);
  });

  it("lays the barrier after the hp, with the backing under both", () => {
    const { hp, back, fill, barrier } = bar();
    hp.draw(500, 1000, 150, 0);
    expect(argsOf(back, "setDisplaySize")[0]).toEqual([28, 4]);
    const [fx, fw] = [argsOf(fill, "setPosition")[0]![0] as number, argsOf(fill, "setDisplaySize")[0]![0] as number];
    expect(argsOf(barrier, "setPosition")[0]![0]).toBeCloseTo(fx + fw, 9);
    expect(argsOf(barrier, "setDisplaySize")[0]![0]).toBeGreaterThan(0);
  });

  it("hides (once) and draws again afterwards", () => {
    const { hp, root } = bar();
    hp.draw(500, 1000, 0, 0);
    expect(root.state.visible).toBe(true);
    hp.hide();
    expect(root.state.visible).toBe(false);
    const hides = argsOf(root, "setVisible").length;
    hp.hide();
    expect(argsOf(root, "setVisible")).toHaveLength(hides);
    hp.draw(500, 1000, 0, 0);
    expect(root.state.visible).toBe(true);
  });
});
