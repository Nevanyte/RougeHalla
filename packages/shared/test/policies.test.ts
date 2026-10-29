import { describe, expect, it } from "vitest";
import { decide, leadAim, lockSpacing, POLICIES, WEAPON_IDS, type PolicyInput, type Vec2, type WeaponId } from "../src/index";

// The prediction, retreat and strafing a caller opts into with the optional PolicyInput fields. With none of them set
// decide() behaves as interactions.test.ts pins.

const still: Vec2 = { x: 0, y: 0 };
const self: Vec2 = { x: 0, y: 0 };
const input = (over: Partial<PolicyInput> & { weapon: WeaponId }): PolicyInput => ({
  self, target: { x: 300, y: 0 }, targetVel: still, los: true, ready: true, ...over,
});

describe("decide, seeing the world late", () => {
  it("leads a crossing target by the view lag and the input delay, and a ball by its cast too (an arrow leaves along the latest aim)", () => {
    const vel = { x: 0, y: 100 };
    const target = { x: 250, y: 0 };
    const arrow = decide(input({ weapon: "bow", target, targetVel: vel, viewLag: 0.1, inputDelay: 0.05, windup: 0.5 }));
    expect(arrow.aim).toBeCloseTo(leadAim(self, { x: target.x, y: target.y + vel.y * 0.15 }, vel, 900), 12);
    const out = decide(input({ weapon: "wand", target, targetVel: vel, viewLag: 0.1, inputDelay: 0.05, windup: 0.2 }));
    const later = { x: target.x, y: target.y + vel.y * 0.35 };
    expect(out.aim).toBeCloseTo(leadAim(self, later, vel, 380), 12);
    expect(out.aim).toBeGreaterThan(leadAim(self, target, vel, 380));
  });

  it("aims a projectile from the position it was given, not from where a moving shooter will be", () => {
    // The sim looses the shot from where the shooter's client drew it (the attack's `t`), so a strafing shooter that
    // aimed from its projected position would miss a standing target by its speed times the lag.
    const strafing = { selfVel: { x: 0, y: 170 }, viewLag: 0.1, inputDelay: 0.05, windup: 0.2 };
    for (const weapon of ["bow", "wand"] as const) {
      expect(decide(input({ weapon, target: { x: 250, y: 0 }, ...strafing })).aim).toBeCloseTo(0, 12);
    }
    // A melee swing is judged from the same view, and the walk still starts from where the fighter will be.
    const walk = decide(input({ weapon: "sword", target: { x: 400, y: 0 }, ...strafing })).move as Vec2;
    expect(walk.x).toBeCloseTo(400, 9);
  });

  it("walks to where a moving target will be when the move takes effect", () => {
    const out = decide(input({ weapon: "sword", target: { x: 400, y: 0 }, targetVel: { x: 0, y: 100 }, viewLag: 0.1, inputDelay: 0.05 }));
    const m = out.move as Vec2;
    expect(m.x).toBeCloseTo(400, 9);
    expect(m.y).toBeCloseTo(15, 9);
  });

  it("does not lead an adjacent chaser through itself", () => {
    // A target 30 u away closing at 170 u/s would be past the shooter 0.35 s on; it stops at contact instead.
    const out = decide(input({ weapon: "wand", target: { x: 30, y: 0 }, targetVel: { x: -170, y: 0 }, viewLag: 0.1, inputDelay: 0.05, windup: 0.2 }));
    expect(Math.abs(out.aim)).toBeLessThan(0.05);
    // Without the contact stop it would have aimed backwards.
    const naive = leadAim(self, { x: 30 - 170 * 0.35, y: 0 }, { x: -170, y: 0 }, 380);
    expect(Math.abs(naive)).toBeGreaterThan(Math.PI / 2);
  });

  it("still leads a chaser that has room to run", () => {
    const out = decide(input({ weapon: "wand", target: { x: 300, y: 0 }, targetVel: { x: -100, y: 60 }, viewLag: 0.1, inputDelay: 0.05, windup: 0.2 }));
    expect(out.aim).toBeGreaterThan(0.05);
  });

  it("swings only when the target will be in reach", () => {
    // 90 u away and walking off at 170 u/s: out of a sword's reach by the time the swing is judged.
    const edge = POLICIES.sword.attackRange - 10;
    const walkingOff = decide(input({ weapon: "sword", target: { x: edge, y: 0 }, targetVel: { x: 170, y: 0 }, viewLag: 0.1, inputDelay: 0.05 }));
    expect(walkingOff.hold).toBe(false);
    expect(decide(input({ weapon: "sword", target: { x: edge, y: 0 } })).hold).toBe(true);
    // Walking in from 90 u: in reach by then.
    expect(decide(input({ weapon: "sword", target: { x: POLICIES.sword.attackRange + 20, y: 0 }, targetVel: { x: -170, y: 0 }, viewLag: 0.1, inputDelay: 0.05 })).hold).toBe(true);
  });

  it("holds the trigger for a bow inside its range and not outside it, whatever it was doing (no release to time)", () => {
    expect(decide(input({ weapon: "bow", target: { x: POLICIES.bow.attackRange + 20, y: 0 }, inputDelay: 0.05 })).hold).toBe(false);
    expect(decide(input({ weapon: "bow", target: { x: 150, y: 0 }, inputDelay: 0.05 })).hold).toBe(true);
  });

  it("does not draw on a target the arrow cannot reach", () => {
    // Inside the attack range, but backing off at 170 u/s: the arrow meets it past the bow's range.
    const at = POLICIES.bow.attackRange - 10;
    expect(decide(input({ weapon: "bow", target: { x: at, y: 0 }, targetVel: { x: 170, y: 0 } })).hold).toBe(false);
    expect(decide(input({ weapon: "bow", target: { x: at, y: 0 } })).hold).toBe(true);
  });
});

