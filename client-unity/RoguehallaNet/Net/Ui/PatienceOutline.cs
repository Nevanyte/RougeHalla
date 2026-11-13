using System.Collections.Generic;

namespace Roguehalla.Net.Ui
{
    /// <summary>One boundary segment of a camp's patience outline, in tile-corner coordinates (multiply by <see cref="PatienceOutline.TileSize"/> for sim units).
    /// Axis aligned and normalised like legacy's segments: X0 &lt;= X1 and Y0 &lt;= Y1.</summary>
    public readonly struct PatienceEdge
    {
        public readonly int X0, Y0, X1, Y1;
        public PatienceEdge(int x0, int y0, int x1, int y1) { X0 = x0; Y0 = y0; X1 = x1; Y1 = y1; }
    }

    /// <summary>The ground outline of a camp's chase limit (W11), from the map's patience plane. Pure; presentation only.
    /// Legacy: packages/client/src/render/CampPatience.ts (see docs/backlog/packets/P-UNITY-WORLD-MARKS-2.md section 3).</summary>
    public static class PatienceOutline
    {
        /// <summary>Sim units per tile (legacy TILE, constants.ts:45).</summary>
        public const int TileSize = 32;
        /// <summary>The one word legacy prints for a camp's range (CampPatience.ts:81): static, no seconds.</summary>
        public const string LabelText = "PATIENCE RANGE";
        /// <summary>Label colour a9f4f5 (CampPatience.ts:81); the dashed line is <see cref="DashRgb"/> (8feef0), not a9f4f5.</summary>
        public const uint LabelRgb = 0xa9f4f5, DashRgb = 0x8feef0, RimRgb = 0x09242a;
        /// <summary>Line styles: dark rim 3 px at alpha .72, then dashes 1.5 px at alpha .82, 9 px on 7 px off (CampPatience.ts:65-77).</summary>
        public const float RimWidth = 3f, RimAlpha = .72f, DashWidth = 1.5f, DashAlpha = .82f, DashOn = 9f, DashOff = 7f;
        /// <summary>The label sits this many screen pixels below the camp centre (CampPatience.ts:81: projY(camp.y) + 25).</summary>
        public const float LabelDropPx = 25f;

        /// <summary>Clears <paramref name="into"/> and fills the edges between camp <paramref name="campRef"/>'s tiles (1-based plane value) and
        /// every other cell, the map's edge counting as "other" (CampPatience.ts:43-52). Each camp is outlined on its own, so an edge shared by two
        /// camps belongs to both outlines. A null plane, a plane whose length is not w * h, a non-positive size or a campRef of 0 gives none and never throws.</summary>
        public static void Edges(byte[] plane, int w, int h, int campRef, List<PatienceEdge> into)
        {
            into.Clear();
            // stub: the implementer builds the edge list.
        }

        /// <summary>Legacy draws a camp's outline and label exactly while the phase is active, the run is not training and the camp has a living mob
        /// (RaidScene.ts:676: <c>state.phase === "active" &amp;&amp; !state.training</c>; CampPatience.ts:93: <c>alive &gt; 0</c>). Nothing about the
        /// local player's position or combat enters.</summary>
        public static bool Visible(MatchPhase? phase, bool training, uint alive)
        {
            return false; // stub
        }
    }
}
