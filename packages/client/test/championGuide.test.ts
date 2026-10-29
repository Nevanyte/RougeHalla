import { describe, expect, it } from "vitest";
import {
  ALL_WEAPON_IDS, AP_DOT_RATIO, FACTIONS, FACTION_IDS, MARK_TIER_HITS, WEAPONS,
  abilityCooldownMs, burnDps, markPct, pacedFaction, plagueDps, wishOf,
} from "@raid/shared";
import { championGuide, guideNumber, signatureGuide, weaponScalingGuide } from "../src/ui/hub/championGuide";

describe("champion guide matches the combat catalog", () => {
  it.each(FACTION_IDS)("explains %s's passive and actual active Wish", id => {
    const guide = championGuide(id);
    const wish = wishOf(id)!;
    expect(guide.faction).toBe(FACTIONS[id]);
    expect(guide.passive.key).toBe("P");
    expect(guide.passive.summary.length).toBeLessThan(190);
    expect(guide.passive.scaling.length).toBeGreaterThan(20);
    expect(guide.passive.details.length).toBeGreaterThan(2);
    expect(guide.wish.def).toBe(wish);
    expect(guide.wish.key).toBe("D");
    expect(guide.wish.cooldown).toContain(String(abilityCooldownMs(wish, 1, {}) / 60000));
    expect(guide.wish.details.join(" ")).toContain("AD and AP do not increase");
    expect(guide.wish.details.join(" ")).toContain("Training cooldown: 5 s");
    expect(guide.wish.details.join(" ")).toContain("45 s lock");
  });

  it("uses the arena's paced burn and disease, with a single AP rider rather than design-sheet damage", () => {
    expect(signatureGuide("fire").scaling).toContain(`${burnDps(pacedFaction(FACTIONS.fire))} × weapon multiplier`);
    expect(signatureGuide("plague").scaling).toContain(`${plagueDps(pacedFaction(FACTIONS.plague))} × weapon multiplier`);
    expect(signatureGuide("fire").scaling).toContain(`${AP_DOT_RATIO} × AP`);
    expect(signatureGuide("plague").details.join(" ")).toContain("no second AP rider");
  });

  it("explains the mark as weighted target-health damage, not an AD/AP spell or an unweighted hit", () => {
    const f = pacedFaction(FACTIONS.sentenced);
    const text = signatureGuide("sentenced").details.join(" ");
    expect(text).toContain(`${guideNumber(markPct(f, 0) * 100)}%`);
    expect(text).toContain(`${guideNumber(f.params.mark_kill! * 100)}% × Sentence stacks`);
    expect(text).toContain("hit weight");
    expect(text).toContain(`${MARK_TIER_HITS}, ${MARK_TIER_HITS * 2} and ${MARK_TIER_HITS * 3}`);
    expect(text).toContain("1/√(original camp size)");
    expect(signatureGuide("sentenced").scaling).toContain("AD and AP do not directly scale");
  });

  it("keeps fixed Wish values separate from passive and weapon scaling", () => {
    expect(championGuide("fire").wish.scaling).toContain("30 true damage/s");
    expect(championGuide("frost").wish.scaling).toContain("1.25 s stun");
    expect(championGuide("plague").wish.scaling).toContain("8 s concealment");
    expect(championGuide("holy").passive.scaling).toContain("11%–75%");
    expect(championGuide("holy").wish.scaling).toContain("30% of damage held");
  });

  it.each(ALL_WEAPON_IDS)("shows %s's real per-second coefficients, and explains the conversion to a hit", id => {
    const guide = weaponScalingGuide(id);
    expect(guide.name).toBe(WEAPONS[id].name);
    expect(guide.scaling).not.toBe("");
    expect(guide.detail).toContain("attack interval in seconds");
    expect(guide.detail).toContain("AP scaling deals magic damage");
  });
});
