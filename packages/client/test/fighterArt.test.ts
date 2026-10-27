import { describe, expect, it } from "vitest";
import { BOW_WINDUP, FACTIONS, WIRE_IDENTITY_MIRRORS, encodeMult, mirrorTimings } from "@raid/shared";
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

  it("reads an empty slot as fists for a fighter with a faction", () => {
    expect(heldWeapon({ weapon0: "bow", weapon1: "", slot: 1, faction: "fire" })).toBe("fists");
    expect(heldWeapon({ weapon0: "", weapon1: "", slot: 0, faction: "holy" })).toBe("fists");
    expect(heldWeapon({ weapon0: "", weapon1: "axe", slot: 1, faction: "holy" })).toBe("axe");
    // No faction (a training dummy): nothing is drawn. An unknown id is nothing either way.
    expect(heldWeapon({ weapon0: "", weapon1: "", slot: 0, faction: "" })).toBeNull();
    expect(heldWeapon({ weapon0: "spear", weapon1: "", slot: 0, faction: "fire" })).toBeNull();
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
  // The server's bow windup (sim/combatant.ts timingsOf(...).windup on a real PlayerState of each faction whose `asMult` and
  // `windupMult` mirrors hold the encoded value, 9 decimals): one row per windup mirror (x1, x0.85, x1.2), one column per
  // attack-speed mirror (x1, x1.05, x1.25, x1.6). server/test/mobHunt.test.ts compares the bots' copy of the formula with
  // timingsOf live; this is the client's half: a draw gauge that drifts from the server's shows a full bow before (or after)
  // it is. The client reads the MIRRORS the server folds its cards into, in wire form (thousandths). Regenerate with the weapon
  // numbers (weapons.ts / factions.ts) when they change; BOW_WINDUP and BOW_WINDUP_SHARE (the controls tuning lever) move
  // every entry. A windup mirror below 1 shortens no bow draw (owner ruling "Melee windups only": Quickdraw is for the sword, the
  // bash and the axe): the x0.85 row equals the x1 row for every faction. Since the balance pass (G9, shared mirrorTimings) attack
  // speed shortens no bow draw either: a windup that is a share of the interval (Sentenced, Plague, Holy) stays at its base-speed
  // value when the fighter is faster, so every column of the x1 and x0.85 rows is the same number (the anti-kiting lever).
  const AS = [1, 1.05, 1.25, 1.6];
  const WINDUP = [1, 0.85, 1.2];
  const SERVER_FULL_DRAW: Record<string, readonly (readonly number[])[]> = {
    fire: [[0.6, 0.6, 0.6, 0.6], [0.6, 0.6, 0.6, 0.6], [0.72, 0.72, 0.683760684, 0.6]],
    sentenced: [
      [0.524216524, 0.524216524, 0.524216524, 0.524216524],
      [0.524216524, 0.524216524, 0.524216524, 0.524216524],
      [0.56980057, 0.542667209, 0.524216524, 0.524216524],
    ],
    plague: [[0.255024255, 0.255024255, 0.255024255, 0.255024255], [0.255024255, 0.255024255, 0.255024255, 0.255024255], [0.277200277, 0.264000264, 0.255024255, 0.255024255]],
    frost: [[0.6, 0.6, 0.6, 0.6], [0.6, 0.6, 0.6, 0.6], [0.72, 0.72, 0.72, 0.712250712]],
    holy: [
      [0.496626181, 0.496626181, 0.496626181, 0.496626181],
      [0.496626181, 0.496626181, 0.496626181, 0.496626181],
      [0.539811066, 0.514105777, 0.496626181, 0.496626181],
    ],
  };
  /** The wire value the server writes for a multiplier. */
  const wire = encodeMult;
  const IDENTITY = WIRE_IDENTITY_MIRRORS.asMult;

  it("equals the server's full draw for every faction at every attack-speed and windup mirror", () => {
    for (const [faction, rows] of Object.entries(SERVER_FULL_DRAW)) {
      WINDUP.forEach((wu, r) => AS.forEach((as, c) => {
        expect(fullDrawSeconds(faction, wire(as), wire(wu)), `${faction} as x${as} windup x${wu}`).toBeCloseTo(rows[r]![c]!, 8);
      }));
    }
  });

  it("the identity mirrors (1000 thousandths) are the unbuffed draw, and so is a fighter with none (a mob); 0 without a faction", () => {
    expect(IDENTITY).toBe(1000);
    for (const [faction, rows] of Object.entries(SERVER_FULL_DRAW)) {
      expect(fullDrawSeconds(faction, IDENTITY, IDENTITY), faction).toBeCloseTo(rows[0]![0]!, 8);
      expect(fullDrawSeconds(faction, undefined, undefined), faction).toBeCloseTo(rows[0]![0]!, 8);
      expect(fullDrawSeconds(faction), faction).toBe(fullDrawSeconds(faction, IDENTITY, IDENTITY));
    }
    expect(fullDrawSeconds("", wire(1.5))).toBe(0);
    expect(fullDrawSeconds("nobody", wire(1.5))).toBe(0);
  });

  it("is never shorter than at base speed for a faster fighter (G9), and grows with a slower one up to the cap", () => {
    for (const f of ["fire", "frost", "sentenced", "plague", "holy"]) {
      for (const as of [1.05, 1.25, 1.6, 20]) expect(fullDrawSeconds(f, wire(as)), `${f} x${as}`).toBe(fullDrawSeconds(f));
    }
    // A Sentenced bow's windup is a share of its interval: at attack speed x0.8 it would be 0.655 s, so the cap holds it at BOW_WINDUP.
    expect(fullDrawSeconds("sentenced", wire(0.9))).toBeGreaterThan(fullDrawSeconds("sentenced"));
    expect(fullDrawSeconds("sentenced", wire(0.8))).toBe(BOW_WINDUP);
  });

  it("follows the mirrors alone, through the shared formulas", () => {
    // 1.5 is no buff's multiplier in particular: any source of attack speed or windup shows in the draw.
    const t = mirrorTimings(FACTIONS.sentenced, "bow", 1.5, 1.2);
    expect(fullDrawSeconds("sentenced", wire(1.5), wire(1.2))).toBeCloseTo(t.windup, 12);
    expect(fullDrawSeconds("sentenced", wire(1.5))).toBe(fullDrawSeconds("sentenced"));
    expect(mirrorTimings(FACTIONS.sentenced, "bow", 0.9, 1.2).windup).toBeCloseTo(fullDrawSeconds("sentenced", wire(0.9), wire(1.2)), 12);
    expect(fullDrawSeconds("fire", IDENTITY, wire(1.05))).toBeCloseTo(0.63, 12);
  });

  it("the windup mirror lengthens the pull on its own, and a mirror below 1 never shortens it (the ranged windups are the lever)", () => {
    expect(fullDrawSeconds("sentenced", IDENTITY, wire(1.2))).toBeGreaterThan(fullDrawSeconds("sentenced"));
    expect(fullDrawSeconds("fire", IDENTITY, wire(1.2))).toBeCloseTo(0.72, 12);
    // Quickdraw rank 1 (x0.5) and rank 2 (x0.25), and anything else below 1: the bow draws as it did.
    for (const f of ["fire", "frost", "sentenced", "plague", "holy"]) {
      for (const m of [0.92, 0.88, 0.85, 0.5, 0.25, 0.05]) {
        expect(fullDrawSeconds(f, IDENTITY, wire(m)), `${f} x${m}`).toBe(fullDrawSeconds(f));
        expect(fullDrawSeconds(f, wire(1.25), wire(m)), `${f} x${m} at attack speed x1.25`).toBe(fullDrawSeconds(f, wire(1.25)));
      }
    }
    expect(fullDrawSeconds("fire", IDENTITY, wire(0.25))).toBe(BOW_WINDUP);
  });

  it("is what the gauge uses: a faster rate no longer fills the pull early (G9), a longer windup fills it later", () => {
    // 0.45 s into a Sentenced bow's draw: 86% of the 0.524 s base pull. Attack speed x1.25 once made it full (0.419 s) and the gauge
    // glowed; since G9 the pull stays 0.524 s, as the server holds it, so it does not. A windup x0.85 does not shorten it (a windup
    // mod never shortens a ranged windup), and 0.45 s of a windup x1.2 draw (0.570 s) is not full.
    const glowingAt = (elapsed: number, fields: Partial<FighterFields>) => {
      const { art, calls } = setup();
      art.update({ ...bowman(1000), faction: "sentenced", ...fields }, 1000 + elapsed, 1000 + elapsed);
      return calls().includes("strokeCircle");
    };
    expect(glowingAt(450, {})).toBe(false);
    expect(glowingAt(450, { asMult: IDENTITY, windupMult: IDENTITY })).toBe(false);
    expect(glowingAt(450, { asMult: wire(1.25) })).toBe(false);
    expect(glowingAt(450, { windupMult: wire(0.85) })).toBe(false);
    expect(glowingAt(450, { windupMult: wire(1.2) })).toBe(false);
    expect(glowingAt(450, { asMult: wire(1.25), windupMult: wire(1.2) })).toBe(false);
    // Past the base pull (0.524 s) the faster bow is full, as the server looses it; a longer windup alone is not yet (0.570 s), and a
    // faster rate takes that back (the windup cannot pass the interval, mirrorTimings: 0.524 s in the table above).
    expect(glowingAt(530, { asMult: wire(1.25) })).toBe(true);
    expect(glowingAt(530, { asMult: wire(1.6) })).toBe(true);
    expect(glowingAt(530, { windupMult: wire(1.2) })).toBe(false);
    expect(glowingAt(530, { asMult: wire(1.25), windupMult: wire(1.2) })).toBe(true);
  });

  it("the gauge's full draw is never early for a windup mirror below 1: a Fire bow is not full at 0.56 s, whatever the mirror, and is at 0.6 s", () => {
    const glowingAt = (elapsed: number, fields: Partial<FighterFields>) => {
      const { art, calls } = setup();
      art.update({ ...bowman(1000), faction: "fire", ...fields }, 1000 + elapsed, 1000 + elapsed);
      return calls().includes("strokeCircle");
    };
    for (const m of [1, 0.92, 0.88, 0.5, 0.25]) {
      expect(glowingAt(540, { windupMult: wire(m) }), `x${m} at 0.54 s`).toBe(false);
      expect(glowingAt(560, { windupMult: wire(m) }), `x${m} at 0.56 s`).toBe(false);
      expect(glowingAt(600, { windupMult: wire(m) }), `x${m} at 0.6 s`).toBe(true);
    }
    expect(glowingAt(700, { windupMult: wire(1.2) }), "x1.2 at 0.7 s (0.72 s draw)").toBe(false);
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
