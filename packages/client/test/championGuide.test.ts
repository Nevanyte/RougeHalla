import { describe, expect, it } from "vitest";
import {
  ALL_WEAPON_IDS, AP_DOT_RATIO, FACTIONS, FACTION_IDS, FIRE_ROAM_BURST_AP_SHARE, FIRE_ROAM_BURST_BASE, FIRE_ROAM_MAX_SPEED_MULT, FIRE_ROAM_RAMP_MS,
  MARK_AS_EXPONENT, MARK_BONUS_STAT_PER_POINT, MARK_BONUS_AP_WEIGHT, MARK_FARM_AS_EFFICIENCY, MARK_TIER_HITS, TRIAL_EXIT_STUN_MS, TRIAL_MOVE_MULT, WEAPONS,
  abilityCooldownMs, maxCharges, burnDps, markPct, pacedFaction, plagueDps, wishOf,
} from "@raid/shared";
import { championGuide, guideNumber, signatureGuide, weaponScalingGuide } from "../src/ui/hub/championGuide";

describe("champion guide matches the combat catalog", () => {
  it("explains Plague's one growing zombie, max-health scaling and body-based revival", () => {
    const guide = signatureGuide("plague"), details = guide.details.join(" ");
    expect(guide.summary).toContain("raise a Plague zombie");
    expect(guide.scaling).toContain("your max health and harvested bodies");
    expect(details).toContain("first raises one zombie");
    expect(details).toContain("55% of your current max HP");
    expect(details).toContain("each physical hit is 2% of your current max HP");
    expect(details).toContain("consume another player body to revive it");
    expect(details).toContain("no longer multiplies disease or execute damage");
  });

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
    const cdMs = abilityCooldownMs(wish, 1, {});
    const every = cdMs >= 60_000 ? `${cdMs / 60_000} min` : `${cdMs / 1000} s`;
    const charges = maxCharges(wish, 1);
    expect(guide.wish.cooldown).toBe(charges > 1 ? `${charges} charges · 1 back every ${every}` : `${every} cooldown`);
    if (id === "fire") expect(charges).toBeGreaterThan(1);
    expect(guide.wish.details.join(" ")).toContain("Offense and SO do not increase");
    expect(guide.wish.details.join(" ")).toContain("Training cooldown: 5 s");
    expect(guide.wish.details.join(" ")).toContain("45 s lock");
    const visible = [guide.passive.summary, guide.passive.scaling, ...guide.passive.details, guide.wish.scaling, ...guide.wish.details].join(" ");
    expect(visible).not.toMatch(/\b(?:armor|armour|AD|AP|MR)\b|Magic resist/);
  });

  it("uses the arena's paced burn and disease, with a single SO rider rather than design-sheet damage", () => {
    expect(signatureGuide("fire").scaling).toContain(`${burnDps(pacedFaction(FACTIONS.fire))} × weapon multiplier`);
    expect(signatureGuide("plague").scaling).toContain(`${plagueDps(pacedFaction(FACTIONS.plague))} × weapon multiplier`);
    expect(signatureGuide("fire").scaling).toContain(`${AP_DOT_RATIO} × SO`);
    expect(signatureGuide("plague").details.join(" ")).toContain("no second SO rider");
    expect(signatureGuide("plague").details.join(" ")).toContain("damage-over-time ticks cannot critically strike; auto attacks can");
    expect(signatureGuide("plague").details.join(" ")).toContain("converts half its current crit chance into steady DoT damage");
  });

  it("explains Frost's movement slow and its thaw without implying the attack slow thaws", () => {
    const guide = signatureGuide("frost");
    expect(guide.scaling).toContain("for 1 s, fading over the next 3 s");
    expect(guide.details.join(" ")).toContain("Repeated hits and switching between Frost fighters do not refresh it");
    expect(guide.details.join(" ")).toContain("4 s clear of every Frost movement chill");
    expect(guide.details.join(" ")).toContain(`attack cooldown and damage over time progress at ${guideNumber((1 - FACTIONS.frost.params.slow!) * 100)}%`);
    expect(guide.details.join(" ")).toContain("Bow kiter build");
  });

  it("explains the mark as weighted target-health damage, not an Offense/SO spell or an unweighted hit", () => {
    const f = pacedFaction(FACTIONS.sentenced);
    const text = signatureGuide("sentenced").details.join(" ");
    expect(text).toContain(`${guideNumber(markPct(f, 0) * 100)}%`);
    expect(text).toContain(`${guideNumber(f.params.mark_kill! * 100)}% × Sentence stacks`);
    expect(text).toContain("hit weight");
    expect(MARK_AS_EXPONENT).toBe(1);
    expect(MARK_BONUS_AP_WEIGHT).toBe(1);
    expect(MARK_FARM_AS_EFFICIENCY).toBe(1);
    expect(text).toContain("attack speed raises the mark exactly as it raises weapon damage");
    expect(text).toContain(`${guideNumber(MARK_BONUS_STAT_PER_POINT * 100)}% per point`);
    expect(text).toContain(`${MARK_TIER_HITS}, ${MARK_TIER_HITS * 2} and ${MARK_TIER_HITS * 3}`);
    expect(text).toContain("1/√(original camp size)");
    expect(signatureGuide("sentenced").scaling).toContain("bonus stat");
    expect(signatureGuide("sentenced").scaling).toContain(`${guideNumber(MARK_BONUS_STAT_PER_POINT * 100)}% of the pulse`);
  });

  it("describes Fire roam from shared tuning and the Trial movement/exit effects", () => {
    const fire = signatureGuide("fire");
    expect(fire.scaling).toContain(`${guideNumber(FIRE_ROAM_MAX_SPEED_MULT)}×`);
    expect(fire.scaling).toContain(`${FIRE_ROAM_BURST_BASE} + ${guideNumber(FIRE_ROAM_BURST_AP_SHARE)} × SO`);
    expect(fire.scaling).toContain(`${guideNumber(FIRE_ROAM_RAMP_MS / 1000)} s`);
    expect(fire.details.join(" ")).toContain("does not cancel a burst already armed");
    expect(championGuide("sentenced").wish.scaling).toContain(`${guideNumber((1 - TRIAL_MOVE_MULT) * 100)}% slower`);
    expect(championGuide("sentenced").wish.scaling).toContain(`${guideNumber(TRIAL_EXIT_STUN_MS / 1000)} s`);
  });

  it("keeps fixed Wish values separate from passive and weapon scaling", () => {
    expect(championGuide("fire").wish.scaling).toContain("30 true damage/s");
    expect(championGuide("frost").wish.scaling).toContain("1.25 s stun");
    expect(championGuide("plague").wish.scaling).toContain("8 s concealment");
    expect(championGuide("holy").passive.scaling).toContain(`${guideNumber(FACTIONS.holy.params.ls0! * 100)}%–${guideNumber(FACTIONS.holy.params.ls_cap! * 100)}%`);
    expect(championGuide("holy").wish.scaling).toContain("30% of damage held");
  });

  it.each(ALL_WEAPON_IDS)("shows %s's real per-second coefficients, and explains the conversion to a hit", id => {
    const guide = weaponScalingGuide(id);
    expect(guide.name).toBe(WEAPONS[id].name);
    expect(guide.scaling).not.toBe("");
    expect(guide.detail).toContain("attack interval in seconds");
    expect(guide.detail).toContain("SO scaling deals magic damage");
  });
});
