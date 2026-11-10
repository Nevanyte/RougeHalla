// Melee hit-zone indicator: a soft translucent white sector on the ground showing the area a delivered swing can hit (reach and arc from
// the WeaponShapes provider, aimed along the swing's angle, centred on the attacker raised by its chest height in archetype mode), a
// brighter band sweeping across it through the swing, then a quick fade. Pooled meshes with fixed topology (no per-frame allocation);
// drawn on the ground layer under actors. Nothing is drawn when the provider has no row for the weapon, for an actor that is not
// delivered, or when ?fx.hitzone=0. Presentation only: it reads the delivered Swing fx and simulates nothing.
using System.Collections.Generic;
using UnityEngine;
using Roguehalla.Net;
using Roguehalla.Net.Ui;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    public sealed class HitZonePresenter
    {
        const int Arc = 24, Rings = 3, Order = 1999; // over the ground, its decor and the temple floor art (1235 vanished on the Holy floor, UI lab), under every actor (2000+)
        /// <summary>Opacity of the dark edge line (the light one is <see cref="HitZoneModel.EdgeAlpha"/>): together they read on every ground (ActorOutlineEditModeTests).</summary>
        public const float EdgeDarkAlpha = .9f;
        const float EdgeLight = 1.3f, EdgeDark = 2.8f; // sim units: a light hairline outside a dark one, so the extent reads on any ground (the fill alpha is unchanged)
        // base fan (centre + rings) + 2 outline strips (dark, light) each = arc strip + two side strips
        const int FanVerts = 1 + Rings * (Arc + 1), StripVerts = 2 * (Arc + 1) + 8, TotalVerts = FanVerts + 2 * StripVerts;

        sealed class Zone
        {
            public GameObject Go; public Mesh Mesh; public MeshRenderer Renderer;
            public Vector3[] V = new Vector3[TotalVerts]; public Color32[] C = new Color32[TotalVerts];
            public bool Live, Windup; public uint Owner; public float Start, Ox, Oy, Reach, Half, Angle, Ms;
        }

        readonly Transform _root;
        readonly System.Func<uint, bool> _contains;
        readonly List<Zone> _zones = new List<Zone>(HitZoneModel.MaxZones);
        readonly Stack<Zone> _free = new Stack<Zone>();
        readonly Dictionary<uint, byte> _archetype = new Dictionary<uint, byte>();
        WireArchetype[] _tableArray = System.Array.Empty<WireArchetype>();
        int[] _tris;
        readonly Dictionary<uint, Zone> _windups = new Dictionary<uint, Zone>();
        public delegate bool PositionOf(uint id, out float x, out float y);
        /// <summary>Where a delivered actor stands now, sim units (the windup telegraph follows its attacker).</summary>
        public PositionOf Position;
        public bool Enabled { get; private set; }
        public int LiveCount { get { return _zones.Count; } }
        public static bool DemoRequested { get; private set; }

        public HitZonePresenter(Transform root, System.Func<uint, bool> delivered, string search)
        {
            _root = root; _contains = delivered;
            HitZoneModel.ParseFlags(search, out bool on, out bool demo);
            Enabled = on; DemoRequested = demo;
            if (demo) FillDemoShapes();
        }

        /// <summary>Test seam: explicit enable.</summary>
        public void SetEnabled(bool on) { Enabled = on; if (!on) Clear(); }

        /// <summary>Diagnostics only (<c>?hitzone.demo=1</c>): TEST DATA, never on by default. Fills the provider with the Rust values read from
        /// crates/rh-sim/src/content.rs: sword 112 / PI/4 (lines 256-257), shield 96 / PI/3 (283-284), axe 112 / PI/2 (292-293), fists 72 / PI/3 (301-302).
        /// Weapon ids: Sword 0, Bow 1, Wand 2, Shield 3, Axe 4, Fists 5. The coordinator replaces this with the Welcome table via WeaponShapes.Set.</summary>
        static void FillDemoShapes()
        {
            float pi = Mathf.PI;
            WeaponShapes.Set(new List<WeaponShape> {
                new WeaponShape { Weapon = 0, Kind = 1, Reach = 112f, HalfArc = pi / 4f },
                new WeaponShape { Weapon = 1, Kind = 2 }, new WeaponShape { Weapon = 2, Kind = 2 },
                new WeaponShape { Weapon = 3, Kind = 1, Reach = 96f, HalfArc = pi / 3f },
                new WeaponShape { Weapon = 4, Kind = 1, Reach = 112f, HalfArc = pi / 2f },
                new WeaponShape { Weapon = 5, Kind = 1, Reach = 72f, HalfArc = pi / 3f } });
        }

        public void SetTable(WireArchetype[] table) { _tableArray = table ?? System.Array.Empty<WireArchetype>(); }
        public void NoteActor(uint id, byte archetype) { _archetype[id] = archetype; }

        /// <summary>A delivered swing. Returns true when a zone was started.</summary>
        public bool Swing(uint by, byte weapon, float x, float y, float angle, float now)
        {
            CancelWindup(by);                                  // the swing lands: the telegraph gives way to the swing
            if (!Enabled || _contains == null || !_contains(by)) return false;
            if (!WeaponShapes.TryGet(weapon, out var shape)) return false;
            if (float.IsNaN(x + y + angle) || float.IsInfinity(x + y + angle)) return false;
            if (_zones.Count >= HitZoneModel.MaxZones) return false;
            var z = _free.Count > 0 ? _free.Pop() : Create();
            Place(z, by, x, y);
            z.Reach = shape.Reach; z.Half = shape.HalfArc; z.Angle = angle; z.Start = now; z.Live = true;
            z.Go.SetActive(true); _zones.Add(z);
            Write(z, 0f, false);
            return true;
        }

        void Place(Zone z, uint by, float x, float y)
        {
            byte hull = 0, chest = 0;
            if (_archetype.TryGetValue(by, out byte id)) { var row = WireArchetype.Find(_tableArray, id); if (row != null) { hull = row.Hull; chest = row.Chest; } }
            HitZoneModel.Origin(x, y, hull, chest, out z.Ox, out z.Oy);
        }

        /// <summary>
        /// The enemy (or own) wind-up telegraph (B13): the weapon's real zone, drawn from the Windup fx until the swing lands, a Cancel or a Stagger.
        /// The band sweeps once through the sector over the wind-up, so the player sees when the swing comes. Melee arcs only.
        /// </summary>
        public bool Windup(uint by, byte weapon, float angle, float ms, float now)
        {
            CancelWindup(by);
            if (!Enabled || _contains == null || !_contains(by) || !(ms > 0f) || float.IsNaN(angle) || float.IsInfinity(angle)) return false;
            if (!WeaponShapes.TryGet(weapon, out var shape) || _zones.Count >= HitZoneModel.MaxZones || Position == null || !Position(by, out float x, out float y)) return false;
            var z = _free.Count > 0 ? _free.Pop() : Create();
            Place(z, by, x, y);
            z.Reach = shape.Reach; z.Half = shape.HalfArc; z.Angle = angle; z.Start = now; z.Live = true; z.Windup = true; z.Owner = by; z.Ms = ms;
            z.Go.SetActive(true); _zones.Add(z); _windups[by] = z; Write(z, 0f, false);
            return true;
        }

        public void CancelWindup(uint id)
        {
            if (!_windups.TryGetValue(id, out var z)) return;
            _windups.Remove(id); int i = _zones.IndexOf(z); if (i >= 0) Release(i);
        }

        public bool WindupLive(uint id) { return _windups.ContainsKey(id); }

        public void Tick(float now, bool reduced)
        {
            for (int i = _zones.Count - 1; i >= 0; i--)
            {
                var z = _zones[i]; float age = (now - z.Start) * 1000f;
                if (z.Windup)
                {
                    if (!Indicators.WindupLive(age, z.Ms) || (_contains != null && !_contains(z.Owner))) { _windups.Remove(z.Owner); Release(i); continue; }
                    if (Position != null && Position(z.Owner, out float wx, out float wy)) Place(z, z.Owner, wx, wy);
                    Write(z, Indicators.WindupProgress(age, z.Ms) * HitZoneModel.SweepMs, reduced); continue;
                }
                if (!HitZoneModel.Alive(age)) { Release(i); continue; }
                Write(z, age, reduced);
            }
        }

        public void Clear() { _windups.Clear(); for (int i = _zones.Count - 1; i >= 0; i--) Release(i); }

        /// <summary>Drops a departed actor's bookkeeping and any zone it started is left to fade (it was drawn while delivered).</summary>
        public void Forget(uint id) { _archetype.Remove(id); }

        void Release(int i) { var z = _zones[i]; _zones.RemoveAt(i); z.Live = false; z.Windup = false; z.Go.SetActive(false); _free.Push(z); }

        Zone Create()
        {
            var z = new Zone();
            z.Go = new GameObject("Melee hit zone"); z.Go.transform.SetParent(_root, false);
            var mf = z.Go.AddComponent<MeshFilter>(); z.Renderer = z.Go.AddComponent<MeshRenderer>();
            ShowcaseSprites.Initialize();
            z.Renderer.sharedMaterial = ShowcaseSprites.Unlit; z.Renderer.sortingOrder = Order;
            z.Renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off; z.Renderer.receiveShadows = false;
            z.Mesh = new Mesh { name = "Hit zone" }; z.Mesh.MarkDynamic();
            if (_tris == null) _tris = BuildTriangles();
            z.Mesh.SetVertices(z.V); z.Mesh.SetColors(z.C); z.Mesh.SetTriangles(_tris, 0);
            z.Mesh.uv = new Vector2[TotalVerts];
            z.Mesh.bounds = new Bounds(Vector3.zero, new Vector3(4000, 4000, 1));
            mf.sharedMesh = z.Mesh; z.Go.SetActive(false);
            return z;
        }

        static int[] BuildTriangles()
        {
            var t = new List<int>();
            for (int i = 0; i < Arc; i++) { t.Add(0); t.Add(1 + i); t.Add(2 + i); }
            for (int r = 0; r < Rings - 1; r++)
                for (int i = 0; i < Arc; i++)
                {
                    int a = 1 + r * (Arc + 1) + i, b = a + 1, c = 1 + (r + 1) * (Arc + 1) + i, d = c + 1;
                    t.Add(a); t.Add(c); t.Add(b); t.Add(b); t.Add(c); t.Add(d);
                }
            for (int s = 0; s < 2; s++)
            {
                int o = FanVerts + s * StripVerts;
                for (int i = 0; i < Arc; i++) { int a = o + i * 2; t.Add(a); t.Add(a + 1); t.Add(a + 2); t.Add(a + 2); t.Add(a + 1); t.Add(a + 3); }
                for (int k = 0; k < 2; k++) { int a = o + 2 * (Arc + 1) + k * 4; t.Add(a); t.Add(a + 1); t.Add(a + 2); t.Add(a + 2); t.Add(a + 1); t.Add(a + 3); }
            }
            return t.ToArray();
        }

        static Vector3 P(float x, float y) { return ArenaView.WorldPoint(x, y); }

        void Write(Zone z, float age, bool reduced)
        {
            float fade = HitZoneModel.Fade(age), centre = HitZoneModel.BandCentre(age, reduced);
            int vi = 0;
            // Fan: centre then rings. The band lights the ring vertices it covers (a wedge following the weapon).
            z.V[vi] = P(z.Ox, z.Oy); z.C[vi++] = Tint(HitZoneModel.BaseAlpha * .55f * FillGain * fade);
            for (int r = 1; r <= Rings; r++)
            {
                float rr = r / (float)Rings, radius = z.Reach * rr;
                for (int i = 0; i <= Arc; i++)
                {
                    float k = i / (float)Arc;
                    HitZoneModel.ArcPoint(z.Ox, z.Oy, radius, z.Half, z.Angle, k, out float px, out float py);
                    z.V[vi] = P(px, py);
                    float a = HitZoneModel.BaseAlpha * (.6f + .4f * rr) + HitZoneModel.BandAlpha * HitZoneModel.BandWeight(k, centre) * rr;
                    z.C[vi++] = Tint(a * FillGain * fade);
                }
            }
            for (int s = 0; s < 2; s++)
            {
                float w = s == 0 ? EdgeDark : EdgeLight;
                Color32 col = s == 0 ? Dark(EdgeDarkAlpha * fade) : White(HitZoneModel.EdgeAlpha * fade);
                for (int i = 0; i <= Arc; i++)
                {
                    float k = i / (float)Arc;
                    HitZoneModel.ArcPoint(z.Ox, z.Oy, z.Reach, z.Half, z.Angle, k, out float ox2, out float oy2);
                    HitZoneModel.ArcPoint(z.Ox, z.Oy, z.Reach - w, z.Half, z.Angle, k, out float ix, out float iy);
                    z.V[vi] = P(ox2, oy2); z.C[vi++] = col; z.V[vi] = P(ix, iy); z.C[vi++] = col;
                }
                for (int side = 0; side < 2; side++)
                {
                    float a = z.Angle + (side == 0 ? -z.Half : z.Half), ca = Mathf.Cos(a), sa = Mathf.Sin(a);
                    float inx = -sa * (side == 0 ? 1 : -1), iny = ca * (side == 0 ? 1 : -1); // perpendicular pointing into the sector
                    float ex = z.Ox + ca * z.Reach, ey = z.Oy + sa * z.Reach;
                    z.V[vi] = P(z.Ox, z.Oy); z.C[vi++] = col; z.V[vi] = P(z.Ox + inx * w, z.Oy + iny * w); z.C[vi++] = col;
                    z.V[vi] = P(ex, ey); z.C[vi++] = col; z.V[vi] = P(ex + inx * w, ey + iny * w); z.C[vi++] = col;
                }
            }
            z.Mesh.SetVertices(z.V); z.Mesh.SetColors(z.C);
        }

        // The fill is a cool steel blue, not white: white at .1 alpha vanished on sand and snow (UI lab). A dark outer edge and a light inner edge outline it on any ground.
        const float FillGain = 2.6f;
        static Color32 Tint(float a) { return new Color32(0x6f, 0x9f, 0xd6, (byte)Mathf.RoundToInt(Mathf.Clamp01(a) * 255f)); }
        static Color32 White(float a) { return new Color32(255, 255, 255, (byte)Mathf.RoundToInt(Mathf.Clamp01(a) * 255f)); }
        static Color32 Dark(float a) { var d = UiTheme.Current.OutlineDark; return new Color32(d.r, d.g, d.b, (byte)Mathf.RoundToInt(Mathf.Clamp01(a) * 255f)); }
    }
}
