import { describe, expect, it } from "vitest";
import {
  ALL_WEAPON_IDS, angleBetween, ballDeletesArrow, BALL_ARROW_RADIUS, bestSlot, decide, inArc, leadAim, MASK_MELEE, MASK_SIGHT, moveMultiplier,
  onShieldFront, PLAYER_RADIUS, POLICIES, projectileOnShieldFront, reachMask, reflectVelocity, riposteShare,
  RIPOSTE_SHARE, SHIELD_HALF_ARC, shieldOutcome, STAGGER_IMMUNITY_SECONDS, staggerImmuneUntil, staggers, SWAP_SECONDS,
  swapReadyAt, swingVsBall, SWORD_BALL_SCALE, WEAPON_IDS, WEAPONS, wrapAngle, type HitSource,
  type MoveState, type PolicyInput, type Vec2, type WeaponId,
} from "../src/index";

const deg = (d: number): number => (d * Math.PI) / 180;
const at = (from: Vec2, angle: number, dist: number): Vec2 => ({
  x: from.x + Math.cos(angle) * dist, y: from.y + Math.sin(angle) * dist,
});

describe("wrapAngle and angleBetween", () => {
  it("leaves angles inside (-PI, PI] alone", () => {
    for (const a of [0, 1, -1, 3, -3, Math.PI]) expect(wrapAngle(a)).toBeCloseTo(a, 12);
  });

  it("maps -PI to PI, so the range is half open", () => {
    expect(wrapAngle(-Math.PI)).toBe(Math.PI);
    expect(wrapAngle(Math.PI)).toBe(Math.PI);
  });

  it("wraps angles past either end", () => {
    expect(wrapAngle(1.5 * Math.PI)).toBeCloseTo(-0.5 * Math.PI, 12);
    expect(wrapAngle(-1.5 * Math.PI)).toBeCloseTo(0.5 * Math.PI, 12);
    expect(wrapAngle(2 * Math.PI)).toBeCloseTo(0, 12);
    expect(wrapAngle(0.1 + 6 * Math.PI)).toBeCloseTo(0.1, 12);
    expect(wrapAngle(0.1 - 6 * Math.PI)).toBeCloseTo(0.1, 12);
  });

  it("always lands in (-PI, PI]", () => {
    for (let a = -20; a <= 20; a += 0.37) {
      const w = wrapAngle(a);
      expect(w).toBeGreaterThan(-Math.PI);
      expect(w).toBeLessThanOrEqual(Math.PI);
      expect(Math.cos(w)).toBeCloseTo(Math.cos(a), 9);
      expect(Math.sin(w)).toBeCloseTo(Math.sin(a), 9);
    }
  });

  it("measures the short way round, symmetric and in [0, PI]", () => {
    expect(angleBetween(0.3, 0.5)).toBeCloseTo(0.2, 12);
    expect(angleBetween(0.5, 0.3)).toBeCloseTo(0.2, 12);
    expect(angleBetween(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 12); // across the seam
    expect(angleBetween(0, Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(angleBetween(1, 1 + 2 * Math.PI)).toBeCloseTo(0, 12);
  });
});

describe("onShieldFront", () => {
  const holder = { x: 100, y: 100 };

  it("covers a hit straight ahead and not one behind", () => {
    expect(onShieldFront(holder, 0, { x: 200, y: 100 })).toBe(true);
    expect(onShieldFront(holder, 0, { x: 0, y: 100 })).toBe(false);
    expect(onShieldFront(holder, Math.PI / 2, { x: 100, y: 200 })).toBe(true);
    expect(onShieldFront(holder, Math.PI / 2, { x: 100, y: 0 })).toBe(false);
  });

  it("is inclusive at exactly +-60 degrees and not a degree beyond", () => {
    expect(SHIELD_HALF_ARC).toBeCloseTo(deg(60), 12);
    expect(onShieldFront(holder, 0, at(holder, deg(60), 50))).toBe(true);
    expect(onShieldFront(holder, 0, at(holder, -deg(60), 50))).toBe(true);
    expect(onShieldFront(holder, 0, at(holder, deg(59), 50))).toBe(true);
    expect(onShieldFront(holder, 0, at(holder, deg(61), 50))).toBe(false);
    expect(onShieldFront(holder, 0, at(holder, -deg(61), 50))).toBe(false);
  });

  it("does not depend on the distance of the attacker", () => {
    expect(onShieldFront(holder, 0, at(holder, deg(60), 3))).toBe(true);
    expect(onShieldFront(holder, 0, at(holder, deg(61), 3000))).toBe(false);
  });

  it("works across the +-PI seam", () => {
    const facing = Math.PI - 0.05;
    expect(onShieldFront(holder, facing, at(holder, -Math.PI + 0.05, 40))).toBe(true);
    expect(onShieldFront(holder, facing, at(holder, facing - deg(61), 40))).toBe(false);
  });

  it("counts a hit from the holder's own position as frontal (it has no direction)", () => {
    expect(onShieldFront(holder, 1.2, { ...holder })).toBe(true);
  });
});

describe("projectileOnShieldFront", () => {
  it("a projectile flying at the shield's face arrives on its front", () => {
    expect(projectileOnShieldFront(0, -900, 0)).toBe(true); // shield faces east, arrow flies west
    expect(projectileOnShieldFront(Math.PI, 900, 0)).toBe(true);
    expect(projectileOnShieldFront(Math.PI / 2, 0, -900)).toBe(true);
  });

  it("one flying away from the face hits the back", () => {
    expect(projectileOnShieldFront(0, 900, 0)).toBe(false);
    expect(projectileOnShieldFront(0, 0, 900)).toBe(false);
  });

  it("is inclusive at 60 degrees off the face and exclusive beyond", () => {
    const arrival = (offDeg: number): [number, number] => [-Math.cos(deg(offDeg)) * 900, -Math.sin(deg(offDeg)) * 900];
    expect(projectileOnShieldFront(0, ...arrival(60))).toBe(true);
    expect(projectileOnShieldFront(0, ...arrival(-60))).toBe(true);
    expect(projectileOnShieldFront(0, ...arrival(61))).toBe(false);
    expect(projectileOnShieldFront(0, ...arrival(-61))).toBe(false);
  });

  it("a standing projectile has no direction and never counts", () => {
    expect(projectileOnShieldFront(0, 0, 0)).toBe(false);
  });
});

describe("shieldOutcome", () => {
  const cases: Array<[string, HitSource, string]> = [
    ["an arrow is reflected", { projectile: "arrow" }, "reflect"],
    ["a ball pierces", { projectile: "ball" }, "pierce"],
    ["a sword hit is riposted", { melee: "sword" }, "riposte"],
    ["a bash is blocked", { melee: "shield" }, "block"],
    ["an axe swing pierces", { melee: "axe" }, "pierce"],
    ["a fists swing pierces", { melee: "fists" }, "pierce"],
    ["a bow (which never swings) pierces", { melee: "bow" }, "pierce"],
    ["a wand (which never swings) pierces", { melee: "wand" }, "pierce"],
  ];
  it.each(cases)("%s", (_name, src, outcome) => {
    expect(shieldOutcome(src)).toBe(outcome);
  });

  it("deals back RIPOSTE_SHARE of a negated sword hit", () => {
    expect(riposteShare()).toBe(RIPOSTE_SHARE);
    expect(riposteShare()).toBe(0.5);
  });
});

describe("stagger", () => {
  it("only a sword swing staggers", () => {
    expect(staggers({ melee: "sword" })).toBe(true);
    for (const w of ALL_WEAPON_IDS.filter((x) => x !== "sword")) expect(staggers({ melee: w })).toBe(false);
    expect(staggers({ melee: "fists" })).toBe(false);
    expect(staggers({ projectile: "arrow" })).toBe(false);
    expect(staggers({ projectile: "ball" })).toBe(false);
  });

  it("grants STAGGER_IMMUNITY_SECONDS of immunity counted from the hit", () => {
    expect(STAGGER_IMMUNITY_SECONDS).toBe(1.1);
    expect(staggerImmuneUntil(0)).toBe(1100);
    expect(staggerImmuneUntil(12_340)).toBe(13_440);
  });
});

describe("swingVsBall and ballDeletesArrow", () => {
  it("the sword halves a ball, the axe destroys it, nothing else touches it", () => {
    expect(swingVsBall("sword")).toEqual({ scale: SWORD_BALL_SCALE });
    expect(SWORD_BALL_SCALE).toBe(0.5);
    expect(swingVsBall("axe")).toBe("destroy");
    for (const w of ["shield", "bow", "wand", "fists"] as WeaponId[]) expect(swingVsBall(w)).toBeNull();
  });

  it("a ball deletes an arrow within BALL_ARROW_RADIUS (28 u), inclusive", () => {
    expect(BALL_ARROW_RADIUS).toBe(28);
    const ball = { x: 300, y: 200 };
    expect(ballDeletesArrow(ball, { x: 300, y: 200 })).toBe(true);
    expect(ballDeletesArrow(ball, { x: 328, y: 200 })).toBe(true);
    expect(ballDeletesArrow(ball, { x: 272, y: 200 })).toBe(true);
    expect(ballDeletesArrow(ball, { x: 300, y: 228 })).toBe(true);
    expect(ballDeletesArrow(ball, { x: 328.01, y: 200 })).toBe(false);
    expect(ballDeletesArrow(ball, { x: 300, y: 171.99 })).toBe(false);
  });

  it("measures the distance in the plane, not per axis", () => {
    // 20 u off on both axes is 28.28 u away: outside, though each axis is inside.
    expect(ballDeletesArrow({ x: 0, y: 0 }, { x: 20, y: 20 })).toBe(false);
    expect(ballDeletesArrow({ x: 0, y: 0 }, { x: 19, y: 19 })).toBe(true);
  });
});

describe("reflectVelocity", () => {
  it("sends a frontal arrow straight back", () => {
    const r = reflectVelocity(-900, 0, 0);
    expect(r.vx).toBeCloseTo(900, 9);
    expect(r.vy).toBeCloseTo(0, 9);
    const s = reflectVelocity(0, 900, -Math.PI / 2); // shield faces north, arrow flies south
    expect(s.vx).toBeCloseTo(0, 9);
    expect(s.vy).toBeCloseTo(-900, 9);
  });

  it("mirrors the normal component and keeps the tangent", () => {
    const r = reflectVelocity(-600, 300, 0); // shield normal is east
    expect(r.vx).toBeCloseTo(600, 9);
    expect(r.vy).toBeCloseTo(300, 9);
    const n = reflectVelocity(300, -400, Math.PI / 2); // normal is south
    expect(n.vx).toBeCloseTo(300, 9);
    expect(n.vy).toBeCloseTo(400, 9);
    const along = reflectVelocity(0, 900, 0); // flying along the face
    expect(along.vx).toBeCloseTo(0, 9);
    expect(along.vy).toBeCloseTo(900, 9);
  });

  it("preserves speed at any angle, and reflecting twice returns the original", () => {
    for (let facing = -3; facing <= 3; facing += 0.5) {
      const r = reflectVelocity(-540, 720, facing);
      expect(Math.hypot(r.vx, r.vy)).toBeCloseTo(900, 9);
      const back = reflectVelocity(r.vx, r.vy, facing);
      expect(back.vx).toBeCloseTo(-540, 9);
      expect(back.vy).toBeCloseTo(720, 9);
    }
  });

  it("an arrow arriving at 30 degrees off the face leaves 30 degrees off it", () => {
    const incoming = { vx: -Math.cos(deg(30)) * 900, vy: -Math.sin(deg(30)) * 900 };
    const r = reflectVelocity(incoming.vx, incoming.vy, 0);
    expect(Math.atan2(r.vy, r.vx)).toBeCloseTo(-deg(30), 9);
  });
});

describe("inArc", () => {
  const origin = { x: 0, y: 0 };
  const R = PLAYER_RADIUS;
  const sword = WEAPONS.sword.shape;
  if (sword.kind !== "arc") throw new Error("the sword is an arc");

  it("hits a body at the reach plus its own radius, and not past it", () => {
    expect(inArc(origin, 0, 64, Math.PI / 4, { x: 64, y: 0 }, R)).toBe(true);
    expect(inArc(origin, 0, 64, Math.PI / 4, { x: 64 + R, y: 0 }, R)).toBe(true);
    expect(inArc(origin, 0, 64, Math.PI / 4, { x: 64 + R + 0.1, y: 0 }, R)).toBe(false);
    // The same point is out of reach for a point body.
    expect(inArc(origin, 0, 64, Math.PI / 4, { x: 64.1, y: 0 }, 0)).toBe(false);
  });

  it("misses a body behind the attacker", () => {
    expect(inArc(origin, 0, 64, Math.PI / 4, { x: -50, y: 0 }, R)).toBe(false);
    expect(inArc(origin, 0, 64, Math.PI / 4, { x: 0, y: 50 }, R)).toBe(false);
  });

  it("always hits a body overlapping the attacker, whichever way it aims", () => {
    expect(inArc(origin, 0, 64, Math.PI / 4, { x: -5, y: 0 }, R)).toBe(true);
    expect(inArc(origin, Math.PI, 64, Math.PI / 4, { x: 5, y: 5 }, R)).toBe(true);
    expect(inArc(origin, 0, 64, Math.PI / 4, { x: 0, y: 0 }, R)).toBe(true);
  });

  it("is symmetric about the aim", () => {
    for (const side of [1, -1]) {
      expect(inArc(origin, 0, 64, Math.PI / 4, at(origin, side * (Math.PI / 4 - 0.01), 50), 0)).toBe(true);
      expect(inArc(origin, 0, 64, Math.PI / 4, at(origin, side * (Math.PI / 4 + 0.01), 50), 0)).toBe(false);
    }
  });

  it("widens the arc by the body's angular half-width, asin(r / d)", () => {
    const widen = Math.asin(R / 50);
    expect(widen).toBeCloseTo(0.2424, 3);
    expect(inArc(origin, 0, 64, Math.PI / 4, at(origin, Math.PI / 4 + widen - 0.01, 50), R)).toBe(true);
    expect(inArc(origin, 0, 64, Math.PI / 4, at(origin, Math.PI / 4 + widen + 0.01, 50), R)).toBe(false);
    // A closer body subtends more, so it is caught at a wider angle.
    expect(inArc(origin, 0, 64, Math.PI / 4, at(origin, Math.PI / 4 + 0.4, 30), R)).toBe(true);
    expect(inArc(origin, 0, 64, Math.PI / 4, at(origin, Math.PI / 4 + 0.4, 60), R)).toBe(false);
  });

  it("follows the aim, including across the +-PI seam", () => {
    expect(inArc(origin, Math.PI / 2, 64, Math.PI / 4, { x: 0, y: 50 }, R)).toBe(true);
    expect(inArc(origin, Math.PI / 2, 64, Math.PI / 4, { x: 50, y: 0 }, R)).toBe(false);
    expect(inArc(origin, Math.PI - 0.1, 64, Math.PI / 4, at(origin, -Math.PI + 0.1, 50), R)).toBe(true);
  });

  it("uses the weapon's own reach and arc: the axe sweeps a half circle, the bash reaches less", () => {
    const axe = WEAPONS.axe.shape;
    const bash = WEAPONS.shield.shape;
    if (axe.kind !== "arc" || bash.kind !== "arc") throw new Error("arcs");
    expect(inArc(origin, 0, axe.reach, axe.halfArc, at(origin, deg(80), 50), 0)).toBe(true);
    expect(inArc(origin, 0, axe.reach, axe.halfArc, at(origin, deg(100), 50), 0)).toBe(false);
    expect(inArc(origin, 0, axe.reach, axe.halfArc, at(origin, deg(100), 50), R)).toBe(true);
    expect(inArc(origin, 0, bash.reach, bash.halfArc, { x: 50, y: 0 }, R)).toBe(true);
    const between = bash.reach + R + 1;
    expect(inArc(origin, 0, bash.reach, bash.halfArc, { x: between, y: 0 }, R)).toBe(false);
    expect(inArc(origin, 0, sword.reach, sword.halfArc, { x: between, y: 0 }, R)).toBe(true);
  });

  it("is translation invariant", () => {
    const o = { x: 1000, y: -500 };
    expect(inArc(o, 0.4, 64, Math.PI / 4, at(o, 0.4 + 0.5, 70), R)).toBe(inArc(origin, 0.4, 64, Math.PI / 4, at(origin, 0.4 + 0.5, 70), R));
  });
});

describe("swapReadyAt", () => {
  it("adds SWAP_SECONDS on top of the cooldown still running", () => {
    expect(SWAP_SECONDS).toBe(0.25);
    expect(swapReadyAt(1000, 400)).toBe(1250);
  });

  it("counts from now when the cooldown is already over", () => {
    expect(swapReadyAt(100, 400)).toBe(650);
    expect(swapReadyAt(0, 400)).toBe(650);
  });

  it("is the later of the two when they coincide", () => {
    expect(swapReadyAt(400, 400)).toBe(650);
  });
});

describe("moveMultiplier", () => {
  const now = 1000;
  const idle: MoveState = { now, rootUntil: 0, windingUp: false };

  it("is 1 with nothing holding the fighter", () => {
    expect(moveMultiplier(idle)).toBe(1);
  });

  it("is 0 while an attack winds up (a swing, a cast or the bow's draw)", () => {
    expect(moveMultiplier({ ...idle, windingUp: true })).toBe(0);
  });

  it("is 0 while the axe's root holds, and the root ends exactly at its time (the end is exclusive)", () => {
    expect(moveMultiplier({ ...idle, rootUntil: now + 1 })).toBe(0);
    expect(moveMultiplier({ ...idle, rootUntil: now })).toBe(1);
    expect(moveMultiplier({ ...idle, windingUp: true, rootUntil: now + 1 })).toBe(0);
  });

  it("nothing else slows a walk: it is all or nothing", () => {
    for (const windingUp of [false, true]) {
      for (const rootUntil of [0, now - 1, now, now + 1, now + 1e6]) {
        expect([0, 1]).toContain(moveMultiplier({ now, rootUntil, windingUp }));
      }
    }
  });
});

describe("leadAim", () => {
  const self = { x: 0, y: 0 };

  /**
   * Fly a projectile from `from` at `aim` while the target keeps its velocity, and measure how far apart they are at the
   * moment the projectile has gone as far across as the target (every case here has the target ahead on x).
   */
  function missDistance(from: Vec2, target: Vec2, vel: Vec2, speed: number, aim: number): number {
    const rel = { x: target.x - from.x, y: target.y - from.y };
    const t = rel.x / (speed * Math.cos(aim) - vel.x);
    expect(t).toBeGreaterThan(0);
    return Math.hypot(speed * Math.cos(aim) * t - (rel.x + vel.x * t), speed * Math.sin(aim) * t - (rel.y + vel.y * t));
  }

  it("aims straight at a target that stands still, and at any target for a speed of 0", () => {
    expect(leadAim(self, { x: 100, y: 100 }, { x: 0, y: 0 }, 900)).toBeCloseTo(Math.PI / 4, 12);
    expect(leadAim(self, { x: 100, y: 100 }, { x: 50, y: -30 }, 0)).toBeCloseTo(Math.PI / 4, 12);
    expect(leadAim({ x: 50, y: 50 }, { x: 50, y: 150 }, { x: 0, y: 0 }, 380)).toBeCloseTo(Math.PI / 2, 12);
  });

  it("leads a target crossing at right angles so the projectile meets it", () => {
    const target = { x: 300, y: 0 };
    const vel = { x: 0, y: 100 };
    const aim = leadAim(self, target, vel, 900);
    // Intercept time t: |(300, 100 t)| = 900 t, so the shot goes to (300, 100 t).
    const t = Math.sqrt((300 * 300) / (900 * 900 - 100 * 100));
    expect(aim).toBeGreaterThan(0); // ahead of the target, toward where it is going
    expect(aim).toBeCloseTo(Math.atan2(100 * t, 300), 9);
    expect(missDistance(self, target, vel, 900, aim)).toBeLessThan(1e-6);
  });

  it("leads a target walking away, toward the shooter, or across", () => {
    for (const vel of [{ x: 120, y: 60 }, { x: -120, y: 60 }, { x: 0, y: -170 }, { x: 170, y: 0 }]) {
      const target = { x: 350, y: -40 };
      expect(missDistance(self, target, vel, 900, leadAim(self, target, vel, 900))).toBeLessThan(1e-6);
    }
  });

  it("works from any shooter position, and for the slow ball", () => {
    const shooter = { x: 400, y: 300 };
    const target = { x: 700, y: 380 };
    const vel = { x: -90, y: 70 };
    const aim = leadAim(shooter, target, vel, 380);
    expect(missDistance(shooter, target, vel, 380, aim)).toBeLessThan(1e-6);
  });

  it("handles a target exactly as fast as the projectile", () => {
    const target = { x: 300, y: 0 };
    const vel = { x: -60, y: 80 }; // speed 100, closing
    const aim = leadAim(self, target, vel, 100);
    expect(missDistance(self, target, vel, 100, aim)).toBeLessThan(1e-6);
    expect(aim).toBeCloseTo(Math.atan2(200, 150), 9); // met after 2.5 s at (150, 200)
  });

  it("falls back to aiming straight at a target it can never catch", () => {
    const target = { x: 100, y: 100 };
    expect(leadAim(self, target, { x: 1000, y: 0 }, 500)).toBeCloseTo(Math.PI / 4, 12);
  });
});

describe("POLICIES", () => {
  it("melee policies close to just inside the weapon's reach and swing a little beyond the body edge", () => {
    for (const w of ["sword", "axe", "shield"] as WeaponId[]) {
      const shape = WEAPONS[w].shape;
      if (shape.kind !== "arc") throw new Error("arc");
      expect(POLICIES[w].far).toBeCloseTo(shape.reach * 0.85, 9);
      expect(POLICIES[w].attackRange).toBe(shape.reach + PLAYER_RADIUS - 6);
      expect(POLICIES[w].retreatBelow).toBe(0);
      expect(POLICIES[w].leadSpeed).toBe(0);
    }
  });

  it("ranged policies lead with the projectile's speed and back off from close targets", () => {
    expect(POLICIES.bow.leadSpeed).toBe(900);
    expect(POLICIES.wand.leadSpeed).toBe(380);
    expect(POLICIES.bow.retreatBelow).toBeGreaterThan(0);
    expect(POLICIES.wand.retreatBelow).toBeGreaterThan(0);
    // Every range is inside what the projectile can fly, and follows the weapon's range when it is retuned.
    const bow = WEAPONS.bow.shape;
    const wand = WEAPONS.wand.shape;
    if (bow.kind !== "projectile" || wand.kind !== "projectile") throw new Error("projectile");
    expect(POLICIES.bow.attackRange).toBeLessThan(bow.range);
    expect(POLICIES.wand.attackRange).toBeLessThan(wand.range);
    expect(POLICIES.bow.far).toBeLessThan(POLICIES.bow.attackRange);
    expect(POLICIES.wand.far).toBeLessThan(POLICIES.wand.attackRange);
    expect(POLICIES.bow.retreatBelow).toBeLessThan(POLICIES.bow.far);
    expect(POLICIES.wand.retreatBelow).toBeLessThan(POLICIES.wand.far);
    expect(POLICIES.wand.attackRange).toBeGreaterThan(POLICIES.bow.attackRange);
  });
});

describe("decide", () => {
  const self = { x: 0, y: 0 };
  const still = { x: 0, y: 0 };
  const input = (over: Partial<PolicyInput> & { weapon: WeaponId }): PolicyInput => ({
    self, target: { x: 1000, y: 0 }, targetVel: still, los: true, ready: true, ...over,
  });

  describe("melee", () => {
    it("walks to a far target without attacking", () => {
      const out = decide(input({ weapon: "sword", target: { x: 500, y: 0 } }));
      expect(out.move).toEqual({ x: 500, y: 0 });
      expect(out.hold).toBe(false);
      expect(out.aim).toBeCloseTo(0, 12);
    });

    it("keeps walking toward a target it cannot see, even a close one", () => {
      const out = decide(input({ weapon: "sword", target: { x: 30, y: 0 }, los: false }));
      expect(out.move).toEqual({ x: 30, y: 0 });
      expect(out.hold).toBe(false);
    });

    it("stands and swings once inside the far distance", () => {
      const out = decide(input({ weapon: "sword", target: { x: 0, y: 50 } }));
      expect(out.move).toBe("stop");
      expect(out.hold).toBe(true);
      expect(out.aim).toBeCloseTo(Math.PI / 2, 12);
    });

    it("starts swinging at attackRange but keeps closing in until far", () => {
      const x = (POLICIES.sword.far + POLICIES.sword.attackRange) / 2;
      const out = decide(input({ weapon: "sword", target: { x, y: 0 } }));
      expect(out.move).toEqual({ x, y: 0 });
      expect(out.hold).toBe(true);
      expect(decide(input({ weapon: "sword", target: { x: POLICIES.sword.attackRange + 1, y: 0 } })).hold).toBe(false);
    });

    it("never backs off, however close the target", () => {
      expect(decide(input({ weapon: "axe", target: { x: 5, y: 0 } })).move).toBe("stop");
    });

    it("aims straight at a moving target (no lead)", () => {
      const out = decide(input({ weapon: "sword", target: { x: 40, y: 0 }, targetVel: { x: 0, y: 170 } }));
      expect(out.aim).toBeCloseTo(0, 12);
    });
  });

  describe("bow", () => {
    const bow = POLICIES.bow;
    const sweet = (bow.retreatBelow + bow.far) / 2; // between backing off and closing in
    const edge = (bow.far + bow.attackRange) / 2; // closing in, but already in range

    it("approaches a target beyond far and starts the draw once inside attackRange", () => {
      const far = decide(input({ weapon: "bow", target: { x: bow.attackRange + 100, y: 0 } }));
      expect(far.move).toEqual({ x: bow.attackRange + 100, y: 0 });
      expect(far.hold).toBe(false);
      const near = decide(input({ weapon: "bow", target: { x: edge, y: 0 } })); // far < edge <= attackRange
      expect(near.move).toEqual({ x: edge, y: 0 });
      expect(near.hold).toBe(true);
    });

    it("stands in its sweet spot and draws", () => {
      const out = decide(input({ weapon: "bow", target: { x: sweet, y: 0 } }));
      expect(out.move).toBe("stop");
      expect(out.hold).toBe(true);
    });

    it("backs off directly away from a target that is too close, while still drawing", () => {
      const out = decide(input({ weapon: "bow", target: { x: 0, y: bow.retreatBelow - 20 } }));
      expect(out.hold).toBe(true);
      expect(out.move).not.toBe("stop");
      const m = out.move as { x: number; y: number };
      expect(m.x).toBeCloseTo(0, 9);
      expect(m.y).toBeLessThan(0); // away from a target below it
      expect(Math.hypot(m.x - self.x, m.y - self.y)).toBeCloseTo(160, 9);
    });

    it("walks toward a target it cannot see instead of backing off", () => {
      const out = decide(input({ weapon: "bow", target: { x: 100, y: 0 }, los: false }));
      expect(out.move).toEqual({ x: 100, y: 0 });
      expect(out.hold).toBe(false);
    });

    it("is held like the wand: it says hold or not, with no release (the draw is a fixed windup)", () => {
      expect(Object.keys(decide(input({ weapon: "bow", target: { x: sweet, y: 0 } }))).sort()).toEqual(["aim", "hold", "move"]);
    });

    it("does not start a draw on a target out of range or out of sight", () => {
      expect(decide(input({ weapon: "bow", target: { x: bow.attackRange + 15, y: 0 } })).hold).toBe(false);
      expect(decide(input({ weapon: "bow", target: { x: sweet, y: 0 }, los: false })).hold).toBe(false);
    });

    it("leads a moving target with the arrow's speed", () => {
      const target = { x: sweet, y: 0 };
      const vel = { x: 0, y: 120 };
      const out = decide(input({ weapon: "bow", target, targetVel: vel }));
      expect(out.aim).toBeCloseTo(leadAim(self, target, vel, 900), 12);
      expect(out.aim).toBeGreaterThan(0);
    });
  });

  describe("wand", () => {
    const wand = POLICIES.wand;

    it("uses the directional policy's closer spacing and backs away up close", () => {
      expect(wand.far).toBeLessThan(POLICIES.bow.far);
      expect(decide(input({ weapon: "wand", target: { x: (wand.retreatBelow + wand.far) / 2, y: 0 } })).move).toBe("stop");
      const back = decide(input({ weapon: "wand", target: { x: wand.retreatBelow - 30, y: 0 } })).move as Vec2;
      expect(back.x).toBeCloseTo(-160, 9);
      expect(back.y).toBeCloseTo(0, 9);
      expect(decide(input({ weapon: "wand", target: { x: wand.far + 20, y: 0 } })).move).toEqual({ x: wand.far + 20, y: 0 });
    });

    it("casts when inside 80% of its range and leads with the ball's speed", () => {
      expect(decide(input({ weapon: "wand", target: { x: wand.attackRange - 2, y: 0 } })).hold).toBe(true);
      expect(decide(input({ weapon: "wand", target: { x: wand.attackRange + 8, y: 0 } })).hold).toBe(false);
      const vel = { x: 0, y: -100 };
      const target = { x: wand.attackRange - 40, y: 0 };
      const out = decide(input({ weapon: "wand", target, targetVel: vel }));
      expect(out.aim).toBeCloseTo(leadAim(self, target, vel, 380), 12);
    });
  });
});

describe("bestSlot", () => {
  it("picks the slot whose weapon beats the enemy's", () => {
    // The bow and the shield both beat the sword; the axe loses to it.
    expect(bestSlot(["axe", "bow"], 0, "sword")).toBe(1);
    expect(bestSlot(["bow", "axe"], 1, "sword")).toBe(0);
    expect(bestSlot(["axe", "shield"], 0, "sword")).toBe(1);
  });

  it("stays on a good slot", () => {
    expect(bestSlot(["bow", "axe"], 0, "sword")).toBe(0);
    expect(bestSlot(["axe", "bow"], 1, "sword")).toBe(1);
  });

  it("prefers a mirror over a weapon that loses", () => {
    expect(bestSlot(["axe", "sword"], 0, "sword")).toBe(1); // axe loses to the sword, the sword mirrors it
  });

  it("keeps the current slot on a tie", () => {
    // Against the shield, the sword and the bow both lose.
    expect(bestSlot(["sword", "bow"], 0, "shield")).toBe(0);
    expect(bestSlot(["sword", "bow"], 1, "shield")).toBe(1);
    expect(bestSlot(["sword", "sword"], 1, "axe")).toBe(1);
  });

  it("never moves to an empty slot, even from a losing weapon", () => {
    expect(bestSlot(["axe", null], 0, "sword")).toBe(0);
    expect(bestSlot([null, "axe"], 1, "sword")).toBe(1);
  });

  it("leaves an empty slot as soon as there is anything to hold", () => {
    expect(bestSlot([null, "axe"], 0, "sword")).toBe(1);
    expect(bestSlot(["axe", null], 1, "sword")).toBe(0);
  });

  it("holds the current weapon when the enemy's is unknown", () => {
    expect(bestSlot(["sword", "bow"], 0, null)).toBe(0);
    expect(bestSlot(["sword", "bow"], 1, null)).toBe(1);
    expect(bestSlot([null, "bow"], 0, null)).toBe(1);
  });

  it("picks the counter for every weapon in the loop when it holds one of them", () => {
    const counters: Record<WeaponId, WeaponId[]> = {
      sword: ["bow", "shield"], axe: ["sword", "bow"], wand: ["sword", "axe"], bow: ["wand", "shield"], shield: ["wand", "axe"],
      fists: [], // not in the loop: nothing counters it, and it counters nothing
    };
    for (const theirs of WEAPON_IDS) {
      for (const counter of counters[theirs]) {
        const loser = WEAPON_IDS.find((w) => !counters[theirs].includes(w) && w !== theirs && counters[w].includes(theirs))!;
        expect(bestSlot([loser, counter], 0, theirs), `${counter} against ${theirs}`).toBe(1);
        expect(bestSlot([counter, loser], 1, theirs), `${counter} against ${theirs}`).toBe(0);
      }
    }
  });
});

describe("reachMask", () => {
  it("stops an arc (melee) weapon at walls and LOW, and a projectile weapon or an empty hand at walls alone", () => {
    for (const w of ["sword", "axe", "shield", "fists"] as const) expect(reachMask(w), w).toBe(MASK_MELEE);
    for (const w of ["bow", "wand"] as const) expect(reachMask(w), w).toBe(MASK_SIGHT);
    expect(reachMask(null)).toBe(MASK_SIGHT);
  });

  it("follows the weapon's shape, not a list: every arc weapon gets the melee mask and every projectile weapon the sight mask", () => {
    for (const w of ALL_WEAPON_IDS) expect(reachMask(w), w).toBe(WEAPONS[w].shape.kind === "arc" ? MASK_MELEE : MASK_SIGHT);
  });
});
