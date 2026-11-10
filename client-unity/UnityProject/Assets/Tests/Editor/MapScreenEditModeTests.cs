using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    public sealed class MapScreenEditModeTests
    {
        UiTheme _saved;
        [SetUp] public void SetUp() { _saved = UiTheme.Current; }
        [TearDown] public void TearDown() { UiTheme.Current = _saved; }

        static MapBlob Blob(int w, int h, byte[] tiles, byte[] regions) { return new MapBlob((ushort)w, (ushort)h, tiles, null, regions); }

        [Test]
        public void EveryZoneHasAThemeColourDistinctFromTheOthersAndOwnedByTheTheme()
        {
            var theme = UiTheme.Skin();
            var seen = new List<Color32>();
            for (int r = 1; r <= 6; r++)
            {
                var c = theme.ZoneColor(r);
                Assert.That(theme.Owns(c), "zone " + r + " colour is a theme token");
                foreach (var other in seen) Assert.That(c.r != other.r || c.g != other.g || c.b != other.b, "zone colours must differ");
                seen.Add(c);
            }
            for (int r = 1; r <= 5; r++) Assert.AreEqual(theme.Faction[r - 1], theme.ZoneColor(r), "zones 1..5 use the faction hues");
            Assert.AreEqual(theme.TextSecondary, theme.ZoneColor(0));
        }

        [Test]
        public void ZoneColoursHoldContrastAgainstTheMapBackingForIconsAndLabels()
        {
            var theme = UiTheme.Skin();
            for (int r = 1; r <= 6; r++)
                Assert.That(ShowcasePalette.ContrastRatio(theme.ZoneColor(r), theme.SurfaceSunken), Is.GreaterThanOrEqualTo(3f), "zone " + r + " icon");
        }

        [Test]
        public void TintedTerrainShowsEachZoneHueAndKeepsWallsBrighterThanTheTint()
        {
            var theme = UiTheme.Skin();
            int w = 12, h = 12; var tiles = new byte[w * h]; var regions = new byte[w * h];
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) regions[y * w + x] = (byte)(1 + x / 2); // columns of zones 1..6
            for (int y = 0; y < h; y++) tiles[y * w + 5] = MapBlob.Wall;
            var raster = TerrainRaster.Acquire(Blob(w, h, tiles, regions), theme);
            try
            {
                Assert.IsTrue(raster.Tinted);
                int k = raster.TexelsPerTile;
                var tex = raster.Texture; Assert.AreEqual(w * k, tex.width);
                Color Px(int tx, int ty) { return tex.GetPixel(tx * k + k / 2, ty * k + k / 2); }
                Color backing = theme.SurfaceSunken;
                // Tile column 0 is Fire, 2 is Sentenced, 8 is Plague.. their centres must lean toward the hue, not stay neutral.
                Assert.That(Px(0, 6).r, Is.GreaterThan(backing.r + .04f), "fire tint adds red");
                Assert.That(Px(10, 6).r + Px(10, 6).g + Px(10, 6).b, Is.GreaterThan(backing.r + backing.g + backing.b + .1f), "coliseum tint lifts the floor");
                var wallPx = Px(5, 6);
                Assert.That(wallPx.r + wallPx.g + wallPx.b, Is.GreaterThan(Px(3, 6).r + Px(3, 6).g + Px(3, 6).b), "a wall is lighter than its zone tint");
                Assert.That(tex.mipmapCount, Is.GreaterThan(1));
                Assert.That(k, Is.GreaterThanOrEqualTo(2), "terrain is upsampled, not one texel per tile");
            }
            finally { TerrainRaster.Release(raster); }
        }

        [Test]
        public void MapWithoutARegionPlaneFallsBackToTheNeutralLook()
        {
            var theme = UiTheme.Skin();
            var raster = TerrainRaster.Acquire(Blob(8, 8, new byte[64], null), theme);
            try
            {
                Assert.IsFalse(raster.Tinted);
                var c = raster.Texture.GetPixel(10, 10);
                Assert.That(Mathf.Abs(c.r - theme.SurfaceSunken.r / 255f), Is.LessThan(.01f));
                Assert.That(Mathf.Abs(c.g - theme.SurfaceSunken.g / 255f), Is.LessThan(.01f));
            }
            finally { TerrainRaster.Release(raster); }
        }

        [Test]
        public void RasterIsSharedPerMapAndThemeAndFreedOnLastRelease()
        {
            var theme = UiTheme.Skin(); var map = Blob(4, 4, new byte[16], null);
            var a = TerrainRaster.Acquire(map, theme); var b = TerrainRaster.Acquire(map, theme);
            Assert.AreSame(a, b);
            var texture = a.Texture;
            TerrainRaster.Release(a); Assert.IsTrue(texture != null, "still held by the second user");
            TerrainRaster.Release(b); Assert.IsTrue(texture == null, "destroyed with the last user");
        }

        [Test]
        public void GlyphAtlasIsCrispAndMipMappedWithEveryGlyphDrawn()
        {
            var tex = MapGlyphs.Texture;
            Assert.That(tex.mipmapCount, Is.GreaterThan(1));
            foreach (MapGlyph g in System.Enum.GetValues(typeof(MapGlyph)))
            {
                var uv = MapGlyphs.Uv(g);
                float total = 0; int cx = Mathf.RoundToInt(uv.x * tex.width), cy = Mathf.RoundToInt(uv.y * tex.height);
                for (int y = 0; y < MapGlyphs.Cell; y += 2) for (int x = 0; x < MapGlyphs.Cell; x += 2) total += tex.GetPixel(cx + x, cy + y).a;
                Assert.That(total, Is.GreaterThan(20f), g + " has ink");
            }
            Assert.That(MapGlyphs.Sprite(MapGlyph.Ring).rect.width, Is.EqualTo(MapGlyphs.Cell));
        }

        [Test]
        public void MarksDrawZoneIconsOnlyWhenTheMapCarriesRegionsAndLabelOnlyTheLargeMap()
        {
            var host = new GameObject("marks", typeof(RectTransform));
            try
            {
                var marks = host.AddComponent<TacticalMapMarks>(); marks.Large = true;
                ((RectTransform)host.transform).sizeDelta = new Vector2(300, 300);
                int w = 6, h = 6; var regions = new byte[w * h];
                for (int i = 0; i < regions.Length; i++) regions[i] = (byte)(i % 6 + 1);
                marks.SetMap(Blob(w, h, new byte[w * h], regions));
                Assert.AreEqual(6, marks.ZoneIconCount);
                Assert.AreEqual(6, host.GetComponentsInChildren<TMPro.TMP_Text>().Length, "one name per zone on the Tab map");
                var mini = new GameObject("mini", typeof(RectTransform)).AddComponent<TacticalMapMarks>();
                mini.SetMap(Blob(w, h, new byte[w * h], regions));
                Assert.AreEqual(0, mini.GetComponentsInChildren<TMPro.TMP_Text>().Length, "the minimap draws icons without text");
                Object.DestroyImmediate(mini.gameObject);
                marks.SetMap(Blob(w, h, new byte[w * h], null));
                Assert.AreEqual(0, marks.ZoneIconCount, "no region plane: neutral look");
            }
            finally { Object.DestroyImmediate(host); }
        }

        [Test]
        public void PingStartsAndExpires()
        {
            var host = new GameObject("ping", typeof(RectTransform));
            try
            {
                var marks = host.AddComponent<TacticalMapMarks>();
                marks.SetMap(Blob(4, 4, new byte[16], null));
                Assert.IsFalse(marks.PingActive);
                marks.Ping(new Vector2(40, 50));
                Assert.IsTrue(marks.PingActive); Assert.AreEqual(new Vector2(40, 50), marks.PingAt);
            }
            finally { Object.DestroyImmediate(host); }
        }

        [Test]
        public void SurfaceProjectionUsesTheSharedClampingMaths()
        {
            var host = new GameObject("surface", typeof(RectTransform));
            try
            {
                var rect = (RectTransform)host.transform; rect.sizeDelta = new Vector2(200, 200); rect.position = new Vector3(100, 100, 0);
                var surface = host.AddComponent<TacticalMapSurface>(); surface.Initialize(); surface.SetMap(Blob(10, 10, new byte[100], null));
                Assert.IsTrue(surface.ScreenWorld(new Vector2(-50, 500), null, out var p));
                Assert.AreEqual(0f, p.x, .01f); Assert.AreEqual(0f, p.y, .01f, "above the map clamps to the top edge, y down");
                Assert.IsTrue(surface.ScreenWorld(new Vector2(1000, -300), null, out var q));
                Assert.AreEqual(320f, q.x, .01f); Assert.AreEqual(320f, q.y, .01f);
            }
            finally { Object.DestroyImmediate(host); }
        }
    }
}
