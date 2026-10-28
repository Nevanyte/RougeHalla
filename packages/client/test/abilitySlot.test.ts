// The reusable cooldown widget (ui/abilitySlot.ts): its pure model, the cooldown tracker, the deny rule, and the DOM view with
// the chrome tests' fake DOM, docked in the weapon bar.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ABILITIES, EFFECT_CASTING, EFFECT_ROOTED, EFFECT_SILENCED, EFFECT_STUNNED, type AbilityDef, type AbilityIcon,
} from "@raid/shared";
import {
  AbilitySlotView, CooldownTracker, DENY_MS, abilitySlotModel, castDenial, formatCooldown, iconClipPath, type AbilitySlotInput,
  type AbilitySlotModel,
} from "../src/ui/abilitySlot";
import { WeaponBar } from "../src/ui/weaponBar";
import { FEl, fake, installChromeDom } from "./chromeDom";

afterEach(() => { vi.unstubAllGlobals(); });

const BLAZE = ABILITIES.blaze;
const FREEZE = ABILITIES.freeze;
const input = (over: Partial<AbilitySlotInput> = {}): AbilitySlotInput => ({
  phase: "active", alive: true, ability: BLAZE, readyAt: 0, cooldownLen: 300_000, effects: 0, blockedBy: BLAZE.blockedBy, castUntil: 0, ...over,
});
const model = (over: Partial<AbilitySlotModel> = {}): AbilitySlotModel => ({
  state: "ready", name: "Blaze Step", tip: "Blaze Step", icon: "flame", color: 0xff7043, secondsLeft: 0, sweep: 0, blocked: null, cast: 0, ...over,
});

