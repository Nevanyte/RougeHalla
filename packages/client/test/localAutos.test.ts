import { describe, expect, it } from "vitest";
import { LocalAutos, type AutoInput, type AutoVisual } from "../src/net/localAutos";

function setup() {
  const autos = new LocalAutos();
  const visuals: AutoVisual[] = [];
  const emit = (visual: AutoVisual): void => { visuals.push(visual); };
  const input = (over: Partial<AutoInput> = {}): AutoInput => ({
    key: "0:sword", weapon: "sword", a: 0.25, held: true, enabled: true,
    intervalMs: 600, windupMs: 0, readyInMs: 0, ...over,
  });
  return { autos, visuals, emit, input };
}

describe("LocalAutos timeline", () => {
  it("drives the local bow pull from press to release and suppresses the delayed server draw afterward", () => {
    const { autos, visuals, emit, input } = setup();
    const bow = input({ key: "0:bow", weapon: "bow", windupMs: 400, intervalMs: 800 });
    expect(autos.bowPull(0)).toBeUndefined();
    autos.press(bow, 100, emit);
    expect(autos.bowPull(100)).toBe(0);
    expect(autos.bowPull(300)).toBe(0.5);
    autos.frame({ ...bow, held: false }, 500, emit);
    expect(visuals.at(-1)?.kind).toBe("launch");
    expect(autos.bowPull(501)).toBe(-1);
    expect(autos.bowPull(3000)).toBeUndefined();
  });
  it("shows a melee click on the press call and continues on cadence without waiting for network confirmation", () => {
    const { autos, visuals, emit, input } = setup();
    autos.press(input({ held: true }), 100, emit);
    expect(visuals).toEqual([{ kind: "swing", id: "local-auto-1", weapon: "sword", a: 0.25, ms: 0, targetId: undefined }]);
    autos.frame(input({ a: 0.5 }), 699, emit);
    expect(visuals).toHaveLength(1);
    autos.frame(input({ a: 0.5 }), 700, emit);
    expect(visuals.at(-1)).toMatchObject({ kind: "swing", id: "local-auto-2", a: 0.5 });
  });

  it("does not catch up missed attacks in a frame stall", () => {
    const { autos, visuals, emit, input } = setup();
    autos.press(input(), 0, emit);
    autos.frame(input(), 5_000, emit);
    expect(visuals).toHaveLength(2);
    expect(visuals[1]!.id).toBe("local-auto-2");
    autos.frame(input(), 5_001, emit);
    expect(visuals).toHaveLength(2);
  });

  it("respects the weapon cooldown from the click and starts once it is ready", () => {
    const { autos, visuals, emit, input } = setup();
    autos.press(input({ readyInMs: 350 }), 100, emit);
    expect(visuals).toEqual([]);
    autos.frame(input({ readyInMs: 0 }), 449, emit);
    expect(visuals).toEqual([]);
    autos.frame(input({ readyInMs: 0 }), 450, emit);
    expect(visuals).toHaveLength(1);
    expect(visuals[0]).toMatchObject({ kind: "swing", id: "local-auto-1" });
  });

  it("finishes a ranged draw after button-up and uses the bow aim current at release", () => {
    const { autos, visuals, emit, input } = setup();
    autos.press(input({ key: "0:bow", weapon: "bow", a: 0.1, windupMs: 300, intervalMs: 800 }), 1_000, emit);
    expect(visuals[0]).toMatchObject({ kind: "windup", weapon: "bow", a: 0.1, ms: 300 });
    autos.frame(input({ key: "0:bow", weapon: "bow", held: false, a: 0.8, windupMs: 300, intervalMs: 800 }), 1_100, emit);
    expect(visuals).toHaveLength(1);
    autos.frame(input({ key: "0:bow", weapon: "bow", held: false, a: 1.2, windupMs: 300, intervalMs: 800 }), 1_300, emit);
    expect(visuals.at(-1)).toMatchObject({ kind: "launch", weapon: "bow", a: 1.2, ms: 300 });
  });

  it.each([
    ["explicit cancel", (autos: LocalAutos, input: AutoInput, emit: (v: AutoVisual) => void) => autos.cancel()],
    ["stun/disabled state", (autos: LocalAutos, input: AutoInput, emit: (v: AutoVisual) => void) => autos.frame({ ...input, enabled: false }, 100, emit)],
    ["weapon change", (autos: LocalAutos, input: AutoInput, emit: (v: AutoVisual) => void) => autos.frame({ ...input, key: "1:axe", weapon: "axe" }, 100, emit)],
  ] as const)("prevents a pending launch after %s", (_name, stop) => {
    const { autos, visuals, emit, input } = setup();
    const bow = input({ key: "0:bow", weapon: "bow", windupMs: 300 });
    autos.press(bow, 0, emit);
    stop(autos, bow, emit);
    autos.frame({ ...bow, held: false }, 400, emit);
    expect(visuals.filter((v) => v.kind === "launch")).toEqual([]);
  });

  it("matches a late authoritative confirmation at most once", () => {
    const { autos, emit, input } = setup();
    autos.press(input({ weapon: "bow", key: "0:bow", windupMs: 250 }), 100, emit);
    const first = autos.consume("windup", "bow", 2_000);
    expect(first).toBe("local-auto-1");
    expect(autos.consume("windup", "bow", 2_001)).toBeUndefined();
    expect(autos.consume("launch", "bow", 2_002)).toBe("local-auto-1");
    expect(autos.consume("launch", "bow", 2_003)).toBeUndefined();
  });

  it("does not match a later authoritative launch to a canceled draw", () => {
    const { autos, emit, input } = setup();
    autos.press(input({ weapon: "bow", key: "0:bow", windupMs: 300 }), 0, emit);
    autos.cancel();
    expect(autos.consume("windup", "bow", 400)).toBe("local-auto-1");
    expect(autos.consume("launch", "bow", 401)).toBeUndefined();
  });

  it("cancels a locked wand draw when its target is lost before release", () => {
    const { autos, visuals, emit, input } = setup();
    const locked = input({ key: "0:wand", weapon: "wand", targetId: "foe", windupMs: 500, intervalMs: 900 });
    autos.press(locked, 100, emit);
    autos.frame({ ...locked, held: false, targetId: undefined }, 600, emit);
    expect(visuals.map((v) => v.kind)).toEqual(["windup"]);
    expect(autos.consume("launch", "wand", 601)).toBeUndefined();
  });
});
