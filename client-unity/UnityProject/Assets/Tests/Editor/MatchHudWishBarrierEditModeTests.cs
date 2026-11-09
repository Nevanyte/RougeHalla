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
        TMP_Text _vitals, _wish, _summary, _stats;
        RectTransform _health, _barrier;

        [SetUp]
        public void SetUp()
        {
            _root = new GameObject("HUD test root");
            _hud = _root.AddComponent<MatchHud>();
            _vitals = new GameObject("Vitals", typeof(RectTransform), typeof(TextMeshProUGUI)).GetComponent<TextMeshProUGUI>();
            _wish = new GameObject("Wish", typeof(RectTransform), typeof(TextMeshProUGUI)).GetComponent<TextMeshProUGUI>();
            _summary = new GameObject("Wish summary", typeof(RectTransform), typeof(TextMeshProUGUI)).GetComponent<TextMeshProUGUI>();
            _stats = new GameObject("Combat stats", typeof(RectTransform), typeof(TextMeshProUGUI)).GetComponent<TextMeshProUGUI>();
            _health = new GameObject("Health fill", typeof(RectTransform)).GetComponent<RectTransform>();
            _barrier = new GameObject("Barrier fill", typeof(RectTransform)).GetComponent<RectTransform>();
            _vitals.transform.SetParent(_root.transform, false); _wish.transform.SetParent(_root.transform, false);
            _summary.transform.SetParent(_root.transform, false);
            _stats.transform.SetParent(_root.transform, false);
            _health.SetParent(_root.transform, false); _barrier.SetParent(_root.transform, false);
            SetField("_vitals", _vitals); SetField("_wishCard", _wish);
            SetField("_wishSummary", _summary);
            SetField("_combatStats", _stats);
            SetField("_healthBarFill", _health); SetField("_barrierBarFill", _barrier);
        }

        [TearDown]
        public void TearDown() { Object.DestroyImmediate(_root); }

        [Test]
        public void OwnerFactsRenderAndClearAcrossWishAndSessionResetTransitions()
        {
            var me = new SelfView { Hp = 60, MaxHp = 100, Barrier = 25, BarrierRingStep = 5, Kills = 2, Gv = 4, Status = ActorStatus.Alive };
            me.Wish = new WishView {
                Ability = AbilityId.Blaze, Charges = 1, MaxCharges = 2, ReadyAt = 5500,
                FullAt = 12000, NextChargeAt = 7000, RechargeMs = 4000,
                Cast = new WishCastView { Ability = AbilityId.Blaze, StartedAt = 4500, LandsAt = 6500 }
            };

            Invoke("RefreshOwnerPresentation", me, 5000d);
            StringAssert.Contains("Barrier 25", _vitals.text);
            StringAssert.DoesNotContain("ring", _vitals.text);
            StringAssert.DoesNotContain("Kills", _vitals.text);
            StringAssert.Contains("Kills 2 · GV 4", _stats.text);
            StringAssert.Contains("Blaze", _wish.text); StringAssert.Contains("1/2", _wish.text);
            Assert.That(_summary.text, Is.EqualTo("R · WISH · 1/2"));
            StringAssert.Contains("Wish timer: 0.5s", _wish.text);
            StringAssert.Contains("Recharge 4.0s", _wish.text);
            StringAssert.Contains("Next charge in 2.0s", _wish.text);
            StringAssert.Contains("Full charges in 7.0s", _wish.text);
            StringAssert.Contains("Casting Blaze · 1.5s", _wish.text);
            StringAssert.DoesNotContain("5500", _wish.text); StringAssert.DoesNotContain("7000", _wish.text);
            StringAssert.DoesNotContain("12000", _wish.text); StringAssert.DoesNotContain("4500", _wish.text);
            StringAssert.DoesNotContain("6500", _wish.text); StringAssert.DoesNotContain("Opening", _wish.text);
            Assert.That(_health.anchorMax.x, Is.EqualTo(.60f).Within(.001f));
            Assert.That(_barrier.anchorMin.x, Is.EqualTo(.60f).Within(.001f));
            Assert.That(_barrier.anchorMax.x, Is.EqualTo(.85f).Within(.001f));
            Invoke("RefreshOwnerPresentation", me, 5250d);
            StringAssert.Contains("Wish timer: 0.3s", _wish.text);
            StringAssert.Contains("Next charge in 1.8s", _wish.text);
            StringAssert.Contains("Full charges in 6.8s", _wish.text);
            StringAssert.Contains("Casting Blaze · 1.3s", _wish.text);

            Invoke("RefreshOwnerPresentation", me, 13000d);
            StringAssert.Contains("Wish timer: 0.0s", _wish.text);
            StringAssert.Contains("Next charge in 0.0s", _wish.text);
            StringAssert.Contains("Full charges in 0.0s", _wish.text);
            StringAssert.Contains("Casting Blaze · 0.0s", _wish.text);
            StringAssert.Contains("1/2", _wish.text, "elapsed labels never predict stock");
            Assert.That(_summary.text, Is.EqualTo("R · WISH · 1/2"), "elapsed time never predicts summary stock either");

            var stock = me.Wish.Value;
            stock.Charges = 0; me.Wish = stock;
            Invoke("RefreshOwnerPresentation", me, 13010d);
            StringAssert.Contains("0/2", _wish.text);
            Assert.That(_summary.text, Is.EqualTo("R · WISH · 0/2"));
            stock.Charges = 2; stock.NextChargeAt = null; stock.FullAt = null; stock.Cast = null;
            me.Wish = stock;
            Invoke("RefreshOwnerPresentation", me, 13020d);
            StringAssert.Contains("2/2", _wish.text);
            StringAssert.DoesNotContain("Casting Blaze", _wish.text);
            StringAssert.DoesNotContain("Next charge in ", _wish.text);
            StringAssert.DoesNotContain("Full charges in ", _wish.text);

            Invoke("RefreshOwnerPresentation", me, 13030d);
            StringAssert.Contains("Wish timer: 0.0s", _wish.text);
            StringAssert.Contains("Recharge 4.0s", _wish.text);

            Invoke("ClearOwnerPresentation", "Awaiting server");
            Assert.That(_stats.text, Is.EqualTo("Awaiting player stats"), "separated stats clear on owner rebind too");
            Assert.That(_summary.text, Is.EqualTo("R · WISH · —"), "a rebind clears the previous owner's stock immediately");
            Invoke("RefreshOwnerPresentation", me, 13030d);
            Assert.That(_summary.text, Is.EqualTo("R · WISH · 2/2"));

            me.Wish = null; me.Barrier = 0;
            Invoke("RefreshOwnerPresentation", me, 13040d);
            StringAssert.Contains("None delivered", _wish.text);
            Assert.That(_summary.text, Is.EqualTo("R · WISH · —"));
            StringAssert.Contains("Barrier 0", _vitals.text);
            StringAssert.DoesNotContain("ring", _vitals.text);
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