describe("abilitySlotModel", () => {
  it("is hidden before the run, after it, and when the player is down; the weapon bar goes with it", () => {
    expect(abilitySlotModel(input({ phase: "lobby" }), 0).state).toBe("hidden");
    expect(abilitySlotModel(input({ phase: "ended" }), 0).state).toBe("hidden");
    expect(abilitySlotModel(input({ alive: false }), 0).state).toBe("hidden");
    expect(abilitySlotModel(input({ alive: false, ability: null }), 0).state).toBe("hidden");
    expect(abilitySlotModel(input({ phase: "lobby", readyAt: 50_000 }), 0).secondsLeft).toBe(0);
  });

  it("is empty with no ability in the slot (a Q or E before skills exist), and says nothing of one", () => {
    const m = abilitySlotModel(input({ ability: null, blockedBy: [] }), 0);
    expect(m).toMatchObject({ state: "empty", name: "", icon: null, secondsLeft: 0, sweep: 0, blocked: null, cast: 0 });
  });

  it("names the ability and gives its icon and colour", () => {
    expect(abilitySlotModel(input(), 0)).toMatchObject({ state: "ready", name: "Blaze Step", icon: "flame", color: 0xff7043 });
    expect(abilitySlotModel(input({ ability: FREEZE }), 0)).toMatchObject({ name: "Freeze", icon: "snowflake", color: 0x81d4fa });
  });

  it("is ready with a ready time of 0 or one that has passed", () => {
    const m = abilitySlotModel(input({ readyAt: 0 }), 12_345);
    expect(m).toMatchObject({ state: "ready", secondsLeft: 0, sweep: 0, blocked: null, cast: 0 });
    expect(abilitySlotModel(input({ readyAt: 5000 }), 5000).state).toBe("ready");
    expect(abilitySlotModel(input({ readyAt: 5000 }), 9000).state).toBe("ready");
  });

  it("shows the run's 45 s lock as a cooldown: full wedge at the start, the seconds rounding up, ready at the end", () => {
    const lock = input({ readyAt: 45_000, cooldownLen: 45_000 });
    expect(abilitySlotModel(lock, 0)).toMatchObject({ state: "cooldown", secondsLeft: 45, sweep: 1 });
    expect(abilitySlotModel(lock, 22_500)).toMatchObject({ state: "cooldown", secondsLeft: 23, sweep: 0.5 });
    expect(abilitySlotModel(lock, 44_001)).toMatchObject({ state: "cooldown", secondsLeft: 1 });
    expect(abilitySlotModel(lock, 45_000)).toMatchObject({ state: "ready", secondsLeft: 0, sweep: 0 });
  });

  it("a Wish's 5 minutes count down from a full wedge, and the wedge never leaves 0..1", () => {
    const spent = input({ readyAt: 300_000 + 1000, cooldownLen: 300_000 });
    expect(abilitySlotModel(spent, 1000)).toMatchObject({ state: "cooldown", secondsLeft: 300, sweep: 1 });
    expect(abilitySlotModel(spent, 0).sweep).toBe(1); // more left than the length it was told: clamped
    expect(abilitySlotModel(input({ readyAt: 10_000, cooldownLen: 0 }), 9000).sweep).toBe(1);
  });

  it("is casting while the cast runs, with how far it is; the cooldown it spent shows alongside", () => {
    const freeze = input({ ability: FREEZE, blockedBy: FREEZE.blockedBy, readyAt: 301_000, cooldownLen: 300_000, castUntil: 1250 });
    expect(abilitySlotModel(freeze, 1000)).toMatchObject({ state: "casting", cast: 0, secondsLeft: 300, sweep: 1 });
    expect(abilitySlotModel(freeze, 1100).cast).toBeCloseTo(0.4, 12);
    expect(abilitySlotModel(freeze, 1249).cast).toBeCloseTo(0.996, 12);
    // Done: the cooldown's turn.
    expect(abilitySlotModel(freeze, 1250).state).toBe("cooldown");
    // A castUntil from before the cast began (the prediction's) does not push the bar below 0.
    expect(abilitySlotModel({ ...freeze, castUntil: 1500 }, 1000).cast).toBe(0);
  });

  it("is casting on the synced bit alone (a join in the middle of a cast), with no progress known", () => {
    expect(abilitySlotModel(input({ effects: EFFECT_CASTING }), 0)).toMatchObject({ state: "casting", cast: 0 });
  });

  it("is blocked when ready under a stun or a silence, naming it; a root does not block a Wish that lists only those two", () => {
    expect(abilitySlotModel(input({ effects: EFFECT_STUNNED }), 0)).toMatchObject({ state: "blocked", blocked: "stun" });
    expect(abilitySlotModel(input({ effects: EFFECT_SILENCED }), 0)).toMatchObject({ state: "blocked", blocked: "silence" });
    expect(abilitySlotModel(input({ effects: EFFECT_STUNNED | EFFECT_SILENCED }), 0).blocked).toBe("stun");
    expect(abilitySlotModel(input({ effects: EFFECT_ROOTED }), 0)).toMatchObject({ state: "ready", blocked: null });
    expect(abilitySlotModel(input({ effects: EFFECT_ROOTED, blockedBy: ["root"] }), 0)).toMatchObject({ state: "blocked", blocked: "root" });
  });

  it("a cooldown keeps its headline under a stun, and still says what blocks it", () => {
    const m = abilitySlotModel(input({ readyAt: 9000, cooldownLen: 9000, effects: EFFECT_STUNNED }), 0);
    expect(m).toMatchObject({ state: "cooldown", blocked: "stun", secondsLeft: 9 });
  });
});

describe("castDenial", () => {
  const deny = (over: Partial<AbilitySlotInput>, now = 0) => castDenial(abilitySlotModel(input(over), now));

  it("lets a ready slot through, and says nothing for a slot that is not showing", () => {
    expect(deny({})).toBeNull();
    expect(deny({ phase: "lobby" })).toBeNull();
    expect(deny({ alive: false })).toBeNull();
    expect(deny({ ability: null, blockedBy: [] })).toBeNull();
  });

  it("names the cooldown left, in minutes from a minute up", () => {
    expect(deny({ readyAt: 300_000, cooldownLen: 300_000 })).toBe("Ready in 5:00");
    expect(deny({ readyAt: 45_000, cooldownLen: 45_000 }, 1000)).toBe("Ready in 44");
    expect(deny({ readyAt: 61_000, cooldownLen: 61_000 })).toBe("Ready in 1:01");
  });

  it("names the stun or the silence, and a cast under way", () => {
    expect(deny({ effects: EFFECT_STUNNED })).toBe("Stunned");
    expect(deny({ effects: EFFECT_SILENCED })).toBe("Silenced");
    expect(deny({ effects: EFFECT_ROOTED, blockedBy: ["root"] })).toBe("Rooted");
    expect(deny({ castUntil: 500 })).toBe("Casting");
    expect(deny({ effects: EFFECT_CASTING })).toBe("Casting");
  });
});