describe("decide, backing off near walls", () => {
  const close = input({ weapon: "bow", target: { x: 100, y: 0 } });

  it("backs straight away when nothing is in the way", () => {
    const out = decide({ ...close, walkable: () => true });
    const m = out.move as Vec2;
    expect(m.x).toBeCloseTo(-160, 9);
    expect(m.y).toBeCloseTo(0, 9);
  });

  it("turns along a wall when straight back is blocked", () => {
    const wallBehind = (_: Vec2, to: Vec2): boolean => to.x > -50;
    const out = decide({ ...close, walkable: wallBehind });
    const m = out.move as Vec2;
    expect(wallBehind(self, m)).toBe(true);
    expect(Math.abs(m.y)).toBeGreaterThan(50);
    expect(m.x).toBeLessThan(0);
  });

  it("tries a half step when a full one is blocked", () => {
    const m = decide({ ...close, walkable: (_, to) => Math.hypot(to.x, to.y) <= 100 }).move as Vec2;
    expect(Math.hypot(m.x, m.y)).toBeCloseTo(80, 9);
  });

  it("stands and shoots when cornered", () => {
    const out = decide({ ...close, walkable: () => false });
    expect(out.move).toBe("stop");
    expect(out.hold).toBe(true);
  });
});

describe("decide, strafing and spacing overrides", () => {
  const strafing = { ...POLICIES.wand, strafe: 0.8 };
  // Where the wand stands: between backing off and closing in.
  const SWEET = (POLICIES.wand.retreatBelow + POLICIES.wand.far) / 2;
  const at = (time: number, over: Partial<PolicyInput> = {}) =>
    decide(input({ weapon: "wand", target: { x: SWEET, y: 0 }, spacing: strafing, time, ...over }));

  it("sidesteps perpendicular to the target, changing side every period", () => {
    const first = at(0.1).move as Vec2;
    const second = at(0.9).move as Vec2;
    const third = at(1.7).move as Vec2;
    expect(first.x).toBeCloseTo(0, 9);
    expect(Math.abs(first.y)).toBeCloseTo(80, 9);
    expect(Math.sign(second.y)).toBe(-Math.sign(first.y));
    expect(Math.sign(third.y)).toBe(Math.sign(first.y));
  });

  it("takes the other side when a wall is on this one", () => {
    const first = at(0.1).move as Vec2;
    const blocked = at(0.1, { walkable: (_, to) => Math.sign(to.y) !== Math.sign(first.y) }).move as Vec2;
    expect(Math.sign(blocked.y)).toBe(-Math.sign(first.y));
    expect(at(0.1, { walkable: () => false }).move).toBe("stop");
  });

  it("stands when it has no clock, and by default", () => {
    expect(at(0, { time: undefined }).move).toBe("stop");
    expect(decide(input({ weapon: "wand", target: { x: SWEET, y: 0 }, time: 0.1 })).move).toBe("stop");
  });

  it("still retreats and still closes in", () => {
    expect((at(0.1, { target: { x: POLICIES.wand.retreatBelow - 30, y: 0 } }).move as Vec2).x).toBeLessThan(0);
    const far = POLICIES.wand.far + 100;
    expect(at(0.1, { target: { x: far, y: 0 } }).move).toEqual({ x: far, y: 0 });
  });

  it("plays a weapon with the spacing it is given", () => {
    const keepAway = { ...POLICIES.wand, retreatBelow: 400 };
    expect(decide(input({ weapon: "wand", target: { x: 300, y: 0 }, spacing: keepAway })).move).not.toBe("stop");
    expect(decide(input({ weapon: "wand", target: { x: 300, y: 0 } })).move).toBe("stop");
  });
});

