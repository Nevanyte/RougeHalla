namespace Roguehalla.Net.Ui
{
    /// <summary>
    /// Target alpha of a tall, walk-through prop. World units: x east, y north (a prop with a smaller y stands in front of an actor with a larger y).
    /// The caller passes only actors the client may see (C-OBS); this rule never sees hidden ones. No allocation.
    /// </summary>
    public static class PropFade
    {
        public const float FadedAlpha = .18f;        // alpha of a prop that covers or contains an actor
        public const float HorizontalMargin = .5f;  // extra half-width, in world units, added to the prop's half-width
        public const float FootDepth = .5f;          // how far a prop's footprint extends south of its base, for callers
        public const float FadeRate = 9f;            // alpha units per second toward the target

        /// <summary>
        /// <paramref name="footX"/>/<paramref name="footY"/>: ground point at the prop's base; <paramref name="halfW"/>: half the width of its footprint and body;
        /// <paramref name="height"/>: sprite height above the base; <paramref name="footDepth"/>: how far the footprint extends south of the base.
        /// <paramref name="xs"/>/<paramref name="ys"/>: the first <paramref name="count"/> visible actor feet positions. Returns 1 or <see cref="FadedAlpha"/>.
        /// </summary>
        public static float TargetAlpha(float footX, float footY, float halfW, float height, float footDepth, float[] xs, float[] ys, int count)
        {
            float reach = halfW + HorizontalMargin;
            for (int i = 0; i < count; i++)
            {
                if (System.Math.Abs(footX - xs[i]) > reach) continue;
                float dy = ys[i] - footY;
                if (dy > 0f ? dy <= height : -dy <= footDepth) return FadedAlpha;   // behind the upper body, or inside the footprint
            }
            return 1f;
        }
    }
}