describe("formatCooldown", () => {
  it("is whole seconds under a minute and m:ss from there", () => {
    expect(formatCooldown(0)).toBe("0");
    expect(formatCooldown(-3)).toBe("0");
    expect(formatCooldown(5)).toBe("5");
    expect(formatCooldown(59)).toBe("59");
    expect(formatCooldown(60)).toBe("1:00");
    expect(formatCooldown(299)).toBe("4:59");
    expect(formatCooldown(300)).toBe("5:00");
    expect(formatCooldown(4.2)).toBe("5");
  });
});

describe("CooldownTracker", () => {
  it("takes the length from the patch that changed the ready time, and keeps it while the ready time stands", () => {
    const t = new CooldownTracker();
    expect(t.observe(0, 1000)).toBe(1); // nothing running
    // The run starts: the lock ends 45 s after the patch that set it.
    expect(t.observe(46_000, 1000)).toBe(45_000);
    expect(t.observe(46_000, 1050)).toBe(45_000);
    expect(t.observe(46_000, 30_000)).toBe(45_000);
    // The cast: a new ready time, a new length.
    expect(t.observe(331_000, 31_000)).toBe(300_000);
    expect(t.observe(331_000, 31_050)).toBe(300_000);
  });

  it("keeps the length when the ready time moves earlier while the slot is still cooling (a Wishful Thinking trim, a refund): the ring jumps forward, it does not start over", () => {
    const t = new CooldownTracker();
    expect(t.observe(331_000, 31_000)).toBe(300_000);
    // Each hit trims a second off the running cooldown: the same 300 s ring, 1 s further on.
    expect(t.observe(330_000, 32_000)).toBe(300_000);
    expect(t.observe(329_000, 32_500)).toBe(300_000);
    expect(t.observe(326_000, 33_000)).toBe(300_000);
    // A trim that brings it to ready (its time is now) keeps the ring too; a fresh cast then starts a length of its own, and its trims keep that.
    expect(t.observe(34_000, 34_000)).toBe(300_000);
    expect(t.observe(250_000, 50_000)).toBe(200_000);
    expect(t.observe(249_000, 51_000)).toBe(200_000);
  });

  it("starts a length of its own for a later ready time, and for one first seen after the old cooldown had ended; never reports under 1 ms", () => {
    const t = new CooldownTracker();
    t.observe(331_000, 31_000);
    // The cooldown ended at 331 s; a cast at 340 s is a new length (the ready time moved LATER).
    expect(t.observe(640_000, 340_000)).toBe(300_000);
    // A short cooldown after it: the old one had ended, so an earlier ready time than before is still a fresh length.
    const u = new CooldownTracker();
    u.observe(100_000, 10_000);
    expect(u.observe(60_000, 120_000)).toBe(1); // already past its ready time when first seen: never under 1 ms
    expect(u.observe(0, 130_000)).toBe(1);
    expect(u.observe(130_000, 130_000)).toBe(1);
  });

  it("the first sight of a cooldown already running (a reconnect) is the time left", () => {
    expect(new CooldownTracker().observe(200_000, 150_000)).toBe(50_000);
  });

  it("reset forgets it", () => {
    const t = new CooldownTracker();
    t.observe(100_000, 0);
    t.reset();
    expect(t.observe(100_000, 40_000)).toBe(60_000);
  });
});

describe("iconClipPath", () => {
  const icons = [...new Set(Object.values(ABILITIES).map((a) => a.icon))] as AbilityIcon[];

  it("covers every ability's icon with a polygon of percentages inside the icon box", () => {
    expect(icons.length).toBe(5);
    for (const icon of icons) {
      const clip = iconClipPath(icon);
      expect(clip, icon).toMatch(/^polygon\(.+\)$/);
      const nums = [...clip.matchAll(/(-?\d+(?:\.\d+)?)%/g)].map((m) => Number(m[1]));
      expect(nums.length, icon).toBeGreaterThanOrEqual(6); // at least a triangle
      expect(nums.length % 2, icon).toBe(0);
      for (const n of nums) {
        expect(n, icon).toBeGreaterThanOrEqual(0);
        expect(n, icon).toBeLessThanOrEqual(100);
      }
    }
  });

  it("gives each icon its own shape", () => {
    expect(new Set(icons.map(iconClipPath)).size).toBe(icons.length);
  });
});

