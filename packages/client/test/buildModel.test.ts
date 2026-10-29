// The build strip's numbers and words (ui/buildModel.ts), pure: AD, AP, armor, magic resist, attack and move speed, lifesteal, card
// power and the PvP factor, each with a tooltip; and the weapon bar's scaling line and special text.
import { describe, expect, it } from "vitest";
import {
  ALL_WEAPON_IDS, FACTIONS, FACTION_IDS, LIFESTEAL_MAX, WEAPONS, WEAPON_TAGS, WIRE_IDENTITY_MIRRORS, cardPower, encodeMirrors, pvpFactor,
  type StatMirrors,
} from "@raid/shared";
import {
  BUILD_STAT_IDS, buildGains, buildStats, cardLifesteal, cutPercent, factorText, num, percentOver, statLine, weaponScalingText, weaponSpecialText,
  weaponTipText, type BuildStat, type BuildStatId,
} from "../src/ui/buildModel";

const IDENTITY: StatMirrors = { asMult: 1, windupMult: 1, speedMult: 1, armorBonus: 0, shieldBonus: 0, adBonus: 0, apBonus: 0 };
const wire = (over: Partial<StatMirrors>): StatMirrors => encodeMirrors({ ...IDENTITY, ...over });

describe("gained-stat strip", () => {
  it("includes earned Demon Blood camp leech without including base faction leech", () => {
    const input = { faction: "holy", build: {}, weapon: "fists" as const, campClears: 8 };
    expect(buildGains(input).find(s => s.id === "leech")?.value).toBe("+2%");
    expect(buildGains({ ...input, faction: "fire" }).find(s => s.id === "leech")?.value).toBe("0%");
  });
  it("excludes faction totals and preserves fractional gains from the first mob kill", () => {
    const gains = buildGains({
      faction: "holy", build: {}, weapon: "fists", maxHp: FACTIONS.holy.hp + 50,
      mirrors: { ...IDENTITY, adBonus: 12, apBonus: 15, armorBonus: 7, shieldBonus: 9, asMult: 1.025, speedMult: 1.005 },
      mobStats: { rotMonk: 1, emberImp: 1 },
    });
    expect(Object.fromEntries(gains.map(s => [s.id, s.value]))).toEqual({
      ad: "+12", ap: "+15", damage: "+1%", as: "+2.5%", leech: "+0.25%",
      health: "+50", armor: "+7", mr: "+9", move: "+0.5%",
    });
  });

  it("shows a signed net penalty for stat tradeoffs", () => {
    const gains = buildGains({ faction: "fire", build: {}, weapon: "fists", mirrors: { ...IDENTITY, adBonus: -12, apBonus: -3 } });
    expect(gains.find(s => s.id === "ad")?.value).toBe("-12");
    expect(gains.find(s => s.id === "ap")?.value).toBe("-3");
  });
});

function stats(build: Record<string, number>, over: Partial<StatMirrors> = {}, faction = "plague", weapon: Parameters<typeof buildStats>[0]["weapon"] = "sword", hpFrac = 1) {
  const list = buildStats({ faction, build, wire: wire(over), weapon, hpFrac });
  const by = (id: BuildStatId): BuildStat => list.find((s) => s.id === id)!;
  return { list, by };
}

