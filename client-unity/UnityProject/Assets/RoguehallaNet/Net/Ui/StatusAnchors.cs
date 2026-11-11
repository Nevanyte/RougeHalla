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
        /// <summary>False for a kind with no art (an unknown value).</summary>
        public static bool TryGet(StatusKind kind, OverheadActorKind actor, out StatusAnchor anchor)
        {
            anchor = default(StatusAnchor);
            return false;   // STUB
        }

        /// <summary>Clears <paramref name="into"/> and adds an anchor for each drawn bit of <paramref name="effects"/>, in legacy draw order. Hidden and unknown bits add nothing.</summary>
        public static int Build(ushort effects, OverheadActorKind actor, List<StatusAnchor> into)
        {
            into.Clear();
            return 0;   // STUB
        }
    }
}
