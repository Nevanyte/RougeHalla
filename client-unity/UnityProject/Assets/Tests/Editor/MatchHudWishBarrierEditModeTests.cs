using System.Reflection;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;
using Roguehalla.Net.Ui;
using Roguehalla.Net.Protocol;
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
        public void ACoolingAbilitySlotShowsTheLegacyReadyInText()
        {
            var me = new SelfView { Hp = 60, MaxHp = 100, Status = ActorStatus.Alive };
            me.Wish = new WishView { Ability = AbilityId.Blaze, Charges = 0, MaxCharges = 2, ReadyAt = 130000, RechargeMs = 4000 };
            Invoke("RefreshOwnerPresentation", me, 5000d);
            StringAssert.Contains(SlotText.ReadyIn(125000), _wish.text);
            StringAssert.Contains("Ready in 2:05", _wish.text);
            Assert.That(_summary.text, Is.EqualTo("0/2 · 2:05"));
        }

        [Test]
        public void ANewMatchOnTheSameSessionDoesNotInheritThePreviousWinner()
        {
            object Field(string n) => typeof(MatchHud).GetField(n, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_hud);
            var ended = new ServerMsg.Events { Tick = 9, List = new System.Collections.Generic.List<WireEvent> { new WireEvent { Kind = EventKind.MatchEnded, Winner = 7 } } };
            Invoke("NoteMatchEnded", ended);
            Assert.That(Field("_matchEnded"), Is.EqualTo(true));
            Assert.That(Field("_winnerId"), Is.EqualTo((uint?)7));
            // The rematch reuses the Session (no Bind); entering InMatch starts a fresh match, which then ends without a MatchEnded event.
            Invoke("NoteSessionState", SessionState.InMatch);
            Assert.That(Field("_matchEnded"), Is.EqualTo(false));
            Assert.That(Field("_winnerId"), Is.Null, "a run that ends with no MatchEnded shows the bare Run over, not the old winner");
        }

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
            Assert.That(_summary.text, Is.EqualTo("1/2 · 1"));
            StringAssert.Contains("Ready in 1", _wish.text);
            StringAssert.Contains("Recharge 4", _wish.text);
            StringAssert.Contains("Next charge in 2", _wish.text);
            StringAssert.Contains("Full charges in 7", _wish.text);
            StringAssert.Contains("Casting Blaze · 2", _wish.text);
            StringAssert.DoesNotContain("5500", _wish.text); StringAssert.DoesNotContain("7000", _wish.text);
            StringAssert.DoesNotContain("12000", _wish.text); StringAssert.DoesNotContain("4500", _wish.text);
            StringAssert.DoesNotContain("6500", _wish.text); StringAssert.DoesNotContain("Opening", _wish.text);
            Assert.That(_health.anchorMax.x, Is.EqualTo(.60f).Within(.001f));
            Assert.That(_barrier.anchorMin.x, Is.EqualTo(.60f).Within(.001f));
            Assert.That(_barrier.anchorMax.x, Is.EqualTo(.85f).Within(.001f));
            Invoke("RefreshOwnerPresentation", me, 5250d);
            StringAssert.Contains("Ready in 1", _wish.text);
            StringAssert.Contains("Next charge in 2", _wish.text);
            StringAssert.Contains("Full charges in 7", _wish.text);
            StringAssert.Contains("Casting Blaze · 2", _wish.text);

            Invoke("RefreshOwnerPresentation", me, 13000d);
            StringAssert.Contains("Ready", _wish.text); StringAssert.DoesNotContain("Ready in", _wish.text);
            StringAssert.DoesNotContain("Next charge in", _wish.text);
            StringAssert.DoesNotContain("Full charges in", _wish.text);
            StringAssert.Contains("Casting Blaze", _wish.text); StringAssert.DoesNotContain("Casting Blaze ·", _wish.text);
            StringAssert.Contains("1/2", _wish.text, "elapsed labels never predict stock");
            Assert.That(_summary.text, Is.EqualTo("1/2"), "elapsed time never predicts summary stock either");

            var stock = me.Wish.Value;
            stock.Charges = 0; me.Wish = stock;
            Invoke("RefreshOwnerPresentation", me, 13010d);
            StringAssert.Contains("0/2", _wish.text);
            Assert.That(_summary.text, Is.EqualTo("0/2"));
            stock.Charges = 2; stock.NextChargeAt = null; stock.FullAt = null; stock.Cast = null;
            me.Wish = stock;
            Invoke("RefreshOwnerPresentation", me, 13020d);
            StringAssert.Contains("2/2", _wish.text);
            StringAssert.DoesNotContain("Casting Blaze", _wish.text);
            StringAssert.DoesNotContain("Next charge in ", _wish.text);
            StringAssert.DoesNotContain("Full charges in ", _wish.text);

            Invoke("RefreshOwnerPresentation", me, 13030d);
            StringAssert.DoesNotContain("Ready in", _wish.text);
            StringAssert.Contains("Recharge 4", _wish.text);

            Invoke("ClearOwnerPresentation", "Awaiting server");
            Assert.That(_stats.text, Is.EqualTo("Awaiting player stats"), "separated stats clear on owner rebind too");
            Assert.That(_summary.text, Is.EqualTo("—"), "a rebind clears the previous owner's stock immediately");
            Invoke("RefreshOwnerPresentation", me, 13030d);
            Assert.That(_summary.text, Is.EqualTo("2/2"));

            me.Wish = null; me.Barrier = 0;
            Invoke("RefreshOwnerPresentation", me, 13040d);
            StringAssert.Contains("None delivered", _wish.text);
            Assert.That(_summary.text, Is.EqualTo("—"));
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

        [Test]
        public void WeaponIconsRetainSemanticTintAcrossSlotChangesAndClearMissingInventory()
        {
            var icons = (UnityEngine.UI.Image[])GetField("_weaponIcons");
            var activeBars = (UnityEngine.UI.Image[])GetField("_weaponActiveBars");
            for (int i = 0; i < 2; i++)
            {
                var iconObject = new GameObject("Weapon icon " + i, typeof(RectTransform), typeof(UnityEngine.UI.Image));
                iconObject.transform.SetParent(_root.transform, false);
                icons[i] = iconObject.GetComponent<UnityEngine.UI.Image>();
                var barObject = new GameObject("Weapon active bar " + i, typeof(RectTransform), typeof(UnityEngine.UI.Image));
                barObject.transform.SetParent(_root.transform, false);
                activeBars[i] = barObject.GetComponent<UnityEngine.UI.Image>();
            }

            RefreshBuildIcons(InventoryView((byte)WeaponId.Sword, (byte)WeaponId.Wand, 0));
            Color swordTint = icons[0].color, wandTint = icons[1].color;
            Sprite swordSprite = icons[0].sprite;
            Assert.That(icons[0].enabled && icons[1].enabled, Is.True);
            Assert.That(swordTint.a, Is.EqualTo(1f).Within(.001f));
            Assert.That(wandTint.a, Is.EqualTo(1f).Within(.001f));
            Assert.That(swordTint, Is.Not.EqualTo(wandTint), "different weapon types keep distinguishable hues");
            Assert.That(activeBars[0].enabled, Is.True);
            Assert.That(activeBars[1].enabled, Is.False);

            RefreshBuildIcons(InventoryView((byte)WeaponId.Sword, (byte)WeaponId.Wand, 1));
            Assert.That(icons[0].color, Is.EqualTo(swordTint));
            Assert.That(icons[1].color, Is.EqualTo(wandTint));
            Assert.That(activeBars[0].enabled, Is.False);
            Assert.That(activeBars[1].enabled, Is.True);

            RefreshBuildIcons(InventoryView((byte)WeaponId.Shield, (byte)WeaponId.Wand, 1));
            Assert.That(icons[0].sprite, Is.Not.SameAs(swordSprite));
            Assert.That(icons[0].color, Is.Not.EqualTo(swordTint), "replacing a weapon updates its semantic tint");
            Assert.That(activeBars[0].enabled, Is.False);
            Assert.That(activeBars[1].enabled, Is.True);

            RefreshBuildIcons(InventoryView(null, null, 0));
            Assert.That(icons[0].enabled, Is.False);
            Assert.That(icons[1].enabled, Is.False);
            Assert.That(activeBars[0].enabled, Is.False);
            Assert.That(activeBars[1].enabled, Is.False);
        }

        CollectionsView InventoryView(byte? slot0, byte? slot1, byte activeSlot)
        {
            var view = new CollectionsView();
            var inventory = new InventoryState
            {
                Value = slot0.HasValue || slot1.HasValue
                    ? new WireInventory { ActiveSlot = activeSlot, Slot0 = slot0, Slot1 = slot1 }
                    : (WireInventory?)null
            };
            typeof(CollectionsView).GetMethod("Apply", BindingFlags.Instance | BindingFlags.NonPublic)
                .Invoke(view, new object[] { new ServerMsg.State { Items = new StateItem[] { inventory } } });
            return view;
        }

        void RefreshBuildIcons(CollectionsView view) => typeof(MatchHud).GetMethod("RefreshBuildIcons", BindingFlags.Instance | BindingFlags.NonPublic)
            .Invoke(_hud, new object[] { view });

        object GetField(string name) => typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_hud);

        void SetField(string name, object value) => typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(_hud, value);
        void Invoke(string name, params object[] args) => typeof(MatchHud).GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_hud, args);
    }
}
