using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// Builds the real in-match HUD pieces at three window sizes and checks each element's anchor, inset and size against
    /// docs/rework/LEGACY_LAYOUT.md (1 HUD unit = 1 legacy CSS px), plus that no HUD graphic uses a colour outside the theme.
    /// </summary>
    public sealed class HudLegacyLayoutEditModeTests
    {
        GameObject _canvas, _hudOwner, _settingsOwner;
        MatchHud _hud;
        RectTransform _stage, _chrome;
        TacticalMapController _map;
        ModernSettingsView _settings;
        HelpGuideView _help;
        UiDisplayPreferences _prefs;
        UiTheme _savedTheme;

        [SetUp]
        public void SetUp()
        {
            _savedTheme = UiTheme.Current;
            Build(UiTheme.Placeholder());
        }

        void Build(UiTheme theme)
        {
            UiTheme.Current = theme;
            _canvas = new GameObject("HUD layout test canvas", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            _canvas.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
            _hudOwner = new GameObject("HUD owner");
            _hud = _hudOwner.AddComponent<MatchHud>();
            Set("_root", _canvas.GetComponent<RectTransform>());
            Invoke("EnsureStage");
            Invoke("CreateTopAndToastPills");
            Invoke("CreateLegacyChrome");
            Invoke("CreateCombatHud");
            _stage = (RectTransform)Get("_stage");
            _chrome = (RectTransform)Get("_chromeStage");
            _prefs = new UiDisplayPreferences();
            Set("_uiPrefs", _prefs);
            // The reward panel is built by Initialize; mirror its stage parenting here.
            var rewards = (RectTransform)new GameObject("Rewards", typeof(RectTransform)).transform;
            rewards.SetParent(_stage, false);
            Set("_rewards", rewards);

            _map = _hudOwner.AddComponent<TacticalMapController>();
            _map.Initialize(null, _canvas.transform, _prefs, _stage);
            Set("_map", _map);

            _settingsOwner = new GameObject("Settings owner");
            var showcase = _settingsOwner.AddComponent<ShowcaseSettings>();
            typeof(ShowcaseSettings).GetField("_textScale", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(showcase, 1f);
            _settings = _settingsOwner.AddComponent<ModernSettingsView>();
            _settings.Initialize(_chrome, showcase, _map, _prefs, null, () => { });
            Set("_modernSettings", _settings);
            _help = _settingsOwner.AddComponent<HelpGuideView>();
            _help.Initialize(_chrome, null);
            Set("_helpGuide", _help);
            // The quest journal itself is only re-skinned; build just its launcher (the launcher is what the layout spec places).
            Set("_stage", _stage);
            var launcher = HudUi.Button(_stage, "Journal", "Quests · J", HudAnchor.BottomLeft, 12f, 12f, 84f, 22f, null);
            Set("_journalButton", launcher);
        }

        [TearDown]
        public void TearDown()
        {
            if (_canvas != null) Object.DestroyImmediate(_canvas);
            if (_hudOwner != null) Object.DestroyImmediate(_hudOwner);
            if (_settingsOwner != null) Object.DestroyImmediate(_settingsOwner);
            UiTheme.Current = _savedTheme;
        }

        const float MatchHudBarClearanceGuard = 318f;
        static readonly Vector2[] Windows = { new Vector2(1280, 800), new Vector2(1920, 1080), new Vector2(2560, 1440) };

        void Layout(Vector2 window)
        {
            float factor = HudLayout.CanvasScalerFactor(window.x, window.y);
            ((HudStage)Get("_stageScaler")).Apply(window.x, window.y, factor);
            ((HudStage)Get("_chromeScaler")).Apply(window.x, window.y, factor);
            _settings.SetVisible(true);
            _settings.ApplyViewport(HudLayout.Viewport(window.x, window.y));
        }

        /// <summary>Insets (left, top, right, bottom) and size of a rect inside the stage, in HUD units.</summary>
        static Rect4 Measure(RectTransform stage, RectTransform r)
        {
            var corners = new Vector3[4]; r.GetWorldCorners(corners);
            Vector3 min = stage.InverseTransformPoint(corners[0]), max = stage.InverseTransformPoint(corners[2]);
            float w = stage.rect.width, h = stage.rect.height;
            return new Rect4 { Left = min.x + w / 2f, Right = w / 2f - max.x, Top = h / 2f - max.y, Bottom = min.y + h / 2f, Width = max.x - min.x, Height = max.y - min.y };
        }

        struct Rect4 { public float Left, Top, Right, Bottom, Width, Height; }

        RectTransform Child(Transform root, string path) { var t = root.Find(path); Assert.That(t, Is.Not.Null, path); return (RectTransform)t; }

        [TestCaseSource(nameof(Windows))]
        public void ChromeButtonsAreThirtyPixelsTopRightWithLegacyGaps(Vector2 window)
        {
            Layout(window);
            string[] names = { "Help", "Settings", "Fullscreen" };
            for (int i = 0; i < 3; i++)
            {
                var m = Measure(_chrome, Child(_chrome, names[i]));
                Assert.That(m.Width, Is.EqualTo(30f).Within(.01f), names[i]);
                Assert.That(m.Height, Is.EqualTo(30f).Within(.01f), names[i]);
                Assert.That(m.Top, Is.EqualTo(10f).Within(.01f), names[i]);
                Assert.That(m.Right, Is.EqualTo(12f + i * 36f).Within(.01f), names[i] + " sits 6 apart");
            }
            var perf = Measure(_chrome, Child(_chrome, "PerformancePill"));
            Assert.That(perf.Right, Is.EqualTo(12f + 3 * 30f + 2 * 6f + 8f).Within(.01f), "perf pill is 8 left of the first button");
        }

        [TestCaseSource(nameof(Windows))]
        public void MinimapIsASquareTwelveFromTheBottomRightCorner(Vector2 window)
        {
            Layout(window);
            var v = HudLayout.Viewport(window.x, window.y);
            var m = Measure(_stage, _map.MinimapRoot);
            float expected = HudLayout.MinimapSize(v.UiWidth, v.UiHeight, 1f);
            Assert.That(m.Right, Is.EqualTo(12f).Within(.01f));
            Assert.That(m.Bottom, Is.EqualTo(12f).Within(.01f));
            Assert.That(m.Width, Is.EqualTo(expected).Within(.01f));
            Assert.That(m.Height, Is.EqualTo(expected).Within(.01f));
            Assert.That(expected, Is.EqualTo(window.y >= 1440 ? 312f : 270f), "270 at 1280x800 and 1920x1080, 312 at 2560x1440");
            Assert.That(_map.MinimapRoot.Find("OpenMap"), Is.Null, "legacy minimap has no button strip");
        }

        [TestCaseSource(nameof(Windows))]
        public void WeaponBarIsCentredWithSlotsWishTileConsumablesAndSwapChip(Vector2 window)
        {
            Layout(window);
            var bar = Child(_stage, "PlayerHUD/CombatActions");
            var v = HudLayout.Viewport(window.x, window.y);
            var mBar = Measure(_stage, bar);
            Assert.That(mBar.Left, Is.EqualTo(mBar.Right).Within(.01f), "bar is centred");
            Assert.That(mBar.Bottom, Is.EqualTo(14f).Within(.01f), "bar sits 14 from the bottom");
            Assert.That(mBar.Width, Is.EqualTo(318f).Within(.01f));
            foreach (string slot in new[] { "Slot1", "Slot2" })
            {
                var m = Measure(_stage, Child(bar, slot));
                Assert.That(m.Width, Is.EqualTo(104f).Within(.01f)); Assert.That(m.Height, Is.EqualTo(76f).Within(.01f));
                Assert.That(m.Bottom, Is.EqualTo(48f).Within(.01f), "slot row = 14 + 28 consumables + 6 gap");
            }
            var wish = Measure(_stage, Child(bar, "WishTile"));
            Assert.That(wish.Width, Is.EqualTo(64f).Within(.01f)); Assert.That(wish.Height, Is.EqualTo(64f).Within(.01f));
            Assert.That(wish.Left, Is.GreaterThan(Measure(_stage, Child(bar, "Slot2")).Left + 104f - .01f), "Wish tile is docked at the right end");
            var swap = Measure(_stage, Child(bar, "QSwap"));
            Assert.That(swap.Left, Is.GreaterThan(Measure(_stage, Child(bar, "Slot1")).Left + 104f - .01f));
            Assert.That(swap.Left, Is.LessThan(Measure(_stage, Child(bar, "Slot2")).Left));
            var consumables = Measure(_stage, Child(bar, "Consumables"));
            Assert.That(consumables.Bottom, Is.EqualTo(14f).Within(.01f)); Assert.That(consumables.Height, Is.EqualTo(28f).Within(.01f));
            Assert.That(Child(bar, "Consumables/Potion"), Is.Not.Null); Assert.That(Child(bar, "Consumables/Wind"), Is.Not.Null);
            Assert.That(mBar.Left, Is.GreaterThan(0f), "bar fits the stage");
            Assert.That(v.UiWidth, Is.GreaterThan(MatchHudBarClearanceGuard));
        }

        [TestCaseSource(nameof(Windows))]
        public void PlateAndChampionHudSitAtTheirLegacyCorners(Vector2 window)
        {
            Layout(window);
            var plate = Measure(_stage, Child(_stage, "PlayerHUD/VitalsPanel"));
            Assert.That(plate.Left, Is.EqualTo(12f).Within(.01f)); Assert.That(plate.Top, Is.EqualTo(10f).Within(.01f));
            Assert.That(plate.Width, Is.EqualTo(240f).Within(.01f));
            var champion = Measure(_stage, Child(_stage, "PlayerHUD/ChampionCombatHud"));
            Assert.That(champion.Left, Is.EqualTo(12f).Within(.01f)); Assert.That(champion.Bottom, Is.EqualTo(48f).Within(.01f));
            Assert.That(champion.Width, Is.EqualTo(250f).Within(.01f));
            Assert.That(champion.Height, Is.LessThanOrEqualTo(150f), "legacy max-height min(150, 0.3 uiH) leaves it above the quest launcher");
            var launcher = Measure(_stage, Child(_stage, "Journal"));
            Assert.That(launcher.Left, Is.EqualTo(12f).Within(.01f)); Assert.That(launcher.Bottom, Is.EqualTo(12f).Within(.01f));
            Assert.That(champion.Bottom, Is.GreaterThanOrEqualTo(launcher.Bottom + launcher.Height), "champion HUD sits directly above the Quests launcher");
        }

        [TestCaseSource(nameof(Windows))]
        public void BuildHudHasNineCellsInsideTheTwoHundredTwentyFourPixelPlateBody(Vector2 window)
        {
            Layout(window);
            var cells = (RectTransform[])Get("_buildCells");
            Assert.That(cells.Length, Is.EqualTo(9));
            var body = Child(_stage, "PlayerHUD/VitalsPanel/PlateBody");
            Assert.That(Measure(_stage, body).Width, Is.EqualTo(224f).Within(.01f), "plate content width");
            var strip = Child(_stage, "PlayerHUD/VitalsPanel/PlateBody/BuildStrip");
            Assert.That(Measure(_stage, strip).Width, Is.EqualTo(224f).Within(.01f), "Gained box is effectively 224 wide");
            string[] expected = { "Offense", "SO", "Damage gained", "Attack speed", "Life steal", "Health gained", "Defense", "Soul Defense", "Move speed" };
            for (int i = 0; i < 9; i++)
            {
                Assert.That(cells[i], Is.Not.Null);
                Assert.That(cells[i].GetComponentInChildren<TMP_Text>(true).text, Is.EqualTo(expected[i]), "legacy order");
                Assert.That(Measure(_stage, cells[i]).Height, Is.EqualTo(14f).Within(.01f));
                Assert.That(cells[i].Find("Rule").GetComponent<RectTransform>().sizeDelta.x, Is.EqualTo(3f), "3 px stat-colour left rule");
            }
            Assert.That(Child(_stage, "PlayerHUD/VitalsPanel/PlateBody/BuildDetails"), Is.Not.Null, "Cards & mob bonuses home");
            Assert.That(Child(_stage, "PlayerHUD/VitalsPanel/PlateBody/ExtrasBody/MobBonuses"), Is.Not.Null);
        }

        [TestCaseSource(nameof(Windows))]
        public void SettingsIsAnAnchoredCardAndHelpIsAPeripheralFiveSixtyCard(Vector2 window)
        {
            Layout(window);
            var v = HudLayout.Viewport(window.x, window.y);
            var card = Measure(_chrome, _settings.Root);
            Assert.That(card.Top, Is.EqualTo(48f).Within(.01f)); Assert.That(card.Right, Is.EqualTo(12f).Within(.01f));
            Assert.That(card.Width, Is.EqualTo(320f).Within(.01f));
            Assert.That(card.Height, Is.LessThanOrEqualTo(v.UiHeight - 60f + .01f));
            _help.SetVisible(true);
            var help = Measure(_chrome, Child(_help.Root, "HelpGuideCard"));
            Assert.That(help.Width, Is.EqualTo(560f).Within(.01f));
            Assert.That(help.Left, Is.EqualTo(help.Right).Within(.01f), "help card is centred");
            Assert.That(help.Height, Is.LessThanOrEqualTo(v.UiHeight - 24f + .01f));
            var scrim = Measure(_chrome, _help.Root);
            Assert.That(scrim.Width, Is.EqualTo(v.UiWidth).Within(.01f), "scrim covers the whole stage");
        }

        [TestCaseSource(nameof(Windows))]
        public void BannerAndToastsUseTheTopCentreAndBottomOneTwentyFourAnchors(Vector2 window)
        {
            Layout(window);
            var banner = Measure(_stage, Child(_stage, "ConnectionBanner"));
            Assert.That(banner.Top, Is.EqualTo(12f).Within(.01f)); Assert.That(banner.Left, Is.EqualTo(banner.Right).Within(.01f));
            var toast = Measure(_stage, Child(_stage, "ToastStack"));
            Assert.That(toast.Bottom, Is.EqualTo(124f).Within(.01f)); Assert.That(toast.Left, Is.EqualTo(toast.Right).Within(.01f));
            var bar = Measure(_stage, Child(_stage, "PlayerHUD/CombatActions/Slot1"));
            Assert.That(toast.Bottom, Is.GreaterThanOrEqualTo(bar.Bottom + bar.Height - .01f), "toasts clear the slot row");
        }

        [TestCaseSource(nameof(Windows))]
        public void ChestPanelAnchorsRightTwelveTopFiftySixAndAboveTheMinimap(Vector2 window)
        {
            Layout(window);
            Invoke("ApplyRewardsAnchor");
            var v = HudLayout.Viewport(window.x, window.y);
            var rewards = Measure(_stage, (RectTransform)Get("_rewards"));
            float mm = HudLayout.MinimapSize(v.UiWidth, v.UiHeight, 1f);
            Assert.That(rewards.Right, Is.EqualTo(12f).Within(.01f)); Assert.That(rewards.Top, Is.EqualTo(56f).Within(.01f));
            Assert.That(rewards.Bottom, Is.EqualTo(mm + 34f).Within(.01f)); Assert.That(rewards.Width, Is.EqualTo(248f).Within(.01f));
        }

        [Test]
        public void DeathLineIsCentredAndHiddenUntilTheOwnerDies()
        {
            Layout(Windows[0]);
            var line = Child(_stage, "PlayerHUD/DeathLine");
            var m = Measure(_stage, line);
            Assert.That(m.Left, Is.EqualTo(m.Right).Within(.01f)); Assert.That(m.Top, Is.EqualTo(m.Bottom).Within(.01f));
            Assert.That(line.gameObject.activeSelf, Is.False);
            Assert.That(line.GetComponentInChildren<TMP_Text>(true).text, Is.EqualTo("YOU DIED"));
        }

        [Test]
        public void EdgeThreatGlowsHugTheEdgeAndColourByDistance()
        {
            var near = EdgeThreat.Compute(100, 0, 100, 1000, 800, 600);
            Assert.That(near.X, Is.EqualTo(1000f).Within(.01f), "ray from the centre reaches the right edge");
            Assert.That(near.Y, Is.EqualTo(400f).Within(.01f));
            Assert.That(near.Remoteness(EdgeThreatView.NearDistance), Is.EqualTo(0f));
            Assert.That(EdgeThreat.Compute(0, 50, 600, 1000, 800, 600).Remoteness(EdgeThreatView.NearDistance), Is.EqualTo(1f));
            var view = new EdgeThreatView(_stage);
            view.Show(new[] { near });
            Assert.That(view.ActiveCount, Is.EqualTo(1));
            view.Show(null);
            Assert.That(view.ActiveCount, Is.EqualTo(0));
        }

        [Test]
        public void EveryHudGraphicUsesAColourFromTheTheme()
        {
            foreach (var window in Windows) Layout(window);
            _help.SetVisible(true);
            AssertAllOwned(UiTheme.Current);
        }

        [Test]
        public void ARecolouredThemeReskinsEveryHudGraphic()
        {
            TearDown();
            var custom = UiTheme.Placeholder();
            // Every token becomes a colour the placeholder never used.
            byte n = 1;
            foreach (var field in typeof(UiTheme).GetFields(BindingFlags.Instance | BindingFlags.Public))
            {
                if (field.FieldType == typeof(Color32)) field.SetValue(custom, new Color32((byte)(200 + n % 50), (byte)(10 + n * 3), (byte)(30 + n * 5), 255));
                else if (field.FieldType == typeof(Color32[]))
                {
                    var array = (Color32[])field.GetValue(custom);
                    for (int i = 0; i < array.Length; i++) { n++; array[i] = new Color32((byte)(180 + n), (byte)(40 + n * 2), (byte)(90 + n), 255); }
                }
                n++;
            }
            _savedTheme = UiTheme.Placeholder();
            Build(custom);
            foreach (var window in Windows) Layout(window);
            _help.SetVisible(true);
            AssertAllOwned(custom);
            Assert.That(UiTheme.Placeholder().Owns(custom.Surface), Is.False, "the custom palette really differs from the placeholder");
        }

        void AssertAllOwned(UiTheme theme)
        {
            var bad = new List<string>();
            foreach (var graphic in _canvas.GetComponentsInChildren<Graphic>(true))
            {
                if (graphic is TMP_SubMeshUI) continue;
                var selectable = graphic.GetComponent<Selectable>();
                // A white tint on sprite / texture / custom-mesh graphics is a multiplier, not a drawn colour.
                bool tintOnly = graphic is RawImage || graphic is Image && ((Image)graphic).sprite != null || !(graphic is Image) && !(graphic is TMP_Text);
                if (selectable != null && selectable.targetGraphic == graphic && selectable.transition == Selectable.Transition.ColorTint)
                {
                    // A colour-block button: the graphic is white and every state colour must be a theme token.
                    var c = selectable.colors;
                    foreach (var state in new[] { c.normalColor, c.highlightedColor, c.pressedColor, c.selectedColor, c.disabledColor })
                        if (!theme.Owns(state) && state != Color.white) bad.Add(Path(graphic) + " state " + state);
                    if (graphic.color != Color.white && !theme.Owns(graphic.color)) bad.Add(Path(graphic) + " fill " + (Color32)graphic.color);
                    continue;
                }
                if (tintOnly && graphic.color == Color.white) continue;
                if (!theme.Owns(graphic.color)) bad.Add(Path(graphic) + " " + (Color32)graphic.color);
            }
            Assert.That(bad, Is.Empty, "HUD graphics outside the theme:\n" + string.Join("\n", bad));
        }

        static string Path(Component c)
        {
            string path = c.name;
            for (var t = c.transform.parent; t != null; t = t.parent) path = t.name + "/" + path;
            return path;
        }

        object Get(string name) => typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_hud);
        void Set(string name, object value) => typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(_hud, value);
        void Invoke(string name) => typeof(MatchHud).GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_hud, null);
    }
}
