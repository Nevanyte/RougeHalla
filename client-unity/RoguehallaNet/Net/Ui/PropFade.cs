namespace Roguehalla.Net.Ui
{
    /// <summary>
    /// Target alpha of a tall, walk-through prop. World units: x east, y north (a prop with a smaller y stands in front of an actor with a larger y).
    /// The caller passes only actors the client may see (C-OBS); this rule never sees hidden ones. No allocation.
    /// </summary>
    public static class PropFade
    {
        public const float FadedAlpha = .30f;        // alpha of a prop that covers or contains an actor
        public const float HorizontalMargin = .35f;  // extra half-width, in world units, added to the prop's half-width
        public const float FadeRate = 9f;            // alpha units per second toward the target

        /// <summary>
        /// <paramref name="footX"/>/<paramref name="footY"/>: ground point at the prop's base; <paramref name="halfW"/>: half the width of its footprint and body;
        /// <paramref name="height"/>: sprite height above the base; <paramref name="footDepth"/>: how far the footprint extends south of the base.
        /// <paramref name="xs"/>/<paramref name="ys"/>: the first <paramref name="count"/> visible actor feet positions. Returns 1 or <see cref="FadedAlpha"/>.
        /// </summary>
        public static float TargetAlpha(float footX, float footY, float halfW, float height, float footDepth, float[] xs, float[] ys, int count)
        {
            for (int i = 0; i < count; i++)
            {
                if (footY >= ys[i]) continue;
                if (System.Math.Abs(footX - xs[i]) > halfW + HorizontalMargin) continue;
                if (ys[i] > footY + height) continue;
                return FadedAlpha;
            }
            return 1f;
        }
    }
}
