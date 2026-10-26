// BuffsHud (roguelike R4a): the build strip (one chip per buff held) and the feed line, run over a fake DOM (test/fakes.ts) and
// plain-object states. The wording itself is shared/buffView.ts and ui/buffTip.ts (tested there and below); this pins when the
// parts show and what they carry.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUFFS, FACTIONS, buffView, buffText, feedView, formatGain, type BuffId } from "@raid/shared";
import type { PlayerState, RaidState } from "@raid/shared/schema";
import { buffColor } from "../src/ui/buffTheme";
import { BuffsHud, COMING_MARK, DENSE_AFTER, EMPTY_HINT } from "../src/ui/buffsHud";
import { COMING_NOTE } from "../src/ui/buffTip";
import { cssColor } from "../src/ui/dom";
import { zoneClipPath } from "../src/ui/mapPainter";
import { FakeEl, installFakeDom } from "./fakes";

type Held = Partial<Record<BuffId, number>>;
interface Me { status: string; kills: number; mobKills: number; buffs: Held | Map<string, number> | undefined }

const me = (over: Partial<Me> = {}): PlayerState =>
  ({ status: "alive", kills: 0, mobKills: 0, buffs: {}, ...over }) as unknown as PlayerState;

function state(over: { phase?: string; mobs?: Array<{ kind: string }>; players?: Array<Partial<Me>> } = {}): RaidState {
  const mobs = new Map((over.mobs ?? []).map((m, i) => [`m${i}`, m]));
  const players = new Map((over.players ?? []).map((p, i) => [`p${i}`, me(p)]));
  return { phase: over.phase ?? "active", mobs, players } as unknown as RaidState;
}

/** A run with regional mobs in it: the next-kill gain and the feed line mean something there. */
const run = (over: Parameters<typeof state>[0] = {}): RaidState => state({ mobs: [{ kind: "mob" }], ...over });

/** The chip parts, in the order BuffsHud builds them. */
function chipOf(root: FakeEl) {
  const [glyph, name, stacks, gain, value, coming, tip] = root.children as FakeEl[];
  return { root, glyph: glyph!, name: name!, stacks: stacks!, gain: gain!, value: value!, coming: coming!, tip: tip! };
}

function parts(hud: BuffsHud) {
  // The strip, the passives row (ui/passivesRow.ts, tested in passivesRow.test.ts), the empty hint and the feed line.
  const [strip, , empty, feed] = (hud.root as unknown as FakeEl).children as FakeEl[];
  const chips = (strip!.children as FakeEl[]).map(chipOf);
  const byId = (id: BuffId) => chips[BUFFS.findIndex((b) => b.id === id)]!;
  const visible = () => BUFFS.filter((_, i) => !chips[i]!.root.hidden).map((b) => b.id);
  return { root: hud.root as unknown as FakeEl, strip: strip!, empty: empty!, feed: feed!, chips, byId, visible };
}

