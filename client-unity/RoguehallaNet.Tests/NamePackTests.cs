using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// P-UNITY-NAME-GROUP-1: a pack of same-named mobs shows one name. Presentation only (legacy draws every name, MobView.ts:108-110;
    /// DEV-024). Units here are legacy pixels (4 tiles of 32 = <see cref="NameMerge.PackDistancePx"/>); the helper is unit-agnostic.
    /// </summary>
    public sealed class NamePackTests
    {
        const float D = 128f;

        static NameMergeItem Mob(uint id, string text, float x, float y = 0f, bool elite = false, bool always = false) =>
            new NameMergeItem { Id = id, Text = text, X = x, Y = y, Width = 60f, Elite = elite, Always = always };

        // shown starts all true and scratch starts full of junk, so a body that writes nothing, or trusts stale scratch, cannot pass.
        static bool[] Run(NameMergeItem[] items, out int shownCount, float distance = D)
        {
            var shown = Enumerable.Repeat(true, items.Length).ToArray();
            var scratch = Enumerable.Repeat(-7, items.Length).ToArray();
            shownCount = NameMerge.DecidePacks(items, items.Length, distance, shown, scratch);
            Assert.That(shownCount, Is.EqualTo(shown.Count(s => s)), "the returned count is the number of true entries written");
            return shown;
        }

        [Test]
        public void ThePackDistanceIsFourTilesOfThirtyTwoPixels()
        {
            Assert.That(NameMerge.PackDistancePx, Is.EqualTo(128f), "a tuning value (about four tiles); change it here and in the packet together");
        }

        [Test]
        public void FourSameNamedMobsInARowGiveOneNameTheLowestId()
        {
            var shown = Run(new[] { Mob(9, "Magma Brute", 0f), Mob(4, "Magma Brute", 40f), Mob(6, "Magma Brute", 80f), Mob(8, "Magma Brute", 40f, 40f) }, out int n);
            Assert.That(n, Is.EqualTo(1));
            Assert.That(shown, Is.EqualTo(new[] { false, true, false, false }), "id 4 is the lowest");
        }

        [Test]
        public void TheSurvivorDoesNotDependOnTheOrderTheMobsArePassedIn()
        {
            var a = Mob(3, "Plague Rat", 0f); var b = Mob(7, "Plague Rat", 60f); var c = Mob(5, "Plague Rat", 120f);
            var s1 = Run(new[] { a, b, c }, out int n1);
            var s2 = Run(new[] { c, b, a }, out int n2);
            Assert.That(n1, Is.EqualTo(1)); Assert.That(n2, Is.EqualTo(1));
            Assert.That(s1, Is.EqualTo(new[] { true, false, false }));
            Assert.That(s2, Is.EqualTo(new[] { false, false, true }), "the same mob (id 3) is the one drawn");
        }

        [Test]
        public void AChainIsOnePackEvenWhenItsEndsAreFarApart()
        {
            // 0, 100, 200, 300: neighbours 100 apart, ends 300 apart (more than twice the pack distance).
            var shown = Run(new[] { Mob(1, "Rat", 0f), Mob(2, "Rat", 100f), Mob(3, "Rat", 200f), Mob(4, "Rat", 300f) }, out int n);
            Assert.That(n, Is.EqualTo(1));
            Assert.That(shown, Is.EqualTo(new[] { true, false, false, false }));
        }

        [Test]
        public void AChainWhoseLowestIdIsInTheMiddleStillKeepsThatOne()
        {
            var shown = Run(new[] { Mob(8, "Rat", 0f), Mob(2, "Rat", 100f), Mob(9, "Rat", 200f) }, out int n);
            Assert.That(n, Is.EqualTo(1));
            Assert.That(shown, Is.EqualTo(new[] { false, true, false }));
        }

        [Test]
        public void TwoPacksOfOneNameFartherApartThanThePackDistanceShowTwoNames()
        {
            var shown = Run(new[] { Mob(1, "Rat", 0f), Mob(2, "Rat", 50f), Mob(3, "Rat", 50f + D + 1f), Mob(4, "Rat", 100f + D + 1f) }, out int n);
            Assert.That(n, Is.EqualTo(2));
            Assert.That(shown, Is.EqualTo(new[] { true, false, true, false }), "the lowest id of each pack");
        }

        [Test]
        public void TheDistanceIsEuclideanAndStrictlyLessThanThePackDistance()
        {
            var near = Run(new[] { Mob(1, "Rat", 0f), Mob(2, "Rat", 0f, D - 1f) }, out int nNear);
            Assert.That(nNear, Is.EqualTo(1)); Assert.That(near, Is.EqualTo(new[] { true, false }));
            Run(new[] { Mob(1, "Rat", 0f), Mob(2, "Rat", 0f, D + 1f) }, out int nFar);
            Assert.That(nFar, Is.EqualTo(2));
            // 90 and 90 apart on each axis is about 127.3 apart: inside. 95 and 95 is about 134.4: outside (a Manhattan or box test would join them).
            Run(new[] { Mob(1, "Rat", 0f), Mob(2, "Rat", 90f, 90f) }, out int nIn);
            Assert.That(nIn, Is.EqualTo(1));
            Run(new[] { Mob(1, "Rat", 0f), Mob(2, "Rat", 95f, 95f) }, out int nOut);
            Assert.That(nOut, Is.EqualTo(2));
        }

        [Test]
        public void ThePackDistanceIsTheCallersArgumentNotAConstantInsideTheHelper()
        {
            // The same idea in world units (a tile is 1): 4 units is the pack distance there.
            var shown = Run(new[] { Mob(1, "Rat", 0f), Mob(2, "Rat", 3f), Mob(3, "Rat", 20f) }, out int n, distance: 4f);
            Assert.That(n, Is.EqualTo(2));
            Assert.That(shown, Is.EqualTo(new[] { true, false, true }));
        }

        [Test]
        public void DifferentNamesNeverMergeEvenOnTheSameSpot()
        {
            var shown = Run(new[] { Mob(1, "Magma Brute", 0f), Mob(2, "Plague Rat", 0f), Mob(3, "Magma Brute", 10f), Mob(4, "Plague Rat", 10f) }, out int n);
            Assert.That(n, Is.EqualTo(2));
            Assert.That(shown, Is.EqualTo(new[] { true, true, false, false }), "one name per kind");
        }

        [Test]
        public void AnotherNameBetweenTwoMobsDoesNotBreakTheirPack()
        {
            var shown = Run(new[] { Mob(1, "Rat", 0f), Mob(2, "Witch", 60f), Mob(3, "Rat", 100f) }, out int n);
            Assert.That(n, Is.EqualTo(2));
            Assert.That(shown, Is.EqualTo(new[] { true, true, false }));
        }

        [Test]
        public void AnEliteAlwaysShowsItsOwnNameAndDoesNotSuppressThePacks()
        {
            // Same text on purpose (the strictest case): the elite is shown, the pack still shows its own lowest id, and the elite's low id does not win it.
            var shown = Run(new[] { Mob(1, "Brute", 0f, elite: true), Mob(2, "Brute", 40f), Mob(3, "Brute", 80f) }, out int n);
            Assert.That(n, Is.EqualTo(2));
            Assert.That(shown, Is.EqualTo(new[] { true, true, false }));
        }

        [Test]
        public void AnEliteDoesNotLinkTwoMobsThatAreFarApart()
        {
            var shown = Run(new[] { Mob(2, "Brute", 0f), Mob(1, "Brute", 100f, elite: true), Mob(3, "Brute", 200f) }, out int n);
            Assert.That(n, Is.EqualTo(3), "the two non-elites are 200 apart and the elite between them is not part of the chain");
            Assert.That(shown, Is.EqualTo(new[] { true, true, true }));
        }

        [Test]
        public void AMobMarkedAlwaysShowsItsOwnNameAndLeavesThePack()
        {
            // The locked or engaged mob has the HIGHEST id: it would be hidden by the plain rule. The pack of the others keeps its own survivor.
            var shown = Run(new[] { Mob(1, "Rat", 0f), Mob(2, "Rat", 40f), Mob(9, "Rat", 80f, always: true) }, out int n);
            Assert.That(n, Is.EqualTo(2));
            Assert.That(shown, Is.EqualTo(new[] { true, false, true }));
        }

        [Test]
        public void AnAlwaysMobWithTheLowestIdDoesNotTakeThePacksNameFromIt()
        {
            var shown = Run(new[] { Mob(1, "Rat", 0f, always: true), Mob(2, "Rat", 40f), Mob(3, "Rat", 80f) }, out int n);
            Assert.That(n, Is.EqualTo(2));
            Assert.That(shown, Is.EqualTo(new[] { true, true, false }));
        }

        [Test]
        public void AnAlwaysMobDoesNotLinkTwoMobsThatAreFarApart()
        {
            var shown = Run(new[] { Mob(1, "Rat", 0f), Mob(5, "Rat", 100f, always: true), Mob(2, "Rat", 200f) }, out int n);
            Assert.That(n, Is.EqualTo(3));
            Assert.That(shown, Is.EqualTo(new[] { true, true, true }));
        }

        [Test]
        public void AMobThatLeavesItsPackGetsItsNameBack()
        {
            var items = new[] { Mob(1, "Rat", 0f), Mob(2, "Rat", 60f), Mob(3, "Rat", 120f) };
            Run(items, out int together);
            Assert.That(together, Is.EqualTo(1));
            items[2].X = 120f + 400f;   // id 3 walks off
            var shown = Run(items, out int after);
            Assert.That(after, Is.EqualTo(2));
            Assert.That(shown, Is.EqualTo(new[] { true, false, true }));
        }

        [Test]
        public void ABrokenChainSplitsIntoPacksWithTheirOwnLowestIds()
        {
            var items = new[] { Mob(1, "Rat", 0f), Mob(5, "Rat", 100f), Mob(3, "Rat", 200f) };
            Run(items, out int joined);
            Assert.That(joined, Is.EqualTo(1));
            items[1].X = 1000f;   // the middle mob leaves: the ends are 200 apart
            var shown = Run(items, out int split);
            Assert.That(split, Is.EqualTo(3));
            Assert.That(shown, Is.EqualTo(new[] { true, true, true }));
        }

        [Test]
        public void EmptyOrNullTextIsShownAndDoesNotPack()
        {
            var shown = Run(new[] { Mob(1, null, 0f), Mob(2, null, 10f), Mob(3, "", 0f), Mob(4, "", 10f) }, out int n);
            Assert.That(n, Is.EqualTo(4));
            Assert.That(shown, Is.EqualTo(new[] { true, true, true, true }));
        }

        [Test]
        public void OnlyTheFirstCountItemsAreUsedAndTheBuffersMayBeLonger()
        {
            var items = new[] { Mob(1, "Rat", 0f), Mob(2, "Rat", 10f), Mob(3, "Rat", 20f) };
            var shown = new[] { true, true, true, true }; var scratch = new int[8];
            int n = NameMerge.DecidePacks(items, 2, D, shown, scratch);
            Assert.That(n, Is.EqualTo(1));
            Assert.That(shown.Take(2), Is.EqualTo(new[] { true, false }));
            Assert.That(shown[2], Is.True, "untouched past count");
            Assert.That(NameMerge.DecidePacks(items, 0, D, shown, scratch), Is.EqualTo(0));
        }

        [Test]
        public void ARepeatedCallGivesTheSameAnswerWhateverTheScratchHeld()
        {
            var items = new[] { Mob(4, "Rat", 0f), Mob(2, "Rat", 60f), Mob(7, "Rat", 400f), Mob(5, "Rat", 440f), Mob(1, "Witch", 0f) };
            var first = new bool[5]; var second = new bool[5]; var scratch = new int[5];
            int a = NameMerge.DecidePacks(items, 5, D, first, scratch);
            for (int i = 0; i < 5; i++) scratch[i] = 99 - i;
            int b = NameMerge.DecidePacks(items, 5, D, second, scratch);
            Assert.That(a, Is.EqualTo(3)); Assert.That(b, Is.EqualTo(3));
            Assert.That(first, Is.EqualTo(new[] { false, true, false, true, true }));
            Assert.That(second, Is.EqualTo(first));
        }

        [Test]
        public void ManyMobsInOneChainStillGiveOneNameAndTheLowestId()
        {
            // 200 mobs in a line, 100 apart, ids descending along it.
            var items = Enumerable.Range(0, 200).Select(i => Mob((uint)(1000 - i), "Rat", i * 100f)).ToArray();
            var shown = Run(items, out int n);
            Assert.That(n, Is.EqualTo(1));
            Assert.That(shown[199], Is.True, "id 801 is the lowest and sits at the far end");
        }

        [Test]
        public void TheOverlapRuleStaysTheInnerCaseOfThePackRule()
        {
            // Whatever Decide hides for a same-named close pair, DecidePacks hides too (the overlap distance is the narrower, so inside the pack distance).
            var items = new[] { Mob(7, "Plague Rat", 100f), Mob(3, "Plague Rat", 130f) };
            var overlap = Enumerable.Repeat(true, 2).ToArray();
            NameMerge.Decide(items, 2, overlap);
            var pack = Run(items, out _);
            Assert.That(pack, Is.EqualTo(overlap));
        }

        [Test]
        public void TheNameIsNeverBelowItsOwnHpBarForAnyActorKind()
        {
            // Layout truth for "names over hp bars": one actor's name sits a full 10 px above the top of its own bar, so the third screenshot's
            // overlaps are another mob's name over a neighbour's bar (see the packet). Pinned so a layout change cannot make it real.
            foreach (var kind in new[] { OverheadActorKind.Mob, OverheadActorKind.Elite, OverheadActorKind.Dummy, OverheadActorKind.Player })
            {
                var stack = new List<OverheadElement>();
                OverheadStack.Build(new OverheadFacts { Kind = kind, HpPct = 50f, Name = "Magma Brute", NameWidthPx = 60f }, stack);
                var bar = stack.Single(e => e.Kind == OverheadKind.HpBack); var name = stack.Single(e => e.Kind == OverheadKind.Name);
                Assert.That(name.Y, Is.GreaterThanOrEqualTo(bar.Y + bar.H + 10f - .001f), kind + ": name bottom against bar top, in legacy px");
            }
        }
    }
}
