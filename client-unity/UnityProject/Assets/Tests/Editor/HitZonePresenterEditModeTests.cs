using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using Roguehalla.Net.Ui;

namespace Roguehalla.Client.Tests
{
    /// <summary>Melee hit-zone presenter: nothing without shapes, for undelivered actors or when switched off; pooled; fades out. Shape rows are test inputs.</summary>
    public sealed class HitZonePresenterEditModeTests
    {
        GameObject _root; readonly HashSet<uint> _delivered = new HashSet<uint>();

        [SetUp] public void Up() { _root = new GameObject("zones"); WeaponShapes.Clear(); _delivered.Clear(); _delivered.Add(7); }
        [TearDown] public void Down() { WeaponShapes.Clear(); Object.DestroyImmediate(_root); }

        HitZonePresenter Make(string search = "") { return new HitZonePresenter(_root.transform, id => _delivered.Contains(id), search); }
        static void Sword() { WeaponShapes.Set(new List<WeaponShape> { new WeaponShape { Weapon = 0, Kind = 1, Reach = 100, HalfArc = .7f } }); }

        [Test] public void NothingWithoutShapes() { var p = Make(); Assert.IsFalse(p.Swing(7, 0, 100, 100, 0, 0)); Assert.AreEqual(0, p.LiveCount); }
        [Test] public void NothingForAnUndeliveredActor() { Sword(); var p = Make(); Assert.IsFalse(p.Swing(99, 0, 100, 100, 0, 0)); Assert.AreEqual(0, p.LiveCount); }
        [Test] public void NothingWhenSwitchedOff() { Sword(); var p = Make("?fx.hitzone=0"); Assert.IsFalse(p.Enabled); Assert.IsFalse(p.Swing(7, 0, 100, 100, 0, 0)); }
        [Test] public void NothingForAProjectileWeapon() { WeaponShapes.Set(new List<WeaponShape> { new WeaponShape { Weapon = 1, Kind = 2 } }); Assert.IsFalse(Make().Swing(7, 1, 0, 0, 0, 0)); }
        [Test] public void NonFiniteAngleIsRefused() { Sword(); Assert.IsFalse(Make().Swing(7, 0, 0, 0, float.NaN, 0)); }

        [Test]
        public void AZoneLivesThroughTheSweepFadesAndIsPooled()
        {
            Sword(); var p = Make();
            Assert.IsTrue(p.Swing(7, 0, 100, 100, 0, 10f)); Assert.AreEqual(1, p.LiveCount);
            p.Tick(10.1f, false); Assert.AreEqual(1, p.LiveCount);
            p.Tick(10f + HitZoneModel.Life / 1000f + .01f, false); Assert.AreEqual(0, p.LiveCount);
            int children = _root.transform.childCount;
            Assert.IsTrue(p.Swing(7, 0, 100, 100, 0, 20f)); Assert.AreEqual(children, _root.transform.childCount, "reused, not created");
        }

        [Test]
        public void ZonesAreCapped()
        {
            Sword(); var p = Make();
            for (int i = 0; i < HitZoneModel.MaxZones + 4; i++) p.Swing(7, 0, i, 0, 0, 0);
            Assert.AreEqual(HitZoneModel.MaxZones, p.LiveCount);
        }
    }
}
