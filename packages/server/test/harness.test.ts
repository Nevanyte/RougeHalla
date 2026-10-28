import { describe, expect, it } from "vitest";
import { ALL_WEAPON_IDS, FACTION_IDS, isRanged, POLICIES, WEAPON_BEATS, WEAPON_IDS, type FactionId, type WeaponId } from "@raid/shared";
import { runDuel, type DuelResult } from "../src/harness/duel";
import { KITE_STYLES, kitingReport } from "../src/harness/kiting";
import { edgeName, hasGrid, spacingFor, stylesOf, WEAVES, type Cell, type Edge, type Setup } from "../src/harness/matrix";
import { parityReport } from "../src/harness/parity";
import {
  buildReport, formatVerdicts, HOLD_FACTION, HOLD_OVERALL, HOLD_REPLY, thinNote, verdictOf, verdictWord, type StyleReply,
} from "../src/harness/report";

// The harness is report-only: these tests check that it runs and that its parity block agrees with realtime.py. They
// never look at who wins a duel.

const ONE_SETUP: readonly Setup[] = [{ distance: 300, delayTicks: [0, 0], angle: 0.1 }];

describe("weapon duel harness", () => {
  // One faction, one setup, a short cap: ten short duels.
  const report = buildReport({ quick: true, factions: ["fire"], setups: ONE_SETUP, capSeconds: 12 });

  it("runs every one of the ten designed weapon edges", () => {
    expect(WEAPON_BEATS).toHaveLength(10);
    expect(report.edges).toHaveLength(10);
    for (const edge of WEAPON_BEATS) {
      const cells = report.cells.filter((c) => c.edge[0] === edge[0] && c.edge[1] === edge[1]);
      expect(cells, edgeName(edge)).toHaveLength(1);
      expect(cells[0]!.results.length).toBeGreaterThan(0);
      for (const r of cells[0]!.results) {
        expect(["kill", "draw", "cap"]).toContain(r.end);
        expect(r.seconds).toBeGreaterThan(0);
        expect(r.seconds).toBeLessThanOrEqual(12 + 0.1);
      }
      expect(report.text, edgeName(edge)).toContain(edgeName(edge));
    }
  });

  it("prints the matrix, the watch list and the parity block", () => {
    expect(report.text).toContain("MATRIX");
    expect(report.text).toContain("WATCH LIST");
    expect(report.text).toContain("TARGET LOCK");
    expect(report.text).toContain("Parity with testing/realtime.py");
    // The two watched edges are flagged in the matrix.
    const flagged = report.text.split("\n").filter((l) => l.includes("<- watch"));
    expect(flagged.map((l) => l.split(/\s{2,}/)[0])).toEqual(["sword > wand", "wand > bow", "axe > wand"].sort((a, b) => order(a) - order(b)));
  });

  it("matches the realtime.py interval, per-hit and backlash numbers to 1e-9", () => {
    const parity = parityReport();
    expect(parity.rows).toHaveLength(FACTION_IDS.length * ALL_WEAPON_IDS.length); // the five loop weapons and fists
    expect(parity.maxIntervalDiff).toBeLessThan(1e-9);
    expect(parity.maxPerHitDiff).toBeLessThan(1e-9);
    expect(parity.maxBacklashDiff).toBeLessThan(1e-9);
    expect(parity.maxDiff).toBeLessThan(1e-9);
    expect(report.parity.maxDiff).toBeLessThan(1e-9);
  });
});

function order(edge: string): number {
  return WEAPON_BEATS.findIndex((e) => edgeName(e) === edge);
}

