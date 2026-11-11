using System;
using NUnit.Framework;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// The weapon range guide geometry (legacy WeaponRangeView.weaponRangeGeometry, packages/client/src/render/WeaponRangeView.ts:19-43).
    /// Weapon rows are the Welcome table of protocol/fixtures/v16.json (and ProtocolVectorTests: sword id 0, bow id 1, wand id 2,
    /// shield 3, axe 4, fists 5); body half-widths are PLAYER_RADIUS 12 (archetypes_v1.json legacy_circle r) and the hero body box 17.
    /// </summary>
    public class WeaponRangeTests
    {
        const float Eps = 1e-4f;
        static WireWeapon Arc(byte id, double reach, double half) { return new WireWeapon { Id = id, Kind = WireWeapon.KindArc, Reach = reach, HalfArc = half }; }
        static WireWeapon Proj(byte id, double reach, double speed, double radius) { return new WireWeapon { Id = id, Kind = WireWeapon.KindProjectile, Reach = reach, Speed = speed, Radius = radius }; }
        static readonly WireWeapon Sword = Arc(0, 112, Math.PI / 4), Shield = Arc(3, 96, Math.PI / 3), Axe = Arc(4, 112, Math.PI / 2);
        static readonly WireWeapon Bow = Proj(1, 520, 900, 7), Wand = Proj(2, 640, 380, 2);

        [Test]
        public void BowLaneIsRangeLongAndTwiceBodyPlusArrowRadiusWide()
        {
            var s = WeaponRange.Of(Bow, 12f, 0f, false);                       // legacy: PLAYER_RADIUS 12 + ARROW_RADIUS 7 => 38
            Assert.AreEqual(WeaponRangeKind.Lane, s.Kind);
            Assert.AreEqual(520f, s.Length, Eps);
            Assert.AreEqual(38f, s.Width, Eps);
            var hero = WeaponRange.Of(Bow, 17f, 0f, false);                    // the same rule over a hero body box half-width: 2 x (17 + 7)
            Assert.AreEqual(48f, hero.Width, Eps);
        }

        [Test]
        public void LaneFollowsTheAim()
        {
            Assert.AreEqual(1.25f, WeaponRange.Of(Bow, 12f, 1.25f, false).Direction, Eps);
            Assert.AreEqual((float)-Math.PI / 2, WeaponRange.Of(Bow, 12f, (float)-Math.PI / 2, false).Direction, Eps);
            Assert.AreEqual(0f, WeaponRange.Of(Bow, 12f, float.NaN, false).Direction, Eps, "non-finite aim counts as 0 (WeaponRangeView.ts:22)");
        }

        [Test]
        public void WandIsACircleOfItsRangeWhateverTheAim()
        {
            var s = WeaponRange.Of(Wand, 12f, 2f, true);
            Assert.AreEqual(WeaponRangeKind.Circle, s.Kind);
            Assert.AreEqual(640f, s.Length, Eps);
            Assert.AreEqual(0f, s.Direction, Eps, "legacy forces aim 0 for a ball (WeaponRangeView.ts:83)");
        }

        [Test]
        public void MeleeIsAnArcOfReachAndHalfArcAtTheAim()
        {
            foreach (var w in new[] { Sword, Shield, Axe })
            {
                var s = WeaponRange.Of(w, 12f, 0.5f, false);
                Assert.AreEqual(WeaponRangeKind.Arc, s.Kind, "weapon " + w.Id);
                Assert.AreEqual((float)w.Reach, s.Length, Eps);
                Assert.AreEqual((float)w.HalfArc, s.HalfArc, Eps);
                Assert.AreEqual(0.5f, s.Direction, Eps);
            }
        }

        [Test]
        public void UnknownOrShapelessWeaponGivesNoShape()
        {
            Assert.AreEqual(WeaponRangeKind.None, WeaponRange.Of(null, 12f, 0f, false).Kind);
            var none = new WireWeapon { Id = 31, Kind = WireWeapon.KindNone };
            Assert.AreEqual(WeaponRangeKind.None, WeaponRange.Of(none, 12f, 0f, false).Kind);
        }
    }
}
