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
            int shownCount = 0;
            // Visit the items in ascending Id order without sorting: each pass takes the smallest Id above the last one taken.
            bool first = true; uint last = 0;
            for (int step = 0; step < count; step++)
            {
                int k = -1;
                for (int i = 0; i < count; i++)
                {
                    uint id = items[i].Id;
                    if (!first && id <= last) continue;
                    if (k < 0 || id < items[k].Id) k = i;
                }
                if (k < 0) break;
                first = false; last = items[k].Id;
                var a = items[k];
                bool show = true;
                if (!a.Elite && !string.IsNullOrEmpty(a.Text))
                {
                    for (int j = 0; j < count && show; j++)
                    {
                        var b = items[j];
                        // Only lower ids were visited, so shown[j] is final for them.
                        if (b.Id >= a.Id || b.Elite || !shown[j] || b.Text != a.Text) continue;
                        float dx = a.X - b.X, dy = a.Y - b.Y, w = a.Width < b.Width ? a.Width : b.Width;
                        if (dx * dx + dy * dy < w * w) show = false;
                    }
                }
                shown[k] = show;
                if (show) shownCount++;
            }
            return shownCount;
        }
    }
}
