import { describe, expect, it } from "vitest";
import { BOW_WINDUP, BOW_WINDUP_FLOOR, FACTIONS, WIRE_IDENTITY_MIRRORS, attackInterval, encodeMult, scaleWindup, weaponTimings } from "@raid/shared";
import { BARRIER_COLOR } from "../src/ui/buffTheme";
import { DrawTrack, FighterArt, HpBar, fullDrawSeconds, heldWeapon, type FighterFields } from "../src/render/FighterArt";
import { argsOf, fakeScene } from "./fakes";

/** A stand-in for Phaser's Graphics that records the draw calls made since its last clear(). */
function fakeGraphics() {
  const calls: string[] = [];
  const g: Record<string, unknown> = new Proxy({ calls }, {
    get(target, prop: string) {
      if (prop === "calls") return target.calls;
      return (..._args: unknown[]) => {
        if (prop === "clear") calls.length = 0;
        else calls.push(prop);
        return g;
      };
    },
  });
  return g as { calls: string[] } & Record<string, unknown>;
}

function setup() {
  const graphics = [fakeGraphics(), fakeGraphics()];
  let i = 0;
  const scene = { add: { graphics: () => graphics[i++] } };
  const art = new FighterArt(scene as any);
  /** The bow shows a nocked arrow (a lineBetween from the nock to the arrowhead) only while a draw is on screen. */
  const drawing = () => graphics[1]!.calls.includes("lineBetween");
  return { art, drawing };
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
  // The server's bow windup (sim/combatant.ts timingsOf(...).windup on a real PlayerState of each faction whose `asMult` and
  // `windupMult` mirrors hold the encoded value, 9 decimals): one row per windup mirror (x1, x0.85, x1.2), one column per
  // attack-speed mirror (x1, x1.05, x1.25, x1.6). server/test/mobHunt.test.ts compares the bots' copy of the formula with
  // timingsOf live; this is the client's half: a draw gauge that drifts from the server's shows a full bow before (or after)
  // it is. The client reads the MIRRORS the server folds its buffs into, in wire form (thousandths). Regenerate with the weapon
  // numbers (weapons.ts / factions.ts) when they change; BOW_WINDUP and BOW_WINDUP_SHARE (the controls tuning lever) move
  // every entry. A windup mirror below 1 shortens the draw only down to BOW_WINDUP_FLOOR (0.55 s): the x0.85 row is 0.55 for the
  // cap-bound Fire and Frost bows and the x1 row for the others, whose draws are already under the floor.
  const AS = [1, 1.05, 1.25, 1.6];
  const WINDUP = [1, 0.85, 1.2];
  const SERVER_FULL_DRAW: Record<string, readonly (readonly number[])[]> = {
    fire: [[0.6, 0.6, 0.6, 0.491452991], [0.55, 0.55, 0.55, 0.491452991], [0.72, 0.72, 0.683760684, 0.534188034]],
    sentenced: [
      [0.524216524, 0.499253833, 0.419373219, 0.327635328],
      [0.524216524, 0.499253833, 0.419373219, 0.327635328],
      [0.56980057, 0.542667209, 0.455840456, 0.356125356],
    ],
    plague: [[0.255024255, 0.242880243, 0.23, 0.23], [0.255024255, 0.242880243, 0.23, 0.23], [0.277200277, 0.264000264, 0.25, 0.25]],
    frost: [[0.6, 0.6, 0.6, 0.6], [0.55, 0.55, 0.55, 0.55], [0.72, 0.72, 0.72, 0.712250712]],
    holy: [
      [0.496626181, 0.472977315, 0.397300945, 0.310391363],
      [0.496626181, 0.472977315, 0.397300945, 0.310391363],
      [0.539811066, 0.514105777, 0.431848853, 0.337381916],
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

  it("shortens with the attack-speed mirror until the bow's interval floor", () => {
    expect(fullDrawSeconds("sentenced", wire(1.6))).toBeLessThan(fullDrawSeconds("sentenced", IDENTITY) - 0.1);
    expect(fullDrawSeconds("plague", wire(1.6))).toBe(fullDrawSeconds("plague", wire(20)));
  });

  it("follows the mirrors alone, through the shared formulas", () => {
    // 1.5 is no buff's multiplier in particular: any source of attack speed or windup shows in the draw.
    const t = scaleWindup(weaponTimings("bow", attackInterval(FACTIONS.sentenced, "bow", 1.5)), 0.8);
    expect(fullDrawSeconds("sentenced", wire(1.5), wire(0.8))).toBeCloseTo(t.windup, 12);
    expect(fullDrawSeconds("sentenced", wire(1.5))).toBeLessThan(fullDrawSeconds("sentenced"));
    expect(fullDrawSeconds("fire", IDENTITY, wire(0.95))).toBeCloseTo(0.57, 12);
  });

  it("the windup mirror scales the pull on its own: a longer windup, a longer draw, and a shorter one only down to the floor", () => {
    expect(fullDrawSeconds("sentenced", IDENTITY, wire(1.2))).toBeGreaterThan(fullDrawSeconds("sentenced"));
    expect(fullDrawSeconds("fire", IDENTITY, wire(1.2))).toBeCloseTo(0.72, 12);
    // Quickdraw rank 1 (x0.92) is above the 0.55 s floor, rank 2 (x0.88, 0.528 s) is held at it, and so is anything shorter.
    expect(fullDrawSeconds("fire", IDENTITY, wire(0.92))).toBeCloseTo(0.552, 12);
    for (const m of [0.88, 0.85, 0.5, 0.05]) {
      expect(fullDrawSeconds("fire", IDENTITY, wire(m)), `fire x${m}`).toBe(BOW_WINDUP_FLOOR);
      expect(fullDrawSeconds("frost", IDENTITY, wire(m)), `frost x${m}`).toBe(BOW_WINDUP_FLOOR);
    }
    // Sentenced's, Plague's and Holy's draws are already under the floor (share-bound): a shorter windup leaves them alone.
    for (const f of ["sentenced", "plague", "holy"]) {
      expect(fullDrawSeconds(f, IDENTITY, wire(0.88)), f).toBe(fullDrawSeconds(f));
      expect(fullDrawSeconds(f, wire(1.25), wire(0.5)), f).toBe(fullDrawSeconds(f, wire(1.25)));
    }
    expect(BOW_WINDUP_FLOOR).toBeLessThan(BOW_WINDUP);
  });

  it("is what the gauge uses: the same draw is full with the mirror and not without", () => {
    // 0.45 s into a Sentenced bow's draw: 86% of the unbuffed 0.524 s, but a full draw at attack speed x1.25 (0.419 s), which
    // glows; a windup x0.85 does not shorten it (0.524 s is under the bow's 0.55 s floor), and 0.45 s of a windup x1.2 draw
    // (0.570 s) is not full.
    const glowing = (fields: Partial<FighterFields>) => {
      const graphics = [fakeGraphics(), fakeGraphics()];
      let i = 0;
      const art = new FighterArt({ add: { graphics: () => graphics[i++] } } as never);
      art.update({ ...bowman(1000), faction: "sentenced", ...fields }, 1450, 1450);
      return graphics[1]!.calls.includes("strokeCircle");
    };
    expect(glowing({})).toBe(false);
    expect(glowing({ asMult: IDENTITY, windupMult: IDENTITY })).toBe(false);
    expect(glowing({ asMult: wire(1.25) })).toBe(true);
    expect(glowing({ windupMult: wire(0.85) })).toBe(false);
    expect(glowing({ windupMult: wire(1.2) })).toBe(false);
    // Both together: a longer windup against a faster rate.
    expect(glowing({ asMult: wire(1.25), windupMult: wire(1.2) })).toBe(false);
  });

  it("the gauge's full draw follows the floor: a Fire bow at 0.54 s is not full for any windup mirror, at 0.56 s it is for x0.88 and under", () => {
    const glowingAt = (elapsed: number, fields: Partial<FighterFields>) => {
      const graphics = [fakeGraphics(), fakeGraphics()];
      let i = 0;
      const art = new FighterArt({ add: { graphics: () => graphics[i++] } } as never);
      art.update({ ...bowman(1000), faction: "fire", ...fields }, 1000 + elapsed, 1000 + elapsed);
      return graphics[1]!.calls.includes("strokeCircle");
    };
    for (const m of [1, 0.92, 0.88, 0.5]) expect(glowingAt(540, { windupMult: wire(m) }), `x${m} at 0.54 s`).toBe(false);
    expect(glowingAt(560, {})).toBe(false); // the unbuffed 0.6 s draw
    expect(glowingAt(560, { windupMult: wire(0.92) })).toBe(true); // 0.552 s
    for (const m of [0.88, 0.5]) expect(glowingAt(560, { windupMult: wire(m) }), `x${m} at 0.56 s`).toBe(true);
  });
});

describe("HpBar", () => {
  const GREEN = 0x66bb6a;
  const YELLOW = 0xffca28;
  const RED = 0xef5350;
  function bar() {
    const { scene, ofKind } = fakeScene();
    const hp = new HpBar(scene);
    const g = ofKind("graphics")[0]!;
    /** The colour of the hp segment the last repaint drew (the first fillStyle after the black backing), or null for no repaint since. */
    const fills = () => argsOf(g, "fillStyle").map((a) => a[0]);
    return { hp, g, fills };
  }

  it("repaints when hp changes by half a pixel and not before", () => {
    const { hp, g } = bar();
    hp.draw(1000, 1000, 0, 0);
    expect(g.clears).toBe(1);
    hp.draw(1000, 1000, 0, 0);
    expect(g.clears).toBe(1);
    hp.draw(999, 1000, 0, 0); // 28 px bar: 56 half pixels, one is 17.9 hp
    expect(g.clears).toBe(1);
    hp.draw(900, 1000, 0, 0);
    expect(g.clears).toBe(2);
    expect(argsOf(g, "fillRect")[1]).toEqual([-14, 0, 25, 4]); // 90% of the 28 px bar, to the half pixel
  });

  it("repaints with the new colour when hp crosses 50% or 25% inside the same half pixel", () => {
    const { hp, g, fills } = bar();
    hp.draw(501, 1000, 0, 0);
    expect(fills()).toEqual([0x000000, GREEN]);
    hp.draw(499, 1000, 0, 0); // the same 28 half pixels
    expect(g.clears).toBe(2);
    expect(fills()).toEqual([0x000000, YELLOW]);
    hp.draw(251, 1000, 0, 0);
    hp.draw(249, 1000, 0, 0);
    expect(fills()).toEqual([0x000000, RED]);
  });

  it("colours by hp against max hp, so a barrier that shrinks the bar leaves healthy hp green", () => {
    const { hp, fills } = bar();
    hp.draw(700, 1000, 800, 0); // hp is 70% of max hp but 47% of the shrunken bar
    expect(fills()).toEqual([0x000000, GREEN, BARRIER_COLOR]);
  });

  it("hides (once) and draws again afterwards", () => {
    const { hp, g } = bar();
    hp.draw(500, 1000, 0, 0);
    hp.hide();
    expect(g.calls).toEqual([]);
    const clears = g.clears;
    hp.hide();
    expect(g.clears).toBe(clears);
    hp.draw(500, 1000, 0, 0);
    expect(g.calls.length).toBeGreaterThan(0);
  });
});
