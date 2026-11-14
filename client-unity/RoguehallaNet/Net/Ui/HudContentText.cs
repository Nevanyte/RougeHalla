using System;
using System.Collections.Generic;
using System.Globalization;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Ui
{
    /// <summary>
    /// P-UNITY-HUD-BUILD-3: the legacy texts that need the Welcome's HUD content block (<see cref="WireHudContent"/>: weapon scaling
    /// rows and constant terms) and the owner panel codes 23-27. Legacy: ui/championCombatModel.ts, ui/buildModel.ts weaponScalingText,
    /// ui/weaponBar.ts. Every number is formatted from a delivered value; a block, row, term or panel code that is missing leaves the
    /// fragment "" (never "0" or "NaN"). Codes are read by code, never by position.
    /// </summary>
    public static class HudContentText
    {
        const string Excludes = "This raw packet excludes target defenses, outgoing damage bonuses, conditional effects, critical hits, Plant Your Feet, and player-versus-player scaling.";
        static readonly string[] WeaponNames = { "Sword", "Bow", "Wand", "Shield", "Axe", "Fists" };

        /// <summary>The weapon slot's scaling line (weaponBar.ts:167 -> buildModel.ts weaponScalingText :204-213): positive terms biggest first,
        /// ties in the order Offense, SO, bonus HP, bonus Defense/SD; " + " between terms, " or " and a trailing " (the higher)" for a dominant
        /// weapon; "No scaling" for a row without a positive term; "" when the block or the weapon's row is not delivered.</summary>
        public static string SlotScaling(WireHudContent hud, WeaponId weapon)
        {
            var row = hud?.ScalingOf((byte)weapon);
            if (row == null) return "";
            var terms = new List<KeyValuePair<double, string>>();
            Add(terms, row.Ad, "Offense"); Add(terms, row.Ap, "SO"); Add(terms, row.BonusHp, "bonus HP"); Add(terms, row.BonusDefense, "bonus Defense/SD");
            if (terms.Count == 0) return "No scaling";
            // Stable insertion sort, biggest first; ties keep the order above.
            for (int i = 1; i < terms.Count; i++)
                for (int j = i; j > 0 && terms[j].Key > terms[j - 1].Key; j--) { var t = terms[j]; terms[j] = terms[j - 1]; terms[j - 1] = t; }
            var parts = new List<string>();
            foreach (var t in terms) parts.Add(t.Value + " " + Scale(t.Key));
            string text = string.Join(row.Dominant ? " or " : " + ", parts);
            return row.Dominant ? text + " (the higher)" : text;
        }

        /// <summary>The weapon slot's tooltip text (buildModel.ts weaponTipText :222-229, the two lines Unity can fill): the weapon name, then
        /// "Scales with " + <see cref="SlotScaling"/>. Without a scaling line only the name. The tag line and the hit-type line have no source.</summary>
        public static string SlotTip(WireHudContent hud, WeaponId weapon)
        {
            string name = (int)weapon < WeaponNames.Length ? WeaponNames[(int)weapon] : "Weapon";
            string line = SlotScaling(hud, weapon);
            return line.Length == 0 ? name : name + "\nScales with " + line;
        }

        /// <summary>The auto row's scaling line (championCombatModel.ts:119-122): non-zero terms in the order Offense, SO, bonus HP, bonus defense,
        /// each "N× label" with legacy's fmt, joined by " or " (dominant) or " + "; "none" for a row with no non-zero term; "" when not delivered.</summary>
        public static string AutoScaling(WireHudContent hud, WeaponId weapon)
        {
            var row = hud?.ScalingOf((byte)weapon);
            if (row == null) return "";
            var parts = new List<string>();
            if (row.Ad != 0) parts.Add(Fmt(row.Ad) + "× Offense");
            if (row.Ap != 0) parts.Add(Fmt(row.Ap) + "× SO");
            if (row.BonusHp != 0) parts.Add(Fmt(row.BonusHp) + "× bonus HP");
            if (row.BonusDefense != 0) parts.Add(Fmt(row.BonusDefense) + "× bonus defense");
            return parts.Count == 0 ? "none" : string.Join(row.Dominant ? " or " : " + ", parts);
        }

        /// <summary>The Wish row of the champion panel (championCombatModel.ts wishRow :219-228) for a faction: Name is the ability's name
        /// (always known), Value and Scaling the legacy lines built from the block's terms ("" when a term they need is missing); Detail is "".</summary>
        public static ChampionRow Wish(WireHudContent hud, FactionId faction)
        {
            string name, value = "", scaling = "";
            switch (faction)
            {
                case FactionId.Frost:
                    name = "Freeze";
                    if (hud?.Term(HudTerm.FreezeStunMs) is double a && hud.Term(HudTerm.FreezeRange) is double b)
                    { value = Fmt(a / 1000) + "s stun · " + Raw(b) + " range"; scaling = "No damage scaling"; }
                    break;
                case FactionId.Plague:
                    name = "Swarm";
                    if (hud?.Term(HudTerm.SwarmHiddenMs) is double c && hud.Term(HudTerm.SwarmCloudRadius) is double d)
                    { value = Fmt(c / 1000) + "s hidden · " + Raw(d) + " radius"; scaling = "No damage scaling"; }
                    break;
                case FactionId.Sentenced:
                    name = "Trial";
                    if (hud?.Term(HudTerm.TrialZoneMs) is double e && hud.Term(HudTerm.TrialDealtMult) is double f)
                        value = Fmt(e / 1000) + "s zone · " + Fmt((1 - f) * 100) + "% less dealt";
                    if (hud?.Term(HudTerm.TrialMoveMult) is double g && hud.Term(HudTerm.TrialTakenMult) is double h && hud.Term(HudTerm.TrialExitStunMs) is double i)
                        scaling = Fmt((1 - g) * 100) + "% slower · +" + Fmt((h - 1) * 100) + "% taken · " + Fmt(i / 1000) + "s exit stun";
                    break;
                case FactionId.Fire:
                    name = "Blaze Step";
                    if (hud?.Term(HudTerm.BlazeBurnDps) is double j && hud.Term(HudTerm.BlazeBurnMs) is double k)
                        value = Raw(j) + " true DPS · " + Fmt(k / 1000) + "s trail";
                    if (hud?.Term(HudTerm.BlazeMinDist) is double l && hud.Term(HudTerm.BlazeMaxDist) is double m)
                        scaling = Raw(l) + "–" + Raw(m) + " blink · fixed damage";
                    break;
                case FactionId.Holy:
                    name = "Last Stand";
                    if (hud?.Term(HudTerm.LastStandMs) is double n && hud.Term(HudTerm.LastStandSpeedBonus) is double o)
                        value = Fmt(n / 1000) + "s floor at 1 HP · +" + Fmt(o * 100) + "% move";
                    if (hud?.Term(HudTerm.LastStandHealShare) is double p)
                        scaling = Fmt(p * 100) + "% of held damage healed back";
                    break;
                default:
                    name = "Wish";
                    break;
            }
            return new ChampionRow(name, value, scaling, "");
        }

        /// <summary>P-UNITY-WISH-TEXT-1 (stub): the name a Wish is shown under in the match HUD (the card's "R · Name", "Casting Name"): the
        /// ability's enum name, except Frost's Wish (<see cref="AbilityId.Freeze"/>) under a block that says <see cref="FrostWishKind.Wall"/>.</summary>
        public static string WishName(WireHudContent hud, AbilityId ability)
        {
            return ability.ToString();
        }

        /// <summary>P-UNITY-WISH-TEXT-1 (stub): the Wish slot tooltip's extra lines for a faction's Wish, joined by a newline; "" when it has none.</summary>
        public static string WishTip(WireHudContent hud, FactionId faction)
        {
            return "";
        }

        /// <summary>The Fire roam sentence (championCombatModel.ts:114-116 <c>fireRoamText</c>, without its leading space) for Fire; "" for other
        /// factions or when panel codes 8, 9, 23, 24 or terms 19-22 are missing.</summary>
        public static string FireRoam(WireBuildSummary summary, WireHudContent hud, FactionId faction)
        {
            if (faction != FactionId.Fire) return "";
            if (!(Panel(summary, 8) is double charge) || !(Panel(summary, 9) is double armed) || !(Panel(summary, 23) is double speed) || !(Panel(summary, 24) is double burst)) return "";
            if (!(hud?.Term(HudTerm.FireRoamRampMs) is double ramp) || !(hud.Term(HudTerm.FireRoamChargeMax) is double max)
                || !(hud.Term(HudTerm.FireRoamBurstBase) is double baseDmg) || !(hud.Term(HudTerm.FireRoamBurstAdShare) is double share)) return "";
            string state = armed != 0 ? "armed" : Fmt(Math.Min(max, Math.Max(0, charge))) + "/" + Raw(max) + " charged";
            return "Fire Roam is " + state + " (" + Fmt(speed * 100) + "% move speed); after " + Fmt(ramp / 1000) + " s out of combat, the next landed basic attack adds "
                + Fmt(burst) + " physical (" + Raw(baseDmg) + " + " + Fmt(share) + "× Offense). Incoming damage resets partial charge but does not cancel an already armed burst; Defense mitigates the burst.";
        }

        /// <summary>The auto row's whole tooltip (championCombatModel.ts:126-129), each sentence left out when its numbers are not delivered:
        /// the per-hit parts, the attack-speed mirror (<paramref name="asMilli"/>, <c>WireOwnerCombat.AsMilli</c>, 1000 = 1x), the weapon scaling
        /// with its hit multiplier, the fixed "excludes" sentence, then <see cref="FireRoam"/>. Sentences are joined by one space.</summary>
        public static string AutoTooltip(WireBuildSummary summary, WireHudContent hud, FactionId faction, WeaponId weapon, double? asMilli)
        {
            var parts = new List<string>();
            string detail = ChampionPanelText.Rows(summary, faction, weapon).Auto.Detail;
            if (detail.Length > 0) parts.Add(detail);
            if (asMilli is double mirror) parts.Add("Attack rate uses your current attack-speed mirror (" + Fmt(mirror / 1000) + "×) and this weapon's interval.");
            string terms = AutoScaling(hud, weapon);
            if (terms.Length > 0 && Panel(summary, 26) is double phys && Panel(summary, 27) is double magic && Panel(summary, 25) is double hit)
                parts.Add("Weapon scaling (" + terms + ") adds " + Fmt(phys) + " physical and " + Fmt(magic) + " magic before the " + Fmt(hit) + "× hit multiplier.");
            parts.Add(Excludes);
            string roam = FireRoam(summary, hud, faction);
            if (roam.Length > 0) parts.Add(roam);
            return string.Join(" ", parts);
        }

        static void Add(List<KeyValuePair<double, string>> list, double coefficient, string label)
        {
            if (coefficient > 0) list.Add(new KeyValuePair<double, string>(coefficient, label));
        }

        /// <summary>A panel code's value in real units, or null when the summary does not carry it.</summary>
        static double? Panel(WireBuildSummary summary, byte code)
        {
            if (summary?.Panel == null) return null;
            foreach (var v in summary.Panel) if (v.Code == code) return v.Value * Hud.Quantum;
            return null;
        }

        /// <summary>buildModel.ts:195 scale: one decimal, two when the second matters.</summary>
        static string Scale(double v)
        {
            return Math.Abs(v * 10 - Math.Floor(v * 10 + .5)) < 1e-9 ? v.ToString("F1", CultureInfo.InvariantCulture) : v.ToString("F2", CultureInfo.InvariantCulture);
        }

        /// <summary>championCombatModel.ts:74 fmt: Math.round(n * 100) / 100 without trailing zeros (JS round is floor(x + 0.5)).</summary>
        static string Fmt(double n)
        {
            if (double.IsNaN(n) || double.IsInfinity(n)) return "";
            double r = Math.Floor(n * 100 + .5);
            bool neg = r < 0;
            long a = (long)Math.Abs(r);
            long whole = a / 100, frac = a % 100;
            string f = frac == 0 ? "" : frac.ToString(CultureInfo.InvariantCulture).PadLeft(2, '0').TrimEnd('0');
            return (neg && a != 0 ? "-" : "") + whole.ToString(CultureInfo.InvariantCulture) + (f.Length > 0 ? "." + f : "");
        }

        /// <summary>A number printed as JS prints it with `${n}` (radius and distance terms are whole numbers or short decimals).</summary>
        static string Raw(double n) { return n.ToString("0.####", CultureInfo.InvariantCulture); }
    }
}