describe("the strip's cells", () => {
  it("has the nine cells in order: AD, AP, armor, MR, attack speed, move, leech, power, PvP", () => {
    const { list } = stats({});
    expect(list.map((s) => s.id)).toEqual([...BUILD_STAT_IDS]);
    expect(list.map((s) => s.label)).toEqual(["AD", "AP", "Armor", "MR", "Atk speed", "Move", "Leech", "Power", "PvP"]);
  });

  it("starts a fresh player at power 0 and PvP x0.77, with the contract's tooltip, and every cell dim", () => {
    const { by, list } = stats({});
    expect(by("power").value).toBe("0");
    expect(by("pvp").value).toBe("x0.77");
    expect(statLine(by("pvp"))).toBe("PvP x0.77");
    expect(by("pvp").tip).toBe("Your damage to players. Your card power sets this factor; it scales hits against players only.");
    expect(list.every((s) => s.dim)).toBe(true);
    expect(by("ad").value).toBe("+0");
    expect(by("as").value).toBe("0%");
  });

  it("reads the PvP factor off the card power, and the power off the build (a base card counts once per copy)", () => {
    for (const [build, p] of [[{ ad1: 1 }, 1], [{ ad1: 1, vitality1: 1 }, 2], [{ ad2: 2, haste1: 1 }, 5], [{ ad3: 1, hereComesTheBoom: 1 }, 6]] as const) {
      const { by } = stats({ ...build });
      expect(cardPower(build)).toBe(p);
      expect(by("power").value).toBe(String(p));
      expect(by("pvp").value).toBe(factorText(pvpFactor(p)));
      expect(by("pvp").dim).toBe(false);
    }
    // The contract's table: f(1) 1.11, f(2) 1.40, f(3) 1.65, f(5) 2.03, f(6) 2.18.
    expect([1, 2, 3, 5, 6].map((p) => factorText(pvpFactor(p)))).toEqual(["x1.11", "x1.40", "x1.65", "x2.03", "x2.18"]);
  });

  it("shows AD and AP from the synced mirrors (tenths of a point), not from the cards", () => {
    const { by } = stats({ ad1: 1 }, { adBonus: 24.5, apBonus: 12 });
    expect(by("ad").value).toBe("+24.5");
    expect(by("ap").value).toBe("+12");
    expect(by("ad").dim).toBe(false);
    expect(by("ad").tip).toContain("+24.5 from your cards");
  });

  it("explains weapon scaling and limits the base-passive AP rider to burn and disease", () => {
    expect(stats({}, {}, "plague", "sword").by("ad").tip).toContain("Your Sword turns each point into 1 damage a second");
    expect(stats({}, {}, "plague", "wand").by("ap").tip).toContain("Your Wand turns each point into 1 magic damage a second at base attack speed");
    expect(stats({}, {}, "plague", "wand").by("ap").tip).toContain("burn or disease also gains 0.6 magic damage a second per point");
    expect(stats({}, {}, "plague", "sword").by("ap").tip).toContain("gets nothing from it directly");
    expect(stats({}, {}, "plague", "bow").by("ap").tip).toContain("burn or disease also gains");
    for (const faction of ["sentenced", "frost", "holy"]) {
      expect(stats({}, {}, faction, "wand").by("ap").tip).toContain("base passive and Wish have no direct AP scaling");
      expect(stats({}, {}, faction, "wand").by("ap").tip).not.toContain("also gains 0.6");
    }
  });

  it("shows armor and magic resist as totals with the base and the cards apart, and what they cut", () => {
    const { by } = stats({ armor1: 1 }, { armorBonus: 15, shieldBonus: 26 }, "plague");
    expect(FACTIONS.plague.armor).toBe(190);
    expect(by("armor").value).toBe(String(190 + 15));
    expect(by("mr").value).toBe(String(0 + 26));
    expect(by("armor").tip).toContain(`cut by ${cutPercent(205)}%`);
    expect(by("armor").tip).toContain("190 from your base and 15 from your cards");
    expect(by("mr").tip).toContain("True damage ignores both");
    expect(cutPercent(100)).toBe(50);
    expect(cutPercent(0)).toBe(0);
  });

  it("shows attack and move speed as a percent over the base from the mirrors", () => {
    const { by } = stats({ haste2: 1 }, { asMult: 1.18, speedMult: 1.06 });
    expect(by("as").value).toBe("+18%");
    expect(by("move").value).toBe("+6%");
    const slowed = stats({}, { asMult: 0.5, speedMult: 0.7 });
    expect(slowed.by("as").value).toBe("-50%");
    expect(slowed.by("move").value).toBe("-30%");
    expect(percentOver(1)).toBe("0%");
    expect(percentOver(1.004)).toBe("0%");
  });

  it("shows leech from the cards, held to its cap, doubled by Bloodthirst below half health, and says the faction's own comes on top", () => {
    expect(stats({ leech1: 1 }).by("leech").value).toBe("5%");
    expect(stats({ leech2: 1, leech1: 1 }).by("leech").value).toBe("14%");
    expect(stats({ leech3: 5 }).by("leech").value).toBe("25%"); // rows stop at LS_CAP
    expect(stats({ leech1: 1, bloodthirst: 1 }, {}, "plague", "sword", 0.9).by("leech").value).toBe("5%");
    const low = stats({ leech1: 1, bloodthirst: 1 }, {}, "plague", "sword", 0.3);
    expect(low.by("leech").value).toBe("10%");
    expect(low.by("leech").tip).toContain("Doubled while you are below half health (now)");
    expect(stats({ vampiricPact: 1 }).by("leech").value).toBe("15%");
    expect(stats({ leech3: 5, bloodthirst: 1 }, {}, "plague", "sword", 0.1).by("leech").value).toBe("50%");
    expect(cardLifesteal({ leech3: 9, bloodthirst: 1, vampiricPact: 1 }, "plague", 0.1).share).toBeLessThanOrEqual(LIFESTEAL_MAX);
    expect(stats({}).by("leech").tip).toContain("own lifesteal");
  });

  it("is the same for a Map build (the synced MapSchema) as for a record", () => {
    const a = buildStats({ faction: "fire", build: new Map([["ad1", 2], ["leech1", 1]]), wire: WIRE_IDENTITY_MIRRORS, weapon: "fists" });
    const b = buildStats({ faction: "fire", build: { ad1: 2, leech1: 1 }, wire: WIRE_IDENTITY_MIRRORS, weapon: "fists" });
    expect(a).toEqual(b);
    expect(a.find((s) => s.id === "power")!.value).toBe("3");
  });

  it("copes with a faction id it does not know and a build that is missing", () => {
    const list = buildStats({ faction: "", build: undefined, wire: WIRE_IDENTITY_MIRRORS, weapon: "fists" });
    expect(list).toHaveLength(9);
    expect(list.find((s) => s.id === "armor")!.value).toBe("0");
  });

  it("formats numbers with at most one decimal", () => {
    expect([num(24), num(12.5), num(12.54), num(0.04)]).toEqual(["24", "12.5", "12.5", "0"]);
    expect(factorText(0.75)).toBe("x0.75");
  });

  it("never names a faction in a tooltip", () => {
    const names = FACTION_IDS.flatMap((f) => [FACTIONS[f].name, FACTIONS[f].displayName]);
    for (const f of FACTION_IDS) {
      for (const s of stats({ ad1: 1, leech1: 1, bloodthirst: 1 }, {}, f, "fists").list) {
        for (const n of names) expect(s.tip, `${f} ${s.id}`).not.toContain(n);
      }
    }
  });
});

