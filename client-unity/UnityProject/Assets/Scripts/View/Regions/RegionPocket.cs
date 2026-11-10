// Large-scale "greenery pocket" mask (garden and oasis pockets in Holy, dense overgrowth in Plague). Computed once on the CPU
// from tile coordinates, baked into the region weight texture for the ground shader and read by the prop scatter, so lawns and
// the plants standing on them always agree. Pure function of position: same map, same pockets, every load.
using UnityEngine;

namespace Roguehalla.Client
{
    public static class RegionPocket
    {
        /// <summary>Mask value where secondary greenery starts in each region (see RegionThemes ground parameters).</summary>
        public const float PlagueThreshold = .46f, HolyThreshold = .54f;

        /// <summary>0..1 mask at a tile coordinate (fractional allowed); about 0.5 on average, stretched for contrast.</summary>
        public static float At(float tx, float ty)
        {
            float x = tx * .07f, y = ty * .07f;
            float v = RegionNoise.Periodic(x, y, 4096, 301) * .52f + RegionNoise.Periodic(x * 2.1f + 5f, y * 2.1f + 9f, 4096, 302) * .30f
                    + RegionNoise.Periodic(x * 4.3f + 2f, y * 4.3f + 7f, 4096, 303) * .18f;
            return Mathf.Clamp01((v - .5f) * 1.7f + .5f);
        }
    }
}
