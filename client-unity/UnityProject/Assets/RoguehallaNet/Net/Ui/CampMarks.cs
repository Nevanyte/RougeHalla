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
                    countdown = Seconds(r.RespawnAt, serverNowMs).ToString(System.Globalization.CultureInfo.InvariantCulture);
                into.Add(new CampMarkRow
                {
                    Index = i, WorldX = camps[i].X, WorldY = camps[i].Y, Zone = camps[i].Zone,
                    Elite = r.Elite != null, State = state, Countdown = countdown,
                });
            }
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
                        ? "RESPAWN " + Seconds(r.RespawnAt, serverNowMs).ToString(System.Globalization.CultureInfo.InvariantCulture) + "s"
                        : "RESPAWN READY",
                });
            }
        }
    }
}
