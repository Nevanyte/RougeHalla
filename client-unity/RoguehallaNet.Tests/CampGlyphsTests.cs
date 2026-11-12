using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// P-UNITY-DECLUTTER-1: a camp on a map is ONE glyph, the buff its kills pay (owner direction 2026-11-12, DEV-022; deliberately not
    /// legacy mapPainter.ts:503-516,584-629 zone shapes). The clock, chest and reward rules it keeps are pinned in CampMarksTests and
    /// CampBadgesTests (legacy minimap.ts:258-270, planning.ts:688-691).
    /// </summary>
    public sealed class CampGlyphsTests
    {
        static readonly MapCamp[] Map = { new MapCamp(640, 960, 80, 1), new MapCamp(3200, 1600, 80, 3), new MapCamp(5000, 4000, 80, 5) };

        static CampView Row(byte state = 0, double respawnAt = 0, bool reward = true, byte stat = 2, ushort amount = 100, bool elite = false) =>
            new CampView
            {
                MobType = MobTypeId.EmberImp, Elite = elite ? MobTypeId.EmberImp : (MobTypeId?)null, Alive = state == 2 ? 0u : 3u, State = state, RespawnAt = respawnAt,
                Reward = reward ? new WireCampReward { Stat = stat, Amount = amount } : (WireCampReward?)null,
            };

        static CampGlyphRow[] Glyphs(CampView[] rows, CampSurface s, double now = 1000, bool active = true)
        {
            var into = new List<CampGlyphRow> { default }; // a stale row: the method must clear first
            CampMarks.Glyphs(Map, rows, now, active, s, into);
            return into.ToArray();
        }

        static CampView[] Three(CampView a, CampView? b = null, CampView? c = null) => new[] { a, b ?? Row(), c ?? Row() };

        [TestCase(CampSurface.Minimap)]
        [TestCase(CampSurface.TabMap)]
        public void ALivingCampWithARewardIsOneGlyphOfThatBuffsIconAndColourAtTheMapPosition(CampSurface s)
        {
            var g = Glyphs(Three(Row(stat: 8), Row(stat: 6), Row(stat: 4)), s);
            Assert.AreEqual(3, g.Length, "one glyph per camp, nothing extra");
            Assert.AreEqual(new[] { "speed", "armor", "leech" }, new[] { g[0].IconKey, g[1].IconKey, g[2].IconKey });
            Assert.AreEqual(CampBadges.IconRgb(8), g[0].IconRgb);
            Assert.AreEqual(CampBadges.IconRgb(6), g[1].IconRgb);
            Assert.AreEqual(0x80d6ffu, g[0].IconRgb);
            for (int i = 0; i < 3; i++)
            {
                Assert.AreEqual(i, g[i].Index);
                Assert.AreEqual((double)Map[i].X, g[i].WorldX);
                Assert.AreEqual((double)Map[i].Y, g[i].WorldY);
                Assert.AreEqual(Map[i].Zone, g[i].Zone, "the zone is carried for the tint only; no zone shape is drawn");
                Assert.IsFalse(g[i].Elite);
                Assert.IsNull(g[i].EliteText);
                Assert.IsFalse(g[i].Dim);
                Assert.IsNull(g[i].Clock);
                Assert.IsFalse(g[i].Engaged, "a fresh camp has no ring");
            }
        }

        [TestCase(CampSurface.Minimap)]
        [TestCase(CampSurface.TabMap)]
        public void ACampRowWithoutADeliveredRewardIsANeutralDotNotAnInferredIcon(CampSurface s)
        {
            var g = Glyphs(Three(Row(reward: false)), s);
            Assert.AreEqual(3, g.Length);
            Assert.IsNull(g[0].IconKey, "no reward row: nothing is inferred (C-OBS); the map draws a dot");
            Assert.AreEqual(CampMarks.NeutralRgb, g[0].IconRgb);
            Assert.IsNull(g[0].AmountText);
            Assert.AreEqual("damage", g[1].IconKey, "the neighbours are unaffected");
        }

        [Test]
        public void AnEliteCampAddsExactlyOneEliteMarkerAndTheTabMapKeepsItsAugTag()
        {
            var rows = Three(Row(elite: true), Row(), Row(reward: false, elite: true));
            var mini = Glyphs(rows, CampSurface.Minimap);
            Assert.AreEqual(3, mini.Length, "the elite marker is a flag on the camp's glyph, not a second row");
            Assert.IsTrue(mini[0].Elite); Assert.IsFalse(mini[1].Elite); Assert.IsTrue(mini[2].Elite);
            Assert.IsNull(mini[0].EliteText, "no text on the minimap");
            Assert.IsNull(mini[2].IconKey, "an elite camp without a reward is a dot with the elite marker");
            var tab = Glyphs(rows, CampSurface.TabMap);
            Assert.AreEqual(3, tab.Length);
            Assert.AreEqual("Aug", tab[0].EliteText, "same text as CampBadges.Rewards on the Tab map");
            Assert.IsNull(tab[1].EliteText);
            Assert.AreEqual("Aug", tab[2].EliteText);
        }

        [TestCase(CampSurface.Minimap)]
        [TestCase(CampSurface.TabMap)]
        public void AClearedCampIsTheDimmedBuffIconWithItsRespawnSecondsRoundedUp(CampSurface s)
        {
            var g = Glyphs(Three(Row(2, respawnAt: 181000, stat: 8), Row(2, respawnAt: 1001), Row(2, respawnAt: 500)), s, now: 1000);
            Assert.AreEqual("speed", g[0].IconKey, "the buff icon stays");
            Assert.IsTrue(g[0].Dim); Assert.IsTrue(g[1].Dim); Assert.IsTrue(g[2].Dim);
            Assert.AreEqual("180", g[0].Clock, "ceil((181000 - 1000) / 1000), as CampMarksTests pins for Markers");
            Assert.AreEqual("1", g[1].Clock, "ceil: 1 ms left reads 1");
            Assert.AreEqual("0", g[2].Clock, "past respawn reads 0 (CampMarks.Markers rule)");
            Assert.IsFalse(g[0].Engaged, "a cleared camp has no fought-here ring");
        }

        [Test]
        public void AClearedCampWithoutARespawnTimeIsDimWithNoClockAndNoClockWhileTheMatchIsInactive()
        {
            var g = Glyphs(Three(Row(2, respawnAt: 0), Row(2, respawnAt: 181000)), CampSurface.Minimap);
            Assert.IsTrue(g[0].Dim); Assert.IsNull(g[0].Clock);
            Assert.AreEqual("180", g[1].Clock);
            var idle = Glyphs(Three(Row(2, respawnAt: 181000)), CampSurface.TabMap, active: false);
            Assert.AreEqual(3, idle.Length, "camps are map knowledge, drawn while inactive too");
            Assert.IsTrue(idle[0].Dim);
            Assert.IsNull(idle[0].Clock, "clocks run only while the match is active (minimap.ts:258-270)");
        }

        [Test]
        public void TheTabMapKeepsTheRewardAmountForEveryStateAndTheMinimapHasNone()
        {
            var rows = Three(Row(0, stat: 8, amount: 50), Row(1, stat: 6, amount: 12500), Row(2, respawnAt: 5000, stat: 4, amount: 25));
            var tab = Glyphs(rows, CampSurface.TabMap);
            Assert.AreEqual(new[] { "+1.5%", "+3.75", "+0.75%" }, new[] { tab[0].AmountText, tab[1].AmountText, tab[2].AmountText });
            var mini = Glyphs(rows, CampSurface.Minimap);
            Assert.IsNull(mini[0].AmountText); Assert.IsNull(mini[1].AmountText); Assert.IsNull(mini[2].AmountText);
        }

        [Test]
        public void TheFoughtHereRingIsOnTheTabMapOnlyAndOnlyForAnEngagedCamp()
        {
            var rows = Three(Row(1), Row(0), Row(2, respawnAt: 5000));
            var mini = Glyphs(rows, CampSurface.Minimap);
            Assert.IsFalse(mini[0].Engaged, "dropped from the minimap");
            var tab = Glyphs(rows, CampSurface.TabMap);
            Assert.IsTrue(tab[0].Engaged);
            Assert.IsFalse(tab[1].Engaged);
            Assert.IsFalse(tab[2].Engaged);
        }

        [Test]
        public void AnEngagedEliteCampWithARewardIsStillOneGlyphRowOnTheMinimap()
        {
            var g = Glyphs(Three(Row(1, elite: true)), CampSurface.Minimap);
            Assert.AreEqual(3, g.Length);
            Assert.AreEqual("damage", g[0].IconKey);
            Assert.IsTrue(g[0].Elite);
            Assert.IsFalse(g[0].Engaged);
            Assert.IsFalse(g[0].Dim);
        }

        [Test]
        public void TheWorldSurfaceGetsNoMapGlyphsAndAMismatchedRowCountOrNullsGiveNone()
        {
            Assert.AreEqual(0, Glyphs(Three(Row()), CampSurface.World).Length, "the world has the buff plaque, not map glyphs");
            Assert.AreEqual(0, Glyphs(new[] { Row(), Row() }, CampSurface.Minimap).Length);
            var into = new List<CampGlyphRow> { default };
            CampMarks.Glyphs(null, Three(Row()), 0, true, CampSurface.TabMap, into); Assert.AreEqual(0, into.Count);
            into.Add(default);
            CampMarks.Glyphs(Map, null, 0, true, CampSurface.TabMap, into); Assert.AreEqual(0, into.Count);
        }

        [Test]
        public void EveryCampIsExactlyOneRowOnEitherMap()
        {
            // The row type has no shape field by construction; a camp is one row, which draws at most the buff glyph and the elite
            // marker (the ring is Tab-only, wards are CampBadges.Wards rows).
            foreach (var s in new[] { CampSurface.Minimap, CampSurface.TabMap })
            {
                var g = Glyphs(new[] { Row(1, elite: true), Row(2, respawnAt: 9000, elite: true), Row(0, reward: false, elite: true) }, s);
                Assert.AreEqual(3, g.Length, s.ToString());
                var seen = new HashSet<int>();
                foreach (var r in g) Assert.IsTrue(seen.Add(r.Index), "never two rows for one camp");
            }
        }
    }
}
