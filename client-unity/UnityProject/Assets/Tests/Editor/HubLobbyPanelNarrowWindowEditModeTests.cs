using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.UI;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-HUD-VISUAL-FIX-3, item 5: the hub's lobby-activity card sits at fixed canvas fractions (.76-.99 x .06-.46) and lands on the TRAINING
    /// tile and the Holy pedestal (shots 05, 21). Real rectangles: the real launch screen is laid out for a 1280x720 and a 1920x1080
    /// window and the card is placed the way every other hub panel is, through <see cref="HubLobbyActivityView.ApplyViewport"/> on the stage's
    /// ViewportChanged event (MatchHud.Legacy.cs ApplyLegacyViewport must call it, as it does for the cosmetics, progress and guide panels).
    /// </summary>
    public sealed class HubLobbyPanelNarrowWindowEditModeTests
    {
        static readonly Vector2[] Windows = { new Vector2(1024, 768), new Vector2(960, 720) };

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

        [TestCaseSource(nameof(Windows))]
        public void TheLobbyCardClearsEveryStationAt4By3AndNarrowWindows(Vector2 window)
        {
            _canvas = new GameObject("fix3 hub canvas", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            _canvas.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
            var menu = (RectTransform)new GameObject("JoinMenu", typeof(RectTransform)).transform;
            menu.SetParent(_canvas.transform, false);
            menu.anchorMin = Vector2.zero; menu.anchorMax = Vector2.one; menu.offsetMin = menu.offsetMax = Vector2.zero;
            _owner = new GameObject("fix3 launch owner");
            var launch = _owner.AddComponent<LaunchScreenView>();
            launch.Build(menu);

            // The stage of the window, in canvas units: what MatchHud's root is (the stage divides the canvas scale out again).
            float factor = HudLayout.CanvasScalerFactor(window.x, window.y);
            var root = (RectTransform)new GameObject("fix3 hub root", typeof(RectTransform)).transform;
            root.SetParent(_canvas.transform, false);
            root.anchorMin = root.anchorMax = root.pivot = new Vector2(.5f, .5f); root.anchoredPosition = Vector2.zero;
            root.sizeDelta = new Vector2(window.x / factor, window.y / factor);

            _lobbyOwner = new GameObject("fix3 lobby owner");
            var lobby = _lobbyOwner.AddComponent<HubLobbyActivityView>();
            lobby.Initialize(root, null);
            lobby.SetHub(true, true);
            launch.StageScaler.ViewportChanged += lobby.ApplyViewport;
            launch.StageScaler.Apply(window.x, window.y, factor);
            Canvas.ForceUpdateCanvases();

            Assert.That(lobby.IsVisible, Is.True);
            var card = World((RectTransform)root.Find("HubLobbyActivityPanel"));
            float unit = launch.Stage.lossyScale.x;   // canvas units per HUD unit
            Assert.That(card.width / unit, Is.GreaterThanOrEqualTo(200f), "card width in HUD units");
            Assert.That(card.height / unit, Is.GreaterThanOrEqualTo(100f), "card height in HUD units");
            var screen = World(root);
            Assert.That(screen.Contains(card.min) && screen.Contains(card.max), Is.True, "card " + card + " is inside the window " + screen);

            var tiles = new List<KeyValuePair<string, Rect>>();
            foreach (var button in launch.Atrium.Room.GetComponentsInChildren<Button>(true))
                tiles.Add(new KeyValuePair<string, Rect>(button.name, World((RectTransform)button.transform)));
            Assert.That(tiles.Count, Is.EqualTo(13), "arena, training, counters, five kiosks and five factions");
            tiles.Add(new KeyValuePair<string, Rect>("launch panel", World(launch.Panel)));
            tiles.Add(new KeyValuePair<string, Rect>("wordmark", World((RectTransform)launch.Stage.Find("Wordmark"))));
            tiles.Add(new KeyValuePair<string, Rect>("station message", World((RectTransform)launch.Atrium.Area.Find("StationMessageBox"))));
            foreach (var tile in tiles)
                Assert.That(card.Overlaps(tile.Value), Is.False, "the lobby card " + card + " overlaps " + tile.Key + " " + tile.Value);
        }
    }
}
