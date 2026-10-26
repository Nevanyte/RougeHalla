// The chip's "pop" flash (ui/buffsHud.ts, buffsHud.css) plays on every rise, not just the first: a CSS animation does not restart
// when its class is toggled off and on in the same task, so the class comes off at `animationend` (or a timer, if that never
// comes) and a rise while it is still on takes it off, forces a reflow, and puts it back. Reduced motion shows no flash at all.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUFFS, type BuffId } from "@raid/shared";
import type { PlayerState, RaidState } from "@raid/shared/schema";
import { settings } from "../src/settings";
import { BuffsHud, POP_MS } from "../src/ui/buffsHud";
import { FakeEl, fakeEvent, installFakeDom } from "./fakes";

const css = readFileSync(new URL("../src/ui/buffsHud.css", import.meta.url), "utf8");

const me = (buffs: Partial<Record<BuffId, number>>): PlayerState =>
  ({ status: "alive", kills: 0, mobKills: 0, buffs }) as unknown as PlayerState;
const run = (): RaidState =>
  ({ phase: "active", mobs: new Map([["m", { kind: "mob" }]]), players: new Map() }) as unknown as RaidState;

function setup(reducedMotion: () => boolean = () => false) {
  const dom = installFakeDom();
  const hud = new BuffsHud({ reducedMotion });
  const [strip] = (hud.root as unknown as FakeEl).children as FakeEl[];
  const chipOf = (id: BuffId): FakeEl => (strip!.children as FakeEl[])[BUFFS.findIndex((b) => b.id === id)]!;
  const emberImp = chipOf("emberImp");
  const bailiff = chipOf("bailiff");
  /** The held stacks of Ember Imp (and Bailiff), as the server would sync them. */
  const give = (ember: number, bail = 0): void => { hud.update(run(), me({ emberImp: ember, ...(bail > 0 ? { bailiff: bail } : {}) })); };
  const ended = (chip: FakeEl, animationName = "buff-pop"): void => { chip.dispatchEvent(fakeEvent("animationend", { animationName })); };
  return { dom, hud, emberImp, bailiff, give, ended };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  settings.update({ reducedMotion: false });
});

