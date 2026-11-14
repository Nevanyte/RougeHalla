// P-UNITY-FROST-WALL-1: standing Frost Walls (legacy 78dd8bd4 FieldView.ts drawWall), the cast telegraph (WishFx.ts
// drawWallTelegraph) and the aim preview (AbilityAim.ts). Draws only what it is given: walls from the delivered tiles, the
// preview from FrostWallAim's tiles. Presentation only: it decides nothing. Blocks and meshes are pooled and rewritten in
// place, so a warmed frame allocates nothing.
using System;
using System.Collections.Generic;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using UnityEngine;

namespace Roguehalla.Client
{
    public sealed class FrostWallPresenter : IDisposable
    {
        // ---- looks-only dials (docs/unity/DIALS.md) ----
        /// <summary>Legacy ice colours (FieldView.ts WALL_TOP, WALL_FRONT, WALL_EDGE) and the preview's invalid tint
        /// (AbilityAim.ts 0xef5350).</summary>
        public static readonly Color32 TopColor = new Color32(0xe1, 0xf5, 0xfe, 0xff);
        public static readonly Color32 FaceColor = new Color32(0x4f, 0xc3, 0xf7, 0xff);
        public static readonly Color32 EdgeColor = new Color32(0x02, 0x88, 0xd1, 0xff);
        public static readonly Color32 InvalidTint = new Color32(0xef, 0x53, 0x50, 0xff);
        /// <summary>Legacy top alpha, how much the crack takes off it, and the crack's time (ms before the end).</summary>
        public const float TopAlpha = .85f, CrackFade = .3f;
        public const double CrackMs = 1000;
        /// <summary>Legacy face alpha, edge alpha, the lift (sim px) and the fade-out at the end (ms).</summary>
        public const float FaceAlpha = .78f, EdgeAlpha = .6f, Lift = 20f;
        public const double FadeMs = 300;
        /// <summary>Preview: fill alpha (base, pulse swing), outline alpha (base, pulse swing), line alpha, centre dot alpha, reach ring alpha,
        /// pulse speed (radians per ms; legacy 0.008).</summary>
        public const float PreviewFillAlpha = .18f, PreviewFillPulse = .1f, PreviewOutlineAlpha = .35f, PreviewOutlinePulse = .2f,
            PreviewLineAlpha = .55f, PreviewDotAlpha = .8f, PreviewRingAlpha = .25f, PulseSpeed = .008f;
        /// <summary>Telegraph: line alpha at the start and what the gathering adds, core alpha.</summary>
        public const float TelegraphAlpha = .15f, TelegraphGather = .35f, TelegraphCoreAlpha = .6f;

        const float S = ArenaView.Scale, G = ArenaView.GroundSquash;
        // OverlayOrder: the preview and the telegraph draw over the fighters (legacy DEPTH_AIM, above fighters) and under the world marks
        // (WorldMarks 29000, labels 29100). Not a looks dial: a layering rule.
        const int MaxPreviewTiles = 24, RingSegments = 48, WallOrderBase = 2000, OverlayOrder = 28900;
        const int BlockQuads = 7; // face, top, four rim strips, base line

