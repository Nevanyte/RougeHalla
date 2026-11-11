using System.IO;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>Generated Holy temple detection, Plague ground layout, terrain-mode honesty and surface answers, on the two real seed maps.</summary>
    public sealed class RegionArtEditModeTests
    {
        [System.Serializable] class MapJson { public int w, h; public int[] tiles, terrain, regionGrid; }
        [System.Serializable] class FileJson { public MapJson map; }

        static MapBlob Load(string name, byte mode = MapBlob.GroundTerrainAll)
        {
            string path = Path.GetFullPath(Path.Combine(Application.dataPath, "../../../crates/rh-sim/src/mapdata/fixtures/" + name));
            Assume.That(File.Exists(path), "fixture missing: " + path);
            var m = JsonUtility.FromJson<FileJson>(File.ReadAllText(path)).map;
            byte[] B(int[] a) { var o = new byte[a.Length]; for (int i = 0; i < a.Length; i++) o[i] = (byte)a[i]; return o; }
            return new MapBlob((ushort)m.w, (ushort)m.h, B(m.tiles), B(m.terrain), B(m.regionGrid), mode);
        }

        static readonly string[] Seeds = { "seed1.map.json", "seed2.map.json" };

        [TestCaseSource(nameof(Seeds))]
        public void TempleIsFoundInsideHolyRoughlySquareAndCoversAThirdToSevenTenths(string seed)
        {
            var map = Load(seed); var t = TempleLayout.Detect(map);
            Assert.That(t.Found, Is.True, t.Reason);
            for (int y = t.Y0; y < t.Y0 + t.Size; y++) for (int x = t.X0; x < t.X0 + t.Size; x++)
                Assert.That(map.Regions[y * map.W + x], Is.EqualTo((byte)RegionId.Holy), "footprint must stay inside Holy at " + x + "," + y);
            Assert.That(t.Coverage, Is.InRange(TempleLayout.MinCoverage, TempleLayout.MaxCoverage), t.Describe());
            Assert.That(t.Pillars.Count, Is.GreaterThan(10));
            foreach (var o in t.Pillars) Assert.That(t.Contains(o.x, o.y) && t.Contains(o.x + 2, o.y + 2), Is.True);
            TestContext.Out.WriteLine(seed + ": " + t.Describe());
        }

        [TestCaseSource(nameof(Seeds))]
        public void TempleDetectionIsDeterministic(string seed)
        {
            var a = TempleLayout.Detect(Load(seed)); var b = TempleLayout.Detect(Load(seed));
            Assert.That((b.X0, b.Y0, b.Size, b.Pillars.Count, b.Props.Count), Is.EqualTo((a.X0, a.Y0, a.Size, a.Pillars.Count, a.Props.Count)));
        }

        [Test]
        public void NoTempleOnAMapWithoutAHall()
        {
            var tiles = new byte[40 * 40]; var regions = new byte[40 * 40]; for (int i = 0; i < regions.Length; i++) regions[i] = 5;
            var t = TempleLayout.Detect(new MapBlob(40, 40, tiles, null, regions));
            Assert.That(t.Found, Is.False); Assert.That(t.Reason, Is.Not.Empty);
            Assert.That(TempleLayout.Detect(new MapBlob(8, 8, new byte[64])).Found, Is.False);
        }

        [TestCaseSource(nameof(Seeds))]
        public void TempleSurfaceAndWeights(string seed)
        {
            var map = Load(seed); var t = TempleLayout.Detect(map);
            var rm = new RegionMap(); rm.Load(map); var s = new SurfaceMap(rm); s.AddLayer(t);
            var c = t.Center;
            Assert.That(s.SurfaceAtTile((int)c.x, (int)c.y), Is.Not.EqualTo(SurfaceKind.Sand).And.Not.EqualTo(SurfaceKind.None));
            Assert.That(t.WeightAt(c.x, c.y), Is.EqualTo(1f).Within(.001f));
            Assert.That(t.WeightAt(t.X0 - 6, c.y), Is.EqualTo(0f).Within(.001f));
            Assert.That(t.WeightAt(t.X0 + .5f, c.y), Is.InRange(.1f, .9f), "soft transition at the edge");
        }

        [TestCaseSource(nameof(Seeds))]
        public void PlagueLayoutIsDeterministicHasAllThreeSurfacesAndWaterOnlyOnPlainFloor(string seed)
        {
            var map = Load(seed); var a = PlagueGround.Build(map); var b = PlagueGround.Build(map);
            Assert.That(b.Kind, Is.EqualTo(a.Kind));
            Assert.That(a.MudTiles, Is.GreaterThan(100)); Assert.That(a.GrassTiles, Is.GreaterThan(100));
            float water = a.WaterTiles / (float)a.FloorTiles; Assert.That(water, Is.InRange(.05f, .30f), "water share");
            for (int i = 0; i < a.Kind.Length; i++)
            {
                if (a.Kind[i] == PlagueGround.None) continue;
                Assert.That(map.Tiles[i], Is.EqualTo(MapBlob.Floor), "only floor tiles");
                Assert.That(map.Regions[i], Is.EqualTo((byte)RegionId.Plague));
                Assert.That(map.Terrain[i], Is.EqualTo((byte)0), "never on a terrain surface");
            }
            for (int y = 0; y < map.H; y++) for (int x = 0; x < map.W; x++)
                if (a.KindAt(x, y) == PlagueGround.Water)
                    for (int dy = -2; dy <= 2; dy++) for (int dx = -2; dx <= 2; dx++)
                        if ((uint)(x + dx) < (uint)map.W && (uint)(y + dy) < (uint)map.H)
                            Assert.That(map.Terrain[(y + dy) * map.W + x + dx], Is.Not.EqualTo((byte)TerrainKind.Bog), "water stays clear of bog");
        }

        [TestCaseSource(nameof(Seeds))]
        public void BakedWaterNeverCoversNonFloorTexels(string seed)
        {
            var map = Load(seed); var g = PlagueGround.Build(map); var px = g.Bake(2); int ow = map.W * 2;
            for (int i = 0; i < px.Length; i++)
            {
                int tx = (i % ow) / 2, ty = (i / ow) / 2;
                if (g.KindAt(tx, ty) == PlagueGround.None) Assert.That(px[i].r + px[i].g + px[i].b, Is.EqualTo(0), "texel over a non-Plague-floor tile at " + tx + "," + ty);
            }
        }

        [Test]
        public void PlagueSurfacesReachSurfaceMap()
        {
            var map = Load("seed1.map.json"); var rm = new RegionMap(); rm.Load(map); var s = new SurfaceMap(rm); var g = PlagueGround.Build(map); s.AddLayer(g);
            bool water = false, grass = false, mud = false, bog = false;
            for (int y = 0; y < map.H; y++) for (int x = 0; x < map.W; x++)
            {
                var k = s.SurfaceAtTile(x, y);
                if (k == SurfaceKind.ShallowWater) { water = true; Assert.That(g.KindAt(x, y), Is.EqualTo(PlagueGround.Water)); }
                grass |= k == SurfaceKind.Grass; mud |= k == SurfaceKind.Mud; bog |= k == SurfaceKind.Bog;
            }
            Assert.That(water && grass && mud && bog, Is.True);
        }

        [Test]
        public void TerrainModeOffDropsSurfaceEffectsButKeepsCollisionTerrain()
        {
            var on = Load("seed1.map.json", MapBlob.GroundTerrainMap); var off = Load("seed1.map.json", MapBlob.GroundTerrainOff);
            var t = RegionMap.EffectiveTerrain(off); int kept = 0, dropped = 0;
            for (int i = 0; i < t.Length; i++)
            {
                byte v = on.Terrain[i];
                if (v >= 4 && v <= 7) { Assert.That(t[i], Is.EqualTo((byte)0)); dropped++; }
                else { Assert.That(t[i], Is.EqualTo(v)); if (v != 0) kept++; }
            }
            Assert.That(dropped, Is.GreaterThan(0)); Assert.That(kept, Is.GreaterThan(0), "lava, fence and crevasse stay");
            Assert.That(RegionMap.EffectiveTerrain(on), Is.SameAs(on.Terrain));
            var rm = new RegionMap(); rm.Load(off); var sm = new SurfaceMap(rm);
            for (int y = 0; y < off.H; y++) for (int x = 0; x < off.W; x++)
            {
                var k = sm.SurfaceAtTile(x, y);
                Assert.That(k, Is.Not.EqualTo(SurfaceKind.Ember).And.Not.EqualTo(SurfaceKind.Bog).And.Not.EqualTo(SurfaceKind.Ice).And.Not.EqualTo(SurfaceKind.HolyLight));
            }
        }

        [Test]
        public void PassiveLightOrderingStillHolds()
        {
            float P(RegionId r) { return AtmosphereLighting.Level(RegionAtmosphereTable.Get(r).Params); }
            Assert.That(P(RegionId.Holy), Is.GreaterThan(P(RegionId.Frost)));
            Assert.That(P(RegionId.Frost), Is.GreaterThan(P(RegionId.Plague)));
            Assert.That(P(RegionId.Plague), Is.GreaterThan(P(RegionId.Fire)));
            Assert.That(P(RegionId.Fire), Is.GreaterThanOrEqualTo(P(RegionId.Sentenced)));
            Assert.That(AtmosphereLighting.Level(RegionAtmosphereTable.HolyTempleInterior.Params), Is.GreaterThan(P(RegionId.Frost) * .8f), "temple interior is decent, even light");
        }

        [Test]
        public void RealBushCellsGetBushArtAndNoDecorativeBushStandsElsewhere()
        {
            var map = Load("seed1.map.json");
            var before = RegionProps.Scatter(map);
            var plane = new byte[map.W * map.H]; int real = 0;
            for (int i = 0; i < plane.Length && real < 20; i++) if (map.Tiles[i] == MapBlob.Floor && map.Regions[i] == (byte)RegionId.Frost) { plane[i] = 1; real++; }
            Assert.That(real, Is.GreaterThan(0));
            var withBushes = map.WithPublic(null, null, plane, null, null);
            var after = RegionProps.Scatter(withBushes);
            int bushes = 0;
            foreach (var p in after)
                if (p.Art.EndsWith(".bush") || p.Art == "holy.shrub")
                {
                    bushes++; Assert.That(plane[p.Ty * map.W + p.Tx], Is.Not.EqualTo(0), "a bush stands only on a real concealment cell");
                }
            Assert.That(bushes, Is.EqualTo(real), "every real cell has its bush");
            int holyCells = 0;
            for (int i = 0; i < plane.Length; i++) if (map.Regions[i] == (byte)RegionId.Holy && map.Tiles[i] == MapBlob.Floor && (holyCells++ % 7) == 0) plane[i] = 1;
            Assert.That(holyCells, Is.GreaterThan(0));
            foreach (var p in RegionProps.Scatter(map.WithPublic(null, null, plane, null, null)))
                if (p.Art == "holy.shrub") Assert.That(plane[p.Ty * map.W + p.Tx], Is.Not.EqualTo(0), "in Holy every shrub is a real bush cell");
        }

        [Test]
        public void ColiseumPropsStayOffTheOpenFloorAndAreDeterministic()
        {
            var map = Load("seed1.map.json"); var a = RegionProps.Scatter(map); var b = RegionProps.Scatter(map);
            Assert.That(b.Count, Is.EqualTo(a.Count));
            int n = 0;
            foreach (var p in a) if (p.Art.StartsWith("col.")) { n++; Assert.That(map.Tiles[p.Ty * map.W + p.Tx], Is.EqualTo(MapBlob.Floor)); Assert.That(map.Regions[p.Ty * map.W + p.Tx], Is.EqualTo((byte)RegionId.Coliseum)); }
            Assert.That(n, Is.GreaterThan(2));
        }
    }
}
