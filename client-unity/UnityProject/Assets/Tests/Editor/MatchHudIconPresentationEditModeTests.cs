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
        public void ChampionHudSitsBottomLeftAndOwnerLossClearsWeaponAndUnavailableValues()
        {
            var vitals = (RectTransform)GetField("_vitalsPanel");
            var champion = (RectTransform)GetField("_damagePanel");
            Assert.That(vitals.anchorMin, Is.EqualTo(new Vector2(0, 1)), "legacy: the HUD plate is top-left");
            Assert.That(champion.anchorMin, Is.EqualTo(Vector2.zero), "legacy: the champion combat HUD is bottom-left");

            var me = new SelfView { Hp = 70, MaxHp = 100, Weapon = WeaponId.Bow, Status = ActorStatus.Alive };
            Invoke("RefreshOwnerPresentation", me, 1000d);
            Assert.That(((TMP_Text)GetField("_damageWeapon")).text, Is.EqualTo("Bow"));
            Assert.That(((TMP_Text)GetField("_damageHit")).text, Is.EqualTo("—"), "no combat projection is delivered yet");
            Assert.That(((TMP_Text)GetField("_damageRate")).text, Is.EqualTo(""), "no developer wording on the HUD: with nothing delivered the line is empty");

            Invoke("ClearOwnerPresentation", "Awaiting server");
            Assert.That(((TMP_Text)GetField("_damageWeapon")).text, Is.EqualTo("—"), "the previous owner's weapon is removed");
            Assert.That(((TMP_Text)GetField("_damageHit")).text, Is.EqualTo("—"));
        }

        [Test]
        public void ChampionPanelDrawsTheFormattersRowsAndHidesThemBeforeTheFirstSummary()
        {
            var me = new SelfView { Hp = 70, MaxHp = 100, Weapon = WeaponId.Sword, Faction = FactionId.Holy, Status = ActorStatus.Alive };
            var rows = (RectTransform[])GetField("_championRow");
            Invoke("ApplyChampionRows", null, me);
            Assert.That(rows[0].gameObject.activeSelf, Is.False, "no summary yet: the champion rows are hidden");
            Assert.That(rows[1].gameObject.activeSelf, Is.False);

            var summary = new WireBuildSummary
            {
                Panel = new[]
                {
                    new WirePanelValue { Code = 0, Value = 20000 }, new WirePanelValue { Code = 1, Value = 0 },
                    new WirePanelValue { Code = 2, Value = 0 }, new WirePanelValue { Code = 3, Value = 5000 },
                    new WirePanelValue { Code = 20, Value = 700 }, new WirePanelValue { Code = 21, Value = 0 },
                    new WirePanelValue { Code = 22, Value = 0 },
                },
            };
            Invoke("ApplyChampionRows", summary, me);
            var expected = Roguehalla.Net.Ui.ChampionPanelText.Rows(summary, me.Faction, me.Weapon);
            var values = (TMP_Text[])GetField("_championValue");
            var scaling = (TMP_Text[])GetField("_championScaling");
            Assert.That(rows[0].gameObject.activeSelf, Is.True);
            Assert.That(values[0].text, Is.EqualTo(expected.Auto.Value).And.EqualTo("20 / hit · 0.5/s"));
            Assert.That(values[1].text, Is.EqualTo(expected.Passive.Value).And.EqualTo("7% life steal"));
            Assert.That(scaling[1].text, Is.EqualTo(expected.Passive.Scaling));
            Assert.That(((HudIconHint)GetField("_damageHint")).Text, Does.Contain(expected.Auto.Detail));
        }

        [Test]
        public void WishSummaryStaysCompactWhileFullDeliveredDescriptionRemainsFocusedAndDismissible()
        {
            var details = (RectTransform)GetField("_wishDetails");
            var summary = (TMP_Text)GetField("_wishSummary");
            var hint = (HudIconHint)GetField("_wishHint");
            var wishButton = _root.transform.Find("HudStage/PlayerHUD/CombatActions/WishTile").GetComponent<Button>();
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

            Assert.That(summary.text, Is.EqualTo("1/2 · 1"));
            StringAssert.Contains("Blaze", hint.Text);
            StringAssert.Contains("Next charge in 2", hint.Text);
            StringAssert.Contains("Casting Blaze · 2", hint.Text);
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
            ((RectTransform)GetField("_hud")).gameObject.SetActive(false);
            hint.OnSelect(eventData);
            Assert.That(hint.IsVisible, Is.False, "a hidden HUD owner cannot reveal its stale hint");
        }

        object GetField(string name) => typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_hud);
        void SetField(string name, object value) => typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(_hud, value);
        void Invoke(string name, params object[] args) => typeof(MatchHud).GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_hud, args);
    }
}