describe("AbilitySlotView", () => {
  function setup(key = "D") {
    const { ui } = installChromeDom();
    const view = new AbilitySlotView({ key });
    const el = fake(view.element);
    return { ui, view, el, box: el.byClass("as-slot")[0]!, deny: el.byClass("as-deny")[0]! };
  }
  const part = (root: FEl, cls: string): FEl => root.byClass(cls)[0]!;

  it("is a loose element, not attached anywhere, and hidden until it is first updated", () => {
    const { ui, view, el } = setup();
    expect(ui.children).toHaveLength(0);
    expect(el.parent).toBeNull();
    expect(el.hidden).toBe(true);
    expect(view.element).toBe(el as unknown as HTMLElement);
  });

  it("draws the key as a keycap in the slot's corner", () => {
    const { box } = setup("D");
    const cap = box.byClass("wb-key")[0]!;
    expect(cap.tagName).toBe("KBD");
    expect(cap.className).toMatch(/\bkeycap\b/);
    expect(cap.textContent).toBe("D");
    expect(setup("Z").box.byClass("wb-key")[0]!.textContent).toBe("Z");
  });

  it("shows a ready slot with its name, icon shape and colour", () => {
    const { view, el, box } = setup();
    view.update(model(), 0);
    expect(el.hidden).toBe(false);
    expect(box.classes.has("ready")).toBe(true);
    expect(box.classes.has("cooldown")).toBe(false);
    expect(part(box, "as-name").textContent).toBe("Blaze Step");
    expect(el.title).toBe("Blaze Step");
    expect(box.style.props["--as-color"]).toBe("#ff7043");
    expect(part(box, "as-icon").style.props["clip-path"]).toBe(iconClipPath("flame"));
    expect(part(box, "as-secs").textContent).toBe("");
    expect(part(box, "as-sweep").hidden).toBe(true);
    expect(part(box, "as-cast").hidden).toBe(true);
  });

  it("counts a cooldown down: the seconds in m:ss, the wedge shrinking, then ready again", () => {
    const { view, box } = setup();
    view.update(model({ state: "cooldown", secondsLeft: 299, sweep: 1 }), 0);
    expect(box.classes.has("cooldown")).toBe(true);
    expect(box.classes.has("ready")).toBe(false);
    expect(part(box, "as-secs").textContent).toBe("4:59");
    expect(part(box, "as-sweep").hidden).toBe(false);
    expect(part(box, "as-sweep").style.props["--cd"]).toBe("360deg");
    view.update(model({ state: "cooldown", secondsLeft: 45, sweep: 0.5 }), 16);
    expect(part(box, "as-secs").textContent).toBe("45");
    expect(part(box, "as-sweep").style.props["--cd"]).toBe("180deg");
    view.update(model(), 32);
    expect(box.classes.has("ready")).toBe(true);
    expect(box.classes.has("cooldown")).toBe(false);
    expect(part(box, "as-secs").textContent).toBe("");
    expect(part(box, "as-sweep").hidden).toBe(true);
  });

  it("shows the cast bar only while casting, filled to how far it has run", () => {
    const { view, box } = setup();
    view.update(model({ state: "casting", cast: 0.4, secondsLeft: 300, sweep: 1 }), 0);
    expect(box.classes.has("casting")).toBe(true);
    expect(part(box, "as-cast").hidden).toBe(false);
    expect(part(box, "as-cast-fill").style.props.width).toBe("40%");
    view.update(model({ state: "casting", cast: 0.8 }), 16);
    expect(part(box, "as-cast-fill").style.props.width).toBe("80%");
    view.update(model({ state: "cooldown", secondsLeft: 300, sweep: 1 }), 32);
    expect(part(box, "as-cast").hidden).toBe(true);
    expect(box.classes.has("casting")).toBe(false);
  });

  it("shows what blocks a ready slot, and tints a cooling one", () => {
    const { view, box } = setup();
    view.update(model({ state: "blocked", blocked: "stun" }), 0);
    expect(box.classes.has("blocked")).toBe(true);
    expect(box.classes.has("shut")).toBe(true);
    expect(part(box, "as-secs").textContent).toBe("Stunned");
    view.update(model({ state: "blocked", blocked: "silence" }), 16);
    expect(part(box, "as-secs").textContent).toBe("Silenced");
    view.update(model({ state: "cooldown", secondsLeft: 9, sweep: 0.1, blocked: "stun" }), 32);
    expect(box.classes.has("shut")).toBe(true);
    expect(box.classes.has("blocked")).toBe(false);
    expect(part(box, "as-secs").textContent).toBe("9");
    view.update(model(), 48);
    expect(box.classes.has("shut")).toBe(false);
  });

  it("an empty slot is dim with no icon; hidden hides the whole element", () => {
    const { view, el, box } = setup();
    view.update(model({ state: "empty", name: "", icon: null, color: 0 }), 0);
    expect(el.hidden).toBe(false);
    expect(box.classes.has("empty")).toBe(true);
    expect(part(box, "as-icon").hidden).toBe(true);
    view.update(model({ state: "hidden" }), 16);
    expect(el.hidden).toBe(true);
    view.update(model(), 32);
    expect(el.hidden).toBe(false);
  });

  it("shows a deny line for DENY_MS and then hides it, an update at a time", () => {
    const { view, deny } = setup();
    view.update(model(), 0);
    expect(deny.hidden).toBe(true);
    view.deny("Out of range", 1000);
    expect(deny.hidden).toBe(false);
    expect(deny.textContent).toBe("Out of range");
    view.update(model(), 1000 + DENY_MS - 1);
    expect(deny.hidden).toBe(false);
    view.update(model(), 1000 + DENY_MS);
    expect(deny.hidden).toBe(true);
  });

  it("denying again starts the second over and replaces the text", () => {
    const { view, deny } = setup();
    view.update(model(), 0);
    view.deny("No target", 1000);
    view.deny("No line of sight", 1800);
    expect(deny.textContent).toBe("No line of sight");
    view.update(model(), 2000 + 500);
    expect(deny.hidden).toBe(false);
    view.update(model(), 1800 + DENY_MS);
    expect(deny.hidden).toBe(true);
  });

  it("writes to the DOM only what changed", () => {
    const { view, box } = setup();
    const m = model({ state: "cooldown", secondsLeft: 12, sweep: 0.25 });
    view.update(m, 0);
    const secs = part(box, "as-secs");
    const name = part(box, "as-name");
    const writes = [secs.textWrites, name.textWrites];
    for (let i = 1; i < 30; i++) view.update(m, i * 16);
    expect([secs.textWrites, name.textWrites]).toEqual(writes);
  });

  it("destroy removes it", () => {
    const { view, el } = setup();
    view.destroy();
    expect(el.removed).toBe(true);
  });
});

