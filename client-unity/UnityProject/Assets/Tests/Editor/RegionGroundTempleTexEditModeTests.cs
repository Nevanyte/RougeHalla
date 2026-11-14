using System.IO;
using NUnit.Framework;
using UnityEngine;
using Roguehalla.Client;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client.Tests
{
    /// <summary>Pins the channel layout of the ground's _TempleTex (P-UNITY-GROUND-BANDS-1): r = the temple pier flag, g, b, a = the ground bands' soft gain bytes; map width x height, point filtered.</summary>
    public sealed class RegionGroundTempleTexEditModeTests
    {
        [System.Serializable] class MapJson { public int w, h; public int[] tiles, terrain, regionGrid; }
        [System.Serializable] class FileJson { public MapJson map; }

        static MapBlob SeedWithBand()
        {
            string path = Path.GetFullPath(Path.Combine(Application.dataPath, "../../../crates/rh-sim/src/mapdata/fixtures/seed1.map.json"));
            Assume.That(File.Exists(path), "fixture missing: " + path);
            var m = JsonUtility.FromJson<FileJson>(File.ReadAllText(path)).map;
            byte[] B(int[] a) { var o = new byte[a.Length]; for (int i = 0; i < a.Length; i++) o[i] = (byte)a[i]; return o; }
            var map = new MapBlob((ushort)m.w, (ushort)m.h, B(m.tiles), B(m.terrain), B(m.regionGrid), MapBlob.GroundTerrainAll);
            var plane = new byte[m.w * m.h];
            for (int y = 10; y < 16; y++) for (int x = 10; x < 16; x++) plane[y * m.w + x] = 3;
            return map.WithPublic(null, null, null, null, plane);
        }

        [Test]
        public void TempleTexHoldsThePierFlagInRAndTheSoftBandGainInGba()
        {
            var map = SeedWithBand(); var temple = TempleLayout.For(map);
            Assert.That(temple.Found, Is.True, temple.Reason);
            var inputs = RegionGround.BakeVariantInputs(map); Assert.That(inputs.SoftActive, Is.True);
            var px = RegionGround.BakePierPlane(inputs, temple);
            Assert.That(px.Length, Is.EqualTo(map.W * map.H));
            int piers = 0, soft = 0;
            for (int y = 0; y < map.H; y++) for (int x = 0; x < map.W; x++)
            {
                var c = px[y * map.W + x]; var s = inputs.Soft[y * map.W + x]; bool pier = temple.TryBlock(x, y, out _, out _);
                Assert.That(c.r, Is.EqualTo(pier ? 255 : 0), "pier flag at " + x + "," + y);
                Assert.That((c.g, c.b, c.a), Is.EqualTo((s.r, s.g, s.b)), "soft gain at " + x + "," + y);
                if (pier) piers++; if (s.r != 128 || s.g != 128 || s.b != 128) soft++;
            }
            Assert.That(piers, Is.GreaterThan(0)); Assert.That(soft, Is.GreaterThan(0));

            var root = new GameObject("templetex root");
            try
            {
                var ground = RegionGround.Create(root.transform, map, 1f);
                // The material does not declare _TempleTex as a property (the shader only samples it), so find the texture the ground built by its name.
                Texture2D tex = null;
                foreach (var t in Resources.FindObjectsOfTypeAll<Texture2D>()) if (t.name == "Temple piers" && t.width == map.W && t.height == map.H) tex = t;
                Assert.That(tex, Is.Not.Null, "the ground builds a \"Temple piers\" texture of map width x height");
                Assert.That((tex.width, tex.height), Is.EqualTo(((int)map.W, (int)map.H)));
                Assert.That(tex.filterMode, Is.EqualTo(FilterMode.Point));
                ground.Dispose();
            }
            finally { Object.DestroyImmediate(root); }
        }
    }
}
