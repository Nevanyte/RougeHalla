// Weapon range guide (legacy WeaponRangeView): a faint shape on the ground under the local fighter showing the held weapon's reach: a lane
// for a bow (range long, twice body half-width plus arrow radius wide), a circle for a wand, a fan for melee. Colour 0xb6e6ef, a fill, a soft
// wide stroke and a thin stroke. One mesh with fixed topology, rewritten in place (no allocation per frame). Geometry is WeaponRange (library);
// sizes come from the server's weapon table and archetype row. Presentation only: it decides nothing.
using UnityEngine;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Client
{
    public sealed class WeaponRangePresenter
    {
        const int MaxPoints = 72, ArcSteps = 32, CircleSteps = 64;
        // legacy WeaponRangeView.ts:6-8, 90-92: colour, fill alphas, stroke widths and alphas
        const byte ColR = 0xb6, ColG = 0xe6, ColB = 0xef;
        const float FillAlpha = .04f, CircleFillAlpha = .018f, SoftWidth = 6f, SoftAlpha = .055f, ThinWidth = 1f, ThinAlpha = .23f;
        const int Order = 1990; // above the ground, its decor and the floor art; under the hit zones (1999) and every actor (2000+)
        const int FillVerts = 1 + MaxPoints, StripVerts = 2 * MaxPoints, TotalVerts = FillVerts + 2 * StripVerts;

        readonly GameObject _go; readonly Mesh _mesh; readonly MeshRenderer _renderer;
        readonly Vector3[] _v = new Vector3[TotalVerts]; readonly Color32[] _c = new Color32[TotalVerts];
        readonly float[] _px = new float[MaxPoints], _py = new float[MaxPoints], _nx = new float[MaxPoints], _ny = new float[MaxPoints];
        bool _dirty = true;
        float _lastX = float.NaN, _lastY, _lastAim, _lastLen, _lastWidth, _lastHalf; WeaponRangeKind _lastKind;

        /// <summary>True while a shape is being drawn.</summary>
        public bool Visible { get { return _go.activeSelf; } }
        public WeaponRangeShape Shape { get; private set; }
        /// <summary>World-space bounds of the filled shape (not the strokes) from the last drawn frame.</summary>
        public Bounds FillBounds { get; private set; }
        public Mesh Mesh { get { return _mesh; } }

        public WeaponRangePresenter(Transform root)
        {
            _go = new GameObject("Weapon range guide"); _go.transform.SetParent(root, false);
            var mf = _go.AddComponent<MeshFilter>(); _renderer = _go.AddComponent<MeshRenderer>();
            ShowcaseSprites.Initialize();
            _renderer.sharedMaterial = ShowcaseSprites.Unlit; _renderer.sortingOrder = Order;
            _renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off; _renderer.receiveShadows = false;
            _mesh = new Mesh { name = "Weapon range guide" }; _mesh.MarkDynamic();
            _mesh.SetVertices(_v); _mesh.SetColors(_c); _mesh.SetTriangles(BuildTriangles(), 0); _mesh.uv = new Vector2[TotalVerts];
            _mesh.bounds = new Bounds(Vector3.zero, new Vector3(4000, 4000, 1));
            mf.sharedMesh = _mesh; _go.SetActive(false);
        }

        /// <summary>Legacy shows the guide only in an active match, for a living local fighter with a known weapon and a finite position, and
        /// not while a hiding state (results panel, map, peek, teleport, death) is on (<paramref name="suppressed"/>).</summary>
        public static bool ShouldShow(bool inActiveMatch, bool alive, bool weaponKnown, bool suppressed, float x, float y)
        {
            return inActiveMatch && alive && weaponKnown && !suppressed && !float.IsNaN(x + y) && !float.IsInfinity(x + y);
        }

        /// <summary>Body half-width for the lane: the circle archetype's radius, the box archetype's body half-width; 0 for an unknown archetype.</summary>
        public static float BodyHalfWidth(WireArchetype[] table, byte archetype)
        {
            var row = WireArchetype.Find(table, archetype);
            if (row == null) return 0f;
            return row.Hull == 1 ? row.Bx : row.R;
        }

        public void Hide() { if (_go.activeSelf) _go.SetActive(false); }

        /// <summary>Draws the guide at the fighter's drawn position (sim units). A null row or a shapeless weapon hides it.</summary>
        public void Show(WireWeapon row, float bodyHalfWidth, float aim, bool ball, float x, float y)
        {
            var s = WeaponRange.Of(row, bodyHalfWidth, aim, ball);
            if (s.Kind == WeaponRangeKind.None) { Hide(); return; }
            Shape = s;
            if (!_go.activeSelf) { _go.SetActive(true); _dirty = true; }
            if (_dirty || x != _lastX || y != _lastY || s.Direction != _lastAim || s.Kind != _lastKind || s.Length != _lastLen || s.Width != _lastWidth || s.HalfArc != _lastHalf)
            {
                _lastX = x; _lastY = y; _lastAim = s.Direction; _lastKind = s.Kind; _lastLen = s.Length; _lastWidth = s.Width; _lastHalf = s.HalfArc; _dirty = false;
                Write(s, x, y);
            }
        }

        static int[] BuildTriangles()
        {
            var t = new int[MaxPoints * 3 + 2 * MaxPoints * 6]; int k = 0;
            for (int i = 0; i < MaxPoints; i++) { t[k++] = 0; t[k++] = 1 + i; t[k++] = 1 + (i + 1) % MaxPoints; }
            for (int s = 0; s < 2; s++)
            {
                int o = FillVerts + s * StripVerts;
                for (int i = 0; i < MaxPoints; i++)
                {
                    int a = o + 2 * i, b = o + 2 * ((i + 1) % MaxPoints); // a outer, a+1 inner
                    t[k++] = a; t[k++] = a + 1; t[k++] = b; t[k++] = b; t[k++] = a + 1; t[k++] = b + 1;
                }
            }
            return t;
        }

        // The closed outline of the shape in sim units around the fighter; a fan from the fighter fills it (all three shapes are visible from there).
        int Outline(in WeaponRangeShape s, float x, float y, out float fillAlpha)
        {
            int n = 0; fillAlpha = FillAlpha;
            float ca = Mathf.Cos(s.Direction), sa = Mathf.Sin(s.Direction);
            switch (s.Kind)
            {
                case WeaponRangeKind.Lane:
                {
                    float hw = s.Width * .5f;
                    Add(ref n, x + sa * hw, y - ca * hw);
                    Add(ref n, x + ca * s.Length + sa * hw, y + sa * s.Length - ca * hw);
                    Add(ref n, x + ca * s.Length - sa * hw, y + sa * s.Length + ca * hw);
                    Add(ref n, x - sa * hw, y + ca * hw);
                    break;
                }
                case WeaponRangeKind.Circle:
                    fillAlpha = CircleFillAlpha;
                    for (int i = 0; i < CircleSteps; i++) { float a = i * (2f * Mathf.PI / CircleSteps); Add(ref n, x + Mathf.Cos(a) * s.Length, y + Mathf.Sin(a) * s.Length); }
                    break;
                default:
                    Add(ref n, x, y);
                    for (int i = 0; i <= ArcSteps; i++) { float a = s.Direction - s.HalfArc + (2f * s.HalfArc) * i / ArcSteps; Add(ref n, x + Mathf.Cos(a) * s.Length, y + Mathf.Sin(a) * s.Length); }
                    break;
            }
            return n;
        }
        void Add(ref int n, float x, float y) { _px[n] = x; _py[n] = y; n++; }

        void Write(in WeaponRangeShape s, float x, float y)
        {
            int n = Outline(s, x, y, out float fillAlpha);
            // vertex normals of the closed outline (mitre capped), for the strokes
            for (int i = 0; i < n; i++)
            {
                int p = (i + n - 1) % n, q = (i + 1) % n;
                Edge(_px[p], _py[p], _px[i], _py[i], out float ax, out float ay); Edge(_px[i], _py[i], _px[q], _py[q], out float bx, out float by);
                float mx = ax + bx, my = ay + by, len = Mathf.Sqrt(mx * mx + my * my);
                if (len < 1e-4f) { _nx[i] = ax; _ny[i] = ay; continue; }
                mx /= len; my /= len;
                float d = Mathf.Max(.5f, mx * ax + my * ay);
                _nx[i] = mx / d; _ny[i] = my / d;
            }
            // pad to the fixed count with the last point: the extra triangles and strips collapse
            for (int i = n; i < MaxPoints; i++) { _px[i] = _px[n - 1]; _py[i] = _py[n - 1]; _nx[i] = _nx[n - 1]; _ny[i] = _ny[n - 1]; }
            var fill = Col(fillAlpha);
            _v[0] = W(x, y); _c[0] = fill;
            float minX = _v[0].x, minY = _v[0].y, maxX = minX, maxY = minY;
            for (int i = 0; i < MaxPoints; i++)
            {
                var w = W(_px[i], _py[i]); _v[1 + i] = w; _c[1 + i] = fill;
                if (w.x < minX) minX = w.x; if (w.x > maxX) maxX = w.x; if (w.y < minY) minY = w.y; if (w.y > maxY) maxY = w.y;
            }
            FillBounds = new Bounds(new Vector3((minX + maxX) * .5f, (minY + maxY) * .5f, 0), new Vector3(maxX - minX, maxY - minY, 0));
            Strip(FillVerts, SoftWidth, Col(SoftAlpha));
            Strip(FillVerts + StripVerts, ThinWidth, Col(ThinAlpha));
            _mesh.SetVertices(_v); _mesh.SetColors(_c);
        }

        void Strip(int o, float width, Color32 col)
        {
            float h = width * .5f;
            for (int i = 0; i < MaxPoints; i++)
            {
                _v[o + 2 * i] = W(_px[i] + _nx[i] * h, _py[i] + _ny[i] * h); _v[o + 2 * i + 1] = W(_px[i] - _nx[i] * h, _py[i] - _ny[i] * h);
                _c[o + 2 * i] = col; _c[o + 2 * i + 1] = col;
            }
        }

        static void Edge(float x0, float y0, float x1, float y1, out float nx, out float ny)
        {
            float dx = x1 - x0, dy = y1 - y0, l = Mathf.Sqrt(dx * dx + dy * dy);
            if (l < 1e-6f) { nx = 0; ny = 0; return; }
            nx = dy / l; ny = -dx / l;
        }
        static Vector3 W(float x, float y) { return ArenaView.WorldPoint(x, y); }
        static Color32 Col(float a) { return new Color32(ColR, ColG, ColB, (byte)Mathf.RoundToInt(Mathf.Clamp01(a) * 255f)); }
    }
}
