using System.Collections.Generic;
using System.Globalization;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Ui
{
    /// <summary>One GAINED cell: the short label, the formatted value, and whether legacy greys it (value is zero).</summary>
    public readonly struct BuildCell
    {
        public readonly string Label, Value;
        public readonly bool Dim;
        public BuildCell(string label, string value, bool dim) { Label = label; Value = value; Dim = dim; }
    }

    /// <summary>One "Normal mob progress" row: "Ember Imp ×5" and the cumulative reward "+5% damage".</summary>
    public readonly struct MobBonusLine
    {
        public readonly string Label, Total;
        public MobBonusLine(string label, string total) { Label = label; Total = total; }
    }

    /// <summary>
    /// Pure text for the GAINED strip and the mob-bonus row from the owner's build summary (P-UNITY-HUD-BUILD-1).
    /// Legacy: ui/buildHud.ts, ui/buildModel.ts buildGains, ui/mobStatsHud.ts, shared/mobStats.ts mobStatText.
    /// </summary>
    public static class BuildHudText
    {
        public const string StripTitle = "Gained";
        public const string NoMobBonuses = "No normal-mob bonuses yet";

        static readonly string[] CellLabels =
            { "Offense", "SO", "Damage gained", "Attack speed", "Life steal", "Health gained", "Defense", "Soul Defense", "Move speed" };
        // Wire stat codes 0-8: Offense, SO, Damage, Attack speed, Life steal, Health, Defense, Soul Defense, Move speed.
        static readonly bool[] CellIsPercent = { false, false, true, true, true, false, false, false, true };
        // Mob rows: max health (stat 5) is a percent bonus there, unlike the Health gained cell.
        static readonly bool[] MobIsPercent = { false, false, true, true, true, true, false, false, true };
        static readonly string[] MobSuffix =
            { "Offense", "Soul Offence", "damage", "attack speed", "lifesteal", "max health", "Defense", "Soul Defense", "move speed" };
        static readonly string[] MobNames =
        {
            "Ember Imp", "Cinder Hound", "Magma Brute", "Flame Caller", "Wyrmling", "Ash Drake",
            "Bailiff", "Chain Warden", "Inquisitor", "Pardoner", "Executioner", "Gaoler",
            "Plague Rat", "Bloatfly", "Rot Monk", "Miasma Witch", "Rat Ogre", "Pox Behemoth",
            "Frost Wisp", "Ice Golem", "Rime Stalker", "Frostbow Sentry", "Glacial Warden", "Avalanche Troll",
            "Acolyte", "Seraph Shard", "Penitent", "Zealot", "Blood Saint", "Archon",
        };

        /// <summary>The nine cells in legacy order; empty when <paramref name="summary"/> is null (strip not shown yet).</summary>
        public static IReadOnlyList<BuildCell> Cells(WireBuildSummary summary)
        {
            var cells = new List<BuildCell>();
            if (summary == null) return cells;
            for (int i = 0; i < 9; i++)
            {
                int raw = i < summary.Gains.Length ? summary.Gains[i] : 0;
                string value;
                if (CellIsPercent[i]) value = (raw > 0 ? "+" : "") + Scaled(raw, 100, 2, false) + "%";
                else
                {
                    // num(): one decimal, half up (JS Math.round), then signed(); a rounded -0 reads "+0".
                    long tenths = FloorDiv((long)raw + 500, 1000);
                    string num = Scaled(tenths < 0 ? -tenths : tenths, 10, 1, false);
                    value = i == 5 ? "+" + (tenths < 0 ? "-" : "") + num : (tenths < 0 ? "-" : "+") + num;
                }
                cells.Add(new BuildCell(CellLabels[i], value, raw == 0));
            }
            return cells;
        }

        /// <summary>One line per farmed mob type in arrival order; the single <see cref="NoMobBonuses"/> line for an empty
        /// table; nothing for a null summary.</summary>
        public static IReadOnlyList<MobBonusLine> MobLines(WireBuildSummary summary)
        {
            var lines = new List<MobBonusLine>();
            if (summary == null) return lines;
            if (summary.MobRows == null || summary.MobRows.Length == 0)
            {
                lines.Add(new MobBonusLine(NoMobBonuses, ""));
                return lines;
            }
            foreach (var row in summary.MobRows)
            {
                string name = row.MobType < MobNames.Length ? MobNames[row.MobType] : "Mob " + row.MobType;
                int stat = row.Stat < 9 ? row.Stat : 0;
                string amount = MobIsPercent[stat]
                    ? Scaled(row.Total, 100, 2, true) + "%"
                    : Scaled(row.Total, 10000, 4, false);
                lines.Add(new MobBonusLine(name + " \u00d7" + row.Stacks.ToString(CultureInfo.InvariantCulture),
                    "+" + amount + " " + MobSuffix[stat]));
            }
            return lines;
        }

        static long FloorDiv(long a, long b) { long q = a / b; return (a % b != 0 && (a < 0) != (b < 0)) ? q - 1 : q; }

        /// <summary>raw / divisor with at most <paramref name="decimals"/> decimals, trailing zeros dropped, optional
        /// en-US thousands separators; integer arithmetic so nothing rounds.</summary>
        static string Scaled(long raw, long divisor, int decimals, bool group)
        {
            bool neg = raw < 0;
            long a = neg ? -raw : raw;
            long whole = a / divisor, frac = a % divisor;
            string w = group ? whole.ToString("N0", CultureInfo.GetCultureInfo("en-US")) : whole.ToString(CultureInfo.InvariantCulture);
            string f = frac == 0 ? "" : frac.ToString(CultureInfo.InvariantCulture).PadLeft(decimals, '0').TrimEnd('0');
            return (neg ? "-" : "") + w + (f.Length > 0 ? "." + f : "");
        }
    }
}
