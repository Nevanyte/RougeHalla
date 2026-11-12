using System;
using System.Linq;
using NUnit.Framework;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>P-UNITY-HUD-VISUAL-FIX-2: which mob names are drawn when a camp stands together. Presentation only (legacy draws
    /// every name, MobView.ts:108-110); the survivor of a pack is the lowest actor id so the label never flickers between mobs.</summary>
    public sealed class NameMergeTests
    {
        const float W = 60f;

        static NameMergeItem Mob(uint id, string text, float x, float y = 0f, bool elite = false, float width = W) =>
            new NameMergeItem { Id = id, Text = text, X = x, Y = y, Width = width, Elite = elite };

        // The buffer starts all true so a body that writes nothing cannot pass a "hidden" check; the returned count guards the "shown" side.
        static bool[] Run(NameMergeItem[] items, out int shownCount)
        {
            var shown = Enumerable.Repeat(true, items.Length).ToArray();
            shownCount = NameMerge.Decide(items, items.Length, shown);
            return shown;
        }

        [Test]
        public void TwoSameNamedMobsCloserThanTheTextIsWideGiveOneNameTheLowerId()
        {
            var shown = Run(new[] { Mob(7, "Miasma Witch", 100f), Mob(3, "Miasma Witch", 130f) }, out int n);
            Assert.That(n, Is.EqualTo(1));
            Assert.That(shown, Is.EqualTo(new[] { false, true }), "id 3 survives wherever it sits in the input");
        }

        [Test]
        public void TheSurvivorDoesNotDependOnTheOrderTheMobsArePassedIn()
        {
            var a = Mob(3, "Plague Rat", 0f); var b = Mob(7, "Plague Rat", 20f); var c = Mob(5, "Plague Rat", 40f);
            var s1 = Run(new[] { a, b, c }, out int n1);
            var s2 = Run(new[] { c, b, a }, out int n2);
            Assert.That(n1, Is.EqualTo(1)); Assert.That(n2, Is.EqualTo(1));
            Assert.That(s1, Is.EqualTo(new[] { true, false, false }));
            Assert.That(s2, Is.EqualTo(new[] { false, false, true }), "the same mob (id 3) is the one drawn");
        }

        [Test]
        public void DifferentNamesBothShowEvenOnTheSameSpot()
        {
            var shown = Run(new[] { Mob(1, "Miasma Witch", 100f), Mob(2, "Plague Rat", 100f) }, out int n);
            Assert.That(n, Is.EqualTo(2));
            Assert.That(shown, Is.EqualTo(new[] { true, true }));
        }

        [Test]
        public void AFarPairOfTheSameNameBothShow()
        {
            var shown = Run(new[] { Mob(1, "Plague Rat", 0f), Mob(2, "Plague Rat", W + 1f) }, out int n);
            Assert.That(n, Is.EqualTo(2));
            Assert.That(shown, Is.EqualTo(new[] { true, true }));
        }

        [Test]
        public void ADistanceEqualToTheTextWidthIsNotCloserSoBothShow()
        {
            var shown = Run(new[] { Mob(1, "Plague Rat", 0f), Mob(2, "Plague Rat", W) }, out int n);
            Assert.That(n, Is.EqualTo(2));
            Assert.That(shown, Is.EqualTo(new[] { true, true }));
        }

        [Test]
        public void DistanceIsEuclideanAcrossBothAxes()
        {
            // 40 across and 40 down is 56.6 apart, under 60: one name. 50 and 50 is 70.7: two.
            var near = Run(new[] { Mob(1, "Grunt", 0f, 0f), Mob(2, "Grunt", 40f, 40f) }, out int nNear);
            var far = Run(new[] { Mob(1, "Grunt", 0f, 0f), Mob(2, "Grunt", 50f, 50f) }, out int nFar);
            Assert.That(nNear, Is.EqualTo(1)); Assert.That(near, Is.EqualTo(new[] { true, false }));
            Assert.That(nFar, Is.EqualTo(2)); Assert.That(far, Is.EqualTo(new[] { true, true }));
        }

        [Test]
        public void TheNarrowerOfTheTwoWidthsDecides()
        {
            var shown = Run(new[] { Mob(1, "Rat", 0f, width: 80f), Mob(2, "Rat", 50f, width: 40f) }, out int n);
            Assert.That(n, Is.EqualTo(2), "50 apart is not closer than the narrower text (40)");
            Assert.That(shown, Is.EqualTo(new[] { true, true }));
        }

        [Test]
        public void AnElitesNameAlwaysShowsAndNeverHidesAnother()
        {
            var shown = Run(new[]
            {
                Mob(9, "Bone Warden", 100f, elite: true), Mob(2, "Bone Warden", 110f, elite: true),
                Mob(1, "Bone Warden", 105f), Mob(4, "Bone Warden", 108f),
            }, out int n);
            Assert.That(shown[0], Is.True, "an elite with a lower-id mob on top of it still shows");
            Assert.That(shown[1], Is.True, "two elites of one name both show");
            Assert.That(shown[2], Is.True, "an elite does not hide a plain mob; plain mobs merge among themselves");
            Assert.That(shown[3], Is.False, "id 4 merges into id 1");
            Assert.That(n, Is.EqualTo(3));
        }

        [Test]
        public void AChainShowsTheEndThatIsFarFromTheSurvivor()
        {
            // 1 at 0, 2 at 50 (near 1, hidden), 3 at 100 (near 2 only). Id 2 is hidden, so it cannot hide 3.
            var shown = Run(new[] { Mob(1, "Rat", 0f), Mob(2, "Rat", 50f), Mob(3, "Rat", 100f) }, out int n);
            Assert.That(shown, Is.EqualTo(new[] { true, false, true }));
            Assert.That(n, Is.EqualTo(2));
        }

        [Test]
        public void AnEmptyOrMissingTextIsLeftShownAndNeverMergedWithAnother()
        {
            var shown = Run(new[] { Mob(1, null, 0f), Mob(2, null, 5f), Mob(3, "", 0f), Mob(4, "", 5f) }, out int n);
            Assert.That(n, Is.EqualTo(4));
            Assert.That(shown, Is.EqualTo(new[] { true, true, true, true }));
        }

        [Test]
        public void OnlyTheFirstCountItemsAreDecidedAndTheRestOfTheBufferIsUntouched()
        {
            var items = new[] { Mob(1, "Rat", 0f), Mob(2, "Rat", 10f), Mob(3, "Rat", 20f) };
            var shown = new[] { true, true, true };
            int n = NameMerge.Decide(items, 2, shown);
            Assert.That(n, Is.EqualTo(1));
            Assert.That(shown, Is.EqualTo(new[] { true, false, true }));
            Assert.That(NameMerge.Decide(items, 0, shown), Is.EqualTo(0));
        }

        [Test]
        public void ThePackOfFiveReadsAsOneNameAndTheResultIsTheSameEveryCall()
        {
            var items = Enumerable.Range(0, 5).Select(i => Mob((uint)(10 + i), "Miasma Witch", i * 12f)).ToArray();
            var first = Run(items, out int n1); var second = Run(items, out int n2);
            Assert.That(n1, Is.EqualTo(1)); Assert.That(n2, Is.EqualTo(1));
            Assert.That(first, Is.EqualTo(new[] { true, false, false, false, false }));
            Assert.That(second, Is.EqualTo(first));
        }

        [Test]
        public void DecidingAllocatesNothing()
        {
            var items = Enumerable.Range(0, 40).Select(i => Mob((uint)(100 - i), i % 3 == 0 ? "Rat" : "Witch", i * 9f, i % 2 * 7f, i % 11 == 0)).ToArray();
            var shown = new bool[items.Length];
            NameMerge.Decide(items, items.Length, shown);   // warm up
            long before = GC.GetAllocatedBytesForCurrentThread();
            int n = 0;
            for (int k = 0; k < 50; k++) n += NameMerge.Decide(items, items.Length, shown);
            long after = GC.GetAllocatedBytesForCurrentThread();
            Assert.That(after - before, Is.EqualTo(0L));
            Assert.That(n, Is.GreaterThan(0), "it decided something");
        }
    }
}
