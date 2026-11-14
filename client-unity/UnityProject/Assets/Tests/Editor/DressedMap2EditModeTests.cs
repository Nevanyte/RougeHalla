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
    /// (a map without dressing) keeps the art's flag. The Plague half of the brief is not pinned: see the packet's "Established facts".
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
    }
}
