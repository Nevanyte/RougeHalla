using System.Linq;
using NUnit.Framework;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// P-UNITY-NAME-GROUP-2: a pack shows exactly one name at all times (engaged does not split it), anchored over the pack unless a member is
    /// singled out (hover wins over lock), and fighter names that overlap are stacked. Presentation only (DEV-024). Units are Unity world units, Y up.
    /// </summary>
    public sealed class NamePackGroup2Tests
    {
        const float D = 4f;

        static NameMergeItem Mob(uint id, float x, float y, byte single = 0, bool always = false, bool elite = false, string text = "Brute") =>
            new NameMergeItem { Id = id, Text = text, X = x, Y = y, Width = 1.5f, Elite = elite, Always = always, Single = single };

        // shown starts true with junk anchors and scratch full of junk: a body that writes nothing, or trusts stale data, cannot pass.
        static void Run(NameMergeItem[] items, out bool[] shown, out float[] ax, out float[] ay)
        {
            shown = Enumerable.Repeat(true, items.Length).ToArray();
            ax = Enumerable.Repeat(-999f, items.Length).ToArray(); ay = Enumerable.Repeat(-999f, items.Length).ToArray();
            var scratch = Enumerable.Repeat(-7, items.Length).ToArray();
            int n = NameMerge.PackNames(items, items.Length, D, shown, scratch, ax, ay);
            Assert.That(n, Is.EqualTo(shown.Count(s => s)), "the returned count is the number of true entries written");
        }

        // A staggered line of four, ids not in position order: x 0, 3, 6, 9 (ends 9 apart: one chained pack), y 0, 1, 0, 1.
        static NameMergeItem[] Pack() => new[] { Mob(4, 0f, 0f), Mob(2, 3f, 1f), Mob(3, 6f, 0f), Mob(1, 9f, 1f) };

        static int IndexOf(NameMergeItem[] items, uint id) => System.Array.FindIndex(items, i => i.Id == id);

        [Test]
        public void AnUnsingledPackShowsExactlyOneNameTheLowestId()
        {
            var items = Pack(); Run(items, out var shown, out _, out _);
            Assert.That(shown.Count(s => s), Is.EqualTo(1));
            Assert.That(shown[IndexOf(items, 1)], Is.True);
        }

        [Test]
        public void AnEngagedMemberDoesNotSplitThePack()
        {
            var items = Pack(); items[0].Always = true; items[2].Always = true;   // ids 4 and 3 are engaged
            Run(items, out var shown, out _, out _);
            Assert.That(shown.Count(s => s), Is.EqualTo(1), "Always is ignored by PackNames");
            Assert.That(shown[IndexOf(items, 1)], Is.True);
        }

        [Test]
        public void AnEngagedMiddleMemberStillChainsItsNeighbours()
        {
            // x 0, 3.5, 7: the ends are 7 apart, linked only through the middle one, which is engaged. One pack.
            var items = new[] { Mob(1, 0f, 0f), Mob(2, 3.5f, 0f, always: true), Mob(3, 7f, 0f) };
            Run(items, out var shown, out _, out _);
            Assert.That(shown.Count(s => s), Is.EqualTo(1));
        }

        [Test]
        public void TheAnchorOfAnUnsingledPackIsTheCentreOfItsExtentAndItsHighestMembersY()
        {
            var items = Pack(); Run(items, out var shown, out var ax, out var ay);
            int k = System.Array.IndexOf(shown, true);
            Assert.That(ax[k], Is.EqualTo(4.5f).Within(1e-4f), "(0 + 9) / 2");
            Assert.That(ay[k], Is.EqualTo(1f).Within(1e-4f), "the highest member");
        }

        [Test]
        public void TheCentreIsTheMiddleOfTheExtentNotTheMeanOfTheMembers()
        {
            // x 0, 1, 2, 3.5 (chained, gaps under 4); mean is 1.625, the middle of the extent is 1.75.
            var items = new[] { Mob(1, 0f, 0f), Mob(2, 1f, 0f), Mob(3, 2f, 0f), Mob(4, 3.5f, 0f) };
            Run(items, out var shown, out var ax, out _);
            Assert.That(ax[System.Array.IndexOf(shown, true)], Is.EqualTo(1.75f).Within(1e-4f));
        }

        [Test]
        public void TheAnchorDoesNotDependOnTheOrderTheMobsArePassedIn()
        {
            var a = Pack(); Run(a, out var sa, out var xa, out var ya);
            var b = Pack().Reverse().ToArray(); Run(b, out var sb, out var xb, out var yb);
            int ka = System.Array.IndexOf(sa, true), kb = System.Array.IndexOf(sb, true);
            Assert.That(a[ka].Id, Is.EqualTo(b[kb].Id));
            Assert.That(xb[kb], Is.EqualTo(xa[ka]).Within(1e-5f)); Assert.That(yb[kb], Is.EqualTo(ya[ka]).Within(1e-5f));
        }

        [Test]
        public void AHoveredMemberCarriesTheNameAtItsOwnAnchor()
        {
            var items = Pack(); items[IndexOf(items, 3)].Single = 2;
            Run(items, out var shown, out var ax, out var ay);
            Assert.That(shown.Count(s => s), Is.EqualTo(1));
            int k = IndexOf(items, 3);
            Assert.That(shown[k], Is.True);
            Assert.That(ax[k], Is.EqualTo(6f).Within(1e-4f)); Assert.That(ay[k], Is.EqualTo(0f).Within(1e-4f));
        }

        [Test]
        public void ALockedMemberCarriesTheNameAtItsOwnAnchor()
        {
            var items = Pack(); items[IndexOf(items, 4)].Single = 1;   // the highest id, the lowest position
            Run(items, out var shown, out var ax, out var ay);
            Assert.That(shown.Count(s => s), Is.EqualTo(1));
            int k = IndexOf(items, 4);
            Assert.That(shown[k], Is.True);
            Assert.That(ax[k], Is.EqualTo(0f).Within(1e-4f)); Assert.That(ay[k], Is.EqualTo(0f).Within(1e-4f));
        }

        [Test]
        public void HoverWinsOverLockWhenBothArePresent()
        {
            var items = Pack(); items[IndexOf(items, 4)].Single = 1; items[IndexOf(items, 3)].Single = 2;
            Run(items, out var shown, out _, out _);
            Assert.That(shown.Count(s => s), Is.EqualTo(1));
            Assert.That(shown[IndexOf(items, 3)], Is.True, "hovered");
        }

        [Test]
        public void AnEngagedAndHoveredMemberStillCarriesTheNameAlone()
        {
            var items = Pack(); foreach (var i in new[] { 0, 1, 2, 3 }) items[i].Always = true; items[IndexOf(items, 2)].Single = 2;
            Run(items, out var shown, out _, out _);
            Assert.That(shown.Count(s => s), Is.EqualTo(1)); Assert.That(shown[IndexOf(items, 2)], Is.True);
        }

        [Test]
        public void WhenTheHoverLeavesTheNameGoesBackToThePackCentre()
        {
            var items = Pack(); items[IndexOf(items, 3)].Single = 2; Run(items, out _, out _, out _);
            items[IndexOf(items, 3)].Single = 0; Run(items, out var shown, out var ax, out _);
            Assert.That(shown[IndexOf(items, 1)], Is.True); Assert.That(ax[IndexOf(items, 1)], Is.EqualTo(4.5f).Within(1e-4f));
        }

        [Test]
        public void ASingledMemberOfOnePackDoesNotChangeAnotherPack()
        {
            var items = Pack().Concat(new[] { Mob(11, 100f, 5f), Mob(12, 102f, 7f), Mob(13, 104f, 6f, single: 0) }).ToArray();
            items[IndexOf(items, 3)].Single = 2;
            Run(items, out var shown, out var ax, out var ay);
            Assert.That(shown.Count(s => s), Is.EqualTo(2), "one name per pack");
            int k = IndexOf(items, 11);
            Assert.That(shown[k], Is.True); Assert.That(ax[k], Is.EqualTo(102f).Within(1e-4f)); Assert.That(ay[k], Is.EqualTo(7f).Within(1e-4f));
        }

        [Test]
        public void AnEliteKeepsItsOwnNameAtItsOwnAnchorAndDoesNotJoinThePack()
        {
            var items = Pack().Concat(new[] { Mob(9, 4f, 3f, elite: true) }).ToArray();
            Run(items, out var shown, out var ax, out var ay);
            int e = IndexOf(items, 9);
            Assert.That(shown[e], Is.True); Assert.That(ax[e], Is.EqualTo(4f)); Assert.That(ay[e], Is.EqualTo(3f));
            Assert.That(shown.Count(s => s), Is.EqualTo(2));
            int k = IndexOf(items, 1);
            Assert.That(ay[k], Is.EqualTo(1f).Within(1e-4f), "the elite's higher y does not lift the pack's name");
        }

        [Test]
        public void DifferentNamesNeverMergeEvenOnTheSameSpot()
        {
            var items = new[] { Mob(1, 0f, 0f), Mob(2, 0f, 0f, text: "Rat"), Mob(3, 0.5f, 0f) };
            Run(items, out var shown, out _, out _);
            Assert.That(shown[1], Is.True); Assert.That(shown[0], Is.True); Assert.That(shown[2], Is.False);
        }

        [Test]
        public void TwoFarPacksOfOneNameEachShowOneNameOverThemselves()
        {
            var items = new[] { Mob(1, 0f, 0f), Mob(2, 2f, 1f), Mob(3, 50f, 0f), Mob(4, 52f, 2f) };
            Run(items, out var shown, out var ax, out var ay);
            Assert.That(shown, Is.EqualTo(new[] { true, false, true, false }));
            Assert.That(ax[0], Is.EqualTo(1f).Within(1e-4f)); Assert.That(ay[0], Is.EqualTo(1f).Within(1e-4f));
            Assert.That(ax[2], Is.EqualTo(51f).Within(1e-4f)); Assert.That(ay[2], Is.EqualTo(2f).Within(1e-4f));
        }

        [Test]
        public void ALoneMobShowsItsNameAtItsOwnAnchor()
        {
            var items = new[] { Mob(1, 7f, 3f) };
            Run(items, out var shown, out var ax, out var ay);
            Assert.That(shown[0], Is.True); Assert.That(ax[0], Is.EqualTo(7f)); Assert.That(ay[0], Is.EqualTo(3f));
        }

        // ---- NameStack.Separate ----

        static NameStackItem L(uint id, float x, float y, float dist, float w = 2f, float h = 0.5f) =>
            new NameStackItem { Id = id, X = x, Y = y, W = w, H = h, Dist = dist };

        static float[] Lift(NameStackItem[] items, float gap = 0.1f)
        {
            var lift = Enumerable.Repeat(-5f, items.Length).ToArray();
            NameStack.Separate(items, items.Length, gap, lift);
            return lift;
        }

        static bool Overlap(NameStackItem a, float la, NameStackItem b, float lb) =>
            System.Math.Abs(a.X - b.X) < (a.W + b.W) / 2f && a.Y + la < b.Y + lb + b.H && b.Y + lb < a.Y + la + a.H;

        [Test]
        public void LabelsThatDoNotOverlapAreNotMoved()
        {
            var lift = Lift(new[] { L(1, 0f, 0f, 0f), L(2, 5f, 0f, 1f), L(3, 0f, 3f, 2f) });
            Assert.That(lift, Is.EqualTo(new[] { 0f, 0f, 0f }));
        }

        [Test]
        public void TouchingLabelsAreNotOverlappingAndStay()
        {
            var lift = Lift(new[] { L(1, 0f, 0f, 0f), L(2, 0f, 0.5f, 1f) });   // 2 sits exactly on the top edge of 1
            Assert.That(lift, Is.EqualTo(new[] { 0f, 0f }));
        }

        [Test]
        public void TheNearerLabelStaysAndTheFartherOneIsLiftedAboveItWithTheGap()
        {
            var lift = Lift(new[] { L(1, 0f, 0f, 3f), L(2, 0.5f, 0.1f, 1f) });   // 2 is nearer: it stays; 1 goes above it
            Assert.That(lift[1], Is.EqualTo(0f));
            Assert.That(lift[0], Is.EqualTo(0.1f + 0.5f + 0.1f - 0f).Within(1e-5f), "1 rises to 2's top (0.6) plus the gap (0.1)");
        }

        [Test]
        public void FourLabelsOnTheSameSpotStackInOrderOfDistanceNearestLowest()
        {
            var items = new[] { L(1, 0f, 0f, 0f), L(2, 0f, 0f, 1f), L(3, 0f, 0f, 2f), L(4, 0f, 0f, 3f) };
            var lift = Lift(items);
            for (int i = 0; i < 4; i++) for (int j = i + 1; j < 4; j++) Assert.That(Overlap(items[i], lift[i], items[j], lift[j]), Is.False, i + " vs " + j);
            Assert.That(lift[0], Is.EqualTo(0f));
            Assert.That(lift[1], Is.EqualTo(0.6f).Within(1e-5f)); Assert.That(lift[2], Is.EqualTo(1.2f).Within(1e-5f)); Assert.That(lift[3], Is.EqualTo(1.8f).Within(1e-5f));
        }

        [Test]
        public void ALabelBesideTheStackIsNotLifted()
        {
            var items = new[] { L(1, 0f, 0f, 0f), L(2, 0f, 0f, 1f), L(3, 10f, 0f, 2f) };
            Assert.That(Lift(items)[2], Is.EqualTo(0f));
        }

        [Test]
        public void PartlyOverlappingHorizontallyStillStacks()
        {
            var items = new[] { L(1, 0f, 0f, 0f), L(2, 1.9f, 0f, 1f) };   // x ranges (-1,1) and (0.9,2.9)
            var lift = Lift(items);
            Assert.That(lift[1], Is.EqualTo(0.6f).Within(1e-5f));
        }

        [Test]
        public void ALiftedLabelIsAlsoSeparatedFromAnotherThatSitsAboveIt()
        {
            // 1 and 2 collide at the bottom; lifting 2 by 0.6 would land it on 3 (nearer than 2), so it goes above 3 too.
            var items = new[] { L(1, 0f, 0f, 0f), L(3, 0f, 0.7f, 0.5f), L(2, 0f, 0.1f, 1f) };
            var lift = Lift(items);
            for (int i = 0; i < 3; i++) for (int j = i + 1; j < 3; j++) Assert.That(Overlap(items[i], lift[i], items[j], lift[j]), Is.False, i + " vs " + j);
            Assert.That(lift[0], Is.EqualTo(0f)); Assert.That(lift[1], Is.EqualTo(0f));
            Assert.That(lift[2], Is.EqualTo(0.7f + 0.5f + 0.1f - 0.1f).Within(1e-5f), "above 3's top (1.2) plus the gap, from its own 0.1");
        }

        [Test]
        public void TheResultDoesNotDependOnTheOrderOfTheItemsAndTiesBreakById()
        {
            var a = new[] { L(5, 0f, 0f, 1f), L(2, 0f, 0f, 1f), L(9, 0f, 0f, 1f) };   // equal distance: ids 2, 5, 9 bottom to top
            var la = Lift(a);
            var b = a.Reverse().ToArray(); var lb = Lift(b);
            foreach (var it in a) Assert.That(lb[System.Array.FindIndex(b, x => x.Id == it.Id)], Is.EqualTo(la[System.Array.FindIndex(a, x => x.Id == it.Id)]).Within(1e-6f), "id " + it.Id);
            Assert.That(la[1], Is.EqualTo(0f)); Assert.That(la[0], Is.EqualTo(0.6f).Within(1e-5f)); Assert.That(la[2], Is.EqualTo(1.2f).Within(1e-5f));
        }

        [Test]
        public void OnlyTheFirstCountItemsAreUsed()
        {
            var items = new[] { L(1, 0f, 0f, 0f), L(2, 0f, 0f, 1f), L(3, 0f, 0f, 2f) };
            var lift = new[] { -5f, -5f, -5f };
            NameStack.Separate(items, 2, 0.1f, lift);
            Assert.That(lift[0], Is.EqualTo(0f)); Assert.That(lift[1], Is.EqualTo(0.6f).Within(1e-5f)); Assert.That(lift[2], Is.EqualTo(-5f), "past count: untouched");
        }
    }
}
