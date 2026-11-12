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
        public static string IconKey(byte stat) => stat < Keys.Length ? Keys[stat] : "damage";

        static readonly string[] Keys = { "ad", "ap", "damage", "attackSpeed", "leech", "health", "armor", "mr", "speed" };
        static readonly uint[] Rgbs = { 0xffb074, 0xc4a0ff, 0xffd36a, 0xffdc78, 0xf05260, 0x62d889, 0xd5e0e8, 0x75cfff, 0x80d6ff };
        const uint ApRgb = 0xc4a0ff;

        /// <summary>Legacy STAT_ICON_COLORS (RGB) of the icon for a HUD stat code.</summary>
        public static uint IconRgb(byte stat) => stat < Rgbs.Length ? Rgbs[stat] : 0xffd36a;

        static readonly Dictionary<int, string> AmountCache = new Dictionary<int, string>();

        /// <summary>The per-kill amount text ("+3%", "+0.75%", "+3.75"): percent stats (codes 2,3,4,5,8) as percent with at most two
        /// decimals, flat stats (0,1,6,7) as points.</summary>
        public static string AmountText(WireCampReward reward)
        {
            int key = reward.Stat << 16 | reward.Amount;
            if (AmountCache.TryGetValue(key, out var cached)) return cached;
            bool percent = reward.Stat == 2 || reward.Stat == 3 || reward.Stat == 4 || reward.Stat == 5 || reward.Stat == 8;
            long total = (long)reward.Amount * KillStacks; // 1e-4 units
            long div = percent ? 100 : 10000;              // percent: hundredths of a percent; flat: 1e-4 points
            long whole = total / div, frac = total % div;
            var sb = new System.Text.StringBuilder("+");
            sb.Append(whole.ToString(System.Globalization.CultureInfo.InvariantCulture));
            if (frac != 0)
            {
                int digits = percent ? 2 : 4;
                string f = frac.ToString(System.Globalization.CultureInfo.InvariantCulture).PadLeft(digits, '0').TrimEnd('0');
                sb.Append('.').Append(f);
            }
            if (percent) sb.Append('%');
            return AmountCache[key] = sb.ToString();
        }

        /// <summary>Clears <paramref name="into"/> and fills one badge per camp that shows one on <paramref name="surface"/>.
        /// <paramref name="canSee"/> (world x, y) applies to the World surface only; null means every camp is visible.</summary>
        public static void Rewards(MapCamp[] camps, IReadOnlyList<CampView> rows, bool active, CampSurface surface,
            Func<double, double, bool> canSee, List<CampBadgeRow> into)
        {
            into.Clear();
            if (camps == null || rows == null || rows.Count != camps.Length) return;
            for (int i = 0; i < camps.Length; i++)
            {
                var r = rows[i];
                bool elite = r.Elite != null;
                if (surface != CampSurface.TabMap)
                {
                    if (!active || r.State == 2) continue;
                    if (surface == CampSurface.World)
                    {
                        if (r.Alive == 0) continue;
                        if (canSee != null && !canSee(camps[i].X, camps[i].Y)) continue;
                    }
                }
                bool reward = r.Reward != null;
                if (surface == CampSurface.Minimap ? !reward : !(reward || elite)) continue;
                var row = new CampBadgeRow { Index = i, WorldX = camps[i].X, WorldY = camps[i].Y };
                if (reward)
                {
                    row.IconKey = IconKey(r.Reward.Value.Stat);
                    row.IconRgb = IconRgb(r.Reward.Value.Stat);
                    if (surface == CampSurface.TabMap) row.AmountText = AmountText(r.Reward.Value);
                }
                if (elite && surface == CampSurface.TabMap) { row.EliteIconKey = "chest"; row.EliteText = "Aug"; }
                else if (elite && surface == CampSurface.World) { row.EliteIconKey = "ap"; row.EliteIconRgb = ApRgb; }
                into.Add(row);
            }
        }

        const int WardCap = 1024;
        static readonly string[] WardDigits = new string[WardCap], WardYours = new string[WardCap], WardOther = new string[WardCap];

        /// <summary>Clears <paramref name="into"/> and fills one beacon per camp with a live ward (verdict not None and now before expiry).</summary>
        public static void Wards(MapCamp[] camps, IReadOnlyList<CampView> rows, double serverNowMs, bool active, List<CampWardRow> into)
        {
            into.Clear();
            if (!active || camps == null || rows == null || rows.Count != camps.Length) return;
            for (int i = 0; i < camps.Length; i++)
            {
                var r = rows[i];
                if (r.Ward == WardVerdict.None || !(serverNowMs < r.WardExpiresAt)) continue;
                long s = (long)Math.Ceiling((r.WardExpiresAt - serverNowMs) / 1000.0);
                bool yours = r.Ward == WardVerdict.Yours;
                string digits, text;
                if (s >= 0 && s < WardCap)
                {
                    digits = WardDigits[s] ?? (WardDigits[s] = s.ToString(System.Globalization.CultureInfo.InvariantCulture));
                    var cache = yours ? WardYours : WardOther;
                    text = cache[s] ?? (cache[s] = (yours ? "YOUR WARD " : "WARD ") + digits + "s");
                }
                else
                {
                    digits = s.ToString(System.Globalization.CultureInfo.InvariantCulture);
                    text = (yours ? "YOUR WARD " : "WARD ") + digits + "s";
                }
                into.Add(new CampWardRow
                {
                    Index = i, WorldX = camps[i].X, WorldY = camps[i].Y, Look = r.Ward,
                    BeaconRgb = yours ? 0x66e4efu : 0x9aa9bdu, TextRgb = yours ? 0x66e4efu : 0xb9c6d7u,
                    WorldText = text, Countdown = digits,
                });
            }
        }
    }
}
