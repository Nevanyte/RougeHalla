using System.Collections.Generic;
using UnityEngine;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    /// <summary>A light site: a cluster of terrain tiles (lava, ice, bog, light) or a single lantern prop (Lantern = true, Kind None).</summary>
    public struct TerrainCluster { public float X, Y; public int Count; public TerrainKind Kind; public bool Lantern; public float Lift; public bool TempleLamp; }

    /// <summary>
    /// Pure planner for terrain-generated accent lights. Clusters (one per 8x8-tile cell and terrain kind) are built once at map
    /// load. <see cref="Select"/> culls them against the camera rectangle plus a margin first, then applies the hard cap,
    /// nearest and largest first. No allocation after Build.
    /// </summary>
    public sealed class AccentLightPlanner
    {
        public const int CellTiles = 8, MinTiles = 4;
        readonly List<TerrainCluster> _clusters = new List<TerrainCluster>(256);
        public IList<TerrainCluster> Clusters { get { return _clusters; } }
        public int Count { get { return _clusters.Count; } }

        public void Build(byte[] terrain, int w, int h)
        {
            _clusters.Clear(); if (terrain == null || terrain.Length != w * h) return;
            int cw = (w + CellTiles - 1) / CellTiles, ch = (h + CellTiles - 1) / CellTiles;
            var kinds = new[] { TerrainKind.Lava, TerrainKind.Ice, TerrainKind.Bog, TerrainKind.Light };
            foreach (var kind in kinds)
            {
                if (!RegionAtmosphereTable.AccentFor(kind).Enabled) continue;
                var count = new int[cw * ch]; var sx = new float[cw * ch]; var sy = new float[cw * ch];
                for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
                {
                    if (terrain[y * w + x] != (byte)kind) continue;
                    int c = (y / CellTiles) * cw + x / CellTiles; count[c]++; sx[c] += x + .5f; sy[c] += y + .5f;
                }
                for (int c = 0; c < count.Length; c++)
                    if (count[c] >= MinTiles) _clusters.Add(new TerrainCluster { X = sx[c] / count[c], Y = sy[c] / count[c], Count = count[c], Kind = kind });
            }
        }

        /// <summary>Add one lantern prop as a light site (tile-space position; <paramref name="lift"/> raises the light to the lamp head, in world units).</summary>
        public void AddLantern(float tx, float ty, float lift) { _clusters.Add(new TerrainCluster { X = tx, Y = ty, Count = 1, Kind = TerrainKind.None, Lantern = true, Lift = lift }); }

        /// <summary>Add a temple lamp stand as a light site (warm gold spec).</summary>
        public void AddTempleLamp(float tx, float ty, float lift) { _clusters.Add(new TerrainCluster { X = tx, Y = ty, Count = 1, Kind = TerrainKind.None, Lantern = true, Lift = lift, TempleLamp = true }); }

        /// <summary>Indices of the clusters to light for a tile-space camera rect (x right, y down): inside rect + margin, best first, at most
        /// min(cap, result.Length). Returns how many were written.</summary>
        public int Select(float minTx, float minTy, float maxTx, float maxTy, float margin, int cap, int[] result)
        {
            cap = Mathf.Min(cap, result.Length); if (cap <= 0) return 0;
            float cx = (minTx + maxTx) * .5f, cy = (minTy + maxTy) * .5f; int n = 0;
            var score = _score; if (score.Length < result.Length) score = _score = new float[result.Length];
            for (int i = 0; i < _clusters.Count; i++)
            {
                var c = _clusters[i];
                if (c.X < minTx - margin || c.X > maxTx + margin || c.Y < minTy - margin || c.Y > maxTy + margin) continue;   // cull first
                float dx = c.X - cx, dy = c.Y - cy, s = Mathf.Sqrt(dx * dx + dy * dy) - (c.Lantern ? 1.5f : .6f * Mathf.Sqrt(c.Count));        // lower is better
                int at = n < cap ? n : cap;
                while (at > 0 && score[at - 1] > s) { if (at < cap) { score[at] = score[at - 1]; result[at] = result[at - 1]; } at--; }
                if (at >= cap) continue;
                score[at] = s; result[at] = i; if (n < cap) n++;
            }
            return n;
        }
        float[] _score = new float[8];
    }

    /// <summary>
    /// Pooled terrain and lantern lights placed on the planner's selection (nearest and largest first). Every selected site fades in and out and
    /// flickers; it is written into <see cref="LocalLightField"/> (the analytic lights the ground, walls and props shade with: relief, wall shadows,
    /// cookies) and, for the few best ranked sites, also drives a pooled Light2D that lights actors. While the analytic lights are on the Light2D uses
    /// blend style 2 (ignored by the region shaders, so surfaces are not lit twice); with them off it uses style 0 and everything is lit as before.
    /// </summary>
    public sealed class AccentLights
    {
        const float FadeSeconds = .7f;
        /// <summary>Output gain of an accent light in the analytic field (the Light2D twin keeps the table intensity).</summary>
        public const float AnalyticGain = .62f;
        sealed class Slot { public ShowcasePointLight Light; public int Cluster = -1, Rank = 99; public float Alpha; public bool Wanted; public TerrainCluster C; public AccentLightSpec Spec; public float Phase; public Vector3 Pos; }
        readonly Slot[] _slots = new Slot[LocalLightField.Max];
        readonly int[] _pick = new int[LocalLightField.Max];
        readonly AccentLightPlanner _planner = new AccentLightPlanner();
        Transform _root; int _lastCellX = int.MinValue, _lastCellY = int.MinValue, _lastCap = -1; bool _dirty = true, _lastAnalytic;
        public AccentLightPlanner Planner { get { return _planner; } }
        /// <summary>Lights currently enabled (alpha above zero).</summary>
        public int ActiveCount { get { int n = 0; foreach (var s in _slots) if (s != null && s.Alpha > .01f) n++; return n; } }
        /// <summary>Pooled Light2D twins currently enabled (the actors' lighting; at most <see cref="AtmosphereQuality.EffectiveMaxLights"/>).</summary>
        public int ActiveLight2D { get { int n = 0; foreach (var s in _slots) if (s != null && s.Light != null && s.Light.RequestedVisible) n++; return n; } }
        /// <summary>Blend style of the live Light2D twins (2 while the analytic field is on).</summary>
        public int Light2DBlendStyle { get { foreach (var s in _slots) if (s != null && s.Light != null) return s.Light.BlendStyle; return _lastAnalytic ? 2 : 0; } }
        public const float CullMargin = 6f;

        public void Initialize(Transform parent) { _root = new GameObject("Accent lights").transform; _root.SetParent(parent, false); }
        public void Load(MapBlob map)
        {
            _planner.Build(RegionMap.EffectiveTerrain(map), map.W, map.H);
            if (RegionAtmosphereTable.AccentFor(TerrainKind.None).Enabled && map.Regions != null)
                foreach (var pl in RegionProps.Scatter(map)) if (pl.Art == "sent.lantern") _planner.AddLantern(pl.X, pl.Y, 1.05f);
            var temple = TempleLayout.For(map);
            if (temple.Found) foreach (var lamp in temple.Lamps) _planner.AddTempleLamp(lamp.x, lamp.y, .85f);
            _dirty = true; _lastCellX = int.MinValue;
        }
        public void MarkDirty() { _dirty = true; }

        /// <summary>Output gain by site kind: lava is huge and already glows through the ground shader (low gain); lanterns and temple lamps need more to read on their floors.</summary>
        public static float GainFor(in TerrainCluster c)
        {
            if (c.TempleLamp) return 1.0f;
            if (c.Lantern) return .6f;
            switch (c.Kind) { case TerrainKind.Lava: return .24f; case TerrainKind.Ice: return .5f; case TerrainKind.Bog: return .45f; case TerrainKind.Light: return .5f; default: return AnalyticGain; }
        }

        /// <summary>Height of the light above the ground (tiles) and its cookie / shadow behaviour, by kind of site.</summary>
        public static void Shape(in TerrainCluster c, out float height, out int cookie, out bool shadow)
        {
            if (c.TempleLamp) { height = c.Lift > 0 ? c.Lift : .85f; cookie = LocalLightField.CookieGlass; shadow = true; return; }
            if (c.Lantern) { height = c.Lift > 0 ? c.Lift : 1.05f; cookie = LocalLightField.CookieGrate; shadow = true; return; }
            switch (c.Kind)
            {
                case TerrainKind.Lava: height = .55f; cookie = LocalLightField.CookieNone; shadow = true; return;
                case TerrainKind.Bog: height = .45f; cookie = LocalLightField.CookieDapple; shadow = false; return;
                case TerrainKind.Light: height = .8f; cookie = LocalLightField.CookieDapple; shadow = false; return;
                default: height = .9f; cookie = LocalLightField.CookieNone; shadow = false; return;     // ice glints
            }
        }

        /// <summary>Per frame. Re-plans only when the camera crosses a cell boundary (or a cap changes); otherwise just fades and flickers.
        /// When the analytic field is on, every live light is also written to <see cref="LocalLightField"/> (call <see cref="LocalLightField.Begin"/> first).</summary>
        public void Tick(float camTx, float camTy, float halfW, float halfH, float dt, float time)
        {
            bool analytic = AtmosphereQuality.AnalyticLights;
            int l2cap = AtmosphereQuality.ActorsAnalytic ? 0 : AtmosphereQuality.EffectiveMaxLights;      // characters take the analytic lights: no Light2D twins needed
            int cap = Mathf.Max(l2cap, analytic ? AtmosphereQuality.EffectiveLocalLights : 0);
            int cellX = Mathf.FloorToInt(camTx / AccentLightPlanner.CellTiles), cellY = Mathf.FloorToInt(camTy / AccentLightPlanner.CellTiles);
            if (_dirty || cellX != _lastCellX || cellY != _lastCellY || cap != _lastCap)
            {
                _dirty = false; _lastCellX = cellX; _lastCellY = cellY; _lastCap = cap;
                Plan(camTx, camTy, halfW, halfH, cap);
            }
            if (analytic != _lastAnalytic) { _lastAnalytic = analytic; foreach (var s in _slots) if (s != null && s.Light != null) s.Light.SetBlendStyle(analytic ? 2 : 0); }
            for (int i = 0; i < _slots.Length; i++)
            {
                var s = _slots[i]; if (s == null) continue;
                s.Alpha = Mathf.MoveTowards(s.Alpha, s.Wanted ? 1f : 0f, dt / FadeSeconds);
                if (s.Alpha <= 0f && !s.Wanted) { if (s.Cluster >= 0) { s.Cluster = -1; s.Rank = 99; } if (s.Light != null) s.Light.SetVisible(false); continue; }
                // Layered flicker: slow breathing, mid-rate wobble, and a crackle from smooth noise (fire and lanterns).
                float crackle = (Mathf.PerlinNoise(time * 3.3f + s.Phase, s.Phase * .37f) - .5f) * .32f;
                float flick = 1f + s.Spec.Flicker * (.14f * Mathf.Sin(time * 5.3f + s.Phase) + .09f * Mathf.Sin(time * 11.7f + s.Phase * 2.1f) + .06f * Mathf.Sin(time * 2.1f + s.Phase * .7f) + crackle);
                float radius = s.Spec.Radius * (s.C.Lantern ? 1f : 1f + .06f * Mathf.Sqrt(s.C.Count));
                float intensity = s.Spec.Intensity * s.Alpha * flick;
                if (s.Rank < l2cap)
                {
                    if (s.Light == null) { s.Light = NewLight(s.Pos, analytic); }
                    s.Light.Configure(s.Spec.Color, intensity, radius * .15f, radius, .55f, false);
                    s.Light.SetVisible(true);
                }
                else if (s.Light != null) s.Light.SetVisible(false);
                if (analytic && s.Rank < AtmosphereQuality.EffectiveLocalLights)
                {
                    Shape(s.C, out float h, out int cookie, out bool shadow);
                    float k = intensity * GainFor(s.C);
                    LocalLightField.Add(s.C.X, s.C.Y, h, radius, s.Spec.Color.r * k, s.Spec.Color.g * k, s.Spec.Color.b * k, cookie, shadow);
                }
            }
        }

        void Plan(float camTx, float camTy, float halfW, float halfH, int cap)
        {
            int n = cap > 0 ? _planner.Select(camTx - halfW, camTy - halfH, camTx + halfW, camTy + halfH, CullMargin, cap, _pick) : 0;
            foreach (var s in _slots) if (s != null) s.Wanted = false;
            for (int p = 0; p < n; p++)
            {
                int ci = _pick[p]; var slot = FindSlot(ci);
                if (slot == null) continue;
                slot.Wanted = true; slot.Rank = p;
            }
        }

        Slot FindSlot(int cluster)
        {
            Slot free = null; int freeAt = -1;
            for (int i = 0; i < _slots.Length; i++)
            {
                var s = _slots[i];
                if (s != null && s.Cluster == cluster) return s;
                if (free == null && (s == null || (!s.Wanted && s.Alpha <= .01f))) { free = s ?? (_slots[i] = new Slot()); freeAt = i; }
            }
            if (free == null) return null;           // every slot busy fading out: pick this cluster up next re-plan
            var c = _planner.Clusters[cluster];
            free.Cluster = cluster; free.C = c; free.Spec = c.TempleLamp ? RegionAtmosphereTable.TempleLamp : RegionAtmosphereTable.AccentFor(c.Kind); free.Alpha = 0f; free.Phase = c.X * 1.7f + c.Y * 2.3f;
            free.Pos = ArenaView.WorldPoint(c.X * 32f, c.Y * 32f) + new Vector3(0, c.Lift, -1);
            if (free.Light != null) free.Light.transform.position = free.Pos;
            return free;
        }

        ShowcasePointLight NewLight(Vector3 pos, bool analytic)
        {
            var light = ShowcaseSprites.CreateLight(_root, "Terrain accent light", pos);
            light.transform.position = pos;
            light.SetBlendStyle(analytic ? 2 : 0);
            light.SetVisible(false);
            return light;
        }

        public void Dispose() { if (_root != null) { if (Application.isPlaying) Object.Destroy(_root.gameObject); else Object.DestroyImmediate(_root.gameObject); } }
    }
}
