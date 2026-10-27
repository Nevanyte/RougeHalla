// BuffsHud in a training room: the practice console's camps are regional mobs, but they pay nothing (server mobLife.payMobKill),
// so the feed line ("mobs pay x0.98") and the next-kill gain on a buff chip must not appear there.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerState, RaidState } from "@raid/shared/schema";
import { BuffsHud } from "../src/ui/buffsHud";
import { FakeEl, installFakeDom } from "./fakes";

beforeEach(() => { installFakeDom(); });
afterEach(() => { vi.unstubAllGlobals(); });

const me = (): PlayerState => ({ status: "alive", kills: 0, mobKills: 0, buffs: { emberImp: 3 } }) as unknown as PlayerState;
const room = (over: { training?: boolean; mobs?: Array<{ kind: string }> }): RaidState =>
  ({
    phase: "active", training: over.training, players: new Map([["p0", me()]]),
    mobs: new Map((over.mobs ?? []).map((m, i) => [`m${i}`, m])),
  }) as unknown as RaidState;

const feedOf = (hud: BuffsHud): FakeEl => ((hud.root as unknown as FakeEl).children as FakeEl[]).find((c) => c.className === "hud-feed")!;

describe("BuffsHud in a training room", () => {
  it("shows no feed line for practice mobs, where an arena run with the same mobs shows it", () => {
    const mobs = [{ kind: "mob" }, { kind: "mob" }, { kind: "elite" }];
    const arena = new BuffsHud();
    arena.update(room({ mobs }), me());
    expect(feedOf(arena).hidden).toBe(false);

    const training = new BuffsHud();
    training.update(room({ training: true, mobs }), me());
    expect(feedOf(training).hidden).toBe(true);
    expect(feedOf(training).textContent).toBe("");
  });

  it("an arena state that does not carry the flag (an older server) is an arena", () => {
    const hud = new BuffsHud();
    hud.update(room({ mobs: [{ kind: "mob" }] }), me());
    expect(feedOf(hud).hidden).toBe(false);
  });
});
