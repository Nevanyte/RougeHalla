using System.Collections.Generic;
using UnityEngine;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Client
{
    /// <summary>
    /// P-UNITY-LANDMARK-1: one landmark of the map as the client draws it. Everything here is derived from the delivered tiles inside
    /// the anchor's footprint plus the anchor's kind, front and entrance, never from a copy of a blueprint grid (the generator places a
    /// blueprint in one of eight orientations and does not say which). The framework classifies; a kind's art (LandmarkArts) only draws.
    /// World space below is ArenaView.WorldPoint space (parent-local: x = tile x, y = -tile y * GroundSquash); tiles are map tile coordinates.
    /// </summary>
    public sealed class Landmark
    {
        public MapAnchor Anchor { get; private set; }
        /// <summary>The landmark's root object (child of the view's parent); every renderer of the landmark is below it.</summary>
        public GameObject Root { get; private set; }
        /// <summary>Wall tiles of the collision plane inside the footprint.</summary>
        public int WallCount { get; private set; }
        /// <summary>Floor tiles inside the footprint whose terrain code is Ice (the cave's special terrain).</summary>
        public int IceCount { get; private set; }
        /// <summary>Interior floor tiles (LandmarkInterior.Find), excluding the entrance tiles.</summary>
        public int InteriorCount { get; private set; }
        /// <summary>The roof layer's renderers (sprites), one per roof piece; each one's colour alpha equals <see cref="RoofAlpha"/>.</summary>
        public SpriteRenderer[] RoofRenderers { get { return _roofArray; } }
        /// <summary>Sorting order of every roof renderer: at the footprint's south edge on the walls' rule (2000 + 16 x (footprint y + h)),
        /// so an actor inside the footprint draws under it and one south of it draws over it; always under the vision fog.</summary>
        public int RoofOrder { get; private set; }
        /// <summary>Current alpha of the roof layer (LandmarkView.RoofOpaqueAlpha .. LandmarkView.RoofFadedAlpha).</summary>
        public float RoofAlpha { get; private set; }
        /// <summary>The entrance tiles the arch stands on (the anchor's).</summary>
        public MapTile[] ArchTiles { get; private set; }
        /// <summary>Centre of the arch in world space (on the ground, the middle of the entrance tiles).</summary>
        public Vector3 ArchCentre { get; private set; }
        /// <summary>The anchor's front as a unit vector in tile space (x east, y south), from the DIR16 index.</summary>
        public Vector2 FrontVector { get; private set; }

        // ---- what a kind's art reads ------------------------------------------------------------------------------------------
        public int FootX { get; private set; }
        public int FootY { get; private set; }
        public int FootW { get; private set; }
        public int FootH { get; private set; }
        /// <summary>The material sprites of this landmark share (sun-lit like the region props).</summary>
        public Material Material { get; private set; }

        bool[] _wall, _low, _interior, _roofMask, _fadeMask; byte[] _terrain; bool _coverSet;
        readonly List<SpriteRenderer> _roof = new List<SpriteRenderer>();
        SpriteRenderer[] _roofArray = new SpriteRenderer[0];
        readonly List<Object> _owned = new List<Object>();
        /// <summary>Set by LandmarkView.NoteActor for the frame; cleared by Tick.</summary>
        internal bool ActorInside;
        /// <summary>Set by LandmarkView.NoteOtherActor for the frame (another delivered actor); cleared by Tick.</summary>
        internal bool OtherInside;

        /// <summary>True for a wall tile (collision plane) inside the footprint; false anywhere else.</summary>
        public bool IsWall(int x, int y) { return Local(x, y, out int i) && _wall[i]; }
        /// <summary>True for an interior floor tile (enclosed floor, doorway tiles excluded).</summary>
        public bool IsInterior(int x, int y) { return Local(x, y, out int i) && _interior[i]; }
        /// <summary>Whether the roof layer covers tile (x, y): every interior tile and the landmark's own wall tiles (the rock the roof
        /// joins); false outside the footprint and on the mouth.</summary>
        public bool RoofCovers(int x, int y) { return Local(x, y, out int i) && _roofMask[i]; }

        /// <summary>True for a Low tile (collision class low: walkers cannot cross, shots can) inside the footprint; false elsewhere.</summary>
        public bool IsLow(int x, int y) { return Local(x, y, out int i) && _low[i]; }
        /// <summary>The delivered terrain code (TerrainKind as a byte) of a footprint tile; 0 outside the footprint and when the map has no terrain plane.</summary>
        public byte Terrain(int x, int y) { return Local(x, y, out int i) ? _terrain[i] : (byte)0; }
        /// <summary>An art hands over the tiles under its roof or canopy. Afterwards RoofCovers is true exactly for those tiles (tiles outside the
        /// footprint are ignored) and the fade reads them instead of the interior; an empty set means no cover (the roof never fades).
        /// Replaces the default mask; call it while building.</summary>
        public void SetCover(IEnumerable<MapTile> tiles)
        {
            var mask = new bool[FootW * FootH];
            if (tiles != null) foreach (var t in tiles) if (Local(t.X, t.Y, out int i)) mask[i] = true;
            _roofMask = mask; _coverSet = true;
        }

        /// <summary>P-UNITY-BOG-TREE-2: an art may hand over the tiles on which an actor fades the roof when they are wider than the cover
        /// (a crown lifted off the ground overlaps tiles north of its cover). Afterwards <see cref="Fades"/> reads this set; RoofCovers stays the
        /// cover. Tiles outside the footprint are ignored. Without a call, the fade reads the cover (or the interior) as before.</summary>
        public void SetFadeTiles(IEnumerable<MapTile> tiles)
        {
            var mask = new bool[FootW * FootH];
            if (tiles != null) foreach (var t in tiles) if (Local(t.X, t.Y, out int i)) mask[i] = true;
            _fadeMask = mask;
        }

        /// <summary>Whether an actor on tile (x, y) fades the roof: the fade set when the art gave one, else the cover set when the art gave
        /// one, else the interior.</summary>
        internal bool Fades(int x, int y)
        {
            if (!Local(x, y, out int i)) return false;
            if (_fadeMask != null) return _fadeMask[i];
            return _coverSet ? _roofMask[i] : _interior[i];
        }

        bool Local(int x, int y, out int i)
        {
            int lx = x - FootX, ly = y - FootY; i = ly * FootW + lx;
            return lx >= 0 && ly >= 0 && lx < FootW && ly < FootH;
        }

        /// <summary>Registers a texture, sprite, material or object the landmark made, destroyed with it.</summary>
        public void Own(Object o) { if (o != null) _owned.Add(o); }

        /// <summary>Adds a roof piece: it takes the landmark's roof order and the current roof alpha, and fades with the roof.</summary>
        public void AddRoofRenderer(SpriteRenderer r)
        {
            r.sortingOrder = RoofOrder; Tint(r, RoofAlpha);
            _roof.Add(r); _roofArray = _roof.ToArray();
        }

        /// <summary>The landmark's ground pieces (see <see cref="AddGroundPiece"/>); empty until a piece is added.</summary>
        public SpriteRenderer[] GroundRenderers { get { return _groundArray; } }
        SpriteRenderer[] _groundArray = new SpriteRenderer[0];
        readonly List<SpriteRenderer> _ground = new List<SpriteRenderer>();

        /// <summary>P-UNITY-BOG-TREE-3. For a piece of a landmark's art that lies on the ground (a shadow, a stain): it is
        /// never tinted by the roof fade, keeps exactly the sorting order it is given, appears in <see cref="GroundRenderers"/> (not
        /// <see cref="RoofRenderers"/>), and is disposed with the landmark. Real behaviour: set the order, list the renderer, clear the list in Dispose.</summary>
        public void AddGroundPiece(SpriteRenderer r, int order)
        {
            if (r == null) return;
            r.sortingOrder = order;
            _ground.Add(r); _groundArray = _ground.ToArray();
        }

        internal void SetRoofAlpha(float a)
        {
            if (a == RoofAlpha) return;
            RoofAlpha = a;
            for (int i = 0; i < _roofArray.Length; i++) Tint(_roofArray[i], a);
        }

        static void Tint(SpriteRenderer r, float a) { var c = r.color; c.a = a; r.color = c; }

        /// <summary>Classifies the footprint's tiles and makes the root; null when the footprint is empty or off the map.</summary>
        internal static Landmark Create(Transform parent, MapBlob map, MapAnchor anchor)
        {
            var f = anchor.Footprint;
            if (f.W == 0 || f.H == 0 || f.X + f.W > map.W || f.Y + f.H > map.H) return null;
            var lm = new Landmark
            {
                Anchor = anchor, FootX = f.X, FootY = f.Y, FootW = f.W, FootH = f.H, RoofAlpha = LandmarkView.RoofOpaqueAlpha,
                RoofOrder = 2000 + 16 * (f.Y + f.H), ArchTiles = anchor.Entrance,
                FrontVector = new Vector2(Mathf.Cos(anchor.Front * Mathf.PI / 8f), Mathf.Sin(anchor.Front * Mathf.PI / 8f)),
            };
            int n = f.W * f.H; lm._wall = new bool[n]; lm._low = new bool[n]; lm._terrain = new byte[n]; lm._roofMask = new bool[n];
            for (int y = 0; y < f.H; y++) for (int x = 0; x < f.W; x++)
            {
                int i = y * f.W + x, m = (f.Y + y) * map.W + f.X + x;
                if (map.Terrain != null) lm._terrain[i] = map.Terrain[m];
                if (map.Tiles[m] == MapBlob.Low) lm._low[i] = true;
                if (map.Tiles[m] == MapBlob.Wall) { lm._wall[i] = true; lm.WallCount++; }
                else if (map.Tiles[m] == MapBlob.Floor && map.Terrain != null && map.Terrain[m] == (byte)TerrainKind.Ice) lm.IceCount++;
            }
            lm._interior = LandmarkInterior.Find(map.Tiles, map.W, map.H, f, anchor.Entrance);
            lm.InteriorCount = LandmarkInterior.Count(lm._interior);
            for (int i = 0; i < n; i++) lm._roofMask[i] = lm._interior[i] || lm._wall[i];
            if (anchor.Entrance.Length > 0)
            {
                float sx = 0, sy = 0;
                foreach (var t in anchor.Entrance) { sx += t.X + .5f; sy += t.Y + .5f; }
                lm.ArchCentre = new Vector3(sx / anchor.Entrance.Length, -sy / anchor.Entrance.Length * ArenaView.GroundSquash, 0);
            }
            else lm.ArchCentre = new Vector3(anchor.Centre.X + .5f, -(anchor.Centre.Y + .5f) * ArenaView.GroundSquash, 0);
            var shader = Resources.Load<Shader>("Regions/RegionSpriteLit");
            if (shader != null) { lm.Material = new Material(shader) { name = "Roguehalla / landmark (sun lit)" }; lm.Own(lm.Material); }
            else lm.Material = ShowcaseSprites.Lit;
            lm.Root = new GameObject("Landmark kind " + anchor.Kind + " zone " + anchor.Zone);
            lm.Root.transform.SetParent(parent, false);
            return lm;
        }

        internal void Dispose()
        {
            foreach (var o in _owned) RegionUtil.Kill(o);
            _owned.Clear(); _roof.Clear(); _roofArray = new SpriteRenderer[0]; _ground.Clear(); _groundArray = new SpriteRenderer[0];
            if (Root != null) RegionUtil.Kill(Root);
            Root = null;
        }
    }
}
