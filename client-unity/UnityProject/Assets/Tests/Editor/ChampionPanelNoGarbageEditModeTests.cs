using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.RegularExpressions;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using TMPro;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>P-UNITY-HUD-BUILD-3 follow-up: the Wish row and the weapon slots run every frame; with unchanged inputs they allocate nothing.</summary>
    public sealed class ChampionPanelNoGarbageEditModeTests
    {
        GameObject _canvas, _hudOwner, _settingsObject;
        MatchHud _hud; ShowcaseSettings _settings; float _savedScale; Action _applyTextScale; UiTheme _savedTheme;

        [SetUp]
        public void SetUp()
        {
            _savedTheme = UiTheme.Current;
            UiTheme.Current = UiTheme.Placeholder();
            _settings = ShowcaseSettings.Current;
            if (_settings == null)
            {
                _settingsObject = new GameObject("panel numbers settings");
                _settings = _settingsObject.AddComponent<ShowcaseSettings>();
                typeof(ShowcaseSettings).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_settings, null);
            }
            _savedScale = (float)typeof(ShowcaseSettings).GetField("_textScale", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_settings);
            SetScale(1f);
            _canvas = new GameObject("panel numbers canvas", typeof(RectTransform), typeof(Canvas));
            _hudOwner = new GameObject("panel numbers hud owner");
            _hud = _hudOwner.AddComponent<MatchHud>();
            Set("_root", _canvas.GetComponent<RectTransform>());
            Set("_showcaseSettings", _settings);
            _applyTextScale = (Action)Delegate.CreateDelegate(typeof(Action), _hud, typeof(MatchHud).GetMethod("ApplyTextScale", BindingFlags.Instance | BindingFlags.NonPublic));
            _settings.Changed += _applyTextScale;
            Call("EnsureStage"); Call("CreateTopAndToastPills"); Call("CreateLegacyChrome"); Call("CreateCombatHud");
            Call("SetPlateMode", true);
        }

        [TearDown]
        public void TearDown()
        {
            if (_settings != null) { _settings.Changed -= _applyTextScale; SetScale(_savedScale); }
            if (_canvas != null) UnityEngine.Object.DestroyImmediate(_canvas);
            if (_hudOwner != null) UnityEngine.Object.DestroyImmediate(_hudOwner);
            if (_settingsObject != null) UnityEngine.Object.DestroyImmediate(_settingsObject);
            UiTheme.Current = _savedTheme;
        }


        static byte[] Server(string name)
        {
            string dir = TestContext.CurrentContext.TestDirectory;
            var d = new DirectoryInfo(Application.dataPath);
            while (d != null && !File.Exists(System.IO.Path.Combine(d.FullName, "protocol", "fixtures", "v17.json"))) d = d.Parent;
            Assert.That(d, Is.Not.Null, "protocol/fixtures/v17.json above " + Application.dataPath + " (" + dir + ")");
            var m = Regex.Match(File.ReadAllText(System.IO.Path.Combine(d.FullName, "protocol", "fixtures", "v17.json")),
                "\"name\": \"" + Regex.Escape(name) + "\", \"hex\": \"([0-9a-f]+)\"");
            if (m.Success)
            {
                string hex = m.Groups[1].Value;
                return Enumerable.Range(0, hex.Length / 2).Select(i => Convert.ToByte(hex.Substring(i * 2, 2), 16)).ToArray();
            }
            throw new InvalidOperationException("no server vector " + name);
        }

        static WireHudContent Hud() { return ((ServerMsg.Welcome)ServerMsg.Decode(Server("welcome"))).Hud; }
        static WireBuildSummary Summary() { return ((BuildSummaryState)((ServerMsg.State)ServerMsg.Decode(Server("state_build_summary_panel_tooltip"))).Items[0]).Value; }

        [Test]
        public void TheWishRowAndTheSlotsAllocateNothingWhileTheirInputsStay()
        {
            _hud.HudContent = Hud();
            var me = new SelfView { Faction = FactionId.Holy, Weapon = WeaponId.Wand, Status = ActorStatus.Alive, Hp = 100, MaxHp = 100 };
            me.Wish = new WishView { Ability = AbilityId.Freeze, Charges = 1, MaxCharges = 1 };
            var view = new CollectionsView();
            typeof(CollectionsView).GetMethod("Apply", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, new object[] {
                new ServerMsg.State { Items = new StateItem[] { new InventoryState { Value = new WireInventory { ActiveSlot = 0, Slot0 = (byte)WeaponId.Wand, Slot1 = (byte)WeaponId.Axe } } } } });
            var wish = (Action<SelfView>)Delegate.CreateDelegate(typeof(Action<SelfView>), _hud, typeof(MatchHud).GetMethod("ApplyWishRow", BindingFlags.Instance | BindingFlags.NonPublic));
            var hints = (Action<InventoryView?>)Delegate.CreateDelegate(typeof(Action<InventoryView?>), _hud, typeof(MatchHud).GetMethod("UpdateInventoryHints", BindingFlags.Instance | BindingFlags.NonPublic));
            var inventory = view.Inventory;
            for (int i = 0; i < 5; i++) { wish(me); hints(inventory); }      // warm up
            long before = GC.GetAllocatedBytesForCurrentThread();
            for (int i = 0; i < 200; i++) { wish(me); hints(inventory); }
            long grown = GC.GetAllocatedBytesForCurrentThread() - before;
            Assert.That(grown, Is.LessThanOrEqualTo(0), "200 frames with unchanged inputs allocated " + grown + " bytes");
            // A changed input still redraws.
            me.Faction = FactionId.Frost; wish(me);
            Assert.That(((TMP_Text[])typeof(MatchHud).GetField("_championLabel", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_hud))[2].text, Is.EqualTo("Freeze"));
        }

        void Set(string name, object value) { typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(_hud, value); }
        void Call(string name, params object[] args) { typeof(MatchHud).GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_hud, args.Length == 0 ? null : args); }
        static void SetScale(ShowcaseSettings s, float v) { typeof(ShowcaseSettings).GetField("_textScale", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(s, v); }
        void SetScale(float v) { SetScale(_settings, v); }
    }
}
