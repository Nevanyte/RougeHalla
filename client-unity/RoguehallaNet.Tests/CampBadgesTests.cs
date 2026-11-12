using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>Camp reward badges and ward beacons, pinned to legacy: CampBuffs.ts (world badge, icon only, one per living visible
    /// camp group; mobRewardIcon :76-89), planning.ts:160-192 and :678-691 (Tab map icon + amount, elite "Aug" chest),
    /// mobStats.ts (per-kill amount text), combatIcons.ts:23-26 (colours), CampWards.ts:39-57 (beacon and its text).</summary>
    public sealed class CampBadgesTests
    {
        static readonly MapCamp[] Map = { new MapCamp(640, 960, 80, 1), new MapCamp(3200, 1600, 80, 3), new MapCamp(5000, 4000, 80, 5) };

        static CampView Row(byte state = 0, uint alive = 3, byte stat = 2, ushort amount = 100, bool reward = true, bool elite = false,
            WardVerdict ward = WardVerdict.None, double wardEnds = 0) =>
            new CampView
            {
                MobType = MobTypeId.EmberImp, Elite = elite ? MobTypeId.EmberImp : (MobTypeId?)null, Alive = alive, State = state,
                Reward = reward ? new WireCampReward { Stat = stat, Amount = amount } : (WireCampReward?)null,
                Ward = ward, WardExpiresAt = wardEnds,
            };

        static CampBadgeRow[] Badges(CampView[] rows, CampSurface s, bool active = true, System.Func<double, double, bool> canSee = null)
        {
            var into = new List<CampBadgeRow>();
            CampBadges.Rewards(Map, rows, active, s, canSee, into);
            return into.ToArray();
        }

        static CampWardRow[] Wards(CampView[] rows, double now, bool active = true)
        {
            var into = new List<CampWardRow>();
            CampBadges.Wards(Map, rows, now, active, into);
            return into.ToArray();
        }

        static string WardText(long endsAt, bool countdown = false)
        {
            var w = Wards(new[] { Row(ward: WardVerdict.Other, wardEnds: endsAt), Plain, Plain }, 1000);
            Assert.AreEqual(1, w.Length);
            return countdown ? w[0].Countdown : w[0].WorldText;
        }

        static readonly CampView Plain = Row(reward: false);

        [Test]
        public void IconKeyAndColourFollowTheWireStatOrder()
        {
            // wire order: Offense, Soul Offense, Damage, Attack speed, Life steal, Health, Defense, Soul Defense, Move speed
            string[] keys = { "ad", "ap", "damage", "attackSpeed", "leech", "health", "armor", "mr", "speed" };
            uint[] rgb = { 0xffb074, 0xc4a0ff, 0xffd36a, 0xffdc78, 0xf05260, 0x62d889, 0xd5e0e8, 0x75cfff, 0x80d6ff };
            for (byte s = 0; s < 9; s++)
            {
                Assert.AreEqual(keys[s], CampBadges.IconKey(s), "key " + s);
                Assert.AreEqual(rgb[s], CampBadges.IconRgb(s), "rgb " + s);
            }
            Assert.AreEqual("damage", CampBadges.IconKey(99), "legacy default");
            Assert.AreEqual(0xffd36au, CampBadges.IconRgb(99));
        }

        [Test]
        public void AmountTextIsThePerKillAmount()
        {
            // wire amount = per-stack value / 1e-4; a credited kill grants 3 stacks (MOB_KILL_STACKS)
            (byte stat, ushort amount, string text)[] cases =
            {
                (2, 100, "+3%"), (8, 50, "+1.5%"), (4, 25, "+0.75%"), (5, 100, "+3%"), (3, 100, "+3%"),
                (6, 12500, "+3.75"), (7, 15000, "+4.5"), (0, 10000, "+3"), (1, 10000, "+3"),
            };
            foreach (var c in cases)
                Assert.AreEqual(c.text, CampBadges.AmountText(new WireCampReward { Stat = c.stat, Amount = c.amount }), c.stat + "/" + c.amount);
        }

        [Test]
        public void TabMapBadgeCarriesIconAndAmountForEveryCampStateAndWhileInactive()
        {
            // legacy planning.ts:688-691 builds it from the camp's type, whatever its state; hidden only by mode
            var rows = new[] { Row(0, stat: 8, amount: 50), Row(1, stat: 6, amount: 12500), Row(2, alive: 0, stat: 4, amount: 25) };
            foreach (bool active in new[] { true, false })
            {
                var b = Badges(rows, CampSurface.TabMap, active, (x, y) => false);
                Assert.AreEqual(3, b.Length);
                Assert.AreEqual(new[] { "speed", "armor", "leech" }, new[] { b[0].IconKey, b[1].IconKey, b[2].IconKey });
                Assert.AreEqual(new[] { "+1.5%", "+3.75", "+0.75%" }, new[] { b[0].AmountText, b[1].AmountText, b[2].AmountText });
                Assert.AreEqual(2, b[2].Index);
                Assert.AreEqual((double)Map[2].X, b[2].WorldX);
                Assert.AreEqual((double)Map[2].Y, b[2].WorldY);
                Assert.AreEqual(0x80d6ffu, b[0].IconRgb);
            }
        }

        [Test]
        public void WorldBadgeIsIconOnlyForLivingVisibleUnclearedCampsWhileActive()
        {
            var rows = new[] { Row(0), Row(1), Row(2, alive: 0) };
            var b = Badges(rows, CampSurface.World);
            Assert.AreEqual(2, b.Length, "idle and engaged show, cleared does not");
            Assert.AreEqual("damage", b[0].IconKey);
            Assert.IsNull(b[0].AmountText, "legacy world badge is icon only (CampBuffs.ts:94-95)");
            Assert.AreEqual(1, b[1].Index);

            Assert.AreEqual(0, Badges(new[] { Row(0, alive: 0), Plain, Row(2) }, CampSurface.World).Length, "no living mob, no reward, cleared");
            Assert.AreEqual(0, Badges(rows, CampSurface.World, active: false).Length, "training or inactive hides it");
        }

        [Test]
        public void WorldBadgeIsHiddenOutsideSight()
        {
            var rows = new[] { Row(0), Row(0), Row(0) };
            var b = Badges(rows, CampSurface.World, canSee: (x, y) => x > 3000 && x < 4000);
            Assert.AreEqual(1, b.Length);
            Assert.AreEqual(1, b[0].Index);
            Assert.AreEqual(3, Badges(rows, CampSurface.World, canSee: null).Length);
        }

        [Test]
        public void MinimapBadgeIsIconOnlyAndYieldsToTheRespawnClockOfAClearedCamp()
        {
            // owner direction (legacy minimap has no reward glyph): one badge per camp, the clock wins when cleared (minimapMarkers.ts:70)
            var rows = new[] { Row(0), Row(1), Row(2, alive: 0) };
            var b = Badges(rows, CampSurface.Minimap);
            Assert.AreEqual(2, b.Length);
            Assert.AreEqual("damage", b[0].IconKey);
            Assert.IsNull(b[0].AmountText);
            Assert.AreEqual(0, Badges(rows, CampSurface.Minimap, active: false).Length);
        }

        [Test]
        public void EliteCampShowsALegacySecondBadgeBesideTheStatBadge()
        {
            var elite = new[] { Row(0, elite: true), Row(0, elite: true, reward: false), Row(0) };
            var w = Badges(elite, CampSurface.World);
            Assert.AreEqual(3, w.Length, "camp 0 shows both badges, camp 1 the elite one only, camp 2 its stat badge");
            Assert.IsNull(w[1].IconKey);
            Assert.AreEqual("ap", w[1].EliteIconKey);
            Assert.IsNull(w[2].EliteIconKey);
            Assert.AreEqual("damage", w[0].IconKey);
            Assert.AreEqual("ap", w[0].EliteIconKey, "CampBuffs.ts:47: elite fallback icon is ap");
            Assert.AreEqual(0xc4a0ffu, w[0].EliteIconRgb);
            Assert.IsNull(w[0].EliteText);
        }

        [Test]
        public void EliteTabMapBadgeIsTheAugmentChestAndAPlainCampHasNoEliteBadge()
        {
            var t = Badges(new[] { Row(0, elite: true), Row(0, elite: true, reward: false), Row(0) }, CampSurface.TabMap);
            Assert.AreEqual(3, t.Length);
            Assert.AreEqual("chest", t[0].EliteIconKey, "planning.ts:189-192");
            Assert.AreEqual("Aug", t[0].EliteText);
            Assert.IsNull(t[1].IconKey, "elite camp without a stat reward: chest only");
            Assert.AreEqual("Aug", t[1].EliteText);
            Assert.IsNull(t[2].EliteIconKey);
            Assert.IsNull(t[2].EliteText);
            Assert.AreEqual(0, Badges(new[] { Plain, Plain, Plain }, CampSurface.TabMap).Length);
        }

        [Test]
        public void WardLooksAndTextForYoursAndOther()
        {
            var rows = new[] { Row(ward: WardVerdict.Yours, wardEnds: 91000), Row(ward: WardVerdict.Other, wardEnds: 91000), Plain };
            var w = Wards(rows, 1000);
            Assert.AreEqual(2, w.Length, "verdict None gives no beacon");
            Assert.AreEqual(WardVerdict.Yours, w[0].Look);
            Assert.AreEqual("YOUR WARD 90s", w[0].WorldText);
            Assert.AreEqual("90", w[0].Countdown);
            Assert.AreEqual(0x66e4efu, w[0].BeaconRgb);
            Assert.AreEqual(0x66e4efu, w[0].TextRgb);
            Assert.AreEqual(WardVerdict.Other, w[1].Look);
            Assert.AreEqual(1, w[1].Index);
            Assert.AreEqual("WARD 90s", w[1].WorldText);
            Assert.AreEqual(0x9aa9bdu, w[1].BeaconRgb);
            Assert.AreEqual(0xb9c6d7u, w[1].TextRgb);
            Assert.AreEqual((double)Map[1].X, w[1].WorldX);
        }

        [Test]
        public void WardSecondsRoundUpAndAnExpiredWardIsGone()
        {
            Assert.AreEqual("WARD 91s", WardText(91001));
            Assert.AreEqual("WARD 90s", WardText(91000));
            Assert.AreEqual("WARD 1s", WardText(1001));
            Assert.AreEqual("1", WardText(1001, true));
            // CampWards.ts:40: shown only while now < wardExpiresAt
            Assert.AreEqual(0, Wards(new[] { Row(ward: WardVerdict.Yours, wardEnds: 1000), Plain, Plain }, 1000).Length);
            Assert.AreEqual(0, Wards(new[] { Row(ward: WardVerdict.Yours, wardEnds: 500), Plain, Plain }, 1000).Length);
        }

        [Test]
        public void WardIgnoresCampStateAndSightButNotTheActiveMatchOrRowCount()
        {
            var rows = new[] { Row(2, alive: 0, ward: WardVerdict.Yours, wardEnds: 5000), Plain, Plain };
            Assert.AreEqual(1, Wards(rows, 1000).Length, "cleared camp keeps its beacon (CampWards.ts loops every camp)");
            Assert.AreEqual(0, Wards(rows, 1000, active: false).Length);
            var into = new List<CampWardRow> { new CampWardRow() };
            Assert.DoesNotThrow(() => CampBadges.Wards(Map, new[] { Plain }, 1000, true, into));
            Assert.AreEqual(0, into.Count);
            var badges = new List<CampBadgeRow> { new CampBadgeRow() };
            Assert.DoesNotThrow(() => CampBadges.Rewards(Map, new[] { Row() }, true, CampSurface.TabMap, null, badges));
            Assert.AreEqual(0, badges.Count);
        }
    }
}