describe("docked in the weapon bar", () => {
  function setup() {
    const { ui } = installChromeDom();
    const bar = new WeaponBar();
    const view = new AbilitySlotView({ key: "D" });
    bar.dock(view.element);
    const root = ui.children[0]!;
    return { ui, bar, view, root, row: root.byClass("wb-row")[0]! };
  }

  it("goes at the right end of the slot row, after both weapon slots and the swap key", () => {
    const { row, view } = setup();
    expect(row.children).toHaveLength(4);
    expect(row.children[3]).toBe(view.element as unknown as FEl);
    expect(row.children[0]!.hasClass("wb-slot")).toBe(true);
    expect(row.children[1]!.hasClass("wb-swap")).toBe(true);
    expect(row.children[2]!.hasClass("wb-slot")).toBe(true);
  });

  it("is inside the bar, so it hides and shows with it, and goes when the bar goes", () => {
    const { bar, root, view } = setup();
    expect(root.contains(view.element as unknown as FEl)).toBe(true);
    expect(root.hidden).toBe(true);
    bar.update({ status: "alive", weapon0: "sword", weapon1: "", slot: 0, readyAt: 0 } as never, 0, 0, null);
    expect(root.hidden).toBe(false);
    bar.destroy();
    expect(root.removed).toBe(true);
  });

  it("does not change the bar's own slots: the weapon cooldown still sweeps over both of them only", () => {
    const { bar, root } = setup();
    bar.update({ status: "alive", weapon0: "sword", weapon1: "", slot: 0, readyAt: 6000 } as never, 5000, 5000, null);
    const sweeps = root.byClass("wb-sweep");
    expect(sweeps).toHaveLength(2);
    for (const s of sweeps) expect(s.hidden).toBe(false);
  });
});