describe("duel engine", () => {
  it("repeats exactly for the same spec", () => {
    const spec = { faction: "holy" as FactionId, weapons: ["wand", "bow"] as const, distance: 300, angle: 0.8, capSeconds: 8, seed: 7 };
    const a = runDuel(spec);
    const b = runDuel(spec);
    expect({ ...a, spec: undefined }).toEqual({ ...b, spec: undefined });
  });

  it("drives both clients through the real inputs: each loosing arrows and balls, each swinging", () => {
    const ranged = runDuel({ faction: "fire", weapons: ["bow", "wand"], distance: 300, capSeconds: 8, seed: 3 });
    expect(ranged.counts.shots[0]).toBeGreaterThan(0);
    expect(ranged.counts.shots[1]).toBeGreaterThan(0);
    const melee = runDuel({ faction: "fire", weapons: ["sword", "axe"], distance: 120, capSeconds: 8, seed: 3 });
    expect(melee.counts.attacks[0]).toBeGreaterThan(0);
    expect(melee.counts.attacks[1]).toBeGreaterThan(0);
  });

  it("holds a fighter back for its start offset", () => {
    let firstShot: [number, number] = [-1, -1];
    runDuel({
      faction: "fire", weapons: ["bow", "bow"], distance: 300, delayTicks: [20, 0], capSeconds: 4, seed: 5,
      onTick: (world, tick) => {
        for (const pr of world.projectiles.values()) {
          const i = pr.owner === "f0" ? 0 : 1;
          if (firstShot[i] < 0) firstShot[i] = tick;
        }
      },
    });
    // f1 starts at once and looses at its full draw; f0 does nothing for 20 ticks, then needs its own draw.
    expect(firstShot[1]).toBeGreaterThanOrEqual(0);
    expect(firstShot[0]).toBeGreaterThanOrEqual(20);
  });

  it("starts every faction in both arenas without a fighter inside a wall", () => {
    for (const faction of FACTION_IDS) {
      for (const arena of ["open", "pillars"] as const) {
        const r = runDuel({ faction, weapons: ["sword", "sword"], distance: 450, angle: 0.8, arena, capSeconds: 3, seed: 11 });
        expect(r.seconds).toBeGreaterThan(0);
      }
    }
  });

  it("never lets a duel run past its cap", () => {
    const r = runDuel({ faction: "frost", weapons: ["shield", "shield"], distance: 300, capSeconds: 2, seed: 1 });
    expect(r.end).toBe("cap");
    expect(r.seconds).toBeCloseTo(2, 5);
  });
});

describe("edge verdicts", () => {
  const edge: Edge = ["bow", "sword"];
  /** A cell of `n` duels in which the designed winner (fighter 0) won `wins` of them. */
  const cell = (faction: FactionId, wins: number, n = 10): Cell => ({
    edge, faction,
    results: Array.from({ length: n }, (_, i) => ({ winner: i < wins ? 0 : 1, end: "kill", seconds: 1, hpFrac: [0.5, 0.5], spec: { faction } }) as unknown as DuelResult),
  });
  /** A reply per way the loser plays; every faction column of it equals the pooled rate unless a test says otherwise. */
  const replies = (...rates: number[]): StyleReply[] => rates.map((rate, i) => ({
    loser: (["stand", "strafe", "kite"] as const)[i]!, winner: "stand" as const, rate,
    perFaction: (["fire", "holy", "frost"] as const).map((faction) => ({ faction, rate })),
  }));

  it("holds when the winner wins 60% overall, 50% in every faction and has a 50% reply to every style", () => {
    expect([HOLD_OVERALL, HOLD_FACTION, HOLD_REPLY]).toEqual([0.6, 0.5, 0.5]);
    const cells = [cell("fire", 5), cell("holy", 7), cell("frost", 8)];
    const v = verdictOf(cells, edge, ["fire", "holy", "frost"], replies(0.5, 0.9));
    expect(v).toMatchObject({ overall: 20 / 30, worstFaction: { faction: "fire", rate: 0.5 }, mainHolds: true, gridHolds: true, holds: true });
  });

  it("fails on the matrix when the overall rate or one faction column is below its line", () => {
    const lowOverall = verdictOf([cell("fire", 6), cell("holy", 6), cell("frost", 5)], edge, ["fire", "holy", "frost"], []);
    expect(lowOverall.overall).toBeCloseTo(17 / 30, 12);
    expect(lowOverall).toMatchObject({ mainHolds: false, holds: false });
    const lowFaction = verdictOf([cell("fire", 4), cell("holy", 10), cell("frost", 10)], edge, ["fire", "holy", "frost"], []);
    expect(lowFaction.overall).toBeCloseTo(24 / 30, 12);
    expect(lowFaction).toMatchObject({ worstFaction: { faction: "fire", rate: 0.4 }, mainHolds: false, holds: false });
  });

  it("fails on the styles when the winner has no 50% reply to one way the loser plays", () => {
    const v = verdictOf([cell("fire", 10)], edge, ["fire"], replies(1, 0.9, 0.4));
    expect(v).toMatchObject({ mainHolds: true, gridHolds: false, holds: false });
  });

  it("calls a reply thin in a faction column below the per-faction line even when the pooled reply passes (the thresholds do not move)", () => {
    const reply: StyleReply = {
      loser: "strafe", winner: "stand", rate: 0.87,
      perFaction: [{ faction: "fire", rate: 1 }, { faction: "frost", rate: 0 }, { faction: "holy", rate: 1 }],
    };
    const v = verdictOf([cell("fire", 10), cell("holy", 10), cell("frost", 10)], edge, ["fire", "holy", "frost"], [reply]);
    expect(v).toMatchObject({ mainHolds: true, gridHolds: true, holds: true });
    expect(thinNote([reply])).toBe("Frost 0% vs strafe");
    expect(verdictWord(v)).toBe("HOLDS (thin: Frost 0% vs strafe)");
    expect(formatVerdicts([v], false).join("\n")).toContain("HOLDS (thin: Frost 0% vs strafe)");
  });

  it("lists every thin faction of every reply, and stays quiet when no column is thin", () => {
    const weave: StyleReply = {
      loser: "weave", winner: "stand", rate: 0.51,
      perFaction: [{ faction: "fire", rate: 0 }, { faction: "holy", rate: 0.11 }, { faction: "frost", rate: 0.67 }],
    };
    const strafe: StyleReply = { loser: "strafe", winner: "kite", rate: 0.9, perFaction: [{ faction: "frost", rate: 0.33 }, { faction: "fire", rate: 1 }] };
    expect(thinNote([weave, strafe])).toBe("Fire 0%, Holy 11% vs weave; Frost 33% vs strafe");
    expect(thinNote(replies(1, 0.9, 0.5))).toBe("");
    const quiet = verdictOf([cell("fire", 10)], edge, ["fire"], replies(1, 0.9));
    expect(verdictWord(quiet)).toBe("HOLDS");
    // A failing edge keeps its reasons and its thin columns.
    const failing = verdictOf([cell("fire", 10)], edge, ["fire"], [{ ...weave, rate: 0.47 }]);
    expect(verdictWord(failing)).toBe("FAILS (styles) (thin: Fire 0%, Holy 11% vs weave)");
  });

  it("reports every designed edge, with a style grid for each one that has a ranged weapon", () => {
    const report = buildReport({ quick: true, factions: ["fire"], setups: [{ distance: 300, delayTicks: [0, 0], angle: 0.1 }], capSeconds: 12 });
    expect(report.verdicts.map((v) => edgeName(v.edge))).toEqual(WEAPON_BEATS.map(edgeName));
    expect(report.text).toContain("EDGE VERDICTS");
    expect(report.text).toMatch(/\d+ of 10 edges hold/);
    // And a target-lock row for each: both fighters clicking each other, one faction here.
    expect(report.lock.map((r) => edgeName(r.edge))).toEqual(WEAPON_BEATS.map(edgeName));
    for (const r of report.lock) {
      expect(r.perFaction.map((p) => p.faction)).toEqual(["fire"]);
      expect(r.overall).toBeGreaterThanOrEqual(0);
      expect(r.overall).toBeLessThanOrEqual(1);
      expect(r.worstFaction.faction).toBe("fire");
    }
    expect(report.text).toMatch(/\d+ of 10 edges keep 60% overall and 50% in every faction when both fighters lock each other/);
  });
});

