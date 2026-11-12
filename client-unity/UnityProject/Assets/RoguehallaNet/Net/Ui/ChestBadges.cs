using System;
using System.Collections.Generic;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Ui
{
    /// <summary>One reward chest's badge on a map: where it stands, its remaining whole seconds, and the camp whose respawn clock it
    /// replaces (-1 when it stands at no camp). Index is the chest's position in the delivered rows.</summary>
    public struct ChestBadgeRow
    {
        public int Index;
        public double WorldX, WorldY;
        public string Text;
        public int CampIndex;
    }

    /// <summary>Pure reward chest badge model for the minimap and Tab map (legacy minimapMarkers.ts:56-71, RaidScene.ts:1100-1114).
    /// The world ring and its seconds are WorldIndicators / WorldIndicatorRules, not this model. Presentation only.</summary>
    public static class ChestBadges
    {
        /// <summary>A chest belongs to the camp whose map position is strictly closer than this many world units (minimapMarkers.ts:70).</summary>
        public const double CampReach = 1.0;

        /// <summary>Whole seconds left (ceil), as bare digits; null when the chest is gone (expiry at or before now).</summary>
        public static string Seconds(double expiresAtMs, double serverNowMs) => null;

        /// <summary>Index of the camp whose position is within <see cref="CampReach"/> of (x, y), nearest first; -1 for none.</summary>
        public static int CampOf(MapCamp[] camps, double x, double y) => -1;

        /// <summary>Clears <paramref name="into"/> and fills one badge per live chest on <paramref name="surface"/> (Minimap, TabMap; World gives none).
        /// <paramref name="canSee"/> (world x, y) applies to the Minimap only; null means every chest is visible.</summary>
        public static void Rows(MapCamp[] camps, IReadOnlyList<RewardChestView> chests, double serverNowMs, CampSurface surface,
            Func<double, double, bool> canSee, List<ChestBadgeRow> into)
        {
        }

        /// <summary>True when one of <paramref name="rows"/> stands at camp <paramref name="campIndex"/>: that camp's respawn clock is not drawn.</summary>
        public static bool Replaces(IReadOnlyList<ChestBadgeRow> rows, int campIndex) => false;
    }
}
