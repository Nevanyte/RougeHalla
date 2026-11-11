using System.Collections.Generic;

namespace Roguehalla.Net.Ui
{
    /// <summary>The timed statuses legacy StatusArt.ts draws (LAYERS, :37-50), in its draw order. One per EFFECT_* bit that has art; hidden and the spare bits have none.</summary>
    public enum StatusKind : byte { Root, Zoned, Casting, LastStand, Untargetable, Haste, Slow, Dot, Stun, Silence, AttackSlow, AntiHeal }

    /// <summary>Whether the art is drawn under the body or over it. Legacy has one Graphics over the body, weapon and hp bar (PlayerView.ts:194, MobView.ts:120), so every status is FrontOfBody.</summary>
    public enum StatusDepth : byte { BehindBody, FrontOfBody }

    /// <summary>
    /// Where one status is drawn, in the OverheadStack convention: legacy px at zoom 1, y UP from the feet, X the centre, Y the BOTTOM edge,
    /// W/H the envelope of the art (stroke widths ignored). <see cref="OverheadStack.ToUnits"/> converts it.
    /// </summary>
    public struct StatusAnchor
    {
        public StatusKind Kind; public float X, Y, W, H; public StatusDepth Depth;
        public int Order;   // position in legacy draw order; later draws over earlier
    }

    /// <summary>Legacy StatusArt.ts placement per status and actor kind (docs/backlog/packets/P-UNITY-OVERHEAD-2.md). Pure.</summary>
    public static class StatusAnchors
    {
        // Legacy StatusArt.ts, px up from the feet: X centre, Y bottom, W, H. Indexed by StatusKind (= LAYERS order, :37-50).
        static readonly float[][] Table =
        {
            new[] { 0f, -13.6f, 34f, 13.6f },      // Root :139-147
            new[] { 0f, -17.6f, 44f, 35.2f },      // Zoned :170-185
            new[] { 0f, -5f, 38f, 38f },           // Casting :187-191
            new[] { 0f, -4f, 36f, 36f },           // LastStand :193-199
            new[] { 0f, -1.5f, 31f, 31f },         // Untargetable :201-210
            new[] { 0f, 8f, 66f, 12f },            // Haste :212-222
            new[] { -23f, -1f, 18f, 22f },         // Slow :224-232
            new[] { 0f, 7f, 25.6f, 22.95f },       // Dot :234-244
            new[] { 0f, 29.5f, 33f, 15f },         // Stun :255-266
            new[] { 21f, 19.2f, 11.6f, 11.6f },    // Silence :268-276
            new[] { -21f, 19.2f, 11.6f, 11.6f },   // AttackSlow :278-288
            new[] { -23f, 33f, 10f, 10f },         // AntiHeal :290-296 (X follows the bar half-width)
        };

        // Effects bit per kind, in the same order.
        static readonly ushort[] Bits =
        {
            Indicators.Rooted, Indicators.Zoned, Indicators.Casting, Indicators.LastStand, Indicators.Untargetable, Indicators.Haste,
            Indicators.Slowed, Indicators.Dot, Indicators.Stunned, Indicators.Silenced, Indicators.AttackSlowed, Indicators.AntiHeal,
        };

        /// <summary>False for a kind with no art (an unknown value).</summary>
        public static bool TryGet(StatusKind kind, OverheadActorKind actor, out StatusAnchor anchor)
        {
            int i = (int)kind;
            if (i < 0 || i >= Table.Length) { anchor = default(StatusAnchor); return false; }
            var t = Table[i];
            float x = t[0];
            if (kind == StatusKind.AntiHeal) x = -((actor == OverheadActorKind.Player ? 14f : 18f) + 9f);   // PlayerView.ts:154, MobView.ts:19,96
            anchor = new StatusAnchor { Kind = kind, X = x, Y = t[1], W = t[2], H = t[3], Depth = StatusDepth.FrontOfBody, Order = i };
            return true;
        }

        /// <summary>Clears <paramref name="into"/> and adds an anchor for each drawn bit of <paramref name="effects"/>, in legacy draw order. Hidden and unknown bits add nothing.</summary>
        public static int Build(ushort effects, OverheadActorKind actor, List<StatusAnchor> into)
        {
            into.Clear();
            for (int i = 0; i < Bits.Length; i++)
                if ((effects & Bits[i]) != 0 && TryGet((StatusKind)i, actor, out var a)) into.Add(a);
            return into.Count;
        }
    }
}