        sealed class QuadMesh
        {
            public readonly GameObject Go; public readonly Mesh Mesh;
            readonly Vector3[] _v; readonly Color32[] _c; bool _colorsDirty;
            public QuadMesh(string name, Transform parent, int quads, int order, bool wideBounds, List<UnityEngine.Object> owned)
            {
                _v = new Vector3[quads * 4]; _c = new Color32[quads * 4];
                Go = new GameObject(name); Go.transform.SetParent(parent, false);
                var mf = Go.AddComponent<MeshFilter>(); var r = Go.AddComponent<MeshRenderer>();
                ShowcaseSprites.Initialize();
                r.sharedMaterial = ShowcaseSprites.Unlit; r.sortingOrder = order;
                r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off; r.receiveShadows = false;
                Mesh = new Mesh { name = name }; Mesh.MarkDynamic();
                var tri = new int[quads * 6];
                for (int q = 0; q < quads; q++) { int o = q * 4, t = q * 6; tri[t] = o; tri[t + 1] = o + 1; tri[t + 2] = o + 2; tri[t + 3] = o; tri[t + 4] = o + 2; tri[t + 5] = o + 3; }
                Mesh.SetVertices(_v); Mesh.SetColors(_c); Mesh.SetTriangles(tri, 0); Mesh.uv = new Vector2[quads * 4];
                if (wideBounds) Mesh.bounds = new Bounds(Vector3.zero, new Vector3(4000, 4000, 1));
                mf.sharedMesh = Mesh; owned.Add(Mesh); Go.SetActive(false);
            }
            public void Quad(int q, Vector3 a, Vector3 b, Vector3 c, Vector3 d) { int o = q * 4; _v[o] = a; _v[o + 1] = b; _v[o + 2] = c; _v[o + 3] = d; }
            public void Collapse(int q) { Quad(q, Vector3.zero, Vector3.zero, Vector3.zero, Vector3.zero); }
            public void Rect(int q, float x0, float y0, float x1, float y1) { Quad(q, new Vector3(x0, y0), new Vector3(x1, y0), new Vector3(x1, y1), new Vector3(x0, y1)); }
            /// <summary>A line from a to b <paramref name="width"/> thick (world units).</summary>
            public void Seg(int q, Vector3 a, Vector3 b, float width)
            {
                float dx = b.x - a.x, dy = b.y - a.y, l = Mathf.Sqrt(dx * dx + dy * dy);
                float nx = 0, ny = 0; if (l > 1e-6f) { nx = -dy / l * width * .5f; ny = dx / l * width * .5f; }
                Quad(q, new Vector3(a.x + nx, a.y + ny), new Vector3(a.x - nx, a.y - ny), new Vector3(b.x - nx, b.y - ny), new Vector3(b.x + nx, b.y + ny));
            }
            public void Color(int q, Color32 col)
            {
                int o = q * 4;
                if (_c[o].r == col.r && _c[o].g == col.g && _c[o].b == col.b && _c[o].a == col.a) return;
                _c[o] = col; _c[o + 1] = col; _c[o + 2] = col; _c[o + 3] = col; _colorsDirty = true;
            }
            public void UploadShape() { Mesh.SetVertices(_v); }
            public void UploadColors() { if (_colorsDirty) { Mesh.SetColors(_c); _colorsDirty = false; } }
            public void Active(bool on) { if (Go.activeSelf != on) Go.SetActive(on); }
            public Color32 ColorOf(int q) { return _c[q * 4]; }
        }

        sealed class Block { public QuadMesh Mesh; public MeshRenderer Renderer; public MapTile Tile; public float TopAlpha; }
        sealed class Wall
        {
            public AreaKey Key; public double EndsAt, StartedAt; public bool Seen;
            public readonly List<Block> Blocks = new List<Block>();
        }

        readonly Transform _container; readonly List<UnityEngine.Object> _owned = new List<UnityEngine.Object>();
        readonly List<Wall> _walls = new List<Wall>(), _ordered = new List<Wall>(); readonly List<Block> _pool = new List<Block>();
        readonly QuadMesh _telegraph, _preview;
        double _renderMs; bool _disposed;
        bool _tgOn; double _tgStart, _tgDur; float _tgAx, _tgAy, _tgBx, _tgBy;
        bool _pvOn; int _pvCount; Color32 _pvTint; readonly MapTile[] _pvTiles = new MapTile[MaxPreviewTiles];
        float _pulse = .5f;

        public FrostWallPresenter(Transform parent)
        {
            var go = new GameObject("Frost walls"); go.transform.SetParent(parent, false); _container = go.transform;
            _owned.Add(go);
            _telegraph = new QuadMesh("Frost wall telegraph", _container, 2, OverlayOrder, true, _owned);
            _preview = new QuadMesh("Frost wall preview", _container, RingSegments + MaxPreviewTiles * 5 + 2, OverlayOrder, true, _owned);
        }

