using System.Runtime.CompilerServices;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// P-UNITY-LANDMARK-2 (stub by the oracle author): the Fire volcano's art (kind 1). The implementer fills <see cref="VolcanoLandmark.Build"/>
    /// and adds the one registration line in LandmarkArts.cs (`case MapBlob.AnchorKindVolcano: builder = VolcanoLandmark.Build; return true;`).
    /// The oracle reads the art through <see cref="VolcanoLandmark.ArtOf"/> and this class; keep those names and signatures.
    /// </summary>
    public sealed class VolcanoArt
    {
        public const int Foot = 0, Slope = 1, Rim = 2;

        /// <summary>The height tier of map tile (x, y) (Foot, Slope or Rim) when it is a wall tile of the footprint; -1 for every other tile
        /// (floor, lava, any tile outside the footprint). The tier rule is in docs/backlog/packets/P-UNITY-LANDMARK-2.md, "Established facts".</summary>
        public int Tier(int x, int y) { return -1; }

        /// <summary>The renderers that draw the cone (every one under the landmark's root, on the walls' row rule).</summary>
        public SpriteRenderer[] ConeRenderers { get { return new SpriteRenderer[0]; } }

        /// <summary>The renderers that glow: one on each outlet and one over the lake; all under the landmark's root, under the fog.</summary>
        public SpriteRenderer[] GlowRenderers { get { return new SpriteRenderer[0]; } }
    }

    public static class VolcanoLandmark
    {
        static readonly ConditionalWeakTable<Landmark, VolcanoArt> Arts = new ConditionalWeakTable<Landmark, VolcanoArt>();

        /// <summary>The art Build made for this landmark; null for a landmark of another kind or one not built by this class.</summary>
        public static VolcanoArt ArtOf(Landmark landmark)
        {
            VolcanoArt art; return landmark != null && Arts.TryGetValue(landmark, out art) ? art : null;
        }

        public static void Build(Landmark lm)
        {
            // Stub: draws nothing and registers no art. The implementer replaces this (and records the art with Arts.Add).
        }
    }
}
