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
        }
    }
}
