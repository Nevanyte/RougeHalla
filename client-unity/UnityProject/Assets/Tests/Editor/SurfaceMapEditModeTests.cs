using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>Surface answers from region id + terrain kind (+ decorative layers). No GPU needed.</summary>
    public sealed class SurfaceMapEditModeTests
    {
        static SurfaceMap Build(out RegionMap rm, byte mode = MapBlob.GroundTerrainAll)
        {
            const int w = 40, h = 40; var tiles = new byte[w * h]; var regions = new byte[w * h]; var terrain = new byte[w * h];
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
            {
                bool border = x == 0 || y == 0 || x == w - 1 || y == h - 1;
                tiles[y * w + x] = border ? MapBlob.Wall : MapBlob.Floor;
                regions[y * w + x] = (byte)(border ? 0 : x < 20 ? (y < 20 ? 1 : 3) : (y < 20 ? 5 : 4));
            }
            terrain[5 * w + 5] = (byte)TerrainKind.Ember; terrain[6 * w + 6] = (byte)TerrainKind.Lava;
            terrain[30 * w + 5] = (byte)TerrainKind.Bog; terrain[30 * w + 30] = (byte)TerrainKind.Ice; terrain[5 * w + 30] = (byte)TerrainKind.Light;
            rm = new RegionMap(); rm.Load(new MapBlob(w, h, tiles, terrain, regions, mode));
            return new SurfaceMap(rm);
        }

        sealed class Fixed : ISurfaceLayer
        {
            public bool TryGet(int tx, int ty, RegionId region, out SurfaceKind kind)
            { kind = SurfaceKind.TempleFloor; return region == RegionId.Holy && tx == 25 && ty == 10; }
        }

        [Test]
        public void RegionDefaultsAndTerrainSurfaces()
        {
            var s = Build(out _);
            Assert.That(s.SurfaceAtTile(10, 10), Is.EqualTo(SurfaceKind.Basalt));
            Assert.That(s.SurfaceAtTile(10, 30), Is.EqualTo(SurfaceKind.Mud));
            Assert.That(s.SurfaceAtTile(35, 35), Is.EqualTo(SurfaceKind.Snow));
            Assert.That(s.SurfaceAtTile(35, 10), Is.EqualTo(SurfaceKind.Sand));
            Assert.That(s.SurfaceAtTile(5, 5), Is.EqualTo(SurfaceKind.Ember));
            Assert.That(s.SurfaceAtTile(6, 6), Is.EqualTo(SurfaceKind.Lava));
            Assert.That(s.SurfaceAtTile(5, 30), Is.EqualTo(SurfaceKind.Bog));
            Assert.That(s.SurfaceAtTile(30, 30), Is.EqualTo(SurfaceKind.Ice));
            Assert.That(s.SurfaceAtTile(30, 5), Is.EqualTo(SurfaceKind.HolyLight));
            Assert.That(s.SurfaceAtTile(0, 0), Is.EqualTo(SurfaceKind.None));
            Assert.That(s.SurfaceAtTile(-4, 99), Is.EqualTo(SurfaceKind.None));
            Assert.That(SurfaceMap.DefaultFor(RegionId.Sentenced), Is.EqualTo(SurfaceKind.Flagstone));
            Assert.That(SurfaceMap.DefaultFor(RegionId.Coliseum), Is.EqualTo(SurfaceKind.Limestone));
        }

        [Test]
        public void WorldAndServerSpaceAgreeWithTiles()
        {
            var s = Build(out _);
            Assert.That(s.SurfaceAt(new Vector3(30.5f, -30.5f * ArenaView.GroundSquash, 0)), Is.EqualTo(SurfaceKind.Ice));
            Assert.That(s.SurfaceAtServer(30 * 32 + 4, 30 * 32 + 4), Is.EqualTo(SurfaceKind.Ice));
            Assert.That(s.SurfaceAt(ArenaView.WorldPoint(6 * 32 + 8, 6 * 32 + 8)), Is.EqualTo(SurfaceKind.Lava));
        }

        [Test]
        public void DecorativeLayersOverrideRegionDefaultsButNeverRealTerrain()
        {
            var s = Build(out _);
            s.AddLayer(new Fixed());
            Assert.That(s.SurfaceAtTile(25, 10), Is.EqualTo(SurfaceKind.TempleFloor));
            Assert.That(s.SurfaceAtTile(26, 10), Is.EqualTo(SurfaceKind.Sand));
            s.ClearLayers();
            Assert.That(s.SurfaceAtTile(25, 10), Is.EqualTo(SurfaceKind.Sand));
        }

        [Test]
        public void AbsentPlanesAnswerNone()
        {
            var rm = new RegionMap(); rm.Load(new MapBlob(8, 8, new byte[64]));
            Assert.That(new SurfaceMap(rm).SurfaceAtTile(3, 3), Is.EqualTo(SurfaceKind.None));
        }
    }
}
