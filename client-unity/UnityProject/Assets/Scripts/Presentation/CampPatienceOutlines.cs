using System.Collections.Generic;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using TMPro;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>The dashed patience outline and "PATIENCE RANGE" label of every living camp (W11), as legacy CampPatience.ts. Edges are built once per
    /// map (per MapBlob instance) from <see cref="MapBlob.Patience"/>; a frame changes visibility only. Pooled; a steady frame allocates nothing.
    /// Presentation only.</summary>
    public sealed class CampPatienceOutlines
    {
        const int LineOrder = 1230, LabelOrder = 1231;
        const float LabelSize = 1.6f;

        sealed class Camp
        {
            public bool Built; public int Edges; public bool Shown;
            public GameObject Line, Label; public Mesh Mesh; public Vector3 LabelAt;
        }

        readonly Transform _root;
        readonly List<PatienceEdge> _edges = new List<PatienceEdge>();
        MapBlob _map; Camp[] _camps = new Camp[0];
        int _builds, _shown;
        TMP_FontAsset _font;

        public CampPatienceOutlines(Transform root) { _root = root; }

        /// <summary>Per frame. <paramref name="map"/> may be null or carry no patience plane (nothing is drawn). <paramref name="camps"/> are the live camp rows
        /// (index i is map camp i).</summary>
        public void Update(MapBlob map, IReadOnlyList<CampView> camps, MatchPhase? phase, bool training, ICampAttacked attacked)
        {
            if (!ReferenceEquals(map, _map)) { Reset(); _map = map; if (map != null && map.Patience != null) _camps = new Camp[map.Camps.Length]; }
            if (_map == null || _map.Patience == null || camps == null) { HideAll(); return; }
            int n = Mathf.Min(_camps.Length, camps.Count);
            for (int i = 0; i < _camps.Length; i++)
            {
                bool want = i < n && PatienceOutline.Visible(phase, training, camps[i].Alive);
                var c = _camps[i];
                if (want && c == null) c = _camps[i] = new Camp();
                if (want && !c.Built) Build(c, i);
                want = want && c.Edges > 0;
                if (c == null || c.Shown == want) continue;
                c.Shown = want; _shown += want ? 1 : -1;
                c.Line.SetActive(want); c.Label.SetActive(want);
            }
        }

        /// <summary>Edge lists built since construction: one per camp that has tiles, per distinct map. Unchanged by a frame where only visibility moved.</summary>
        public int Builds { get { return _builds; } }
        /// <summary>Camps whose outline and label are visible now.</summary>
        public int Shown { get { return _shown; } }
        public bool IsShown(int campIndex) { var c = At(campIndex); return c != null && c.Shown; }
        /// <summary>The label text of camp <paramref name="campIndex"/> when shown, else null.</summary>
        public string LabelAt(int campIndex) { return IsShown(campIndex) ? PatienceOutline.LabelText : null; }
        /// <summary>Segments in camp <paramref name="campIndex"/>'s outline (0 when it has none).</summary>
        public int EdgeCount(int campIndex) { var c = At(campIndex); return c != null ? c.Edges : 0; }
        /// <summary>World position of the label: the camp centre, 25 screen px (25 / 32 world units) lower.</summary>
        public Vector3 LabelPosition(int campIndex) { var c = At(campIndex); return c != null && c.Built && c.Edges > 0 ? c.LabelAt : Vector3.zero; }

        Camp At(int i) { return i >= 0 && i < _camps.Length ? _camps[i] : null; }

        void HideAll()
        {
            if (_shown == 0) return;
            for (int i = 0; i < _camps.Length; i++)
            {
                var c = _camps[i];
                if (c != null && c.Shown) { c.Shown = false; c.Line.SetActive(false); c.Label.SetActive(false); }
            }
            _shown = 0;
        }

        void Reset()
        {
            for (int i = 0; i < _camps.Length; i++)
            {
                var c = _camps[i]; if (c == null || !c.Built || c.Edges == 0) continue;
                Kill(c.Line); Kill(c.Label); Kill(c.Mesh);
            }
            _camps = new Camp[0]; _shown = 0;
        }

        static void Kill(Object o)
        {
            if (o == null) return;
            if (Application.isPlaying) Object.Destroy(o); else Object.DestroyImmediate(o);
        }

        void Build(Camp c, int index)
        {
            c.Built = true;
            PatienceOutline.Edges(_map.Patience, _map.W, _map.H, index + 1, _edges);
            c.Edges = _edges.Count;
            if (c.Edges == 0) return;
            _builds++;
            var verts = new List<Vector3>(c.Edges * 12); var cols = new List<Color32>(c.Edges * 12); var tris = new List<int>(c.Edges * 18);
            var rim = Rgb(PatienceOutline.RimRgb, PatienceOutline.RimAlpha); var dash = Rgb(PatienceOutline.DashRgb, PatienceOutline.DashAlpha);
            for (int pass = 0; pass < 2; pass++)   // rim under, dashes over
                for (int i = 0; i < _edges.Count; i++)
                {
                    var e = _edges[i];
                    var a = ArenaView.WorldPoint(e.X0 * PatienceOutline.TileSize, e.Y0 * PatienceOutline.TileSize);
                    var b = ArenaView.WorldPoint(e.X1 * PatienceOutline.TileSize, e.Y1 * PatienceOutline.TileSize);
                    if (pass == 0) { Quad(verts, cols, tris, a, b, PatienceOutline.RimWidth / 32f, rim); continue; }
                    float len = (b - a).magnitude * 32f, step = PatienceOutline.DashOn + PatienceOutline.DashOff;
                    for (float t = 0; t < len; t += step)
                    {
                        float t1 = Mathf.Min(t + PatienceOutline.DashOn, len);
                        Quad(verts, cols, tris, Vector3.Lerp(a, b, t / len), Vector3.Lerp(a, b, t1 / len), PatienceOutline.DashWidth / 32f, dash);
                    }
                }
            c.Mesh = new Mesh { name = "Patience outline" };
            c.Mesh.SetVertices(verts); c.Mesh.SetColors(cols); c.Mesh.SetTriangles(tris, 0);
            c.Mesh.uv = new Vector2[verts.Count];
            c.Mesh.RecalculateBounds();
            c.Line = new GameObject("Camp patience outline " + (index + 1)); c.Line.transform.SetParent(_root, false);
            c.Line.AddComponent<MeshFilter>().sharedMesh = c.Mesh;
            var mr = c.Line.AddComponent<MeshRenderer>(); ShowcaseSprites.Initialize();
            mr.sharedMaterial = ShowcaseSprites.Unlit; mr.sortingOrder = LineOrder;
            c.Line.SetActive(false);

            var camp = _map.Camps[index];
            c.LabelAt = ArenaView.WorldPoint(camp.X, camp.Y) + new Vector3(0, -PatienceOutline.LabelDropPx / 32f, 0);
            c.Label = new GameObject("Camp patience label " + (index + 1)); c.Label.transform.SetParent(_root, false);
            c.Label.transform.position = c.LabelAt;
            var text = c.Label.AddComponent<TextMeshPro>();
            if (_font == null) _font = Resources.Load<TMP_FontAsset>("Showcase/NunitoBold");
            text.font = _font != null ? _font : TMP_Settings.defaultFontAsset;
            text.alignment = TextAlignmentOptions.Center; text.enableWordWrapping = false; text.fontStyle = FontStyles.Bold;
            text.fontSharedMaterial = OverheadIndicators.OutlinedMaterial(text.font); text.rectTransform.sizeDelta = new Vector2(6f, .5f);
            text.fontSize = LabelSize; text.text = PatienceOutline.LabelText; text.color = (Color)Rgb(PatienceOutline.LabelRgb, 1f);
            text.GetComponent<MeshRenderer>().sortingOrder = LabelOrder;
            c.Label.SetActive(false);
        }

        static Color32 Rgb(uint rgb, float alpha)
        {
            return new Color32((byte)(rgb >> 16), (byte)(rgb >> 8), (byte)rgb, (byte)Mathf.RoundToInt(alpha * 255f));
        }

        /// <summary>A thin axis-aligned quad along a to b, <paramref name="width"/> world units across.</summary>
        static void Quad(List<Vector3> v, List<Color32> col, List<int> tri, Vector3 a, Vector3 b, float width, Color32 colour)
        {
            float h = width * .5f;
            Vector3 d = b - a; Vector3 o = Mathf.Abs(d.x) >= Mathf.Abs(d.y) ? new Vector3(0, h, 0) : new Vector3(h, 0, 0);
            int k = v.Count;
            v.Add(a - o); v.Add(a + o); v.Add(b + o); v.Add(b - o);
            for (int i = 0; i < 4; i++) col.Add(colour);
            tri.Add(k); tri.Add(k + 1); tri.Add(k + 2); tri.Add(k); tri.Add(k + 2); tri.Add(k + 3);
        }
    }
}
