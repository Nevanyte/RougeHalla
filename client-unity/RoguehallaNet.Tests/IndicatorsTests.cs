using NUnit.Framework;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    public class IndicatorsTests
    {
        [Test] public void HpToneThresholds()
        {
            Assert.AreEqual(HpTone.Green, Indicators.Tone(100)); Assert.AreEqual(HpTone.Green, Indicators.Tone(51));
            Assert.AreEqual(HpTone.Amber, Indicators.Tone(50)); Assert.AreEqual(HpTone.Amber, Indicators.Tone(26));
            Assert.AreEqual(HpTone.Red, Indicators.Tone(25)); Assert.AreEqual(HpTone.Red, Indicators.Tone(0));
        }
        [Test] public void MobBarRule()
        {
            Assert.IsFalse(Indicators.MobBarVisible(false, false, 100, false)); Assert.IsTrue(Indicators.MobBarVisible(false, false, 99, false));
            Assert.IsTrue(Indicators.MobBarVisible(true, false, 100, false)); Assert.IsTrue(Indicators.MobBarVisible(false, true, 100, false));
            Assert.IsFalse(Indicators.MobBarVisible(true, false, 50, true));
            Assert.AreEqual(.5f, Indicators.MobLabelAlpha(false, false, 100)); Assert.AreEqual(1f, Indicators.MobLabelAlpha(false, false, 80));
        }
        [Test] public void CrownScaleAndVisibility()
        {
            Assert.AreEqual(1f, Indicators.CrownScale(0)); Assert.AreEqual(1.25f, Indicators.CrownScale(75), 1e-5); Assert.AreEqual(1.5f, Indicators.CrownScale(900));
            Assert.IsTrue(Indicators.CrownVisible(1, true)); Assert.IsFalse(Indicators.CrownVisible(0, true)); Assert.IsFalse(Indicators.CrownVisible(50, false));
        }
        [Test] public void SecondaryWeaponIsTheOtherSlotOrFists()
        {
            Assert.IsNull(Indicators.SecondaryWeapon(false, 0, null, null));
            Assert.AreEqual(WeaponId.Bow, Indicators.SecondaryWeapon(true, 0, WeaponId.Sword, WeaponId.Bow));
            Assert.AreEqual(WeaponId.Sword, Indicators.SecondaryWeapon(true, 1, WeaponId.Sword, WeaponId.Bow));
            Assert.AreEqual(WeaponId.Fists, Indicators.SecondaryWeapon(true, 0, WeaponId.Sword, null));
            Assert.AreEqual(WeaponId.Fists, Indicators.SecondaryWeapon(true, 1, null, WeaponId.Axe));
        }
        [Test] public void StatusLayersAreInLegacyDrawOrder()
        {
            var buf = new Indicators.StatusLayer[16];
            int n = Indicators.StatusLayers(Indicators.Stunned | Indicators.Rooted | Indicators.Dot | Indicators.Hidden | 0x8000, buf);
            Assert.AreEqual(3, n);
            Assert.AreEqual(Indicators.Rooted, buf[0].Bit); Assert.AreEqual(Indicators.Dot, buf[1].Bit); Assert.AreEqual(Indicators.Stunned, buf[2].Bit);
            Assert.AreEqual(Indicators.Plane.Head, buf[2].Plane);
            Assert.AreEqual(0, Indicators.StatusLayers(0, buf));
            Assert.AreEqual(12, Indicators.StatusOrder.Length);
        }
        [Test] public void HiddenFighterRule()
        {
            Assert.AreEqual(0f, Indicators.HiddenAlpha(Indicators.Hidden, false)); Assert.AreEqual(.45f, Indicators.HiddenAlpha(Indicators.Hidden, true));
            Assert.AreEqual(1f, Indicators.HiddenAlpha(0, false));
        }
        [Test] public void DamageNumberStyle()
        {
            Assert.AreEqual(Indicators.DamageTone.OnMe, Indicators.DamageColour(5, 6, 5)); Assert.AreEqual(Indicators.DamageTone.ByMe, Indicators.DamageColour(7, 5, 5));
            Assert.AreEqual(Indicators.DamageTone.Others, Indicators.DamageColour(7, 8, 5)); Assert.AreEqual(Indicators.DamageTone.Others, Indicators.DamageColour(0, 0, 0));
            Assert.AreEqual(13, Indicators.DamageSize(10)); Assert.AreEqual(14, Indicators.DamageSize(40)); Assert.AreEqual(20, Indicators.DamageSize(9999));
            Assert.AreEqual(-18f, Indicators.DamageLaneOffset(0)); Assert.AreEqual(0f, Indicators.DamageLaneOffset(2)); Assert.AreEqual(-18f, Indicators.DamageLaneOffset(5));
        }
        [Test] public void HurtFlashMatchesLegacy()
        {
            Assert.AreEqual(0f, Indicators.HurtFlash(1, 100)); Assert.AreEqual(.25f, Indicators.HurtFlash(2, 100), 1e-5);
            Assert.AreEqual(1f, Indicators.HurtFlash(25, 100)); Assert.AreEqual(0f, Indicators.HurtFlash(10, 0));
        }
        [Test] public void QuestMarks() { Assert.AreEqual('!', Indicators.QuestMark(false)); Assert.AreEqual('?', Indicators.QuestMark(true)); }
        [Test] public void OverheadClusterStacksWithoutOverlapAndCompacts()
        {
            var full = OverheadLayout.Compute(true, true, 1.25f, true);
            Assert.Less(full.BarY, full.NameY); Assert.Less(full.NameY, full.CrownY); Assert.Less(full.CrownY, full.NumberY); Assert.Less(full.NumberY, full.RowY);
            Assert.GreaterOrEqual(full.NameY, full.BarY + OverheadLayout.BarH);
            Assert.GreaterOrEqual(full.RowY, full.NumberY + OverheadLayout.NumberH);
            var noName = OverheadLayout.Compute(false, true, 1f, true);
            Assert.Less(noName.RowY, full.RowY, "an absent name gives its room back");
            var barOnly = OverheadLayout.Compute(false, false, 1f, false);
            Assert.AreEqual(barOnly.TopY, OverheadLayout.Compute(false, false, 1f, false).TopY);
            Assert.Greater(OverheadLayout.Compute(false, false, 1f, true).RowY, barOnly.BarY);
        }
    }
}