describe("melee weave style", () => {
  it("is a style of every melee weapon and of no ranged one, and only edges with a ranged weapon get a grid", () => {
    for (const w of ["sword", "axe", "shield"] as WeaponId[]) {
      expect(stylesOf(w), w).toEqual(["stand", "weave", "jink"]);
      expect(spacingFor(w, "weave")!.weave, w).toEqual(WEAVES.weave);
      expect(spacingFor(w, "jink")!.weave, w).toEqual(WEAVES.jink);
      expect(spacingFor(w, "stand"), w).toBeUndefined();
    }
    for (const w of ["bow", "wand"] as WeaponId[]) {
      expect(stylesOf(w), w).toEqual(["stand", "strafe", "kite"]);
      expect(spacingFor(w, "weave"), w).toBeUndefined();
      expect(spacingFor(w, "jink"), w).toBeUndefined();
    }
    // Both sit inside the box the review swept: 45-60 degrees off the line, a new side every 0.3-0.6 s; the jink is the quicker.
    for (const v of Object.values(WEAVES)) {
      expect(v.angle).toBeGreaterThanOrEqual((45 * Math.PI) / 180);
      expect(v.angle).toBeLessThanOrEqual((60 * Math.PI) / 180);
      expect(v.period).toBeGreaterThanOrEqual(0.3);
      expect(v.period).toBeLessThanOrEqual(0.6);
    }
    expect(WEAVES.jink.period).toBeLessThan(WEAVES.weave.period);
    expect(WEAPON_BEATS.filter(hasGrid).map(edgeName)).toEqual(WEAPON_BEATS.filter((e) => isRanged(e[0]) || isRanged(e[1])).map(edgeName));
    expect(WEAPON_BEATS.filter((e) => !hasGrid(e)).map(edgeName)).toEqual(["sword > axe", "shield > sword", "axe > shield"].sort((a, b) => order(a) - order(b)));
  });

  /** The sword fighter's lateral offset from the bow (it starts level with it along x) once a tick, and when it first got in reach. */
  function charge(style: "stand" | "weave" | "jink"): { offsets: number[]; contact: number | null } {
    const offsets: number[] = [];
    let contact: number | null = null;
    runDuel({
      faction: "fire", weapons: ["sword", "bow"], distance: 450, angle: 0, capSeconds: 4, seed: 3,
      spacing: [spacingFor("sword", style), undefined],
      onTick: (world, tick) => {
        const a = world.state.players.get("f0")!;
        const b = world.state.players.get("f1")!;
        offsets.push(a.y - b.y);
        if (contact === null && Math.hypot(a.x - b.x, a.y - b.y) <= 60) contact = (tick + 1) / 20;
      },
    });
    return { offsets, contact };
  }

  it("makes the melee fighter zigzag across the line, changing side on the clock and delaying contact", () => {
    const straight = charge("stand");
    expect(Math.max(...straight.offsets.map(Math.abs))).toBeLessThan(1);
    expect(straight.contact).not.toBeNull();
    const flipsOf = (offsets: number[]): number => {
      const lateral = offsets.slice(1).map((y, i) => y - offsets[i]!).filter((dy) => Math.abs(dy) > 0.5);
      let flips = 0;
      for (let i = 1; i < lateral.length; i++) if (Math.sign(lateral[i]!) !== Math.sign(lateral[i - 1]!)) flips++;
      return flips;
    };
    const flips: number[] = [];
    for (const style of ["weave", "jink"] as const) {
      const run = charge(style);
      expect(Math.max(...run.offsets.map(Math.abs)), style).toBeGreaterThan(25);
      // The 30% ranged windups give the bow enough orbwalk uptime to avoid contact within this four-second probe.
      if (run.contact !== null) expect(run.contact, style).toBeGreaterThan(straight.contact! + 0.5);
      flips.push(flipsOf(run.offsets));
    }
    // The lateral velocity changes sign over and over on the way in, and more often for the quicker jink.
    expect(flips[0]!).toBeGreaterThanOrEqual(3);
    expect(flips[1]!).toBeGreaterThan(flips[0]!);
  });

  it("repeats exactly: no randomness, only the clock", () => {
    expect(charge("weave")).toEqual(charge("weave"));
    expect(charge("jink")).toEqual(charge("jink"));
    const spec = {
      faction: "plague" as FactionId, weapons: ["axe", "wand"] as const, distance: 300, angle: 0.8, capSeconds: 6, seed: 5,
      spacing: [spacingFor("axe", "weave"), spacingFor("wand", "strafe")] as const,
    };
    const a = runDuel(spec);
    const b = runDuel(spec);
    expect({ ...a, spec: undefined }).toEqual({ ...b, spec: undefined });
  });

  it("shows up in the grids and the verdicts of a report", () => {
    const report = buildReport({
      factions: ["fire"], setups: [{ distance: 300, delayTicks: [0, 0], angle: 0.1 }], capSeconds: 12, core: true, edges: [["bow", "axe"], ["sword", "axe"]],
    });
    expect(report.text).toContain("axe weave");
    expect(report.text).toContain("axe jink");
    expect(report.text).toContain("weave = a melee approach");
    const bowAxe = report.verdicts.find((v) => edgeName(v.edge) === "bow > axe")!;
    expect(bowAxe.replies.map((r) => r.loser)).toEqual(["stand", "weave", "jink"]);
    expect(bowAxe.replies.every((r) => r.perFaction.length === 1 && r.perFaction[0]!.faction === "fire")).toBe(true);
    // A melee-against-melee edge has no ranged fighter to grid.
    expect(report.verdicts.find((v) => edgeName(v.edge) === "sword > axe")!.replies).toEqual([]);
  });
});

