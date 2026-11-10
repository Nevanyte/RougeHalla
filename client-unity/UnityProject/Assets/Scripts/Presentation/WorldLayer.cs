using UnityEngine;
using UnityEngine.Rendering.Universal;

namespace Roguehalla.Client
{
    /// <summary>
    /// The "World" sorting layer: the ground and everything that is drawn flat under the props (ground quad, surface prints and ripples, decals,
    /// every renderer whose sort order is below <see cref="MaxOrder"/>). It sorts before "Default", which holds props, walls, actors and effects
    /// with their depth interleaving untouched, and the 2D renderer's Camera Sorting Layer Texture is grabbed once after it
    /// (Roguehalla2DRenderer.asset: bound = World, 4x box downsample). The actor outline reads that texture to learn the ground behind it.
    /// Moving the ground below Default changes no drawing order (it already sorted first by sort order).
    /// </summary>
    public static class WorldLayer
    {
        public const string Name = "World";
        public const int MaxOrder = 1000;

        public static int Id { get { return SortingLayer.NameToID(Name); } }
        public static bool Exists { get { return SortingLayer.IsValid(Id); } }

        /// <summary>Puts every renderer under <paramref name="root"/> that sorts below <see cref="MaxOrder"/> onto the World layer (idempotent).</summary>
        public static int Tag(Transform root)
        {
            if (root == null || !Exists) return 0;
            int id = Id, n = 0;
            foreach (var r in root.GetComponentsInChildren<Renderer>(true))
            {
                if (r is ParticleSystemRenderer || r.sortingOrder >= MaxOrder || r.sortingLayerID == id) continue;
                r.sortingLayerID = id; n++;
            }
            return n;
        }

        /// <summary>Makes a light (an authored prefab lists only "Default") light every sorting layer, the World layer included.</summary>
        public static void LightEverything(Light2D light)
        {
            if (light == null) return;
            var layers = SortingLayer.layers; var ids = new int[layers.Length];
            for (int i = 0; i < ids.Length; i++) ids[i] = layers[i].id;
            light.targetSortingLayers = ids;
        }
    }
}
