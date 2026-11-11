using NUnit.Framework;
using UnityEngine;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Client.Tests
{
    /// <summary>Weapon range guide presenter: the bow lane's mesh is range long and 2 x (body half-width + arrow radius) wide; hides without a row.</summary>
    public sealed class WeaponRangePresenterEditModeTests
    {
        GameObject _root;
        [SetUp] public void Up() { _root = new GameObject("range guide"); }
        [TearDown] public void Down() { Object.DestroyImmediate(_root); }

        static readonly WireWeapon Bow = new WireWeapon { Id = 1, Kind = WireWeapon.KindProjectile, Reach = 520, Speed = 900, Radius = 7 };
        static readonly WireWeapon Wand = new WireWeapon { Id = 2, Kind = WireWeapon.KindProjectile, Reach = 640, Speed = 380, Radius = 2 };

        [Test]
        public void TheBowLaneMeshIsRangeLongAndTwiceBodyPlusArrowWide()
        {
            var p = new WeaponRangePresenter(_root.transform);
            p.Show(Bow, 17f, 0f, false, 100f, 200f);
            Assert.IsTrue(p.Visible);
            Assert.AreEqual(520f * ArenaView.Scale, p.FillBounds.size.x, 1e-3f);
            Assert.AreEqual(2f * (17f + 7f) * ArenaView.Scale * ArenaView.GroundSquash, p.FillBounds.size.y, 1e-3f);
            Assert.AreEqual(ArenaView.WorldPoint(100f + 260f, 200f).x, p.FillBounds.center.x, 1e-3f);
            Assert.AreEqual(ArenaView.WorldPoint(100f, 200f).y, p.FillBounds.center.y, 1e-3f);
            // the strokes sit on the same outline, within their half width of it
            var vs = p.Mesh.vertices; var b = new Bounds(vs[0], Vector3.zero); foreach (var v in vs) b.Encapsulate(v);
            Assert.AreEqual(p.FillBounds.size.x + 3f * ArenaView.Scale * 2f, b.size.x, 4e-2f);
        }

        [Test]
        public void AWandIsACircleOfItsRangeAndAMissingRowHides()
        {
            var p = new WeaponRangePresenter(_root.transform);
            p.Show(Wand, 12f, 2f, true, 0f, 0f);
            Assert.AreEqual(1280f * ArenaView.Scale, p.FillBounds.size.x, 2e-2f);
            p.Show(null, 12f, 0f, false, 0f, 0f);
            Assert.IsFalse(p.Visible);
        }

        [Test]
        public void ItIsShownOnlyForALivingFighterInAnActiveMatchWithAKnownWeapon()
        {
            Assert.IsTrue(WeaponRangePresenter.ShouldShow(true, true, true, false, 1f, 2f));
            Assert.IsFalse(WeaponRangePresenter.ShouldShow(false, true, true, false, 1f, 2f));
            Assert.IsFalse(WeaponRangePresenter.ShouldShow(true, false, true, false, 1f, 2f));
            Assert.IsFalse(WeaponRangePresenter.ShouldShow(true, true, false, false, 1f, 2f));
            Assert.IsFalse(WeaponRangePresenter.ShouldShow(true, true, true, true, 1f, 2f));
            Assert.IsFalse(WeaponRangePresenter.ShouldShow(true, true, true, false, float.NaN, 2f));
        }
    }
}
