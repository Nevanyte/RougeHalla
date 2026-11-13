using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// P-UNITY-HUD-VISUAL-FIX-4, item 2: a camp's mobs of one name are ONE pack however far they spread (kiting archers), two camps of the
    /// same mob never merge, and a mob with no known camp keeps the distance chain. The wire's actor row carries no camp index, so
    /// <see cref="NameMerge.CampOfMob"/> infers it from the delivered camp rows. Units: legacy pixels for CampOfMob, any one unit for PackNames.
    /// </summary>
    public sealed class NamePackFix4Tests
    {
        const float D = 4f;

        static NameMergeItem Mob(uint id, float x, float y, int camp, string text = "Brute", bool elite = false, byte single = 0) =>
            new NameMergeItem { Id = id, Text = text, X = x, Y = y, Width = 1.5f, Elite = elite, Single = single, Camp = camp };

        static void Run(NameMergeItem[] items, out bool[] shown, out float[] ax, out float[] ay)
        {
            shown = Enumerable.Repeat(true, items.Length).ToArray();
            ax = Enumerable.Repeat(-999f, items.Length).ToArray(); ay = Enumerable.Repeat(-999f, items.Length).ToArray();
            var scratch = Enumerable.Repeat(-7, items.Length).ToArray();
            int n = NameMerge.PackNames(items, items.Length, D, shown, scratch, ax, ay);
            Assert.That(n, Is.EqualTo(shown.Count(s => s)), "the returned count is the number of true entries written");
        }

        // ---- PackNames with camps ----

        [Test]
        public void MobsOfOneCampAndOneNameFarBeyondTheChainDistanceAreOnePack()
        {
            var items = new[] { Mob(3, 0f, 0f, 1), Mob(1, 40f, 0f, 1), Mob(2, 80f, 10f, 1) };   // 40 apart, D is 4
            Run(items, out var shown, out _, out _);
            Assert.That(shown.Count(s => s), Is.EqualTo(1), "one name for the camp's pack");
            Assert.That(shown[1], Is.True, "the lowest id carries it");
        }

        [Test]
        public void ASpreadCampPackAnchorsOverTheCentreOfItsExtentAndItsHighestMember()
        {
            var items = new[] { Mob(3, 0f, 2f, 1), Mob(1, 40f, 0f, 1), Mob(2, 80f, 9f, 1) };
            Run(items, out var shown, out var ax, out var ay);
            Assert.That(shown.Count(s => s), Is.EqualTo(1));
            Assert.That(ax[1], Is.EqualTo(40f).Within(1e-4f), "(min x + max x) / 2");
            Assert.That(ay[1], Is.EqualTo(9f).Within(1e-4f), "the highest member's anchor");
        }

        [Test]
        public void AHoveredMemberOfASpreadCampPackCarriesItsName()
        {
            var items = new[] { Mob(3, 0f, 2f, 1), Mob(1, 40f, 0f, 1), Mob(2, 80f, 9f, 1, single: 2) };
            Run(items, out var shown, out var ax, out var ay);
            Assert.That(shown, Is.EqualTo(new[] { false, false, true }));
            Assert.That(ax[2], Is.EqualTo(80f)); Assert.That(ay[2], Is.EqualTo(9f));
        }

        [Test]
        public void TwoCampsOfTheSameMobNameStandingTogetherKeepTwoNames()
        {
            var items = new[] { Mob(1, 0f, 0f, 1), Mob(2, 1f, 0f, 2) };   // one unit apart: the chain would merge them
            Run(items, out var shown, out _, out _);
            Assert.That(shown, Is.EqualTo(new[] { true, true }));
        }

        [Test]
        public void ACampMobAndAMobWithNoCampDoNotJoinEvenWhenClose()
        {
            var items = new[] { Mob(1, 0f, 0f, 1), Mob(2, 1f, 0f, 0) };
            Run(items, out var shown, out _, out _);
            Assert.That(shown, Is.EqualTo(new[] { true, true }));
        }

        [Test]
        public void MobsWithNoCampKeepTheDistanceChain()
        {
            var items = new[] { Mob(1, 0f, 0f, 0), Mob(2, 3f, 0f, 0), Mob(3, 6f, 0f, 0), Mob(4, 30f, 0f, 0) };   // a chain of three, one far away
            Run(items, out var shown, out _, out _);
            Assert.That(shown, Is.EqualTo(new[] { true, false, false, true }));
        }

        [Test]
        public void DifferentNamesOfOneCampNeverMergeAndAnEliteKeepsItsOwnName()
        {
            var items = new[] { Mob(1, 0f, 0f, 1), Mob(2, 40f, 0f, 1, "Archer"), Mob(3, 80f, 0f, 1, elite: true), Mob(4, 90f, 0f, 1) };
            Run(items, out var shown, out _, out _);
            Assert.That(shown, Is.EqualTo(new[] { true, true, true, false }), "Brute x2 is one pack, the Archer and the elite stand alone");
        }

        // ---- CampOfMob ----

        static readonly MapCamp[] Camps = { new MapCamp(1000, 1000, 96, 1), new MapCamp(1200, 1000, 96, 1), new MapCamp(5000, 5000, 96, 2) };

        static List<CampView> Rows(MobTypeId a, MobTypeId b, MobTypeId c, MobTypeId? elite = null) => new List<CampView>
        {
            new CampView { MobType = a, Elite = elite }, new CampView { MobType = b, Elite = elite }, new CampView { MobType = c, Elite = elite },
        };

        [Test]
        public void AMobBelongsToTheCampOfItsTypeThatIsNearest()
        {
            var rows = Rows(MobTypeId.EmberImp, MobTypeId.SeraphShard, MobTypeId.EmberImp);
            Assert.That(NameMerge.CampOfMob(Camps, rows, MobTypeId.EmberImp, 1010, 1010), Is.EqualTo(0));
            Assert.That(NameMerge.CampOfMob(Camps, rows, MobTypeId.SeraphShard, 1010, 1010), Is.EqualTo(1), "the neighbour's type is a different camp");
        }

        [Test]
        public void TwoCampsOfOneTypeTheNearestCentreWins()
        {
            var rows = Rows(MobTypeId.EmberImp, MobTypeId.EmberImp, MobTypeId.SeraphShard);
            Assert.That(NameMerge.CampOfMob(Camps, rows, MobTypeId.EmberImp, 1090, 1000), Is.EqualTo(0));
            Assert.That(NameMerge.CampOfMob(Camps, rows, MobTypeId.EmberImp, 1110, 1000), Is.EqualTo(1));
            Assert.That(NameMerge.CampOfMob(Camps, rows, MobTypeId.EmberImp, 1100, 1000), Is.EqualTo(0), "a tie goes to the lowest index");
        }

        [Test]
        public void AMobKitedFarFromItsCampStillBelongsToItWithinTheLeashReach()
        {
            var rows = Rows(MobTypeId.EmberImp, MobTypeId.SeraphShard, MobTypeId.SeraphShard);
            float reach = 96f + NameMerge.CampReachPx;
            Assert.That(NameMerge.CampOfMob(Camps, rows, MobTypeId.EmberImp, 1000 - 700, 1000), Is.EqualTo(0), "700 px away is a normal kite");
            Assert.That(NameMerge.CampOfMob(Camps, rows, MobTypeId.EmberImp, 1000, 1000 + reach), Is.EqualTo(0), "the reach is inclusive");
            Assert.That(NameMerge.CampOfMob(Camps, rows, MobTypeId.EmberImp, 1000, 1000 + reach + 1), Is.EqualTo(-1));
        }

        [Test]
        public void TheLeashReachIsTwentyFourTilesOfThirtyTwo()
        {
            Assert.That(NameMerge.CampReachPx, Is.EqualTo(768f), "legacy MOB_LEASH_CAP = 24 * TILE");
        }

        [Test]
        public void ANoCampAnswerIsMinusOne()
        {
            var rows = Rows(MobTypeId.EmberImp, MobTypeId.EmberImp, MobTypeId.EmberImp);
            Assert.That(NameMerge.CampOfMob(null, rows, MobTypeId.EmberImp, 1000, 1000), Is.EqualTo(-1), "no camps");
            Assert.That(NameMerge.CampOfMob(Camps, null, MobTypeId.EmberImp, 1000, 1000), Is.EqualTo(-1), "no rows");
            Assert.That(NameMerge.CampOfMob(Camps, Rows(MobTypeId.SeraphShard, MobTypeId.SeraphShard, MobTypeId.SeraphShard), MobTypeId.EmberImp, 1000, 1000), Is.EqualTo(-1), "no camp of that type");
            Assert.That(NameMerge.CampOfMob(Camps, rows, MobTypeId.EmberImp, 20000, 20000), Is.EqualTo(-1), "far from every camp");
        }

        [Test]
        public void ACampWithNoRowIsSkippedAndAnEliteTypeBelongsToNoCamp()
        {
            var shortRows = new List<CampView> { new CampView { MobType = MobTypeId.SeraphShard }, new CampView { MobType = MobTypeId.EmberImp } };   // camp 2 has no row
            Assert.That(NameMerge.CampOfMob(Camps, shortRows, MobTypeId.EmberImp, 5000, 5000), Is.EqualTo(-1), "camp 2 has no row");
            Assert.That(NameMerge.CampOfMob(Camps, shortRows, MobTypeId.EmberImp, 1190, 1000), Is.EqualTo(1));
            var elite = Rows(MobTypeId.SeraphShard, MobTypeId.SeraphShard, MobTypeId.SeraphShard, MobTypeId.EmberImp);
            Assert.That(NameMerge.CampOfMob(Camps, elite, MobTypeId.EmberImp, 1000, 1000), Is.EqualTo(-1), "an elite is never packed");
        }
    }
}
