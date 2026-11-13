using System;
using System.IO;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>P-WIRE17-MAP-3 oracle (C#): each zone's landmark anchor in the map blob (section version 3, presence2 0x02; layout
    /// in docs/backlog/packets/P-WIRE17-MAP-3.md "Wire layout"). The Rust-generated Welcomes decode to the golden anchors and
    /// re-encode byte for byte; the encoder refuses what the decoder refuses. The malformedMap refusals are also checked by
    /// <see cref="MapBlobPublicTests.MalformedMapIsRefusedForTheRustReason"/>; this file requires that they exist.</summary>
    public sealed class MapAnchorsTests
    {
        static JsonElement Fixture() => JsonDocument.Parse(File.ReadAllText(Path.Combine(Util.RepoRoot(), "protocol", "fixtures", Util.FixtureName))).RootElement;

        static JsonElement Find(string array, string name)
        {
            foreach (var v in Fixture().GetProperty(array).EnumerateArray())
                if (v.GetProperty("name").GetString() == name) return v;
            throw new AssertionException("missing Rust vector " + name + " (P-WIRE17-MAP-3 adds it)");
        }

        static MapTile T(ushort x, ushort y) => new MapTile(x, y);

        static MapAnchor A(byte zone, byte kind, ushort cx, ushort cy, ushort fx, ushort fy, ushort fw, ushort fh, byte front, params MapTile[] entrance)
            => new MapAnchor(zone, kind, T(cx, cy), new MapRect(fx, fy, fw, fh), front, entrance);

        /// <summary>The same five anchors as crates/rh-protocol/tests/map_anchors.rs `five()` (the golden vector
        /// welcome_public_anchors).</summary>
        static MapAnchor[] Five() => new[]
        {
            A(1, MapBlob.AnchorKindVolcano, 1, 1, 0, 0, 3, 3, 0),
            A(2, MapBlob.AnchorKindChurch, 7, 2, 4, 0, 4, 3, 4, T(4, 0), T(4, 1), T(4, 2)),
            A(3, MapBlob.AnchorKindBogTree, 1, 4, 0, 3, 3, 3, 8),
            A(4, MapBlob.AnchorKindCave, 5, 4, 4, 3, 4, 3, 12, T(5, 3), T(6, 3), T(7, 3)),
            A(5, MapBlob.AnchorKindHall, 3, 2, 0, 0, 8, 6, 15),
        };

        static string Show(MapAnchor[] anchors)
        {
            if (anchors == null) return "null";
            var parts = new string[anchors.Length];
            for (int i = 0; i < anchors.Length; i++)
            {
                var a = anchors[i];
                var tiles = new string[a.Entrance.Length];
                for (int j = 0; j < tiles.Length; j++) tiles[j] = a.Entrance[j].X + "," + a.Entrance[j].Y;
                parts[i] = $"z{a.Zone} k{a.Kind} c{a.Centre.X},{a.Centre.Y} f{a.Footprint.X},{a.Footprint.Y},{a.Footprint.W},{a.Footprint.H} d{a.Front} e[{string.Join(" ", tiles)}]";
            }
            return string.Join(" | ", parts);
        }

        static MapBlob Welcome(string name, out byte[] bytes, out ServerMsg.Welcome welcome)
        {
            bytes = Util.FromHex(Find("server", name).GetProperty("hex").GetString());
            welcome = (ServerMsg.Welcome)ServerMsg.Decode(bytes);
            return welcome.Map;
        }

        [Test]
        public void TheFiveAnchorWelcomeDecodesToTheGoldenAnchorsAndReencodesByteForByte()
        {
            var map = Welcome("welcome_public_anchors", out var bytes, out var welcome);
            Assert.AreEqual(3, map.Camps.Length, "the all-sections sample's camps");
            Assert.IsNull(map.Patience, "no patience plane");
            Assert.AreEqual(Show(Five()), Show(map.Anchors), "the five golden anchors, zone-code order");
            CollectionAssert.AreEqual(bytes, welcome.Encode(), "re-encodes byte for byte");
            var rebuilt = new MapBlob(map.W, map.H, map.Tiles, map.Terrain, map.Regions, map.TerrainMode)
                .WithPublic(map.Camps, map.Coliseum, map.Bushes, map.Props, map.GroundVariants, map.Patience, map.Anchors);
            Assert.AreEqual(map.SemanticHash, rebuilt.SemanticHash, "the writer recomputes the semantic hash over the anchors");
            Assert.IsTrue(rebuilt.CanonicalEquals(map));
            var without = new MapBlob(map.W, map.H, map.Tiles, map.Terrain, map.Regions, map.TerrainMode)
                .WithPublic(map.Camps, map.Coliseum, map.Bushes, map.Props, map.GroundVariants, map.Patience);
            Assert.IsFalse(without.CanonicalEquals(map), "the anchors are part of the canonical map");
        }

        [Test]
        public void TheOneAnchorWelcomeDecodesAndReencodes()
        {
            var map = Welcome("welcome_public_anchor_one", out var bytes, out var welcome);
            Assert.AreEqual(Show(new[] { Five()[3] }), Show(map.Anchors), "the Frost cave with its three-tile mouth");
            CollectionAssert.AreEqual(bytes, welcome.Encode(), "re-encodes byte for byte");
        }

        [Test]
        public void GuardExistingPublicWelcomesCarryNoAnchors()
        {
            foreach (var name in new[] { "welcome_public_all", "welcome_public_shipped", "welcome_public_patience" })
            {
                var map = Welcome(name, out _, out _);
                Assert.IsNotNull(map.Anchors, name);
                Assert.AreEqual(0, map.Anchors.Length, name);
            }
        }

        [TestCase("map17_anchor_count_zero", "anchor count")]
        [TestCase("map17_anchor_count_over", "anchor count")]
        [TestCase("map17_anchor_zone", "anchor zone")]
        [TestCase("map17_anchor_order", "anchor order")]
        [TestCase("map17_anchor_duplicate", "anchor order")]
        [TestCase("map17_anchor_kind", "anchor kind")]
        [TestCase("map17_anchor_footprint", "anchor footprint")]
        [TestCase("map17_anchor_centre", "anchor centre")]
        [TestCase("map17_anchor_front", "anchor front")]
        [TestCase("map17_anchor_entrance_over", "anchor entrance")]
        [TestCase("map17_anchor_entrance_tile", "anchor entrance")]
        [TestCase("map17_anchor_truncated", "truncated")]
        [TestCase("map17_v3_presence_unknown", "presence")]
        public void TheAnchorRefusalVectorsExist(string name, string reason)
        {
            var v = Find("malformedMap", name);
            Assert.AreEqual(reason, v.GetProperty("reason").GetString(), name);
            var e = Assert.Throws<DecodeException>(() => ServerMsg.Decode(Util.FromHex(v.GetProperty("hex").GetString())), name);
            if (reason == "truncated") Assert.AreEqual(DecodeError.Truncated, e.Error, name);
            else Assert.AreEqual(DecodeError.BadMap + ": " + reason, e.Message, name);
        }

        static MapAnchor[] Edited(int i, Func<MapAnchor, MapAnchor> edit)
        {
            var all = Five();
            all[i] = edit(all[i]);
            return all;
        }

        static void Refused(MapBlob map, MapAnchor[] anchors, string reason, string what)
        {
            var e = Assert.Throws<EncodeException>(() => map.WithPublic(null, null, null, null, null, null, anchors), what);
            StringAssert.EndsWith(reason, e.Message, what);
        }

        [Test]
        public void TheEncoderCarriesTheAnchorsAndRefusesWhatTheDecoderRefuses()
        {
            var map = new MapBlob(8, 6, new byte[48]);
            var with = map.WithPublic(null, null, null, null, null, null, Five());
            Assert.AreEqual(Show(Five()), Show(with.Anchors));
            Assert.AreNotEqual(map.WithPublic(null, null, null, null, null).SemanticHash, with.SemanticHash, "the hash covers the anchors");
            var moved = Edited(0, a => A(1, a.Kind, 1, 1, 0, 0, 3, 3, 1));
            Assert.AreNotEqual(with.SemanticHash, map.WithPublic(null, null, null, null, null, null, moved).SemanticHash, "one front moved");
            // Absent (null or empty) stays the map that never had anchors.
            Assert.IsTrue(map.WithPublic(null, null, null, null, null, null, new MapAnchor[0]).CanonicalEquals(map.WithPublic(null, null, null, null, null)));

            var six = new MapAnchor[6];
            Array.Copy(Five(), six, 5);
            six[5] = A(5, MapBlob.AnchorKindHall, 3, 2, 0, 0, 8, 6, 0);
            Refused(map, six, "anchor count", "six anchors");
            Refused(map, Edited(0, a => A(0, a.Kind, 1, 1, 0, 0, 3, 3, 0)), "anchor zone", "zone 0");
            Refused(map, Edited(4, a => A(6, a.Kind, 3, 2, 0, 0, 8, 6, 15)), "anchor zone", "zone 6");
            var swapped = Five();
            (swapped[1], swapped[2]) = (swapped[2], swapped[1]);
            Refused(map, swapped, "anchor order", "zones out of order");
            Refused(map, Edited(2, a => A(2, a.Kind, 1, 4, 0, 3, 3, 3, 8)), "anchor order", "zone 2 twice");
            Refused(map, Edited(0, a => A(1, 0, 1, 1, 0, 0, 3, 3, 0)), "anchor kind", "kind 0");
            Refused(map, Edited(0, a => A(1, 6, 1, 1, 0, 0, 3, 3, 0)), "anchor kind", "kind 6");
            Refused(map, Edited(0, a => A(1, a.Kind, 7, 1, 6, 0, 3, 3, 0)), "anchor footprint", "footprint off the map");
            Refused(map, Edited(0, a => A(1, a.Kind, 1, 1, 0, 0, 0, 3, 0)), "anchor footprint", "empty footprint");
            Refused(map, Edited(0, a => A(1, a.Kind, 3, 1, 0, 0, 3, 3, 0)), "anchor centre", "centre outside");
            Refused(map, Edited(0, a => A(1, a.Kind, 1, 1, 0, 0, 3, 3, 16)), "anchor front", "front 16");
            var seventeen = new MapTile[MapBlob.MaxAnchorEntrance + 1];
            for (int i = 0; i < seventeen.Length; i++) seventeen[i] = T(1, 1);
            Refused(map, Edited(4, a => A(5, a.Kind, 3, 2, 0, 0, 8, 6, 15, seventeen)), "anchor entrance", "seventeen entrance tiles");
            Refused(map, Edited(1, a => A(2, a.Kind, 7, 2, 4, 0, 4, 3, 4, T(8, 0))), "anchor entrance", "entrance off the map");
        }
    }
}
