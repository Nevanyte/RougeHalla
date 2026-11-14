// P-UNITY-FROST-WALL-1: what the Wish key, the mouse buttons and Esc do while Frost's Wish is a placed wall (legacy 78dd8bd4
// RaidScene.ts castSlot, pointerdown, Escape, updateAimPreview; the brief's F5 table). Engine-free: MatchClient forwards its
// input here, and every cast leaves through Session.CollectWishInput.
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Ui
{
    /// <summary>One frame's inputs to <see cref="WishAim"/>.</summary>
    public struct WishAimFrame
    {
        /// <summary>Which Wish Frost has in this room (the Welcome's term 23).</summary>
        public FrostWishKind Wish;
        /// <summary>The Quick cast setting.</summary>
        public bool QuickCast;
        /// <summary>A panel owns the pointer (MatchClient's <c>blocked</c>).</summary>
        public bool UiOwnsInput;
        /// <summary>The cursor has a ground point (MatchClient's <c>haveCursor</c>).</summary>
        public bool HasGroundPoint;
        public float CursorX, CursorY;
        /// <summary>The visible actor under the cursor (sent with a Freeze cast only).</summary>
        public uint? ActorRef;
        /// <summary>The local fighter's drawn (predicted) position and facing (radians).</summary>
        public float CasterX, CasterY, Facing;
        /// <summary>The wall's numbers from the Welcome; null when it carried none.</summary>
        public FrostWallNumbers? Numbers;
    }

    public sealed class WishAim
    {
        /// <summary>The preview is up.</summary>
        public bool Aiming { get; private set; }

        /// <summary>The Wish key. Returns the cast's order number, 0 when nothing was sent.</summary>
        public byte Key(Session session, in WishAimFrame f)
        {
            if (f.Wish != FrostWishKind.Wall || !f.Numbers.HasValue)
            {
                Aiming = false;
                return session.CollectWishInput(true, f.UiOwnsInput, f.HasGroundPoint, f.CursorX, f.CursorY, f.ActorRef);
            }
            if (Aiming) { Aiming = false; return 0; }
            if (!f.QuickCast)
            {
                // Opens only when a cast could leave (the lifecycle gates of CollectWishInput); no ground point needed.
                Aiming = !f.UiOwnsInput && CanCast(session);
                return 0;
            }
            return CastAtCentre(session, f);
        }

        /// <summary>A left click. <paramref name="consumed"/>: the click belonged to the aim (no attack). Returns the cast's
        /// order number, 0 when nothing was sent.</summary>
        public byte Click(Session session, in WishAimFrame f, out bool consumed)
        {
            consumed = Aiming;
            if (!Aiming) return 0;
            Aiming = false;
            return f.Numbers.HasValue ? CastAtCentre(session, f) : (byte)0;
        }

        /// <summary>A right click: puts the preview away (the caller still sends its move).</summary>
        public void RightClick() { Aiming = false; }

        /// <summary>Esc: true when it put the preview away (consumed).</summary>
        public bool Escape()
        {
            if (!Aiming) return false;
            Aiming = false;
            return true;
        }

        /// <summary>Once per frame: puts the preview away when it can no longer be cast.</summary>
        public void Frame(Session session, in WishAimFrame f)
        {
            if (Aiming && (f.Wish != FrostWishKind.Wall || !CanCast(session))) Aiming = false;
        }

        static bool CanCast(Session s)
        {
            return s.State == SessionState.InMatch && s.Latest != null && s.Latest.Phase == 1 && s.Me != null && s.Me.Status == ActorStatus.Alive;
        }

        static byte CastAtCentre(Session session, in WishAimFrame f)
        {
            // Legacy castSlot: with no cursor ground point a placed cast is denied ("Aim with the cursor") and sends nothing.
            if (!f.HasGroundPoint) return 0;
            var n = f.Numbers.Value;
            var seg = FrostWallAim.SegmentFor(f.CasterX, f.CasterY, f.CursorX, f.CursorY, n.Range, n.MinRange, n.Length, f.Facing);
            return session.CollectWishInput(true, f.UiOwnsInput, f.HasGroundPoint, (float)seg.Cx, (float)seg.Cy, null);
        }
    }
}
