// BuffsHud (Phase 11): the three buff rows and the feed line, run over a fake DOM (test/fakes.ts) and plain-object states.
// The wording itself is shared/buffView.ts (tested there); this pins when the parts show and what they carry.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerState, RaidState } from "@raid/shared/schema";
import { BuffsHud } from "../src/ui/buffsHud";
import { FakeEl, installFakeDom } from "./fakes";

interface Me { status: string; kills: number; mobKills: number; stacksHp: number; stacksAs: number; stacksMs: number }

const me = (over: Partial<Me> = {}): PlayerState =>
  ({ status: "alive", kills: 0, mobKills: 0, stacksHp: 0, stacksAs: 0, stacksMs: 0, ...over }) as unknown as PlayerState;

function state(over: { phase?: string; mobs?: Array<{ kind: string }>; players?: Array<Partial<Me>> } = {}): RaidState {
  const mobs = new Map((over.mobs ?? []).map((m, i) => [`m${i}`, m]));
  const players = new Map((over.players ?? []).map((p, i) => [`p${i}`, me(p)]));
  return { phase: over.phase ?? "active", mobs, players } as unknown as RaidState;
}

/** The view parts, in the order BuffsHud builds them. */
function parts(hud: BuffsHud) {
  const kids = (hud.root as unknown as FakeEl).children as FakeEl[];
  const rows = kids.slice(0, 3).map((root) => {
    const [line, combo] = root.children as FakeEl[];
    const [name, stacks, next, bonus, bar] = line!.children as FakeEl[];
    const [comboName, , comboText] = combo!.children as FakeEl[];
    return { root, combo: combo!, name: name!, stacks: stacks!, next: next!, bonus: bonus!, fill: (bar!.children[0] as FakeEl), comboName: comboName!, comboText: comboText! };
  });
  return { rows, feed: kids[3]! };
}

