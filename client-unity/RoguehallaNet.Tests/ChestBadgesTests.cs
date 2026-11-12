using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>Reward chest badges on the maps, pinned to legacy: minimapMarkers.ts:56-71 (seconds = max(0, ceil(left)), bare digits,
    /// "a camp has one badge": a respawn clock is dropped when a chest is within 1 unit of its camp), RaidScene.ts:1100-1114 (a blip
    /// exists only for a visible chest with left &gt; 0; picked / choosable state plays no part), sim/chests.ts:60-80 and :207-211 (chest
    /// stands at the camp centre; gone once now &gt;= expiresAt).</summary>
    public sealed class ChestBadgesTests
    {
        static readonly MapCamp[] Map = { new MapCamp(640, 960, 80, 1), new MapCamp(3200, 1600, 80, 3), new MapCamp(5000, 4000, 80, 5) };
        const double Now = 100000;

        static RewardChestView Chest(float x, float y, double expiresAt, bool picked = false, bool canChoose = true, uint handle = 7)
        {
            var r = new RewardChestView();
            var t = typeof(RewardChestView);
            t.GetProperty("X").SetValue(r, x); t.GetProperty("Y").SetValue(r, y);
            t.GetProperty("ExpiresAt").SetValue(r, expiresAt);
            t.GetProperty("Picked").SetValue(r, picked); t.GetProperty("CanChoose").SetValue(r, canChoose);
            t.GetProperty("Handle").SetValue(r, new RewardChestHandle(handle));
            return r;
        }

        static ChestBadgeRow[] Rows(RewardChestView[] chests, CampSurface s = CampSurface.Minimap, System.Func<double, double, bool> canSee = null, double now = Now)
        {
            var into = new List<ChestBadgeRow>();
            ChestBadges.Rows(Map, chests, now, s, canSee, into);
            return into.ToArray();
        }

        [Test]
        public void SecondsRoundUpAndAreBareDigits()
        {
            // minimapMarkers.ts:62 String(max(0, ceil(left)))
            Assert.AreEqual("13", ChestBadges.Seconds(Now + 12300, Now));
            Assert.AreEqual("12", ChestBadges.Seconds(Now + 12000, Now));
            Assert.AreEqual("1", ChestBadges.Seconds(Now + 1, Now), "any time left reads at least 1");
            Assert.AreEqual("15", ChestBadges.Seconds(Now + 15000, Now), "CHEST_SECONDS");
            var r = Rows(new[] { Chest(640, 960, Now + 12300) });
            Assert.AreEqual(1, r.Length);
            Assert.AreEqual("13", r[0].Text);
        }

        [Test]
        public void AnExpiredChestGivesNoBadge()
        {
            // the server drops a chest the tick now >= expiresAt (chests.ts:209); the client blip needs left > 0 (RaidScene.ts:1114)
            Assert.IsNull(ChestBadges.Seconds(Now, Now));
            Assert.IsNull(ChestBadges.Seconds(Now - 500, Now));
            Assert.IsNotNull(ChestBadges.Seconds(Now + 1, Now));
            var r = Rows(new[] { Chest(640, 960, Now), Chest(3200, 1600, Now + 4000), Chest(5000, 4000, Now - 1) });
            Assert.AreEqual(1, r.Length);
            Assert.AreEqual(1, r[0].Index, "Index is the delivered row position");
            Assert.AreEqual("4", r[0].Text);
        }

        [Test]
        public void AChestPairsWithTheCampWithinOneUnit()
        {
            // minimapMarkers.ts:70 hypot(c - r) < 1, strict; chest and camp centre coincide (sim/chests.ts:73-76, mapgen.ts:942)
            Assert.AreEqual(0, ChestBadges.CampOf(Map, 640, 960));
            Assert.AreEqual(1, ChestBadges.CampOf(Map, 3200.875, 1600), "0.875 away (the 1/8 wire grid)");
            Assert.AreEqual(-1, ChestBadges.CampOf(Map, 3201, 1600), "exactly 1 away is not within");
            Assert.AreEqual(-1, ChestBadges.CampOf(Map, 641.5, 960.5));
            Assert.AreEqual(2, ChestBadges.CampOf(Map, 5000, 4000));
            var r = Rows(new[] { Chest(3200, 1600, Now + 9000), Chest(1500, 1500, Now + 9000) });
            Assert.AreEqual(2, r.Length);
            Assert.AreEqual(1, r[0].CampIndex);
            Assert.AreEqual(-1, r[1].CampIndex, "a chest at no camp (training console) still shows its seconds");
            Assert.AreEqual("9", r[1].Text);
            Assert.AreEqual(1500, r[1].WorldX);
        }

        [Test]
        public void AStandingChestReplacesItsCampsRespawnClockAndTheClockReturns()
        {
            // minimapMarkers.ts:69-70 "a camp has one badge: loot lifetime while the chest is up, then its public respawn clock"
            var up = Rows(new[] { Chest(3200, 1600, Now + 9000) });
            Assert.AreEqual(1, up.Length);
            Assert.IsTrue(ChestBadges.Replaces(up, 1));
            Assert.IsFalse(ChestBadges.Replaces(up, 0), "other camps keep their clocks");
            Assert.IsFalse(ChestBadges.Replaces(up, 2));
            Assert.IsFalse(ChestBadges.Replaces(up, -1));
            var gone = Rows(new[] { Chest(3200, 1600, Now + 9000) }, now: Now + 9000);
            Assert.AreEqual(0, gone.Length);
            Assert.IsFalse(ChestBadges.Replaces(gone, 1), "the clock returns when the chest is gone");
            Assert.IsFalse(ChestBadges.Replaces(null, 1));
            // the clock is replaced only for a chest that is drawn: an unseen chest on the minimap leaves the clock (RaidScene.ts:1096 gates the blip)
            var unseen = Rows(new[] { Chest(3200, 1600, Now + 9000) }, canSee: (x, y) => false);
            Assert.AreEqual(0, unseen.Length);
            Assert.IsFalse(ChestBadges.Replaces(unseen, 1));
        }

        [Test]
        public void APickedChestAndOneTheViewerCannotChooseFromStillShowTheirSeconds()
        {
            // legacy pushes the blip for every reward container with left > 0 (RaidScene.ts:1114); pickers / takenBy never gate it,
            // the server keeps the chest until expiresAt (chests.ts:207-211)
            var r = Rows(new[]
            {
                Chest(640, 960, Now + 5500, picked: true),
                Chest(3200, 1600, Now + 6500, canChoose: false),
                Chest(5000, 4000, Now + 2000, picked: true, canChoose: false),
            });
            Assert.AreEqual(3, r.Length);
            Assert.AreEqual("6", r[0].Text);
            Assert.AreEqual("7", r[1].Text);
            Assert.AreEqual("2", r[2].Text);
            Assert.IsTrue(ChestBadges.Replaces(r, 0));
            Assert.IsTrue(ChestBadges.Replaces(r, 2));
        }

        [Test]
        public void SurfacesMinimapFollowsSightTabMapIgnoresItWorldIsNotThisModel()
        {
            var chests = new[] { Chest(640, 960, Now + 3000), Chest(3200, 1600, Now + 8000) };
            System.Func<double, double, bool> seeFirst = (x, y) => x < 1000;
            var mini = Rows(chests, CampSurface.Minimap, seeFirst);
            Assert.AreEqual(1, mini.Length);
            Assert.AreEqual("3", mini[0].Text);
            var tab = Rows(chests, CampSurface.TabMap, seeFirst); // map knowledge: no sight test (adaptation, see the brief)
            Assert.AreEqual(2, tab.Length);
            Assert.AreEqual("3", tab[0].Text);
            Assert.AreEqual("8", tab[1].Text, "same bare digits on both maps");
            Assert.AreEqual(1, tab[1].Index);
            var world = Rows(chests, CampSurface.World);
            Assert.AreEqual(0, world.Length, "the world ring and its \"12s\" are WorldIndicators");
            Assert.AreEqual(2, Rows(chests, CampSurface.Minimap, null).Length, "null canSee shows every chest");
        }

        [Test]
        public void RowsClearAndFillTheCallersListAndTolerateMissingInput()
        {
            var into = new List<ChestBadgeRow> { new ChestBadgeRow { Index = 99, Text = "stale" } };
            ChestBadges.Rows(Map, new[] { Chest(640, 960, Now + 1000), Chest(3200, 1600, Now + 2000) }, Now, CampSurface.Minimap, null, into);
            Assert.AreEqual(2, into.Count);
            Assert.AreEqual(0, into[0].Index);
            ChestBadges.Rows(Map, new[] { Chest(5000, 4000, Now + 3000) }, Now, CampSurface.TabMap, null, into);
            Assert.AreEqual(1, into.Count, "cleared on every call");
            Assert.AreEqual("3", into[0].Text);
            Assert.DoesNotThrow(() => ChestBadges.Rows(Map, null, Now, CampSurface.Minimap, null, into));
            Assert.AreEqual(0, into.Count);
            Assert.DoesNotThrow(() => ChestBadges.Rows(null, new[] { Chest(640, 960, Now + 1000) }, Now, CampSurface.Minimap, null, into));
            Assert.AreEqual(1, into.Count, "no camp list: the chest still shows, paired with no camp");
            Assert.AreEqual(-1, into[0].CampIndex);
            Assert.AreEqual("1", into[0].Text);
        }
    }
}
