// P-UNITY-FROST-WALL-1: what the Wish key, the mouse buttons and Esc do while Frost's Wish is a placed wall (legacy 78dd8bd4
// RaidScene.ts castSlot, pointerdown, Escape, updateAimPreview; the brief's F5 table). Engine-free: MatchClient forwards its
// input here, and every cast leaves through Session.CollectWishInput. STUB: today's behaviour (the key casts at once).
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

        /// <summary>The Wish key. Returns the cast's order number, 0 when nothing was sent. STUB: casts as today.</summary>
        public byte Key(Session session, in WishAimFrame f)
        {
            return session.CollectWishInput(true, f.UiOwnsInput, f.HasGroundPoint, f.CursorX, f.CursorY, f.ActorRef);
        }

        /// <summary>A left click. <paramref name="consumed"/>: the click belonged to the aim (no attack). Returns the cast's
        /// order number, 0 when nothing was sent. STUB.</summary>
        public byte Click(Session session, in WishAimFrame f, out bool consumed)
        {
            consumed = false;
            return 0;
        }

        /// <summary>A right click: puts the preview away (the caller still sends its move). STUB.</summary>
        public void RightClick() { }

        /// <summary>Esc: true when it put the preview away (consumed). STUB.</summary>
        public bool Escape() { return false; }

        /// <summary>Once per frame: puts the preview away when it can no longer be cast. STUB.</summary>
        public void Frame(Session session, in WishAimFrame f) { }
    }
}
