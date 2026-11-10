using System;
using System.Collections.Generic;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace Roguehalla.Client
{
    /// <summary>One public map projection shared by planning, the tactical map and minimap. No visibility inference.</summary>
    public sealed class TacticalMapSurface : MonoBehaviour, IPointerDownHandler, IPointerUpHandler, IDragHandler
    {
        public Action<Vector2, PointerEventData.InputButton> Pressed;
        public Action<Vector2, PointerEventData.InputButton> Dragged;
        public Action<Vector2, PointerEventData.InputButton> PointerReleased;
        public Action Aborted;
        RawImage _terrain;
        TacticalMapMarks _marks;
        TerrainRaster.Entry _raster;
        MapBlob _map;
        public MapBlob Map => _map;
        public RectTransform Rect => (RectTransform)transform;
        public TacticalMapMarks Marks => _marks;
        /// <summary>True when the map carried a region plane and the terrain is tinted by zone.</summary>
        public bool HasZoneTint => _raster != null && _raster.Tinted;

        public void Initialize()
        {
            _terrain = gameObject.AddComponent<RawImage>();
            _terrain.color = Color.white;
            _terrain.raycastTarget = true;
            var marks = new GameObject("Delivered contacts and personal route", typeof(RectTransform));
            marks.transform.SetParent(transform, false);
            var r = (RectTransform)marks.transform;
            r.anchorMin = Vector2.zero; r.anchorMax = Vector2.one; r.offsetMin = r.offsetMax = Vector2.zero;
            _marks = marks.AddComponent<TacticalMapMarks>();
            _marks.raycastTarget = false;
        }

        void OnEnable() { UiTheme.Changed += Rebuild; }

        public void SetMap(MapBlob map)
        {
            if (ReferenceEquals(map, _map)) return;
            _map = map;
            Rebuild();
            _marks.SetMap(map);
        }

        void Rebuild()
        {
            if (_terrain == null) return;
            if (_raster != null) { TerrainRaster.Release(_raster); _raster = null; }
            _terrain.texture = null;
            if (_map == null) return;
            _raster = TerrainRaster.Acquire(_map, UiTheme.Current);
            _terrain.texture = _raster.Texture;
            var fit = GetComponent<AspectRatioFitter>() ?? gameObject.AddComponent<AspectRatioFitter>();
            fit.aspectMode = AspectRatioFitter.AspectMode.FitInParent; fit.aspectRatio = (float)_map.W / _map.H;
        }

        public void Present(Session session, IReadOnlyList<RoutePoint> route)
        {
            _marks.Present(session, route);
        }

        public bool PointerWorld(PointerEventData e, out Vector2 point)
        {
            return ScreenWorld(e.position, e.pressEventCamera, out point);
        }

        public bool ScreenWorld(Vector2 screen, Camera eventCamera, out Vector2 point)
        {
            point = default;
            if (_map == null || Rect.rect.width <= 0 || Rect.rect.height <= 0 || !RectTransformUtility.ScreenPointToLocalPointInRectangle(Rect, screen, eventCamera, out var p)) return false;
            var rect = Rect.rect;
            // Local y points up; the map's y points down the screen. The projection clamps to the map.
            if (!MapProjection.PixelToWorld(p.x - rect.xMin, rect.yMax - p.y, rect.width, rect.height, _map.W, _map.H, out var world)) return false;
            point = new Vector2((float)world.X, (float)world.Y);
            return true;
        }

        public void OnPointerDown(PointerEventData e) { if (PointerWorld(e, out var point)) Pressed?.Invoke(point, e.button); }
        public void OnDrag(PointerEventData e) { if (PointerWorld(e, out var point)) Dragged?.Invoke(point, e.button); }
        public void OnPointerUp(PointerEventData e) { if (PointerWorld(e, out var point)) PointerReleased?.Invoke(point, e.button); }
        void OnDisable() { UiTheme.Changed -= Rebuild; Aborted?.Invoke(); }
        void OnApplicationFocus(bool focus) { if (!focus) Aborted?.Invoke(); }
        void OnDestroy() { if (_raster != null) { TerrainRaster.Release(_raster); _raster = null; } }
    }

    /// <summary>
    /// Builds the smooth map terrain texture once per map and theme and shares it between the minimap and the Tab map. Walls and low
    /// obstacles are drawn as anti-aliased filled shapes with a lighter stroke from a bilinear coverage field (see
    /// <see cref="MapSmoothing"/>), at several texels per tile, so the map is never a one-texel-per-tile pixel grid. When the map carries
    /// a region plane each zone is tinted with its theme hue, softly blended across the borders; without one the look stays neutral.
    /// </summary>
    public static class TerrainRaster
    {
        public sealed class Entry
        {
            internal MapBlob Map; internal UiTheme Theme; internal int Refs;
            public Texture2D Texture; public bool Tinted; public int TexelsPerTile;
        }

        static readonly List<Entry> Cache = new List<Entry>();
        const int TargetTexels = 1024;

        public static Entry Acquire(MapBlob map, UiTheme theme)
        {
            foreach (var e in Cache)
                if (ReferenceEquals(e.Map, map) && ReferenceEquals(e.Theme, theme) && e.Texture != null) { e.Refs++; return e; }
            var entry = new Entry { Map = map, Theme = theme, Refs = 1 };
            Build(entry);
            Cache.Add(entry);
            return entry;
        }

        public static void Release(Entry entry)
        {
            if (entry == null || --entry.Refs > 0) return;
            Cache.Remove(entry);
            if (entry.Texture != null) { if (Application.isPlaying) UnityEngine.Object.Destroy(entry.Texture); else UnityEngine.Object.DestroyImmediate(entry.Texture); }
        }

        /// <summary>Texels per tile for a map: enough for crisp edges at the largest map size, never more than 8.</summary>
        public static int TexelsFor(int w, int h) { return Mathf.Clamp(TargetTexels / Mathf.Max(1, Mathf.Max(w, h)), 2, 8); }

        static void Build(Entry entry)
        {
            var map = entry.Map; var theme = entry.Theme;
            int w = map.W, h = map.H, k = TexelsFor(w, h);
            entry.TexelsPerTile = k;
            bool hasRegions = map.Regions != null && map.Regions.Length == w * h;
            entry.Tinted = hasRegions;
            var tiles = map.Tiles; var regions = map.Regions;
            Func<int, int, float> wall = (x, y) => tiles[y * w + x] == MapBlob.Wall ? 1f : 0f;
            Func<int, int, float> low = (x, y) => tiles[y * w + x] == MapBlob.Low ? 1f : 0f;

            Color backing = theme.SurfaceSunken;
            Color wallFill = Color.Lerp(backing, theme.Border, .5f), wallStroke = theme.TextSecondary;
            Color lowFill = Color.Lerp(backing, theme.AccentDim, .5f);
            var zoneColor = new Color[MapZones.Count + 1]; var zoneAlpha = new float[MapZones.Count + 1];
            for (int r = 1; r <= MapZones.Count; r++) { zoneColor[r] = theme.ZoneColor(r); zoneAlpha[r] = MapZones.TintAlpha(r, true); }

            int tw = w * k, th = h * k;
            var texture = new Texture2D(tw, th, TextureFormat.RGBA32, true)
            {
                name = "Public map terrain", filterMode = FilterMode.Trilinear, wrapMode = TextureWrapMode.Clamp, anisoLevel = 2, hideFlags = HideFlags.HideAndDontSave
            };
            var pixels = new Color32[tw * th];
            float edge = .85f / k;
            for (int row = 0; row < th; row++)
            {
                double ty = (row + .5) / k; int outRow = th - 1 - row;
                for (int col = 0; col < tw; col++)
                {
                    double tx = (col + .5) / k;
                    Color c = backing;
                    if (hasRegions)
                    {
                        // Bilinear blend of the four nearest tiles' zone tints: soft borders instead of a tile staircase.
                        double fx = tx - .5, fy = ty - .5; int x0 = (int)Math.Floor(fx), y0 = (int)Math.Floor(fy);
                        float ax = (float)(fx - x0), ay = (float)(fy - y0);
                        float aSum = 0f, rr = 0f, gg = 0f, bb = 0f;
                        for (int n = 0; n < 4; n++)
                        {
                            int sx = Mathf.Clamp(x0 + (n & 1), 0, w - 1), sy = Mathf.Clamp(y0 + (n >> 1), 0, h - 1);
                            float wgt = ((n & 1) == 0 ? 1f - ax : ax) * ((n >> 1) == 0 ? 1f - ay : ay);
                            int region = regions[sy * w + sx];
                            if (!MapZones.IsZone(region) || wgt <= 0f) continue;
                            float a = wgt * zoneAlpha[region];
                            aSum += a; rr += zoneColor[region].r * a; gg += zoneColor[region].g * a; bb += zoneColor[region].b * a;
                        }
                        if (aSum > 0f) c = Color.Lerp(c, new Color(rr / aSum, gg / aSum, bb / aSum, 1f), aSum);
                    }
                    float cl = MapSmoothing.Coverage(low, w, h, tx, ty);
                    if (cl > .05f) c = Color.Lerp(c, lowFill, MapSmoothing.Inside(cl, edge) * .9f);
                    float cw = MapSmoothing.Coverage(wall, w, h, tx, ty);
                    if (cw > .05f)
                    {
                        c = Color.Lerp(c, wallFill, MapSmoothing.Inside(cw, edge));
                        c = Color.Lerp(c, wallStroke, MapSmoothing.Stroke(cw, .17f, edge) * .85f);
                    }
                    pixels[outRow * tw + col] = new Color32((byte)Mathf.RoundToInt(c.r * 255f), (byte)Mathf.RoundToInt(c.g * 255f), (byte)Mathf.RoundToInt(c.b * 255f), 255);
                }
            }
            texture.SetPixels32(pixels); texture.Apply(true, true);
            entry.Texture = texture;
        }
    }
}
