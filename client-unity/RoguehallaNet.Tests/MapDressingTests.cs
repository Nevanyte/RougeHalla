using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>P-DRESS-BAKE-1 oracle: the map blob's dressing sections (prop list, ground-variant plane) are checked by
    /// value, and the Rust-generated vectors carry dressed maps. The rules (docs/backlog/packets/P-DRESS-BAKE-1.md "Wire
    /// rules"): flags only tall (1) and legacy (2); a rule prop's kind 1..100, a legacy prop's kind below 34; a rule prop's
    /// variant at most 3; the prop's tile (x / 32, y / 32) inside the map; rows strictly increasing in (y, x, kind); every
    /// ground-variant cell at most 15. The malformedMap vectors themselves are checked by
    /// <see cref="MapBlobPublicTests.MalformedMapIsRefusedForTheRustReason"/>.</summary>
    public sealed class MapDressingTests
    {
        static JsonElement Fixture() => JsonDocument.Parse(File.ReadAllText(Path.Combine(Util.RepoRoot(), "protocol", "fixtures", Util.FixtureName))).RootElement;

        const ushort W = 8, H = 6;

        /// <summary>The props of welcome_dress_props_ground and welcome_dress_props_only, in wire order.</summary>
        static MapProp[] GoldenProps() => new[]
        {
            new MapProp(41, 48, 40, 0, 1),
            new MapProp(3, 100, 60, 2, 0),
            new MapProp(3, 101, 60, 3, 0),
            new MapProp(7, 101, 60, 0, 0),
            new MapProp(33, 16, 176, 200, 2),
            new MapProp(100, 32 * W - 1, 32 * H - 1, 1, 1),
        };

        static byte[] GoldenGround()
        {
            var g = new byte[W * H];
            for (int i = 0; i < g.Length; i++) g[i] = (byte)(i % 16);
            return g;
        }

        static MapBlob Welcome(string name)
        {
            foreach (var v in Fixture().GetProperty("server").EnumerateArray())
                if (v.GetProperty("name").GetString() == name)
                    return ((ServerMsg.Welcome)ServerMsg.Decode(Util.FromHex(v.GetProperty("hex").GetString()))).Map;
            Assert.Fail("missing Rust vector " + name + " (P-DRESS-BAKE-1 adds it)");
            return null;
        }

        static void AssertProps(MapProp[] want, MapProp[] got, string name)
        {
            Assert.AreEqual(want.Length, got.Length, name + " prop count");
            for (int i = 0; i < want.Length; i++)
            {
                Assert.AreEqual(want[i].Kind, got[i].Kind, name + " kind " + i);
                Assert.AreEqual(want[i].X, got[i].X, name + " x " + i);
                Assert.AreEqual(want[i].Y, got[i].Y, name + " y " + i);
                Assert.AreEqual(want[i].Variant, got[i].Variant, name + " variant " + i);
                Assert.AreEqual(want[i].Flags, got[i].Flags, name + " flags " + i);
            }
        }

        [Test]
        public void TheVectorsCarryAMapWithPropsAndAGroundPlane()
        {
            var map = Welcome("welcome_dress_props_ground");
            Assert.AreEqual(W, map.W);
            Assert.AreEqual(H, map.H);
            AssertProps(GoldenProps(), map.Props, "welcome_dress_props_ground");
            CollectionAssert.AreEqual(GoldenGround(), map.GroundVariants);
        }

        [Test]
        public void TheVectorsCarryAMapWithPropsOnly()
        {
            var map = Welcome("welcome_dress_props_only");
            AssertProps(GoldenProps(), map.Props, "welcome_dress_props_only");
            Assert.IsNull(map.GroundVariants);
        }

        [Test]
        public void TheVectorsCarryEveryDressingRefusal()
        {
            var want = new Dictionary<string, string>
            {
                ["map17_dress_prop_kind_zero"] = "prop kind",
                ["map17_dress_prop_kind_over"] = "prop kind",
                ["map17_dress_legacy_kind_over"] = "prop kind",
                ["map17_dress_prop_flags"] = "prop flags",
                ["map17_dress_prop_variant"] = "prop variant",
                ["map17_dress_prop_x_outside"] = "prop tile",
                ["map17_dress_prop_y_outside"] = "prop tile",
                ["map17_dress_prop_order"] = "prop order",
                ["map17_dress_prop_duplicate"] = "prop order",
                ["map17_dress_props_truncated"] = "truncated",
                ["map17_dress_ground_over"] = "ground variant",
                ["map17_dress_ground_long"] = "run",
            };
            var seen = new Dictionary<string, string>();
            foreach (var v in Fixture().GetProperty("malformedMap").EnumerateArray())
                seen[v.GetProperty("name").GetString()] = v.GetProperty("reason").GetString();
            foreach (var kv in want)
            {
                Assert.IsTrue(seen.ContainsKey(kv.Key), "missing malformedMap vector " + kv.Key);
                Assert.AreEqual(kv.Value, seen[kv.Key], kv.Key + " reason");
            }
        }

        static MapBlob Plain() => new MapBlob(W, H, new byte[W * H]);

        [Test]
        public void TheEncoderAcceptsDressingOnEveryBoundary()
        {
            var map = Plain().WithPublic(null, null, null, GoldenProps(), GoldenGround());
            AssertProps(GoldenProps(), map.Props, "boundary");
        }

        static IEnumerable<TestCaseData> OutOfRange()
        {
            var ok = new MapProp(1, 16, 16, 0, 0);
            yield return new TestCaseData(new[] { new MapProp(0, 16, 16, 0, 0) }, null).SetName("Dressing_KindZero");
            yield return new TestCaseData(new[] { new MapProp(101, 16, 16, 0, 0) }, null).SetName("Dressing_KindOver");
            yield return new TestCaseData(new[] { new MapProp(34, 16, 16, 0, 2) }, null).SetName("Dressing_LegacyKindOver");
            yield return new TestCaseData(new[] { new MapProp(1, 16, 16, 0, 4) }, null).SetName("Dressing_Flags");
            yield return new TestCaseData(new[] { new MapProp(1, 16, 16, 4, 0) }, null).SetName("Dressing_Variant");
            yield return new TestCaseData(new[] { new MapProp(1, 32 * W, 16, 0, 0) }, null).SetName("Dressing_XOutside");
            yield return new TestCaseData(new[] { new MapProp(1, 16, 32 * H, 0, 0) }, null).SetName("Dressing_YOutside");
            yield return new TestCaseData(new[] { new MapProp(1, 16, 48, 0, 0), ok }, null).SetName("Dressing_Order");
            yield return new TestCaseData(new[] { new MapProp(2, 16, 16, 0, 0), ok }, null).SetName("Dressing_KindOrderOnOneSpot");
            yield return new TestCaseData(new[] { ok, ok }, null).SetName("Dressing_Duplicate");
            var over = new byte[W * H];
            for (int i = 0; i < over.Length; i++) over[i] = 16;
            yield return new TestCaseData(null, over).SetName("Dressing_GroundOver");
        }

        [TestCaseSource(nameof(OutOfRange))]
        public void TheEncoderRefusesOutOfRangeDressing(MapProp[] props, byte[] ground)
        {
            Assert.Throws<EncodeException>(() => Plain().WithPublic(null, null, null, props, ground));
        }
    }
}
