// PlayerView's barrier (Phase 11, R4a): a pale-blue segment on the hp bar and a bubble round the body, both drawn from the
// public state, against BARRIER_FULL_SHARE of max hp. The bow's draw follows the attack-speed and windup mirrors. The scene is fake (test/fakes.ts); the parts are found by their place in the container the view builds.
import { describe, expect, it, vi } from "vitest";
import { ABILITIES, BARRIER_FULL_SHARE, EFFECT_HIDDEN, EFFECT_STUNNED, FACTIONS, WIRE_IDENTITY_MIRRORS, encodeMult } from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { PlayerView } from "../src/render/PlayerView";
import { FighterArt, fullDrawSeconds } from "../src/render/FighterArt";
import { NO_STATES, type TerrainStates } from "../src/render/zoneArt/terrainFeedback";
import { screenAngle } from "../src/render/projection";
import { BARRIER_COLOR } from "../src/ui/buffTheme";
import { getSettings, updateSettings } from "../src/settings";
import { argsOf, fakeScene, type FakeObject } from "./fakes";

/** Matches `scene.add.container(0, 0, [...])` in PlayerView's constructor. */
const CHILD = { barrierRing: 7, hpBar: 13 } as const;
/** The status art is the last child before the overhead rail and effects. */
const STATUS = 18;
const MAX_HP = 1000;

function player(over: Partial<Record<keyof PlayerState, unknown>> = {}): PlayerState {
  return {
    name: "Ann", look: 0, x: 0, y: 0, facing: 0, hp: MAX_HP, maxHp: MAX_HP, barrier: 0, status: "alive", faction: "fire", weapon0: "sword",
    weapon1: "", slot: 0, drawStartedAt: 0, readyAt: 0, sig: 0, brand: 0, bounty: 0, immuneUntil: 0, effects: 0, wishReadyAt: 0,
    ...WIRE_IDENTITY_MIRRORS, ...over,
  } as unknown as PlayerState;
}

function setup() {
  const { scene, ofKind, bakedCalls } = fakeScene();
  const view = new PlayerView(scene, false);
  const root = ofKind("container").at(-1)!;
  const kids = root.args[2] as FakeObject[];
  const ring = kids[CHILD.barrierRing]!;
  const bar = kids[CHILD.hpBar]!;
  return { view, root, ring, bar, bakedCalls, frame: (p: PlayerState, drawAsAlive = false) => view.update(0, 0, p, 1000, 1000, drawAsAlive) };
}

/** The line width and alpha of the bubble's outline: both grow with the barrier. */
const outline = (ring: FakeObject) => argsOf(ring, "lineStyle")[0]!;

