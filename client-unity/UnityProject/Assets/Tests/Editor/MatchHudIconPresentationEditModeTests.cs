using System.Reflection;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace Roguehalla.Client.Tests
{
    public sealed class MatchHudIconPresentationEditModeTests
    {
        GameObject _root;
        MatchHud _hud;
        ShowcaseSettings _settings;

        [SetUp]
        public void SetUp()
        {
            _root = new GameObject("HUD icon presentation test", typeof(RectTransform), typeof(Canvas),
                typeof(CanvasScaler), typeof(GraphicRaycaster));
            _root.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
            _root.GetComponent<RectTransform>().sizeDelta = new Vector2(1920, 1080);
            var hudObject = new GameObject("MatchHud", typeof(RectTransform));
            hudObject.transform.SetParent(_root.transform, false);
            var hudRect = (RectTransform)hudObject.transform;
            hudRect.anchorMin = Vector2.zero; hudRect.anchorMax = Vector2.one;
            hudRect.offsetMin = hudRect.offsetMax = Vector2.zero;
            _hud = hudObject.AddComponent<MatchHud>();

            _settings = ShowcaseSettings.Current;
            if (_settings == null)
            {
                _settings = _root.AddComponent<ShowcaseSettings>();
                // EditMode does not need persisted preferences or an Awake side effect for layout.
                typeof(ShowcaseSettings).GetField("_textScale", BindingFlags.Instance | BindingFlags.NonPublic)
                    .SetValue(_settings, 1f);
            }
            SetField("_root", _root.GetComponent<RectTransform>());
            SetField("_hud", hudRect);
            SetField("_showcaseSettings", _settings);
            Invoke("CreateCombatHud");
        }

        [TearDown]
        public void TearDown()
        {
            if (_root != null) Object.DestroyImmediate(_root);
            _root = null;
            _hud = null;
            _settings = null;
        }

        [Test]
        public void VitalsAndDamagePanelsShareWidthAndOwnerLossClearsWeaponAndUnavailableValues()
        {
            var vitals = (RectTransform)GetField("_vitalsPanel");
            var damage = (RectTransform)GetField("_damagePanel");
            Assert.That(vitals.anchorMin.x, Is.EqualTo(damage.anchorMin.x).Within(.0001f));
            Assert.That(vitals.anchorMax.x, Is.EqualTo(damage.anchorMax.x).Within(.0001f));
            Assert.That(vitals.anchorMax.y - vitals.anchorMin.y,
                Is.EqualTo(damage.anchorMax.y - damage.anchorMin.y).Within(.0001f), "the stacked panels have matching height");
            Assert.That(vitals.anchorMin.y, Is.GreaterThan(damage.anchorMax.y), "health panel sits above damage output");

            var me = new SelfView { Hp = 70, MaxHp = 100, Weapon = WeaponId.Bow, Status = ActorStatus.Alive };
            Invoke("RefreshOwnerPresentation", me, 1000d);
            Assert.That(((TMP_Text)GetField("_damageWeapon")).text, Is.EqualTo("Bow"));
            Assert.That(((TMP_Text)GetField("_damageHit")).text, Is.EqualTo("— /hit"));
            Assert.That(((TMP_Text)GetField("_damageRate")).text, Is.EqualTo("— /s"));

            Invoke("ClearOwnerPresentation", "Awaiting server");
            Assert.That(((TMP_Text)GetField("_damageWeapon")).text, Is.EqualTo("—"), "the previous owner's weapon is removed");
            Assert.That(((TMP_Text)GetField("_damageHit")).text, Is.EqualTo("— /hit"));
            Assert.That(((TMP_Text)GetField("_damageRate")).text, Is.EqualTo("— /s"));
        }

        [Test]
        public void WishSummaryStaysCompactWhileFullDeliveredDescriptionRemainsFocusedAndDismissible()
        {
            var details = (RectTransform)GetField("_wishDetails");
            var summary = (TMP_Text)GetField("_wishSummary");
            var hint = (HudIconHint)GetField("_wishHint");
            var wishButton = _root.transform.Find("MatchHud/PlayerHUD/CombatActions/WishInfo").GetComponent<Button>();
            var wishImage = wishButton.transform.Find("WishIcon").GetComponent<Image>();
            Assert.That(wishImage.enabled && wishImage.sprite != null, Is.True, "wish action has a visible semantic icon");
            Assert.That(details.gameObject.activeSelf, Is.False, "the permanent top-right Wish paragraph is inactive");

            var me = new SelfView { Hp = 90, MaxHp = 100, Status = ActorStatus.Alive };
            me.Wish = new WishView
            {
                Ability = AbilityId.Blaze, Charges = 1, MaxCharges = 2, ReadyAt = 5500,
                FullAt = 12000, NextChargeAt = 7000, RechargeMs = 4000,
                Cast = new WishCastView { Ability = AbilityId.Blaze, StartedAt = 4500, LandsAt = 6500 }
            };
            Invoke("RefreshOwnerPresentation", me, 5000d);

            Assert.That(summary.text, Is.EqualTo("R · 1/2 · 0.5s"));
            StringAssert.Contains("Blaze", hint.Text);
            StringAssert.Contains("Next charge in 2.0s", hint.Text);
            StringAssert.Contains("Casting Blaze · 1.5s", hint.Text);
            Assert.That(details.gameObject.activeSelf, Is.False);

            var eventData = new BaseEventData(EventSystem.current);
            ExecuteEvents.Execute(wishButton.gameObject, eventData, ExecuteEvents.selectHandler);
            Assert.That(hint.IsVisible, Is.True, "keyboard focus exposes the detailed hint");
            ExecuteEvents.Execute(wishButton.gameObject, eventData, ExecuteEvents.deselectHandler);
            Assert.That(hint.IsVisible, Is.False, "losing focus dismisses the hint");

            var pointer = new PointerEventData(EventSystem.current);
            ExecuteEvents.Execute(wishButton.gameObject, pointer, ExecuteEvents.pointerEnterHandler);
            Assert.That(hint.IsVisible, Is.True, "hover exposes the same detailed hint");
            ExecuteEvents.Execute(wishButton.gameObject, pointer, ExecuteEvents.pointerExitHandler);
            Assert.That(hint.IsVisible, Is.False, "leaving the icon dismisses the hint");
            ExecuteEvents.Execute(wishButton.gameObject, eventData, ExecuteEvents.selectHandler);
            Assert.That(hint.IsVisible, Is.True);
            HudIconHint.CloseAll();
            Assert.That(hint.IsVisible, Is.False, "modal/focus cleanup dismisses the hint");
            _hud.gameObject.SetActive(false);
            hint.OnSelect(eventData);
            Assert.That(hint.IsVisible, Is.False, "a hidden HUD owner cannot reveal its stale hint");
        }

        object GetField(string name) => typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_hud);
        void SetField(string name, object value) => typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(_hud, value);
        void Invoke(string name, params object[] args) => typeof(MatchHud).GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_hud, args);
    }
}
