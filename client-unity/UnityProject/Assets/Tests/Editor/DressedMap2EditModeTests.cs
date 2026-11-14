using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using Roguehalla.Client;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-DRESS-2 oracle, Unity half (docs/backlog/packets/P-UNITY-DRESS-2.md). Shadows: a shipped prop casts as its row's tall flag
    /// says (the flag that also decides its fade, RegionProps.cs:168), whatever its stand-in sprite's own flag; a client-rolled prop
    /// (a map without dressing) keeps the art's flag. Plague: on a dressed map the client's Plague noise paints no Water and no Mud of its own (the server's ground variants 7 and 8 are
    /// the only ones); without dressing the output is today's, pinned by digest.
    /// Strengths are read from RegionShadowMap.PropStrengths (a stub accessor over what Collect already computes); only which of the
    /// two strengths a prop gets is pinned, never a texture colour.
    /// </summary>
    public sealed class DressedMap2EditModeTests
    {
        const float TallStrength = .9f, FlatStrength = .75f;

        /// <summary>40 x 40 open floor, left half Plague, right half Frost (sunny: shadows are cast): no wall caster, no temple, no coliseum.</summary>
        static MapBlob Open()
        {
            const int n = 40; var regions = new byte[n * n];
            for (int y = 0; y < n; y++) for (int x = 0; x < n; x++) regions[y * n + x] = (byte)(x < n / 2 ? 3 : 4);
            return new MapBlob(n, n, new byte[n * n], null, regions);
        }

        static List<float> Strengths(MapBlob map)
        {
            var field = new RegionField(); field.Build(map.Regions, map.W, map.H);
            var sm = new RegionShadowMap(map, field);
            try { return new List<float>(sm.PropStrengths); } finally { sm.Dispose(); }
        }

        // Rows sorted by (y, x, kind), all in the Frost half. Kind 14 (sent.deadtree) has a tall sprite; kind 2 (fire.crystal) a low one.
        static readonly MapProp[] Rows =
        {
            new MapProp(14, 800, 320, 0, 0),    // art tall, row flat   -> flat
            new MapProp(2, 880, 320, 0, 1),     // art low, row tall    -> tall
            new MapProp(14, 960, 320, 0, 1),    // art tall, row tall   -> tall
            new MapProp(2, 1040, 320, 0, 0),    // art low, row flat    -> flat
        };

        [Test]
        public void TheFixtureSpritesDisagreeWithTheirRows()
        {
            Assert.IsTrue(RegionPropArt.TryGet("sent.deadtree", out var tree)); Assert.IsTrue(tree.Tall, "kind 14's sprite is tall");
            Assert.IsTrue(RegionPropArt.TryGet("fire.crystal", out var crystal)); Assert.IsFalse(crystal.Tall, "kind 2's sprite is low");
        }

        [Test]
        public void AShippedPropCastsAsItsRowSaysWhateverItsSprite()
        {
            var s = Strengths(Open().WithPublic(null, null, null, Rows, null));
            Assert.AreEqual(4, s.Count, "every shipped prop is a caster");
            Assert.AreEqual(FlatStrength, s[0], 1e-4f, "tall sprite, flat row: casts flat");
            Assert.AreEqual(TallStrength, s[1], 1e-4f, "low sprite, tall row: casts tall");
            Assert.AreEqual(TallStrength, s[2], 1e-4f, "tall sprite, tall row");
            Assert.AreEqual(FlatStrength, s[3], 1e-4f, "low sprite, flat row");
        }

        [Test]
        public void AClientRolledPropKeepsTheArtsFlag()
        {
            var map = Open();
            var s = Strengths(map);
            Assert.Greater(s.Count, 0, "the scatter places props on this map today");
            foreach (var v in s) Assert.IsTrue(Mathf.Approximately(v, TallStrength) || Mathf.Approximately(v, FlatStrength), "strength " + v);
            // No placement is shipped, so each caster's strength is its sprite's: the count of tall casters equals the tall sprites placed.
            int tallPlaced = 0, flatPlaced = 0;
            var field = new RegionField(); field.Build(map.Regions, map.W, map.H);
            foreach (var pl in RegionProps.Scatter(map))
            {
                Assert.IsFalse(pl.Shipped);
                if (RegionPropArt.TryGet(pl.Art, out var art) && art.Height * pl.Scale >= .38f) { if (art.Tall) tallPlaced++; else flatPlaced++; }
            }
            int tallCast = s.FindAll(v => v > .8f).Count;
            Assert.LessOrEqual(tallCast, tallPlaced); Assert.LessOrEqual(s.Count - tallCast, flatPlaced);
        }

        static List<float> HalfWidths(MapBlob map)
        {
            var field = new RegionField(); field.Build(map.Regions, map.W, map.H);
            var sm = new RegionShadowMap(map, field);
            try { return new List<float>(sm.PropHalfWidths); } finally { sm.Dispose(); }
        }

        [Test]
        public void AShippedPropsShadowWidthFollowsItsRowToo()
        {
            // The width rule reads the same tall test as the strength: tall rows are narrow (.16 of the art width), flat rows wide (.30).
            Assert.IsTrue(RegionPropArt.TryGet("sent.deadtree", out var tree)); Assert.IsTrue(RegionPropArt.TryGet("fire.crystal", out var crystal));
            var hw = HalfWidths(Open().WithPublic(null, null, null, Rows, null));
            Assert.AreEqual(4, hw.Count);
            Assert.AreEqual(Mathf.Max(.07f, tree.Width * .30f), hw[0], 1e-4f, "tall sprite, flat row");
            Assert.AreEqual(Mathf.Max(.07f, crystal.Width * .16f), hw[1], 1e-4f, "low sprite, tall row");
            Assert.AreEqual(Mathf.Max(.07f, tree.Width * .16f), hw[2], 1e-4f, "tall sprite, tall row");
            Assert.AreEqual(Mathf.Max(.07f, crystal.Width * .30f), hw[3], 1e-4f, "low sprite, flat row");
        }

        // ---- Plague -------------------------------------------------------------------------------------------------------------

        // One prop in the Frost half is enough to make the map dressed (MapBlob.Props non-empty, RegionProps.IsDressed).
        static readonly MapProp[] OneProp = { new MapProp(33, 960, 320, 0, 1) };

        static MapBlob Dressed() { return Open().WithPublic(null, null, null, OneProp, null); }

        static ulong Fnv(IEnumerable<byte> bytes) { ulong h = 14695981039346656037UL; foreach (var b in bytes) { h ^= b; h *= 1099511628211UL; } return h; }

        static IEnumerable<byte> Bytes(Color32[] px) { foreach (var c in px) { yield return c.r; yield return c.g; yield return c.b; yield return c.a; } }

        [Test]
        public void TheDressedPredicateIsTheShippedPropsTest()
        {
            Assert.IsTrue(RegionProps.IsDressed(Dressed()));
            Assert.IsFalse(RegionProps.IsDressed(Open()));
            Assert.IsFalse(RegionProps.IsDressed(null));
        }

        [Test]
        public void WithoutDressingThePlagueNoiseHasWaterAndMud()
        {
            var g = PlagueGround.Build(Open());
            Assert.Greater(g.WaterTiles, 0, "the fixture has noise water"); Assert.Greater(g.MudTiles, 0, "and noise mud"); Assert.Greater(g.GrassTiles, 0);
        }

        [Test]
        public void OnADressedPlagueMapTheClientPaintsNoWaterAndNoMud()
        {
            // Grass variation stays on a dressed map (the server sends no grass variant); water and mud come only from the server's variants.
            var g = PlagueGround.Build(Dressed());
            Assert.AreEqual(0, g.WaterTiles, "no noise water"); Assert.AreEqual(0, g.MudTiles, "no noise mud");
            foreach (var k in g.Kind) { Assert.AreNotEqual(PlagueGround.Water, k); Assert.AreNotEqual(PlagueGround.Mud, k); }
            var px = g.Bake(2);
            for (int i = 0; i < px.Length; i++)
            {
                Assert.AreEqual(0, px[i].r, "no water coverage at texel " + i);
                if (px[i].a != 0) Assert.Greater(px[i].g, 0, "a Plague floor texel is grass, never mud (texel " + i + ")");
            }
        }

        [Test]
        public void WithoutDressingThePlagueTextureIsTodays()
        {
            // GUARD, green today: digests of today's output on Open(): the per-tile kinds and the 2-texels-per-tile bake.
            var g = PlagueGround.Build(Open());
            Assert.AreEqual(KindDigest, Fnv(g.Kind), "per-tile kind plane");
            Assert.AreEqual(TextureDigest, Fnv(Bytes(g.Bake(2))), "baked texture");
        }

        const ulong KindDigest = 6106916864936759372UL, TextureDigest = 16807053518343486509UL;

        [Test]
        public void ADressedMapStillTintsTheServersWaterAndMud()
        {
            // GUARD: ground variants 7 (water) and 8 (mud) on Plague tiles of a dressed map bake the tint GroundVariantLook gives them.
            var map = Open(); int w = map.W; var plane = new byte[w * map.H];
            plane[10 * w + 5] = 7; plane[10 * w + 6] = 8;
            map = map.WithPublic(null, null, null, OneProp, plane);
            var px = RegionGround.BakeVariants(map);
            Assert.IsTrue(Roguehalla.Net.Ui.GroundVariantLook.TryGet(3, 7, out var water)); Assert.IsTrue(Roguehalla.Net.Ui.GroundVariantLook.TryGet(3, 8, out var mud));
            Assert.AreEqual(new Color32(water.R, water.G, water.B, (byte)Mathf.RoundToInt(water.Strength * 255f)), px[10 * w + 5]);
            Assert.AreEqual(new Color32(mud.R, mud.G, mud.B, (byte)Mathf.RoundToInt(mud.Strength * 255f)), px[10 * w + 6]);
            Assert.AreEqual(0, px[11 * w + 5].a, "variant 0 is the base ground");
        }
    }
}