beforeEach(() => { installFakeDom(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("BuffsHud rows", () => {
  it("starts with every part hidden", () => {
    const { rows, feed } = parts(new BuffsHud());
    expect(rows.map((r) => r.root.hidden)).toEqual([true, true, true]);
    expect(feed.hidden).toBe(true);
    expect(rows.map((r) => r.name.textContent)).toEqual(["Max HP", "Attack speed", "Move speed"]);
  });

  it("shows the rows once the player holds a stack, and hides them while dead, down or without any", () => {
    const hud = new BuffsHud();
    const { rows } = parts(hud);
    const hidden = () => rows.map((r) => r.root.hidden);
    hud.update(state(), me());
    expect(hidden()).toEqual([true, true, true]);
    hud.update(state(), me({ stacksMs: 1.1 }));
    expect(hidden()).toEqual([false, false, false]);
    hud.update(state(), me({ stacksMs: 1.1, status: "dead" }));
    expect(hidden()).toEqual([true, true, true]);
    hud.update(state(), me({ stacksMs: 1.1 }));
    expect(hidden()).toEqual([false, false, false]);
    hud.update(state(), undefined);
    expect(hidden()).toEqual([true, true, true]);
  });

  it("writes each row's stacks to one decimal, the bonus, the next combo and the bar", () => {
    const hud = new BuffsHud();
    const { rows } = parts(hud);
    hud.update(state(), me({ stacksHp: 1.1, stacksAs: 3, stacksMs: 0 }));
    const [hp, as, ms] = rows;
    expect([hp!.stacks.textContent, hp!.bonus.textContent, hp!.next.textContent, hp!.fill.style.width]).toEqual(["1.1", "+6%", "/3", "37%"]);
    expect([as!.stacks.textContent, as!.bonus.textContent, as!.next.textContent, as!.fill.style.width]).toEqual(["3.0", "+23%", "/5", "60%"]);
    expect([ms!.stacks.textContent, ms!.bonus.textContent]).toEqual(["0.0", "+0%"]);
    expect(ms!.root.classes.has("idle")).toBe(true);
    expect(hp!.root.classes.has("idle")).toBe(false);
  });

  it("shows the combo a stat has reached, and only that row", () => {
    const hud = new BuffsHud();
    const { rows } = parts(hud);
    hud.update(state(), me({ stacksHp: 1.1, stacksAs: 3 }));
    expect(rows.map((r) => r.combo.hidden)).toEqual([true, false, true]);
    expect(rows[1]!.comboName.textContent).toBe("Dash on kill");
    expect(rows[1]!.comboText.textContent).toContain("A kill launches you forward");
    expect(rows[1]!.root.classes.has("combo")).toBe(true);
    // Past the second threshold the row is maxed and shows the second combo.
    hud.update(state(), me({ stacksAs: 5 }));
    expect(rows[1]!.comboName.textContent).toBe("Cascade");
    expect(rows[1]!.root.classes.has("maxed")).toBe(true);
    expect(rows[1]!.next.textContent).toBe("");
  });

  it("never shows 3.0 for stacks short of the combo", () => {
    const hud = new BuffsHud();
    const { rows } = parts(hud);
    hud.update(state(), me({ stacksAs: 2.97 }));
    expect(rows[1]!.stacks.textContent).toBe("2.9");
    expect(rows[1]!.combo.hidden).toBe(true);
  });

  it("follows the stacks when they change, and does not touch a row that did not", () => {
    const hud = new BuffsHud();
    const { rows } = parts(hud);
    hud.update(state(), me({ stacksHp: 1.1 }));
    const hpStacks = rows[0]!.stacks;
    hpStacks.textContent = "poked";
    hud.update(state(), me({ stacksHp: 1.1 })); // same gate: nothing repainted
    expect(hpStacks.textContent).toBe("poked");
    hud.update(state(), me({ stacksHp: 2.2 }));
    expect(hpStacks.textContent).toBe("2.2");
  });
});

describe("BuffsHud feed line", () => {
  it("shows only after a regional mob has been seen, and only for a living player in an active run", () => {
    const hud = new BuffsHud();
    const { feed } = parts(hud);
    const players = [{ kills: 0, mobKills: 0 }];
    hud.update(state({ players, mobs: [{ kind: "dummy" }] }), me());
    expect(feed.hidden).toBe(true); // training dummies pay nothing: no feed line for them
    hud.update(state({ players, mobs: [{ kind: "dummy" }, { kind: "mob" }] }), me());
    expect(feed.hidden).toBe(false);
    // The memory is kept when the last mob is gone.
    hud.update(state({ players, mobs: [] }), me());
    expect(feed.hidden).toBe(false);
    hud.update(state({ players, phase: "lobby" }), me());
    expect(feed.hidden).toBe(true);
    hud.update(state({ players, phase: "ended" }), me());
    expect(feed.hidden).toBe(true);
    hud.update(state({ players }), me({ status: "dead" }));
    expect(feed.hidden).toBe(true);
    hud.update(state({ players }), undefined);
    expect(feed.hidden).toBe(true);
    hud.update(state({ players }), me());
    expect(feed.hidden).toBe(false);
  });

  it("an elite is a regional mob too", () => {
    const hud = new BuffsHud();
    hud.update(state({ players: [{}], mobs: [{ kind: "elite" }] }), me());
    expect(parts(hud).feed.hidden).toBe(false);
  });

  it("says what the player's feed is and what a mob pays, against the median of those still alive", () => {
    const hud = new BuffsHud();
    const { feed } = parts(hud);
    const mine = me({ kills: 2, mobKills: 2 }); // feed 2.5
    // The median is taken over the living (the dead one is not counted): feeds [2.5, 0, 1] -> 1.
    const players = [
      { kills: 2, mobKills: 2 }, { kills: 0, mobKills: 0 }, { kills: 1, mobKills: 0 }, { kills: 9, mobKills: 9, status: "dead" },
    ];
    hud.update(state({ players, mobs: [{ kind: "mob" }] }), mine);
    expect(feed.textContent).toBe("Feed 2.5 (kills + mobs/4) · mobs pay x0.89");
    // A hungry player (feed far under the median) gets the catch-up bonus, and the line says so.
    const hungry = me({ kills: 0, mobKills: 0 });
    hud.update(state({ players: [{ kills: 0, mobKills: 0 }, { kills: 3, mobKills: 0 }, { kills: 4, mobKills: 0 }], mobs: [{ kind: "mob" }] }), hungry);
    expect(feed.textContent).toBe("Feed 0 (kills + mobs/4) · mobs pay x1.22 (catch-up)");
  });

  it("is rewritten only when the line changes", () => {
    const hud = new BuffsHud();
    const { feed } = parts(hud);
    const players = [{ kills: 0, mobKills: 0 }];
    const s = state({ players, mobs: [{ kind: "mob" }] });
    hud.update(s, me());
    feed.textContent = "poked";
    hud.update(s, me());
    expect(feed.textContent).toBe("poked");
    hud.update(s, me({ kills: 1 }));
    expect(feed.textContent).toContain("Feed 1 ");
  });
});

describe("BuffsHud destroy", () => {
  it("takes its root out of the page", () => {
    const hud = new BuffsHud();
    hud.destroy();
    expect((hud.root as unknown as FakeEl).removed).toBe(true);
  });
});
