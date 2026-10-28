// PlayerView's barrier (Phase 11, R4a): a pale-blue segment on the hp bar and a bubble round the body, both drawn from the
// public state, against BARRIER_FULL_SHARE of max hp. The bow's draw follows the attack-speed and windup mirrors. The scene is fake (test/fakes.ts); the parts are found by their place in the container the view builds.
import { describe, expect, it } from "vitest";
import { ABILITIES, BARRIER_FULL_SHARE, EFFECT_HIDDEN, EFFECT_STUNNED, FACTIONS, WIRE_IDENTITY_MIRRORS, encodeMult } from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { PlayerView } from "../src/render/PlayerView";
import { fullDrawSeconds } from "../src/render/FighterArt";
import { NO_STATES, type TerrainStates } from "../src/render/zoneArt/terrainFeedback";
import { screenAngle } from "../src/render/projection";
import { BARRIER_COLOR } from "../src/ui/buffTheme";
import { argsOf, fakeScene, type FakeObject } from "./fakes";

/** Matches `scene.add.container(0, 0, [...])` in PlayerView's constructor. */
const CHILD = { barrierRing: 7, hpBar: 13 } as const;
/** The status art and the Wish icon, the last two children. */
const STATUS = 19;
const ICON = 20;
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

// Wishes: a hidden fighter (a Swarm), the status layers and the small Wish icon beside the name.
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

describe("PlayerView Wish icon", () => {
  function iconed(over: Partial<Record<keyof PlayerState, unknown>> = {}) {
    const { scene, ofKind, baked } = fakeScene();
    const view = new PlayerView(scene, false);
    const kids = ofKind("container").at(-1)!.args[2] as FakeObject[];
    const icon = kids[ICON]!;
    /** What the icon's texture draws (the Wish's silhouette in its colour), and how often it swapped texture or moved. */
    const drawn = () => ({ calls: baked.get(String(icon.state.texture))?.calls ?? [] });
    const swaps = () => argsOf(icon, "setTexture").length;
    const moves = () => argsOf(icon, "setPosition").length;
    const wishBakes = () => [...baked.keys()].filter((k) => k.startsWith("bk:wish:"));
    return {
      icon, drawn, swaps, moves, wishBakes,
      frame: (renderT: number, more: Partial<Record<keyof PlayerState, unknown>> = {}) => view.update(0, 0, player({ ...over, ...more }), renderT, renderT),
    };
  }

  it("draws the faction's Wish in grey until its ready time, then in its own colour", () => {
    const { drawn, frame } = iconed({ faction: "fire", wishReadyAt: 5000 });
    frame(1000);
    expect(argsOf(drawn(), "fillStyle")[0]).toEqual([0x607d8b, 0.6]);
    frame(4999);
    expect(argsOf(drawn(), "fillStyle")[0]).toEqual([0x607d8b, 0.6]);
    frame(5000);
    expect(argsOf(drawn(), "fillStyle")[0]).toEqual([ABILITIES.blaze.color, 1]);
  });

  it("is in its own colour from the start when the Wish is ready (the training room, a spent cooldown)", () => {
    const { drawn, frame } = iconed({ faction: "frost", wishReadyAt: 0 });
    frame(1000);
    expect(argsOf(drawn(), "fillStyle")[0]).toEqual([ABILITIES.freeze.color, 1]);
  });

  it("is each faction's own icon", () => {
    for (const [faction, id] of [["frost", "freeze"], ["plague", "swarm"], ["sentenced", "trial"], ["fire", "blaze"], ["holy", "lastStand"]] as const) {
      const { drawn, frame } = iconed({ faction });
      frame(1000);
      expect(argsOf(drawn(), "fillStyle")[0]![0], faction).toBe(ABILITIES[id].color);
    }
  });

  it("sits to the left of the name, level with it", () => {
    const { icon, frame } = iconed({ faction: "fire", name: "Ann" });
    frame(1000);
    const [x, y] = icon.state.position as [number, number];
    expect(x).toBeLessThan(-9); // clear of the name's left edge (at least half its width out)
    expect(y).toBeLessThan(-14 - 12 - 18 + 5); // up at the name's line, over the head
  });

  it("is baked once per Wish and ready state, shared by every fighter, and changes only when its look does", () => {
    const { icon, swaps, moves, wishBakes, frame } = iconed({ faction: "fire", wishReadyAt: 5000 });
    frame(1000);
    expect(wishBakes()).toHaveLength(1);
    const [s, m] = [swaps(), moves()];
    frame(1016);
    frame(1032);
    expect([swaps(), moves()]).toEqual([s, m]);
    frame(5000);
    expect(swaps()).toBe(s + 1);
    expect(wishBakes()).toHaveLength(2);
    frame(5016);
    expect(swaps()).toBe(s + 1);
    const m2 = moves();
    frame(5032, { name: "Annabel" }); // the name moves it
    expect(moves()).toBe(m2 + 1);
    expect(swaps()).toBe(s + 1);
    expect(icon.state.visible).toBe(true);
  });

  it("is not drawn in the lobby, where every Wish reads ready (the lock only starts with the run)", () => {
    const { icon, drawn, wishBakes, frame } = iconed({ faction: "fire", status: "lobby", wishReadyAt: 0 });
    frame(1000);
    expect(icon.state.visible).toBe(false);
    expect(wishBakes()).toHaveLength(0);
    // The run starts: the same fighter is alive and its Wish is locked, so the icon appears grey.
    frame(1016, { status: "alive", wishReadyAt: 46000 });
    expect(icon.state.visible).toBe(true);
    expect(argsOf(drawn(), "fillStyle")[0]).toEqual([0x607d8b, 0.6]);
  });

  it("is not drawn for a fighter with no faction", () => {
    const { icon, wishBakes, frame } = iconed({ faction: "" });
    frame(1000);
    expect(icon.state.visible).toBe(false);
    expect(wishBakes()).toHaveLength(0);
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
    expect(ofKind("graphics")).toHaveLength(made + 1); // PlayerView allocates its strength glow up front.
    view.update(10, 10, player(), 1030, 1030, false, false, null, burning);
    const graphics = ofKind("graphics");
    expect(graphics).toHaveLength(made + 2); // one fighter glow plus the lazily-created feet effect
    const feet = graphics[graphics.length - 1]!;
    expect(feet.state.visible).toBe(true);
    expect(feet.calls.some(([n]) => n === "fillCircle" || n === "fillTriangle" || n === "fillPoints" || n === "fillStyle")).toBe(true);
    view.update(10, 10, player(), 1040, 1040, false, false, null, burning);
    expect(ofKind("graphics")).toHaveLength(made + 2); // feet effect made once
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
