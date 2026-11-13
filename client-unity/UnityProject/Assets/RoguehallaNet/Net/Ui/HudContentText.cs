using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Ui
{
    /// <summary>
    /// P-UNITY-HUD-BUILD-3: the legacy texts that need the Welcome's HUD content block (<see cref="WireHudContent"/>: weapon scaling
    /// rows and constant terms) and the owner panel codes 23-27. Legacy: ui/championCombatModel.ts, ui/buildModel.ts weaponScalingText,
    /// ui/weaponBar.ts. Every number is formatted from a delivered value; a block, row, term or panel code that is missing leaves the
    /// fragment "" (never "0" or "NaN"). Codes are read by code, never by position. STUB: every body returns "" until the packet lands.
    /// </summary>
    public static class HudContentText
    {
        /// <summary>The weapon slot's scaling line (weaponBar.ts:167 -> buildModel.ts weaponScalingText :204-213): positive terms biggest first,
        /// ties in the order Offense, SO, bonus HP, bonus Defense/SD; " + " between terms, " or " and a trailing " (the higher)" for a dominant
        /// weapon; "No scaling" for a row without a positive term; "" when the block or the weapon's row is not delivered.</summary>
        public static string SlotScaling(WireHudContent hud, WeaponId weapon) { return ""; }

        /// <summary>The weapon slot's tooltip text (buildModel.ts weaponTipText :222-229, the two lines Unity can fill): the weapon name, then
        /// "Scales with " + <see cref="SlotScaling"/>. Without a scaling line only the name. The tag line and the hit-type line have no source.</summary>
        public static string SlotTip(WireHudContent hud, WeaponId weapon) { return ""; }

        /// <summary>The auto row's scaling line (championCombatModel.ts:119-122): non-zero terms in the order Offense, SO, bonus HP, bonus defense,
        /// each "N× label" with legacy's fmt, joined by " or " (dominant) or " + "; "none" for a row with no non-zero term; "" when not delivered.</summary>
        public static string AutoScaling(WireHudContent hud, WeaponId weapon) { return ""; }

        /// <summary>The Wish row of the champion panel (championCombatModel.ts wishRow :219-228) for a faction: Name is the ability's name
        /// (always known), Value and Scaling the legacy lines built from the block's terms ("" when a term they need is missing); Detail is "".</summary>
        public static ChampionRow Wish(WireHudContent hud, FactionId faction) { return new ChampionRow("", "", "", ""); }

        /// <summary>The Fire roam sentence (championCombatModel.ts:114-116 <c>fireRoamText</c>, without its leading space) for Fire; "" for other
        /// factions or when panel codes 8, 9, 23, 24 or terms 19-22 are missing.</summary>
        public static string FireRoam(WireBuildSummary summary, WireHudContent hud, FactionId faction) { return ""; }

        /// <summary>The auto row's whole tooltip (championCombatModel.ts:126-129), each sentence left out when its numbers are not delivered:
        /// the per-hit parts, the attack-speed mirror (<paramref name="asMilli"/>, <c>WireOwnerCombat.AsMilli</c>, 1000 = 1x), the weapon scaling
        /// with its hit multiplier, the fixed "excludes" sentence, then <see cref="FireRoam"/>. Sentences are joined by one space.</summary>
        public static string AutoTooltip(WireBuildSummary summary, WireHudContent hud, FactionId faction, WeaponId weapon, double? asMilli) { return ""; }
    }
}
