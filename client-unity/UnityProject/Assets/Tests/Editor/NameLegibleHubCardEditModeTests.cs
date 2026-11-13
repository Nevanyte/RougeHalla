using System.Collections.Generic;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-NAME-LEGIBLE-1, item 4: the hub lobby card holds its text in the "unavailable" state (nine lines) at 1024x768, 1280x720, 1920x1080 and
    /// 960x720, and the card is clear of the hub's tiles.
    /// P-UNITY-HUD-VISUAL-FIX-4 tested exactly this (HubLobbyTextAndTabMapFix4EditModeTests) and passed, while the running client still ran the last line out
    /// of the card. Cause: the fix set the body's auto-size to 11..15 right after <c>MythicUi.Text</c> had attached a <c>MythicTextScale</c>
    /// (BaseSize = 15 * 1.5), and every <c>MatchHud.ApplyTextScale</c> (it runs when the Showcase settings change) calls
    /// <c>MythicUi.ApplyTextScale(_root, scale)</c>, whose <c>MythicTextScale.Apply</c> rewrites size, minimum and maximum to 22.5 x scale and 0.85 of
    /// that: nine lines cannot fit a 150 high card at a minimum of 19. The fix-4 test never ran that call. These tests do, exactly as MatchHud does:
    /// build, place through ApplyViewport, then apply the text scale and place again. They fail on the text being taller than its box.
    /// </summary>
    public sealed class NameLegibleHubCardEditModeTests
    {
        static readonly Vector2[] Windows = { new Vector2(1024, 768), new Vector2(1280, 720), new Vector2(1920, 1080), new Vector2(960, 720) };
        static readonly float[] Scales = { 1f, 1.5f };

        static IEnumerable<TestCaseData> Cases()
        {
            foreach (var w in Windows) foreach (var s in Scales) yield return new TestCaseData(w, s).SetName("Card_holds_its_text_at_" + (int)w.x + "x" + (int)w.y + "_text_scale_" + s.ToString("0.0#", System.Globalization.CultureInfo.InvariantCulture));
        }

        GameObject _canvas, _owner, _lobbyOwner;

        [TearDown]
        public void TearDown()
        {
            if (_canvas != null) Object.DestroyImmediate(_canvas);
            if (_owner != null) Object.DestroyImmediate(_owner);
            if (_lobbyOwner != null) Object.DestroyImmediate(_lobbyOwner);
        }

        static Rect World(RectTransform rect)
        {
            var c = new Vector3[4]; rect.GetWorldCorners(c);
            return Rect.MinMaxRect(c[0].x, c[0].y, c[2].x, c[2].y);
        }

        [TestCaseSource(nameof(Cases))]
        public void TheLobbyCardHoldsItsTextAndStaysClearOfTheTilesAfterTheTextScaleIsApplied(Vector2 window, float textScale)
        {
            _canvas = new GameObject("legible hub canvas", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            _canvas.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
            var menu = (RectTransform)new GameObject("JoinMenu", typeof(RectTransform)).transform;
            menu.SetParent(_canvas.transform, false);
            menu.anchorMin = Vector2.zero; menu.anchorMax = Vector2.one; menu.offsetMin = menu.offsetMax = Vector2.zero;
            _owner = new GameObject("legible launch owner");
            var launch = _owner.AddComponent<LaunchScreenView>();
            launch.Build(menu);
            float factor = HudLayout.CanvasScalerFactor(window.x, window.y);
            var root = (RectTransform)new GameObject("legible hub root", typeof(RectTransform)).transform;
            root.SetParent(_canvas.transform, false);
            root.anchorMin = root.anchorMax = root.pivot = new Vector2(.5f, .5f); root.anchoredPosition = Vector2.zero;
            root.sizeDelta = new Vector2(window.x / factor, window.y / factor);
            _lobbyOwner = new GameObject("legible lobby owner");
            var lobby = _lobbyOwner.AddComponent<HubLobbyActivityView>();
            lobby.Initialize(root, null);
            lobby.SetHub(true, true);
            launch.StageScaler.ViewportChanged += lobby.ApplyViewport;
            launch.StageScaler.Apply(window.x, window.y, factor);
            Canvas.ForceUpdateCanvases();

            // What MatchHud.ApplyTextScale does when the settings change (and a window resize that follows).
            MythicUi.ApplyTextScale(root, textScale);
            launch.StageScaler.Apply(window.x, window.y, factor);
            lobby.SetHub(true, true);
            Canvas.ForceUpdateCanvases();

            Assert.That(lobby.IsVisible, Is.True);
            StringAssert.Contains("unavailable", lobby.Text, "set-up: the unavailable state");
            var card = (RectTransform)root.Find("HubLobbyActivityPanel");
            var body = card.Find("LobbyActivityBody").GetComponent<TMP_Text>();
            body.ForceMeshUpdate();
            var rendered = body.GetRenderedValues(false);
            var box = body.rectTransform.rect;
            string at = " at " + window + ", text scale " + textScale + ": font " + body.fontSize.ToString("F1") + " (min " + body.fontSizeMin.ToString("F1") + ", max " + body.fontSizeMax.ToString("F1") + "), text " + rendered + " in a box " + box.size + ", card " + card.rect.size;
            Assert.That(rendered.y, Is.LessThanOrEqualTo(box.height + .5f), "the text is taller than its box" + at);
            Assert.That(rendered.x, Is.LessThanOrEqualTo(box.width + .5f), "the text is wider than its box" + at);
            Assert.That(body.fontSize, Is.GreaterThanOrEqualTo(11f), "readable, not shrunk to nothing" + at);

            // The drawn text, not just its box, is inside the card: the card is measured in world corners, the last line's bottom from the mesh bounds.
            var cardBox = World(card);
            var mesh = body.textBounds;
            var bottomLeft = body.rectTransform.TransformPoint(new Vector3(mesh.min.x, mesh.min.y, 0f));
            var topRight = body.rectTransform.TransformPoint(new Vector3(mesh.max.x, mesh.max.y, 0f));
            Assert.That(bottomLeft.y, Is.GreaterThanOrEqualTo(cardBox.yMin - .01f), "the last line ends below the card's bottom edge" + at);
            Assert.That(topRight.y, Is.LessThanOrEqualTo(cardBox.yMax + .01f), "the first line starts above the card's top edge" + at);
            Assert.That(topRight.x, Is.LessThanOrEqualTo(cardBox.xMax + .01f), "the text runs out of the card's right edge" + at);

            float unit = launch.Stage.lossyScale.x;
            Assert.That(cardBox.width / unit, Is.GreaterThanOrEqualTo(200f), "card width in HUD units");
            Assert.That(cardBox.height / unit, Is.GreaterThanOrEqualTo(100f), "card height in HUD units");
            var screen = World(root);
            Assert.That(screen.Contains(cardBox.min) && screen.Contains(cardBox.max), Is.True, "card " + cardBox + " is inside the window " + screen);

            var tiles = new List<KeyValuePair<string, Rect>>();
            foreach (var button in launch.Atrium.Room.GetComponentsInChildren<Button>(true))
                tiles.Add(new KeyValuePair<string, Rect>(button.name, World((RectTransform)button.transform)));
            Assert.That(tiles.Count, Is.EqualTo(13), "arena, training, counters, five kiosks and five factions");
            tiles.Add(new KeyValuePair<string, Rect>("launch panel", World(launch.Panel)));
            tiles.Add(new KeyValuePair<string, Rect>("wordmark", World((RectTransform)launch.Stage.Find("Wordmark"))));
            tiles.Add(new KeyValuePair<string, Rect>("station message", World((RectTransform)launch.Atrium.Area.Find("StationMessageBox"))));
            foreach (var tile in tiles)
                Assert.That(cardBox.Overlaps(tile.Value), Is.False, "the lobby card " + cardBox + " overlaps " + tile.Key + " " + tile.Value + at);
        }
    }
}
