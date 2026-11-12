using System.Collections.Generic;
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

        /// <summary>The nine cells in legacy order; empty when <paramref name="summary"/> is null (strip not shown yet).</summary>
        public static IReadOnlyList<BuildCell> Cells(WireBuildSummary summary) => new List<BuildCell>();

        /// <summary>One line per farmed mob type in arrival order; the single <see cref="NoMobBonuses"/> line for an empty
        /// table; nothing for a null summary.</summary>
        public static IReadOnlyList<MobBonusLine> MobLines(WireBuildSummary summary) => new List<MobBonusLine>();
    }
}
