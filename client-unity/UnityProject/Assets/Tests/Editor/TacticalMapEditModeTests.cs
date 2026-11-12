using System;
using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace Roguehalla.Client.Tests
{
    public sealed class TacticalMapEditModeTests
    {
        GameObject _root;
        Session _session;
        DeliveredTransport _transport;
        GameObject _controllerObject, _clientObject, _uiRoot;
        TacticalMapController _controller;
        MatchClient _client;
        Session _reboundSession;
        [SetUp]
        public void SetUp()
        {
            _root = new GameObject("Map fixture", typeof(RectTransform));
            _transport = new DeliveredTransport();
            _session = new Session(_transport, new SessionOptions { Url = "ws://localhost/ws", Profile = "fixture", Now = () => 1000 });
            _session.Connect(); _transport.Open();
            _transport.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16],
                PlayerId = 1, TickRate = 20, Map = new MapBlob(4, 4, new byte[16]) });
        }
        [TearDown]
        public void TearDown()
        {
            if (_controller != null) _controller.Bind(null);
            if (_session != null) _session.Leave();
            if (_reboundSession != null) _reboundSession.Leave();
            if (_controllerObject != null) UnityEngine.Object.DestroyImmediate(_controllerObject);
            if (_uiRoot != null) UnityEngine.Object.DestroyImmediate(_uiRoot);
            if (_clientObject != null) UnityEngine.Object.DestroyImmediate(_clientObject);
            UnityEngine.Object.DestroyImmediate(_root);
        }

        [Test]
        public void NewSnapshotInvalidatesPaintThrottleAndClearsBothObservedMapSurfaces()
        {
            CreateController(_session);
            _transport.Deliver(Snapshot(1, new WireActor { Id = 2, X = 48, Y = 48, HpPct = 100, Status = 1 }));
            _controller.SetOpen(true);
            _controller.Tick();
            Assert.AreEqual(1, LargeMarks().ContactCount);
            Assert.AreEqual(1, MinimapMarks().ContactCount);

            SetNextPaint(Time.realtimeSinceStartupAsDouble + 60);
            _transport.Deliver(Snapshot(2));
            _controller.Tick();

            Assert.AreEqual(0, LargeMarks().ContactCount, "new accepted snapshots must invalidate a far-future paint throttle");
            Assert.AreEqual(0, MinimapMarks().ContactCount, "the minimap must use the same current delivered contact set");
        }

        [Test]
        public void DisconnectAndRebindClearMarksAndRefreshSingleObservedContactRail()
        {
            CreateController(_session);
            _transport.Deliver(Snapshot(1, new WireActor { Id = 2, X = 48, Y = 48, HpPct = 100, Status = 1 }));
            _controller.SetOpen(true);
            _controller.Tick();
            Assert.AreEqual(1, LargeMarks().ContactCount);
            Assert.AreEqual(1, MinimapMarks().ContactCount);
            StringAssert.DoesNotContain("No other contacts", ContactsText());

            SetNextPaint(Time.realtimeSinceStartupAsDouble + 60);
            _transport.Drop();
            _controller.Tick();
            Assert.AreEqual(0, LargeMarks().ContactCount, "disconnect must clear the large map's cached marks");
            Assert.AreEqual(0, MinimapMarks().ContactCount, "disconnect must clear the minimap's cached marks");

            _controller.Bind(null);
            Assert.AreEqual(string.Empty, ContactsText(), "unbinding clears the prior session's contact rail");
            Assert.AreEqual(0, LargeMarks().ContactCount);
            Assert.AreEqual(0, MinimapMarks().ContactCount);

            var nextTransport = new DeliveredTransport();
            _reboundSession = NewSession(nextTransport, 3);
            _controller.Bind(_reboundSession);
            nextTransport.Deliver(Snapshot(1, new WireActor { Id = 3, X = 80, Y = 80, Faction = 2, HpPct = 100, Status = 1 }));
            _controller.SetOpen(true);
            SetNextPaint(Time.realtimeSinceStartupAsDouble + 60);
            _controller.Tick();

            StringAssert.Contains("Plague · Player", ContactsText());
            StringAssert.DoesNotContain("No other contacts", ContactsText(), "one observed enemy is still an observed contact");
            Assert.AreEqual(1, LargeMarks().ContactCount);
            Assert.AreEqual(1, MinimapMarks().ContactCount);
        }

        [Test]
        public void MinimapVisibilityTracksActiveMapSuppressionAndUnbind()
        {
            CreateController(_session);
            _transport.Deliver(Snapshot(1));
            Assert.AreEqual(SessionState.InMatch, _session.State);
            Assert.AreEqual(MatchPhase.Active, _session.Phase);
            Assert.IsTrue(MinimapRoot().activeSelf, "an active bound session should show its minimap");

            _controller.SetOpen(true);
            Assert.IsFalse(MinimapRoot().activeSelf, "the minimap hides while its large map is open");
            _controller.SetOpen(false);
            Assert.IsTrue(MinimapRoot().activeSelf, "closing the large map restores the minimap");

            _controller.SetMinimapSuppressed(true);
            Assert.IsFalse(MinimapRoot().activeSelf, "an explicit suppression hides the minimap");
            _controller.SetMinimapSuppressed(false);
            Assert.IsTrue(MinimapRoot().activeSelf, "clearing suppression restores it for the active session");

            _controller.Bind(null);
            Assert.IsFalse(MinimapRoot().activeSelf, "unbinding the session hides the minimap");
        }

        [Test]
        public void DeliveredMapContactHasCanvasRendererAndNonemptyRenderedGeometry()
        {
            CreateController(_session);
            _transport.Deliver(Snapshot(1, new WireActor { Id = 2, X = 48, Y = 48, HpPct = 100, Status = 1 }));
            _controller.SetOpen(true);
            _controller.Tick();

            var marks = LargeMarks();
            Assert.IsTrue(marks.isActiveAndEnabled);
            Assert.AreEqual(1, marks.ContactCount, "the session delivered one observable contact");
            var canvasRenderer = marks.GetComponent<CanvasRenderer>();
            Assert.IsNotNull(canvasRenderer, "the actual map marks graphic must have a CanvasRenderer");
            Canvas.ForceUpdateCanvases();
            var mesh = canvasRenderer.GetMesh();
            Assert.IsNotNull(mesh);
            Assert.Greater(mesh.vertexCount, 0, "the delivered contact must produce renderable vertices");
        }

        void CreateController(Session session)
        {
            _uiRoot = new GameObject("Tactical map controller canvas", typeof(RectTransform), typeof(Canvas), typeof(GraphicRaycaster));
            _clientObject = new GameObject("Disabled map test client");
            _client = _clientObject.AddComponent<MatchClient>();
            _client.enabled = false;
            _client.Url = "ws://localhost/map-test"; _client.Profile = "fixture";
            _controllerObject = new GameObject("Tactical map controller");
            _controller = _controllerObject.AddComponent<TacticalMapController>();
            _controller.Initialize(_client, _uiRoot.transform);
            _controller.Bind(session);
        }

        TacticalMapMarks LargeMarks() => _uiRoot.transform.Find("TacticalMap/MapFrame/PublicMap/Delivered contacts and personal route").GetComponent<TacticalMapMarks>();
        GameObject MinimapRoot() => _uiRoot.transform.Find("Minimap").gameObject;
        TacticalMapMarks MinimapMarks() => _uiRoot.transform.Find("Minimap/TerrainFrame/Delivered contacts and personal route").GetComponent<TacticalMapMarks>();
        string ContactsText() => _uiRoot.transform.Find("TacticalMap/TacticalInformation/ContactsPage/DeliveredContacts/Viewport/Content").GetComponent<TMPro.TMP_Text>().text;
        void SetNextPaint(double value) => typeof(TacticalMapController).GetField("_nextPaint", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(_controller, value);

        static ServerMsg.Snapshot Snapshot(uint tick, params WireActor[] actors)
            => new ServerMsg.Snapshot { Tick = tick, Phase = 1, Actors = actors };

        static Session NewSession(DeliveredTransport transport, byte id)
        {
            var session = new Session(transport, new SessionOptions { Url = "ws://localhost/ws", Profile = "fixture", Now = () => 1000 });
            session.Connect(); transport.Open();
            var matchId = new byte[16]; matchId[0] = id;
            transport.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = matchId, Session = new byte[16],
                PlayerId = 1, TickRate = 20, Map = new MapBlob(4, 4, new byte[16]) });
            return session;
        }

        [Test]
        public void ReplacingDeliveredMembershipRemovesHiddenContactsImmediately()
        {
            var marks = _root.AddComponent<TacticalMapMarks>(); marks.SetMap(_session.Map);
            _transport.Deliver(new ServerMsg.Snapshot { Tick = 1, Phase = 1, Actors = new[] { new WireActor { Id = 2, X = 48, Y = 48, HpPct = 100, Status = 1 } } });
            marks.Present(_session, Array.Empty<RoutePoint>()); Assert.AreEqual(1, marks.ContactCount);
            _transport.Deliver(new ServerMsg.Snapshot { Tick = 2, Phase = 1, Actors = Array.Empty<WireActor>() });
            marks.Present(_session, Array.Empty<RoutePoint>()); Assert.AreEqual(0, marks.ContactCount);
        }

        [Test]
        public void CampMarkersComeFromTheMapCampsAndTheDeliveredRowsAndAreDroppedUnderAContact()
        {
            var map = new MapBlob(4, 4, new byte[16]).WithPublic(new[] { new MapCamp(96, 96, 8, 1), new MapCamp(32, 32, 8, 3) }, null, null, null, null);
            var marks = _root.AddComponent<TacticalMapMarks>(); marks.SetMap(map);
            marks.Present(_session, null); Assert.AreEqual(0, marks.CampMarkerCount, "no camp rows delivered yet");
            _transport.Deliver(new ServerMsg.State { Tick = 3, Items = new StateItem[] { new CampsState { Rows = new[] {
                new WireCamp { MobType = 0, Elite = 0, Alive = 3, State = 0 },
                new WireCamp { MobType = 0, Elite = 0, Alive = 0, State = 2, ClearedAt = 1000, RespawnAt = 181000 } } } } });
            marks.Present(_session, null);
            Assert.AreEqual(2, marks.CampMarkerCount);
            _transport.Deliver(new ServerMsg.Snapshot { Tick = 4, Phase = 1, Actors = new[] { new WireActor { Id = 2, X = 96, Y = 96, HpPct = 100, Status = 1 } } });
            marks.Present(_session, null);
            Canvas.ForceUpdateCanvases();
            Assert.AreEqual(2, marks.CampMarkerCount, "the model still has both camps");
        }

        [Test]
        public void CampRewardBadgesAndWardBeaconsAreDrawnForRowsThatHaveThem()
        {
            var map = new MapBlob(4, 4, new byte[16]).WithPublic(new[] { new MapCamp(96, 96, 8, 1), new MapCamp(32, 32, 8, 3) }, null, null, null, null);
            var marks = _root.AddComponent<TacticalMapMarks>(); marks.Large = true; marks.SetMap(map);
            _transport.Deliver(new ServerMsg.State { Tick = 3, Items = new StateItem[] { new CampsState { Rows = new[] {
                new WireCamp { MobType = 0, Elite = 0, Alive = 3, State = 0, Reward = new WireCampReward { Stat = 2, Amount = 100 } },
                new WireCamp { MobType = 0, Elite = 0, Alive = 3, State = 0, Ward = new WireWard { Yours = true, ExpiresAt = 1e12 } } } } } });
            marks.Present(_session, null);
            Canvas.ForceUpdateCanvases();
            Assert.AreEqual(1, marks.RewardBadgeCount, "only the camp with a reward row has a badge");
            Assert.AreEqual(1, marks.WardMarkCount, "only the camp with a ward has a beacon");
            Assert.AreEqual(1, marks.BadgesDrawn);
            Assert.AreEqual(1, marks.WardsDrawn);
        }

        [Test]
        public void TheMinimapDrawsAChestsSecondsAndDropsThatCampsRespawnClock()
        {
            var map = new MapBlob(4, 4, new byte[16]).WithPublic(new[] { new MapCamp(96, 96, 8, 1), new MapCamp(32, 32, 8, 3) }, null, null, null, null);
            var marks = _root.AddComponent<TacticalMapMarks>(); marks.SetMap(map);
            var cleared = new WireCamp { MobType = 0, Elite = 0, Alive = 0, State = 2, ClearedAt = 1000, RespawnAt = 181000 };
            _transport.Deliver(new ServerMsg.State { Tick = 3, Items = new StateItem[] { new CampsState { Rows = new[] { cleared, cleared } } } });
            marks.Present(_session, null);
            Assert.AreEqual(2, marks.CampClocksShown, "both cleared camps show their clocks");
            _transport.Deliver(new ServerMsg.State { Tick = 4, Items = new StateItem[] { new RewardChestsState { Rows = new[] {
                new WireRewardChest { Handle = new RewardChestHandle(5), X = 768, Y = 768, ExpiresAt = 12300, CanChoose = true, Options = new WireRewardOption[0] } } } } });
            marks.Present(_session, null);
            Assert.AreEqual(1, marks.ChestBadgeCount);
            Assert.AreEqual("13", marks.ChestBadgeText(0));
            Assert.AreEqual(1, marks.CampClocksShown, "the camp whose chest stands keeps one badge");
            _transport.Deliver(new ServerMsg.State { Tick = 5, Items = new StateItem[] { new RewardChestsState { Rows = new WireRewardChest[0] } } });
            marks.Present(_session, null);
            Assert.AreEqual(0, marks.ChestBadgeCount);
            Assert.AreEqual(2, marks.CampClocksShown, "the clock returns when the chest is gone");
        }

        [Test]
        public void TheTabMapLabelsTheHuntedRivalHuntAndOtherRivalsEnemyButTheMinimapNone()
        {
            var map = new MapBlob(4, 4, new byte[16]);
            var large = _root.AddComponent<TacticalMapMarks>(); large.Large = true; large.SetMap(map);
            var small = new GameObject("Mini", typeof(RectTransform)).AddComponent<TacticalMapMarks>(); small.transform.SetParent(_root.transform, false); small.SetMap(map);
            _transport.Deliver(new ServerMsg.Snapshot { Tick = 1, Phase = 1,
                Me = new WireSelf { Id = 1, Faction = (byte)FactionId.Sentenced, Status = 1, HuntTarget = 2, Hp = 10, MaxHp = 10, X = 16, Y = 16 },
                Actors = new[] { new WireActor { Id = 1, X = 16, Y = 16, HpPct = 100, Status = 1 }, new WireActor { Id = 2, X = 48, Y = 48, HpPct = 100, Status = 1 },
                    new WireActor { Id = 3, X = 64, Y = 64, HpPct = 100, Status = 1 } } });
            large.Present(_session, null); small.Present(_session, null);
            Assert.AreEqual(2, large.ContactLabelCount);
            Assert.AreEqual("HUNT", large.ContactLabelText(0));
            Assert.AreEqual("ENEMY", large.ContactLabelText(1));
            Assert.AreEqual(0, small.ContactLabelCount);
        }

        [Test]
        public void DisconnectClearsMapContactsAndCannotRetainAHiddenGhost()
        {
            var marks = _root.AddComponent<TacticalMapMarks>(); marks.SetMap(_session.Map);
            _transport.Deliver(new ServerMsg.Snapshot { Tick = 1, Phase = 1, Actors = new[] { new WireActor { Id = 2, X = 48, Y = 48, HpPct = 100, Status = 1 } } });
            marks.Present(_session, null); Assert.AreEqual(1, marks.ContactCount);
            _transport.Drop(); marks.Present(_session, null); Assert.AreEqual(0, marks.ContactCount);
        }

        [Test]
        public void PointerProjectionUsesPublicMapDimensionsAndDownwardServerY()
        {
            var rect = (RectTransform)_root.transform; rect.sizeDelta = new Vector2(400, 200); rect.position = new Vector3(200, 100, 0);
            var surface = _root.AddComponent<TacticalMapSurface>(); surface.Initialize(); surface.SetMap(new MapBlob(4, 2, new byte[8]));
            var data = new PointerEventData(null) { position = new Vector2(100, 150) };
            Assert.IsTrue(surface.PointerWorld(data, out var point));
            Assert.That(point.x, Is.EqualTo(32).Within(.01)); Assert.That(point.y, Is.EqualTo(16).Within(.01));
        }

        [Test]
        public void MapPhaseIsOwnedAndDoesNotRewindWithStaleSnapshot()
        {
            Assert.IsNull(_session.Phase);
            _transport.Deliver(new ServerMsg.Snapshot { Tick = 2, Phase = 1 }); Assert.AreEqual(MatchPhase.Active, _session.Phase);
            _transport.Deliver(new ServerMsg.Snapshot { Tick = 1, Phase = 0 }); Assert.AreEqual(MatchPhase.Active, _session.Phase);
        }

        sealed class DeliveredTransport : ITransport
        {
            public event Action Opened;
            public event Action<byte[]> Received;
            public event Action<string> Closed;
            public void Open() => Opened?.Invoke();
            public void Deliver(ServerMsg msg) => Received?.Invoke(msg.Encode());
            public void Drop() => Closed?.Invoke("test disconnect");
            public void Connect(string url) { }
            public void Send(byte[] frame) { }
            public void Close() { }
            public void Poll() { }
        }
    }
}