describe("a weapon's scaling and special", () => {
  it("words the scaling biggest term first, with one decimal", () => {
    expect(weaponScalingText("sword")).toBe("AD 1.0");
    expect(weaponScalingText("bow")).toBe("AD 1.0");
    expect(weaponScalingText("wand")).toBe("AP 1.0 + AD 0.3");
    expect(weaponScalingText("axe")).toBe("AD 1.0 + bonus HP 0.02");
    expect(weaponScalingText("shield")).toBe("bonus armor/MR 0.4 + AP 0.3");
    expect(weaponScalingText("fists")).toBe("AD 0.6 + AP 0.6");
  });

  it("has a scaling line for every weapon, matching WeaponSpec.scaling", () => {
    for (const id of ALL_WEAPON_IDS) {
      const text = weaponScalingText(id);
      const sc = WEAPONS[id].scaling;
      if (sc.ad) expect(text, id).toContain(`AD ${sc.ad.toFixed(1)}`);
      if (sc.ap) expect(text, id).toContain(`AP ${sc.ap.toFixed(1)}`);
    }
  });

  it("takes the special from the glossary's weapon table: its tags, then what a tag cannot say", () => {
    expect(weaponSpecialText("sword")).toBe(`Physical, On-hit. ${WEAPON_TAGS.find((r) => r.weapon === "sword")!.note}`);
    for (const row of WEAPON_TAGS) expect(weaponSpecialText(row.weapon), row.weapon).toContain(row.note);
    expect(weaponSpecialText("wand")).toContain("Magic");
  });

  it("makes the tooltip: name, scaling, special", () => {
    const lines = weaponTipText("wand").split("\n");
    expect(lines[0]).toBe("Wand");
    expect(lines[1]).toBe("Scales with AP 1.0 + AD 0.3");
    expect(lines[2]).toBe(weaponSpecialText("wand"));
    for (const id of ALL_WEAPON_IDS) expect(weaponTipText(id).split("\n")[0]).toBe(WEAPONS[id].name);
  });
});
