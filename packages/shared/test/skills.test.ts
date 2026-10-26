// The passive catalog (roguelike R5, shared/skills.ts) and the chest roll (shared/rewards.ts): what is live, the ranks and
// their wording, and the interim option rule over many seeds and builds.
import { describe, expect, it } from "vitest";
import {
  CHEST_OPTIONS, chestOptionView, chestPool, effectsText, FACTION_IDS, LIVE_SKILL_READY, mulberry32, nextRank, rankIn,
  rollChestOptions, SKILL_IDS, SKILL_MAX_RANK, skillDef, skillLive, skillRows, SKILLS, skillsOf, skillText, skipText,
  type FactionId, type SkillId,
} from "../src/index";

const R5_LIVE: SkillId[] = [
  "witness", "pestilence", "lastRites", "whetstone", "swiftBoots", "quickdraw", "thickHide", "bountyHunter", "secondWind",
];
const ZONE_LIVE: Record<FactionId, SkillId[]> = {
  fire: [], sentenced: ["witness"], plague: ["pestilence"], frost: [], holy: ["lastRites"],
};
const NEUTRAL_LIVE: SkillId[] = ["whetstone", "swiftBoots", "quickdraw", "thickHide", "bountyHunter", "secondWind"];

describe("the passive catalog", () => {
  it("has every passive of ROGUELIKE_PLAN 3.6 once, with two ranks, a name and a line per rank", () => {
    expect(SKILLS).toHaveLength(21);
    expect(new Set(SKILL_IDS).size).toBe(SKILL_IDS.length);
    for (const s of SKILLS) {
      expect(s.kind, s.id).toBe("passive");
      expect(s.name.length, s.id).toBeGreaterThan(0);
      expect(s.ranks, s.id).toHaveLength(SKILL_MAX_RANK);
      for (const r of s.ranks) expect(r.text.length, s.id).toBeGreaterThan(0);
      expect(s.ranks[0].text, s.id).not.toBe(s.ranks[1].text);
      expect(skillDef(s.id)).toBe(s);
    }
  });

  it("is live for exactly the R5 set (firebrand and hoarfrostArmor wait for R4b)", () => {
    expect(LIVE_SKILL_READY).toEqual(["r5"]);
    expect(SKILLS.filter((s) => skillLive(s)).map((s) => s.id).sort()).toEqual([...R5_LIVE].sort());
    expect(skillDef("firebrand")!.ready).toBe("r4b");
    expect(skillDef("hoarfrostArmor")!.ready).toBe("r4b");
    expect(skillLive("nope")).toBe(false);
    for (const zone of FACTION_IDS) expect(skillsOf(zone, { liveOnly: true }).map((s) => s.id)).toEqual(ZONE_LIVE[zone]);
    expect(skillsOf("neutral", { liveOnly: true }).map((s) => s.id)).toEqual(NEUTRAL_LIVE);
  });

  it("words a live rank from its rows, so the text is the numbers", () => {
    for (const id of R5_LIVE) {
      if (id === "pestilence") continue;
      for (const r of [1, 2]) expect(skillText(id, r), `${id} ${r}`).toBe(effectsText(skillRows(id, r)));
    }
    expect(skillText("whetstone", 1)).toBe("+6% damage");
    expect(skillText("whetstone", 2)).toBe("+10% damage");
    expect(skillText("quickdraw", 2)).toBe("-12% windup time");
    expect(skillText("lastRites", 2)).toBe("+25% attack speed while below 40% HP");
    expect(skillText("secondWind", 1)).toBe("Below 25% HP: heal 20% of max HP over 2 s (once per run)");
    expect(skillText("secondWind", 2)).toBe("Below 25% HP: heal 30% of max HP over 2 s (once, and again after each teleport)");
    expect(skillText("whetstone", 0)).toBe("");
    expect(skillText("nope", 1)).toBe("");
  });

  it("Pestilence: Plague widens its execute, everyone else gets the damage row", () => {
    expect(skillRows("pestilence", 1, "plague")).toEqual([{ k: "stat", stat: "executeBand", v: 0.1 }]);
    expect(skillRows("pestilence", 2, "plague")).toEqual([{ k: "stat", stat: "executeBand", v: 0.2 }]);
    for (const f of FACTION_IDS.filter((x) => x !== "plague")) {
      expect(skillRows("pestilence", 1, f)).toEqual([{ k: "vs", test: "hpBelow", arg: 0.6, v: 0.08 }]);
      expect(skillRows("pestilence", 2, f)).toEqual([{ k: "vs", test: "hpBelow", arg: 0.6, v: 0.12 }]);
    }
    expect(skillText("pestilence", 1, "plague")).toBe("Execute starts at 60% HP (from 50%; Plague only)");
    expect(skillText("pestilence", 2, "fire")).toBe("+12% damage to targets below 60% HP");
    expect(skillText("pestilence", 1)).toMatch(/^Plague: .*Others: /);
  });

  it("reads ranks from a map, a MapSchema-like getter or a record, and knows what a pick gives", () => {
    expect(rankIn(null, "whetstone")).toBe(0);
    expect(rankIn(new Map([["whetstone", 1]]), "whetstone")).toBe(1);
    expect(rankIn({ whetstone: 2 }, "whetstone")).toBe(2);
    expect(rankIn({ whetstone: 9 }, "whetstone")).toBe(2);
    expect(rankIn({ whetstone: -1 }, "whetstone")).toBe(0);
    expect(nextRank({}, "whetstone")).toBe(1);
    expect(nextRank({ whetstone: 1 }, "whetstone")).toBe(2);
    expect(nextRank({ whetstone: 2 }, "whetstone")).toBeNull();
  });
});

