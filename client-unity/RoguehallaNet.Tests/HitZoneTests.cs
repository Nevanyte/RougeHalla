using System;
using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>The melee hit-zone seam: an empty provider draws nothing, sector geometry, sweep timing, flags. Rows below are test inputs, not game data.</summary>
    public class HitZoneTests
    {
        [SetUp] public void Clean() { WeaponShapes.Clear(); }
        [TearDown] public void Done() { WeaponShapes.Clear(); }

        [Test]
        public void ProviderIsEmptyByDefaultAndGivesNothing()
        {
            Assert.AreEqual(0, WeaponShapes.Count);
            for (byte w = 0; w < 8; w++) Assert.IsFalse(WeaponShapes.TryGet(w, out _));
        }

        [Test]
        public void OnlyUsableMeleeRowsAreReturned()
        {
            WeaponShapes.Set(new List<WeaponShape> {
                new WeaponShape { Weapon = 0, Kind = 1, Reach = 100, HalfArc = 0.5f },
                new WeaponShape { Weapon = 1, Kind = 2, Reach = 0, HalfArc = 0 },
                new WeaponShape { Weapon = 2, Kind = 1, Reach = float.NaN, HalfArc = 1 },
                new WeaponShape { Weapon = 3, Kind = 1, Reach = 50, HalfArc = 0 },
                new WeaponShape { Weapon = 4, Kind = 9, Reach = 50, HalfArc = 1 } });
            Assert.IsTrue(WeaponShapes.TryGet(0, out var s)); Assert.AreEqual(100f, s.Reach);
            for (byte w = 1; w < 5; w++) Assert.IsFalse(WeaponShapes.TryGet(w, out _), "weapon " + w);
            WeaponShapes.Set(null); Assert.IsFalse(WeaponShapes.TryGet(0, out _));
        }

        [Test]
        public void OriginIsRaisedOnlyForABoxArchetype()
        {
            HitZoneModel.Origin(100, 200, 1, 30, out float ox, out float oy); Assert.AreEqual(100f, ox); Assert.AreEqual(170f, oy);
            HitZoneModel.Origin(100, 200, 0, 30, out ox, out oy); Assert.AreEqual(200f, oy);
        }

        [Test]
        public void ArcEndpointsAndInsideTest()
        {
            float half = (float)Math.PI / 4, aim = 0.3f;
            HitZoneModel.ArcPoint(10, 20, 100, half, aim, 0f, out float x0, out float y0);
            Assert.AreEqual(10 + 100 * Math.Cos(aim - half), x0, 1e-3); Assert.AreEqual(20 + 100 * Math.Sin(aim - half), y0, 1e-3);
            HitZoneModel.ArcPoint(10, 20, 100, half, aim, .5f, out float xm, out float ym);
            Assert.AreEqual(10 + 100 * Math.Cos(aim), xm, 1e-3); Assert.AreEqual(20 + 100 * Math.Sin(aim), ym, 1e-3);
            Assert.IsTrue(HitZoneModel.Inside(10, 20, 100, half, aim, xm, ym));
            Assert.IsFalse(HitZoneModel.Inside(10, 20, 100, half, aim, xm + 20 * (float)Math.Cos(aim), ym + 20 * (float)Math.Sin(aim)), "beyond reach");
            Assert.IsFalse(HitZoneModel.Inside(10, 20, 100, half, aim, 10 - 50, 20), "behind");
            Assert.IsTrue(HitZoneModel.Inside(10, 20, 100, half, 3.1f, 10 - 50, 20 + 1), "wraps around pi");
        }

        [Test]
        public void SweepRunsEdgeToEdgeThenFades()
        {
            Assert.Less(HitZoneModel.BandCentre(0, false), 0f);
            Assert.AreEqual(1f + HitZoneModel.BandShare * .5f, HitZoneModel.BandCentre(HitZoneModel.SweepMs, false), 1e-4);
            float prev = -1f;
            for (float t = 0; t <= HitZoneModel.SweepMs; t += 10) { float c = HitZoneModel.BandCentre(t, false); Assert.GreaterOrEqual(c, prev); prev = c; }
            Assert.AreEqual(-1f, HitZoneModel.BandCentre(HitZoneModel.SweepMs + 1, false));
            Assert.AreEqual(-1f, HitZoneModel.BandCentre(50, true), "reduced motion: no sweep");
            Assert.AreEqual(1f, HitZoneModel.Fade(HitZoneModel.SweepMs));
            Assert.AreEqual(.5f, HitZoneModel.Fade(HitZoneModel.SweepMs + HitZoneModel.FadeMs / 2), 1e-4);
            Assert.AreEqual(0f, HitZoneModel.Fade(HitZoneModel.Life));
            Assert.IsTrue(HitZoneModel.Alive(HitZoneModel.Life - 1)); Assert.IsFalse(HitZoneModel.Alive(HitZoneModel.Life));
            Assert.AreEqual(0f, HitZoneModel.BandWeight(.9f, -1f));
            Assert.AreEqual(1f, HitZoneModel.BandWeight(.5f, .5f), 1e-4);
            Assert.AreEqual(0f, HitZoneModel.BandWeight(.9f, .5f));
        }

        [Test]
        public void Flags()
        {
            HitZoneModel.ParseFlags("", out bool on, out bool demo); Assert.IsTrue(on); Assert.IsFalse(demo);
            HitZoneModel.ParseFlags("?server=x&fx.hitzone=0", out on, out demo); Assert.IsFalse(on);
            HitZoneModel.ParseFlags("?fx.hitzone=1&hitzone.demo=1#x", out on, out demo); Assert.IsTrue(on); Assert.IsTrue(demo);
            HitZoneModel.ParseFlags("?hitzone.demo=0", out on, out demo); Assert.IsFalse(demo);
        }
    }
}
