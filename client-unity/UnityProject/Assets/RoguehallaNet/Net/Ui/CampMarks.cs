using System.Collections.Generic;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Ui
{
    /// <summary>Legacy camp state (RaidState.camps[i].state): 0 idle, 1 engaged (somebody fought there; sticky history), 2 cleared.</summary>
    public enum CampMarkState : byte { Idle = 0, Engaged = 1, Cleared = 2 }

    /// <summary>One camp marker for the minimap and Tab map. Countdown is null when no clock is shown.</summary>
    public struct CampMarkRow
    {
        public int Index;
        public double WorldX, WorldY;
        public byte Zone;
        public bool Elite;
        public CampMarkState State;
        public string Countdown;
    }

    /// <summary>
    /// One camp's single map glyph (P-UNITY-DECLUTTER-1, owner direction 2026-11-12, DEV-022): the icon of the buff its kills pay, in the stat colour.
    /// IconKey is null when the camp row has no delivered reward; the map then draws a neutral dot in <see cref="CampMarks.NeutralRgb"/>.
    /// Elite is the one elite marker of an elite camp; EliteText is "Aug" on the Tab map only. Dim is a cleared camp (dimmed glyph).
    /// Clock is the bare respawn seconds of a cleared camp while the match is active (null otherwise). Engaged is the "someone has fought
    /// here" ring: Tab map only, never on a cleared camp. AmountText ("+3%") is Tab map only. There is no zone shape: the map tint says the zone.
    /// </summary>
    public struct CampGlyphRow
    {
        public int Index;
        public double WorldX, WorldY;
        public byte Zone;
        public string IconKey;
        public uint IconRgb;
        public string AmountText;
        public bool Elite;
        public string EliteText;
        public bool Dim;
        public string Clock;
        public bool Engaged;
    }

    /// <summary>The "RESPAWN Ns" / "RESPAWN READY" text in the world at a cleared camp.</summary>
    public struct CampWorldLabel
    {
        public int Index;
        public double WorldX, WorldY;
        public string Text;
    }

    /// <summary>Pure camp model: map camp list + camp state rows + server time to marker and world-label rows. Presentation only.</summary>
    public static class CampMarks
    {
        /// <summary>Clears <paramref name="into"/> and fills one marker per camp. No markers when the row count differs from the map's camp count.</summary>
        public static void Markers(MapCamp[] camps, IReadOnlyList<CampView> rows, double serverNowMs, bool active, List<CampMarkRow> into)
        {
            into.Clear();
            if (camps == null || rows == null || rows.Count != camps.Length) return;
            for (int i = 0; i < camps.Length; i++)
            {
                var r = rows[i];
                var state = r.State == 1 ? CampMarkState.Engaged : r.State == 2 ? CampMarkState.Cleared : CampMarkState.Idle;
                string countdown = null;
                if (active && state == CampMarkState.Cleared && r.RespawnAt > 0)
                    countdown = Digits(Seconds(r.RespawnAt, serverNowMs));
                into.Add(new CampMarkRow
                {
                    Index = i, WorldX = camps[i].X, WorldY = camps[i].Y, Zone = camps[i].Zone,
                    Elite = r.Elite != null, State = state, Countdown = countdown,
                });
            }
        }

        /// <summary>Colour of the neutral dot drawn for a camp row with no delivered reward (RGB; the camp clock's grey-blue).</summary>
        public const uint NeutralRgb = 0xb4c9dc;

        /// <summary>
        /// Clears <paramref name="into"/> and fills the one glyph of every camp for the Minimap or TabMap surface (the World surface gets none).
        /// No rows when the row count differs from the map's camp count. Replaces <see cref="Markers"/> and the camp part of
        /// <see cref="CampBadges.Rewards"/> in the map layer. STUB: fills nothing yet.
        /// </summary>
        public static void Glyphs(MapCamp[] camps, IReadOnlyList<CampView> rows, double serverNowMs, bool active, CampSurface surface, List<CampGlyphRow> into)
        {
            into.Clear();
        }

        const int CacheCap = 1024;
        static readonly string[] DigitCache = new string[CacheCap], RespawnCache = new string[CacheCap];

        /// <summary>Cached whole-second text, so a steady presentation allocates nothing; above the cap it formats.</summary>
        static string Digits(long s)
        {
            if (s >= CacheCap) return s.ToString(System.Globalization.CultureInfo.InvariantCulture);
            return DigitCache[s] ?? (DigitCache[s] = s.ToString(System.Globalization.CultureInfo.InvariantCulture));
        }

        static string Respawn(long s)
        {
            if (s >= CacheCap) return "RESPAWN " + Digits(s) + "s";
            return RespawnCache[s] ?? (RespawnCache[s] = "RESPAWN " + Digits(s) + "s");
        }

        static long Seconds(double respawnAt, double now)
        {
            double s = System.Math.Ceiling((respawnAt - now) / 1000.0);
            return s < 0 ? 0 : (long)s;
        }

        /// <summary>Clears <paramref name="into"/> and fills one label per cleared camp that has a respawn time.</summary>
        public static void WorldLabels(MapCamp[] camps, IReadOnlyList<CampView> rows, double serverNowMs, bool active, List<CampWorldLabel> into)
        {
            into.Clear();
            if (!active || camps == null || rows == null || rows.Count != camps.Length) return;
            for (int i = 0; i < camps.Length; i++)
            {
                var r = rows[i];
                if (r.State != 2 || !(r.RespawnAt > 0)) continue;
                into.Add(new CampWorldLabel
                {
                    Index = i, WorldX = camps[i].X, WorldY = camps[i].Y,
                    Text = r.RespawnAt > serverNowMs
                        ? Respawn(Seconds(r.RespawnAt, serverNowMs))
                        : "RESPAWN READY",
                });
            }
        }
    }
}
