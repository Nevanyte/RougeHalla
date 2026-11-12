namespace Roguehalla.Net.Ui
{
    /// <summary>One name label that is drawn this frame, for the vertical stacking rule. Units are the caller's (Unity world units), Y up.</summary>
    public struct NameStackItem
    {
        public uint Id;        // stable tie-break
        public float X;        // horizontal centre of the label
        public float Y;        // bottom of the label
        public float W, H;     // its drawn size
        public float Dist;     // distance of its fighter to the local fighter (0 for the local fighter itself); nearest is placed first
    }

    /// <summary>
    /// Names of fighters that stand together are stacked, never merged (P-UNITY-NAME-GROUP-2). Presentation only. Pure and allocation-free.
    /// </summary>
    public static class NameStack
    {
        /// <summary>
        /// Writes <c>lift[i]</c> (>= 0, in Y units) for each of the first <paramref name="count"/> items: the amount label i is raised so that
        /// no two labels intersect. Labels are placed in ascending (Dist, Id) order; the first never moves. Two labels intersect when their
        /// open x ranges (X +- W/2) overlap and their open y ranges (Y, Y + H) overlap; touching is not an intersection. A label that
        /// intersects nothing already placed gets lift 0 exactly. Otherwise it takes the lowest y >= its own Y among its own Y and, for every
        /// placed label p, p.Y + lift + p.H + <paramref name="gap"/>, at which it intersects no placed label. The result does not depend on
        /// the order of <paramref name="items"/>. Stub: no lift.
        /// </summary>
        public static void Separate(NameStackItem[] items, int count, float gap, float[] lift)
        {
            for (int i = 0; i < count; i++) lift[i] = 0f;
            // placed[k] is true once label k has its final lift; labels are visited in ascending (Dist, Id) order.
            // Allocation-free: a visited label is marked with a NaN lift until it is placed.
            for (int i = 0; i < count; i++) lift[i] = float.NaN;
            for (int step = 0; step < count; step++)
            {
                int k = -1;
                for (int i = 0; i < count; i++)
                {
                    if (!float.IsNaN(lift[i])) continue;
                    if (k < 0 || items[i].Dist < items[k].Dist || (items[i].Dist == items[k].Dist && items[i].Id < items[k].Id)) k = i;
                }
                float y = items[k].Y;
                bool moved = true;
                while (moved)
                {
                    moved = false;
                    for (int p = 0; p < count; p++)
                    {
                        if (p == k || float.IsNaN(lift[p])) continue;
                        if (!Hits(items[k], y, items[p], items[p].Y + lift[p])) continue;
                        y = items[p].Y + lift[p] + items[p].H + gap;
                        moved = true;
                    }
                }
                lift[k] = y - items[k].Y;
                if (lift[k] < 0f) lift[k] = 0f;
            }
        }

        static bool Hits(NameStackItem a, float ay, NameStackItem b, float by)
        {
            return a.X - a.W * 0.5f < b.X + b.W * 0.5f && b.X - b.W * 0.5f < a.X + a.W * 0.5f
                && ay < by + b.H && by < ay + a.H;
        }
    }
}