describe("PlayerView build icons", () => {
  it("shows Wish, the secondary weapon and the top two stats in one rail, without damage numbers", () => {
    const { scene, ofKind } = fakeScene();
    const view = new PlayerView(scene, false);
    const textCount = ofKind("text").length;
    const marks = (view as unknown as { buildMarks: FakeObject }).buildMarks;
    view.update(0, 0, player({
      weapon1: "bow", adBonus: 300, apBonus: 400, armorBonus: 500, shieldBonus: 600, asMult: 1250, speedMult: 1100,
      mobStats: new Map([["rotMonk", 4], ["emberImp", 4]]),
    }), 1000, 1000);
    expect(argsOf(marks, "add")).toHaveLength(4);
    expect(argsOf(marks, "add").every(([mark]) => (mark as FakeObject).kind === "graphics")).toBe(true);
    const icons = argsOf(marks, "add").map(([mark]) => mark as FakeObject);
    expect(icons[0]!.state.name).toBe("Blaze Step: ready");
    expect(icons[1]!.state.name).toBe("Secondary weapon: Bow");
    expect(argsOf(icons[1]!, "fillRoundedRect")[0]![0]).toBe(-25.5);
    expect(argsOf(icons[1]!, "fillRoundedRect")[0]![2]).toBe(24);
    expect(icons.slice(2).every(icon => !String(icon.state.name).startsWith("Secondary"))).toBe(true);
    expect(ofKind("text")).toHaveLength(textCount);
  });

  it("refreshes the secondary icon on swaps and represents an empty slot with fists", () => {
    const { scene } = fakeScene();
    const view = new PlayerView(scene, false);
    const marks = (view as unknown as { buildMarks: FakeObject }).buildMarks;
    const p = player({ weapon0: "sword", weapon1: "bow", slot: 0, maxHp: FACTIONS.fire.hp });
    const lastWeapon = () => (argsOf(marks, "add").at(-1)![0] as FakeObject).state.name;
    view.update(0, 0, p, 1000, 1000);
    expect(lastWeapon()).toBe("Secondary weapon: Bow");
    p.slot = 1;
    view.update(0, 0, p, 1016, 1000);
    expect(lastWeapon()).toBe("Secondary weapon: Sword");
    p.weapon0 = "";
    view.update(0, 0, p, 1032, 1000);
    expect(lastWeapon()).toBe("Secondary weapon: Fists");
  });

  it("draws the slot it is told to, for a swap the patch has not shown yet: the held weapon and the secondary icon follow", () => {
    const { scene } = fakeScene();
    const view = new PlayerView(scene, true);
    const marks = (view as unknown as { buildMarks: FakeObject }).buildMarks;
    const art = (view as unknown as { art: FighterArt }).art;
    const drawn = vi.spyOn(art, "update");
    const p = player({ weapon0: "sword", weapon1: "bow", slot: 0, maxHp: FACTIONS.fire.hp });
    const lastWeapon = () => (argsOf(marks, "add").at(-1)![0] as FakeObject).state.name;
    const held = () => (view as unknown as { usingWeapon: string }).usingWeapon;
    const slotDrawn = () => (drawn.mock.lastCall![0] as { slot: number }).slot;
    view.update(0, 0, p, 1000, 1000);
    expect([held(), lastWeapon(), slotDrawn()]).toEqual(["sword", "Secondary weapon: Bow", 0]);
    view.update(0, 0, p, 1016, 1000, false, false, null, NO_STATES, false, 1);
    expect([held(), lastWeapon(), slotDrawn()]).toEqual(["bow", "Secondary weapon: Sword", 1]);
    // A predicted facing replaces the synced one in the same view of the fighter, and the slot rides along.
    view.update(0, 0, p, 1032, 1000, false, false, 0.7, NO_STATES, false, 1);
    expect(drawn.mock.lastCall![0]).toMatchObject({ slot: 1, facing: 0.7, weapon0: "sword", weapon1: "bow" });
    expect(held()).toBe("bow");
    // Left out, the slot is the synced one again, and the synced fighter itself is what the art reads.
    view.update(0, 0, p, 1048, 1000);
    expect([held(), lastWeapon()]).toEqual(["sword", "Secondary weapon: Bow"]);
    expect(drawn.mock.lastCall![0]).toBe(p);
  });

  it("refreshes icons when mob rewards change without changing any stat mirror", () => {
    const { scene } = fakeScene();
    const view = new PlayerView(scene, false);
    const marks = (view as unknown as { buildMarks: FakeObject }).buildMarks;
    const mobStats = new Map<string, number>();
    const p = player({ maxHp: FACTIONS.fire.hp, hp: FACTIONS.fire.hp, mobStats });
    view.update(0, 0, p, 1000, 1000);
    expect(argsOf(marks, "add")).toHaveLength(2);
    mobStats.set("rotMonk", 1);
    view.update(0, 0, p, 1016, 1000);
    expect(argsOf(marks, "add")).toHaveLength(5);
    const redraws = argsOf(marks, "removeAll").length;
    view.update(0, 0, p, 1032, 1000);
    expect(argsOf(marks, "removeAll")).toHaveLength(redraws);
    mobStats.set("emberImp", 1);
    view.update(0, 0, p, 1048, 1000);
    expect(argsOf(marks, "removeAll")).toHaveLength(redraws + 1);
  });
});

