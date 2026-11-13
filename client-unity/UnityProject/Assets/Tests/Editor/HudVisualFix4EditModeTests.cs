using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-HUD-VISUAL-FIX-4, HUD half (items 4 to 6), on the real HUD objects built the way <see cref="HudVisualFix3EditModeTests"/> builds
    /// them (<see cref="Fix3Transport"/> is shared). The tests call only public entry points (ShowTerrain, SentencedHuntPanel.Refresh), so the
    /// chip row and the Hunt card must lay each other out from inside those calls, not from a per-frame hook the test never runs. Rectangles
    /// are HUD units in the HUD root's space, measured after MythicUi.ApplyTextScale.
    /// </summary>
    public sealed class HudVisualFix4EditModeTests
    {
        GameObject _canvas, _owner;
        MatchHud _hud;
        UiTheme _savedTheme;
        Session _session;
        Fix3Transport _transport;

        [SetUp]
        public void SetUp()
        {
            _savedTheme = UiTheme.Current;
            UiTheme.Current = UiTheme.Placeholder();
            _canvas = new GameObject("fix4 canvas", typeof(RectTransform), typeof(Canvas));
            _owner = new GameObject("fix4 hud owner");
            _hud = _owner.AddComponent<MatchHud>();
            SetField("_root", _canvas.GetComponent<RectTransform>());
            Invoke("EnsureStage"); Invoke("CreateTopAndToastPills"); Invoke("CreateLegacyChrome"); Invoke("CreateCombatHud");
            Invoke("SetPlateMode", true);   // the live plate: its 148 unit height is what the chip row and the card sit under
            _transport = new Fix3Transport();
        }

        [TearDown]
        public void TearDown()
        {
            if (_session != null) _session.Leave();
            if (_canvas != null) Object.DestroyImmediate(_canvas);
            if (_owner != null) Object.DestroyImmediate(_owner);
            UiTheme.Current = _savedTheme;
        }

        static WireSelf Self(FactionId faction)
        {
            return new WireSelf { Id = 1, Faction = (byte)faction, X = 64, Y = 64, Hp = 100, MaxHp = 100, Status = 1, Weapon = 2 };
        }

        RectTransform HudRoot => (RectTransform)GetField("_hud");
        RectTransform TerrainRow => (RectTransform)GetField("_terrainRow");

        static Rect Local(RectTransform rect, RectTransform space)
        {
            var c = new Vector3[4]; rect.GetWorldCorners(c);
            Vector3 min = space.InverseTransformPoint(c[0]), max = space.InverseTransformPoint(c[2]);
            return Rect.MinMaxRect(min.x, min.y, max.x, max.y);
        }

        // ------------------------------------------------------------------ item 4: the terrain chip is a pill in its own row

        // Diagnosis (packet): MatchHud.Terrain.cs sizes every chip TerrainWidth (294) wide, 18 tall, at (0, n * 18) of a row placed at
        // PlateTop + the plate's height + 4; the Hunt card (SentencedHuntPanel.cs, Top = 156) never looks at the row.
        [TestCase(1f)]
        [TestCase(1.5f)]
        public void TheTerrainChipIsAPillNoWiderThanItsTextPlusPadding(float scale)
        {
            MythicUi.ApplyTextScale(_canvas.transform, scale);
            _hud.ShowTerrain(true, 4, MapBlob.GroundTerrainAll, FactionId.Sentenced);
            Assert.That(_hud.TerrainChipLabel, Does.Contain("BURNING"));
            var chip = (RectTransform)TerrainRow.Find("Chip0");
            var label = chip.Find("Label").GetComponent<TMP_Text>();
            float text = label.GetPreferredValues(label.text, 1000f, 0f).x;
            float width = Local(chip, HudRoot).width;
            Assert.That(width, Is.GreaterThanOrEqualTo(text), "the pill holds its text (" + text + ")");
            Assert.That(width, Is.LessThanOrEqualTo(text + 24f), "pill " + width + " wide for " + text + " of text: a full-width bar is the defect (shot 12)");
        }

        // ------------------------------------------------------------------ item 4: the Hunt card starts below the chip row

        SentencedHuntPanel NewHuntPanel(int rivals = 0)
        {
            var actors = new List<WireActor>();
            for (uint i = 0; i < rivals; i++) actors.Add(new WireActor { Id = 2 + i, X = 100 + i * 10, Y = 100, Status = 1, HpPct = (byte)(90 - i * 10), Faction = (byte)(2 + i) });
            _session = Fix3Transport.Join(_transport, new MapBlob(4, 4, new byte[16]), Self(FactionId.Sentenced), actors.ToArray());
            SetField("_session", _session);
            var panel = _owner.AddComponent<SentencedHuntPanel>();
            panel.Initialize(HudRoot);
            SetField("_huntPanel", panel);
            return panel;
        }

        [Test]
        public void WithAChipShownBeforeTheCardOpensTheCardStartsBelowTheChipRow()
        {
            var panel = NewHuntPanel();
            _hud.ShowTerrain(true, 4, MapBlob.GroundTerrainAll, FactionId.Sentenced);
            panel.Refresh(_session, true);
            Assert.That(panel.IsVisible, Is.True);
            Rect row = Local(TerrainRow, HudRoot), card = Local(panel.Root, HudRoot);
            Assert.That(TerrainRow.gameObject.activeInHierarchy, Is.True);
            Assert.That(card.yMax, Is.LessThanOrEqualTo(row.yMin + .01f), "card top " + card.yMax + " is not below the chip row's bottom " + row.yMin);
        }

        [Test]
        public void ACardAlreadyOpenMovesBelowAChipThatAppearsAndBackUpWhenItGoes()
        {
            var panel = NewHuntPanel();
            panel.Refresh(_session, true);
            Assert.That(panel.IsVisible, Is.True);
            float without = Local(panel.Root, HudRoot).yMax;
            float plateBottom = Local((RectTransform)GetField("_vitalsPanel"), HudRoot).yMin;
            Assert.That(without, Is.LessThanOrEqualTo(plateBottom + .01f), "with no chip the card still starts below the GAINED plate (top " + without + ", plate bottom " + plateBottom + ")");
            _hud.ShowTerrain(true, 4, MapBlob.GroundTerrainAll, FactionId.Sentenced);
            Rect row = Local(TerrainRow, HudRoot);
            float with = Local(panel.Root, HudRoot).yMax;
            Assert.That(with, Is.LessThanOrEqualTo(row.yMin + .01f), "card top " + with + " overlaps the chip row (bottom " + row.yMin + ")");
            Assert.That(with, Is.LessThan(without), "the card moved down");
            _hud.ShowTerrain(true, 0, MapBlob.GroundTerrainAll, FactionId.Sentenced);
            Assert.That(Local(panel.Root, HudRoot).yMax, Is.EqualTo(without).Within(.5f), "the chip is gone: the card returns to its place");
        }

        // ------------------------------------------------------------------ item 5: the card's height follows its content

        // Diagnosis (packet): SentencedHuntPanel.cs sizes the card RowsTop (102) + 12 + 4 high however short the text (a one-line "No rival in
        // sight" leaves about 80 units empty), and puts the rival rows at RowsTop below a 76 unit status box whatever the text needs.
        [TestCase(1f, 0, false)]
        [TestCase(1.5f, 0, false)]
        [TestCase(1f, 0, true)]
        [TestCase(1f, 3, false)]
        [TestCase(1.5f, 3, false)]
        public void TheHuntCardIsNoTallerThanItsContentByMoreThanOneRow(float scale, int rivals, bool tracking)
        {
            var me = Self(FactionId.Sentenced);
            if (tracking) me.HuntTarget = 2;
            var actors = new List<WireActor>();
            for (uint i = 0; i < (tracking ? 1u : (uint)rivals); i++) actors.Add(new WireActor { Id = 2 + i, X = 100 + i * 10, Y = 100, Status = 1, HpPct = (byte)(90 - i * 10), Faction = (byte)(2 + i) });
            _session = Fix3Transport.Join(_transport, new MapBlob(4, 4, new byte[16]), me, actors.ToArray());
            var panel = _owner.AddComponent<SentencedHuntPanel>();
            panel.Initialize(_canvas.transform);
            MythicUi.ApplyTextScale(_canvas.transform, scale);
            panel.Refresh(_session, true);
            Assert.That(panel.IsVisible, Is.True);

            var status = panel.Root.Find("Status/Status").GetComponent<TMP_Text>();
            Rect statusBox = Local(status.rectTransform, panel.Root);
            float textBottom = statusBox.yMax - status.GetPreferredValues(status.text, statusBox.width, 0f).y;
            float contentBottom = textBottom;
            float firstRowTop = float.NaN;
            int rows = 0;
            foreach (RectTransform child in panel.Root)
            {
                if (!child.gameObject.activeSelf || !child.name.StartsWith("Rival")) continue;
                Rect r = Local(child, panel.Root);
                contentBottom = Mathf.Min(contentBottom, r.yMin);
                firstRowTop = float.IsNaN(firstRowTop) ? r.yMax : Mathf.Max(firstRowTop, r.yMax);
                rows++;
            }
            Assert.That(rows, Is.EqualTo(tracking ? 0 : rivals), "set-up: the rival rows");
            float cardBottom = panel.Root.rect.yMin;
            Assert.That(cardBottom, Is.LessThanOrEqualTo(contentBottom + .5f), "the content runs out of the card");
            float row = 24f + 3f;   // one rival row, as the card draws it
            Assert.That(contentBottom - cardBottom, Is.LessThanOrEqualTo(row), "the card (" + panel.Root.rect.height + " tall) has " + (contentBottom - cardBottom) + " units of empty space under its content");
            if (rows > 0)
                Assert.That(textBottom - firstRowTop, Is.InRange(-.5f, 14f), "the rows start right under the status text (a fixed 76 unit text box leaves a hole)");
        }

        // ------------------------------------------------------------------ item 6: the defeat card shows no stale join pill

        // Diagnosis (packet): MatchHud.Legacy.cs SyncTopCentre forces the banner pill on whenever the session state is Rejected, and
        // MatchHud.cs HudLateUpdate writes "Join rejected: <reason>" into it; a session that ended with a result and then got a reject
        // (the server closing the room: reason "closed") keeps that state, so the pill stays over the results card (shots 08, 21).
        void Reject(bool withResult)
        {
            _session = Fix3Transport.Join(_transport, new MapBlob(4, 4, new byte[16]), Self(FactionId.Holy));
            SetField("_session", _session);
            if (withResult)
                _transport.Deliver(new ServerMsg.Events { Tick = 5, List = { new WireEvent { Kind = EventKind.Result,
                    Result = new WireResult { Outcome = 2, Place = 1, Players = 1, KilledBy = "Chain Warden", DurationSec = 83 } } } });
            _transport.Deliver(new ServerMsg.Reject { Code = RejectCode.Kicked, Reason = "closed" });
            Assert.That(_session.State, Is.EqualTo(SessionState.Rejected), "set-up");
            Assert.That(_session.LastResult != null, Is.EqualTo(withResult), "set-up");
            Invoke("SyncTopCentre");
        }

        RectTransform BannerPill => (RectTransform)GetField("_bannerPill");

        [Test]
        public void ARejectedJoinWithNoResultStillShowsItsPill()
        {
            Reject(false);
            Assert.That(BannerPill.gameObject.activeSelf, Is.True);
        }

        [Test]
        public void NoJoinStatusPillIsShownOverAResultsCard()
        {
            Reject(true);
            Assert.That(BannerPill.gameObject.activeSelf, Is.False, "the results card is the truth once the server delivered a result");
        }

        object GetField(string name) => typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_hud);
        void SetField(string name, object value) => typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(_hud, value);
        void Invoke(string name, params object[] args) => typeof(MatchHud).GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_hud, args.Length == 0 ? null : args);
    }

    /// <summary>
    /// P-UNITY-HUD-VISUAL-FIX-4, item 6: the hub lobby card's text (the "unavailable" state is 9 lines at 15 units) ends on or below the
    /// card's bottom edge at 1024x768 (hub shot), and the Tab map must hide the world name labels while it is open.
    /// </summary>
    public sealed class HubLobbyTextAndTabMapFix4EditModeTests
    {
        static readonly Vector2[] Windows = { new Vector2(1280, 720), new Vector2(1920, 1080), new Vector2(1024, 768), new Vector2(960, 720) };

        GameObject _canvas, _owner, _lobbyOwner, _stageObject, _clientObject, _controllerObject;
        Fix3Transport _transport; Session _session;
        TacticalMapController _controller;

        [TearDown]
        public void TearDown()
        {
            if (_controller != null) _controller.Bind(null);
            if (_session != null) _session.Leave();
            foreach (var go in new[] { _controllerObject, _clientObject, _stageObject, _lobbyOwner, _owner, _canvas }) if (go != null) Object.DestroyImmediate(go);
            WorldLabelVisibility.Hidden = false;
        }

        [TestCaseSource(nameof(Windows))]
        public void TheLobbyCardsTextStaysInsideTheCardInItsUnavailableState(Vector2 window)
        {
            _canvas = new GameObject("fix4 hub canvas", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            _canvas.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
            var menu = (RectTransform)new GameObject("JoinMenu", typeof(RectTransform)).transform;
            menu.SetParent(_canvas.transform, false);
            menu.anchorMin = Vector2.zero; menu.anchorMax = Vector2.one; menu.offsetMin = menu.offsetMax = Vector2.zero;
            _owner = new GameObject("fix4 launch owner");
            var launch = _owner.AddComponent<LaunchScreenView>();
            launch.Build(menu);
            float factor = HudLayout.CanvasScalerFactor(window.x, window.y);
            var root = (RectTransform)new GameObject("fix4 hub root", typeof(RectTransform)).transform;
            root.SetParent(_canvas.transform, false);
            root.anchorMin = root.anchorMax = root.pivot = new Vector2(.5f, .5f); root.anchoredPosition = Vector2.zero;
            root.sizeDelta = new Vector2(window.x / factor, window.y / factor);
            _lobbyOwner = new GameObject("fix4 lobby owner");
            var lobby = _lobbyOwner.AddComponent<HubLobbyActivityView>();
            lobby.Initialize(root, null);
            lobby.SetHub(true, true);
            launch.StageScaler.ViewportChanged += lobby.ApplyViewport;
            launch.StageScaler.Apply(window.x, window.y, factor);
            Canvas.ForceUpdateCanvases();

            Assert.That(lobby.IsVisible, Is.True);
            StringAssert.Contains("unavailable", lobby.Text, "set-up: the unavailable state");
            var card = (RectTransform)root.Find("HubLobbyActivityPanel");
            var body = card.Find("LobbyActivityBody").GetComponent<TMP_Text>();
            body.ForceMeshUpdate();
            var rendered = body.GetRenderedValues(false);
            var box = body.rectTransform.rect;
            Assert.That(rendered.y, Is.LessThanOrEqualTo(box.height + .5f), "text " + rendered.y + " tall in a box " + box.height + " tall (card " + card.rect.height + ") at " + window);
            Assert.That(rendered.x, Is.LessThanOrEqualTo(box.width + .5f), "text " + rendered.x + " wide in a box " + box.width + " wide");
            Assert.That(body.fontSize, Is.GreaterThanOrEqualTo(11f), "fixed by a readable size, not by shrinking the text to nothing");
            var c = new Vector3[4]; body.rectTransform.GetWorldCorners(c);
            var cc = new Vector3[4]; card.GetWorldCorners(cc);
            Assert.That(c[0].y, Is.GreaterThanOrEqualTo(cc[0].y - .01f), "the text box is inside the card (bottom)");
            Assert.That(c[2].y, Is.LessThanOrEqualTo(cc[2].y + .01f), "the text box is inside the card (top)");
        }

        // ---- the Tab map hides world names (its half: it sets WorldLabelVisibility; NamePackFix4EditModeTests covers the presenters) ----

        void BuildMap()
        {
            _canvas = new GameObject("fix4 map canvas", typeof(RectTransform), typeof(Canvas), typeof(GraphicRaycaster));
            _stageObject = new GameObject("fix4 stage", typeof(RectTransform));
            var stage = (RectTransform)_stageObject.transform; stage.SetParent(_canvas.transform, false);
            stage.anchorMin = stage.anchorMax = stage.pivot = new Vector2(.5f, .5f); stage.sizeDelta = new Vector2(1280f, 720f);
            _transport = new Fix3Transport();
            _session = Fix3Transport.Join(_transport, new MapBlob(4, 4, new byte[16]),
                new WireSelf { Id = 1, Faction = 4, X = 48, Y = 48, Hp = 100, MaxHp = 100, Status = 1, Weapon = (byte)WeaponId.Wand });
            _clientObject = new GameObject("fix4 map client");
            var client = _clientObject.AddComponent<MatchClient>(); client.enabled = false; client.Url = "ws://localhost/fix4"; client.Profile = "fixture";
            _controllerObject = new GameObject("fix4 map controller");
            _controller = _controllerObject.AddComponent<TacticalMapController>();
            _controller.Initialize(client, _canvas.transform, null, stage);
            _controller.Bind(_session);
        }

        [Test]
        public void OpeningTheTabMapHidesWorldNamesAndClosingItBringsThemBack()
        {
            BuildMap();
            Assert.That(WorldLabelVisibility.Hidden, Is.False, "set-up: closed map");
            _controller.SetOpen(true);
            _controller.Tick();
            Assert.That(_controller.IsOpen, Is.True);
            Assert.That(WorldLabelVisibility.Hidden, Is.True, "world names show through behind the map's panels (shot 27)");
            _controller.SetOpen(false);
            _controller.Tick();
            Assert.That(WorldLabelVisibility.Hidden, Is.False, "names are back when the map closes");
        }

        [Test]
        public void ReleasingTheMapTransientlyAlsoShowsWorldNamesAgain()
        {
            BuildMap();
            _controller.SetOpen(true);
            _controller.Tick();
            Assert.That(WorldLabelVisibility.Hidden, Is.True, "an open map hides the names (precondition of the release check)");
            _controller.ReleaseTransient();   // window blur, match end
            Assert.That(WorldLabelVisibility.Hidden, Is.False, "a map that was closed under it must not leave the names hidden");
        }
    }
}
