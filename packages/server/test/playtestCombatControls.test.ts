import { describe, expect, it } from "vitest";
import { ARROW_RADIUS, mapFromTiles, mulberry32, TICK_MS, TILE_FLOOR, WEAPONS, type WeaponId } from "@raid/shared";
import { createGameWorld } from "../src/sim/gameplay";
import { addPlayer, step } from "../src/sim/step";
import { enqueueClientMessage } from "../src/sim/inputs";
import { weaponChanged } from "../src/sim/weapons";
import { combatant } from "../src/sim/combatant";

function arena(weapon: WeaponId = "wand") {
  const w = createGameWorld({ seed: 7, random: mulberry32(8), config: {
    minPlayers: 2, fillSeconds: 0, lobbySeconds: 15, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600,
  } }, { signatures: false });
  w.map = { ...mapFromTiles(50, 30, new Uint8Array(1500).fill(TILE_FLOOR)), spawns: [{ x: 200, y: 320 }, { x: 400, y: 320 }] };
  addPlayer(w, "p0", "caster"); addPlayer(w, "p1", "enemy"); step(w, TICK_MS);
  const me = w.state.players.get("p0")!, foe = w.state.players.get("p1")!;
  me.x = 200; me.y = 320; foe.x = 500; foe.y = 320;
  me.weapon0 = weapon === "fists" ? "" : weapon; me.weapon1 = "sword"; me.slot = 0; me.faction = "holy";
  me.hp = me.maxHp = foe.hp = foe.maxHp = 1e7;
  for (const [id, s] of [["p0", me], ["p1", foe]] as const) {
    const rt = w.players.get(id)!; rt.path = []; rt.history = [{ t: w.state.serverTime, x: s.x, y: s.y }];
  }
  const send = (type: string, msg: unknown) => expect(enqueueClientMessage(w.players.get("p0")!.inputs, type, msg)).toBe(true);
  const tick = () => step(w, TICK_MS);
  const run = (n: number) => { for (let i = 0; i < n; i++) tick(); };
  return { w, me, foe, rt: w.players.get("p0")!, send, tick, run };
}

describe("playtest click combat", () => {
  it.each(["sword", "bow", "shield", "axe", "fists"] as const)("a %s click cannot create a target lock", weapon => {
    const a = arena(weapon); a.send("target", { id: "p1" }); a.tick();
    expect(a.me.attackTarget).toBe(""); expect(a.rt.weapon.lock).toBeNull();
  });
  it("wand locks, homes, and stays within its catalog flight range", () => {
    const a = arena(); a.send("target", { id: "p1" }); a.tick();
    expect(a.me.attackTarget).toBe("p1"); a.run(8);
    const shot = [...a.w.projectiles.values()].find(p => p.owner === "p0")!;
    expect(shot.kind).toBe("ball"); expect(shot.targetId).toBe("p1");
    const shape = WEAPONS.wand.shape;
    expect(shot.launch.range).toBe(shape.kind === "projectile" ? shape.range : 0);
  });
  it("movement queues behind a wand shot while dropping its repeating lock", () => {
    const a = arena(); a.send("target", { id: "p1" }); a.tick();
    const action = a.rt.weapon.action;
    a.send("move", { x: 200, y: 500, seq: 17 }); a.tick();
    expect(a.me.attackTarget).toBe(""); expect(a.rt.weapon.action).toBe(action); expect(a.me.y).toBe(320);
    expect(a.me.moveSeq).toBe(17); a.run(10); expect(a.me.y).toBeGreaterThan(320);
  });
  it("swapping away from wand drops its lock", () => {
    const a = arena(); a.send("target", { id: "p1" }); a.tick();
    a.me.slot = 1; weaponChanged(a.w, combatant(a.w, "p0")!); expect(a.me.attackTarget).toBe("");
  });
  it("a bow fires along the cursor at launch and waits for its full draw before moving", () => {
    const a = arena("bow"); a.send("attack", { a: 0 }); a.send("release", { a: 0 }); a.tick();
    a.send("aim", { a: Math.PI / 2 }); a.send("move", { x: 200, y: 500 }); a.tick(); expect(a.me.y).toBe(320);
    a.run(8);
    const shot = [...a.w.projectiles.values()].find(p => p.owner === "p0")!;
    expect(shot.kind).toBe("arrow"); expect(shot.targetId).toBeUndefined();
    expect(shot.vx).toBeCloseTo(0); expect(shot.vy).toBeGreaterThan(0); expect(a.me.y).toBeGreaterThan(320);
  });
  it("the wider arrow hits a target that the old narrow body missed", () => {
    const a = arena("bow"); a.foe.y += 17; a.send("attack", { a: 0 }); a.send("release", { a: 0 });
    a.run(20); expect(ARROW_RADIUS).toBe(7); expect(a.foe.hp).toBeLessThan(a.foe.maxHp);
  });
  it("all ranges grow and wand is the longest", () => {
    for (const [id, before] of [["fists",40],["sword",64],["axe",60],["shield",44],["bow",240],["wand",220]] as const) {
      const shape = WEAPONS[id].shape;
      expect(shape.kind === "arc" ? shape.reach : shape.range).toBeGreaterThan(before);
    }
    expect(WEAPONS.wand.shape.kind === "projectile" ? WEAPONS.wand.shape.range : 0)
      .toBeGreaterThan(WEAPONS.bow.shape.kind === "projectile" ? WEAPONS.bow.shape.range : 0);
  });
});