describe("decide, weaving melee approach", () => {
  const ANGLE = (55 * Math.PI) / 180;
  const weaving = { ...POLICIES.sword, weave: { angle: ANGLE, period: 0.4, within: POLICIES.sword.far + 40 } };
  const at = (time: number, over: Partial<PolicyInput> = {}) =>
    decide(input({ weapon: "sword", target: { x: 400, y: 0 }, spacing: weaving, time, ...over }));
  const heading = (m: unknown): number => Math.atan2((m as Vec2).y, (m as Vec2).x);

  it("walks the weave angle off the line to the target and changes side every period", () => {
    const first = at(0.1).move;
    const second = at(0.5).move;
    const third = at(0.9).move;
    expect(Math.abs(heading(first))).toBeCloseTo(ANGLE, 9);
    expect(heading(second)).toBeCloseTo(-heading(first), 9);
    expect(heading(third)).toBeCloseTo(heading(first), 9);
  });

  it("repeats exactly: the same input gives the same decision", () => {
    expect(at(1.234)).toEqual(at(1.234));
  });

  it("charges straight inside `within`, without a clock, and without line of sight", () => {
    const inside = POLICIES.sword.far + 10;
    expect(at(0.1, { target: { x: inside, y: 0 } }).move).toEqual({ x: inside, y: 0 });
    expect(at(0.1, { time: undefined }).move).toEqual({ x: 400, y: 0 });
    expect(at(0.1, { los: false }).move).toEqual({ x: 400, y: 0 });
  });

  it("takes the other side when a wall is on this one, and goes straight when both are blocked", () => {
    const first = at(0.1).move as Vec2;
    const blocked = at(0.1, { walkable: (_, to) => Math.sign(to.y) !== Math.sign(first.y) }).move as Vec2;
    expect(Math.sign(blocked.y)).toBe(-Math.sign(first.y));
    expect(at(0.1, { walkable: () => false }).move).toEqual({ x: 400, y: 0 });
  });

  it("leaves the default policies alone: nothing weaves unless it is asked to", () => {
    for (const w of ["sword", "axe", "shield"] as const) expect(POLICIES[w].weave).toBeUndefined();
    expect(decide(input({ weapon: "sword", target: { x: 400, y: 0 }, time: 0.1 })).move).toEqual({ x: 400, y: 0 });
  });
});

describe("lockSpacing, how the target lock plays a weapon", () => {
  it("keeps each weapon's distances and projectile speed but never backs off, strafes or weaves", () => {
    for (const w of WEAPON_IDS) {
      const lock = lockSpacing(w);
      const base = POLICIES[w];
      const range = 640;
      expect(lock).toEqual({ far: w === "wand" ? range * .88 : base.far,
        attackRange: w === "wand" ? range * .96 : base.attackRange, retreatBelow: 0, leadSpeed: base.leadSpeed });
      expect(lock.strafe).toBeUndefined();
      expect(lock.weave).toBeUndefined();
    }
  });

  it("closes in past far, then stands and attacks in range, even with a target on top of it", () => {
    const spacing = lockSpacing("bow");
    const far = decide(input({ weapon: "bow", target: { x: spacing.far + 30, y: 0 }, spacing }));
    expect(far.move).toEqual({ x: spacing.far + 30, y: 0 });
    const near = decide(input({ weapon: "bow", target: { x: 20, y: 0 }, spacing }));
    expect(near.move).toBe("stop");
    expect(near.hold).toBe(true);
  });
});
