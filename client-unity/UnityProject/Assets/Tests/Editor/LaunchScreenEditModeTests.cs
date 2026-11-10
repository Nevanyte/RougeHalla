using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// Builds the real launch screen at the three reference window sizes and checks it against the legacy menu arrangement
    /// (docs/rework/LEGACY_LAYOUT.md section 15): a 330 unit panel docked 12 from the top-left, the hub room filling the space to its
    /// right, one primary action, every colour a theme token, readable text and a focus ring on every control.
    /// </summary>
    public sealed class LaunchScreenEditModeTests
    {
        static readonly Vector2[] Windows = { new Vector2(1280, 800), new Vector2(1920, 1080), new Vector2(2560, 1440) };

        GameObject _canvas, _owner;
        RectTransform _menu;
        LaunchScreenView _view;

        [SetUp]
        public void SetUp()
        {
            _canvas = new GameObject("Launch layout canvas", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            _canvas.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
            _menu = (RectTransform)new GameObject("JoinMenu", typeof(RectTransform)).transform;
            _menu.SetParent(_canvas.transform, false);
            _menu.anchorMin = Vector2.zero; _menu.anchorMax = Vector2.one; _menu.offsetMin = _menu.offsetMax = Vector2.zero;
            _owner = new GameObject("Launch owner");
            _view = _owner.AddComponent<LaunchScreenView>();
            _view.Build(_menu);
        }

        [TearDown]
        public void TearDown()
        {
            if (_canvas != null) Object.DestroyImmediate(_canvas);
            if (_owner != null) Object.DestroyImmediate(_owner);
        }

        void Layout(Vector2 window)
        {
            _view.StageScaler.Apply(window.x, window.y, HudLayout.CanvasScalerFactor(window.x, window.y));
            Canvas.ForceUpdateCanvases();
        }

        struct Rect4 { public float Left, Top, Right, Bottom, Width, Height; }

        Rect4 Measure(RectTransform r)
        {
            var stage = _view.Stage;
            var corners = new Vector3[4]; r.GetWorldCorners(corners);
            Vector3 min = stage.InverseTransformPoint(corners[0]), max = stage.InverseTransformPoint(corners[2]);
            float w = stage.rect.width, h = stage.rect.height;
            return new Rect4 { Left = min.x + w / 2f, Right = w / 2f - max.x, Top = h / 2f - max.y, Bottom = min.y + h / 2f, Width = max.x - min.x, Height = max.y - min.y };
        }

        [TestCaseSource(nameof(Windows))]
        public void PanelIsDockedAtTheTopLeftAtLegacyWidthAndFitsTheWindow(Vector2 window)
        {
            Layout(window);
            var m = Measure(_view.Panel);
            Assert.That(m.Left, Is.EqualTo(12f).Within(.01f));
            Assert.That(m.Top, Is.EqualTo(12f).Within(.01f));
            Assert.That(m.Width, Is.EqualTo(330f).Within(.01f));
            Assert.That(m.Bottom, Is.GreaterThanOrEqualTo(12f - .01f), "the panel fits the stage height with the legacy 12 unit gutter");
        }

        [TestCaseSource(nameof(Windows))]
        public void HubRoomFillsTheSpaceRightOfThePanelBelowTheWordmark(Vector2 window)
        {
            Layout(window);
            var panel = Measure(_view.Panel);
            var room = Measure(_view.Atrium.Room);
            var hero = Measure(_view.HeroBlock);
            Assert.That(room.Left, Is.GreaterThanOrEqualTo(panel.Left + panel.Width + 11f), "the room never slides under the panel");
            Assert.That(room.Right, Is.GreaterThanOrEqualTo(11f), "the room stays inside the stage at the right");
            Assert.That(room.Bottom, Is.GreaterThanOrEqualTo(11f), "and above the bottom edge");
            Assert.That(room.Top, Is.GreaterThanOrEqualTo(hero.Top + hero.Height - 1f), "the wordmark sits above the room");
            Assert.That(hero.Left, Is.GreaterThanOrEqualTo(panel.Left + panel.Width), "the wordmark does not run into the panel");
            Assert.That(_view.Atrium.RoomScale, Is.InRange(.9f, 1.4f), "the room is not shrunk or blown up on a reference window");
        }

        [TestCaseSource(nameof(Windows))]
        public void StartRunIsTheOnlyPrimaryActionAndSitsBeforeTraining(Vector2 window)
        {
            Layout(window);
            var theme = UiTheme.Current;
            int primaries = 0;
            foreach (var b in _view.Stage.GetComponentsInChildren<Button>(true))
                if (Same(b.colors.normalColor, theme.AccentDim)) primaries++;
            Assert.That(primaries, Is.EqualTo(1), "exactly one gold primary button");
            var play = Measure((RectTransform)_view.Play.transform);
            var training = Measure((RectTransform)_view.Training.transform);
            Assert.That(play.Height, Is.GreaterThanOrEqualTo(44f));
            Assert.That(play.Width, Is.GreaterThan(training.Width), "the primary action is the wider one");
            Assert.That(play.Left + play.Width, Is.LessThanOrEqualTo(training.Left + .01f), "no overlap");
            Assert.That(Measure((RectTransform)_view.Reason.transform).Top, Is.GreaterThanOrEqualTo(play.Top + play.Height - 1f), "the reason line reads under the actions");
        }

        [Test]
        public void FactionCardsShowShapeNameRegionAndWeaponForEveryFaction()
        {
            Layout(Windows[0]);
            string[] weapons = { "Axes", "Swords", "Bows", "Shields", "Wands" }, regions = { "Volcanic wastes", "Harvest fields", "Forgotten city", "Frozen plains", "Desert oasis" };
            string[] names = { "Fire", "Sentenced", "Plague", "Frost", "Holy" };
            var shapes = new HashSet<Sprite>();
            for (int i = 0; i < 5; i++)
            {
                var card = _view.Houses[i].transform;
                Assert.That(card.name, Is.EqualTo("Faction" + names[i]));
                Assert.That(card.Find("NameBox/Name").GetComponent<TMP_Text>().text, Is.EqualTo(names[i]));
                Assert.That(card.Find("RegionBox/Region").GetComponent<TMP_Text>().text, Is.EqualTo(regions[i]));
                Assert.That(card.Find("WeaponPill/WeaponBox/Weapon").GetComponent<TMP_Text>().text, Is.EqualTo(weapons[i]));
                var shape = card.Find("Shape").GetComponent<Image>();
                Assert.That(shape.sprite, Is.Not.Null);
                Assert.That(shapes.Add(shape.sprite), Is.True, "each faction has its own shape, so identity is not carried by colour alone");
                Assert.That(card.Find("WeaponPill/WeaponIcon").GetComponent<Image>().sprite, Is.Not.Null);
            }
            Assert.That(_view.Houses[4].GetComponent<Button>(), Is.Not.Null);
        }

        [Test]
        public void SelectingAFactionHighlightsOneCardAndMovesTheRoomTint()
        {
            var raised = new List<int>();
            _view.FactionChosen = raised.Add;
            _view.Houses[2].onClick.Invoke();
            Assert.That(raised, Is.EqualTo(new[] { 2 }));
            Assert.That(_view.Faction, Is.EqualTo(2));
            var theme = UiTheme.Current;
            for (int i = 0; i < 5; i++)
            {
                bool selected = i == 2;
                Assert.That(Same(_view.Houses[i].colors.normalColor, selected ? theme.SurfaceSelected : theme.SurfaceRaised), Is.True, "card " + i);
                Assert.That(_view.Houses[i].transform.Find("Selected").GetComponent<Image>().enabled, Is.EqualTo(selected));
            }
        }

        [Test]
        public void EveryControlCarriesAFocusRingAndIsKeyboardReachable()
        {
            var bad = new List<string>();
            foreach (var s in _canvas.GetComponentsInChildren<Selectable>(true))
            {
                if (s.GetComponent<UiFocusHalo>() == null) bad.Add(s.name + " has no focus ring");
                if (s.navigation.mode == Navigation.Mode.None) bad.Add(s.name + " is not keyboard reachable");
            }
            Assert.That(bad, Is.Empty, string.Join("\n", bad));
            _view.Play.Select();
            Assert.That(_view.Play.GetComponent<UiFocusHalo>(), Is.Not.Null);
        }

        [TestCaseSource(nameof(Windows))]
        public void ControlsAreAtLeastTwentyEightUnitsTallAndTextHoldsFourPointFiveContrast(Vector2 window)
        {
            Layout(window);
            var theme = UiTheme.Current;
            var bad = new List<string>();
            foreach (var s in _view.Stage.GetComponentsInChildren<Selectable>(false))
            {
                var m = Measure((RectTransform)s.transform);
                if (m.Height < 28f - .01f) bad.Add(s.name + " is only " + m.Height + " tall");
            }
            var surfaces = new Color[] { theme.Surface, theme.SurfaceRaised, theme.SurfaceSunken, theme.SurfaceSelected, theme.SurfaceHover, theme.SurfaceDisabled };
            foreach (var t in _view.Panel.GetComponentsInChildren<TMP_Text>(true))
            {
                if (string.IsNullOrEmpty(t.text)) continue;
                var button = t.GetComponentInParent<Button>();
                var fills = button != null && Same(button.colors.normalColor, theme.AccentDim) ? new Color[] { theme.AccentDim, theme.Accent } : surfaces;
                foreach (var fill in fills)
                {
                    float ratio = ShowcasePalette.ContrastRatio(t.color, fill);
                    if (ratio < 4.5f) bad.Add(t.name + " '" + t.text + "' " + ratio.ToString("0.0") + ":1 on " + (Color32)fill);
                }
            }
            Assert.That(bad, Is.Empty, string.Join("\n", bad));
        }

        [TestCaseSource(nameof(Windows))]
        public void EveryGraphicUsesAThemeColour(Vector2 window)
        {
            Layout(window);
            var theme = UiTheme.Current;
            var bad = new List<string>();
            foreach (var graphic in _canvas.GetComponentsInChildren<Graphic>(true))
            {
                if (graphic is TMP_SubMeshUI) continue;
                var selectable = graphic.GetComponent<Selectable>();
                bool sprite = graphic is Image && ((Image)graphic).sprite != null;
                bool white = graphic.color.r >= .999f && graphic.color.g >= .999f && graphic.color.b >= .999f;
                if (selectable != null && selectable.targetGraphic == graphic && selectable.transition == Selectable.Transition.ColorTint)
                {
                    var c = selectable.colors;
                    foreach (var state in new[] { c.normalColor, c.highlightedColor, c.pressedColor, c.selectedColor, c.disabledColor })
                        if (!theme.Owns(state) && state != Color.white) bad.Add(graphic.name + " state " + state);
                    continue;
                }
                if (sprite && white) continue;
                if (!theme.Owns(graphic.color)) bad.Add(graphic.name + " " + (Color32)graphic.color);
            }
            Assert.That(bad, Is.Empty, string.Join("\n", bad));
        }

        [Test]
        public void PlayStateShowsConnectingAndTurnsTrainingIntoCancel()
        {
            _view.SetPlay("START RUN", true, false);
            Assert.That(_view.Play.interactable, Is.True);
            Assert.That(_view.TrainingLabel.text, Is.EqualTo("TRAINING"));
            _view.SetPlay("CONNECTING…", true, true);
            Assert.That(_view.Play.interactable, Is.False, "no second launch while one is connecting");
            Assert.That(_view.TrainingLabel.text, Is.EqualTo("CANCEL"));
            bool cancelled = false, trained = false;
            _view.CancelRequested = () => cancelled = true; _view.TrainingRequested = () => trained = true;
            _view.Training.onClick.Invoke();
            Assert.That(cancelled && !trained, Is.True);
            Assert.That(_view.Training.GetComponent<CanvasGroup>().ignoreParentGroups, Is.True, "Cancel stays clickable while the rest of the menu is locked");
        }

        [Test]
        public void ADisabledPlayButtonKeepsReadableInk()
        {
            var theme = UiTheme.Current;
            _view.SetPlay("START RUN", false, false);
            Assert.That(ShowcasePalette.ContrastRatio(_view.PlayLabel.color, theme.SurfaceDisabled), Is.GreaterThanOrEqualTo(4.5f));
            _view.SetPlay("START RUN", true, false);
            Assert.That(ShowcasePalette.ContrastRatio(_view.PlayLabel.color, theme.AccentDim), Is.GreaterThanOrEqualTo(4.5f));
        }

        [Test]
        public void ReasonLineYieldsToAStatusMessage()
        {
            _view.SetMessages("", "No arena server is set up for this page.");
            Assert.That(_view.Reason.text, Is.EqualTo("No arena server is set up for this page."));
            _view.SetMessages("Joining the arena…", "No arena server is set up for this page.");
            Assert.That(_view.Status.text, Is.EqualTo("Joining the arena…"));
            Assert.That(_view.Reason.text, Is.Empty, "one explanatory line at a time");
        }

        static bool Same(Color a, Color b)
        {
            var x = (Color32)a; var y = (Color32)b;
            return x.r == y.r && x.g == y.g && x.b == y.b;
        }

        // ---- copy and the synthetic backdrop map (pure)

        [Test]
        public void UnavailableTextExplainsEachPolicyOutcomeInPlayerTerms()
        {
            var endpoint = AccountEndpoint.FromPage("http://127.0.0.1:8147/", null);
            var other = new MatchLaunchConfig(endpoint, "ws://127.0.0.1:7847/ws", "").Target(MatchLaunchMode.Arena);
            Assert.That(other.Available, Is.False);
            Assert.That(other.Kind, Is.EqualTo(LaunchUnavailableKind.OtherSite));
            string text = LaunchCopy.UnavailableText(MatchLaunchMode.Arena, other);
            Assert.That(text, Does.Contain("another site").And.Contain("main address"));
            Assert.That(text, Does.Not.Contain("7847").And.Not.Contain("unavailable for this connection"));

            var same = new MatchLaunchConfig(endpoint, "ws://127.0.0.1:8147/ws", "");
            Assert.That(same.Target(MatchLaunchMode.Arena).Available, Is.True);
            Assert.That(LaunchCopy.UnavailableText(MatchLaunchMode.Arena, same.Target(MatchLaunchMode.Arena)), Is.Empty);
            Assert.That(LaunchCopy.UnavailableText(MatchLaunchMode.Training, same.Target(MatchLaunchMode.Training)), Is.EqualTo("Training isn't offered on this server."));
            Assert.That(LaunchCopy.UnavailableText(MatchLaunchMode.Arena, new MatchLaunchConfig(null, "ws://a/ws", "").Target(MatchLaunchMode.Arena)), Does.Contain("Accounts aren't reachable"));
            Assert.That(LaunchCopy.UnavailableText(MatchLaunchMode.Arena, new MatchLaunchConfig(endpoint, "not a url", "").Target(MatchLaunchMode.Arena)), Does.Contain("isn't valid"));
        }

        [Test]
        public void CallsignProblemAndSessionFailureTextAreWordedForPlayers()
        {
            Assert.That(LaunchCopy.CallsignProblem(""), Is.EqualTo("Type a callsign to play."));
            Assert.That(LaunchCopy.CallsignProblem("a"), Does.Contain("2 to 16"));
            Assert.That(LaunchCopy.CallsignProblem("bad name!"), Does.Contain("2 to 16"));
            Assert.That(LaunchCopy.CallsignProblem("Valid_name-1"), Is.Null);
            Assert.That(LaunchCopy.SessionFailureText(SessionState.Failed, null), Does.StartWith("Couldn't reach the game server"));
            Assert.That(LaunchCopy.SessionFailureText(SessionState.Rejected, "room full"), Does.Contain("room full"));
            Assert.That(LaunchCopy.SessionFailureText(SessionState.InMatch, null), Is.Empty);
        }

        [Test]
        public void BackdropMapHoldsFiveRegionColumnsAndIsDeterministic()
        {
            var a = LaunchBackdrop.BuildMap(); var b = LaunchBackdrop.BuildMap();
            Assert.That(a.W, Is.EqualTo(LaunchBackdrop.RegionWidth * LaunchBackdrop.RegionCount));
            Assert.That(a.H, Is.EqualTo(LaunchBackdrop.MapHeight));
            Assert.That(a.ContextHash, Is.EqualTo(b.ContextHash));
            var seen = new HashSet<byte>();
            foreach (byte r in a.Regions) seen.Add(r);
            Assert.That(seen, Is.EquivalentTo(new byte[] { 1, 2, 3, 4, 5 }));
            for (int f = 0; f < 5; f++)
            {
                var c = LaunchBackdrop.FocusTile(f);
                Assert.That(a.Regions[(int)c.y * a.W + (int)c.x], Is.EqualTo(f + 1), "the focus tile lies in its own region");
                Assert.That(a.At((int)c.x, (int)c.y), Is.EqualTo(MapBlob.Floor), "and on open floor");
            }
        }

        [Test]
        public void BackdropDriftIsSlowBoundedAndStillWhenMotionIsOff()
        {
            for (int f = 0; f < 5; f++)
            {
                var c = LaunchBackdrop.FocusTile(f);
                Assert.That(LaunchBackdrop.DriftTile(f, 37f, false), Is.EqualTo(c));
                for (float t = 0; t < 600f; t += 7f)
                {
                    var d = LaunchBackdrop.DriftTile(f, t, true);
                    Assert.That(Mathf.Abs(d.x - c.x), Is.LessThanOrEqualTo(7.01f));
                    Assert.That(Mathf.Abs(d.y - c.y), Is.LessThanOrEqualTo(2.41f));
                }
            }
        }
    }
}