describe("PlayerView barrier", () => {
  it("draws nothing without a barrier", () => {
    const { ring, frame } = setup();
    frame(player());
    expect(ring.calls).toEqual([]);
    expect(ring.clears).toBe(0);
  });

  it("draws a bubble that grows with the barrier, up to BARRIER_FULL_SHARE of max hp, and clears it when the barrier is gone", () => {
    const { ring, frame } = setup();
    const full = MAX_HP * BARRIER_FULL_SHARE;
    frame(player({ barrier: full / 8 }));
    expect(argsOf(ring, "fillCircle")).toHaveLength(1);
    expect(argsOf(ring, "strokeCircle")).toHaveLength(1);
    expect(outline(ring)[1]).toBe(BARRIER_COLOR);
    const small = outline(ring)[0] as number;
    frame(player({ barrier: full }));
    const big = outline(ring)[0] as number;
    expect(big).toBeGreaterThan(small);
    frame(player({ barrier: full * 5 }));
    expect(outline(ring)[0]).toBe(big); // the bubble is capped at a full barrier
    frame(player());
    expect(ring.calls).toEqual([]);
  });

  it("repaints only when the bubble moves a whole step", () => {
    const { ring, frame } = setup();
    const full = MAX_HP * BARRIER_FULL_SHARE;
    frame(player({ barrier: full * 0.5 }));
    const clears = ring.clears;
    frame(player({ barrier: full * 0.51 })); // the same eighth
    expect(ring.clears).toBe(clears);
    frame(player({ barrier: full * 0.7 }));
    expect(ring.clears).toBe(clears + 1);
  });

  it("adds the barrier to the hp bar after the hp, in its own colour", () => {
    const { bar, frame } = setup();
    frame(player({ hp: 500, barrier: 150 }));
    const [, fill, barrier] = bar.args[2] as FakeObject[];
    expect(barrier!.state.visible).toBe(true);
    expect(argsOf(barrier!, "setTint")[0]).toEqual([BARRIER_COLOR]);
    // The barrier segment starts where the hp one ends.
    const [fx, fw] = [argsOf(fill!, "setPosition")[0]![0] as number, argsOf(fill!, "setDisplaySize")[0]![0] as number];
    expect(argsOf(barrier!, "setPosition")[0]![0]).toBeCloseTo(fx + fw, 9);
    expect(argsOf(barrier!, "setDisplaySize")[0]![0]).toBeGreaterThan(0);
  });

  it("is hidden with the rest of the view for a player who is down", () => {
    const { root, frame } = setup();
    frame(player({ status: "dead", barrier: 100 }));
    expect(root.state.visible).toBe(false);
    frame(player({ status: "dead", barrier: 100 }), true); // a death still ahead of render time
    expect(root.state.visible).toBe(true);
  });
});

describe("PlayerView predicted facing", () => {
  /** Matches the container's children: the nose after the body and its core, the weapon in hand after it. */
  const NOSE = 9;
  const HELD = 10;

  it("turns the nose to the facing it is given, and back to the synced one when it gets none", () => {
    const { root, view } = setup();
    const nose = (root.args[2] as FakeObject[])[NOSE]!;
    const bare = (facing: number) => player({ weapon0: "", facing });
    view.update(0, 0, bare(0.5), 1000, 1000);
    expect(nose.state.rotation).toBeCloseTo(screenAngle(0.5), 9);
    view.update(0, 0, bare(0.5), 1000, 1000, false, false, -2);
    expect(nose.state.rotation).toBeCloseTo(screenAngle(-2), 9);
    view.update(0, 0, bare(0.5), 1000, 1000, false, false, null);
    expect(nose.state.rotation).toBeCloseTo(screenAngle(0.5), 9);
  });

  it("turns the weapon in hand with it and leaves the synced state alone", () => {
    const { root, view } = setup();
    const held = (root.args[2] as FakeObject[])[HELD]!;
    const p = player({ weapon0: "sword", facing: 1 });
    view.update(0, 0, p, 1000, 1000);
    const synced = held.state.rotation as number;
    view.update(0, 0, p, 1000, 1000, false, false, -1.2);
    expect(held.state.rotation).not.toBeCloseTo(synced, 3);
    expect(Math.abs((held.state.rotation as number) - screenAngle(-1.2))).toBeLessThan(0.5); // the juice pose adds a little of its own
    expect(p.facing).toBe(1);
    expect(p.weapon0).toBe("sword");
    view.update(0, 0, p, 1000, 1000);
    expect(held.state.rotation).toBeCloseTo(synced, 9);
  });
});

