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
    /// <summary>
    /// P-UNITY-HUD-BUILD-3: the champion panel and the weapon slots draw the texts of <see cref="HudContentText"/> from the Welcome HUD block
    /// (<c>MatchHud.HudContent</c>) and the owner panel; the longer lines fit their boxes after <c>MatchHud.ApplyTextScale</c> at text scales 1 and 1.5 at the
    /// 1280x720 and 1920x1080 stages. Expected strings are the HudContentTextTests ones (legacy championCombatModel.ts, buildModel.ts, weaponBar.ts).
    /// A label fits as in HudTextScaleEditModeTests: the widest line needs at most 88 percent of the box width and the text fits the box height.
    /// </summary>
    public sealed class ChampionPanelNumbersEditModeTests
    {
        static readonly Vector2[] Stages = { new Vector2(1280, 720), new Vector2(1920, 1080) };
        const float WidthShare = .88f;

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

        // ---- data: the committed v17 vectors

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

        static SelfView Me(FactionId faction, WeaponId weapon) { return new SelfView { Faction = faction, Weapon = weapon, Status = ActorStatus.Alive, Hp = 100, MaxHp = 100 }; }

        static CollectionsView Inventory(byte? slot0, byte? slot1)
        {
            var view = new CollectionsView();
            typeof(CollectionsView).GetMethod("Apply", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, new object[] {
                new ServerMsg.State { Items = new StateItem[] { new InventoryState { Value = new WireInventory { ActiveSlot = 0, Slot0 = slot0, Slot1 = slot1 } } } } });
            return view;
        }

        // ---- the auto row and its tooltip

        [Test]
        public void TheAutoRowDrawsTheWeaponScalingLineAndTheTooltipCarriesTheNumbers()
        {
            _hud.HudContent = Hud();
            var me = Me(FactionId.Fire, WeaponId.Wand);
            Call("ApplyChampionRows", Summary(), me);
            var scaling = (TMP_Text[])Get("_championScaling");
            Assert.That(scaling[0].text, Is.EqualTo("0.3× Offense + 1× SO"));       // championCombatModel.ts:119-122
            string tip = ((HudIconHint)Get("_damageHint")).Text;
            Assert.That(tip, Does.Contain("Weapon scaling (0.3× Offense + 1× SO) adds 3.64 physical and 12.12 magic before the 2.5× hit multiplier."));   // :131
            Assert.That(tip, Does.Contain("Fire Roam is 250/1000 charged (12.5% move speed); after 20 s out of combat, the next landed basic attack adds 54.8 physical (50 + 0.4× Offense)."));   // :114-116
            Assert.That(tip, Does.Contain("Raw damage per hit before target mitigation: 1.82 physical, 47.37 magic, 0 true."), "the HUD-2 sentence stays");
        }

        [Test]
        public void WithoutTheBlockTheAutoRowLineStaysBlankAndTheRoamIsTheTodaysText()
        {
            _hud.HudContent = null;
            Call("ApplyChampionRows", Summary(), Me(FactionId.Fire, WeaponId.Wand));
            Assert.That(((TMP_Text[])Get("_championScaling"))[0].text, Is.EqualTo(""));
            string tip = ((HudIconHint)Get("_damageHint")).Text;
            Assert.That(tip, Does.Not.Contain("move speed"));
            Assert.That(tip, Does.Not.Contain("Weapon scaling"));
            Assert.That(tip, Does.Contain("Fire Roam is 250/1000 charged"), "ChampionPanelText.Rows' roam line, as before");
        }

        // ---- the Wish row

        [TestCase(FactionId.Frost, "Freeze", "1.25s stun · 450 range", "No damage scaling")]
        [TestCase(FactionId.Plague, "Swarm", "8s hidden · 72 radius", "No damage scaling")]
        [TestCase(FactionId.Sentenced, "Trial", "5s zone · 20% less dealt", "30% slower · +20% taken · 1.5s exit stun")]
        [TestCase(FactionId.Fire, "Blaze Step", "30 true DPS · 2s trail", "64–300 blink · fixed damage")]
        [TestCase(FactionId.Holy, "Last Stand", "5s floor at 1 HP · +30% move", "30% of held damage healed back")]
        public void TheWishRowDrawsTheFactionsNumbers(FactionId faction, string name, string value, string scaling)
        {
            _hud.HudContent = Hud();
            Call("ApplyWishRow", Me(faction, WeaponId.Sword));
            Assert.That(((TMP_Text[])Get("_championLabel"))[2].text, Is.EqualTo(name));
            Assert.That(((TMP_Text[])Get("_championValue"))[2].text, Is.EqualTo(value));
            Assert.That(((TMP_Text[])Get("_championScaling"))[2].text, Is.EqualTo(scaling));
        }

        [Test]
        public void WithoutTheBlockTheWishRowKeepsTodaysStockTextAndTheLabelWish()
        {
            _hud.HudContent = null;
            var me = Me(FactionId.Frost, WeaponId.Sword);
            me.Wish = new WishView { Ability = AbilityId.Freeze, Charges = 3, MaxCharges = 3 };
            Call("ApplyWishRow", me);
            Assert.That(((TMP_Text[])Get("_championLabel"))[2].text, Is.EqualTo("Wish"));
            Assert.That(((TMP_Text[])Get("_championValue"))[2].text, Is.EqualTo("Freeze · 3/3"));   // MatchHud.Legacy.cs RefreshLegacyHud today
            Assert.That(((TMP_Text[])Get("_championScaling"))[2].text, Is.EqualTo(""));
            Call("ApplyWishRow", Me(FactionId.Frost, WeaponId.Sword));
            Assert.That(((TMP_Text[])Get("_championValue"))[2].text, Is.EqualTo("—"), "no Wish delivered");
        }

        // ---- the weapon slots

        [Test]
        public void TheSlotsDrawTheScalingLineAndTheTooltip()
        {
            _hud.HudContent = Hud();
            var view = Inventory((byte)WeaponId.Wand, (byte)WeaponId.Axe);
            Call("RefreshBuildIcons", view);
            Call("UpdateInventoryHints", view.Inventory);
            var bar = (RectTransform)Get("_weaponBar");
            Assert.That(bar.Find("Slot1/Scaling/Label").GetComponent<TMP_Text>().text, Is.EqualTo("SO 1.0 + Offense 0.3"));
            Assert.That(bar.Find("Slot2/Scaling/Label").GetComponent<TMP_Text>().text, Is.EqualTo("Offense 1.0 + bonus HP 0.02"));
            var hints = (HudIconHint[])Get("_weaponHints");
            Assert.That(hints[0].Text, Does.Contain("Scales with SO 1.0 + Offense 0.3"));
            Assert.That(hints[1].Text, Does.Contain("Scales with Offense 1.0 + bonus HP 0.02"));
        }

        [Test]
        public void AnEmptySlotAndAMissingBlockDrawNoScalingLine()
        {
            var bar = (RectTransform)Get("_weaponBar");
            _hud.HudContent = Hud();
            var view = Inventory((byte)WeaponId.Wand, null);
            Call("RefreshBuildIcons", view); Call("UpdateInventoryHints", view.Inventory);
            // Unity keeps its "Empty" name for an empty slot (legacy shows Fists dimmed); no scaling line is invented for it.
            Assert.That(bar.Find("Slot2/Scaling/Label").GetComponent<TMP_Text>().text, Is.EqualTo(""));
            _hud.HudContent = null;
            var full = Inventory((byte)WeaponId.Wand, (byte)WeaponId.Axe);
            Call("RefreshBuildIcons", full); Call("UpdateInventoryHints", full.Inventory);
            Assert.That(bar.Find("Slot1/Scaling/Label").GetComponent<TMP_Text>().text, Is.EqualTo(""));
        }

        // ---- fit, after ApplyTextScale

        [Test, Combinatorial]
        public void TheNewLinesFitTheirBoxesAfterTheTextScaleIsApplied([Values(1f, 1.5f)] float scale, [Values(0, 1)] int stage)
        {
            var window = Stages[stage];
            ((HudStage)Get("_stageScaler")).Apply(window.x, window.y, HudLayout.CanvasScalerFactor(window.x, window.y));
            var champLabel = (TMP_Text[])Get("_championLabel"); var champValue = (TMP_Text[])Get("_championValue"); var champScaling = (TMP_Text[])Get("_championScaling");
            var bar = (RectTransform)Get("_weaponBar");
            var entries = new List<(string id, TMP_Text label, string text)>
            {
                ("Auto scaling, widest", champScaling[0], "0.3× SO + 0.4× bonus defense"),
                ("Auto scaling, axe", champScaling[0], "1× Offense + 0.02× bonus HP"),
                ("Wish name", champLabel[2], "Blaze Step"), ("Wish name", champLabel[2], "Last Stand"),
                ("Wish value, Last Stand", champValue[2], "5s floor at 1 HP · +30% move"),
                ("Wish value, Trial", champValue[2], "5s zone · 20% less dealt"),
                ("Wish value, Freeze", champValue[2], "1.25s stun · 450 range"),
                ("Wish scaling, Trial", champScaling[2], "30% slower · +20% taken · 1.5s exit stun"),
                ("Wish scaling, Last Stand", champScaling[2], "30% of held damage healed back"),
                ("Wish scaling, Blaze", champScaling[2], "64–300 blink · fixed damage"),
            };
            for (int i = 1; i <= 2; i++)
            {
                var label = bar.Find("Slot" + i + "/Scaling/Label").GetComponent<TMP_Text>();
                foreach (var t in new[] { "Offense 1.0 or SO 1.0 (the higher)", "bonus Defense/SD 0.4 + SO 0.3", "Offense 1.0 + bonus HP 0.02" })
                    entries.Add(("Slot " + i + " scaling", label, t));
            }
            var problems = new List<string>();
            foreach (var e in entries)
            {
                e.label.text = e.text;
                SetScale(scale);
                var changed = (Action)typeof(ShowcaseSettings).GetField("Changed", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_settings);
                changed?.Invoke();                                   // MatchHud.ApplyTextScale answers it (MatchHud.cs:76)
                var follow = e.label.GetComponent<MythicTextScale>();
                if (follow == null) { problems.Add(e.id + " has no MythicTextScale"); continue; }
                follow.Refit();
                float size = e.label.enableAutoSizing ? e.label.fontSizeMax : e.label.fontSize;
                bool auto = e.label.enableAutoSizing; float keep = e.label.fontSize;
                e.label.enableAutoSizing = false; e.label.fontSize = size;
                var need = e.label.GetPreferredValues(e.text, e.label.textWrappingMode != TextWrappingModes.NoWrap ? e.label.rectTransform.rect.width : 0f, 0f);
                e.label.fontSize = keep; e.label.enableAutoSizing = auto;
                var box = e.label.rectTransform.rect;
                if (e.label.overflowMode == TextOverflowModes.Ellipsis || e.label.overflowMode == TextOverflowModes.Truncate) problems.Add(e.id + " cuts its text");
                if (size < 6f - .01f) problems.Add(e.id + " shrinks to " + size);
                if (need.x > box.width * WidthShare + .001f || need.y > box.height + .01f)
                    problems.Add("CLIPS " + e.id + " '" + e.text + "' at " + size.ToString("0.##") + " needs " + need.x.ToString("0.#") + "x" + need.y.ToString("0.#") + " of " + box.width.ToString("0.#") + "x" + box.height.ToString("0.#"));
            }
            Assert.That(problems, Is.Empty, scale + " at " + window + ": " + problems.Count + " problems:\n" + string.Join("\n", problems));
        }

        // ---- helpers

        static void SetScale(ShowcaseSettings s, float v) { typeof(ShowcaseSettings).GetField("_textScale", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(s, v); }
        void SetScale(float v) { SetScale(_settings, v); }
        object Get(string name) { return typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_hud); }
        void Set(string name, object value) { typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(_hud, value); }
        void Call(string name, params object[] args) { typeof(MatchHud).GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_hud, args.Length == 0 ? null : args); }
    }
}
