import { describe, expect, it } from "vitest";
import { RANGED_HIT_REACH, WEAPONS, Y_SCALE } from "@raid/shared";
import { WeaponRangeView, weaponRangeGeometry, WEAPON_RANGE_DEPTH, type WeaponRangeFrame } from "../src/render/WeaponRangeView";
import { argsOf, fakeScene } from "./fakes";

const frame = (over: Partial<WeaponRangeFrame> = {}): WeaponRangeFrame => ({
  phase: "active", me: { status: "alive", weapon0: "sword", weapon1: "bow", slot: 0, facing: 0 }, at: { x: 300, y: 200 }, aim: 0, ...over,
});

describe("local weapon range geometry", () => {
  it.each(["sword", "axe", "shield", "fists"] as const)("uses %s's true melee reach and cone, rotated on the ground plane", weapon => {
    const shape = WEAPONS[weapon].shape;
    if (shape.kind !== "arc") throw new Error("expected melee");
    const aim = Math.PI / 2, geometry = weaponRangeGeometry(weapon, aim);
    expect(geometry.kind).toBe("arc"); expect(geometry.range).toBe(shape.reach);
    expect(geometry.points[0]).toEqual({ x: 0, y: 0 });
    for (const point of geometry.points.slice(1)) expect(Math.hypot(point.x, point.y)).toBeCloseTo(shape.reach);
    const first = geometry.points[1]!, last = geometry.points.at(-1)!;
    expect(Math.atan2(first.y, first.x)).toBeCloseTo(aim - shape.halfArc);
    expect(Math.atan2(last.y, last.x)).toBeCloseTo(aim + shape.halfArc);
    expect(Math.max(...geometry.points.map(p => p.y))).toBeCloseTo(shape.reach);
  });

  it("uses the bow's catalog distance and authoritative projectile/body hit tolerance for an aimed lane", () => {
    const shape = WEAPONS.bow.shape;
    if (shape.kind !== "projectile") throw new Error("expected bow");
    const east = weaponRangeGeometry("bow", 0), south = weaponRangeGeometry("bow", Math.PI / 2);
    expect(east.kind).toBe("lane"); expect(east.range).toBe(shape.range);
    expect(east.points).toEqual([{ x: 0, y: -RANGED_HIT_REACH }, { x: shape.range, y: -RANGED_HIT_REACH }, { x: shape.range, y: RANGED_HIT_REACH }, { x: 0, y: RANGED_HIT_REACH }]);
    east.points.forEach((p, i) => { expect(south.points[i]!.x).toBeCloseTo(-p.y); expect(south.points[i]!.y).toBeCloseTo(p.x); });
  });

  it("shows the wand's full catalog range in every direction, independent of aim", () => {
    const shape = WEAPONS.wand.shape;
    if (shape.kind !== "projectile") throw new Error("expected wand");
    const geometry = weaponRangeGeometry("wand", 0);
    expect(geometry.kind).toBe("circle"); expect(geometry.range).toBe(shape.range);
    for (const p of geometry.points) expect(Math.hypot(p.x, p.y)).toBeCloseTo(shape.range);
    expect(weaponRangeGeometry("wand", 2)).toEqual(geometry);
  });
});

describe("WeaponRangeView", () => {
  function setup() {
    const scene = fakeScene(), view = new WeaponRangeView(scene.scene);
    return { ...scene, view, graphics: scene.ofKind("graphics")[0]! };
  }

  it("projects the local ground position and shape below actors with restrained fill and soft outlines", () => {
    const { view, graphics } = setup();
    view.update(frame({ aim: Math.PI / 2 }));
    expect(graphics.state.visible).toBe(true); expect(graphics.state.position).toEqual([300, 200 * Y_SCALE]);
    expect(graphics.state.depth).toBe(WEAPON_RANGE_DEPTH); expect(WEAPON_RANGE_DEPTH).toBeGreaterThan(-1e6); expect(WEAPON_RANGE_DEPTH).toBeLessThan(0);
    const geometry = weaponRangeGeometry("sword", Math.PI / 2);
    expect(argsOf(graphics, "lineTo")).toEqual(geometry.points.slice(1).map(p => [p.x, p.y * Y_SCALE]));
    expect(argsOf(graphics, "fillStyle")[0]![1]).toBeLessThanOrEqual(.04);
    const lines = argsOf(graphics, "lineStyle");
    expect(lines.map(l => l[0])).toEqual([6, 1]);
    expect(lines.every(l => Number(l[2]) <= .25)).toBe(true);
    expect(argsOf(graphics, "fillPath")).toHaveLength(1); expect(argsOf(graphics, "strokePath")).toHaveLength(2);
  });

  it("moves with prediction without redrawing, but changes geometry on aim and equipped-slot changes", () => {
    const { view, graphics } = setup();
    const f = frame(); view.update(f); expect(graphics.clears).toBe(1);
    view.update(f); expect(graphics.clears).toBe(1);
    view.update({ ...f, at: { x: 321, y: 215 } }); expect(graphics.clears).toBe(1);
    expect(graphics.state.position).toEqual([321, 215 * Y_SCALE]);
    view.update({ ...f, aim: 1 }); expect(graphics.clears).toBe(2);
    view.update({ ...f, me: { ...f.me!, slot: 1 } }); expect(graphics.clears).toBe(3);
    expect(argsOf(graphics, "lineTo")).toHaveLength(3);
  });

  it("keeps the wand circle cached while aiming and uses Fists for an empty hand", () => {
    const { view, graphics } = setup();
    const f = frame({ me: { ...frame().me!, weapon0: "wand" } });
    view.update(f); view.update({ ...f, aim: 2 }); expect(graphics.clears).toBe(1);
    view.update({ ...f, me: { ...f.me!, weapon0: "" } }); expect(graphics.clears).toBe(2);
    const fists = weaponRangeGeometry("fists", 0);
    expect(argsOf(graphics, "lineTo")).toEqual(fists.points.slice(1).map(p => [p.x, p.y * Y_SCALE]));
  });

  it.each([
    { phase: "lobby" }, { phase: "planning" }, { phase: "ended" }, { hidden: true },
    { me: undefined }, { at: undefined }, { at: { x: Infinity, y: 200 } },
    { me: { ...frame().me!, status: "dead" } }, { me: { ...frame().me!, weapon0: "unknown" } },
  ])("hides when the local frame is unavailable or obscured: %j", over => {
    const { view, graphics } = setup(); view.update(frame()); view.update(frame(over));
    expect(graphics.state.visible).toBe(false);
    view.update(frame()); expect(graphics.state.visible).toBe(true); expect(graphics.clears).toBe(1);
  });

  it("falls back to local facing without a cursor aim, and releases its single graphics object on teardown", () => {
    const { view, graphics, made, baked } = setup();
    view.update(frame({ aim: null, me: { ...frame().me!, facing: 1 } }));
    expect(argsOf(graphics, "lineTo")).toEqual(weaponRangeGeometry("sword", 1).points.slice(1).map(p => [p.x, p.y * Y_SCALE]));
    expect(made).toHaveLength(1); expect(baked.size).toBe(0);
    view.destroy(); expect(argsOf(graphics, "destroy")).toHaveLength(1);
  });
});