// Wishes: a hidden fighter (a Swarm), the status layers and the Wish badge in the overhead rail.
describe("PlayerView hidden fighters", () => {
  function twin(isLocal: boolean) {
    const { scene, ofKind } = fakeScene();
    const view = new PlayerView(scene, isLocal);
    const root = ofKind("container").at(-1)!;
    return { view, root, frame: (p: PlayerState, drawAsAlive = false) => view.update(0, 0, p, 1000, 1000, drawAsAlive) };
  }

  it("does not draw a remote fighter that is hidden, and draws it again when it is revealed", () => {
    const { root, frame } = twin(false);
    frame(player());
    expect(root.state.visible).toBe(true);
    frame(player({ effects: EFFECT_HIDDEN }));
    expect(root.state.visible).toBe(false);
    frame(player({ effects: EFFECT_HIDDEN }), true); // not even for a death still ahead of render time
    expect(root.state.visible).toBe(false);
    frame(player({ effects: 0 }));
    expect(root.state.visible).toBe(true);
  });

  it("keeps a hidden remote fighter's status marks and figure out of sight too", () => {
    const { root, view } = twin(false);
    const status = (root.args[2] as FakeObject[])[STATUS];
    view.update(0, 0, player({ effects: EFFECT_STUNNED }), 1000, 1000);
    expect(status!.calls.length).toBeGreaterThan(0);
    view.update(0, 0, player({ effects: EFFECT_STUNNED | EFFECT_HIDDEN }), 1000, 1000);
    expect(status!.calls).toEqual([]);
  });

  it("draws the local fighter faint while it is hidden, and whole again after", () => {
    const { root, frame } = twin(true);
    frame(player());
    expect(root.state.visible).toBe(true);
    expect(root.state.alpha).toBeUndefined(); // untouched while it is whole
    frame(player({ effects: EFFECT_HIDDEN }));
    expect(root.state.visible).toBe(true);
    expect(root.state.alpha).toBe(0.45);
    frame(player({ effects: EFFECT_HIDDEN | EFFECT_STUNNED }));
    expect(root.state.alpha).toBe(0.45);
    frame(player({ effects: 0 }));
    expect(root.state.alpha).toBe(1);
  });

  it("still hides a hidden local fighter who is down", () => {
    const { root, frame } = twin(true);
    frame(player({ status: "dead", effects: EFFECT_HIDDEN }));
    expect(root.state.visible).toBe(false);
  });

  it("sets the alpha only when it changes", () => {
    const { root, frame } = twin(true);
    frame(player({ effects: EFFECT_HIDDEN }));
    const sets = () => root.calls.filter(([n]) => n === "setAlpha").length;
    const n = sets();
    frame(player({ effects: EFFECT_HIDDEN }));
    frame(player({ effects: EFFECT_HIDDEN }));
    expect(sets()).toBe(n);
  });
});

describe("PlayerView status marks", () => {
  it("draws the status layers in the container and nothing without a status", () => {
    const { scene, ofKind } = fakeScene();
    const view = new PlayerView(scene, false);
    const status = (ofKind("container").at(-1)!.args[2] as FakeObject[])[STATUS]!;
    view.update(0, 0, player(), 1000, 1000);
    expect(status.calls).toEqual([]);
    view.update(0, 0, player({ effects: EFFECT_STUNNED }), 1000, 1000);
    expect(status.calls.length).toBeGreaterThan(0);
    view.update(0, 0, player({ effects: 0 }), 1000, 1000);
    expect(status.calls).toEqual([]);
  });
});

