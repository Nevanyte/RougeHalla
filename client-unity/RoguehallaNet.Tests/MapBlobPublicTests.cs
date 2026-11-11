using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>Protocol 17 map public sections (camps, coliseum and gates, bushes, reserved props and ground variants) against
    /// the Rust-generated vectors.</summary>
    public sealed class MapBlobPublicTests
    {
        static JsonElement Fixture() => JsonDocument.Parse(File.ReadAllText(Path.Combine(Util.RepoRoot(), "protocol", "fixtures", Util.FixtureName))).RootElement;

        static JsonElement ServerVector(string name)
        {
            foreach (var v in Fixture().GetProperty("server").EnumerateArray())
                if (v.GetProperty("name").GetString() == name) return v;
            throw new AssertionException("missing Rust vector " + name);
        }

        static void AssertPublic(JsonElement expected, MapBlob map, string name)
        {
            var camps = expected.GetProperty("camps");
            Assert.AreEqual(camps.GetArrayLength(), map.Camps.Length, name + " camps");
            for (int i = 0; i < map.Camps.Length; i++)
            {
                Assert.AreEqual(camps[i].GetProperty("x").GetUInt16(), map.Camps[i].X, name);
                Assert.AreEqual(camps[i].GetProperty("y").GetUInt16(), map.Camps[i].Y, name);
                Assert.AreEqual(camps[i].GetProperty("r").GetUInt16(), map.Camps[i].R, name);
                Assert.AreEqual(camps[i].GetProperty("zone").GetByte(), map.Camps[i].Zone, name);
            }
            var col = expected.GetProperty("coliseum");
            if (col.ValueKind == JsonValueKind.Null) Assert.IsNull(map.Coliseum, name);
            else
            {
                Assert.IsNotNull(map.Coliseum, name);
                Assert.AreEqual(col.GetProperty("x").GetUInt16(), map.Coliseum.X);
                Assert.AreEqual(col.GetProperty("y").GetUInt16(), map.Coliseum.Y);
                Assert.AreEqual(col.GetProperty("w").GetUInt16(), map.Coliseum.W);
                Assert.AreEqual(col.GetProperty("h").GetUInt16(), map.Coliseum.H);
                var gates = col.GetProperty("gates");
                Assert.AreEqual(gates.GetArrayLength(), map.Coliseum.Gates.Length);
                for (int g = 0; g < gates.GetArrayLength(); g++)
                {
                    Assert.AreEqual(gates[g].GetProperty("side").GetByte(), map.Coliseum.Gates[g].Side);
                    var tiles = gates[g].GetProperty("tiles");
                    Assert.AreEqual(tiles.GetArrayLength(), map.Coliseum.Gates[g].Tiles.Length);
                    for (int t = 0; t < tiles.GetArrayLength(); t++)
                    {
                        Assert.AreEqual(tiles[t].GetProperty("x").GetUInt16(), map.Coliseum.Gates[g].Tiles[t].X);
                        Assert.AreEqual(tiles[t].GetProperty("y").GetUInt16(), map.Coliseum.Gates[g].Tiles[t].Y);
                    }
                }
            }
            AssertPlane(expected.GetProperty("bushes"), map.Bushes, name + " bushes");
            var props = expected.GetProperty("props");
            Assert.AreEqual(props.GetArrayLength(), map.Props.Length, name + " props");
            for (int i = 0; i < map.Props.Length; i++)
            {
                Assert.AreEqual(props[i].GetProperty("kind").GetByte(), map.Props[i].Kind);
                Assert.AreEqual(props[i].GetProperty("x").GetUInt16(), map.Props[i].X);
                Assert.AreEqual(props[i].GetProperty("y").GetUInt16(), map.Props[i].Y);
                Assert.AreEqual(props[i].GetProperty("variant").GetByte(), map.Props[i].Variant);
                Assert.AreEqual(props[i].GetProperty("flags").GetByte(), map.Props[i].Flags);
            }
            AssertPlane(expected.GetProperty("groundVariants"), map.GroundVariants, name + " ground variants");
        }

        static void AssertPlane(JsonElement expected, byte[] actual, string name)
        {
            if (expected.ValueKind == JsonValueKind.Null) { Assert.IsNull(actual, name); return; }
            var want = new byte[expected.GetArrayLength()];
            for (int i = 0; i < want.Length; i++) want[i] = expected[i].GetByte();
            CollectionAssert.AreEqual(want, actual, name);
        }

        [Test]
        public void EveryWelcomeVectorDecodesItsPublicSections()
        {
            int welcomes = 0;
            foreach (var v in Fixture().GetProperty("server").EnumerateArray())
            {
                if (!v.TryGetProperty("decoded", out var decoded) || !decoded.TryGetProperty("map", out var expected)) continue;
                var name = v.GetProperty("name").GetString();
                var welcome = (ServerMsg.Welcome)ServerMsg.Decode(Util.FromHex(v.GetProperty("hex").GetString()));
                AssertPublic(expected, welcome.Map, name);
                welcomes++;
            }
            Assert.Greater(welcomes, 2);
        }

        [TestCase("welcome_public_all")]
        [TestCase("welcome_public_shipped")]
        public void PublicWelcomeDecodesAndReencodesByteForByte(string name)
        {
            var v = ServerVector(name);
            byte[] bytes = Util.FromHex(v.GetProperty("hex").GetString());
            var welcome = (ServerMsg.Welcome)ServerMsg.Decode(bytes);
            var map = welcome.Map;
            Assert.AreEqual(3, map.Camps.Length);
            Assert.AreEqual((byte)5, map.Camps[1].Zone);
            Assert.AreEqual(4, map.Coliseum.Gates.Length);
            Assert.AreEqual((byte)3, map.Coliseum.Gates[3].Side);
            Assert.AreEqual((byte)7, map.Bushes[3 * map.W + 6]);
            Assert.AreEqual(name == "welcome_public_all" ? 2 : 0, map.Props.Length);
            Assert.AreEqual(name == "welcome_public_all", map.GroundVariants != null);
            CollectionAssert.AreEqual(bytes, welcome.Encode(), name + " re-encodes byte for byte");

            // The writer path recomputes the same version-2 semantic hash from the decoded sections.
            var rebuilt = new MapBlob(map.W, map.H, map.Tiles, map.Terrain, map.Regions, map.TerrainMode)
                .WithPublic(map.Camps, map.Coliseum, map.Bushes, map.Props, map.GroundVariants);
            Assert.AreEqual(map.SemanticHash, rebuilt.SemanticHash);
            Assert.AreEqual(map.ContextHash, rebuilt.ContextHash);
            Assert.IsTrue(rebuilt.CanonicalEquals(map));
            Assert.IsFalse(new MapBlob(map.W, map.H, map.Tiles, map.Terrain, map.Regions, map.TerrainMode).CanonicalEquals(map));
        }

        static IEnumerable<TestCaseData> MalformedMapVectors()
        {
            foreach (var v in Fixture().GetProperty("malformedMap").EnumerateArray())
                yield return new TestCaseData(v.GetProperty("name").GetString(), v.GetProperty("hex").GetString(), v.GetProperty("reason").GetString())
                    .SetName("MalformedMap_" + v.GetProperty("name").GetString());
        }

        [TestCaseSource(nameof(MalformedMapVectors))]
        public void MalformedMapIsRefusedForTheRustReason(string name, string hex, string reason)
        {
            var e = Assert.Throws<DecodeException>(() => ServerMsg.Decode(Util.FromHex(hex)), name);
            if (reason == "truncated")
            {
                Assert.AreEqual(DecodeError.Truncated, e.Error, name);
                return;
            }
            Assert.AreEqual(DecodeError.BadMap, e.Error, name);
            Assert.AreEqual(DecodeError.BadMap + ": " + reason, e.Message, name);
        }

        [Test]
        public void MalformedMapVectorsCoverEveryRefusal()
        {
            var reasons = new HashSet<string>();
            foreach (var v in Fixture().GetProperty("malformedMap").EnumerateArray()) reasons.Add(v.GetProperty("reason").GetString());
            foreach (var r in new[] { "section version", "presence", "camp count", "camp zone", "coliseum rect", "gate count", "gate side",
                "gate tiles", "gate tile", "length", "run", "truncated", "prop count", "semantic hash" })
                Assert.IsTrue(reasons.Contains(r), "missing malformedMap reason " + r);
        }

        [Test]
        public void EncoderRefusesWhatTheDecoderRefuses()
        {
            var map = new MapBlob(4, 3, new byte[12]);
            Assert.Throws<EncodeException>(() => map.WithPublic(new[] { new MapCamp(1, 1, 80, 0) }, null, null, null, null));
            Assert.Throws<EncodeException>(() => map.WithPublic(null, new MapColiseum(0, 0, 4, 3, new[] { new MapGate(4, new[] { new MapTile(0, 0) }) }), null, null, null));
            Assert.Throws<EncodeException>(() => map.WithPublic(null, new MapColiseum(0, 0, 4, 3, new[] { new MapGate(0, new[] { new MapTile(4, 0) }) }), null, null, null));
            Assert.Throws<EncodeException>(() => map.WithPublic(null, new MapColiseum(1, 0, 4, 3, new MapGate[0]), null, null, null));
            Assert.Throws<EncodeException>(() => map.WithPublic(null, null, new byte[11], null, null));
            Assert.Throws<EncodeException>(() => map.WithPublic(null, null, null, null, new byte[13]));
            Assert.Throws<EncodeException>(() => map.WithPublic(null, null, null, new MapProp[MapBlob.MaxProps + 1], null));
            // Empty sections are absent: the same bytes as a map that never had them.
            var same = map.WithPublic(new MapCamp[0], null, null, new MapProp[0], null);
            Assert.AreEqual(map.SemanticHash, same.SemanticHash);
            Assert.IsTrue(same.CanonicalEquals(map));
        }
    }
}
