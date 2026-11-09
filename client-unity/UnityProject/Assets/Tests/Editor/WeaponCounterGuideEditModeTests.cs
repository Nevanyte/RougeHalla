using System.Linq;
using NUnit.Framework;
using UnityEngine;
using Roguehalla.Client;

namespace Roguehalla.Client.Tests
{
    public sealed class WeaponCounterGuideEditModeTests
    {
        [Test]
        public void FiveWeaponWheelHasTenDirectionalEdgesAndNoFistsNode()
        {
            CollectionAssert.AreEqual(new[] { "sword", "axe", "wand", "shield", "bow" }, WeaponCounterGuide.RingOrder);
            Assert.AreEqual(10, WeaponCounterGuide.Edges.Count);
            Assert.IsFalse(WeaponCounterGuide.IsWheelWeapon("fists"));
            Assert.IsFalse(WeaponCounterGuide.IsWheelWeapon(""));

            WeaponCounterGuide.Matchups("sword", out var swordWins, out var swordLosses);
            CollectionAssert.AreEquivalent(new[] { "axe", "wand" }, swordWins);
            CollectionAssert.AreEquivalent(new[] { "bow", "shield" }, swordLosses);
            Assert.IsTrue(WeaponCounterGuide.Edges.Any(e => e.Winner == "sword" && e.Loser == "axe" && !e.Diagonal));
            Assert.IsTrue(WeaponCounterGuide.Edges.Any(e => e.Winner == "sword" && e.Loser == "wand" && e.Diagonal));
            Assert.IsFalse(WeaponCounterGuide.Edges.Any(e => e.Winner == "fists" || e.Loser == "fists"));
        }

        [Test]
        public void HighlightsUseTextAndSymbolsAlongsideColorAndFistsStayOutsideTheLoop()
        {
            StringAssert.Contains("ACTIVE  Sword", WeaponCounterGuide.Describe("sword"));
            StringAssert.Contains("+ ADVANTAGE", WeaponCounterGuide.Describe("sword"));
            StringAssert.Contains("! WATCH FOR", WeaponCounterGuide.Describe("sword"));
            StringAssert.Contains("outside the five-weapon counter loop", WeaponCounterGuide.Describe("fists"));
            WeaponCounterGuide.Matchups("fists", out var beats, out var losesTo);
            Assert.IsEmpty(beats);
            Assert.IsEmpty(losesTo);
        }

        [Test]
        public void WheelExposesRailLayoutAndReleasesItsGeneratedTexture()
        {
            var host = new GameObject("WheelHost", typeof(RectTransform));
            var guide = new WeaponCounterGuide(host.transform, "bow");
            var texture = guide.Texture;
            Assert.IsNotNull(guide.WheelRoot);
            Assert.IsNotNull(guide.LegendRoot);
            guide.SetLayout(new Vector2(0, .28f), Vector2.one, Vector2.zero, new Vector2(1, .25f));
            Assert.AreEqual(.28f, guide.WheelRoot.anchorMin.y);
            Assert.AreEqual(.25f, guide.LegendRoot.anchorMax.y);
            Assert.AreEqual(new Vector2(0, .28f), guide.WheelRoot.anchorMin);
            Assert.AreEqual(Vector2.one, guide.WheelRoot.anchorMax);

            guide.Destroy();
            Assert.IsTrue(texture == null, "The generated runtime texture must be destroyed immediately in EditMode.");
            Object.DestroyImmediate(host);
        }
    }
}