describe("PlayerView Fire roaming glow", () => {
  it("only shows the full-charge ring and holds it still under reduced motion", () => {
    const { scene } = fakeScene();
    const view = new PlayerView(scene, false);
    const glow = (view as unknown as { fireRoamGlow: FakeObject }).fireRoamGlow;
    let now = 10000;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const previous = getSettings();
    try {
      updateSettings({ juice: 1, reducedMotion: true });
      view.update(0, 0, player({ roamReady: false }), 1000, 1000);
      expect(argsOf(glow, "strokeCircle")).toHaveLength(0);

      const ready = player({ roamReady: true });
      view.update(0, 0, ready, 1000, 1000);
      const still = argsOf(glow, "strokeCircle");
      expect(still).toHaveLength(2);
      now += 100;
      view.update(0, 0, ready, 1016, 1000);
      expect(argsOf(glow, "strokeCircle")).toEqual(still);

      updateSettings({ reducedMotion: false });
      now += 100;
      view.update(0, 0, ready, 1032, 1000);
      const moving = argsOf(glow, "strokeCircle");
      now += 100;
      view.update(0, 0, ready, 1048, 1000);
      expect(argsOf(glow, "strokeCircle")).not.toEqual(moving);
    } finally {
      updateSettings({ juice: previous.juice, reducedMotion: previous.reducedMotion });
      clock.mockRestore();
    }
  });
});

describe("PlayerView Wish badge", () => {
  function badged(over: Partial<Record<keyof PlayerState, unknown>> = {}) {
    const { scene } = fakeScene();
    const view = new PlayerView(scene, false);
    const marks = (view as unknown as { buildMarks: FakeObject }).buildMarks;
    const badges = () => argsOf(marks, "add").map(([mark]) => mark as FakeObject);
    const wish = () => badges().filter((mark) => /: (ready|recharging)$/.test(String(mark.state.name))).at(-1);
    const redraws = () => argsOf(marks, "removeAll").length;
    return {
      marks, badges, wish, redraws,
      frame: (renderT: number, more: Partial<Record<keyof PlayerState, unknown>> = {}) => view.update(0, 0, player({ ...over, ...more }), renderT, renderT),
    };
  }

  it("draws the faction's Wish in grey until its ready time, then in its own colour with a ready dot", () => {
    const { wish, frame } = badged({ faction: "fire", wishReadyAt: 5000 });
    frame(1000);
    expect(wish()!.state.name).toBe("Blaze Step: recharging");
    expect(argsOf(wish()!, "fillStyle")).toContainEqual([0x607d8b, 0.6]);
    expect(argsOf(wish()!, "fillStyle")).toContainEqual([0x78909c, 1]);
    frame(4999);
    expect(argsOf(wish()!, "fillStyle")).toContainEqual([0x607d8b, 0.6]);
    frame(5000);
    expect(wish()!.state.name).toBe("Blaze Step: ready");
    expect(argsOf(wish()!, "fillStyle")).toContainEqual([ABILITIES.blaze.color, 1]);
    expect(argsOf(wish()!, "fillStyle")).toContainEqual([0x69f0ae, 1]);
  });

  it("is in its own colour from the start when the Wish is ready (the training room, a spent cooldown)", () => {
    const { wish, frame } = badged({ faction: "frost", wishReadyAt: 0 });
    frame(1000);
    expect(argsOf(wish()!, "fillStyle")).toContainEqual([ABILITIES.freeze.color, 1]);
  });

  it("is each faction's own icon", () => {
    for (const [faction, id] of [["frost", "freeze"], ["plague", "swarm"], ["sentenced", "trial"], ["fire", "blaze"], ["holy", "lastStand"]] as const) {
      const { wish, frame } = badged({ faction });
      frame(1000);
      expect(argsOf(wish()!, "fillStyle").some(([color]) => color === ABILITIES[id].color), faction).toBe(true);
    }
  });

  it("uses a 24 px badge in a centred rail above the name", () => {
    const { marks, badges, wish, frame } = badged({ faction: "fire", name: "Ann" });
    frame(1000);
    expect(badges()[0]).toBe(wish());
    const rects = badges().map((badge) => argsOf(badge, "fillRoundedRect")[0]!);
    expect(rects.every((rect) => rect[2] === 24 && rect[3] === 24 && rect[1] === -12)).toBe(true);
    const centres = rects.map((rect) => (rect[0] as number) + 12);
    expect(centres.reduce((a, b) => a + b, 0) / centres.length).toBe(0);
    expect(argsOf(marks, "setY").at(-1)![0]).toBeLessThan(-14 - 12 - 18);
  });

  it("redraws only when readiness changes, not every frame or when the name changes", () => {
    const { wish, redraws, frame } = badged({ faction: "fire", wishReadyAt: 5000 });
    frame(1000);
    const first = wish();
    const n = redraws();
    frame(1016);
    frame(1032);
    expect(redraws()).toBe(n);
    expect(wish()).toBe(first);
    frame(5000);
    expect(redraws()).toBe(n + 1);
    expect(wish()).not.toBe(first);
    frame(5016);
    frame(5032, { name: "Annabel" });
    expect(redraws()).toBe(n + 1);
  });

  it("is not drawn in the lobby, where every Wish reads ready (the lock only starts with the run)", () => {
    const { wish, frame } = badged({ faction: "fire", status: "lobby", wishReadyAt: 0 });
    frame(1000);
    expect(wish()).toBeUndefined();
    // The run starts: the same fighter is alive and its Wish is locked, so the badge appears grey.
    frame(1016, { status: "alive", wishReadyAt: 46000 });
    expect(wish()!.state.name).toBe("Blaze Step: recharging");
    expect(argsOf(wish()!, "fillStyle")).toContainEqual([0x607d8b, 0.6]);
  });

  it("is not drawn for a fighter with no faction", () => {
    const { wish, frame } = badged({ faction: "" });
    frame(1000);
    expect(wish()).toBeUndefined();
  });
});