describe("the chest roll (interim rule until R6)", () => {
  const live = new Set<string>(R5_LIVE);

  /** A random build: each live skill unowned, at rank 1 or at rank 2. */
  function randomBuild(rng: () => number): Record<string, number> {
    const b: Record<string, number> = {};
    for (const id of R5_LIVE) {
      const x = rng();
      if (x < 0.25) b[id] = 1;
      else if (x < 0.4) b[id] = 2;
    }
    return b;
  }

  it("over many seeds, zones and builds: no duplicates, live only, at most one zone passive, never a maxed one", () => {
    const rng = mulberry32(5150);
    let fullRolls = 0;
    for (let trial = 0; trial < 4000; trial++) {
      const zone = FACTION_IDS[trial % FACTION_IDS.length]!;
      const build = trial % 3 === 0 ? undefined : randomBuild(rng);
      const opts = rollChestOptions(mulberry32(trial * 7919 + 1), { zone, build });
      expect(new Set(opts).size, `trial ${trial}`).toBe(opts.length);
      expect(opts.length).toBeLessThanOrEqual(CHEST_OPTIONS);
      for (const id of opts) {
        expect(live.has(id), id).toBe(true);
        expect(nextRank(build, id), `${id} in ${JSON.stringify(build)}`).not.toBeNull();
      }
      const zoneOpts = opts.filter((id) => skillDef(id)!.pool !== "neutral");
      expect(zoneOpts.length).toBeLessThanOrEqual(1);
      for (const id of zoneOpts) expect(skillDef(id)!.pool).toBe(zone);
      // The zone's card comes first.
      if (zoneOpts.length > 0) expect(opts[0]).toBe(zoneOpts[0]);
      // Short only when the pools run dry.
      const zoneLeft = chestPool(zone, { build }).length;
      const neutralLeft = chestPool("neutral", { build }).length;
      expect(opts.length).toBe(Math.min(1, zoneLeft) + Math.min(CHEST_OPTIONS - Math.min(1, zoneLeft), neutralLeft));
      if (opts.length === CHEST_OPTIONS) fullRolls++;
    }
    expect(fullRolls).toBeGreaterThan(3000);
  });

  it("offers the zone passive whenever the zone has a free one; Fire and Frost give neutrals only", () => {
    for (let s = 0; s < 200; s++) {
      for (const zone of FACTION_IDS) {
        const opts = rollChestOptions(mulberry32(s), { zone });
        expect(opts).toHaveLength(CHEST_OPTIONS);
        if (ZONE_LIVE[zone].length === 0) expect(opts.every((id) => skillDef(id)!.pool === "neutral"), zone).toBe(true);
        else expect(opts[0], zone).toBe(ZONE_LIVE[zone][0]);
      }
    }
    // The zone's only passive maxed: neutrals only.
    expect(rollChestOptions(mulberry32(1), { zone: "holy", build: { lastRites: 2 } }).every((id) => skillDef(id)!.pool === "neutral")).toBe(true);
  });

  it("never offers an r4b, r6 or r7 skill unless asked for the whole catalog", () => {
    const seen = new Set<string>();
    for (let s = 0; s < 500; s++) for (const zone of FACTION_IDS) for (const id of rollChestOptions(mulberry32(s), { zone })) seen.add(id);
    expect([...seen].sort()).toEqual([...R5_LIVE].sort());
    const all = new Set<string>();
    for (let s = 0; s < 500; s++) for (const zone of FACTION_IDS) for (const id of rollChestOptions(mulberry32(s), { zone, readyOnly: false })) all.add(id);
    expect(all.has("firebrand")).toBe(true);
  });

  it("draws one number per option from the stream it is handed, and nothing else", () => {
    let calls = 0;
    const base = mulberry32(77);
    const counted = (): number => { calls++; return base(); };
    const opts = rollChestOptions(counted, { zone: "plague" });
    expect(calls).toBe(opts.length);
    // Same stream state, same options.
    expect(rollChestOptions(mulberry32(77), { zone: "plague" })).toEqual(opts);
  });

  it("D6 (R6's rule): 2 zone + 1 neutral, a short pool filled from the other", () => {
    const opts = rollChestOptions(mulberry32(3), { zone: "plague", rule: "d6", readyOnly: false });
    expect(opts.slice(0, 2).every((id) => skillDef(id)!.pool === "plague")).toBe(true);
    expect(skillDef(opts[2]!)!.pool).toBe("neutral");
    // Live only, Plague has one: the neutral side fills the rest.
    const live1 = rollChestOptions(mulberry32(3), { zone: "plague", rule: "d6" });
    expect(live1).toHaveLength(3);
    expect(live1[0]).toBe("pestilence");
  });
});

describe("the chest's cards", () => {
  it("say what a pick gives this picker: rank 1, the upgrade to rank 2, or maxed", () => {
    expect(chestOptionView("whetstone", {})).toEqual({
      id: "whetstone", name: "Whetstone", rank: 1, text: "+6% damage", maxed: false, pool: "neutral",
    });
    expect(chestOptionView("whetstone", { whetstone: 1 })).toMatchObject({ rank: 2, text: "+10% damage", maxed: false });
    expect(chestOptionView("whetstone", { whetstone: 2 })).toMatchObject({ rank: 2, maxed: true });
    expect(chestOptionView("pestilence", null, "plague")!.text).toBe("Execute starts at 60% HP (from 50%; Plague only)");
    expect(chestOptionView("nope", null)).toBeNull();
    expect(skipText()).toBe("Skip: heal 15% of max HP if out of combat, else +3 GV");
  });
});