        // ---- standing walls ----
        /// <summary>The wall rows of <paramref name="fields"/> (Kind Wall) at server render time <paramref name="renderMs"/>. A wall is kept
        /// per <see cref="AreaKey"/>; one the state no longer lists is gone.</summary>
        public void PresentWalls(IReadOnlyList<AreaView> fields, double renderMs)
        {
            if (_disposed) return;
            _renderMs = renderMs;
            for (int i = 0; i < _walls.Count; i++) _walls[i].Seen = false;
            _ordered.Clear();
            if (fields != null)
                for (int i = 0; i < fields.Count; i++)
                {
                    var f = fields[i];
                    if (f.Kind != AreaKind.Wall || f.Tiles == null || f.Tiles.Length == 0) continue;
                    Wall w = null;
                    for (int k = 0; k < _walls.Count; k++) if (_walls[k].Key.Equals(f.Key)) { w = _walls[k]; break; }
                    if (w == null) { w = new Wall { Key = f.Key }; _walls.Add(w); BuildWall(w, f.Tiles); }
                    else if (_ordered.Contains(w)) continue; // a duplicate key in one list: drawn once
                    w.Seen = true; w.StartedAt = f.StartedAt; w.EndsAt = f.EndsAt; _ordered.Add(w);
                }
            for (int i = _walls.Count - 1; i >= 0; i--)
                if (!_walls[i].Seen) { ReleaseWall(_walls[i]); _walls.RemoveAt(i); }
            ApplyWalls();
        }

        void BuildWall(Wall w, MapTile[] tiles)
        {
            foreach (var t in tiles)
            {
                var b = AcquireBlock();
                b.Tile = t;
                b.Mesh.Go.transform.position = ArenaView.WorldPoint(t.X * 32 + 16, t.Y * 32 + 16);
                b.Renderer.sortingOrder = WallOrderBase + Mathf.RoundToInt((t.Y * 32 + 16) * .5f); // the actors' formula at the tile's row, so an actor beside any block sorts right
                b.Mesh.Active(true); b.TopAlpha = -1f;
                w.Blocks.Add(b);
            }
        }
        void ReleaseWall(Wall w) { foreach (var b in w.Blocks) { b.Mesh.Active(false); _pool.Add(b); } w.Blocks.Clear(); }

        Block AcquireBlock()
        {
            if (_pool.Count > 0) { var b = _pool[_pool.Count - 1]; _pool.RemoveAt(_pool.Count - 1); return b; }
            var m = new QuadMesh("Ice block", _container, BlockQuads, WallOrderBase, false, _owned);
            float hw = 16 * S, hd = 16 * S * G, lift = Lift * S, e = 1.5f * S;
            m.Rect(0, -hw, -hd, hw, -hd + lift);              // face: from the tile's south edge on the ground up to the top
            m.Rect(1, -hw, -hd + lift, hw, hd + lift);        // top
            m.Rect(2, -hw, hd + lift - e, hw, hd + lift);     // rim: north
            m.Rect(3, -hw, -hd + lift, hw, -hd + lift + e);   // rim: south
            m.Rect(4, -hw, -hd + lift, -hw + e, hd + lift);   // rim: west
            m.Rect(5, hw - e, -hd + lift, hw, hd + lift);     // rim: east
            m.Rect(6, -hw, -hd, hw, -hd + e);                 // base line
            m.UploadShape(); m.Mesh.RecalculateBounds();
            return new Block { Mesh = m, Renderer = m.Go.GetComponent<MeshRenderer>() };
        }

        void ApplyWalls()
        {
            for (int i = 0; i < _ordered.Count; i++)
            {
                var w = _ordered[i];
                double left = w.EndsAt - _renderMs;
                float crack = left < CrackMs ? (float)(1.0 - Math.Max(0.0, left) / CrackMs) : 0f;
                float fade = _renderMs < w.StartedAt ? 0f : left < FadeMs ? (float)Math.Max(0.0, left) / (float)FadeMs : 1f;
                float top = (TopAlpha - CrackFade * crack) * fade, face = (FaceAlpha - CrackFade * crack) * fade, edge = EdgeAlpha * fade;
                var fc = With(FaceColor, face); var tc = With(TopColor, top); var ec = With(EdgeColor, edge);
                foreach (var b in w.Blocks)
                {
                    b.TopAlpha = top;
                    b.Mesh.Color(0, fc); b.Mesh.Color(1, tc);
                    for (int q = 2; q < BlockQuads; q++) b.Mesh.Color(q, ec);
                    b.Mesh.UploadColors();
                }
            }
        }