describe("PlayerView bow draw", () => {
  const HELD = 10;
  const glows = (over: Partial<Record<keyof PlayerState, unknown>>, facing: number | null, now = 1100): boolean => {
    const { root, view, bakedCalls } = setup();
    const held = (root.args[2] as FakeObject[])[HELD]!;
    view.update(0, 0, player({ faction: "sentenced", weapon0: "bow", drawStartedAt: 1000, ...over }), now, now, false, false, facing);
    return bakedCalls(held).includes("strokeCircle");
  };

  it("draws to the attack-speed and windup mirrors, with the synced facing and with a predicted one", () => {
    for (const facing of [null, -0.4]) {
      const checks = [
        [{}, "sentenced", fullDrawSeconds("sentenced")],
        [{ asMult: encodeMult(1.25) }, "sentenced", fullDrawSeconds("sentenced", encodeMult(1.25))],
        [{ windupMult: encodeMult(1.2) }, "sentenced", fullDrawSeconds("sentenced", 1000, encodeMult(1.2))],
        [{ windupMult: encodeMult(0.85) }, "sentenced", fullDrawSeconds("sentenced", 1000, encodeMult(0.85))],
        [{ faction: "fire" }, "fire", fullDrawSeconds("fire")],
        [{ faction: "fire", windupMult: encodeMult(0.85) }, "fire", fullDrawSeconds("fire", 1000, encodeMult(0.85))],
      ] as const;
      for (const [fields, faction, seconds] of checks) {
        const frame = 1000 + Math.ceil(seconds * 1000);
        expect(glows(fields, facing, frame - 1), `${faction} just before full draw, facing ${facing}`).toBe(false);
        expect(glows(fields, facing, frame), `${faction} at full draw, facing ${facing}`).toBe(true);
      }
    }
  });

  it("reads nothing but the mirrors: the cards map does not shorten the pull", () => {
    // A held card reaches the draw only through the mirror the server folds it into (an unfolded card changes nothing here).
    expect(glows({ build: new Map([["haste1", 6]]) }, null)).toBe(false);
  });

  it("an older server with no mirror fields leaves them undefined: the unbuffed draw", () => {
    expect(glows({ asMult: undefined, windupMult: undefined }, null)).toBe(false);
  });

  it("applies local bow pull overrides only to the local player", () => {
    const localScene = fakeScene();
    const local = new PlayerView(localScene.scene, true);
    const localArt = (local as unknown as { art: FighterArt }).art;
    local.setLocalBowPull(0.75);
    local.update(0, 0, player({ weapon0: "bow", drawStartedAt: 0 }), 1000, 1000);
    expect(localArt.pull).toBe(0.75);
    local.setLocalBowPull(-1);
    local.update(0, 0, player({ weapon0: "bow", drawStartedAt: 1000 }), 1100, 1200);
    expect(localArt.pull).toBe(-1);

    const remoteScene = fakeScene();
    const remote = new PlayerView(remoteScene.scene, false);
    const remoteArt = (remote as unknown as { art: FighterArt }).art;
    remote.setLocalBowPull(0.75); // ignored because this view is not the local player
    const draw = player({ weapon0: "bow", drawStartedAt: 1000 });
    remote.update(0, 0, draw, 1100, 1200);
    expect(remoteArt.pull).toBeCloseTo(0.1 / fullDrawSeconds("fire"), 8);
  });
});

