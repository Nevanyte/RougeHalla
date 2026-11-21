using System;
using System.Collections.Generic;
using System.Globalization;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    /// <summary>Formats the viewer's own native readout rows (State key 14) for the HUD. Presentation only: it never computes a cap.</summary>
    public static class NativeReadoutText
    {
        public readonly struct Line
        {
            public readonly byte Card, Kind;
            public readonly string Title, Text;
            /// <summary>value / max in 0..1, 0 when max is 0.</summary>
            public readonly float Fill;
            /// <summary>Marks rows: the number of pips (max) and how many are lit (value); 0 and 0 for other rows.</summary>
            public readonly int Pips, PipsOn;
            public Line(byte card, byte kind, string title, string text, float fill, int pips, int pipsOn)
            { Card = card; Kind = kind; Title = title; Text = text; Fill = fill; Pips = pips; PipsOn = pipsOn; }
        }

        const byte HazardWalker = 86;
        static readonly string[] HazardMeters = { "ember", "bog", "ice" };

        static string N(double v, string fmt) { return v.ToString(fmt, CultureInfo.InvariantCulture); }

        // Share cards hold fractions shown as percent: Tally 80, Pathfinder 85, Wish Engine 87, Corpse Hoarder 89, Trophy Hunter 92.
        static bool IsShare(byte card) { return card == 80 || card == 85 || card == 87 || card == 89 || card == 92; }

        public static Line[] Lines(IReadOnlyList<WireReadout> rows)
        {
            var list = new List<Line>();
            if (rows == null) return list.ToArray();
            int hazardMeter = 0; // Hazard Walker's meter rows arrive in order: ember, bog, ice
            for (int i = 0; i < rows.Count; i++)
            {
                var r = rows[i];
                if (r.Card < 80 || r.Card > 93) continue;
                string title = CardDisplayCatalog.Get(r.Card).Title;
                float fill = r.Max > 0 ? (float)Math.Max(0d, Math.Min(1d, r.Value / r.Max)) : 0f;
                string text;
                int pips = 0, on = 0;
                if (r.Kind == 2)
                {
                    pips = (int)r.Max; on = (int)r.Value;
                    text = title + " " + N(r.Value, "0.##") + "/" + N(r.Max, "0.##");
                }
                else if (r.Kind == 1 && r.Card == HazardWalker)
                {
                    string name = hazardMeter < HazardMeters.Length ? HazardMeters[hazardMeter] : "";
                    hazardMeter++;
                    text = title + " " + name + " " + N(r.Value / 1000d, "0.#") + "/" + N(r.Max / 1000d, "0.#") + " s";
                }
                else if (r.Kind == 0 && IsShare(r.Card))
                    text = title + " " + N(r.Value * 100d, "0.##") + "% / " + N(r.Max * 100d, "0.##") + "%";
                else
                    text = title + " " + N(r.Value, "0.##") + "/" + N(r.Max, "0.##");
                list.Add(new Line(r.Card, r.Kind, title, text, fill, pips, on));
            }
            return list.ToArray();
        }
    }
}