        /// <summary>Walls drawn.</summary>
        public int WallCount { get { return _ordered.Count; } }
        /// <summary>Ice blocks drawn, every wall's, in field order then tile order.</summary>
        public int BlockCount { get { int n = 0; for (int i = 0; i < _ordered.Count; i++) n += _ordered[i].Blocks.Count; return n; } }
        Block BlockAt(int i)
        {
            if (i >= 0) for (int k = 0; k < _ordered.Count; k++) { var bl = _ordered[k].Blocks; if (i < bl.Count) return bl[i]; i -= bl.Count; }
            throw new ArgumentOutOfRangeException(nameof(i));
        }
        public MapTile BlockTile(int i) { return BlockAt(i).Tile; }
        /// <summary>The block's GameObject (active while drawn).</summary>
        public GameObject BlockObject(int i) { return BlockAt(i).Mesh.Go; }
        /// <summary>The alpha of the block's top (legacy <c>0.85 - 0.3 * crack</c> times the field fade).</summary>
        public float BlockTopAlpha(int i) { return BlockAt(i).TopAlpha; }
        /// <summary>The colour of the block's top, alpha ignored.</summary>
        public Color32 BlockTopColor(int i) { BlockAt(i); return TopColor; }

        // ---- what is drawn, as colours (P-UNITY-FROST-WALL-READ-1 oracle: FrostWallReadEditModeTests) ----
        /// <summary>The parts of a standing block whose colours the oracle reads.</summary>
        public enum BlockPart { Top, Face, Edge }
        /// <summary>The parts of the aim preview whose colours the oracle reads.</summary>
        public enum PreviewPart { Fill, Outline, Ring, Line, Dot }

        /// <summary>The colour, alpha included, of every quad of block <paramref name="i"/> that draws <paramref name="part"/>, as it is on the mesh now
        /// (after the last <see cref="Tick"/>): Top the surface, Face the front, Edge every quad that outlines the block's silhouette (rim, base line, any
        /// outline or shadow line). A part drawn in two tones lists both. Contract for the implementer: list EVERY quad that draws the part.</summary>
        public Color32[] BlockLayers(int i, BlockPart part)
        {
            var m = BlockAt(i).Mesh;
            switch (part)
            {
                case BlockPart.Top: return new[] { m.ColorOf(1) };
                case BlockPart.Face: return new[] { m.ColorOf(0) };
                default: { var l = new Color32[BlockQuads - 2]; for (int q = 2; q < BlockQuads; q++) l[q - 2] = m.ColorOf(q); return l; }
            }
        }

        /// <summary>The colour, alpha included, of every quad that draws <paramref name="part"/> of the preview as it is on the mesh now (after the last
        /// <see cref="Tick"/>, so the pulse is in it). Fill and Outline list the first tile's quads (empty with no tile). Same contract as
        /// <see cref="BlockLayers"/>: every quad of the part.</summary>
        public Color32[] PreviewLayers(PreviewPart part)
        {
            int ql = RingSegments + MaxPreviewTiles * 5;
            switch (part)
            {
                case PreviewPart.Ring: return new[] { _preview.ColorOf(0) };
                case PreviewPart.Fill: return _pvCount > 0 ? new[] { _preview.ColorOf(RingSegments) } : new Color32[0];
                case PreviewPart.Outline: return _pvCount > 0 ? new[] { _preview.ColorOf(RingSegments + 1) } : new Color32[0];
                case PreviewPart.Line: return new[] { _preview.ColorOf(ql) };
                default: return new[] { _preview.ColorOf(ql + 1) };
            }
        }

        // ---- the cast telegraph ----
        /// <summary>A Wish start under <c>Wall</c>: a line <paramref name="length"/> long across (<paramref name="x"/>,
        /// <paramref name="y"/>), square to the line from the caster, from <paramref name="startMs"/> for
        /// <paramref name="durationMs"/> (server ms). No line when the caster is within 1 u of the point.</summary>
        public void Telegraph(float casterX, float casterY, float x, float y, float length, double startMs, double durationMs)
        {
            float dx = x - casterX, dy = y - casterY, d = Mathf.Sqrt(dx * dx + dy * dy);
            if (!(d >= 1f)) { _tgOn = false; return; }
            float ux = dx / d, uy = dy / d, half = length * .5f;
            _tgAx = x - uy * half; _tgAy = y + ux * half; _tgBx = x + uy * half; _tgBy = y - ux * half;
            _tgStart = startMs; _tgDur = durationMs; _tgOn = true;
        }