describe("PlayerView nameplate", () => {
  /** The nameplate is the first text the view makes; its last setText is what is drawn. */
  function plate(over: Partial<Record<keyof PlayerState, unknown>>): unknown {
    const { scene, ofKind } = fakeScene();
    const view = new PlayerView(scene, false);
    view.update(0, 0, player(over), 1000, 1000);
    return ofKind("text")[0]!.state.text;
  }

  it("shows a person's name as it is", () => {
    expect(plate({})).toBe("Ann");
    expect(plate({ bot: false })).toBe("Ann");
  });

  it("tags a server-filled bot", () => {
    expect(plate({ name: "Grimbold", bot: true })).toBe("[BOT] Grimbold");
  });
});

describe("PlayerView feet effects", () => {
  const burning: TerrainStates = { ...NO_STATES, kind: 4, burning: true };
  const homeOnly: TerrainStates = { ...NO_STATES, kind: 4, home: true };

  it("makes no Graphics for them until the fighter first stands on a hazard (unstyled maps and the hub allocate nothing)", () => {
    const { scene, ofKind } = fakeScene();
    const view = new PlayerView(scene, false);
    const made = ofKind("graphics").length;
    for (let i = 0; i < 3; i++) view.update(0, 0, player(), 1000 + i, 1000 + i);
    view.update(0, 0, player(), 1010, 1010, false, false, null, homeOnly); // home ground with no effect shows nothing either
    view.update(0, 0, player({ status: "dead", hp: 0 }), 1020, 1020); // an unseen fighter hides a feet effect that was never made
    expect(ofKind("graphics")).toHaveLength(made + 3); // Wish, secondary weapon and Fire's invested move-speed badge.
    view.update(10, 10, player(), 1030, 1030, false, false, null, burning);
    const graphics = ofKind("graphics");
    expect(graphics).toHaveLength(made + 4); // the three rail badges and the lazily-created feet effect
    const feet = graphics[graphics.length - 1]!;
    expect(feet.state.visible).toBe(true);
    expect(feet.calls.some(([n]) => n === "fillCircle" || n === "fillTriangle" || n === "fillPoints" || n === "fillStyle")).toBe(true);
    view.update(10, 10, player(), 1040, 1040, false, false, null, burning);
    expect(ofKind("graphics")).toHaveLength(made + 4); // feet effect made once
    view.update(10, 10, player(), 1050, 1050); // off the hazard: hidden, kept
    expect(feet.state.visible).toBe(false);
    view.destroy();
    expect(feet.calls.some(([n]) => n === "destroy")).toBe(true);
  });

  it("destroys cleanly when it never made them", () => {
    const { view } = setup();
    expect(() => view.destroy()).not.toThrow();
  });
});
