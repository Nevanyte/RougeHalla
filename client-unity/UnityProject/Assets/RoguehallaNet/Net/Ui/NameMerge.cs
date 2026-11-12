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
        public bool Always;    // a mob that is engaged or locked: its own name is always shown (DecidePacks only; Decide and PackNames ignore it)
        public byte Single;    // PackNames only: 0 nothing, 1 the local attack lock, 2 the mob under the cursor (hover wins over lock)
    }

    /// <summary>
    /// Which mob names are drawn when mobs of one camp stand together (P-UNITY-HUD-VISUAL-FIX-2). Presentation only; legacy draws every
    /// name. Player names are never passed in. Stub: the implementer fills the body.
    /// </summary>
    public static class NameMerge
    {
        /// <summary>
        /// How close two same-named mobs must stand to belong to one pack (DecidePacks), in legacy pixels: 4 tiles of 32. A TUNING value
        /// (P-UNITY-NAME-GROUP-1; owner direction 2026-11-12, less clutter), not a legacy number. A caller working in world units passes
        /// <c>PackDistancePx * ArenaView.Scale</c> (4 units), because the same unit must be used for X, Y and the distance.
        /// </summary>
        public const float PackDistancePx = 128f;

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

        /// <summary>
        /// The pack rule (P-UNITY-NAME-GROUP-1). Writes <c>shown[i]</c> for each of the first <paramref name="count"/> items and returns how many
        /// are shown. Stub: the implementer fills the body. Rules: only a non-elite, non-<see cref="NameMergeItem.Always"/> item with a
        /// non-empty Text takes part in packs; every other item is shown and neither joins, links nor suppresses a pack. Two taking-part items of
        /// the same Text whose anchors are strictly closer than <paramref name="packDistance"/> (Euclidean, same unit as X and Y; Width is
        /// ignored) are in one pack, and packs chain (A near B and B near C is one pack even when A and C are far apart). Exactly one item of a
        /// pack is shown, the one with the lowest Id, wherever it sits in <paramref name="items"/>; the rest are hidden. Allocation-free: all
        /// three arrays are the caller's, <paramref name="shown"/> and <paramref name="scratch"/> at least <paramref name="count"/> long
        /// (<paramref name="scratch"/> is free working space for a union-find, its contents on return are unspecified).
        /// </summary>
        public static int DecidePacks(NameMergeItem[] items, int count, float packDistance, bool[] shown, int[] scratch)
        {
            for (int i = 0; i < count; i++) scratch[i] = i;
            float d2 = packDistance * packDistance;
            for (int i = 0; i < count; i++)
            {
                if (!InPacks(items[i])) continue;
                for (int j = i + 1; j < count; j++)
                {
                    if (!InPacks(items[j]) || items[i].Text != items[j].Text) continue;
                    float dx = items[i].X - items[j].X, dy = items[i].Y - items[j].Y;
                    if (dx * dx + dy * dy >= d2) continue;
                    int ri = Root(scratch, i), rj = Root(scratch, j);
                    if (ri == rj) continue;
                    // The root of a pack is its lowest id.
                    if (items[ri].Id < items[rj].Id) scratch[rj] = ri; else scratch[ri] = rj;
                }
            }
            int shownCount = 0;
            for (int i = 0; i < count; i++)
            {
                bool show = !InPacks(items[i]) || Root(scratch, i) == i;
                shown[i] = show;
                if (show) shownCount++;
            }
            return shownCount;
        }

        /// <summary>
        /// The pack rule of P-UNITY-NAME-GROUP-2 (replaces <see cref="DecidePacks"/> in the presenter; DecidePacks and its tests stay). Writes
        /// <c>shown[i]</c>, <c>anchorX[i]</c> and <c>anchorY[i]</c> for each of the first <paramref name="count"/> items and returns how many are
        /// shown. Y is up (Unity world units). Packs are built exactly as DecidePacks builds them (same-name non-elite mobs with a non-empty
        /// Text, chained, strictly closer than <paramref name="packDistance"/>), except that <see cref="NameMergeItem.Always"/> is ignored: an
        /// engaged mob stays in its pack and a pack never splits. A pack shows EXACTLY ONE name. The carrier is the member with
        /// <c>Single == 2</c> (hovered; lowest Id if several), else the member with <c>Single == 1</c> (locked; lowest Id), else the member
        /// with the lowest Id. A singled carrier's anchor is its own (X, Y). An unsingled pack's anchor is the horizontal centre of the pack's
        /// extent, (min X + max X) / 2 over its members (NOT the mean), and the largest Y of its members (the highest one). Every item outside a
        /// pack (an elite, an empty or null Text) is shown at its own anchor. Anchors of hidden items are unspecified. Order of
        /// <paramref name="items"/> does not matter. Allocation-free; the caller owns all four buffers (each at least <paramref name="count"/> long).
        /// Stub: shows everything at its own anchor.
        /// </summary>
        public static int PackNames(NameMergeItem[] items, int count, float packDistance, bool[] shown, int[] scratch, float[] anchorX, float[] anchorY)
        {
            for (int i = 0; i < count; i++) { shown[i] = true; anchorX[i] = items[i].X; anchorY[i] = items[i].Y; }
            return count;
        }

        static bool InPacks(NameMergeItem it) { return !it.Elite && !it.Always && !string.IsNullOrEmpty(it.Text); }

        static int Root(int[] parent, int i)
        {
            while (parent[i] != i) { parent[i] = parent[parent[i]]; i = parent[i]; }
            return i;
        }
    }
}