describe("the orbwalk and lock styles", () => {
  it("orbwalk is a ranged style that backs away whenever the target is inside the attack range, and lock plays through no spacing at all", () => {
    for (const w of ["bow", "wand"] as WeaponId[]) {
      const o = spacingFor(w, "orbwalk")!;
      expect(o.retreatBelow, w).toBe(POLICIES[w].attackRange);
      expect(o.far, w).toBe(Infinity);
      expect(o.leadSpeed, w).toBe(POLICIES[w].leadSpeed);
    }
    for (const w of ["sword", "axe", "shield"] as WeaponId[]) expect(spacingFor(w, "orbwalk"), w).toBeUndefined();
    for (const w of WEAPON_IDS) expect(spacingFor(w, "lock"), w).toBeUndefined();
    // Neither is in the style grids: the kiting section is the only place they are measured.
    for (const w of WEAPON_IDS) expect(stylesOf(w), w).not.toContain("lock");
    for (const w of WEAPON_IDS) expect(stylesOf(w), w).not.toContain("orbwalk");
    expect(KITE_STYLES).toEqual(["post", "stand", "strafe", "kite", "orbwalk", "lock"]);
  });

  it("a locking fighter is locked on the other from the first tick to the last, and the server does the fighting", () => {
    const locked: Array<[string, string]> = [];
    const r = runDuel({
      faction: "fire", weapons: ["sword", "axe"], distance: 300, angle: 0.1, capSeconds: 60, seed: 4, locks: [true, true],
      onTick: (world) => {
        if (world.state.phase !== "active") return;
        locked.push([world.state.players.get("f0")!.attackTarget, world.state.players.get("f1")!.attackTarget]);
      },
    });
    // The order is queued before the tick and taken in it: from the first tick each has the other locked, until one falls.
    expect(locked.length).toBeGreaterThan(20);
    expect(locked.slice(0, locked.length - 2).every(([a, b]) => a === "f1" && b === "f0")).toBe(true);
    expect(r.end).toBe("kill");
    expect(r.counts.attacks[0]).toBeGreaterThan(0);
    expect(r.counts.attacks[1]).toBeGreaterThan(0);
    expect(r.counts.hits[0] + r.counts.hits[1]).toBeGreaterThan(0);
  });

  it("a locking bow walks into range of a shooter that stands too far and shoots; the other fighter may play any style", () => {
    const r = runDuel({
      faction: "fire", weapons: ["sword", "bow"], distance: 450, capSeconds: 30, seed: 6, locks: [false, true],
      spacing: [spacingFor("sword", "stand"), undefined],
    });
    expect(r.counts.shots[1]).toBeGreaterThan(0);
    expect(r.end).toBe("kill");
  });

  it("repeats exactly", () => {
    const spec = {
      faction: "plague" as FactionId, weapons: ["bow", "shield"] as const, distance: 300, angle: 0.8, capSeconds: 10, seed: 9, locks: [true, true] as const,
    };
    const a = runDuel(spec);
    const b = runDuel(spec);
    expect({ ...a, spec: undefined }).toEqual({ ...b, spec: undefined });
  });
});

