namespace Roguehalla.Net.Ui
{
    /// <summary>One mob name that is on screen this frame. X, Y and Width share one unit (world or screen); the caller picks it.</summary>
    public struct NameMergeItem
    {
        public uint Id;        // the actor id: the stable key that picks the survivor of a pack (lowest id)
        public string Text;    // the name as drawn
        public float X, Y;     // where the name is anchored
        public float Width;    // how wide the drawn text is, in the same unit as X and Y
        public bool Elite;     // an elite's name is never merged away
    }

    /// <summary>
    /// Which mob names are drawn when mobs of one camp stand together (P-UNITY-HUD-VISUAL-FIX-2). Presentation only; legacy draws every
    /// name. Player names are never passed in. Stub: the implementer fills the body.
    /// </summary>
    public static class NameMerge
    {
        /// <summary>
        /// Writes <c>shown[i]</c> for each of the first <paramref name="count"/> items and returns how many are shown. Rules: items are taken in
        /// ascending Id order (the order of <paramref name="items"/> does not matter); a non-elite item is hidden when a non-elite item of the
        /// same Text with a lower Id that is itself shown has an anchor closer than the narrower of the two Widths (strictly less; Euclidean
        /// distance); every other item is shown (an elite, an empty or null Text, a different Text, a far pair). Allocation-free:
        /// <paramref name="shown"/> is the caller's buffer, at least <paramref name="count"/> long.
        /// </summary>
        public static int Decide(NameMergeItem[] items, int count, bool[] shown)
        {
            return 0;
        }
    }
}
