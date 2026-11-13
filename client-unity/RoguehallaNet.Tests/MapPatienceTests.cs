using System;
using System.IO;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>P-WIRE17-MAP-2 oracle (C#): the camp patience plane in the map blob (section version 3, presence2 0x01; layout in
    /// docs/backlog/packets/P-WIRE17-MAP-2.md "Wire layout"). The Rust-generated Welcome decodes to the golden plane and
    /// re-encodes byte for byte; the encoder refuses what the decoder refuses. The malformedMap refusals are checked by
    /// <see cref="MapBlobPublicTests.MalformedMapIsRefusedForTheRustReason"/>; this file requires that they exist.</summary>
    public sealed class MapPatienceTests
    {
        static JsonElement Fixture() => JsonDocument.Parse(File.ReadAllText(Path.Combine(Util.RepoRoot(), "protocol", "fixtures", Util.FixtureName))).RootElement;

        static JsonElement Find(string array, string name)
        {
            foreach (var v in Fixture().GetProperty(array).EnumerateArray())
                if (v.GetProperty("name").GetString() == name) return v;
            throw new AssertionException("missing Rust vector " + name + " (P-WIRE17-MAP-2 adds it)");
        }

        static byte[] GoldenPlane(int cells)
        {
            var plane = new byte[cells];
            for (int i = 0; i < cells; i++) plane[i] = (byte)(i % 4);
            return plane;
        }

        [Test]
        public void ThePatienceWelcomeDecodesToTheGoldenPlaneAndReencodesByteForByte()
        {
            byte[] bytes = Util.FromHex(Find("server", "welcome_public_patience").GetProperty("hex").GetString());
            var welcome = (ServerMsg.Welcome)ServerMsg.Decode(bytes);
            var map = welcome.Map;
            Assert.AreEqual(3, map.Camps.Length, "the all-sections sample's camps");
            CollectionAssert.AreEqual(GoldenPlane(map.W * map.H), map.Patience, "cell i carries i % 4");
            CollectionAssert.AreEqual(bytes, welcome.Encode(), "re-encodes byte for byte");
            var rebuilt = new MapBlob(map.W, map.H, map.Tiles, map.Terrain, map.Regions, map.TerrainMode)
                .WithPublic(map.Camps, map.Coliseum, map.Bushes, map.Props, map.GroundVariants, map.Patience);
            Assert.AreEqual(map.SemanticHash, rebuilt.SemanticHash, "the writer recomputes the version-3 semantic hash");
            Assert.IsTrue(rebuilt.CanonicalEquals(map));
            var without = new MapBlob(map.W, map.H, map.Tiles, map.Terrain, map.Regions, map.TerrainMode)
                .WithPublic(map.Camps, map.Coliseum, map.Bushes, map.Props, map.GroundVariants);
            Assert.IsFalse(without.CanonicalEquals(map), "the plane is part of the canonical map");
        }

        [Test]
        public void ExistingPublicWelcomesCarryNoPlane()
        {
            foreach (var name in new[] { "welcome_public_all", "welcome_public_shipped" })
            {
                var welcome = (ServerMsg.Welcome)ServerMsg.Decode(Util.FromHex(Find("server", name).GetProperty("hex").GetString()));
                Assert.IsNull(welcome.Map.Patience, name);
            }
        }

        [TestCase("map17_patience_camp_over", "patience camp")]
        [TestCase("map17_patience_without_camps", "patience camp")]
        [TestCase("map17_patience_length", "length")]
        [TestCase("map17_patience_truncated", "truncated")]
        [TestCase("map17_v3_presence_empty", "presence")]
        [TestCase("map17_v3_presence_unknown", "presence")]
        public void ThePatienceRefusalVectorsExist(string name, string reason)
        {
            var v = Find("malformedMap", name);
            Assert.AreEqual(reason, v.GetProperty("reason").GetString(), name);
            var e = Assert.Throws<DecodeException>(() => ServerMsg.Decode(Util.FromHex(v.GetProperty("hex").GetString())), name);
            if (reason == "truncated") Assert.AreEqual(DecodeError.Truncated, e.Error, name);
            else Assert.AreEqual(DecodeError.BadMap + ": " + reason, e.Message, name);
        }

        static MapCamp[] TwoCamps() => new[] { new MapCamp(48, 48, 80, 1), new MapCamp(208, 112, 80, 4) };

        [Test]
        public void TheEncoderCarriesThePlaneAndRefusesWhatTheDecoderRefuses()
        {
            var map = new MapBlob(8, 6, new byte[48]);
            var plane = new byte[48];
            plane[9] = 1; plane[30] = 2;
            var with = map.WithPublic(TwoCamps(), null, null, null, null, plane);
            CollectionAssert.AreEqual(plane, with.Patience);
            Assert.AreNotEqual(map.WithPublic(TwoCamps(), null, null, null, null).SemanticHash, with.SemanticHash, "the hash covers the plane");
            var over = (byte[])plane.Clone();
            over[0] = 3;
            Assert.Throws<EncodeException>(() => map.WithPublic(TwoCamps(), null, null, null, null, over), "index past the camp count");
            Assert.Throws<EncodeException>(() => map.WithPublic(null, null, null, null, null, plane), "a plane without camps");
            Assert.Throws<EncodeException>(() => map.WithPublic(TwoCamps(), null, null, null, null, new byte[47]), "wrong size");
            // Absent stays version 2: the same map as one that never had a plane.
            Assert.IsTrue(map.WithPublic(TwoCamps(), null, null, null, null, null).CanonicalEquals(map.WithPublic(TwoCamps(), null, null, null, null)));
        }
    }
}