        /// <summary>Advances the telegraph, the walls' looks and the preview's pulse to server render time <paramref name="renderMs"/>.</summary>
        public void Tick(double renderMs, float now, bool reducedMotion)
        {
            if (_disposed) return;
            _renderMs = renderMs;
            ApplyWalls();
            if (_tgOn && renderMs >= _tgStart + _tgDur) _tgOn = false;
            if (_tgOn)
            {
                float p = _tgDur > 0 ? Mathf.Clamp01((float)((renderMs - _tgStart) / _tgDur)) : 1f;
                var a = ArenaView.WorldPoint(_tgAx, _tgAy); var b = ArenaView.WorldPoint(_tgBx, _tgBy);
                _telegraph.Seg(0, a, b, (3f + 9f * p) * S); _telegraph.Seg(1, a, b, (1f + p) * S);
                _telegraph.Color(0, With(FaceColor, TelegraphAlpha + TelegraphGather * p)); _telegraph.Color(1, With(Color.white, TelegraphCoreAlpha));
                _telegraph.UploadShape(); _telegraph.UploadColors();
            }
            _telegraph.Active(_tgOn);
            _pulse = reducedMotion ? .5f : .5f + .5f * Mathf.Sin(now * 1000f * PulseSpeed);
            if (_pvOn) { PreviewColors(); _preview.UploadColors(); }
        }
        public bool TelegraphVisible { get { return _tgOn; } }
        /// <summary>The telegraph's ends in sim units (legacy order: <c>(x - uy*half, y + ux*half)</c>, then the other).</summary>
        public Vector2 TelegraphEndA { get { return new Vector2(_tgAx, _tgAy); } }
        public Vector2 TelegraphEndB { get { return new Vector2(_tgBx, _tgBy); } }

        // ---- the aim preview ----
        /// <summary>Draws the preview: the reach ring round the caster, a block per tile of <paramref name="cells"/> (row-major
        /// indices on a map <paramref name="mapW"/> wide), the wall's line and centre; red with no tile; hidden when
        /// <paramref name="wish"/> is not Wall.</summary>
        public void ShowPreview(in FrostWallSegment seg, IReadOnlyList<uint> cells, int mapW, float casterX, float casterY,
            float range, Color32 tint, FrostWishKind wish)
        {
            if (_disposed) return;
            if (wish != FrostWishKind.Wall || mapW <= 0) { HidePreview(); return; }
            _pvOn = true;
            _pvCount = Math.Min(cells != null ? cells.Count : 0, MaxPreviewTiles);
            for (int i = 0; i < _pvCount; i++) _pvTiles[i] = new MapTile((ushort)(cells[i] % mapW), (ushort)(cells[i] / mapW));
            _pvTint = _pvCount == 0 ? InvalidTint : tint;
            float wb = 1.5f * S, lift = Lift * S;
            for (int i = 0; i < RingSegments; i++)
            {
                float a0 = i * (2f * Mathf.PI / RingSegments), a1 = (i + 1) * (2f * Mathf.PI / RingSegments);
                _preview.Seg(i, ArenaView.WorldPoint(casterX + Mathf.Cos(a0) * range, casterY + Mathf.Sin(a0) * range),
                    ArenaView.WorldPoint(casterX + Mathf.Cos(a1) * range, casterY + Mathf.Sin(a1) * range), wb);
            }
            var up = new Vector3(0, lift, 0);
            for (int i = 0; i < MaxPreviewTiles; i++)
            {
                int q = RingSegments + i * 5;
                if (i >= _pvCount) { for (int k = 0; k < 5; k++) _preview.Collapse(q + k); continue; }
                var t = _pvTiles[i];
                var nw = ArenaView.WorldPoint(t.X * 32, t.Y * 32) + up; var ne = ArenaView.WorldPoint(t.X * 32 + 32, t.Y * 32) + up;
                var se = ArenaView.WorldPoint(t.X * 32 + 32, t.Y * 32 + 32) + up; var sw = ArenaView.WorldPoint(t.X * 32, t.Y * 32 + 32) + up;
                _preview.Quad(q, nw, ne, se, sw);
                _preview.Seg(q + 1, nw, ne, wb); _preview.Seg(q + 2, ne, se, wb); _preview.Seg(q + 3, se, sw, wb); _preview.Seg(q + 4, sw, nw, wb);
            }
            int ql = RingSegments + MaxPreviewTiles * 5;
            _preview.Seg(ql, ArenaView.WorldPoint((float)seg.X1, (float)seg.Y1) + up, ArenaView.WorldPoint((float)seg.X2, (float)seg.Y2) + up, 2f * S);
            var c = ArenaView.WorldPoint((float)seg.Cx, (float)seg.Cy) + up; float r = 3f * S;
            _preview.Quad(ql + 1, c + new Vector3(0, r), c + new Vector3(r, 0), c + new Vector3(0, -r), c + new Vector3(-r, 0));
            _preview.UploadShape();
            PreviewColors(); _preview.UploadColors();
            _preview.Active(true);
        }

