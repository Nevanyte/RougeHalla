using System;
using NUnit.Framework;
using Roguehalla.Net.Protocol;
using UnityEngine;
using MapRect = Roguehalla.Net.Protocol.MapRect;   // Net.Ui has a MapRect of its own

namespace Roguehalla.Client.Tests
{
    /// <summary>P-UNITY-WEB-DRIVE-2: the scenario probe lists the landmark anchors the client received (kind name, footprint in tiles,
    /// centre and entrance tiles in world units, 32 per tile, tile centre = (t + .5) * 32).</summary>
    public sealed class ScenarioProbeAnchorsEditModeTests
    {
        [Serializable] class P { public float x, y; }
        [Serializable] class R { public int x, y, w, h; }
        [Serializable] class A { public string kind; public int zone; public R footprint; public P centre; public P[] entrance; }
        [Serializable] class Wrap { public A[] a; }

        static A[] Parse(string arrayJson) { return JsonUtility.FromJson<Wrap>("{\"a\":" + arrayJson + "}").a; }

        [Test]
        public void ListsEveryAnchorWithKindFootprintCentreAndEntrance()
        {
            var cave = new MapAnchor(4, MapBlob.AnchorKindCave, new MapTile(12, 7), new MapRect(10, 5, 6, 6), 4,
                new[] { new MapTile(10, 10), new MapTile(11, 10) });
            var hall = new MapAnchor(5, MapBlob.AnchorKindHall, new MapTile(44, 45), new MapRect(40, 40, 8, 8), 0, new MapTile[0]);
            var a = Parse(ScenarioProbe.AnchorsJson(new[] { cave, hall }));
            Assert.AreEqual(2, a.Length, "both anchors");

            Assert.AreEqual("cave", a[0].kind); Assert.AreEqual(4, a[0].zone);
            Assert.AreEqual(10, a[0].footprint.x); Assert.AreEqual(5, a[0].footprint.y);
            Assert.AreEqual(6, a[0].footprint.w); Assert.AreEqual(6, a[0].footprint.h);
            Assert.AreEqual(12 * 32 + 16, a[0].centre.x, .01f); Assert.AreEqual(7 * 32 + 16, a[0].centre.y, .01f);
            Assert.AreEqual(2, a[0].entrance.Length);
            Assert.AreEqual(10 * 32 + 16, a[0].entrance[0].x, .01f); Assert.AreEqual(10 * 32 + 16, a[0].entrance[0].y, .01f);
            Assert.AreEqual(11 * 32 + 16, a[0].entrance[1].x, .01f);

            Assert.AreEqual("hall", a[1].kind); Assert.AreEqual(5, a[1].zone);
            Assert.AreEqual(8, a[1].footprint.w);
            Assert.AreEqual(44 * 32 + 16, a[1].centre.x, .01f); Assert.AreEqual(45 * 32 + 16, a[1].centre.y, .01f);
            Assert.AreEqual(0, a[1].entrance.Length, "a landmark without an entrance lists none");
        }

        [Test]
        public void NamesAllFiveKinds()
        {
            byte[] kinds = { MapBlob.AnchorKindVolcano, MapBlob.AnchorKindChurch, MapBlob.AnchorKindBogTree, MapBlob.AnchorKindCave, MapBlob.AnchorKindHall };
            string[] names = { "volcano", "church", "bogtree", "cave", "hall" };
            for (int i = 0; i < kinds.Length; i++)
            {
                var a = Parse(ScenarioProbe.AnchorsJson(new[] { new MapAnchor(1, kinds[i], new MapTile(5, 5), new MapRect(3, 3, 4, 4), 0, null) }));
                Assert.AreEqual(1, a.Length); Assert.AreEqual(names[i], a[0].kind);
            }
        }

        [Test]
        public void NoAnchorsIsAnEmptyArray()
        {
            Assert.AreEqual("[]", ScenarioProbe.AnchorsJson(null));
            Assert.AreEqual("[]", ScenarioProbe.AnchorsJson(new MapAnchor[0]));
        }
    }
}