describe("the flash replays on every rise", () => {
  it("lasts as long as the animation says", () => {
    expect(css).toMatch(new RegExp(`\\.buff-chip\\.pop\\s*\\{\\s*animation:\\s*buff-pop\\s+${POP_MS}ms`));
  });

  it("two grants in a row each put the class back after the first animationend took it off", () => {
    const { emberImp, give, ended } = setup();
    give(1.1);
    expect(emberImp.classes.has("pop")).toBe(true);
    ended(emberImp);
    expect(emberImp.classes.has("pop")).toBe(false);
    give(2.2);
    expect(emberImp.classes.has("pop")).toBe(true);
    ended(emberImp);
    expect(emberImp.classes.has("pop")).toBe(false);
    give(3.3);
    expect(emberImp.classes.has("pop")).toBe(true);
  });

  it("a rise while the class is still on takes it off, reflows, and puts it back (the animation starts over)", () => {
    const { emberImp, give } = setup();
    const atReflow: boolean[] = [];
    Object.defineProperty(emberImp, "offsetWidth", { get: () => { atReflow.push(emberImp.classes.has("pop")); return 0; } });
    give(1.1);
    expect(atReflow).toEqual([]); // nothing to restart the first time
    give(2.2);
    expect(atReflow).toEqual([false]); // read while the class was off: that is what restarts the animation
    expect(emberImp.classes.has("pop")).toBe(true);
  });

  it("takes the class off by itself when animationend never comes, and the next rise puts it back", () => {
    const { emberImp, give } = setup();
    give(1.1);
    vi.advanceTimersByTime(POP_MS - 1);
    expect(emberImp.classes.has("pop")).toBe(true);
    vi.advanceTimersByTime(200);
    expect(emberImp.classes.has("pop")).toBe(false);
    give(2.2);
    expect(emberImp.classes.has("pop")).toBe(true);
  });

  it("a timer left by an earlier flash does not cut the next one short", () => {
    const { emberImp, give, ended } = setup();
    give(1.1); // t = 0: its timer would fire at 700
    vi.advanceTimersByTime(100);
    ended(emberImp);
    give(2.2); // t = 100: its own timer fires at 800
    vi.advanceTimersByTime(650); // t = 750
    expect(emberImp.classes.has("pop")).toBe(true);
    vi.advanceTimersByTime(100); // t = 850
    expect(emberImp.classes.has("pop")).toBe(false);
  });

  it("a rise inside a flash starts the wait again", () => {
    const { emberImp, give } = setup();
    give(1.1); // t = 0
    vi.advanceTimersByTime(300);
    give(2.2); // t = 300: the flash starts over
    vi.advanceTimersByTime(450); // t = 750, past the first timer's 700
    expect(emberImp.classes.has("pop")).toBe(true);
    vi.advanceTimersByTime(300); // t = 1050
    expect(emberImp.classes.has("pop")).toBe(false);
  });

  it("flashes only the chip that rose, and a fall flashes nothing", () => {
    const { emberImp, bailiff, give, ended } = setup();
    give(1.1, 1.1);
    expect(emberImp.classes.has("pop")).toBe(true);
    expect(bailiff.classes.has("pop")).toBe(true);
    ended(emberImp);
    ended(bailiff);
    give(2.2, 1.1);
    expect(emberImp.classes.has("pop")).toBe(true);
    expect(bailiff.classes.has("pop")).toBe(false);
    ended(emberImp);
    give(1.5, 1.1); // a bounty took half
    expect(emberImp.classes.has("pop")).toBe(false);
  });

  it("an animationend of some other animation leaves the flash on", () => {
    const { emberImp, give, ended } = setup();
    give(1.1);
    ended(emberImp, "something-else");
    expect(emberImp.classes.has("pop")).toBe(true);
    ended(emberImp);
    expect(emberImp.classes.has("pop")).toBe(false);
  });

  it("a chip that goes away drops its flash, and nothing is left waiting after destroy", () => {
    const { hud, emberImp, give } = setup();
    give(1.1, 1.1);
    expect(vi.getTimerCount()).toBe(2);
    give(0, 1.1); // Ember Imp fell to nothing
    expect(emberImp.hidden).toBe(true);
    expect(emberImp.classes.has("pop")).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    hud.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("reduced motion", () => {
  it("never sets the class, however many times the stacks rise, and keeps no timer", () => {
    const { emberImp, bailiff, give } = setup(() => true);
    give(1.1, 1.1);
    give(2.2, 2.2);
    give(3.3, 3.3);
    expect(emberImp.classes.has("pop")).toBe(false);
    expect(bailiff.classes.has("pop")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("takes a flash that was on off at the next rise once motion is reduced, at once", () => {
    let reduced = false;
    const { emberImp, give } = setup(() => reduced);
    give(1.1);
    expect(emberImp.classes.has("pop")).toBe(true);
    reduced = true;
    give(2.2);
    expect(emberImp.classes.has("pop")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is read from the settings switch and from the system's preference by default", () => {
    const first = setup();
    const hud = new BuffsHud();
    const chip = ((hud.root as unknown as FakeEl).children[0] as FakeEl).children[BUFFS.findIndex((b) => b.id === "emberImp")] as FakeEl;
    hud.update(run(), me({ emberImp: 1.1 }));
    expect(chip.classes.has("pop")).toBe(true); // motion allowed
    first.ended(chip);

    settings.update({ reducedMotion: true });
    hud.update(run(), me({ emberImp: 2.2 }));
    expect(chip.classes.has("pop")).toBe(false);

    settings.update({ reducedMotion: false });
    hud.update(run(), me({ emberImp: 3.3 }));
    expect(chip.classes.has("pop")).toBe(true);
    first.ended(chip);

    (first.dom.win as unknown as { matchMedia: (q: string) => { matches: boolean } }).matchMedia = () => ({ matches: true });
    hud.update(run(), me({ emberImp: 4.4 }));
    expect(chip.classes.has("pop")).toBe(false);
  });
});