        void PreviewColors()
        {
            var ring = With(_pvTint, PreviewRingAlpha);
            for (int i = 0; i < RingSegments; i++) _preview.Color(i, ring);
            var fill = With(_pvTint, PreviewFillAlpha + PreviewFillPulse * _pulse); var line = With(Color.white, PreviewOutlineAlpha + PreviewOutlinePulse * _pulse);
            for (int i = 0; i < MaxPreviewTiles; i++)
            {
                int q = RingSegments + i * 5;
                if (i >= _pvCount) continue;
                _preview.Color(q, fill); for (int k = 1; k < 5; k++) _preview.Color(q + k, line);
            }
            int ql = RingSegments + MaxPreviewTiles * 5;
            _preview.Color(ql, With(_pvTint, PreviewLineAlpha)); _preview.Color(ql + 1, With(_pvTint, PreviewDotAlpha));
        }

        readonly List<uint> _aimCells = new List<uint>(32); byte[] _aimMap;
        /// <summary>Draws (or puts away) the preview for this frame: the mirror's segment and tiles on the map the server reads
        /// (<see cref="FrostWallAim.PlanMap"/>). Display only; the cast still goes through WishAim.</summary>
        public void Aim(Session session, bool aiming, in WishAimFrame f, Color32 tint)
        {
            var map = session != null ? session.Map : null;
            if (!aiming || map == null || !f.Numbers.HasValue || f.Wish != FrostWishKind.Wall) { HidePreview(); return; }
            var n = f.Numbers.Value;
            var seg = FrostWallAim.SegmentFor(f.CasterX, f.CasterY, f.CursorX, f.CursorY, n.Range, n.MinRange, n.Length, f.Facing);
            bool locked = session.Collections.Arena.HasValue && session.Collections.Arena.Value.GatesLocked;
            _aimMap = FrostWallAim.PlanMap(map, locked, session.Collections.Fields, _aimMap);
            FrostWallAim.Cells(_aimMap, map.W, map.H, seg, n.CellReach, n.EndSlack, _aimCells);
            ShowPreview(seg, _aimCells, map.W, f.CasterX, f.CasterY, (float)n.Range, tint, f.Wish);
        }

        public void HidePreview() { _pvOn = false; _pvCount = 0; _preview.Active(false); }
        public bool PreviewVisible { get { return _pvOn; } }
        public int PreviewBlockCount { get { return _pvCount; } }
        public MapTile PreviewTile(int i) { if (i < 0 || i >= _pvCount) throw new ArgumentOutOfRangeException(nameof(i)); return _pvTiles[i]; }
        /// <summary>The tint the preview is drawn in (the given tint, or <see cref="InvalidTint"/> with no tile).</summary>
        public Color32 PreviewTint { get { return _pvTint; } }

        static Color32 With(Color32 c, float a) { return new Color32(c.r, c.g, c.b, (byte)Mathf.RoundToInt(Mathf.Clamp01(a) * 255f)); }

        /// <summary>Destroys every object the presenter made.</summary>
        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            foreach (var o in _owned)
            {
                if (o == null) continue;
                if (Application.isPlaying) UnityEngine.Object.Destroy(o); else UnityEngine.Object.DestroyImmediate(o);
            }
            _owned.Clear(); _walls.Clear(); _ordered.Clear(); _pool.Clear(); _pvOn = false; _tgOn = false;
        }
    }
}