describe("kiting section", () => {
  it("lets a post never move, and every style is measured against the standing bound", () => {
    const post = spacingFor("bow", "post")!;
    expect(post.retreatBelow).toBe(0);
    expect(post.far).toBe(Infinity);
    const report = kitingReport(["fire", "plague"]);
    expect(report.cells).toHaveLength(3 * 2 * KITE_STYLES.length);
    for (const c of report.cells) expect(c.missed, `${c.melee} vs ${c.ranged} ${c.style}`).toBe(0);
    // The standing bound is (range - reach) / speed, and the melee fighter is never in reach sooner than that minus its own reach.
    for (const c of report.cells.filter((x) => x.style === "post")) expect(c.contact).toBeGreaterThan(report.bound[c.ranged]! - 0.5);
    expect(report.text.join("\n")).toContain("standing-shooter bound");
    expect(report.text.join("\n")).toContain("the perfect kiter");
  });

  it("records the measured kiting effect of short ranged windups in the real sim", () => {
    // League-like short ranged windups intentionally increase perfect-orbwalk uptime over the prior anti-kiting tuning.
    // Pin the measured result so later combat changes surface as a reviewable balance shift.
    const report = kitingReport(["fire", "plague"]);
    expect(report.worstOrbwalk.ratio).toBeCloseTo(3.088235294117647, 9);
    for (const c of report.cells.filter((x) => x.style === "orbwalk")) {
      const post = report.cells.find((x) => x.melee === c.melee && x.ranged === c.ranged && x.style === "post")!;
      expect(c.contact, `${c.melee} vs ${c.ranged}`).toBeGreaterThan(post.contact);
      expect(c.contact / post.contact, `${c.melee} vs ${c.ranged}`).toBeLessThanOrEqual(report.worstOrbwalk.ratio);
    }
    // A shooter that only clicks its chaser walks into range instead of away: never later than one that stands (a tick of slack).
    for (const c of report.cells.filter((x) => x.style === "lock")) {
      const post = report.cells.find((x) => x.melee === c.melee && x.ranged === c.ranged && x.style === "post")!;
      expect(c.contact, `${c.melee} vs ${c.ranged}`).toBeLessThanOrEqual(post.contact + 0.05);
    }
  });
});
