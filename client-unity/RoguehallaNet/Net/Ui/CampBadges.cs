using System;
using System.Collections.Generic;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Ui
{
    /// <summary>Where a camp reward badge is drawn. Legacy shows it in the world (icon only) and on the Tab map (icon and amount);
    /// the minimap badge is owner direction, not legacy (P-UNITY-HUD-CAMPS-2, "Legacy rules as verified").</summary>
    public enum CampSurface : byte { Minimap = 0, TabMap = 1, World = 2 }

    /// <summary>One camp's reward badge. IconKey is a legacy combat-icon key ("ad", "ap", "damage", "health", "attackSpeed", "armor",
    /// "mr", "speed", "leech"), null when the camp has no stat reward. AmountText ("+3%", "+3.75") is set on the Tab map only.
    /// The elite part is the second badge of an elite camp (world: the "ap" icon; Tab map: the "chest" glyph with "Aug").</summary>
    public struct CampBadgeRow
    {
        public int Index;
        public double WorldX, WorldY;
        public string IconKey;
        public uint IconRgb;
        public string AmountText;
        public string EliteIconKey;
        public uint EliteIconRgb;
        public string EliteText;
    }

    /// <summary>One camp's live ward beacon. Look is Yours or Other (never None). WorldText is "YOUR WARD 90s" / "WARD 90s";
    /// Countdown is the bare whole seconds for the maps.</summary>
    public struct CampWardRow
    {
        public int Index;
        public double WorldX, WorldY;
        public WardVerdict Look;
        public uint BeaconRgb, TextRgb;
        public string WorldText;
        public string Countdown;
    }

    /// <summary>Pure camp reward badge and ward beacon model (legacy CampBuffs.ts, CampWards.ts, planning.ts). Presentation only.</summary>
    public static class CampBadges
    {
        /// <summary>The wire's per-stack amount is shown per kill: legacy MOB_KILL_STACKS (mobStats.ts:11) stacks per credited kill.</summary>
        public const int KillStacks = 3;

        /// <summary>Legacy combat-icon key for a HUD stat code (mobRewardIcon / rewardIconFor); any unknown code reads "damage".</summary>
        public static string IconKey(byte stat) => null;

        /// <summary>Legacy STAT_ICON_COLORS (RGB) of the icon for a HUD stat code.</summary>
        public static uint IconRgb(byte stat) => 0;

        /// <summary>The per-kill amount text ("+3%", "+0.75%", "+3.75"): percent stats (codes 2,3,4,5,8) as percent with at most two
        /// decimals, flat stats (0,1,6,7) as points.</summary>
        public static string AmountText(WireCampReward reward) => null;

        /// <summary>Clears <paramref name="into"/> and fills one badge per camp that shows one on <paramref name="surface"/>.
        /// <paramref name="canSee"/> (world x, y) applies to the World surface only; null means every camp is visible.</summary>
        public static void Rewards(MapCamp[] camps, IReadOnlyList<CampView> rows, bool active, CampSurface surface,
            Func<double, double, bool> canSee, List<CampBadgeRow> into)
        {
            into.Clear();
        }

        /// <summary>Clears <paramref name="into"/> and fills one beacon per camp with a live ward (verdict not None and now before expiry).</summary>
        public static void Wards(MapCamp[] camps, IReadOnlyList<CampView> rows, double serverNowMs, bool active, List<CampWardRow> into)
        {
            into.Clear();
        }
    }
}
