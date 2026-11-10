// Pure pixel rule that removes the baked ground shadow from actor sprite frames (no UnityEngine: linked into RoguehallaNet.Tests; used by the editor
// baker Editor/ShowcaseLiveCatalogBaker.cs). Owner decision 2026-11-10: the Flare character sheets carry a soft, semi-transparent dark shadow beside the feet
// (about 30 to 36% of the non-transparent pixels), painted for one fixed sun; the game draws its own shadow from the one sun direction instead
// (AtmosphereShadows.ApplyActor), so the baked one must go. The body is opaque (alpha 255); the shadow is soft (alpha well under 80%).
using System;

namespace Roguehalla.Client
{
    public static class ActorShadowStrip
    {
        /// <summary>A pixel at or above this alpha (80%) is part of the figure.</summary>
        public const byte OpaqueMin = 204;

        /// <summary>
        /// Clears (RGBA all zero) every pixel with 0 &lt; alpha &lt; <see cref="OpaqueMin"/> that has no pixel of alpha &gt;= <see cref="OpaqueMin"/> among its 8 neighbours:
        /// a partly transparent pixel directly beside the figure (its anti-aliased edge) stays, everything else partly transparent goes. The decision reads the ORIGINAL image,
        /// so the result does not depend on the scan order and applying the rule twice changes nothing. Returns the number of pixels cleared.
        /// </summary>
        /// <param name="rgba">width * height * 4 bytes, rows in any order (the rule is symmetric)</param>
        public static int Strip(byte[] rgba, int width, int height)
        {
            if (rgba == null) throw new ArgumentNullException("rgba");
            if (width < 0 || height < 0 || rgba.Length != checked(width * height * 4)) throw new ArgumentException("size mismatch");
            var opaque = new bool[width * height];
            for (int i = 0; i < opaque.Length; i++) opaque[i] = rgba[i * 4 + 3] >= OpaqueMin;
            int cleared = 0;
            for (int y = 0; y < height; y++)
            for (int x = 0; x < width; x++)
            {
                int i = y * width + x, a = rgba[i * 4 + 3];
                if (a == 0 || a >= OpaqueMin) continue;
                bool edge = false;
                for (int dy = -1; dy <= 1 && !edge; dy++)
                {
                    int yy = y + dy; if (yy < 0 || yy >= height) continue;
                    for (int dx = -1; dx <= 1; dx++)
                    {
                        int xx = x + dx; if (xx < 0 || xx >= width || (dx == 0 && dy == 0)) continue;
                        if (opaque[yy * width + xx]) { edge = true; break; }
                    }
                }
                if (edge) continue;
                rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = rgba[i * 4 + 3] = 0; cleared++;
            }
            return cleared;
        }
    }
}
