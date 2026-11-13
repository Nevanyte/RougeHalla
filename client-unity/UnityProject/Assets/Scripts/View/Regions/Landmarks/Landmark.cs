using UnityEngine;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    /// <summary>
    /// P-UNITY-LANDMARK-1: one landmark of the map as the client draws it. Everything here is derived from the delivered tiles inside
    /// the anchor's footprint plus the anchor's kind, front and entrance, never from a copy of a blueprint grid. STUB: empty.
    /// World space below is ArenaView.WorldPoint space (parent-local); tiles are map tile coordinates.
    /// </summary>
    public sealed class Landmark
    {
        public MapAnchor Anchor { get; private set; }
        /// <summary>The landmark's root object (child of the view's parent); null in the stub.</summary>
        public GameObject Root { get; private set; }
        /// <summary>Wall tiles of the collision plane inside the footprint.</summary>
        public int WallCount { get; private set; }
        /// <summary>Floor tiles inside the footprint whose terrain code is Ice (the cave's special terrain).</summary>
        public int IceCount { get; private set; }
        /// <summary>Interior floor tiles (LandmarkInterior.Find), excluding the entrance tiles.</summary>
        public int InteriorCount { get; private set; }
        /// <summary>Whether the roof layer covers tile (x, y): true for every interior tile, false outside the footprint.</summary>
        public bool RoofCovers(int x, int y) { return false; }
        /// <summary>The roof layer's renderers (sprites), one per roof piece; each one's colour alpha equals <see cref="RoofAlpha"/>.</summary>
        public SpriteRenderer[] RoofRenderers { get; private set; } = new SpriteRenderer[0];
        /// <summary>Sorting order of every roof renderer: at the footprint's south edge on the walls' rule (2000 + 16 x (footprint y + h)),
        /// so an actor inside the footprint draws under it and one south of it draws over it; always under the vision fog.</summary>
        public int RoofOrder { get; private set; }
        /// <summary>Current alpha of the roof layer (LandmarkView.RoofOpaqueAlpha .. LandmarkView.RoofFadedAlpha).</summary>
        public float RoofAlpha { get; private set; }
        /// <summary>The entrance tiles the arch stands on (the anchor's).</summary>
        public MapTile[] ArchTiles { get; private set; } = new MapTile[0];
        /// <summary>Centre of the arch in world space.</summary>
        public Vector3 ArchCentre { get; private set; }
        /// <summary>The anchor's front as a unit vector in tile space (x east, y south), from the DIR16 index.</summary>
        public Vector2 FrontVector { get; private set; }
    }
}
