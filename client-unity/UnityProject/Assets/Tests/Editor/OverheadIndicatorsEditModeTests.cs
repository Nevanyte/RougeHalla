using NUnit.Framework;
using UnityEngine;
using Roguehalla.Net;
using Roguehalla.Net.Ui;

namespace Roguehalla.Client.Tests
{
    /// <summary>The overhead cluster: presence and absence rules, bounty scaling, status glyph choice, dead actors, undelivered actors.</summary>
    public sealed class OverheadIndicatorsEditModeTests
    {
        GameObject _go; OverheadIndicators _ind;

        [SetUp] public void Up() { ShowcaseSprites.Initialize(); _go = new GameObject("actor"); _ind = new OverheadIndicators(_go.transform); }
        [TearDown] public void Down() { Object.DestroyImmediate(_go); }

        static OverheadIndicators.Facts Facts() { return new OverheadIndicators.Facts { Order = 2000, HeadY = 1.68f, BarY = 1.8f, HpPct = 100f }; }
        SpriteRenderer Find(string name) { var t = _go.transform.Find(name); return t == null ? null : t.GetComponent<SpriteRenderer>(); }

        [Test] public void NothingShownForAPlainActor()
        {
            _ind.Update(Facts());
            foreach (var r in _go.GetComponentsInChildren<SpriteRenderer>(true)) Assert.IsFalse(r.enabled, r.name);
            Assert.IsFalse(_go.transform.Find("Bounty number").gameObject.activeSelf);
        }

        [Test] public void BountyCrownShowsOnlyWithABountyAndGrows()
        {
            var f = Facts(); f.Bounty = 10; _ind.Update(f);
            Assert.IsTrue(Find("Bounty crown").enabled); float small = Find("Bounty crown").transform.localScale.x;
            Assert.IsTrue(_go.transform.Find("Bounty number").gameObject.activeSelf);
            f.Bounty = 150; _ind.Update(f); Assert.Greater(Find("Bounty crown").transform.localScale.x, small * 1.4f);
            f.Bounty = 0; _ind.Update(f); Assert.IsFalse(Find("Bounty crown").enabled);
        }

        [Test] public void SecondaryWeaponBadgeOnlyWhenDelivered()
        {
            var f = Facts(); _ind.Update(f); Assert.IsFalse(Find("Secondary weapon icon").enabled);
            f.HasSecondary = true; f.Secondary = WeaponId.Bow; _ind.Update(f);
            Assert.IsTrue(Find("Secondary weapon icon").enabled); Assert.IsTrue(Find("Secondary weapon backer").enabled);
        }

        [Test] public void StatusGlyphsFollowTheEffectBitsAndIgnoreHiddenAndUnknown()
        {
            var f = Facts(); f.Effects = (ushort)(Indicators.Stunned | Indicators.Dot | Indicators.Hidden | 0x4000); _ind.Update(f);
            Assert.IsTrue(Find("Status stun").enabled); Assert.IsTrue(Find("Status flame").enabled);
            Assert.IsFalse(Find("Status silence").enabled); Assert.IsFalse(Find("Rooted ring").enabled);
            f.Effects = Indicators.Rooted; _ind.Update(f); Assert.IsTrue(Find("Rooted ring").enabled); Assert.IsFalse(Find("Status stun").enabled);
        }

        [Test] public void ConcentricBodyRingsDrawAtDifferentSizes()
        {
            var f = Facts(); f.Effects = (ushort)(Indicators.Casting | Indicators.LastStand | Indicators.Untargetable); _ind.Update(f);
            float c = Find("Status cast").transform.localScale.x, l = Find("Status faststand").transform.localScale.x, u = Find("Status dashring").transform.localScale.x;
            Assert.Greater(c, l); Assert.Greater(l, u);
        }

        [Test] public void StatusArtSitsAtTheLegacyAnchorAndThereIsNoBadgePlate()
        {
            var f = Facts(); f.Effects = (ushort)(Indicators.Stunned | Indicators.Dot | Indicators.Silenced | Indicators.AntiHeal); _ind.Update(f);
            float feet = f.BarY - OverheadStack.ToUnits(33.2f);
            foreach (var pair in new[] { (StatusKind.Stun, "Status stun"), (StatusKind.Dot, "Status flame"), (StatusKind.Silence, "Status silence"), (StatusKind.AntiHeal, "Status antiheal") })
            {
                Assert.IsTrue(StatusAnchors.TryGet(pair.Item1, OverheadActorKind.Player, out var a));
                var p = Find(pair.Item2).transform.localPosition;
                Assert.AreEqual(OverheadStack.ToUnits(a.X), p.x, 1e-4f, pair.Item2 + " x");
                Assert.AreEqual(feet + OverheadStack.ToUnits(a.Y + a.H * .5f), p.y, 1e-4f, pair.Item2 + " y");
            }
            foreach (Transform c in _go.transform) StringAssert.DoesNotContain("Status plate", c.name, "no badge plates");
        }

        [Test] public void LockRingOnlyWhenLocked()
        {
            var f = Facts(); _ind.Update(f); Assert.IsFalse(Find("Attack lock ring").enabled);
            f.Locked = true; _ind.Update(f); Assert.IsTrue(Find("Attack lock ring").enabled);
        }

        [Test] public void DeadActorsShowNothing()
        {
            var f = Facts(); f.Bounty = 50; f.HasSecondary = true; f.Effects = Indicators.Stunned; f.Locked = true; _ind.Update(f);
            f.Dead = true; _ind.Update(f);
            foreach (var r in _go.GetComponentsInChildren<SpriteRenderer>(true)) Assert.IsFalse(r.enabled, r.name);
        }

        [Test] public void MobNameShowsForMobsOnly()
        {
            var f = Facts(); f.Name = "Ember Imp"; _ind.Update(f); Assert.IsFalse(_go.transform.Find("Name").gameObject.activeSelf);
            f.Mob = true; _ind.Update(f); Assert.IsTrue(_go.transform.Find("Name").gameObject.activeSelf);
        }

        [Test] public void FadeReachesTheText()
        {
            var f = Facts(); f.Bounty = 20; _ind.Update(f);
            _ind.ApplyOpacity(.5f);
            Assert.AreEqual(.5f, _go.transform.Find("Bounty number").GetComponent<TMPro.TextMeshPro>().color.a, .01f);
        }

        [Test] public void PresenterIgnoresUndeliveredActors()
        {
            var parent = new GameObject("parent");
            try
            {
                var p = new SpriteActorPresenter(parent.transform, null);
                p.PresentIndicators(999, 50, true, WeaponId.Axe, true);
                Assert.AreEqual(0, p.ActiveCount); Assert.AreEqual(0, parent.transform.childCount);
            }
            finally { Object.DestroyImmediate(parent); }
        }

        [Test] public void WorldMarksWithoutCollectionsShowNothing()
        {
            var parent = new GameObject("marks");
            try { var m = new WorldMarks(parent.transform); m.Update(null, null); Assert.AreEqual(0, m.Used); }
            finally { Object.DestroyImmediate(parent); }
        }
    }
}