beforeEach(() => { installFakeDom(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("BuffsHud chips", () => {
  it("starts with every part hidden: one chip per catalog buff, in catalog order, none shown", () => {
    const { root, strip, empty, feed, chips, visible } = parts(new BuffsHud());
    expect(root.hidden).toBe(true);
    expect([strip.hidden, empty.hidden, feed.hidden]).toEqual([true, true, true]);
    expect(chips).toHaveLength(20);
    expect(chips.map((c) => c.name.textContent)).toEqual(BUFFS.map((b) => b.name));
    expect(visible()).toEqual([]);
    expect(empty.textContent).toBe(EMPTY_HINT);
  });

  it("shows one chip per buff held, and hides the strip while dead, down or holding none", () => {
    const hud = new BuffsHud();
    const { root, strip, visible } = parts(hud);
    hud.update(run(), me());
    expect(strip.hidden).toBe(true);
    hud.update(run(), me({ buffs: { acolyte: 1.1, emberImp: 2.2 } }));
    expect(strip.hidden).toBe(false);
    expect(root.hidden).toBe(false);
    expect(visible()).toEqual(["emberImp", "acolyte"]); // catalog order, whatever order they were gained in
    hud.update(run(), me({ buffs: { acolyte: 1.1, emberImp: 2.2 }, status: "dead" }));
    expect(strip.hidden).toBe(true);
    hud.update(run(), me({ buffs: { acolyte: 1.1, emberImp: 2.2 } }));
    expect(strip.hidden).toBe(false);
    expect(visible()).toEqual(["emberImp", "acolyte"]);
    hud.update(run(), undefined);
    expect(strip.hidden).toBe(true);
  });

  it("follows the buffs held: a new type shows its chip, a type that fell to nothing hides it", () => {
    const hud = new BuffsHud();
    const { visible } = parts(hud);
    hud.update(run(), me({ buffs: { emberImp: 1.1 } }));
    expect(visible()).toEqual(["emberImp"]);
    hud.update(run(), me({ buffs: { emberImp: 1.1, bailiff: 1.1 } }));
    expect(visible()).toEqual(["emberImp", "bailiff"]);
    hud.update(run(), me({ buffs: { bailiff: 1.1, emberImp: 0 } }));
    expect(visible()).toEqual(["bailiff"]);
  });

  it("writes the stacks to one decimal and what they give now (the shared wording)", () => {
    const hud = new BuffsHud();
    const { byId } = parts(hud);
    hud.update(run(), me({ buffs: { emberImp: 3, magmaBrute: 1.1 } }));
    expect(byId("emberImp").stacks.textContent).toBe("3.0");
    expect(byId("emberImp").value.textContent).toBe(buffText("emberImp", 3));
    expect(byId("emberImp").value.textContent).toBe("+10% damage");
    expect(byId("magmaBrute").stacks.textContent).toBe("1.1");
    expect(byId("magmaBrute").value.textContent).toBe(buffText("magmaBrute", 1.1));
  });

  it("rounds the stacks to the nearest tenth, as the toast does, and the value to the stacks held", () => {
    const hud = new BuffsHud();
    const { byId } = parts(hud);
    hud.update(run(), me({ buffs: { emberImp: 2.97 } }));
    expect(byId("emberImp").stacks.textContent).toBe("3.0");
    expect(byId("emberImp").value.textContent).toBe(buffText("emberImp", 2.97)); // a hair under the quoted +10%, not the quoted line
  });

  it("an elite's chip carries the elite class; a normal one does not", () => {
    const { byId } = parts(new BuffsHud());
    expect(byId("bloodSaint").root.className).toContain("elite");
    expect(byId("wyrmling").root.className).toContain("elite");
    expect(byId("emberImp").root.className).not.toContain("elite");
  });

  it("is shown by a plain record, a Map (the schema's collection) and nothing at all (a server before the buffs map)", () => {
    const hud = new BuffsHud();
    const { visible } = parts(hud);
    hud.update(run(), me({ buffs: new Map([["plagueRat", 2], ["fromANewerServer", 5]]) }));
    expect(visible()).toEqual(["plagueRat"]);
    expect(() => hud.update(run(), me({ buffs: undefined }))).not.toThrow();
    expect(visible()).toEqual(["plagueRat"]);
    expect(parts(hud).strip.hidden).toBe(true);
  });
});

describe("BuffsHud identity: zone colour and shape, never hue alone", () => {
  it("each chip carries its zone's colour and its zone's marker shape", () => {
    const { chips } = parts(new BuffsHud());
    BUFFS.forEach((def, i) => {
      const props = chips[i]!.root.style.props;
      expect(props["--c"], def.id).toBe(cssColor(FACTIONS[def.zone].color));
      expect(props["--c"], def.id).toBe(cssColor(buffColor(def.id)));
      expect(props["--zone-clip"], def.id).toBe(zoneClipPath(def.zone));
    });
  });

  it("the five zones have five different shapes, and the four buffs of one zone share theirs", () => {
    const { chips } = parts(new BuffsHud());
    const shapeOf = (i: number) => chips[i]!.root.style.props["--zone-clip"]!;
    const perZone = new Map<string, Set<string>>();
    BUFFS.forEach((def, i) => perZone.set(def.zone, (perZone.get(def.zone) ?? new Set()).add(shapeOf(i))));
    expect([...perZone.values()].every((set) => set.size === 1)).toBe(true);
    const shapes = new Set([...perZone.values()].map((set) => [...set][0]));
    expect(shapes.size).toBe(5);
    // And five different colours, so the pair (shape, colour) is redundant: either one tells the zone.
    expect(new Set(BUFFS.map((b) => buffColor(b.id))).size).toBe(5);
  });
});

describe("BuffsHud next-kill gain", () => {
  it("shows what one more kill of the type adds at the reward the player is paid now", () => {
    const hud = new BuffsHud();
    const { byId } = parts(hud);
    const mine = me({ kills: 2, mobKills: 2, buffs: { emberImp: 3.2, bloodSaint: 1 } });
    const players = [{ kills: 2, mobKills: 2 }, { kills: 0, mobKills: 0 }, { kills: 1, mobKills: 0 }];
    hud.update(run({ players }), mine);
    const reward = feedView(2, 2, 1).reward;
    expect(byId("emberImp").gain.textContent).toBe(`+${formatGain(buffView("emberImp", 3.2, reward)!.nextGain)}`);
    // An elite type's own grant (ELITE_BUFF_STACKS), not the normal one.
    expect(byId("bloodSaint").gain.textContent).toBe(`+${formatGain(buffView("bloodSaint", 1, reward)!.nextGain)}`);
    expect(Number(byId("bloodSaint").gain.textContent!.slice(1))).toBeGreaterThan(Number(byId("emberImp").gain.textContent!.slice(1)));
  });

  it("follows the feed: a hungry player's catch-up shows a bigger gain than a well-fed one's", () => {
    const hud = new BuffsHud();
    const { byId } = parts(hud);
    const gain = () => Number(byId("emberImp").gain.textContent!.slice(1));
    hud.update(run({ players: [{ kills: 0 }, { kills: 3 }, { kills: 4 }] }), me({ kills: 0, buffs: { emberImp: 1 } }));
    const hungry = gain();
    hud.update(run({ players: [{ kills: 9 }, { kills: 9 }, { kills: 9 }] }), me({ kills: 9, mobKills: 20, buffs: { emberImp: 1 } }));
    expect(gain()).toBeLessThan(hungry);
  });

  it("is left out where no regional mob exists (training: dummies pay nothing)", () => {
    const hud = new BuffsHud();
    const { byId, feed } = parts(hud);
    hud.update(state({ players: [{}], mobs: [{ kind: "dummy" }] }), me({ buffs: { emberImp: 1.1 } }));
    expect(byId("emberImp").gain.textContent).toBe("");
    expect(byId("emberImp").value.textContent).not.toBe("");
    expect(feed.hidden).toBe(true);
    // The moment a mob appears the gain is there.
    hud.update(run({ players: [{}] }), me({ buffs: { emberImp: 1.1 } }));
    expect(byId("emberImp").gain.textContent).toMatch(/^\+\d\.\d$/);
  });
});

describe("BuffsHud tooltip", () => {
  it("carries the full wording: the stacks, the buff now and quoted, the next kill, and the matchup tags", () => {
    const hud = new BuffsHud();
    const { byId } = parts(hud);
    hud.update(run({ players: [{}] }), me({ buffs: { cinderHound: 3.2 } }));
    const tip = byId("cinderHound").tip.textContent;
    const view = buffView("cinderHound", 3.2, feedView(0, 0, 0).reward)!;
    expect(tip).toContain("Cinder Hound (Fire zone)");
    expect(tip).toContain(`3.2 stacks: ${buffText("cinderHound", 3.2)}`);
    expect(tip).toContain(`At 3 stacks: ${view.quoted}`);
    expect(tip).toContain(`Next kill: +${formatGain(view.nextGain)} stacks (${view.nextText})`);
    // worksWith ["melee"], counters ["kiters", "bow", "wand"]
    expect(tip).toContain("Works with: melee fighters");
    expect(tip).toContain("Strong against: kiters, bow users, wand users");
    expect(tip).not.toContain(COMING_NOTE);
  });

  it("names a faction-locked buff's faction, and says Holy by its player-facing name where it is a tag", () => {
    const hud = new BuffsHud();
    const { byId } = parts(hud);
    hud.update(run(), me({ buffs: { bailiff: 1.1, executioner: 1.1 } }));
    expect(byId("bailiff").tip.textContent).toContain("Works with: Sentenced");
    expect(byId("bailiff").tip.textContent).not.toContain("Strong against"); // no counters listed
    // Executioner counters ["healers", "holy"]: Holy is shown as Demon Blood.
    expect(byId("executioner").tip.textContent).toContain("Strong against: healers, Demon Blood");
    expect(byId("executioner").tip.textContent).toContain("(elite, Sentenced zone)");
  });

  it("leaves the next-kill line out where no mob can be killed", () => {
    const hud = new BuffsHud();
    const { byId } = parts(hud);
    hud.update(state({ players: [{}] }), me({ buffs: { emberImp: 1.1 } }));
    expect(byId("emberImp").tip.textContent).not.toContain("Next kill");
  });

  it("is rewritten when the stacks change", () => {
    const hud = new BuffsHud();
    const { byId } = parts(hud);
    hud.update(run(), me({ buffs: { emberImp: 1.1 } }));
    const before = byId("emberImp").tip.textContent;
    hud.update(run(), me({ buffs: { emberImp: 2.2 } }));
    expect(byId("emberImp").tip.textContent).not.toBe(before);
    expect(byId("emberImp").tip.textContent).toContain("2.2 stacks");
  });
});

describe("BuffsHud rows that wait for the status system", () => {
  it("marks them (coming), dashes the chip and says so in the tooltip; the others carry none of it", () => {
    const hud = new BuffsHud();
    const { byId } = parts(hud);
    hud.update(run(), me({ buffs: { chainWarden: 2, emberImp: 2 } }));
    const waiting = byId("chainWarden");
    expect(waiting.coming.textContent).toBe(COMING_MARK);
    expect(waiting.coming.hidden).toBe(false);
    expect(waiting.root.classes.has("pending")).toBe(true);
    expect(waiting.tip.textContent).toContain(COMING_NOTE);
    // It still shows what it will give.
    expect(waiting.value.textContent).toBe(buffText("chainWarden", 2));
    const live = byId("emberImp");
    expect(live.coming.hidden).toBe(true);
    expect(live.root.classes.has("pending")).toBe(false);
    expect(live.tip.textContent).not.toContain(COMING_NOTE);
  });

  it("marks exactly the buffs the catalog flags with needs: status", () => {
    const hud = new BuffsHud();
    const { chips } = parts(hud);
    hud.update(run(), me({ buffs: Object.fromEntries(BUFFS.map((b) => [b.id, 2])) as Held }));
    BUFFS.forEach((def, i) => expect(chips[i]!.coming.hidden, def.id).toBe(def.needs !== "status"));
    expect(BUFFS.filter((b) => b.needs === "status").map((b) => b.id)).toEqual(
      ["chainWarden", "inquisitor", "bloatfly", "rotMonk", "frostWisp", "glacialWarden"],
    );
  });
});

describe("BuffsHud many buffs", () => {
  it("goes to one line per chip past DENSE_AFTER buffs, and back", () => {
    const hud = new BuffsHud();
    const { strip } = parts(hud);
    const held = (n: number): Held => Object.fromEntries(BUFFS.slice(0, n).map((b) => [b.id, 1.1])) as Held;
    hud.update(run(), me({ buffs: held(DENSE_AFTER) }));
    expect(strip.classes.has("dense")).toBe(false);
    hud.update(run(), me({ buffs: held(DENSE_AFTER + 1) }));
    expect(strip.classes.has("dense")).toBe(true);
    hud.update(run(), me({ buffs: held(2) }));
    expect(strip.classes.has("dense")).toBe(false);
  });

  it("lays out all twenty without trouble", () => {
    const hud = new BuffsHud();
    const { visible, strip } = parts(hud);
    hud.update(run(), me({ buffs: Object.fromEntries(BUFFS.map((b) => [b.id, 4.4])) as Held }));
    expect(visible()).toHaveLength(20);
    expect(strip.classes.has("dense")).toBe(true);
  });
});

describe("BuffsHud repaints", () => {
  it("only when something it shows changed", () => {
    const hud = new BuffsHud();
    const { byId } = parts(hud);
    hud.update(run(), me({ buffs: { emberImp: 1.1 } }));
    const stacks = byId("emberImp").stacks;
    stacks.textContent = "poked";
    hud.update(run(), me({ buffs: { emberImp: 1.1 } })); // the same stacks and reward: nothing repainted
    expect(stacks.textContent).toBe("poked");
    hud.update(run(), me({ buffs: { emberImp: 2.2 } }));
    expect(stacks.textContent).toBe("2.2");
  });

  it("repaints every chip when the reward moves (the gain is quoted at it), and leaves a quiet one alone otherwise", () => {
    const hud = new BuffsHud();
    const { byId } = parts(hud);
    const buffs = { emberImp: 1.1, bailiff: 1.1 };
    hud.update(run({ players: [{ kills: 0 }] }), me({ kills: 0, buffs }));
    const before = byId("bailiff").gain.textContent;
    byId("bailiff").gain.textContent = "poked";
    hud.update(run({ players: [{ kills: 0 }] }), me({ kills: 0, buffs }));
    expect(byId("bailiff").gain.textContent).toBe("poked");
    // A rival gets much further ahead: the median moves, the catch-up bonus starts, the reward changes.
    hud.update(run({ players: [{ kills: 0 }, { kills: 6 }, { kills: 6 }] }), me({ kills: 0, buffs }));
    expect(byId("bailiff").gain.textContent).not.toBe("poked");
    expect(byId("bailiff").gain.textContent).not.toBe(before);
  });

  it("flashes a chip when its stacks rise, and only that chip", () => {
    const hud = new BuffsHud();
    const { chips, byId } = parts(hud);
    hud.update(run(), me({ buffs: { emberImp: 1.1, bailiff: 1.1 } }));
    expect(byId("emberImp").root.classes.has("pop")).toBe(true); // a buff just gained shows itself
    chips.forEach((c) => c.root.classes.delete("pop"));
    hud.update(run(), me({ buffs: { emberImp: 2.2, bailiff: 1.1 } }));
    expect(byId("emberImp").root.classes.has("pop")).toBe(true);
    expect(byId("bailiff").root.classes.has("pop")).toBe(false);
    chips.forEach((c) => c.root.classes.delete("pop"));
    hud.update(run(), me({ buffs: { emberImp: 1.5, bailiff: 1.1 } })); // a fall (a bounty took half) does not flash
    expect(byId("emberImp").root.classes.has("pop")).toBe(false);
  });
});

describe("BuffsHud empty hint", () => {
  it("shows while a living player in a run with mobs holds no buff yet, and goes when one is held", () => {
    const hud = new BuffsHud();
    const { empty, strip, root } = parts(hud);
    hud.update(run(), me());
    expect(empty.hidden).toBe(false);
    expect(strip.hidden).toBe(true);
    expect(root.hidden).toBe(false);
    hud.update(run(), me({ buffs: { emberImp: 1.1 } }));
    expect(empty.hidden).toBe(true);
    expect(strip.hidden).toBe(false);
  });

  it("stays away outside a run with mobs: the lobby, training, the end, the dead", () => {
    const hud = new BuffsHud();
    const { empty, root } = parts(hud);
    hud.update(state({ players: [{}], mobs: [{ kind: "dummy" }] }), me());
    expect(empty.hidden).toBe(true);
    hud.update(run({ phase: "lobby" }), me());
    expect(empty.hidden).toBe(true);
    hud.update(run({ phase: "ended" }), me());
    expect(empty.hidden).toBe(true);
    hud.update(run(), me({ status: "dead" }));
    expect(empty.hidden).toBe(true);
    expect(root.hidden).toBe(true);
    hud.update(run(), undefined);
    expect(empty.hidden).toBe(true);
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

  it("shows under the chips: the strip and the feed are both in the root", () => {
    const hud = new BuffsHud();
    const { root, strip, feed } = parts(hud);
    hud.update(run({ players: [{}] }), me({ buffs: { emberImp: 1.1 } }));
    expect(root.children[0]).toBe(strip);
    expect(root.children[3]).toBe(feed);
    expect([strip.hidden, feed.hidden]).toEqual([false, false]);
  });
});

describe("BuffsHud destroy", () => {
  it("takes its root out of the page", () => {
    const hud = new BuffsHud();
    hud.destroy();
    expect((hud.root as unknown as FakeEl).removed).toBe(true);
  });
});
