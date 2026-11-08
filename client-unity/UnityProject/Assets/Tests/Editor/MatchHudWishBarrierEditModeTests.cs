using System.Reflection;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;
using TMPro;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    public sealed class MatchHudWishBarrierEditModeTests
    {
        GameObject _root;
        MatchHud _hud;
        TMP_Text _vitals, _wish;
        RectTransform _health, _barrier;

        [SetUp]
        public void SetUp()
        {
            _root = new GameObject("HUD test root");
            _hud = _root.AddComponent<MatchHud>();
            _vitals = new GameObject("Vitals", typeof(RectTransform), typeof(TextMeshProUGUI)).GetComponent<TextMeshProUGUI>();
            _wish = new GameObject("Wish", typeof(RectTransform), typeof(TextMeshProUGUI)).GetComponent<TextMeshProUGUI>();
            _health = new GameObject("Health fill", typeof(RectTransform)).GetComponent<RectTransform>();
            _barrier = new GameObject("Barrier fill", typeof(RectTransform)).GetComponent<RectTransform>();
            _vitals.transform.SetParent(_root.transform, false); _wish.transform.SetParent(_root.transform, false);
            _health.SetParent(_root.transform, false); _barrier.SetParent(_root.transform, false);
            SetField("_vitals", _vitals); SetField("_wishCard", _wish);
            SetField("_healthBarFill", _health); SetField("_barrierBarFill", _barrier);
        }

        [TearDown]
        public void TearDown() { Object.DestroyImmediate(_root); }

        [Test]
        public void OwnerFactsRenderAndClearAcrossWishAndSessionResetTransitions()
        {
            var me = new SelfView { Hp = 60, MaxHp = 100, Barrier = 25, BarrierRingStep = 5, Kills = 2, Gv = 4, Status = ActorStatus.Alive };
            me.Wish = new WishView {
                Ability = AbilityId.Blaze, Charges = 1, MaxCharges = 2, ReadyAt = 5000,
                FullAt = 12000, NextChargeAt = 7000, RechargeMs = 4000,
                Cast = new WishCastView { Ability = AbilityId.Blaze, StartedAt = 2000, LandsAt = 3000 }
            };

            Invoke("RefreshOwnerPresentation", me, 2500d);
            StringAssert.Contains("Barrier 25", _vitals.text);
            StringAssert.Contains("ring 5/8", _vitals.text);
            StringAssert.Contains("Blaze", _wish.text); StringAssert.Contains("1/2", _wish.text);
            StringAssert.Contains("next 7000", _wish.text); StringAssert.Contains("Cast Blaze", _wish.text);
            StringAssert.Contains("(in 500 ms)", _wish.text);
            Assert.That(_health.anchorMax.x, Is.EqualTo(.60f).Within(.001f));
            Assert.That(_barrier.anchorMin.x, Is.EqualTo(.60f).Within(.001f));
            Assert.That(_barrier.anchorMax.x, Is.EqualTo(.85f).Within(.001f));
            Invoke("RefreshOwnerPresentation", me, 2700d);
            StringAssert.Contains("(in 300 ms)", _wish.text);

            var stock = me.Wish.Value;
            stock.Charges = 0; me.Wish = stock;
            Invoke("RefreshOwnerPresentation", me, 3000d);
            StringAssert.Contains("0/2", _wish.text);
            stock.Charges = 2; stock.NextChargeAt = null; stock.FullAt = null; stock.Cast = null;
            me.Wish = stock;
            Invoke("RefreshOwnerPresentation", me, 6000d);
            StringAssert.Contains("2/2", _wish.text);
            StringAssert.DoesNotContain("Cast Blaze", _wish.text);
            StringAssert.DoesNotContain("next 7000", _wish.text);

            me.Wish = null; me.Barrier = 0;
            Invoke("RefreshOwnerPresentation", me, 4000d);
            StringAssert.Contains("None delivered", _wish.text);
            StringAssert.Contains("Barrier 0", _vitals.text);
            Assert.That(_barrier.anchorMax.x, Is.EqualTo(_barrier.anchorMin.x).Within(.001f));

            Invoke("ClearOwnerPresentation", "Awaiting server");
            StringAssert.Contains("Awaiting server", _wish.text);
            Assert.That(_health.anchorMax.x, Is.Zero);
            Assert.That(_barrier.anchorMax.x, Is.Zero);
        }

        [Test]
        public void OwnerVitalPercentagesPreserveDeliveredSharesAndHandleInvalidInput()
        {
            OwnerVitalBars.Percent(null, out float h0, out float b0);
            Assert.That(h0, Is.Zero); Assert.That(b0, Is.Zero);
            OwnerVitalBars.Percent(new SelfView { Hp = 80, MaxHp = 100, Barrier = 25 }, out float hp, out float barrier);
            Assert.That(hp, Is.EqualTo(100f * 80f / 105f).Within(.001f));
            Assert.That(barrier, Is.EqualTo(100f * 25f / 105f).Within(.001f));
            OwnerVitalBars.Percent(new SelfView { Hp = float.NaN, MaxHp = 100, Barrier = 20 }, out hp, out barrier);
            Assert.That(hp, Is.Zero); Assert.That(barrier, Is.Zero);
        }

        void SetField(string name, object value) => typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(_hud, value);
        void Invoke(string name, params object[] args) => typeof(MatchHud).GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_hud, args);
    }
}
